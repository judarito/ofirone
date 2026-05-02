import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizePaymentId(body: Record<string, unknown>, url: URL) {
  const bodyData = body?.data as Record<string, unknown> | undefined
  return String(
    bodyData?.id
    || body?.id
    || url.searchParams.get('data.id')
    || url.searchParams.get('id')
    || '',
  ).trim()
}

function normalizeExternalReference(body: Record<string, unknown>, url: URL) {
  const bodyData = body?.data as Record<string, unknown> | undefined
  return String(
    body?.external_reference
    || bodyData?.external_reference
    || url.searchParams.get('external_reference')
    || '',
  ).trim()
}

async function fetchPaymentById(accessToken: string, paymentId: string) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

async function searchLatestPaymentByReference(accessToken: string, externalReference: string) {
  const url = new URL('https://api.mercadopago.com/v1/payments/search')
  url.searchParams.set('external_reference', externalReference)
  url.searchParams.set('sort', 'date_created')
  url.searchParams.set('criteria', 'desc')
  url.searchParams.set('limit', '1')

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))
  const payment = Array.isArray(payload?.results) ? payload.results[0] : null
  return { ok: response.ok, status: response.status, payload, payment }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const requestUrl = new URL(req.url)
    const body = await req.json().catch(() => ({}))
    const paymentId = normalizePaymentId(body, requestUrl)
    const requestedExternalReference = normalizeExternalReference(body, requestUrl)
    const topic = String(body?.type || body?.topic || requestUrl.searchParams.get('type') || requestUrl.searchParams.get('topic') || '').trim()

    await supabase.rpc('fn_release_expired_online_orders', { p_limit: 50 })

    if (topic && topic !== 'payment') {
      return jsonResponse({ ok: true, ignored: `unsupported_topic:${topic}` })
    }

    if (!paymentId && !requestedExternalReference) {
      return jsonResponse({ ok: true, ignored: 'missing_payment_id_and_external_reference' })
    }

    let externalReference = requestedExternalReference
    let orderForToken = null as null | { online_order_id: string, tenant_id: string, total: number, payment_mode: string }

    if (externalReference) {
      const { data: orderData, error: orderError } = await supabase
        .from('online_orders')
        .select('online_order_id, tenant_id, total, payment_mode')
        .eq('online_order_id', externalReference)
        .maybeSingle()

      if (orderError) throw orderError
      orderForToken = orderData
    }

    const { data: credentialRows, error: credentialsError } = await supabase
      .from('tenant_gateway_credentials')
      .select('tenant_id, access_token, is_enabled')
      .eq('provider', 'MERCADO_PAGO')
      .eq('is_enabled', true)

    if (credentialsError) throw credentialsError

    let mercadoPagoAccessToken = ''
    let payment: Record<string, unknown> | null = null
    let paymentLookupStatus = 404

    if (orderForToken?.payment_mode === 'GATEWAY') {
      const credentialRow = (credentialRows || []).find((row) => row.tenant_id === orderForToken?.tenant_id)
      mercadoPagoAccessToken = String(credentialRow?.access_token || '').trim()
    }

    if (paymentId && mercadoPagoAccessToken) {
      const paymentRes = await fetchPaymentById(mercadoPagoAccessToken, paymentId)
      paymentLookupStatus = paymentRes.status
      if (paymentRes.ok) {
        payment = paymentRes.payload as Record<string, unknown>
      }
    }

    if (!payment && paymentId) {
      for (const credentialRow of (credentialRows || [])) {
        const candidateToken = String(credentialRow?.access_token || '').trim()
        if (!candidateToken) continue
        const paymentRes = await fetchPaymentById(candidateToken, paymentId)
        paymentLookupStatus = paymentRes.status
        if (!paymentRes.ok) continue
        payment = paymentRes.payload as Record<string, unknown>
        mercadoPagoAccessToken = candidateToken
        externalReference = String(
          payment?.external_reference
          || (payment?.metadata as Record<string, unknown> | undefined)?.online_order_id
          || externalReference
          || '',
        ).trim()
        if (!externalReference) continue

        const { data: orderData, error: orderError } = await supabase
          .from('online_orders')
          .select('online_order_id, tenant_id, total, payment_mode')
          .eq('online_order_id', externalReference)
          .maybeSingle()

        if (orderError) throw orderError
        orderForToken = orderData
        if (orderForToken?.payment_mode === 'GATEWAY' && orderForToken.tenant_id === credentialRow.tenant_id) {
          break
        }
      }
    }

    if (!payment && externalReference && orderForToken?.payment_mode === 'GATEWAY' && mercadoPagoAccessToken) {
      const searchRes = await searchLatestPaymentByReference(mercadoPagoAccessToken, externalReference)
      paymentLookupStatus = searchRes.status
      if (searchRes.ok && searchRes.payment) {
        payment = searchRes.payment as Record<string, unknown>
      }
    }

    if (!payment) {
      return jsonResponse({
        error: 'No se pudo consultar el pago en Mercado Pago.',
        payment_id: paymentId || null,
        external_reference: externalReference || null,
      }, paymentLookupStatus >= 400 ? paymentLookupStatus : 404)
    }

    externalReference = String(
      payment?.external_reference
      || (payment?.metadata as Record<string, unknown> | undefined)?.online_order_id
      || externalReference
      || '',
    ).trim()

    if (!externalReference) {
      return jsonResponse({ ok: true, ignored: 'missing_external_reference', payment_id: paymentId })
    }

    if (!orderForToken || orderForToken.online_order_id !== externalReference) {
      const { data: orderData, error: orderError } = await supabase
        .from('online_orders')
        .select('online_order_id, tenant_id, total, payment_mode')
        .eq('online_order_id', externalReference)
        .maybeSingle()

      if (orderError) throw orderError
      orderForToken = orderData
    }

    if (!orderForToken || orderForToken.payment_mode !== 'GATEWAY') {
      return jsonResponse({ ok: true, ignored: 'order_not_found_or_not_gateway', payment_id: paymentId, external_reference: externalReference })
    }

    const transactionAmount = Number(payment?.transaction_amount || 0)
    const orderTotal = Number(orderForToken.total || 0)
    if (transactionAmount > 0 && orderTotal > 0 && Math.abs(transactionAmount - orderTotal) > 1) {
      return jsonResponse({
        error: 'El total del pago no coincide con el pedido online.',
        payment_id: paymentId,
        external_reference: externalReference,
        transaction_amount: transactionAmount,
        order_total: orderTotal,
      }, 400)
    }

    const gatewayPayload = {
      mercado_pago: {
        id: payment?.id || null,
        status: payment?.status || null,
        status_detail: payment?.status_detail || null,
        transaction_amount: payment?.transaction_amount || null,
        currency_id: payment?.currency_id || null,
        payment_method_id: payment?.payment_method_id || null,
        payment_type_id: payment?.payment_type_id || null,
        date_created: payment?.date_created || null,
        date_approved: payment?.date_approved || null,
        live_mode: payment?.live_mode ?? null,
        external_reference: externalReference,
        metadata: payment?.metadata || null,
        payer: payment?.payer || null,
      },
    }

    const { data: syncData, error: syncError } = await supabase.rpc('fn_sync_online_gateway_payment', {
      p_online_order_id: externalReference,
      p_payment_id: String(payment?.id || paymentId || '').trim() || null,
      p_gateway_status: String(payment?.status || 'pending'),
      p_payment_status_detail: String(payment?.status_detail || '').trim() || null,
      p_gateway_payload: gatewayPayload,
    })

    if (syncError) throw syncError

    return jsonResponse({
      ok: true,
      payment_id: paymentId,
      external_reference: externalReference,
      status: payment?.status || null,
      result: syncData || null,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
