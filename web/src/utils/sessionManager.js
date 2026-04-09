import router from '@/router'
import supabaseService from '@/services/supabase.service'

let sessionCheckInterval = null
let visibilityHandler = null
let isChecking = false
const SESSION_CHECK_INTERVAL = 60000 // Verificar cada 60 segundos

async function performSessionCheck() {
  // Evitar checks concurrentes
  if (isChecking) return
  isChecking = true

  try {
    const session = await supabaseService.getValidSession({
      forceRefresh: true,
      minValiditySeconds: 300,
      redirectOnFail: false
    })

    if (!session) {
      console.warn('Session check: No session found')
      stopSessionMonitoring()
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login')
      }
      return
    }

    supabaseService.invalidateSessionCache()
  } catch (error) {
    console.error('Session check error:', error)
  } finally {
    isChecking = false
  }
}

// Iniciar verificación periódica de sesión
export function startSessionMonitoring() {
  if (sessionCheckInterval) return

  console.log('Starting session monitoring...')
  sessionCheckInterval = setInterval(performSessionCheck, SESSION_CHECK_INTERVAL)

  // Manejar cuando la pestaña vuelve a estar visible (wake-up)
  if (!visibilityHandler) {
    visibilityHandler = async () => {
      if (document.visibilityState === 'visible') {
        console.log('Tab visible again, checking session...')
        supabaseService.invalidateSessionCache()
        performSessionCheck()
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }
}

// Detener verificación periódica
export function stopSessionMonitoring() {
  if (sessionCheckInterval) {
    console.log('Stopping session monitoring...')
    clearInterval(sessionCheckInterval)
    sessionCheckInterval = null
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
}

// Verificar sesión inmediatamente
export async function checkSession() {
  try {
    const session = await supabaseService.getValidSession({ redirectOnFail: false })
    return { session, error: null }
  } catch (error) {
    return { session: null, error }
  }
}
