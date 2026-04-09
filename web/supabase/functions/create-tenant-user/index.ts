import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error('Faltan variables de entorno requeridas para la función')
    }

    const authorization = req.headers.get('Authorization') || ''
    if (!authorization) {
      return new Response(
        JSON.stringify({ error: 'Authorization header requerido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cliente "user context" para validar identidad del caller
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: authData, error: authError } = await supabaseUser.auth.getUser()
    const caller = authData?.user
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Token inválido o expirado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Super Admin = usuario auth sin perfil en public.users
    const { data: profile, error: profileError } = await supabaseUser
      .from('users')
      .select('user_id')
      .eq('auth_user_id', caller.id)
      .single()

    if (profileError && profileError.code !== 'PGRST116') {
      return new Response(
        JSON.stringify({ error: 'No se pudo validar perfil del usuario' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const isSuperAdminByProfile = !profile
    if (!isSuperAdminByProfile) {
      return new Response(
        JSON.stringify({ error: 'Solo Super Admins pueden crear usuarios de tenant' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Whitelist opcional por email (fail-closed si se define)
    const allowedEmails = parseAllowedEmails(Deno.env.get('SUPER_ADMIN_EMAILS'))
    if (allowedEmails.length > 0) {
      const callerEmail = (caller.email || '').toLowerCase()
      if (!allowedEmails.includes(callerEmail)) {
        return new Response(
          JSON.stringify({ error: 'Email no autorizado para operaciones Super Admin' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const { email, password, full_name, tenant_name } = await req.json()

    if (!email || !password || !full_name) {
      return new Response(
        JSON.stringify({ error: 'Email, password y full_name son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (String(password).length < 8) {
      return new Response(
        JSON.stringify({ error: 'La contraseña debe tener mínimo 8 caracteres' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cliente admin sólo después de validar autorización del caller
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        tenant_name: tenant_name || ''
      }
    })

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: created.user?.id,
        email: created.user?.email
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
