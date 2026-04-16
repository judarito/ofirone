export const TENANT_USER_ADMIN_EDGE_FUNCTION = 'create-tenant-user'

function getFunctionsClient(supabaseClient) {
  const functionsClient = supabaseClient?.functions
  if (!functionsClient || typeof functionsClient.invoke !== 'function') {
    throw new Error('Supabase client sin soporte para Edge Functions.')
  }
  return functionsClient
}

async function extractEdgeFunctionError(error) {
  if (!error) return ''

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json()
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error.trim()
      }
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim()
      }
    } catch (_jsonError) {
      // no-op
    }

    try {
      const text = await response.clone().text()
      if (String(text || '').trim()) return String(text).trim()
    } catch (_textError) {
      // no-op
    }
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }

  return ''
}

async function invokeTenantUserAdmin(supabaseClient, payload) {
  const functionsClient = getFunctionsClient(supabaseClient)
  const { data, error } = await functionsClient.invoke(TENANT_USER_ADMIN_EDGE_FUNCTION, {
    body: payload,
  })

  if (error) {
    const message = await extractEdgeFunctionError(error)
    throw new Error(message || 'No fue posible completar la operación de usuarios.')
  }
  if (!data?.success) {
    throw new Error(data?.error || 'No fue posible completar la operación de usuarios.')
  }

  return data
}

export async function createTenantUserWithAuth(supabaseClient, {
  tenantId = null,
  email,
  password,
  full_name,
  roleIds = [],
  is_active = true,
} = {}) {
  return invokeTenantUserAdmin(supabaseClient, {
    action: 'create_user',
    tenant_id: tenantId || null,
    email: String(email || '').trim(),
    password: String(password || ''),
    full_name: String(full_name || '').trim(),
    role_ids: Array.isArray(roleIds) ? roleIds : [],
    is_active: is_active !== false,
  })
}

export async function changeTenantUserPasswordWithAuth(supabaseClient, {
  tenantId = null,
  authUserId,
  newPassword,
} = {}) {
  return invokeTenantUserAdmin(supabaseClient, {
    action: 'change_password',
    tenant_id: tenantId || null,
    auth_user_id: String(authUserId || '').trim() || null,
    new_password: String(newPassword || ''),
  })
}
