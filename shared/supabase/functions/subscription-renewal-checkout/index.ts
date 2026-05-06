import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUNCTION_BUILD_ID = 'subscription-renewal-checkout-v1'

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
  }
  return String(error || 'Error desconocido')
}

function normalizeAbsoluteUrl(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol)) return ''
    return url.toString()
  } catch (_error) {
    return ''
  }
}

function toCopIntegerAmount(value: unknown) {
  const amount = Math.round(Number(value || 0))
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('El total de renovacion no es valido para Mercado Pago.')
  }
  return amount
}

function getMercadoPagoAccessToken() {
  return String(
    Deno.env.get('OFIRONE_MP_ACCESS_TOKEN')
    || Deno.env.get('SUBSCRIPTION_MP_ACCESS_TOKEN')
    || Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN')
    || Deno.env.get('MP_ACCESS_TOKEN')
    || '',
  ).trim()
}

async function assertAuthenticated(serviceClient: ReturnType<typeof createClient>, authHeader: string) {
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('Token de autorizacion requerido.')

  const { data, error } = await serviceClient.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error('Sesion invalida.')
  return data.user
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return jsonResponse({ ok: true, function_name: 'subscription-renewal-checkout', build_id: FUNCTION_BUILD_ID })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const mercadoPagoAccessToken = getMercadoPagoAccessToken()

    if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
    if (!mercadoPagoAccessToken) throw new Error('Falta configurar OFIRONE_MP_ACCESS_TOKEN para cobrar renovaciones.')

    const body = await req.json().catch(() => ({}))
    const origin = normalizeAbsoluteUrl(body?.origin)
    const subscriptionId = String(body?.subscription_id || '').trim()
    if (!origin) return jsonResponse({ error: 'Origin publico requerido para construir el retorno.' }, 400)
    if (!subscriptionId) return jsonResponse({ error: 'subscription_id es requerido.' }, 400)

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const authUser = await assertAuthenticated(serviceClient, req.headers.get('Authorization') || '')

    const { data: subscriptionRow, error: subscriptionError } = await serviceClient
      .from('tenant_subscriptions')
      .select('subscription_id, tenant_id')
      .eq('subscription_id', subscriptionId)
      .maybeSingle()
    if (subscriptionError) throw subscriptionError
    if (!subscriptionRow) return jsonResponse({ error: 'Suscripcion no encontrada.' }, 404)

    const { data: appUser, error: appUserError } = await serviceClient
      .from('users')
      .select('user_id, tenant_id')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()
    if (appUserError) throw appUserError
    if (appUser && String(appUser.tenant_id) !== String(subscriptionRow.tenant_id)) {
      return jsonResponse({ error: 'No autorizado para renovar esta suscripcion.' }, 403)
    }

    const { data: invoiceResult, error: invoiceError } = await serviceClient.rpc('fn_create_tenant_subscription_renewal_invoice', {
      p_subscription_id: subscriptionId,
      p_due_at: null,
    })
    if (invoiceError) throw invoiceError
    if (invoiceResult?.success === false) {
      return jsonResponse({ error: invoiceResult?.message || 'No se pudo crear la factura de renovacion.', details: invoiceResult }, 409)
    }

    const invoice = invoiceResult?.invoice || {}
    const subscription = invoiceResult?.subscription || {}
    const invoiceId = String(invoice.invoice_id || '').trim()
    const total = toCopIntegerAmount(invoice.total)
    const externalReference = `subscription_renewal:${invoiceId}`
    const statusUrl = `${origin.replace(/\/+$/, '')}/tenant-config?tab=billing`

    const preferenceBody = {
      items: [
        {
          id: invoiceId,
          title: 'Renovacion OfirOne',
          quantity: 1,
          unit_price: total,
          description: `Renovacion de suscripcion ${String(subscription.subscription_id || subscriptionId).slice(0, 8)}`,
          category_id: 'services',
          currency_id: invoice.currency_code || 'COP',
        },
      ],
      binary_mode: false,
      external_reference: externalReference,
      statement_descriptor: 'OFIRONE',
      notification_url: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/mercadopago-webhook`,
      back_urls: {
        success: `${statusUrl}&renewal_status=success&invoice_id=${invoiceId}`,
        failure: `${statusUrl}&renewal_status=failure&invoice_id=${invoiceId}`,
        pending: `${statusUrl}&renewal_status=pending&invoice_id=${invoiceId}`,
      },
      auto_return: 'approved',
      metadata: {
        source: 'ofirone_subscription_renewal',
        invoice_id: invoiceId,
        subscription_id: subscriptionId,
      },
    }

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mercadoPagoAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': invoiceId,
      },
      body: JSON.stringify(preferenceBody),
    })

    const mpData = await mpResponse.json().catch(() => ({}))
    if (!mpResponse.ok) {
      return jsonResponse({
        error: 'Mercado Pago no pudo crear la preferencia de renovacion.',
        build_id: FUNCTION_BUILD_ID,
        details: mpData,
      }, mpResponse.status)
    }

    const paymentUrl = String(mpData?.init_point || mpData?.sandbox_init_point || '').trim()
    if (!paymentUrl) throw new Error('Mercado Pago respondio sin URL de pago.')

    await serviceClient
      .from('tenant_invoices')
      .update({
        metadata: {
          ...(invoice.metadata || {}),
          preference_id: mpData?.id || null,
          init_point: mpData?.init_point || null,
          sandbox_init_point: mpData?.sandbox_init_point || null,
        },
      })
      .eq('invoice_id', invoiceId)

    return jsonResponse({
      success: true,
      build_id: FUNCTION_BUILD_ID,
      invoice_id: invoiceId,
      preference_id: mpData?.id || null,
      payment_url: paymentUrl,
      init_point: mpData?.init_point || null,
      sandbox_init_point: mpData?.sandbox_init_point || null,
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error), build_id: FUNCTION_BUILD_ID }, 500)
  }
})
