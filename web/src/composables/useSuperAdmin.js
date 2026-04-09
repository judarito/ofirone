/**
 * Composable para gestión de Super Admin
 * Super Admin = Usuario en auth.users pero NO en tabla users (sin tenant)
 */
import { computed, ref, watch } from 'vue'
import { useAuth } from './useAuth'
import { useTenant } from './useTenant'
import { supabase } from '@/plugins/supabase'

const normalizeEmail = (value) => String(value || '')
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .toLowerCase()

const SUPER_ADMIN_EMAILS = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(normalizeEmail)
  .filter(Boolean)

const resolvedAuthUser = ref(null)
const resolvedHasProfile = ref(false)
const resolvedCanManageTenants = ref(false)
const resolvingSuperAdmin = ref(false)
let pendingResolution = null

async function resolveSuperAdminState() {
  if (pendingResolution) {
    return pendingResolution
  }

  resolvingSuperAdmin.value = true
  pendingResolution = (async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        resolvedAuthUser.value = null
        resolvedHasProfile.value = false
        resolvedCanManageTenants.value = false
        return
      }

      const allowedEmails = SUPER_ADMIN_EMAILS
      const normalizedEmail = normalizeEmail(user.email)

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (profileError) {
        console.error('Error resolving super admin state:', profileError)
      }

      resolvedAuthUser.value = user
      resolvedHasProfile.value = !!profile
      resolvedCanManageTenants.value = !profile && allowedEmails.includes(normalizedEmail)
    } catch (error) {
      console.error('Error resolving super admin state:', error)
      resolvedAuthUser.value = null
      resolvedHasProfile.value = false
      resolvedCanManageTenants.value = false
    } finally {
      resolvingSuperAdmin.value = false
      pendingResolution = null
    }
  })()

  return pendingResolution
}

export const useSuperAdmin = () => {
  const { userProfile, user } = useAuth()
  const { tenantId } = useTenant()

  resolveSuperAdminState()

  watch(
    () => [user.value?.id, userProfile.value?.user_id],
    () => {
      resolveSuperAdminState()
    },
    { immediate: true }
  )

  // Super Admin es quien:
  // 1. Está autenticado en auth.users 
  // 2. NO tiene registro en tabla users (sin tenant_id)
  const isSuperAdmin = computed(() => {
    if (user.value?.id) {
      return !!(
        user.value &&
        user.value.id &&
        !userProfile.value
      )
    }

    return !!(resolvedAuthUser.value?.id && !resolvedHasProfile.value)
  })

  // Emails específicos que pueden ser super admin (opcional)
  const allowedSuperAdminEmails = [
    // 'superadmin@empresa.com',
    // 'admin@sistema.com'
  ]

  const isSuperAdminByEmail = computed(() => {
    // Fail-closed: requiere whitelist explícita
    const allowed = SUPER_ADMIN_EMAILS.length > 0 ? SUPER_ADMIN_EMAILS : allowedSuperAdminEmails
    if (allowed.length === 0) return false
    const email = user.value?.email || resolvedAuthUser.value?.email
    if (!email) return false // Guarda: si no hay email, no es super admin
    return allowed.includes(normalizeEmail(email))
  })

  const canManageTenants = computed(() => {
    return (isSuperAdmin.value && isSuperAdminByEmail.value) || resolvedCanManageTenants.value
  })

  return {
    isSuperAdmin,
    canManageTenants,
    isResolving: computed(() => resolvingSuperAdmin.value),
    refreshSuperAdminState: resolveSuperAdminState,
    superAdminInfo: computed(() => ({
      userId: user.value?.id || resolvedAuthUser.value?.id,
      email: user.value?.email || resolvedAuthUser.value?.email,
      hasProfile: !!userProfile.value || resolvedHasProfile.value,
      hasTenant: !!tenantId.value
    }))
  }
}
