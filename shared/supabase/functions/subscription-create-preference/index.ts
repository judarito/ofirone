import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUNCTION_BUILD_ID = 'subscription-create-preference-v1'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = String(record.message || record.error || record.details || record.hint || '').trim()
    if (message) return message
  }
  return String(error || 'Error desconocido')
}

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

function toCopIntegerAmount(value: unknown) {
  const amount = Math.round(Number(value || 0))
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('El total de la suscripcion no es valido para Mercado Pago.')
  }
  return amount
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

async function findAuthUserIdByEmail(supabase: ReturnType<typeof createClient>, email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return ''

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error

    const users = data?.users || []
    const found = users.find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail)
    if (found?.id) return String(found.id)
    if (users.length < 1000) break
  }

  return ''
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return jsonResponse({
      ok: true,
      function_name: 'subscription-create-preference',
      build_id: FUNCTION_BUILD_ID,
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const mercadoPagoAccessToken = getMercadoPagoAccessToken()

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
    }
    if (!mercadoPagoAccessToken) {
      throw new Error('Falta configurar OFIRONE_MP_ACCESS_TOKEN para cobrar suscripciones.')
    }

    const body = await req.json().catch(() => ({}))
    const origin = normalizeAbsoluteUrl(body?.origin)
    if (!origin) {
      return jsonResponse({ error: 'Origin publico requerido para construir el retorno.' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const adminEmail = String(body?.admin_email || '').trim().toLowerCase()
    const existingAuthUserId = await findAuthUserIdByEmail(supabase, adminEmail).catch((error) => {
      throw new Error(`No se pudo validar el email en Supabase Auth: ${getErrorMessage(error)}`)
    })
    if (existingAuthUserId) {
      return jsonResponse({
        error: 'Este email ya existe en OfirOne. Usa otro email administrador o inicia sesion con la cuenta existente.',
        code: 'AUTH_EMAIL_ALREADY_EXISTS',
      }, 409)
    }

    const { data: signupResult, error: signupError } = await supabase.rpc('fn_create_public_subscription_signup', {
      p_plan_price_id: String(body?.plan_price_id || '').trim() || null,
      p_business_name: String(body?.business_name || '').trim(),
      p_admin_full_name: String(body?.admin_full_name || '').trim(),
      p_admin_email: adminEmail,
      p_phone: String(body?.phone || '').trim() || null,
      p_legal_name: String(body?.legal_name || '').trim() || null,
      p_tax_id: String(body?.tax_id || '').trim() || null,
      p_address: String(body?.address || '').trim() || null,
    })

    if (signupError) {
      return jsonResponse({ error: signupError.message || 'No se pudo crear la solicitud.' }, 400)
    }
    if (!signupResult?.success) {
      return jsonResponse({ error: signupResult?.message || 'No se pudo crear la solicitud.', details: signupResult }, 400)
    }

    const signup = signupResult.signup || {}
    const signupId = String(signup.signup_id || '').trim()
    const total = toCopIntegerAmount(signup.total)
    const statusUrl = `${origin.replace(/\/+$/, '')}/suscripcion/estado/${signupId}`
    const externalReference = `subscription_signup:${signupId}`
    const { name, surname } = splitFullName(signup.admin_full_name)

    const preferenceBody = {
      items: [
        {
          id: signupId,
          title: `OfirOne ${signup.plan_name || 'Suscripcion'}`,
          quantity: 1,
          unit_price: total,
          description: `Primer periodo ${signup.billing_interval || 'monthly'} para ${signup.business_name || 'tenant'}`,
          category_id: 'services',
          currency_id: signup.currency_code || 'COP',
        },
      ],
      payer: {
        name: name || undefined,
        surname: surname || undefined,
        email: String(signup.admin_email || '').trim() || undefined,
      },
      binary_mode: false,
      external_reference: externalReference,
      statement_descriptor: 'OFIRONE',
      notification_url: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/mercadopago-webhook`,
      back_urls: {
        success: `${statusUrl}?mp_status=success`,
        failure: `${statusUrl}?mp_status=failure`,
        pending: `${statusUrl}?mp_status=pending`,
      },
      auto_return: 'approved',
      metadata: {
        source: 'ofirone_subscription_signup',
        signup_id: signupId,
        plan_code: signup.plan_code || null,
      },
    }

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mercadoPagoAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': signupId,
      },
      body: JSON.stringify(preferenceBody),
    })

    const mpData = await mpResponse.json().catch(() => ({}))
    if (!mpResponse.ok) {
      return jsonResponse({
        error: 'Mercado Pago no pudo crear la preferencia de suscripcion.',
        build_id: FUNCTION_BUILD_ID,
        details: mpData,
        submitted_preference: {
          external_reference: externalReference,
          items: preferenceBody.items,
        },
      }, mpResponse.status)
    }

    const paymentUrl = String(mpData?.init_point || mpData?.sandbox_init_point || '').trim()
    if (!paymentUrl) {
      throw new Error('Mercado Pago respondio sin URL de pago.')
    }

    const { data: attachData, error: attachError } = await supabase.rpc('fn_attach_subscription_signup_preference', {
      p_signup_id: signupId,
      p_preference_id: String(mpData?.id || '').trim() || null,
      p_payment_payload: {
        preference_id: mpData?.id || null,
        init_point: mpData?.init_point || null,
        sandbox_init_point: mpData?.sandbox_init_point || null,
        payment_url: paymentUrl,
      },
    })

    if (attachError) throw attachError
    if (attachData?.success === false) {
      throw new Error(String(attachData?.message || 'No se pudo guardar la preferencia.'))
    }

    return jsonResponse({
      success: true,
      build_id: FUNCTION_BUILD_ID,
      signup: {
        signup_id: signupId,
        status: signup.status,
        plan_name: signup.plan_name,
        total,
      },
      preference: {
        id: mpData?.id || null,
        init_point: mpData?.init_point || null,
        sandbox_init_point: mpData?.sandbox_init_point || null,
        payment_url: paymentUrl,
      },
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
