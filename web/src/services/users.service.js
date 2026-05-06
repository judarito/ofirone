import { supabase } from '@/plugins/supabase'
import { humanizeAppError } from '@/utils/appErrors'
import tenantBillingService from './tenantBilling.service'
import {
  changeTenantUserPasswordWithAuth,
  createTenantUserWithAuth,
} from '../../../shared/utils/tenantUserAdmin'
import { BILLING_LIMIT_CODES } from '../../../shared/utils/billingAccess'

/**
 * Obtener usuarios del tenant con paginación
 */
export async function getUsers(tenantId, page = 1, pageSize = 10, search = '') {
  if (!tenantId) throw new Error('Tenant ID is required')
  
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('users')
    .select(`
      user_id,
      auth_user_id,
      tenant_id,
      email,
      full_name,
      is_active,
      created_at,
      user_roles (
        role_id,
        roles (
          role_id,
          name
        )
      )
    `, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(from, to)

  // Aplicar búsqueda si existe
  if (search && search.trim()) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const { data, error, count } = await query

  if (error) {
    console.error('Error al obtener usuarios:', error)
    return { success: false, error: error.message, data: [], total: 0 }
  }

  // Transformar los roles para mejor acceso
  const users = (data || []).map(user => ({
    ...user,
    roles: user.user_roles?.map(ur => ur.roles) || []
  }))

  return { success: true, data: users, total: count || 0 }
}

/**
 * Obtener todos los usuarios del tenant (sin paginación, para dropdowns)
 */
export async function getAllUsers(tenantId) {
  if (!tenantId) throw new Error('Tenant ID is required')
  
  const { data, error } = await supabase
    .from('users')
    .select(`
      user_id,
      auth_user_id,
      tenant_id,
      email,
      full_name,
      is_active,
      created_at,
      user_roles (
        role_id,
        roles (
          role_id,
          name
        )
      )
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error al obtener usuarios:', error)
    throw error
  }

  // Transformar los roles para mejor acceso
  const users = data.map(user => ({
    ...user,
    roles: user.user_roles?.map(ur => ur.roles) || []
  }))

  return users
}

/**
 * Obtener un usuario por ID
 */
export async function getUserById(tenantId, userId) {
  if (!tenantId) throw new Error('Tenant ID is required')
  
  const { data, error } = await supabase
    .from('users')
    .select(`
      user_id,
      auth_user_id,
      tenant_id,
      email,
      full_name,
      is_active,
      created_at,
      user_roles (
        role_id,
        roles (
          role_id,
          name
        )
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .single()

  if (error) {
    console.error('Error al obtener usuario:', error)
    throw error
  }

  // Transformar los roles
  const user = {
    ...data,
    roles: data.user_roles?.map(ur => ur.roles) || []
  }

  return user
}

/**
 * Crear usuario (Supabase Auth + tabla users + roles)
 */
export async function createUser({ tenantId = null, email, password, full_name, roleIds = [], is_active = true }) {
  try {
    if (tenantId && is_active !== false) {
      const limitAccess = await tenantBillingService.ensurePlanLimit(
        tenantId,
        BILLING_LIMIT_CODES.USERS_ACTIVE,
        { limitLabel: 'usuarios activos' }
      )
      if (!limitAccess.success) {
        throw new Error(limitAccess.error)
      }
    }

    const result = await createTenantUserWithAuth(supabase, {
      tenantId,
      email,
      password,
      full_name,
      roleIds,
      is_active,
    })
    tenantBillingService.invalidateBillingCaches(tenantId)
    return result
  } catch (error) {
    console.error('Error en createUser:', error)
    throw new Error(humanizeAppError(error, { defaultMessage: 'No se pudo crear el usuario.' }))
  }
}

/**
 * Actualizar usuario
 */
export async function updateUser(tenantId, userId, { full_name, is_active, roleIds = [] }) {
  if (!tenantId) throw new Error('Tenant ID is required')
  
  try {
    // 1. Actualizar datos del usuario
    const { error: updateError } = await supabase
      .from('users')
      .update({
        full_name,
        is_active
      })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)

    if (updateError) {
      console.error('Error al actualizar usuario:', updateError)
      throw updateError
    }

    // 2. Verificar que los roleIds pertenezcan al tenant
    if (roleIds.length > 0) {
      const { data: validRoles, error: rolesCheckError } = await supabase
        .from('roles')
        .select('role_id')
        .eq('tenant_id', tenantId)
        .in('role_id', roleIds)
      
      if (rolesCheckError) throw rolesCheckError
      if (validRoles.length !== roleIds.length) {
        throw new Error('Some roles do not belong to this tenant')
      }
    }

    // 3. Actualizar roles - eliminar roles existentes
    const { error: deleteRolesError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (deleteRolesError) {
      console.error('Error al eliminar roles:', deleteRolesError)
      throw deleteRolesError
    }

    // 4. Insertar nuevos roles
    if (roleIds.length > 0) {
      const userRoles = roleIds.map(roleId => ({
        user_id: userId,
        role_id: roleId
      }))

      const { error: insertRolesError } = await supabase
        .from('user_roles')
        .insert(userRoles)

      if (insertRolesError) {
        console.error('Error al insertar roles:', insertRolesError)
        throw insertRolesError
      }
    }

    tenantBillingService.invalidateBillingCaches(tenantId)
    return { success: true }
  } catch (error) {
    console.error('Error en updateUser:', error)
    throw error
  }
}

/**
 * Eliminar usuario (soft delete)
 */
export async function deleteUser(tenantId, userId) {
  if (!tenantId) throw new Error('Tenant ID is required')
  
  const { error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)

  if (error) {
    console.error('Error al desactivar usuario:', error)
    throw error
  }

  tenantBillingService.invalidateBillingCaches(tenantId)
  return { success: true }
}

/**
 * Cambiar contraseña de un usuario
 */
export async function changeUserPassword(authUserId, newPassword, tenantId = null) {
  try {
    return await changeTenantUserPasswordWithAuth(supabase, {
      tenantId,
      authUserId,
      newPassword,
    })
  } catch (error) {
    console.error('Error en changeUserPassword:', error)
    throw new Error(humanizeAppError(error, { defaultMessage: 'No se pudo cambiar la contraseña.' }))
  }
}

/**
 * Obtener todos los roles disponibles
 */
export async function getRoles(tenantId) {
  if (!tenantId) throw new Error('Tenant ID is required')
  
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name')

  if (error) {
    console.error('Error al obtener roles:', error)
    throw error
  }

  return data
}
