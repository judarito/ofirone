import supabaseService from './supabase.service'

/**
 * Servicio para gestión de lotes con fecha de vencimiento
 * Integra con el sistema de lotes implementado en BD
 */
class BatchesService {
  constructor() {
    this.batchesTable = 'inventory_batches'
    this.saleLineBatchesTable = 'sale_line_batches'
  }

  // ============================================
  // GESTIÓN DE LOTES
  // ============================================

  /**
   * Obtener lotes de inventario
   */
  async getBatches(tenantId, page = 1, pageSize = 20, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.batchesTable)
        .select(`
          *,
          location:location_id(name),
          variant:variant_id(
            sku, variant_name, price,
            product:product_id(name, requires_expiration)
          )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('expiration_date', { ascending: true, nullsLast: true })
        .order('received_at', { ascending: false })
        .range(from, to)

      // Filtros
      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.variant_id) query = query.eq('variant_id', filters.variant_id)
      if (filters.batch_number) query = query.ilike('batch_number', `%${filters.batch_number}%`)
      if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active)
      if (filters.hasStock) query = query.gt('on_hand', 0)
      if (filters.alert_level) {
        // Filtrar por nivel de alerta
        const today = new Date().toISOString().split('T')[0]
        if (filters.alert_level === 'EXPIRED') {
          query = query.lt('expiration_date', today)
        } else if (filters.alert_level === 'CRITICAL') {
          const critical = new Date()
          critical.setDate(critical.getDate() + 7)
          query = query.gte('expiration_date', today).lte('expiration_date', critical.toISOString().split('T')[0])
        } else if (filters.alert_level === 'WARNING') {
          const warning = new Date()
          warning.setDate(warning.getDate() + 30)
          query = query.gte('expiration_date', today).lte('expiration_date', warning.toISOString().split('T')[0])
        }
      }

      const { data, error, count } = await query
      if (error) throw error
      
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      console.error('Error getBatches:', error)
      return { success: false, error: error.message, data: [], total: 0 }
    }
  }

  /**
   * Crear nuevo lote
   */
  async createBatch(tenantId, batchData) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.batchesTable)
        .insert({
          tenant_id: tenantId,
          location_id: batchData.location_id,
          variant_id: batchData.variant_id,
          batch_number: batchData.batch_number,
          expiration_date: batchData.expiration_date || null,
          on_hand: batchData.on_hand || 0,
          reserved: 0,
          unit_cost: batchData.unit_cost || 0,
          physical_location: batchData.physical_location || null,
          notes: batchData.notes || null,
          created_by: batchData.created_by || null
        })
        .select()
        .single()

      if (error) throw error

      // Refresh stock_balances
      await this.refreshStockBalances()

      return { success: true, data }
    } catch (error) {
      console.error('Error createBatch:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Actualizar lote
   */
  async updateBatch(batchId, updates) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.batchesTable)
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('batch_id', batchId)
        .select()
        .single()

      if (error) throw error

      // Refresh stock_balances
      await this.refreshStockBalances()

      return { success: true, data }
    } catch (error) {
      console.error('Error updateBatch:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Desactivar lote
   */
  async deactivateBatch(batchId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.batchesTable)
        .update({ is_active: false })
        .eq('batch_id', batchId)
        .select()
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      console.error('Error deactivateBatch:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Generar número de lote automático
   */
  async generateBatchNumber(tenantId, variantId, prefix = 'BATCH') {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_generate_batch_number', {
          p_tenant: tenantId,
          p_variant: variantId,
          p_prefix: prefix
        })

      if (error) throw error
      return { success: true, batchNumber: data }
    } catch (error) {
      console.error('Error generateBatchNumber:', error)
      // Fallback: generar manualmente
      const sku = 'BATCH'
      const date = new Date().toISOString().slice(2, 10).replace(/-/g, '')
      const seq = Math.floor(Math.random() * 1000)
      return { success: true, batchNumber: `${prefix}-${sku}-${date}-${seq.toString().padStart(3, '0')}` }
    }
  }

  // ============================================
  // VISTAS Y REPORTES
  // ============================================

  /**
   * Obtener productos próximos a vencer
   */
  async getExpiringProducts(tenantId, filters = {}) {
    try {
      let query = supabaseService.client
        .from('vw_expiring_products')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('days_to_expiry', { ascending: true })

      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.alert_level) query = query.eq('alert_level', filters.alert_level)

      const { data, error } = await query
      if (error) throw error
      
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error getExpiringProducts:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * Dashboard de vencimientos por sede
   */
  async getExpirationDashboard(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_expiration_dashboard')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('total_value_at_risk', { ascending: false })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error getExpirationDashboard:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * Stock para cajero con info de vencimiento
   */
  async getStockForCashier(tenantId, locationId, variantId = null) {
    try {
      let query = supabaseService.client
        .from('vw_stock_for_cashier')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)

      if (variantId) query = query.eq('variant_id', variantId)

      const { data, error } = await query
      if (error) throw error
      
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error getStockForCashier:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * Reporte de vencimientos
   */
  async getExpirationReport(tenantId, locationId = null, daysAhead = 30) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_expiration_report', {
          p_tenant: tenantId,
          p_location: locationId,
          p_days_ahead: daysAhead
        })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error getExpirationReport:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * Top productos en riesgo
   */
  async getTopAtRiskProducts(tenantId, locationId = null, limit = 10) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_top_at_risk_products', {
          p_tenant: tenantId,
          p_location: locationId,
          p_limit: limit
        })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error getTopAtRiskProducts:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * Configuración de vencimiento de productos
   */
  async getProductsExpirationConfig(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_products_expiration_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('product_name', { ascending: true })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error getProductsExpirationConfig:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * Trazabilidad de lotes
   */
  async getBatchTraceability(tenantId, batchId = null, saleId = null) {
    try {
      let query = supabaseService.client
        .from('vw_batch_traceability')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('sold_at', { ascending: false })

      if (batchId) query = query.eq('batch_id', batchId)
      if (saleId) query = query.eq('sale_id', saleId)

      const { data, error } = await query
      if (error) throw error
      
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error getBatchTraceability:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  // ============================================
  // UTILIDADES
  // ============================================

  /**
   * Refrescar vista materializada de stock_balances
   */
  async refreshStockBalances() {
    try {
      await supabaseService.client.rpc('fn_refresh_stock_balances', { p_concurrent: true })
    } catch (error) {
      console.warn('Error refreshing stock_balances:', error.message)
    }
  }

  /**
   * Calcular nivel de alerta de vencimiento
   */
  getAlertLevel(expirationDate, warnDays = 30, criticalDays = 7) {
    if (!expirationDate) return 'OK'
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expDate = new Date(expirationDate)
    expDate.setHours(0, 0, 0, 0)
    
    const daysToExpiry = Math.floor((expDate - today) / (1000 * 60 * 60 * 24))
    
    if (daysToExpiry < 0) return 'EXPIRED'
    if (daysToExpiry <= criticalDays) return 'CRITICAL'
    if (daysToExpiry <= warnDays) return 'WARNING'
    return 'OK'
  }

  /**
   * Formatear días para vencimiento
   */
  formatDaysToExpiry(days) {
    if (days < 0) return 'Vencido'
    if (days === 0) return 'Vence hoy'
    if (days === 1) return 'Vence mañana'
    return `${days} días`
  }
}

export default new BatchesService()
