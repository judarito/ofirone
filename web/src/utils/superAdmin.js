/**
 * Helper functions para validar Super Admin
 * Se usa en router guard (no puede usar composables)
 */
import { supabase } from '@/plugins/supabase'

const normalizeEmail = (value) => String(value || '')
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .toLowerCase()

const SUPER_ADMIN_EMAILS = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(normalizeEmail)
  .filter(Boolean)

/**
 * Verifica si el usuario actual es Super Admin
 * Super Admin = Usuario autenticado pero sin registro en tabla users
 */
export const isSuperAdmin = async () => {
  try {
    // 1. Obtener usuario autenticado
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return false
    }

    // 2. Verificar si tiene perfil en tabla users enlazado por auth_user_id
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (profileError) {
      console.error('Error checking super admin profile:', profileError)
      return false
    }

    // Si no encuentra perfil = Super Admin
    if (!profile) {
      return true
    }

    // Si encontró perfil = Usuario normal con tenant
    return !profile
    
  } catch (error) {
    console.error('Error checking super admin status:', error)
    return false
  }
}

/**
 * Lista de emails específicos que pueden ser super admin (opcional)
 */
const ALLOWED_SUPER_ADMIN_EMAILS = [
  // 'admin@sistema.com',
  // 'superadmin@empresa.com'
]

/**
 * Verifica si el email del usuario está en la lista de super admins
 */
export const isSuperAdminByEmail = async () => {
  // Fail-closed: si no hay lista configurada, nadie pasa por email whitelist
  const allowed = SUPER_ADMIN_EMAILS.length > 0 ? SUPER_ADMIN_EMAILS : ALLOWED_SUPER_ADMIN_EMAILS
  if (allowed.length === 0) return false

  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return false

    return allowed.includes(normalizeEmail(user.email))
  } catch (error) {
    console.error('Error checking super admin email:', error)
    return false
  }
}

/**
 * Validación completa para acceso de gestión de tenants
 */
export const canManageTenants = async () => {
  const isSuper = await isSuperAdmin()
  const isAllowedEmail = await isSuperAdminByEmail()
  
  return isSuper && isAllowedEmail
}
