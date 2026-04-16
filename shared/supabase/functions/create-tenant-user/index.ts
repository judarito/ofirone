import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MANAGE_USER_ROLES = new Set(['ADMINISTRADOR', 'GERENTE'])

class HttpError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function httpError(message: string, status = 400) {
  return new HttpError(message, status)
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

function normalizeRoleIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
    : []
}

function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

function isMissingRowError(error: { code?: string } | null) {
  return error?.code === 'PGRST116'
}

async function resolveCallerContext(supabaseAdmin: ReturnType<typeof createClient>, callerId: string) {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('user_id, tenant_id, email, full_name')
    .eq('auth_user_id', callerId)
    .maybeSingle()

  if (profileError && !isMissingRowError(profileError)) {
    throw new Error('No se pudo validar el perfil del usuario actual.')
  }

  if (!profile) {
    return {
      isSuperAdmin: true,
      tenantId: null,
      userId: null,
      roleNames: [] as string[],
    }
  }

  const { data: roleRows, error: rolesError } = await supabaseAdmin
    .from('user_roles')
    .select('roles:role_id(name)')
    .eq('user_id', profile.user_id)

  if (rolesError) {
    throw new Error('No se pudieron validar los roles del usuario actual.')
  }

  const roleNames = (roleRows || [])
    .map((row: any) => normalizeText(row?.roles?.name).toUpperCase())
    .filter(Boolean)

  return {
    isSuperAdmin: false,
    tenantId: profile.tenant_id as string,
    userId: profile.user_id as string,
    roleNames,
  }
}

function ensureCallerCanManageUsers(context: {
  isSuperAdmin: boolean
  roleNames: string[]
}) {
  if (context.isSuperAdmin) return
  const canManage = context.roleNames.some((roleName) => MANAGE_USER_ROLES.has(roleName))
  if (!canManage) {
    throw new Error('Solo ADMINISTRADOR o GERENTE pueden gestionar usuarios del tenant.')
  }
}

function resolveTargetTenantId(requestedTenantId: string | null, context: {
  isSuperAdmin: boolean
  tenantId: string | null
}) {
  if (context.isSuperAdmin) {
    if (!requestedTenantId) {
      throw new Error('tenant_id es requerido para operaciones de Super Admin.')
    }
    return requestedTenantId
  }

  if (requestedTenantId && requestedTenantId !== context.tenantId) {
    throw new Error('No puedes operar usuarios de otro tenant.')
  }

  if (!context.tenantId) {
    throw new Error('No se pudo determinar el tenant del usuario actual.')
  }

  return context.tenantId
}

async function getExistingTenantUserByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  tenantId: string,
  email: string,
) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('user_id, auth_user_id, email, full_name, is_active')
    .eq('tenant_id', tenantId)
    .ilike('email', email)
    .maybeSingle()

  if (error && !isMissingRowError(error)) {
    throw new Error('No se pudo validar si el email ya existe en el tenant.')
  }

  return data
}

async function authUserExists(
  supabaseAdmin: ReturnType<typeof createClient>,
  authUserId: string | null,
) {
  if (!authUserId) return false
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId)
  return Boolean(data?.user) && !error
}

function mapCreateAuthErrorMessage(message: string | undefined) {
  const normalizedMessage = normalizeText(message).toLowerCase()
  if (
    normalizedMessage.includes('already been registered') ||
    normalizedMessage.includes('already registered') ||
    normalizedMessage.includes('already exists')
  ) {
    return 'El email ya existe en Supabase Auth para este proyecto.'
  }

  return normalizeText(message) || 'No se pudo crear el usuario en Supabase Auth.'
}

