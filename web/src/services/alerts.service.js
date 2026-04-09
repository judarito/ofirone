import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

const ALERTS_CACHE_TTL_MS = 60 * 1000
const ALERTS_SELECT_FIELDS = 'alert_id, alert_type, alert_level, created_at, updated_at, data'

const alertsService = {
  /**
   * Obtener todas las alertas de un tenant
   */
  async getAlerts(tenantId, options = {}) {
    try {
      const limit = Math.max(1, Number(options.limit || 200))
      return await queryCache.getOrLoad(
        `alerts:list:${limit}`,
        async () => {
          const { data, error } = await supabaseService.client
            .from('system_alerts')
            .select(ALERTS_SELECT_FIELDS)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(limit)

          if (error) throw error

          return { success: true, data: data || [] }
        },
        {
          tenantId,
          ttlMs: ALERTS_CACHE_TTL_MS,
          storage: 'memory',
          tags: ['alerts'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true
        }
      )
    } catch (error) {
      console.error('Error loading alerts:', error)
      return { success: false, error: error.message, data: [] }
    }
  },

  /**
   * Obtener alertas por tipo
   */
  async getAlertsByType(tenantId, alertType, options = {}) {
    try {
      const limit = Math.max(1, Number(options.limit || 80))
      return await queryCache.getOrLoad(
        `alerts:type:${alertType}:${limit}`,
        async () => {
          const { data, error } = await supabaseService.client
            .from('system_alerts')
            .select(ALERTS_SELECT_FIELDS)
            .eq('tenant_id', tenantId)
            .eq('alert_type', alertType)
            .order('created_at', { ascending: false })
            .limit(limit)

          if (error) throw error

          return { success: true, data: data || [] }
        },
        {
          tenantId,
          ttlMs: ALERTS_CACHE_TTL_MS,
          storage: 'memory',
          tags: ['alerts'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true
        }
      )
    } catch (error) {
      console.error('Error loading alerts by type:', error)
      return { success: false, error: error.message, data: [] }
    }
  },

  /**
   * Suscribirse a cambios en las alertas en tiempo real
   */
  subscribeToAlerts(tenantId, callback) {
    const channel = supabaseService.client
      .channel(`alerts:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'system_alerts',
          filter: `tenant_id=eq.${tenantId}`
        },
        (payload) => {
          callback(payload)
        }
      )
      .subscribe()

    return channel
  },

  /**
   * Cancelar suscripción
   */
  unsubscribe(channel) {
    if (channel) {
      supabaseService.client.removeChannel(channel)
    }
  },

  /**
   * Refrescar alertas de stock manualmente
   */
  async refreshStockAlerts() {
    try {
      const { error } = await supabaseService.client.rpc('fn_refresh_stock_alerts')
      if (error) throw error
      queryCache.invalidateByTags(['alerts'])
      return { success: true }
    } catch (error) {
      console.error('Error refreshing stock alerts:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Refrescar alertas de layaway manualmente
   */
  async refreshLayawayAlerts() {
    try {
      const { error } = await supabaseService.client.rpc('fn_refresh_layaway_alerts')
      if (error) throw error
      queryCache.invalidateByTags(['alerts'])
      return { success: true }
    } catch (error) {
      console.error('Error refreshing layaway alerts:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Refrescar alertas de vencimiento manualmente
   */
  async refreshExpirationAlerts() {
    try {
      const { error } = await supabaseService.client.rpc('fn_refresh_expiration_alerts')
      if (error) throw error
      queryCache.invalidateByTags(['alerts'])
      return { success: true }
    } catch (error) {
      console.error('Error refreshing expiration alerts:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Refrescar alertas de cuentas por pagar manualmente
   */
  async refreshSupplierPayableAlerts() {
    try {
      const { error } = await supabaseService.client.rpc('fn_refresh_supplier_payable_alerts')
      if (error) throw error
      queryCache.invalidateByTags(['alerts'])
      return { success: true }
    } catch (error) {
      console.error('Error refreshing supplier payable alerts:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Refrescar alertas de cartera (cuentas por cobrar) manualmente
   */
  async refreshCustomerReceivableAlerts() {
    try {
      const { error } = await supabaseService.client.rpc('fn_refresh_customer_receivable_alerts')
      if (error) throw error
      queryCache.invalidateByTags(['alerts'])
      return { success: true }
    } catch (error) {
      console.error('Error refreshing customer receivable alerts:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Refrescar todas las alertas
   */
  async refreshAllAlerts() {
    try {
      const { error } = await supabaseService.client.rpc('fn_refresh_all_alerts')
      if (error) throw error
      queryCache.invalidateByTags(['alerts'])
      return { success: true }
    } catch (error) {
      console.error('Error refreshing all alerts:', error)
      return { success: false, error: error.message }
    }
  }
}

export default alertsService
