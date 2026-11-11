import { ref, computed } from 'vue'
import queryCache from '@/utils/queryCache'

// Estado global del tenant actual
const currentTenant = ref(null)

export const useTenant = () => {
  const STORAGE_KEY = 'current_tenant'

  // Cargar tenant desde localStorage
  const loadTenant = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        // Backend auth returns the tenant id from /me, while older local
        // sessions may have persisted only that id. Keep the shell usable
        // during hydration instead of rendering the misleading "Sin empresa".
        if (parsed?.tenant_id && !parsed.tenant_name) {
          parsed.tenant_name = 'DEV Local'
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
        }
        currentTenant.value = parsed
      }
    } catch (error) {
      console.error('Error loading tenant from storage:', error)
    }
  }

  // Guardar tenant en localStorage
  const saveTenant = (tenantData) => {
    try {
      currentTenant.value = tenantData
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tenantData))
    } catch (error) {
      console.error('Error saving tenant to storage:', error)
    }
  }

  // Limpiar tenant
  const clearTenant = () => {
    const tenantId = currentTenant.value?.tenant_id || null
    currentTenant.value = null
    localStorage.removeItem(STORAGE_KEY)
    if (tenantId) {
      queryCache.clearTenantScope(tenantId)
    } else {
      queryCache.clearAll()
    }
  }

  // Inicializar al cargar
  if (!currentTenant.value) {
    loadTenant()
  }

  return {
    currentTenant: computed(() => currentTenant.value),
    tenantId: computed(() => currentTenant.value?.tenant_id),
    tenantName: computed(() => currentTenant.value?.tenant_name),
    saveTenant,
    clearTenant,
    loadTenant
  }
}
