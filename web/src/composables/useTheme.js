import { ref, onMounted } from 'vue'
import { useTheme as useVuetifyTheme } from 'vuetify'
import { supabase } from '@/plugins/supabase'
import tenantSettingsService from '@/services/tenantSettings.service'

const THEME_STORAGE_KEY = 'ofirone_theme'
const LEGACY_THEME_STORAGE_KEY = 'poslite_theme'
const VALID_THEMES = ['light', 'dark', 'auto']
let hasInitializedTheme = false
const sharedIsDark = ref(false)
const sharedActiveAuthUserId = ref(null)

const normalizeTheme = (theme) => {
  if (!theme) return null
  const normalized = String(theme).toLowerCase()
  return VALID_THEMES.includes(normalized) ? normalized : null
}

const getSystemTheme = () => (
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
)

const getThemeStorageKey = (authUserId) => (
  authUserId ? `${THEME_STORAGE_KEY}:${authUserId}` : THEME_STORAGE_KEY
)

export function useTheme() {
  const vuetifyTheme = useVuetifyTheme()
  const isDark = sharedIsDark
  const activeAuthUserId = sharedActiveAuthUserId

  const resolveAuthUserId = async (authUserId) => {
    if (authUserId) return authUserId
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.id || null
  }

  const applyTheme = (theme) => {
    const normalized = normalizeTheme(theme) || 'light'
    const effectiveTheme = normalized === 'auto' ? getSystemTheme() : normalized
    isDark.value = effectiveTheme === 'dark'
    if (typeof vuetifyTheme.change === 'function') {
      vuetifyTheme.change(effectiveTheme)
    } else {
      vuetifyTheme.global.name.value = effectiveTheme
    }
    return normalized
  }

  const getStoredTheme = (authUserId = null) => {
    if (typeof window === 'undefined') return null

    const scopedKey = getThemeStorageKey(authUserId)
    const scopedTheme = normalizeTheme(localStorage.getItem(scopedKey))
    if (scopedTheme) return scopedTheme

    if (authUserId) {
      // Para usuarios autenticados SOLO se respeta cache por usuario.
      // Si no existe, debe usarse tenant_settings como fallback.
      return null
    }

    const genericTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY))
    if (genericTheme) return genericTheme

    return normalizeTheme(localStorage.getItem(LEGACY_THEME_STORAGE_KEY))
  }

  const saveTheme = (theme, authUserId = null) => {
    if (typeof window === 'undefined') return
    const normalized = normalizeTheme(theme) || 'light'
    const key = getThemeStorageKey(authUserId)
    localStorage.setItem(key, normalized)
    // Mantener una preferencia base para pantallas sin usuario autenticado (ej: login).
    localStorage.setItem(THEME_STORAGE_KEY, normalized)
    if (localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) {
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
    }
  }

  // Cargar tema con prioridad localStorage. Si no existe, usa tenantTheme y lo persiste.
  const ensureThemeForUser = async ({ authUserId = null, tenantTheme = null } = {}) => {
    const resolvedAuthUserId = await resolveAuthUserId(authUserId)
    activeAuthUserId.value = resolvedAuthUserId

    const storedTheme = getStoredTheme(resolvedAuthUserId)
    if (storedTheme) {
      applyTheme(storedTheme)
      return storedTheme
    }

    const defaultTheme = normalizeTheme(tenantTheme) || getSystemTheme()
    applyTheme(defaultTheme)
    saveTheme(defaultTheme, resolvedAuthUserId)
    return defaultTheme
  }

  // Sincronizar tema desde tenant_settings SOLO si el usuario no tiene cache local.
  const syncThemeFromTenant = async (tenantId, authUserId = null) => {
    if (!tenantId) return false

    try {
      const resolvedAuthUserId = await resolveAuthUserId(authUserId)
      activeAuthUserId.value = resolvedAuthUserId

      const storedTheme = getStoredTheme(resolvedAuthUserId)
      if (storedTheme) {
        applyTheme(storedTheme)
        return true
      }

      const result = await tenantSettingsService.getSettings(tenantId)
      if (!result.success) throw new Error(result.error)

      const fallbackTheme = normalizeTheme(result.data?.theme) || getSystemTheme()
      applyTheme(fallbackTheme)
      saveTheme(fallbackTheme, resolvedAuthUserId)
      return true
    } catch (error) {
      console.error('Error sincronizando tema del tenant:', error)
      await ensureThemeForUser({ authUserId })
      return false
    }
  }

  // Alternar tema
  const toggleTheme = (authUserId = null) => {
    const resolvedUser = authUserId ?? activeAuthUserId.value
    const newTheme = isDark.value ? 'light' : 'dark'
    applyTheme(newTheme)
    saveTheme(newTheme, resolvedUser)
  }

  // Establecer tema específico
  const setTheme = (theme, authUserId = null) => {
    const resolvedUser = authUserId ?? activeAuthUserId.value
    const normalized = applyTheme(theme)
    saveTheme(normalized, resolvedUser)
  }

  // Compatibilidad con implementación anterior
  const loadTheme = async (authUserId = null, tenantTheme = null) => {
    return ensureThemeForUser({ authUserId, tenantTheme })
  }

  onMounted(() => {
    if (!hasInitializedTheme) {
      hasInitializedTheme = true
      ensureThemeForUser()
    }
  })

  return {
    isDark,
    activeAuthUserId,
    ensureThemeForUser,
    toggleTheme,
    setTheme,
    syncThemeFromTenant,
    loadTheme,
    currentTheme: vuetifyTheme.global.name
  }
}
