import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUNCTION_BUILD_ID = 'mp-create-preference-single-total-item-v2'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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

function splitFullName(value: unknown) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return { name: '', surname: '' }
  const parts = normalized.split(' ')
  if (parts.length === 1) return { name: parts[0], surname: '' }
  return {
    name: parts.slice(0, -1).join(' ') || parts[0],
    surname: parts.slice(-1).join(' '),
  }
}

function onlyDigits(value: unknown) {
  return String(value || '').replace(/\D+/g, '').trim()
}

function buildStatementDescriptor(value: unknown) {
  return String(value || 'OFIRONE')
    .trim()
    .replace(/[^a-zA-Z0-9 ]+/g, '')
    .slice(0, 13)
}

function toCopIntegerAmount(value: unknown) {
  const amount = Math.round(Number(value || 0))
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('El total del pedido no es un entero válido para Mercado Pago.')
  }
  return amount
}

function buildOrderPreferenceItem(orderId: string, orderRow: Record<string, unknown>, lineRows: Array<Record<string, unknown>>) {
  const productNames = (lineRows || [])
    .map((line) => String(line.product_name || '').trim())
    .filter(Boolean)
  const uniqueNames = [...new Set(productNames)]
  const description = uniqueNames.length > 0
    ? uniqueNames.slice(0, 3).join(', ')
    : 'Compra tienda online'

  return {
    id: orderId,
    title: `Pedido #${orderRow.order_number || ''}`.trim(),
    quantity: 1,
    unit_price: toCopIntegerAmount(orderRow.total),
    description,
    category_id: 'retail',
    currency_id: 'COP',
  }
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

    const body = await req.json().catch(() => ({}))
    const slug = String(body?.slug || '').trim()
    const origin = normalizeAbsoluteUrl(body?.origin)
    const landingReturnUrl = normalizeAbsoluteUrl(body?.landing_return_url)
    const lines = Array.isArray(body?.lines) ? body.lines : []

    if (!slug) {
      return jsonResponse({ error: 'Slug de tienda requerido.' }, 400)
    }
    if (!origin) {
      return jsonResponse({ error: 'Origin público requerido para construir el retorno.' }, 400)
    }
    if (lines.length === 0) {
      return jsonResponse({ error: 'Debes enviar al menos una línea de compra.' }, 400)
    }

    await supabase.rpc('fn_release_expired_online_orders', { p_limit: 50 })

    const { data: orderData, error: orderError } = await supabase.rpc('fn_create_online_manual_order', {
      p_slug: slug,
      p_customer_name: String(body?.customer_name || '').trim() || null,
      p_customer_email: String(body?.customer_email || '').trim() || null,
      p_customer_phone: String(body?.customer_phone || '').trim() || null,
      p_customer_note: String(body?.customer_note || '').trim() || null,
      p_payment_reference: null,
      p_landing_return_url: landingReturnUrl || null,
      p_lines: lines,
      p_payment_mode: 'GATEWAY',
      p_payment_proof_url: null,
      p_delivery_address: String(body?.delivery_address || '').trim() || null,
    })

    if (orderError) {
      return jsonResponse({ error: orderError.message || 'No se pudo crear el pedido gateway.' }, 400)
    }

    const orderId = String(orderData?.online_order_id || '').trim()
    if (!orderId) {
      throw new Error('No recibimos el id del pedido gateway.')
    }

    const [{ data: orderRow, error: orderRowError }, { data: lineRows, error: linesError }, { data: storeRow, error: storeError }] = await Promise.all([
      supabase
        .from('online_orders')
        .select('online_order_id, tenant_id, order_number, total, expires_at, customer_name, customer_email, customer_phone')
        .eq('online_order_id', orderId)
        .maybeSingle(),
      supabase
        .from('online_order_lines')
        .select('product_name, variant_name, quantity, unit_price, line_total')
        .eq('online_order_id', orderId)
        .order('created_at', { ascending: true }),
      supabase
        .from('online_stores')
        .select('brand_name')
        .eq('slug', slug)
        .maybeSingle(),
    ])

    if (orderRowError) throw orderRowError
    if (linesError) throw linesError
    if (storeError) throw storeError
    if (!orderRow) throw new Error('No se pudo recargar el pedido creado.')

    const { data: credentialRow, error: credentialError } = await supabase
      .from('tenant_gateway_credentials')
      .select('environment, public_key, access_token, is_enabled')
      .eq('tenant_id', orderRow.tenant_id)
      .eq('provider', 'MERCADO_PAGO')
      .maybeSingle()

    if (credentialError) throw credentialError
    const mercadoPagoAccessToken = String(credentialRow?.access_token || '').trim()
    if (!credentialRow?.is_enabled || !mercadoPagoAccessToken) {
      return jsonResponse({ error: 'La tienda no tiene credenciales activas de Mercado Pago.' }, 400)
    }

    const statusUrl = `${origin.replace(/\/+$/, '')}/pedido/${orderId}`
    const { name: payerName, surname: payerSurname } = splitFullName(orderRow.customer_name)
    const payerPhone = onlyDigits(orderRow.customer_phone)
    const preferenceBody = {
      items: [buildOrderPreferenceItem(orderId, orderRow, lineRows || [])],
      payer: {
        name: payerName || undefined,
        surname: payerSurname || undefined,
        email: String(orderRow.customer_email || '').trim() || undefined,
        phone: payerPhone
          ? { number: payerPhone }
          : undefined,
      },
      binary_mode: false,
      external_reference: orderId,
      statement_descriptor: buildStatementDescriptor(storeRow?.brand_name) || undefined,
      payment_methods: {
        excluded_payment_types: [],
        excluded_payment_methods: [],
        installments: 12,
      },
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook`,
      back_urls: {
        success: `${statusUrl}?mp_status=success`,
        failure: `${statusUrl}?mp_status=failure`,
        pending: `${statusUrl}?mp_status=pending`,
      },
      auto_return: 'approved',
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: orderRow.expires_at || undefined,
      metadata: {
        online_order_id: orderId,
        order_number: orderRow.order_number,
        source: 'ofirone_storefront',
      },
    }

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mercadoPagoAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': orderId,
      },
      body: JSON.stringify(preferenceBody),
    })

    const mpData = await mpResponse.json().catch(() => ({}))
    if (!mpResponse.ok) {
      return jsonResponse({
        error: 'Mercado Pago no pudo crear la preferencia.',
        build_id: FUNCTION_BUILD_ID,
        details: mpData,
        submitted_preference: {
          external_reference: preferenceBody.external_reference,
          items: preferenceBody.items,
          total: orderRow.total,
        },
        submitted_items: preferenceBody.items,
      }, mpResponse.status)
    }

    const paymentUrl = String(mpData?.init_point || mpData?.sandbox_init_point || '').trim()
    if (!paymentUrl) {
      throw new Error('Mercado Pago respondió sin URL de pago.')
    }

    const { data: attachData, error: attachError } = await supabase.rpc('fn_attach_online_gateway_preference', {
      p_online_order_id: orderId,
      p_preference_id: String(mpData?.id || '').trim() || null,
      p_init_point: String(mpData?.init_point || '').trim() || null,
      p_sandbox_init_point: String(mpData?.sandbox_init_point || '').trim() || null,
      p_external_reference: orderId,
      p_preference_expires_at: orderRow.expires_at || null,
    })

    if (attachError) {
      throw attachError
    }

    return jsonResponse({
      success: true,
      build_id: FUNCTION_BUILD_ID,
      order: {
        online_order_id: orderId,
        order_number: orderRow.order_number,
        total: Number(orderRow.total || 0),
        expires_at: orderRow.expires_at || null,
      },
      preference: {
        id: mpData?.id || null,
        init_point: mpData?.init_point || null,
        sandbox_init_point: mpData?.sandbox_init_point || null,
        payment_url: paymentUrl,
      },
      attach: attachData || null,
      status_url: statusUrl,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
