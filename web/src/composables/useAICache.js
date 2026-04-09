/**
 * Composable para gestión de caché de IA
 * Proporciona utilidades para limpiar, revisar y gestionar el caché
 */

import { ref, computed } from 'vue';
import AICacheManager from '@/utils/aiCache';

export function useAICache() {
  const cacheStats = ref(null);
  const isLoading = ref(false);

  /**
   * Obtiene estadísticas del caché
   */
  const refreshStats = () => {
    cacheStats.value = AICacheManager.getStats();
  };

  /**
   * Limpia todo el caché
   */
  const clearAll = () => {
    const count = AICacheManager.clearAll();
    refreshStats();
    return count;
  };

  /**
   * Limpia entradas expiradas
   */
  const clearExpired = () => {
    const count = AICacheManager.clearExpired();
    refreshStats();
    return count;
  };

  const clearByService = (service, tenantId = null) => {
    const count = AICacheManager.clearByService(service, tenantId);
    refreshStats();
    return count;
  };

  /**
   * Estadísticas computadas
   */
  const hasCache = computed(() => {
    return cacheStats.value && cacheStats.value.total > 0;
  });

  const validCacheCount = computed(() => {
    return cacheStats.value?.valid || 0;
  });

  const expiredCacheCount = computed(() => {
    return cacheStats.value?.expired || 0;
  });

  const cacheSizeKB = computed(() => {
    return cacheStats.value?.totalSizeKB || 0;
  });

  // Inicializar estadísticas
  refreshStats();

  return {
    // Estado
    cacheStats,
    isLoading,

    // Computadas
    hasCache,
    validCacheCount,
    expiredCacheCount,
    cacheSizeKB,

    // Métodos
    refreshStats,
    clearAll,
    clearExpired,
    clearByService
  };
}
