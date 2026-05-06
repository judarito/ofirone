import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUNCTION_BUILD_ID = 'subscription-provision-signup-v2'

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

function getAuthRecoveryRedirectUrl() {
  const explicitRecoveryUrl = normalizeAbsoluteUrl(Deno.env.get('OFIRONE_AUTH_RECOVERY_URL'))
  if (explicitRecoveryUrl) return explicitRecoveryUrl

  const publicAppUrl = normalizeAbsoluteUrl(
    Deno.env.get('OFIRONE_PUBLIC_APP_URL')
    || Deno.env.get('PUBLIC_APP_URL')
    || Deno.env.get('APP_URL'),
  )
  if (publicAppUrl) return `${publicAppUrl.replace(/\/+$/, '')}/login`

  return ''
}

function isAuthEmailAlreadyRegistered(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes('already been registered')
    || message.includes('already registered')
    || message.includes('already exists')
    || message.includes('email address has already')
}

function generateTemporaryPassword() {
  const random = crypto.randomUUID().replace(/-/g, '')
  return `Ofir${random.slice(0, 14)}!`
}

async function logEvent(supabase: ReturnType<typeof createClient>, params: {
  signupId: string
  type: string
  status?: string
  source?: string
  message?: string
  payload?: Record<string, unknown>
  key?: string
}) {
  await supabase.rpc('fn_log_public_subscription_signup_event', {
    p_signup_id: params.signupId,
    p_event_type: params.type,
    p_event_source: params.source || 'manual_provision',
    p_event_status: params.status || 'info',
    p_message: params.message || null,
    p_payload: params.payload || {},
    p_event_key: params.key || null,
  }).catch((error) => {
    console.warn('[subscription-provision-signup] No se pudo registrar evento', getErrorMessage(error))
  })
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

async function createSubscriptionAuthUser(params: {
  supabase: ReturnType<typeof createClient>
  signupId: string
  email: string
  fullName: string
  businessName: string
}) {
  const password = generateTemporaryPassword()
  const { data, error } = await params.supabase.auth.admin.createUser({
    email: params.email,
    password,
    email_confirm: true,
  })

  if (error) return { userId: '', error }

  const userId = String(data?.user?.id || '').trim()
  if (userId) {
    const { error: updateError } = await params.supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        full_name: params.fullName || '',
        tenant_name: params.businessName || '',
        source: 'public_subscription_signup',
      },
      app_metadata: {
        signup_id: params.signupId,
      },
    })
    if (updateError) {
      console.warn('[subscription-provision-signup] Usuario Auth creado sin metadata completa', getErrorMessage(updateError))
    }
  }

  return { userId, error: null }
}

