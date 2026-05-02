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

function maskToken(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.length <= 8) return `${raw.slice(0, 2)}****${raw.slice(-2)}`
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authorization = req.headers.get('Authorization') || ''
    if (!authorization) {
      return jsonResponse({ error: 'Authorization header requerido' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error('Faltan variables SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY')
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: authData, error: authError } = await authClient.auth.getUser()
    if (authError || !authData?.user) {
      return jsonResponse({ error: 'Token de usuario inválido o expirado' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const tenantId = String(body?.tenant_id || '').trim()
    const action = String(body?.action || 'get').trim().toLowerCase()

    if (!tenantId) {
      return jsonResponse({ error: 'tenant_id es requerido' }, 400)
    }

    const { data: appUser, error: appUserError } = await adminClient
      .from('users')
      .select('user_id, tenant_id, is_active')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle()

    if (appUserError) throw appUserError
    if (!appUser || appUser.is_active === false || appUser.tenant_id !== tenantId) {
      return jsonResponse({ error: 'No tienes acceso para administrar esta tienda.' }, 403)
    }

    if (action === 'get') {
      const { data, error } = await adminClient
        .from('tenant_gateway_credentials')
        .select('tenant_id, provider, environment, public_key, access_token, account_email, is_enabled, metadata, updated_at')
        .eq('tenant_id', tenantId)
        .eq('provider', 'MERCADO_PAGO')
        .maybeSingle()

      if (error) throw error

      return jsonResponse({
        success: true,
        data: {
          tenant_id: tenantId,
          provider: 'MERCADO_PAGO',
          environment: data?.environment || 'sandbox',
          public_key: data?.public_key || '',
          account_email: data?.account_email || '',
          is_enabled: data?.is_enabled === true,
          has_access_token: Boolean(String(data?.access_token || '').trim()),
          access_token_hint: maskToken(data?.access_token),
          updated_at: data?.updated_at || null,
        },
      })
    }

    if (action !== 'save') {
      return jsonResponse({ error: 'Acción no soportada.' }, 400)
    }

    const environment = ['sandbox', 'production'].includes(String(body?.environment || '').trim().toLowerCase())
      ? String(body.environment).trim().toLowerCase()
      : 'sandbox'
    const publicKey = String(body?.public_key || '').trim()
    const accessToken = String(body?.access_token || '').trim()
    const accountEmail = String(body?.account_email || '').trim()
    const isEnabled = body?.is_enabled === true
    const clearAccessToken = body?.clear_access_token === true

    const { data: existing, error: existingError } = await adminClient
      .from('tenant_gateway_credentials')
      .select('gateway_credential_id, access_token')
      .eq('tenant_id', tenantId)
      .eq('provider', 'MERCADO_PAGO')
      .maybeSingle()

    if (existingError) throw existingError

    const payload = {
      tenant_id: tenantId,
      provider: 'MERCADO_PAGO',
      environment,
      public_key: publicKey || null,
      account_email: accountEmail || null,
      is_enabled: isEnabled,
      updated_by_auth_user_id: authData.user.id,
      access_token: clearAccessToken
        ? null
        : (accessToken || existing?.access_token || null),
    }

    const { data: savedRows, error: saveError } = await adminClient
      .from('tenant_gateway_credentials')
      .upsert(payload, { onConflict: 'tenant_id,provider' })
      .select('tenant_id, provider, environment, public_key, access_token, account_email, is_enabled, updated_at')

    if (saveError) throw saveError

    const saved = Array.isArray(savedRows) ? savedRows[0] : null
    return jsonResponse({
      success: true,
      data: {
        tenant_id: tenantId,
        provider: 'MERCADO_PAGO',
        environment: saved?.environment || environment,
        public_key: saved?.public_key || '',
        account_email: saved?.account_email || '',
        is_enabled: saved?.is_enabled === true,
        has_access_token: Boolean(String(saved?.access_token || '').trim()),
        access_token_hint: maskToken(saved?.access_token),
        updated_at: saved?.updated_at || null,
      },
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
