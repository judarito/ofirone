import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUNCTION_BUILD_ID = 'mp-webhook-multi-lookup-v2'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = String(record.message || record.error || record.details || record.hint || '').trim()
    if (message) return message
    try {
      return JSON.stringify(record)
    } catch (_jsonError) {
      return 'Error desconocido en mercadopago-webhook'
    }
  }
  return String(error || 'Error desconocido en mercadopago-webhook')
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

function normalizePreferenceId(body: Record<string, unknown>, url: URL) {
  const bodyData = body?.data as Record<string, unknown> | undefined
  return String(
    body?.preference_id
    || bodyData?.preference_id
    || url.searchParams.get('preference_id')
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

async function fetchPreferenceById(accessToken: string, preferenceId: string) {
  const response = await fetch(`https://api.mercadopago.com/checkout/preferences/${preferenceId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

async function fetchPaymentFromPreference(accessToken: string, preferenceId: string) {
  const url = new URL('https://api.mercadopago.com/merchant_orders/search')
  url.searchParams.set('preference_id', preferenceId)

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) return { ok: false, status: response.status, payload, payment: null }

  const merchantOrder = Array.isArray(payload?.elements) ? payload.elements[0] : null
  const payments = Array.isArray(merchantOrder?.payments) ? merchantOrder.payments : []
  const paymentRef = payments.find((item) => item?.status === 'approved') || payments[0] || null
  const paymentId = String(paymentRef?.id || '').trim()
  if (!paymentId) return { ok: true, status: response.status, payload, payment: null, payment_id: null }

  const paymentResult = await fetchPaymentById(accessToken, paymentId)
  return {
    ok: paymentResult.ok,
    status: paymentResult.status,
    payload: paymentResult.payload,
    payment: paymentResult.ok ? paymentResult.payload : null,
    payment_id: paymentId,
  }
}

async function searchLatestPaymentByReference(accessToken: string, externalReference: string) {
  const url = new URL('https://api.mercadopago.com/v1/payments/search')
  url.searchParams.set('external_reference', externalReference)
  url.searchParams.set('sort', 'date_created')
  url.searchParams.set('criteria', 'desc')
  url.searchParams.set('limit', '1')
  url.searchParams.set('range', 'date_created')
  url.searchParams.set('begin_date', 'NOW-90DAYS')
  url.searchParams.set('end_date', 'NOW')

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

function summarizeLookupPayload(payload: unknown) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const results = Array.isArray(record.results) ? record.results : []
  const elements = Array.isArray(record.elements) ? record.elements : []
  const payments = elements
    .flatMap((element) => {
      const elementRecord = element && typeof element === 'object' ? element as Record<string, unknown> : {}
      return Array.isArray(elementRecord.payments) ? elementRecord.payments : []
    })
    .map((payment) => {
      const paymentRecord = payment && typeof payment === 'object' ? payment as Record<string, unknown> : {}
      return {
        id: paymentRecord.id || null,
        status: paymentRecord.status || null,
        status_detail: paymentRecord.status_detail || null,
        transaction_amount: paymentRecord.transaction_amount || null,
      }
    })

  return {
    message: record.message || record.error || null,
    paging_total: (record.paging as Record<string, unknown> | undefined)?.total ?? null,
    results_count: results.length,
    elements_count: elements.length,
    merchant_order_payments: payments,
    preference_external_reference: record.external_reference || null,
  }
}

function paymentExternalReference(payment: Record<string, unknown> | null, fallback = '') {
  const metadata = payment?.metadata as Record<string, unknown> | undefined
  return String(payment?.external_reference || metadata?.online_order_id || fallback || '').trim()
}

async function dispatchQueuedNotifications(supabaseUrl: string, serviceRoleKey: string) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/notification-dispatcher`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      limit: 10,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
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
    let externalReference = normalizeExternalReference(body, requestUrl)
    const preferenceId = normalizePreferenceId(body, requestUrl)
    const topic = String(body?.type || body?.topic || requestUrl.searchParams.get('type') || requestUrl.searchParams.get('topic') || '').trim()

    const { error: releaseError } = await supabase.rpc('fn_release_expired_online_orders', { p_limit: 50 })
    if (releaseError) throw new Error(`No se pudieron liberar pedidos vencidos: ${getErrorMessage(releaseError)}`)

    if (topic && topic !== 'payment') {
      return jsonResponse({ ok: true, ignored: `unsupported_topic:${topic}` })
    }

    if (!paymentId && !externalReference && !preferenceId) {
      return jsonResponse({ ok: true, ignored: 'missing_payment_id_external_reference_and_preference_id' })
    }

    let orderForToken: Record<string, unknown> | null = null
    if (externalReference) {
      const { data, error } = await supabase
        .from('online_orders')
        .select('online_order_id, tenant_id, total, payment_mode')
        .eq('online_order_id', externalReference)
        .maybeSingle()
      if (error) throw new Error(`No se pudo cargar el pedido online: ${getErrorMessage(error)}`)
      orderForToken = data
    }

    const { data: credentials, error: credentialsError } = await supabase
      .from('tenant_gateway_credentials')
      .select('tenant_id, access_token, is_enabled')
      .eq('provider', 'MERCADO_PAGO')
      .eq('is_enabled', true)

    if (credentialsError) throw new Error(`No se pudieron leer credenciales Mercado Pago: ${getErrorMessage(credentialsError)}`)

    let accessToken = ''
    let payment: Record<string, unknown> | null = null
    let lookupStatus = 404
    let preferenceExternalReference = ''
    const lookupDebug: Array<Record<string, unknown>> = []

    if (orderForToken?.payment_mode === 'GATEWAY') {
      const credential = (credentials || []).find((row) => row.tenant_id === orderForToken?.tenant_id)
      accessToken = String(credential?.access_token || '').trim()
    }

    if (paymentId && accessToken) {
      const result = await fetchPaymentById(accessToken, paymentId)
      lookupStatus = result.status
      lookupDebug.push({
        step: 'tenant_payment_id',
        status: result.status,
        ok: result.ok,
        found: Boolean(result.ok && result.payload?.id),
        summary: summarizeLookupPayload(result.payload),
      })
      if (result.ok) payment = result.payload as Record<string, unknown>
    }

    if (!payment && preferenceId && accessToken) {
      const result = await fetchPaymentFromPreference(accessToken, preferenceId)
      lookupStatus = result.status
      lookupDebug.push({
        step: 'tenant_merchant_order_by_preference',
        status: result.status,
        ok: result.ok,
        found: Boolean(result.payment),
        payment_id: result.payment_id || null,
        summary: summarizeLookupPayload(result.payload),
      })
      if (result.ok && result.payment) {
        payment = result.payment as Record<string, unknown>
      }
    }

    if (!payment && preferenceId && accessToken) {
      const result = await fetchPreferenceById(accessToken, preferenceId)
      lookupStatus = result.status
      lookupDebug.push({
        step: 'tenant_preference_by_id',
        status: result.status,
        ok: result.ok,
        found: Boolean(result.ok && result.payload?.id),
        summary: summarizeLookupPayload(result.payload),
      })
      if (result.ok) {
        preferenceExternalReference = String(result.payload?.external_reference || '').trim()
        if (!externalReference && preferenceExternalReference) {
          externalReference = preferenceExternalReference
        }
      }
    }

    if (!payment && paymentId) {
      for (const credential of (credentials || [])) {
        const candidateToken = String(credential?.access_token || '').trim()
        if (!candidateToken) continue

        const result = await fetchPaymentById(candidateToken, paymentId)
        lookupStatus = result.status
        lookupDebug.push({
          step: 'credential_payment_id',
          tenant_id: credential?.tenant_id || null,
          status: result.status,
          ok: result.ok,
          found: Boolean(result.ok && result.payload?.id),
          summary: summarizeLookupPayload(result.payload),
        })
        if (!result.ok) continue

        const candidatePayment = result.payload as Record<string, unknown>
        const candidateReference = paymentExternalReference(candidatePayment, externalReference)
        if (!candidateReference) continue

        const { data: candidateOrder, error: candidateOrderError } = await supabase
          .from('online_orders')
          .select('online_order_id, tenant_id, total, payment_mode')
          .eq('online_order_id', candidateReference)
          .maybeSingle()
        if (candidateOrderError) throw new Error(`No se pudo asociar el pago a un pedido: ${getErrorMessage(candidateOrderError)}`)

        if (candidateOrder?.payment_mode === 'GATEWAY' && candidateOrder.tenant_id === credential.tenant_id) {
          payment = candidatePayment
          externalReference = candidateReference
          orderForToken = candidateOrder
          accessToken = candidateToken
          break
        }
      }
    }

    if (!payment && externalReference && orderForToken?.payment_mode === 'GATEWAY' && accessToken) {
      const result = await searchLatestPaymentByReference(accessToken, externalReference)
      lookupStatus = result.status
      lookupDebug.push({
        step: 'tenant_payment_search_by_external_reference',
        status: result.status,
        ok: result.ok,
        found: Boolean(result.payment),
        summary: summarizeLookupPayload(result.payload),
      })
      if (result.ok && result.payment) {
        payment = result.payment as Record<string, unknown>
      }
    }

    if (!payment && externalReference) {
      for (const credential of (credentials || [])) {
        const candidateToken = String(credential?.access_token || '').trim()
        if (!candidateToken) continue

        const result = await searchLatestPaymentByReference(candidateToken, externalReference)
        lookupStatus = result.status
        lookupDebug.push({
          step: 'credential_payment_search_by_external_reference',
          tenant_id: credential?.tenant_id || null,
          status: result.status,
          ok: result.ok,
          found: Boolean(result.payment),
          summary: summarizeLookupPayload(result.payload),
        })
        if (!result.ok || !result.payment) continue

        const candidatePayment = result.payment as Record<string, unknown>
        const candidateReference = paymentExternalReference(candidatePayment, externalReference)
        const { data: candidateOrder, error: candidateOrderError } = await supabase
          .from('online_orders')
          .select('online_order_id, tenant_id, total, payment_mode')
          .eq('online_order_id', candidateReference)
          .maybeSingle()
        if (candidateOrderError) throw new Error(`No se pudo asociar la referencia a un pedido: ${getErrorMessage(candidateOrderError)}`)

        if (candidateOrder?.payment_mode === 'GATEWAY' && candidateOrder.tenant_id === credential.tenant_id) {
          payment = candidatePayment
          externalReference = candidateReference
          orderForToken = candidateOrder
          accessToken = candidateToken
          break
        }
      }
    }

    if (!payment && preferenceId) {
      for (const credential of (credentials || [])) {
        const candidateToken = String(credential?.access_token || '').trim()
        if (!candidateToken) continue

        const result = await fetchPaymentFromPreference(candidateToken, preferenceId)
        lookupStatus = result.status
        lookupDebug.push({
          step: 'credential_merchant_order_by_preference',
          tenant_id: credential?.tenant_id || null,
          status: result.status,
          ok: result.ok,
          found: Boolean(result.payment),
          payment_id: result.payment_id || null,
          summary: summarizeLookupPayload(result.payload),
        })
        if (!result.ok || !result.payment) continue

        const candidatePayment = result.payment as Record<string, unknown>
        const candidateReference = paymentExternalReference(candidatePayment, externalReference)
        if (!candidateReference && !externalReference) continue

        if (candidateReference) {
          const { data: candidateOrder, error: candidateOrderError } = await supabase
            .from('online_orders')
            .select('online_order_id, tenant_id, total, payment_mode')
            .eq('online_order_id', candidateReference)
            .maybeSingle()
          if (candidateOrderError) throw new Error(`No se pudo asociar la preferencia a un pedido: ${getErrorMessage(candidateOrderError)}`)
          if (candidateOrder?.payment_mode === 'GATEWAY' && candidateOrder.tenant_id !== credential.tenant_id) continue
          orderForToken = candidateOrder || orderForToken
          externalReference = candidateReference
        }

        payment = candidatePayment
        accessToken = candidateToken
        break
      }
    }

    if (!payment && preferenceId && !preferenceExternalReference) {
      for (const credential of (credentials || [])) {
        const candidateToken = String(credential?.access_token || '').trim()
        if (!candidateToken) continue

        const result = await fetchPreferenceById(candidateToken, preferenceId)
        lookupStatus = result.status
        lookupDebug.push({
          step: 'credential_preference_by_id',
          tenant_id: credential?.tenant_id || null,
          status: result.status,
          ok: result.ok,
          found: Boolean(result.ok && result.payload?.id),
          summary: summarizeLookupPayload(result.payload),
        })
        if (!result.ok) continue
        preferenceExternalReference = String(result.payload?.external_reference || '').trim()
        if (preferenceExternalReference && !externalReference) externalReference = preferenceExternalReference
        break
      }
    }

    if (!payment) {
      return jsonResponse({
        error: 'No se pudo consultar el pago en Mercado Pago.',
        build_id: FUNCTION_BUILD_ID,
        payment_id: paymentId || null,
        external_reference: externalReference || null,
        preference_id: preferenceId || null,
        preference_external_reference: preferenceExternalReference || null,
        lookup_debug: lookupDebug,
      }, lookupStatus >= 400 ? lookupStatus : 404)
    }

    externalReference = paymentExternalReference(payment, externalReference)
    if (!externalReference) {
      return jsonResponse({ ok: true, ignored: 'missing_external_reference', payment_id: paymentId })
    }

    if (!orderForToken || orderForToken.online_order_id !== externalReference) {
      const { data, error } = await supabase
        .from('online_orders')
        .select('online_order_id, tenant_id, total, payment_mode')
        .eq('online_order_id', externalReference)
        .maybeSingle()
      if (error) throw new Error(`No se pudo recargar el pedido online: ${getErrorMessage(error)}`)
      orderForToken = data
    }

    if (!orderForToken || orderForToken.payment_mode !== 'GATEWAY') {
      return jsonResponse({ ok: true, ignored: 'order_not_found_or_not_gateway', payment_id: paymentId, external_reference: externalReference })
    }

    const transactionAmount = Number(payment?.transaction_amount || 0)
    const orderTotal = Number(orderForToken.total || 0)
    if (transactionAmount > 0 && orderTotal > 0 && Math.abs(transactionAmount - orderTotal) > 100) {
      return jsonResponse({
        error: 'El total del pago no coincide con el pedido online.',
        payment_id: String(payment?.id || paymentId || ''),
        external_reference: externalReference,
        transaction_amount: transactionAmount,
        order_total: orderTotal,
      }, 409)
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

    const resolvedPaymentId = String(payment?.id || paymentId || '').trim()
    const { data: syncData, error: syncError } = await supabase.rpc('fn_sync_online_gateway_payment', {
      p_online_order_id: externalReference,
      p_payment_id: resolvedPaymentId || null,
      p_gateway_status: String(payment?.status || 'pending'),
      p_payment_status_detail: String(payment?.status_detail || '').trim() || null,
      p_gateway_payload: gatewayPayload,
    })

    if (syncError) throw new Error(`No se pudo sincronizar el pago gateway: ${getErrorMessage(syncError)}`)

    let emailNotification: Record<string, unknown> | null = null
    const syncedPaymentStatus = String(syncData?.payment_status || '').toUpperCase()
    if (syncedPaymentStatus === 'PAID' || syncedPaymentStatus === 'FAILED') {
      const emailResult = await dispatchQueuedNotifications(
        supabaseUrl,
        serviceRoleKey,
      )
      emailNotification = {
        ok: emailResult.ok,
        status: emailResult.status,
        result: emailResult.payload,
      }
    }

    return jsonResponse({
      ok: true,
      build_id: FUNCTION_BUILD_ID,
      payment_id: resolvedPaymentId || null,
      external_reference: externalReference,
      status: payment?.status || null,
      result: syncData || null,
      email_notification: emailNotification,
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
