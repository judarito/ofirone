import supabaseService from './supabase.service'
import salesForecastService from './sales-forecast.service'
import queryCache from '@/utils/queryCache'
import tenantBillingService from './tenantBilling.service'
import { validateSalePayloadDiscounts } from '@/utils/saleCalculator'
import { serviceErrorResult } from '@/utils/appErrors'

class SalesService {
  constructor() {
    this.table = 'sales'
    this.linesTable = 'sale_lines'
    this.paymentsTable = 'sale_payments'
    this.returnsTable = 'sale_returns'
    this.returnLinesTable = 'sale_return_lines'
  }

  isManualSaleDatetimeRpcError(error) {
    const message = String(error?.message || error || '').toLowerCase()
    return message.includes('p_sold_at') || (
      message.includes('sp_create_sale') &&
      (
        message.includes('schema cache') ||
        message.includes('could not choose the best candidate function')
      )
    )
  }

  isSaleCounterRlsError(error) {
    const message = String(error?.message || error || '').toLowerCase()
    return message.includes('sale_counters') && message.includes('row-level security')
  }

  invalidateOperationalCaches(tenantId) {
    queryCache.invalidateByTags(['reports', 'dashboard-summary', 'sales'], { tenantId })
  }

  validateSaleDiscounts(lines = []) {
    return validateSalePayloadDiscounts(lines)
  }

  // Crear venta usando SP atómico
  async createSale(tenantId, saleData) {
    try {
      const billingResult = await tenantBillingService.getTenantBillingSummary(tenantId)
      if (billingResult.success && billingResult.data && billingResult.data.can_operate_sales === false) {
        return {
          success: false,
          error: billingResult.data.banner_message || 'La suscripción actual no permite registrar ventas',
        }
      }

      const discountValidation = this.validateSaleDiscounts(saleData?.lines || [])
      if (!discountValidation.valid) {
        return {
          success: false,
          error: discountValidation.error,
        }
      }

      const soldAt = saleData?.sold_at ? new Date(saleData.sold_at) : null
      const normalizedSoldAt = soldAt && !Number.isNaN(soldAt.getTime())
        ? soldAt.toISOString()
        : null

      const buildRpcPayload = (includeSoldAt = true) => {
        const payload = {
          p_tenant: tenantId,
          p_location: saleData.location_id,
          p_cash_session: saleData.cash_session_id || null,
          p_customer: saleData.customer_id || null,
          p_sold_by: saleData.sold_by,
          p_lines: saleData.lines,
          p_payments: saleData.payments,
          p_note: saleData.note || null,
          p_third_party: saleData.third_party_id || null
        }

        if (includeSoldAt) {
          // Siempre enviar p_sold_at para desambiguar la sobrecarga del RPC
          // cuando coexisten versiones legacy y extendidas de sp_create_sale.
          payload.p_sold_at = normalizedSoldAt
        }

        return payload
      }

      const executeCreateSale = async (payload) => {
        const { data, error } = await supabaseService.client.rpc('sp_create_sale', payload)
        if (error) throw error
        return data
      }

      let data
      try {
        data = await executeCreateSale(buildRpcPayload(true))
      } catch (error) {
        if (!this.isManualSaleDatetimeRpcError(error)) throw error

        console.warn('[sales] sp_create_sale legacy sin p_sold_at; creando venta sin fecha manual')
        data = await executeCreateSale(buildRpcPayload(false))
      }

      this.invalidateOperationalCaches(tenantId)
      return { success: true, data: { sale_id: data } }
    } catch (error) {
      if (this.isSaleCounterRlsError(error)) {
        return {
          success: false,
          error: 'La base de datos bloqueó el consecutivo de venta por RLS en sale_counters. Ejecuta la migración FIX_SALE_COUNTERS_RLS.sql y vuelve a intentar.',
        }
      }
      return serviceErrorResult(error)
    }
  }