async function validateRoleIds(
  supabaseAdmin: ReturnType<typeof createClient>,
  tenantId: string,
  roleIds: string[],
) {
  if (roleIds.length === 0) {
    throw httpError('Debes asignar al menos un rol.', 400)
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('role_id')
    .eq('tenant_id', tenantId)
    .in('role_id', roleIds)

  if (error) {
    throw httpError('No se pudieron validar los roles seleccionados.', 500)
  }

  if ((data || []).length !== roleIds.length) {
    throw httpError('Uno o más roles no pertenecen al tenant actual.', 400)
  }
}

async function replaceUserRoles(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  roleIds: string[],
) {
  const { error: deleteError } = await supabaseAdmin
    .from('user_roles')
    .delete()
    .eq('user_id', userId)

  if (deleteError) {
    throw new Error('No se pudieron limpiar los roles anteriores del usuario.')
  }

  if (roleIds.length === 0) return

  const rows = roleIds.map((roleId) => ({ user_id: userId, role_id: roleId }))
  const { error: insertError } = await supabaseAdmin
    .from('user_roles')
    .insert(rows)

  if (insertError) {
    throw new Error('No se pudieron asignar los roles del usuario.')
  }
}

async function handleCreateUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  context: { isSuperAdmin: boolean; tenantId: string | null; roleNames: string[] },
) {
  ensureCallerCanManageUsers(context)

  const tenantId = resolveTargetTenantId(normalizeText(payload.tenant_id) || null, context)
  const email = normalizeEmail(payload.email)
  const password = String(payload.password || '')
  const fullName = normalizeText(payload.full_name)
  const roleIds = normalizeRoleIds(payload.role_ids)
  const isActive = payload.is_active !== false

  if (!email || !password || !fullName) {
    throw new Error('Email, password y full_name son requeridos.')
  }

  if (password.length < 6) {
    throw new Error('La contraseña debe tener mínimo 6 caracteres.')
  }

  await validateRoleIds(supabaseAdmin, tenantId, roleIds)

  const existingUser = await getExistingTenantUserByEmail(supabaseAdmin, tenantId, email)
  const existingRoles = existingUser?.user_id
    ? await supabaseAdmin
        .from('user_roles')
        .select('role_id')
        .eq('user_id', existingUser.user_id)
    : { data: [], error: null }

  if (existingRoles.error) {
    throw new Error('No se pudieron leer los roles actuales del usuario.')
  }

  const previousRoleIds = (existingRoles.data || []).map((row: any) => row.role_id)
  const hadRealAuthUser = await authUserExists(supabaseAdmin, existingUser?.auth_user_id || null)
  if (existingUser && hadRealAuthUser) {
    throw new Error('El email ya está registrado en este tenant.')
  }

  const { data: createdAuth, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      tenant_id: tenantId,
    },
  })

  if (createAuthError || !createdAuth?.user?.id) {
    throw new Error(mapCreateAuthErrorMessage(createAuthError?.message))
  }

  const authUserId = createdAuth.user.id
  const previousAuthUserId = existingUser?.auth_user_id || null
  let userId = existingUser?.user_id || null

  try {
    if (existingUser) {
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({
          auth_user_id: authUserId,
          email,
          full_name: fullName,
          is_active: isActive,
        })
        .eq('user_id', existingUser.user_id)
        .eq('tenant_id', tenantId)

      if (updateError) {
        throw new Error('No se pudo vincular el usuario legado con Supabase Auth.')
      }
    } else {
      const { data: insertedUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          auth_user_id: authUserId,
          tenant_id: tenantId,
          email,
          full_name: fullName,
          is_active: isActive,
        })
        .select('user_id')
        .single()

      if (insertError || !insertedUser?.user_id) {
        throw new Error('No se pudo registrar el usuario en la tabla pública.')
      }

      userId = insertedUser.user_id as string
    }

    await replaceUserRoles(supabaseAdmin, userId as string, roleIds)

    return {
      success: true,
      user_id: userId,
      auth_user_id: authUserId,
      email,
      repaired_legacy_user: Boolean(existingUser),
      message: existingUser
        ? 'Usuario legado reparado y vinculado a Supabase Auth.'
        : 'Usuario creado exitosamente.',
    }
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => null)

    if (existingUser) {
      try {
        await supabaseAdmin
          .from('users')
          .update({
            auth_user_id: previousAuthUserId,
            email: normalizeEmail(existingUser.email),
            full_name: normalizeText(existingUser.full_name),
            is_active: existingUser.is_active !== false,
          })
          .eq('user_id', existingUser.user_id)
          .eq('tenant_id', tenantId)
      } catch (_rollbackError) {
        // no-op
      }

      try {
        await replaceUserRoles(supabaseAdmin, existingUser.user_id, previousRoleIds)
      } catch (_rollbackError) {
        // no-op
      }
    } else if (userId) {
      try {
        await supabaseAdmin
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
      } catch (_cleanupError) {
        // no-op
      }

      try {
        await supabaseAdmin
          .from('users')
          .delete()
          .eq('user_id', userId)
          .eq('tenant_id', tenantId)
      } catch (_cleanupError) {
        // no-op
      }
    }

    throw error
  }
}

