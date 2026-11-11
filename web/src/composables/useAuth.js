import { ref, computed } from 'vue'
import { supabase } from '@/plugins/supabase'
import supabaseService from '@/services/supabase.service'
import router from '@/router'
import { useTenant } from './useTenant'
import { clearRecoveryIntent, persistRecoveryIntent } from '@/utils/authRecovery'
import queryCache from '@/utils/queryCache'
import { loginBackend, getBackendMe, getBackendSession, logoutBackend, clearBackendSession, USE_BACKEND_AUTH } from '@/services/backendAuthClient'

// Estado global de autenticación
const user = ref(null)
const session = ref(null)
const loading = ref(false)
const userProfile = ref(null) // Datos del usuario desde la tabla users
let backendHydrationStarted = false

async function hydrateBackendAuth() {
  if (!USE_BACKEND_AUTH || backendHydrationStarted || user.value) return
  backendHydrationStarted = true
  const stored = getBackendSession()
  if (!stored?.accessToken) return
  try {
    const me = await getBackendMe(stored.accessToken)
    user.value = { id: me.identity_id, email: null }
    session.value = { access_token: stored.accessToken, refresh_token: stored.refreshToken, user: user.value }
    userProfile.value = {
      user_id: me.identity_id,
      auth_user_id: me.identity_id,
      tenant_id: me.tenant_id,
      permissions: me.permissions || [],
      permissionCodes: (me.permissions || []).map((permission) => permission.code || permission),
    }
    useTenant().saveTenant({ tenant_id: me.tenant_id, tenant_name: 'DEV Local' })
  } catch (error) {
    console.warn('No se pudo restaurar la sesión Go:', error.message)
    // Un JWT emitido por una instancia anterior (por ejemplo, tras reiniciar
    // el backend con una clave efímera) no debe dejar la app en un estado de
    // carga permanente ni volver a fallar en cada recarga.
    clearBackendSession()
  }
}

function normalizeAbsoluteUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    return new URL(raw).toString()
  } catch (_error) {
    return ''
  }
}