  // Obtener ventas con paginación
  async getSales(tenantId, page = 1, pageSize = 10, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.table)
        .select(`
          sale_id, sale_number, location_id, customer_id, sold_by, third_party_id,
          subtotal, discount_total, tax_total, total, status, sold_at,
          location:location_id(name),
          customer:customer_id(full_name, document),
          sold_by_user:sold_by(full_name),
          third_party:third_party_id(legal_name, document_number, document_type, dv)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('sold_at', { ascending: false })
        .range(from, to)

      if (filters.status) query = query.eq('status', filters.status)
      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.from_date) query = query.gte('sold_at', filters.from_date)
      if (filters.to_date) query = query.lte('sold_at', filters.to_date)

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  // Obtener detalle de venta
  async getSaleById(tenantId, saleId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.table)
        .select(`
          *,
          location:location_id(name),
          customer:customer_id(full_name, document, phone),
          sold_by_user:sold_by(full_name),
          third_party:third_party_id(legal_name, document_number, document_type, dv, fiscal_email, phone),
          resolution:resolution_id(prefix, resolution_number, document_type),
          sale_lines(
            sale_line_id, quantity, unit_price, unit_cost,
            discount_amount, tax_amount, line_total, tax_detail,
            variant:variant_id(sku, variant_name, product:product_id(name))
          ),
          sale_payments(
            sale_payment_id, amount, reference, paid_at,
            payment_method:payment_method_id(code, name)
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('sale_id', saleId)
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Anular venta
  async voidSale(tenantId, saleId) {
    try {
      const { data, error } = await supabaseService.update(this.table, {
        status: 'VOIDED'
      }, { tenant_id: tenantId, sale_id: saleId })

      if (error) throw error
      this.invalidateOperationalCaches(tenantId)
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Crear devolución usando SP
  async createReturn(tenantId, returnData) {
    if (Array.isArray(returnData.refunds) && returnData.refunds.length > 0) {
      return this.createReturnV2(tenantId, returnData)
    }

    try {
      const { data, error } = await supabaseService.client.rpc('sp_create_return', {
        p_tenant: tenantId,
        p_sale_id: returnData.sale_id,
        p_created_by: returnData.created_by,
        p_lines: returnData.lines,
        p_reason: returnData.reason || null
      })

      if (error) throw error
      this.invalidateOperationalCaches(tenantId)
      return { success: true, data: { return_id: data } }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async createReturnV2(tenantId, returnData) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_create_return_v2', {
        p_tenant: tenantId,
        p_sale_id: returnData.sale_id,
        p_created_by: returnData.created_by,
        p_lines: returnData.lines,
        p_refunds: returnData.refunds,
        p_reason: returnData.reason || null
      })

      if (error) throw error
      this.invalidateOperationalCaches(tenantId)
      return { success: true, data: { return_id: data } }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Obtener devoluciones
  async getReturns(tenantId, page = 1, pageSize = 10) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await supabaseService.client
        .from(this.returnsTable)
        .select(`
          return_id, sale_id, location_id, created_by, refund_total, reason, created_at,
          sale:sales!sale_returns_sale_id_fkey(sale_number, total),
          location:locations!sale_returns_location_id_fkey(name),
          created_by_user:users!sale_returns_created_by_fkey(full_name)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  /**
   * Obtiene histórico de ventas para análisis de pronóstico
   * @param {string} tenantId - ID del tenant
   * @param {string} locationId - ID de la sede (opcional)
   * @param {number} daysBack - Días hacia atrás (default: 90)
   * @returns {Promise<Object>} Datos históricos formateados
   */
  async getSalesForecastData(tenantId, locationId = null, daysBack = 90) {
    try {
      const { data, error } = await supabaseService.client.rpc('fn_get_sales_forecast_data', {
        p_tenant_id: tenantId,
        p_location_id: locationId,
        p_days_back: daysBack
      })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error obteniendo datos de pronóstico:', error)
      return serviceErrorResult(error, { data: [] })
    }
  }

  /**
   * Genera pronóstico de ventas usando IA (DeepSeek)
   * @param {string} tenantId - ID del tenant
   * @param {string} locationId - ID de la sede (opcional)
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} Pronóstico con insights y recomendaciones
   */
  async generateSalesForecast(tenantId, locationId = null, options = {}) {
    try {
      // 1. Obtener datos históricos
      const historicalResult = await this.getSalesForecastData(tenantId, locationId, options.daysBack || 90)
      
      if (!historicalResult.success) {
        throw new Error(historicalResult.error)
      }

      const historicalData = historicalResult.data

      // Validar que haya suficientes datos
      if (!historicalData || historicalData.length < 14) {
        return {
          success: false,
          error: 'No hay suficientes datos históricos (se requieren al menos 14 días)',
          data: null
        }
      }

      // 2. Verificar si IA está disponible
      if (!salesForecastService.isAvailable()) {
        console.warn('IA no disponible, generando pronóstico fallback')
        const fallbackResult = salesForecastService.generateFallbackForecast(historicalData)
        return {
          success: true,
          data: fallbackResult.forecast,
          is_fallback: true
        }
      }

      // 3. Generar pronóstico con IA
      const forecastResult = await salesForecastService.generateForecast(
        tenantId,
        locationId,
        historicalData,
        options
      )

      return {
        success: true,
        data: forecastResult.forecast,
        raw_response: forecastResult.raw_response
      }
    } catch (error) {
      console.error('Error generando pronóstico:', error)
      return serviceErrorResult(error, { data: null })
    }
  }
}

export default new SalesService()