async function handleChangePassword(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  context: { isSuperAdmin: boolean; tenantId: string | null; roleNames: string[] },
) {
  ensureCallerCanManageUsers(context)

  const requestedTenantId = normalizeText(payload.tenant_id) || null
  const authUserId = normalizeText(payload.auth_user_id)
  const newPassword = String(payload.new_password || '')

  if (!authUserId || !newPassword) {
    throw httpError('auth_user_id y new_password son requeridos.', 400)
  }

  if (newPassword.length < 6) {
    throw httpError('La contraseña debe tener mínimo 6 caracteres.', 400)
  }

  const { data: targetUser, error: targetUserError } = await supabaseAdmin
    .from('users')
    .select('user_id, tenant_id, auth_user_id, email, full_name, is_active')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (targetUserError && !isMissingRowError(targetUserError)) {
    throw httpError('No se pudo validar el usuario objetivo.', 500)
  }

  if (!targetUser) {
    throw httpError('Usuario no encontrado para cambio de contraseña.', 404)
  }

  const targetTenantId = targetUser.tenant_id as string
  if (context.isSuperAdmin) {
    if (requestedTenantId && requestedTenantId !== targetTenantId) {
      throw httpError('tenant_id no coincide con el usuario objetivo.', 400)
    }
  } else if (context.tenantId !== targetTenantId) {
    throw httpError('No puedes cambiar la contraseña de usuarios de otro tenant.', 403)
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(authUserId)
  let effectiveAuthUserId = authUserId
  if (authError || !authData?.user) {
    const { data: repairedAuth, error: repairedAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizeEmail(targetUser.email),
      password: newPassword,
      email_confirm: true,
      user_metadata: {
        full_name: normalizeText(targetUser.full_name),
        tenant_id: targetTenantId,
      },
    })

    if (repairedAuthError || !repairedAuth?.user?.id) {
      throw httpError(
        repairedAuthError?.message
          ? mapCreateAuthErrorMessage(repairedAuthError.message)
          : 'El usuario no existe en Supabase Auth y no se pudo reparar automáticamente.',
        409,
      )
    }

    effectiveAuthUserId = repairedAuth.user.id

    const { error: repairPublicUserError } = await supabaseAdmin
      .from('users')
      .update({
        auth_user_id: effectiveAuthUserId,
        email: normalizeEmail(targetUser.email),
      })
      .eq('user_id', targetUser.user_id)
      .eq('tenant_id', targetTenantId)

    if (repairPublicUserError) {
      await supabaseAdmin.auth.admin.deleteUser(effectiveAuthUserId).catch(() => null)
      throw httpError('No se pudo reparar la vinculación del usuario con Supabase Auth.', 500)
    }
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(effectiveAuthUserId, {
    password: newPassword,
  })

  if (updateError) {
    throw httpError(updateError.message || 'No se pudo actualizar la contraseña en Supabase Auth.', 400)
  }

  return {
    success: true,
    auth_user_id: effectiveAuthUserId,
    email: normalizeEmail(targetUser.email),
    repaired_legacy_user: effectiveAuthUserId !== authUserId,
    message: effectiveAuthUserId !== authUserId
      ? 'Usuario legado reparado y contraseña actualizada exitosamente.'
      : 'Contraseña actualizada exitosamente.',
  }
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
      throw httpError('Faltan variables de entorno requeridas para la función.', 500)
    }

    const authorization = req.headers.get('Authorization') || ''
    if (!authorization) {
      return jsonResponse({ error: 'Authorization header requerido.' }, 401)
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: authData, error: authError } = await supabaseUser.auth.getUser()
    const caller = authData?.user
    if (authError || !caller) {
      return jsonResponse({ error: 'Token inválido o expirado.' }, 401)
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const callerContext = await resolveCallerContext(supabaseAdmin, caller.id)
    if (callerContext.isSuperAdmin) {
      const allowedEmails = parseAllowedEmails(Deno.env.get('SUPER_ADMIN_EMAILS'))
      if (allowedEmails.length > 0) {
        const callerEmail = normalizeEmail(caller.email)
        if (!allowedEmails.includes(callerEmail)) {
          return jsonResponse({ error: 'Email no autorizado para operaciones Super Admin.' }, 403)
        }
      }
    }

    const payload = await req.json().catch(() => ({}))
    const action = normalizeText(payload.action || 'create_user').toLowerCase()

    if (action === 'change_password') {
      const result = await handleChangePassword(supabaseAdmin, payload, callerContext)
      return jsonResponse(result)
    }

    if (action === 'create_user') {
      const result = await handleCreateUser(supabaseAdmin, payload, callerContext)
      return jsonResponse(result)
    }

    return jsonResponse({ error: `Acción no soportada: ${action}` }, 400)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return jsonResponse({ error: error.message || 'Unexpected error' }, status)
  }
})
