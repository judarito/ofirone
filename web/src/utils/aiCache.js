/**
 * AI Cache Utility
 * Sistema de caché inteligente para respuestas de IA (DeepSeek)
 * Reduce costos al cachear resultados por períodos configurables
 */

const CACHE_PREFIX = 'ai_cache_';

class AICacheManager {
  /**
   * Guarda una respuesta en caché
   * @param {string} cacheKey - Clave única del caché
   * @param {any} data - Datos a cachear
   * @param {number} ttlHours - Tiempo de vida en horas
   */
  static set(cacheKey, data, ttlHours = 24) {
    try {
      const cacheEntry = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + (ttlHours * 60 * 60 * 1000),
        ttlHours
      };

      localStorage.setItem(
        `${CACHE_PREFIX}${cacheKey}`,
        JSON.stringify(cacheEntry)
      );

      console.log(`✅ Caché guardado: ${cacheKey} (TTL: ${ttlHours}h)`);
      return true;
    } catch (error) {
      console.error('Error guardando en caché:', error);
      return false;
    }
  }

  /**
   * Obtiene una respuesta del caché si está vigente
   * @param {string} cacheKey - Clave única del caché
   * @returns {any|null} - Datos cacheados o null si no existe/expiró
   */
  static get(cacheKey) {
    try {
      const cached = localStorage.getItem(`${CACHE_PREFIX}${cacheKey}`);
      
      if (!cached) {
        console.log(`❌ Caché no encontrado: ${cacheKey}`);
        return null;
      }

      const cacheEntry = JSON.parse(cached);
      const now = Date.now();

      // Verificar si expiró
      if (now > cacheEntry.expiresAt) {
        console.log(`⏰ Caché expirado: ${cacheKey}`);
        this.delete(cacheKey);
        return null;
      }

      // Calcular tiempo restante
      const remainingHours = Math.round((cacheEntry.expiresAt - now) / (60 * 60 * 1000));
      console.log(`✅ Caché válido: ${cacheKey} (expira en ${remainingHours}h)`);

      return cacheEntry.data;
    } catch (error) {
      console.error('Error leyendo caché:', error);
      return null;
    }
  }

  /**
   * Elimina una entrada del caché
   * @param {string} cacheKey - Clave única del caché
   */
  static delete(cacheKey) {
    try {
      localStorage.removeItem(`${CACHE_PREFIX}${cacheKey}`);
      console.log(`🗑️ Caché eliminado: ${cacheKey}`);
    } catch (error) {
      console.error('Error eliminando caché:', error);
    }
  }

  /**
   * Limpia todo el caché de IA
   */
  static clearAll() {
    try {
      const keys = Object.keys(localStorage);
      let count = 0;

      keys.forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key);
          count++;
        }
      });

      console.log(`🗑️ ${count} entradas de caché eliminadas`);
      return count;
    } catch (error) {
      console.error('Error limpiando caché:', error);
      return 0;
    }
  }

  /**
   * Limpia caché de un servicio IA específico, opcionalmente por tenant.
   * @param {string} service - forecast, purchase, pricing, etc.
   * @param {string|null} tenantId - tenant opcional para acotar limpieza
   */
  static clearByService(service, tenantId = null) {
    try {
      const keys = Object.keys(localStorage);
      let count = 0;
      const marker = `${service}_`;
      const tenantMarker = tenantId ? `_${tenantId}_` : null;

      keys.forEach(key => {
        if (!key.startsWith(CACHE_PREFIX)) return;
        const cacheKey = key.replace(CACHE_PREFIX, '');
        if (!cacheKey.startsWith(marker)) return;
        if (tenantMarker && !cacheKey.includes(tenantMarker)) return;

        localStorage.removeItem(key);
        count++;
      });

      console.log(`🗑️ ${count} entradas de caché eliminadas para servicio ${service}${tenantId ? ` tenant ${tenantId}` : ''}`);
      return count;
    } catch (error) {
      console.error('Error limpiando caché por servicio:', error);
      return 0;
    }
  }

  /**
   * Limpia entradas expiradas del caché
   */
  static clearExpired() {
    try {
      const keys = Object.keys(localStorage);
      const now = Date.now();
      let count = 0;

      keys.forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
          try {
            const cached = localStorage.getItem(key);
            const cacheEntry = JSON.parse(cached);
            
            if (now > cacheEntry.expiresAt) {
              localStorage.removeItem(key);
              count++;
            }
          } catch (e) {
            // Si hay error parseando, eliminar la entrada corrupta
            localStorage.removeItem(key);
            count++;
          }
        }
      });

      if (count > 0) {
        console.log(`🗑️ ${count} entradas expiradas eliminadas`);
      }
      return count;
    } catch (error) {
      console.error('Error limpiando entradas expiradas:', error);
      return 0;
    }
  }

  /**
   * Obtiene estadísticas del caché
   */
  static getStats() {
    try {
      const keys = Object.keys(localStorage);
      const now = Date.now();
      const stats = {
        total: 0,
        valid: 0,
        expired: 0,
        totalSize: 0,
        entries: []
      };

      keys.forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
          stats.total++;
          const cached = localStorage.getItem(key);
          stats.totalSize += cached.length;

          try {
            const cacheEntry = JSON.parse(cached);
            const isValid = now <= cacheEntry.expiresAt;
            
            if (isValid) {
              stats.valid++;
            } else {
              stats.expired++;
            }

            stats.entries.push({
              key: key.replace(CACHE_PREFIX, ''),
              size: cached.length,
              isValid,
              createdAt: new Date(cacheEntry.timestamp).toLocaleString(),
              expiresAt: new Date(cacheEntry.expiresAt).toLocaleString(),
              ttlHours: cacheEntry.ttlHours
            });
          } catch (e) {
            stats.expired++;
          }
        }
      });

      // Convertir tamaño a KB
      stats.totalSizeKB = (stats.totalSize / 1024).toFixed(2);

      return stats;
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      return null;
    }
  }

  /**
   * Genera una clave de caché basada en parámetros
   * @param {string} service - Nombre del servicio (forecast, purchase, etc)
   * @param {string} tenantId - ID del tenant
   * @param {Object} params - Parámetros adicionales que afectan el resultado
   */
  static generateKey(service, tenantId, params = {}) {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const paramHash = this._hashObject(params);
    return `${service}_${tenantId}_${date}_${paramHash}`;
  }

  /**
   * Genera un hash simple para un objeto
   * @private
   */
  static _hashObject(obj) {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

export default AICacheManager;
