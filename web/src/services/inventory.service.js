import supabaseService from './supabase.service'
import { serviceErrorResult } from '@/utils/appErrors'

class InventoryService {
  constructor() {
    this.movesTable = 'inventory_moves'
    this.stockTable = 'stock_balances'
  }

  _getComputedAlertLevel(stockRow) {
    const onHand = Number(stockRow?.on_hand || 0)
    const reserved = Number(stockRow?.reserved || 0)
    const minStock = Number(stockRow?.variant?.min_stock || 0)
    const available = onHand - reserved

    if (onHand <= 0) return 'OUT_OF_STOCK'
    if (available <= 0) return 'NO_AVAILABLE'
    if (minStock > 0 && onHand <= minStock) return 'LOW_STOCK'
    if (minStock > 0 && available <= minStock) return 'LOW_AVAILABLE'
    return 'OK'
  }

  _isMissingStockAlertsView(error) {
    const message = String(error?.message || '').toLowerCase()
    return (
      message.includes('vw_stock_alerts') &&
      (
        message.includes('schema cache') ||
        message.includes('could not find the table') ||
        message.includes('relation') ||
        message.includes('does not exist')
      )
    )
  }

  async _getStockAlertsFallback(tenantId, filters = {}) {
    let query = supabaseService.client
      .from(this.stockTable)
      .select(`
        tenant_id,
        location_id,
        on_hand,
        reserved,
        updated_at,
        location:location_id(name),
        variant:variant_id(
          variant_id,
          sku,
          variant_name,
          cost,
          price,
          min_stock,
          product:product_id(product_id, name)
        )
      `)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })

    if (filters.location_id) query = query.eq('location_id', filters.location_id)

    const { data, error } = await query
    if (error) throw error

    const rows = (data || [])
      .map((item) => {
        const available = Number(item.on_hand || 0) - Number(item.reserved || 0)
        return {
          ...item,
          variant_id: item.variant?.variant_id || null,
          sku: item.variant?.sku || null,
          product_id: item.variant?.product?.product_id || null,
          product_name: item.variant?.product?.name || null,
          variant_name: item.variant?.variant_name || null,
          location_name: item.location?.name || null,
          min_stock: Number(item.variant?.min_stock || 0),
          available,
          alert_level: this._getComputedAlertLevel(item)
        }
      })
      .filter((item) => item.alert_level !== 'OK')

    const filtered = filters.alert_level
      ? rows.filter((item) => item.alert_level === filters.alert_level)
      : rows

    return { success: true, data: filtered }
  }

  // Obtener stock actual por sede (usa tabla materializada stock_balances)
  async getStockBalances(tenantId, page = 1, pageSize = 20, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.stockTable)
        .select(`
          *,
          location:location_id(name),
          variant:variant_id(
            sku, variant_name, cost, price, min_stock, is_component,
            product:product_id(name, is_component, category:category_id(name))
          )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false })
        .range(from, to)

      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.variant_id) query = query.eq('variant_id', filters.variant_id)
      if (filters.low_stock) query = query.lte('on_hand', filters.low_stock)

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  // Kardex: movimientos de inventario
  async getInventoryMoves(tenantId, page = 1, pageSize = 20, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.movesTable)
        .select(`
          *,
          location:location_id(name),
          to_location:to_location_id(name),
          variant:variant_id(
            sku, variant_name,
            product:product_id(name)
          ),
          created_by_user:created_by(full_name)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.variant_id) query = query.eq('variant_id', filters.variant_id)
      if (filters.move_type) query = query.eq('move_type', filters.move_type)
      if (filters.from_date) query = query.gte('created_at', filters.from_date)
      if (filters.to_date) query = query.lte('created_at', filters.to_date)

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  // Refrescar alertas de stock manualmente (respaldo a triggers)
  async refreshStockAlerts() {
    try {
      const { error } = await supabaseService.client.rpc('fn_refresh_stock_alerts')
      if (error) {
        console.warn('Error refrescando alertas de stock:', error.message)
      }
    } catch (error) {
      console.warn('Error refrescando alertas de stock:', error.message)
    }
  }

  // Crear movimiento manual (ajuste)
  async createManualAdjustment(tenantId, adjustment) {
    try {
      // Insertar movimiento
      const moveData = {
        tenant_id: tenantId,
        move_type: 'ADJUSTMENT',
        location_id: adjustment.location_id,
        variant_id: adjustment.variant_id,
        quantity: Math.abs(adjustment.quantity),
        unit_cost: adjustment.unit_cost || 0,
        source: 'MANUAL',
        source_id: null,
        note: adjustment.note || null,
        created_by: adjustment.created_by
      }

      const { data, error } = await supabaseService.insert(this.movesTable, moveData)
      if (error) throw error

      // Actualizar stock_balances con delta
      const delta = adjustment.is_increase ? Math.abs(adjustment.quantity) : -Math.abs(adjustment.quantity)
      const { error: stockErr } = await supabaseService.client.rpc('fn_apply_stock_delta', {
        p_tenant: tenantId,
        p_location: adjustment.location_id,
        p_variant: adjustment.variant_id,
        p_delta: delta
      })

      if (stockErr) throw stockErr
      
      // Refrescar alertas después de cambios en stock
      await this.refreshStockAlerts()
      
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Crear traslado entre sedes (flujo en transito)
  async createTransfer(tenantId, transfer) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_create_transfer_request', {
        p_tenant: tenantId,
        p_from_location: transfer.from_location_id,
        p_to_location: transfer.to_location_id,
        p_variant: transfer.variant_id,
        p_quantity: transfer.quantity,
        p_unit_cost: transfer.unit_cost || 0,
        p_created_by: transfer.created_by,
        p_note: transfer.note || null
      })
      if (error) throw error

      // Refrescar alertas despues de salida en origen
      await this.refreshStockAlerts()

      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Obtener traslados en transito pendientes de recepcion
  async getPendingTransfers(tenantId, toLocationId = null) {
    try {
      let query = supabaseService.client
        .from('transfer_requests')
        .select(`
          transfer_id,
          tenant_id,
          from_location_id,
          to_location_id,
          variant_id,
          quantity,
          unit_cost,
          status,
          note,
          created_at,
          from_location:from_location_id(name),
          to_location:to_location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            product:product_id(name)
          ),
          created_by_user:created_by(full_name)
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'IN_TRANSIT')
        .order('created_at', { ascending: false })
        .limit(200)

      if (toLocationId) query = query.eq('to_location_id', toLocationId)

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  // Recibir traslado en destino
  async receiveTransfer(tenantId, transferId, receivedBy, note = null) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_receive_transfer_request', {
        p_tenant: tenantId,
        p_transfer_id: transferId,
        p_received_by: receivedBy,
        p_note: note
      })
      if (error) throw error

      await this.refreshStockAlerts()

      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Crear ingreso por compra
  async createPurchaseEntry(tenantId, entry) {
    try {
      const { data, error } = await supabaseService.insert(this.movesTable, {
        tenant_id: tenantId,
        move_type: 'PURCHASE_IN',
        location_id: entry.location_id,
        variant_id: entry.variant_id,
        quantity: entry.quantity,
        unit_cost: entry.unit_cost || 0,
        source: 'PURCHASE',
        note: entry.note || null,
        created_by: entry.created_by
      })

      if (error) throw error

      await supabaseService.client.rpc('fn_apply_stock_delta', {
        p_tenant: tenantId,
        p_location: entry.location_id,
        p_variant: entry.variant_id,
        p_delta: entry.quantity
      })

      // Refrescar alertas después de entrada por compra
      await this.refreshStockAlerts()

      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async adjustInitialStock({ tenant_id, location_code, variant_id, quantity, unit_cost }) {
    if (!tenant_id || !variant_id || !location_code) {
      throw new Error('tenant_id, location_code y variant_id son necesarios para ajustar stock inicial')
    }

    const quantityNumber = Number(quantity)
    if (Number.isNaN(quantityNumber) || quantityNumber <= 0) {
      return { success: true, warning: 'Cantidad inicial debe ser mayor a cero' }
    }

    const locationValue = location_code.trim()
    const locationSearch = await supabaseService.client
      .from('locations')
      .select('location_id')
      .eq('tenant_id', tenant_id)
      .ilike('name', locationValue)
      .eq('is_active', true)
      .limit(1)

    if (locationSearch.error) throw locationSearch.error

    const locationId = locationSearch.data?.[0]?.location_id

    if (!locationId) {
      throw new Error(`Ubicación "${location_code}" no encontrada. Verifica que exista y esté activa.`)
    }

    const { data: moveData, error: moveError } = await supabaseService.insert(this.movesTable, {
      tenant_id,
      move_type: 'INITIAL_STOCK',
      location_id: locationId,
      variant_id,
      quantity: quantityNumber,
      unit_cost: unit_cost || 0,
      source: 'BULK_IMPORT',
      note: 'Stock inicial vía importación masiva'
    })

    if (moveError) throw moveError

    const { error: stockErr } = await supabaseService.client.rpc('fn_apply_stock_delta', {
      p_tenant: tenant_id,
      p_location: locationId,
      p_variant: variant_id,
      p_delta: quantityNumber
    })

    if (stockErr) throw stockErr

    await this.refreshStockAlerts()

    return { success: true, data: moveData[0] }
  }

  // Actualizar stock mínimo
  async updateMinStock(tenantId, variantId, minStock) {
    try {
      const { error } = await supabaseService.client.rpc('fn_update_min_stock', {
        p_tenant: tenantId,
        p_variant: variantId,
        p_min_stock: minStock
      })

      if (error) throw error
      
      // Refrescar alertas después de cambiar stock mínimo
      await this.refreshStockAlerts()
      
      return { success: true }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Obtener productos bajo stock mínimo (con alertas)
  async getStockAlerts(tenantId, filters = {}) {
    try {
      let query = supabaseService.client
        .from('vw_stock_alerts')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('alert_level', ['OUT_OF_STOCK', 'LOW_STOCK', 'NO_AVAILABLE', 'LOW_AVAILABLE'])
        .order('alert_level')
        .order('on_hand')

      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.alert_level) query = query.eq('alert_level', filters.alert_level)

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      if (this._isMissingStockAlertsView(error)) {
        console.warn('vw_stock_alerts no existe en Supabase; usando fallback desde stock_balances')
        try {
          return await this._getStockAlertsFallback(tenantId, filters)
        } catch (fallbackError) {
          return serviceErrorResult(fallbackError, { data: [] })
        }
      }
      return serviceErrorResult(error, { data: [] })
    }
  }

  // Obtener historial de alertas
  async getAlertLog(tenantId, page = 1, pageSize = 50, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from('stock_alert_log')
        .select(`
          *,
          location:location_id(name),
          variant:variant_id(
            sku, variant_name,
            product:product_id(name)
          )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.alert_level) query = query.eq('alert_level', filters.alert_level)

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }
}

export default new InventoryService()
