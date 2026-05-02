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
    const topic = String(body?.type || body?.topic || requestUrl.searchParams.get('type') || requestUrl.searchParams.get('topic') || '').trim()

    await supabase.rpc('fn_release_expired_online_orders', { p_limit: 50 })

    if (!paymentId) {
      return jsonResponse({ ok: true, ignored: 'missing_payment_id' })
    }

    if (topic && topic !== 'payment') {
      return jsonResponse({ ok: true, ignored: `unsupported_topic:${topic}` })
    }

    const { data: orderForToken, error: orderForTokenError } = await supabase
      .from('online_orders')
      .select('online_order_id, tenant_id, total, payment_mode')
      .eq('online_order_id', externalReference)
      .maybeSingle()

    if (orderForTokenError) throw orderForTokenError
    if (!orderForToken || orderForToken.payment_mode !== 'GATEWAY') {
      return jsonResponse({ ok: true, ignored: 'order_not_found_or_not_gateway', payment_id: paymentId, external_reference: externalReference })
    }

    const { data: credentialRow, error: credentialError } = await supabase
      .from('tenant_gateway_credentials')
      .select('access_token, is_enabled')
      .eq('tenant_id', orderForToken.tenant_id)
      .eq('provider', 'MERCADO_PAGO')
      .maybeSingle()

    if (credentialError) throw credentialError
    const mercadoPagoAccessToken = String(credentialRow?.access_token || '').trim()
    if (!credentialRow?.is_enabled || !mercadoPagoAccessToken) {
      return jsonResponse({ error: 'El tenant del pedido no tiene credenciales activas de Mercado Pago.' }, 400)
    }

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${mercadoPagoAccessToken}`,
        'Content-Type': 'application/json',
      },
    })

    const payment = await mpResponse.json().catch(() => ({}))
    if (!mpResponse.ok) {
      return jsonResponse({
        error: 'No se pudo consultar el pago en Mercado Pago.',
        details: payment,
      }, mpResponse.status)
    }

    const externalReference = String(
      payment?.external_reference
      || payment?.metadata?.online_order_id
      || '',
    ).trim()

    if (!externalReference) {
      return jsonResponse({ ok: true, ignored: 'missing_external_reference', payment_id: paymentId })
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
      p_payment_id: paymentId,
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