function resolvePasswordRecoveryRedirectUrl() {
  const configuredRecoveryUrl = normalizeAbsoluteUrl(import.meta.env.VITE_AUTH_RECOVERY_URL)
  if (configuredRecoveryUrl) return configuredRecoveryUrl

  const configuredAppUrl = normalizeAbsoluteUrl(
    import.meta.env.VITE_APP_URL || import.meta.env.VITE_PUBLIC_APP_URL,
  )
  if (configuredAppUrl) {
    return `${configuredAppUrl.replace(/\/+$/, '')}/login`
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/login`
  }

  return ''
}

// Obtener datos del usuario desde la tabla users
async function fetchUserProfile(authUserId) {
  try {
    const { saveTenant, clearTenant } = useTenant()
    const { data, error } = await supabaseService.select(
      'users',
      `
        user_id,
        auth_user_id,
        tenant_id,
        email,
        full_name,
        is_active,
        tenants (
          tenant_id,
          name,
          currency_code
        )
      `,
      { auth_user_id: authUserId }
    )

    if (error) throw error

    if (data && data.length > 0) {
      const profile = data[0]
      
      // Cargar roles y permisos del usuario
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select(`
          role:role_id (
            role_id,
            name,
            role_permissions (
              permission:permission_id (
                permission_id,
                code,
                description
              )
            )
          )
        `)
        .eq('user_id', profile.user_id)

      if (!rolesError && userRoles) {
        // Extraer permisos únicos de todos los roles
        const permissionsMap = new Map()
        userRoles.forEach(ur => {
          ur.role?.role_permissions?.forEach(rp => {
            if (rp.permission) {
              permissionsMap.set(rp.permission.code, rp.permission)
            }
          })
        })

        profile.roles = userRoles.map(ur => ur.role).filter(r => r)
        profile.permissions = Array.from(permissionsMap.values())
        profile.permissionCodes = Array.from(permissionsMap.keys())
      } else {
        profile.roles = []
        profile.permissions = []
        profile.permissionCodes = []
      }

      userProfile.value = profile

      if (profile.tenants?.tenant_id) {
        saveTenant({
          tenant_id: profile.tenants.tenant_id,
          tenant_name: profile.tenants.name,
          currency_code: profile.tenants.currency_code
        })
      } else {
        clearTenant()
      }
      
      return {
        success: true,
        profile,
        tenant: profile.tenants
      }
    }

    clearTenant()
    return { success: false, error: 'User profile not found' }
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return { success: false, error: error.message }
  }
}

// Listener de cambios de autenticación
let authListener = null

function setupAuthListener() {
  if (authListener) return

  authListener = supabase.auth.onAuthStateChange((event, currentSession) => {
    console.log('Auth state changed:', event)

    // Actualizar estado sincrónicament — NO hacer awaits dentro de este callback
    // porque Supabase bloquea llamadas auth concurrentes dentro del listener
    session.value = currentSession
    user.value = currentSession?.user ?? null

    if (event === 'PASSWORD_RECOVERY') {
      persistRecoveryIntent()
      setTimeout(() => {
        const currentRoute = router.currentRoute.value
        const isLoginRoute = currentRoute?.path === '/login'
        const alreadyMarked = currentRoute?.query?.recovery === '1'
        if (!isLoginRoute || !alreadyMarked) {
          router.replace({ path: '/login', query: { recovery: '1' } })
        }
      }, 0)
      return
    }

    if (event === 'SIGNED_OUT' || (!currentSession && event !== 'INITIAL_SESSION')) {
      handleSessionExpired()
      return
    }

    if (event === 'TOKEN_REFRESHED' && currentSession) {
      console.log('Token refreshed successfully')
    }

    // Cargar perfil fuera del ciclo del listener para evitar deadlock
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && currentSession?.user) {
      if (!userProfile.value) {
        setTimeout(() => fetchUserProfile(currentSession.user.id), 0)
      }
    }
  })
}

function handleSessionExpired() {
  console.warn('Session expired or invalid')
  user.value = null
  userProfile.value = null
  session.value = null
  supabaseService.invalidateSessionCache()
  queryCache.clearAll()
  
  const { clearTenant } = useTenant()
  clearTenant()

  import('@/utils/sessionManager')
    .then(({ stopSessionMonitoring }) => stopSessionMonitoring())
    .catch(() => {})

  // Redirigir al login si no está ya allí
  if (router.currentRoute.value.path !== '/login') {
    router.push('/login')
  }
}

export const useAuth = () => {
  void hydrateBackendAuth()
  // Configurar el listener una sola vez
  if (!authListener) {
    setupAuthListener()
  }

  const isAuthenticated = computed(() => !!user.value)

  // Inicializar sesión
  const initAuth = async () => {
    try {
      // Go owns the session when the migration flag is enabled. Do not ask
      // Supabase for a parallel session on a hard refresh: that race clears
      // the hydrated profile and leaves the shell stuck on “Cargando menú”.
      if (USE_BACKEND_AUTH) {
        await hydrateBackendAuth()
        return {
          success: true,
          session: session.value,
          isAuthenticated: !!session.value
        }
      }
      const { clearTenant } = useTenant()
      const validSession = await supabaseService.getValidSession({
        redirectOnFail: false,
        minValiditySeconds: 60
      })
      session.value = validSession
      user.value = validSession?.user ?? null

      // Si hay usuario, cargar su perfil
      if (user.value) {
        await fetchUserProfile(user.value.id)
      } else {
        userProfile.value = null
        queryCache.clearAll()
        clearTenant()
      }

      // El listener ya está configurado via setupAuthListener(),
      // no duplicar aquí para evitar race conditions
      return {
        success: true,
        session: validSession,
        isAuthenticated: !!validSession
      }
    } catch (error) {
      console.error('Error al inicializar autenticación:', error)
      user.value = null
      userProfile.value = null
      session.value = null
      queryCache.clearAll()
      const { clearTenant } = useTenant()
      clearTenant()
      return {
        success: false,
        session: null,
        isAuthenticated: false,
        error: error.message
      }
    }
  }

  // Iniciar sesión
  const signIn = async (email, password) => {
    loading.value = true
    try {
      if (USE_BACKEND_AUTH) {
        const tenantStore = useTenant()
        tenantStore.loadTenant()
        const tenantId = tenantStore.tenantId.value || import.meta.env.VITE_BACKEND_DEFAULT_TENANT_ID || ''
        const backend = await loginBackend({ email, password, tenantId })
        const me = await getBackendMe(backend.AccessToken || backend.access_token)
        const backendSession = {
          access_token: backend.AccessToken || backend.access_token,
          refresh_token: backend.RefreshToken || backend.refresh_token,
          user: { id: me.identity_id || backend.IdentityID || backend.identity_id || null, email },
        }
        session.value = backendSession
        user.value = backendSession.user
        userProfile.value = {
          user_id: backendSession.user.id,
          auth_user_id: backendSession.user.id,
          email,
          tenant_id: me.tenant_id || tenantId,
          permissions: me.permissions || [],
          permissionCodes: (me.permissions || []).map((permission) => permission.code || permission),
        }
        const { saveTenant } = useTenant()
        saveTenant({ tenant_id: me.tenant_id || tenantId, tenant_name: 'DEV Local' })
        return {
          success: true,
          data: { user: backendSession.user, session: backendSession },
          tenant: {
            tenant_id: me.tenant_id || backend.TenantID || backend.tenant_id || tenantId,
            name: 'DEV Local',
          },
        }
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      session.value = data.session
      user.value = data.user

      // Obtener perfil del usuario y datos del tenant
      const profileResult = await fetchUserProfile(data.user.id)

      const { startSessionMonitoring } = await import('@/utils/sessionManager')
      startSessionMonitoring()

      return { 
        success: true, 
        data,
        profile: profileResult.profile,
        tenant: profileResult.tenant
      }
    } catch (error) {
      console.error('Error al iniciar sesión:', error)
      return { success: false, error: error.message }
    } finally {
      loading.value = false
    }
  }

  // Registrar usuario
  const signUp = async (email, password, metadata = {}) => {
    loading.value = true
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata
        }
      })

      if (error) throw error

      return { success: true, data }
    } catch (error) {
      console.error('Error al registrar usuario:', error)
      return { success: false, error: error.message }
    } finally {
      loading.value = false
    }
  }

  // Cerrar sesión
  const signOut = async () => {
    loading.value = true
    try {
      if (USE_BACKEND_AUTH) {
        const stored = getBackendSession()
        try {
          if (stored?.accessToken) await logoutBackend(stored)
        } catch (backendError) {
          // A restarted backend may reject an old token. Logout is still
          // successful locally and must not leave the shell authenticated.
          console.warn('Sesión Go ya no válida; limpiando sesión local:', backendError.message)
        } finally {
          clearBackendSession()
        }
        session.value = null
        user.value = null
        userProfile.value = null
        clearRecoveryIntent()
        queryCache.clearAll()
        useTenant().clearTenant()
        router.replace('/login')
        return { success: true }
      }
      const { error } = await supabase.auth.signOut()
      
      if (error) throw error

      session.value = null
      user.value = null
      userProfile.value = null
      clearRecoveryIntent()
      supabaseService.invalidateSessionCache()
      queryCache.clearAll()

      const { clearTenant } = useTenant()
      clearTenant()

      // Detener monitoreo de sesión
      const { stopSessionMonitoring } = await import('@/utils/sessionManager')
      stopSessionMonitoring()

      return { success: true }
    } catch (error) {
      console.error('Error al cerrar sesión:', error)
      return { success: false, error: error.message }
    } finally {
      loading.value = false
    }
  }

  // Restablecer contraseña
  const resetPassword = async (email) => {
    loading.value = true
    try {
      const redirectTo = resolvePasswordRecoveryRedirectUrl()
      const { error } = redirectTo
        ? await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        : await supabase.auth.resetPasswordForEmail(email)

      if (error) throw error

      return { success: true }
    } catch (error) {
      console.error('Error al restablecer contraseña:', error)
      return { success: false, error: error.message }
    } finally {
      loading.value = false
    }
  }

  // Actualizar contraseña durante flujo de recovery
  const updatePassword = async (newPassword) => {
    loading.value = true
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error
      return { success: true }
    } catch (error) {
      console.error('Error al actualizar contraseña:', error)
      return { success: false, error: error.message }
    } finally {
      loading.value = false
    }
  }

  // Actualizar perfil
  const updateProfile = async (updates) => {
    loading.value = true
    try {
      const { error } = await supabase.auth.updateUser({
        data: updates
      })

      if (error) throw error

      return { success: true }
    } catch (error) {
      console.error('Error al actualizar perfil:', error)
      return { success: false, error: error.message }
    } finally {
      loading.value = false
    }
  }

  // Verificar si el usuario tiene un permiso específico
  const hasPermission = (permissionCode) => {
    if (!userProfile.value) return false
    return userProfile.value.permissionCodes?.includes(permissionCode) || false
  }

  // Verificar si el usuario tiene cualquiera de los permisos especificados
  const hasAnyPermission = (permissionCodes) => {
    if (!userProfile.value || !permissionCodes || permissionCodes.length === 0) return false
    return permissionCodes.some(code => userProfile.value.permissionCodes?.includes(code))
  }

  // Verificar si el usuario tiene todos los permisos especificados
  const hasAllPermissions = (permissionCodes) => {
    if (!userProfile.value || !permissionCodes || permissionCodes.length === 0) return false
    return permissionCodes.every(code => userProfile.value.permissionCodes?.includes(code))
  }

  // Verificar si el usuario tiene un rol específico
  const hasRole = (roleName) => {
    if (!userProfile.value) return false
    return userProfile.value.roles?.some(role => role.name === roleName) || false
  }

  return {
    // Estado
    user: computed(() => user.value),
    userProfile: computed(() => userProfile.value),
    session: computed(() => session.value),
    loading: computed(() => loading.value),
    isAuthenticated,

    // Métodos
    initAuth,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile,
    fetchUserProfile,
    
    // Permisos
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole
  }
}