async function sendSubscriptionWelcomeEmail(params: {
  email: string
  name: string
  businessName: string
  resetLink?: string
  resend?: boolean
}) {
  const apiKey = String(Deno.env.get('RESEND_API_KEY') || Deno.env.get('RESEND_KEY') || '').trim()
  if (!apiKey || !params.email) return { ok: false, skipped: 'missing_resend_or_email' }

  const fromEmail = String(Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev').trim()
  const fromName = String(Deno.env.get('RESEND_FROM_NAME') || 'OfirOne').replace(/[<>]/g, '').trim() || 'OfirOne'
  const html = `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
        <div style="padding:24px;background:#ecfdf5;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;">${fromName}</div>
          <h1 style="margin:8px 0 0;font-size:24px;">${params.resend ? 'Nuevo enlace de acceso' : 'Tu cuenta ya está lista'}</h1>
          <p style="margin:10px 0 0;color:#334155;line-height:1.5;">Hola ${params.name || 'equipo'}, ${params.resend ? 'generamos un nuevo enlace para ingresar a' : 'activamos'} ${params.businessName || 'tu negocio'} en OfirOne.</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0;color:#334155;line-height:1.5;">Usa el botón para crear tu contraseña e ingresar como administrador.</p>
          ${params.resetLink ? `
            <p style="margin-top:24px;">
              <a href="${params.resetLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Crear contraseña</a>
            </p>
          ` : ''}
          <p style="margin-top:18px;color:#64748b;font-size:13px;">Si no solicitaste esta cuenta, ignora este mensaje.</p>
        </div>
      </div>
    </div>
  `

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: params.email,
      subject: params.resend ? 'Nuevo enlace de acceso a OfirOne' : 'Tu cuenta de OfirOne ya está lista',
      html,
      text: `${params.resend ? 'Generamos un nuevo enlace de acceso' : 'Tu cuenta de OfirOne ya está lista'} para ${params.businessName || 'tu negocio'}. ${params.resetLink ? `Crea tu contraseña aquí: ${params.resetLink}` : ''}`,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

async function assertSuperAdmin(serviceClient: ReturnType<typeof createClient>, authHeader: string) {
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('Token de autorizacion requerido.')

  const { data: userData, error: userError } = await serviceClient.auth.getUser(token)
  if (userError || !userData?.user?.id) throw new Error('Sesion invalida.')

  const { data: appUser, error: appUserError } = await serviceClient
    .from('users')
    .select('user_id')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle()
  if (appUserError) throw appUserError
  if (appUser) throw new Error('No autorizado.')

  return userData.user
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return jsonResponse({ ok: true, function_name: 'subscription-provision-signup', build_id: FUNCTION_BUILD_ID })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    await assertSuperAdmin(serviceClient, req.headers.get('Authorization') || '')

    const body = await req.json().catch(() => ({}))
    const signupId = String(body?.signup_id || '').trim()
    const action = String(body?.action || 'provision').trim().toLowerCase()
    const note = String(body?.note || '').trim()
    if (!signupId) return jsonResponse({ error: 'signup_id es requerido.' }, 400)

    const { data: signup, error: signupError } = await serviceClient
      .from('public_subscription_signups')
      .select('signup_id, status, admin_email, admin_full_name, business_name, auth_user_id, tenant_id, user_id, paid_at, provisioned_at')
      .eq('signup_id', signupId)
      .maybeSingle()
    if (signupError) throw signupError
    if (!signup) return jsonResponse({ error: 'Solicitud no encontrada.' }, 404)

    if (action === 'cancel') {
      if (String(signup.status || '').toUpperCase() === 'PROVISIONED' || signup.tenant_id) {
        return jsonResponse({ error: 'No se puede cancelar una solicitud ya aprovisionada.' }, 409)
      }

      const message = note || 'Solicitud cancelada manualmente por SuperAdmin.'
      const { error: updateError } = await serviceClient
        .from('public_subscription_signups')
        .update({
          status: 'CANCELLED',
          error_message: message,
        })
        .eq('signup_id', signupId)
      if (updateError) throw updateError

      await logEvent(serviceClient, {
        signupId,
        type: 'signup_cancelled',
        status: 'warning',
        source: 'superadmin',
        message,
        payload: { note: message },
        key: `cancelled-${crypto.randomUUID()}`,
      })

      return jsonResponse({ success: true, action, signup_id: signupId, build_id: FUNCTION_BUILD_ID })
    }

    if (action === 'mark_reviewed') {
      const message = note || 'Solicitud revisada manualmente por SuperAdmin.'
      await logEvent(serviceClient, {
        signupId,
        type: 'signup_reviewed',
        status: 'info',
        source: 'superadmin',
        message,
        payload: { note: message },
        key: `reviewed-${crypto.randomUUID()}`,
      })

      return jsonResponse({ success: true, action, signup_id: signupId, build_id: FUNCTION_BUILD_ID })
    }

    if (action === 'resend_access') {
      if (!signup.tenant_id && String(signup.status || '').toUpperCase() !== 'PROVISIONED') {
        return jsonResponse({ error: 'Solo se puede reenviar acceso cuando la solicitud ya fue aprovisionada.' }, 409)
      }

      let resetLink = ''
      try {
        const redirectTo = getAuthRecoveryRedirectUrl()
        const { data: linkData } = await serviceClient.auth.admin.generateLink({
          type: 'recovery',
          email: String(signup.admin_email || '').trim(),
          options: redirectTo ? { redirectTo } : undefined,
        })
        const properties = (linkData?.properties || {}) as Record<string, unknown>
        resetLink = String(properties.action_link || '').trim()
      } catch (error) {
        await logEvent(serviceClient, {
          signupId,
          type: 'recovery_link_failed',
          status: 'error',
          source: 'superadmin',
          message: getErrorMessage(error),
          key: `manual-recovery-link-${crypto.randomUUID()}`,
        })
        return jsonResponse({ error: `No se pudo generar el enlace de acceso: ${getErrorMessage(error)}` }, 500)
      }

      const emailResult = await sendSubscriptionWelcomeEmail({
        email: String(signup.admin_email || '').trim(),
        name: String(signup.admin_full_name || '').trim(),
        businessName: String(signup.business_name || '').trim(),
        resetLink: resetLink || undefined,
        resend: true,
      })

      await logEvent(serviceClient, {
        signupId,
        type: 'access_email_resent',
        status: emailResult?.ok ? 'success' : 'warning',
        source: 'superadmin',
        message: emailResult?.ok ? 'Correo de acceso reenviado.' : 'No se pudo confirmar el reenvio del correo de acceso.',
        payload: emailResult || {},
        key: `access-email-resent-${crypto.randomUUID()}`,
      })

      if (!emailResult?.ok) {
        return jsonResponse({ error: 'No se pudo confirmar el envío del correo de acceso.', email: emailResult }, 502)
      }

      return jsonResponse({ success: true, action, signup_id: signupId, email: emailResult, build_id: FUNCTION_BUILD_ID })
    }

    if (action !== 'provision') {
      return jsonResponse({ error: 'Acción no soportada.' }, 400)
    }

    await logEvent(serviceClient, {
      signupId,
      type: 'manual_provision_requested',
      status: 'info',
      message: 'SuperAdmin solicito aprovisionamiento manual.',
      key: `manual-request-${crypto.randomUUID()}`,
    })

    if (!signup.paid_at && !['PAID', 'PROVISIONING', 'PROVISIONED'].includes(String(signup.status || '').toUpperCase())) {
      return jsonResponse({ error: 'La solicitud no tiene pago aprobado registrado.' }, 409)
    }

    if (signup.status === 'PROVISIONED') {
      return jsonResponse({ success: true, already_provisioned: true, signup_id: signupId, build_id: FUNCTION_BUILD_ID })
    }

    let authUserId = String(signup.auth_user_id || '').trim()
    if (!authUserId) {
      const { userId, error } = await createSubscriptionAuthUser({
        supabase: serviceClient,
        signupId,
        email: String(signup.admin_email || '').trim(),
        fullName: String(signup.admin_full_name || '').trim(),
        businessName: String(signup.business_name || '').trim(),
      })

      if (error) {
        if (isAuthEmailAlreadyRegistered(error)) {
          authUserId = await findAuthUserIdByEmail(serviceClient, String(signup.admin_email || '').trim())
        }

        if (!authUserId) {
          await logEvent(serviceClient, {
            signupId,
            type: 'auth_user_failed',
            status: 'error',
            message: getErrorMessage(error),
            key: 'auth-user',
          })
          await serviceClient.from('public_subscription_signups').update({
            status: 'FAILED',
            error_message: `No se pudo crear el usuario Auth: ${getErrorMessage(error)}`,
          }).eq('signup_id', signupId)
          return jsonResponse({ error: `No se pudo crear el usuario Auth: ${getErrorMessage(error)}` }, 409)
        }
      } else {
        authUserId = userId
      }

      await serviceClient.from('public_subscription_signups').update({ auth_user_id: authUserId }).eq('signup_id', signupId)
      await logEvent(serviceClient, {
        signupId,
        type: 'auth_user_ready',
        status: 'success',
        message: 'Usuario Auth listo para aprovisionamiento.',
        payload: { auth_user_id: authUserId },
        key: 'auth-user',
      })
    }

    const { data: existingAppUser, error: existingAppUserError } = await serviceClient
      .from('users')
      .select('user_id, tenant_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (existingAppUserError) throw existingAppUserError
    if (existingAppUser) {
      const message = 'El usuario Auth ya pertenece a un tenant existente.'
      await serviceClient.from('public_subscription_signups').update({
        status: 'FAILED',
        error_message: message,
      }).eq('signup_id', signupId)
      await logEvent(serviceClient, {
        signupId,
        type: 'app_user_conflict',
        status: 'error',
        message,
        payload: existingAppUser,
        key: 'app-user-conflict',
      })
      return jsonResponse({ error: message, existing_user: existingAppUser }, 409)
    }

    await serviceClient.from('public_subscription_signups').update({ status: 'PAID', error_message: null }).eq('signup_id', signupId)

    const { data: provisionData, error: provisionError } = await serviceClient.rpc('fn_provision_public_subscription_signup', {
      p_signup_id: signupId,
      p_auth_user_id: authUserId,
    })
    if (provisionError) throw provisionError
    if (provisionData?.success === false) {
      await logEvent(serviceClient, {
        signupId,
        type: 'tenant_provision_failed',
        status: 'error',
        message: String(provisionData?.message || 'No se pudo aprovisionar el tenant.'),
        payload: provisionData,
        key: 'tenant-provision',
      })
      return jsonResponse({ error: provisionData?.message || 'No se pudo aprovisionar el tenant.', provision: provisionData }, 409)
    }

    await logEvent(serviceClient, {
      signupId,
      type: 'tenant_provisioned',
      status: 'success',
      message: 'Tenant, usuario interno y suscripcion creados.',
      payload: provisionData || {},
      key: 'tenant-provision',
    })

    let welcomeEmail: Record<string, unknown> | null = null
    const { data: emailEvent } = await serviceClient
      .from('public_subscription_signup_events')
      .select('event_id')
      .eq('signup_id', signupId)
      .eq('event_key', 'welcome-email')
      .maybeSingle()

    if (!emailEvent) {
      let resetLink = ''
      try {
        const redirectTo = getAuthRecoveryRedirectUrl()
        const { data: linkData } = await serviceClient.auth.admin.generateLink({
          type: 'recovery',
          email: String(signup.admin_email || '').trim(),
          options: redirectTo ? { redirectTo } : undefined,
        })
        const properties = (linkData?.properties || {}) as Record<string, unknown>
        resetLink = String(properties.action_link || '').trim()
      } catch (error) {
        await logEvent(serviceClient, {
          signupId,
          type: 'recovery_link_failed',
          status: 'warning',
          message: getErrorMessage(error),
          key: 'recovery-link',
        })
      }

      welcomeEmail = await sendSubscriptionWelcomeEmail({
        email: String(signup.admin_email || '').trim(),
        name: String(signup.admin_full_name || '').trim(),
        businessName: String(signup.business_name || '').trim(),
        resetLink: resetLink || undefined,
      })
      await logEvent(serviceClient, {
        signupId,
        type: 'welcome_email_sent',
        status: welcomeEmail?.ok ? 'success' : 'warning',
        message: welcomeEmail?.ok ? 'Correo de bienvenida enviado.' : 'Correo de bienvenida omitido o no confirmado.',
        payload: welcomeEmail || {},
        key: 'welcome-email',
      })
    }

    return jsonResponse({
      success: true,
      build_id: FUNCTION_BUILD_ID,
      signup_id: signupId,
      auth_user_id: authUserId,
      provision: provisionData,
      welcome_email: welcomeEmail || { skipped: 'already_sent' },
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error), build_id: FUNCTION_BUILD_ID }, 500)
  }
})
