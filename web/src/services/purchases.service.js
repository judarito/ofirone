import supabaseService from './supabase.service'
import aiPurchaseAdvisor from './ai-purchase-advisor.service'

class PurchasesService {
  /**
   * Obtener sugerencias inteligentes de compra
   * @param {string} tenantId - ID del tenant
   * @param {number} minPriority - Prioridad mínima (1=Crítico, 2=Alto, 3=Medio)
   * @param {number} limit - Límite de resultados
   */
  async getPurchaseSuggestions(tenantId, minPriority = 3, limit = 50) {
    try {
      const { data, error } = await supabaseService.client.rpc('fn_get_purchase_suggestions', {
        p_tenant_id: tenantId,
        p_min_priority: minPriority,
        p_limit: limit
      })

      if (error) throw error

      return {
        success: true,
        data: data || []
      }
    } catch (error) {
      console.error('Error getting purchase suggestions:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Obtener análisis de rotación de inventario
   * @param {string} tenantId - ID del tenant
   */
  async getInventoryRotationAnalysis(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_inventory_rotation_analysis')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('days_of_stock_remaining', { ascending: true, nullsFirst: false })
        .limit(100)

      if (error) throw error

      return {
        success: true,
        data: data || []
      }
    } catch (error) {
      console.error('Error getting inventory rotation analysis:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Obtener análisis de IA para sugerencias de compra
   * @param {string} tenantId - ID del tenant
   * @param {Object} options - Opciones del análisis
   * @param {string} options.businessContext - Contexto del negocio
   * @param {number} options.maxBudget - Presupuesto máximo disponible
   * @param {number} options.priorityLevel - Nivel de prioridad mínimo
   */
  async getAIPurchaseAnalysis(tenantId, options = {}) {
    try {
      if (!aiPurchaseAdvisor.isAvailable()) {
        return {
          success: false,
          error: 'Servicio de IA no disponible. Verifique la Edge Function deepseek-proxy y su secreto DEEPSEEK_API_KEY.'
        }
      }

      // Obtener datos base
      const [suggestionsResult, rotationResult] = await Promise.all([
        this.getPurchaseSuggestions(tenantId, options.priorityLevel || 3, 100),
        this.getInventoryRotationAnalysis(tenantId)
      ])

      if (!suggestionsResult.success || !rotationResult.success) {
        throw new Error('Error obteniendo datos base para análisis')
      }

      // Llamar a la IA para análisis avanzado
      const aiAnalysis = await aiPurchaseAdvisor.generatePurchaseRecommendations(
        tenantId,
        rotationResult.data,
        suggestionsResult.data,
        options
      )

      // Generar resumen ejecutivo
      const executiveSummary = aiPurchaseAdvisor.generateExecutiveSummary(aiAnalysis)

      return {
        success: true,
        data: {
          ...aiAnalysis,
          executive_summary: executiveSummary,
          base_suggestions: suggestionsResult.data,
          analysis_timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      console.error('Error getting AI purchase analysis:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Verificar si el servicio de IA está disponible
   */
  isAIAvailable() {
    return aiPurchaseAdvisor.isAvailable()
  }

  /**
   * Obtener historial de compras con paginación
   * @param {string} tenantId - ID del tenant
   * @param {number} page - Página actual
   * @param {number} pageSize - Tamaño de página
   * @param {Object} filters - Filtros opcionales
   */
  async getPurchases(tenantId, page = 1, pageSize = 20, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from('inventory_moves')
        .select(`
          inventory_move_id,
          move_type,
          location_id,
          variant_id,
          quantity,
          unit_cost,
          created_at,
          note,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            product:product_id(name)
          ),
          created_by_user:created_by(full_name)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('move_type', 'PURCHASE_IN')
        .order('created_at', { ascending: false })
        .range(from, to)

      if (filters.location_id) {
        query = query.eq('location_id', filters.location_id)
      }
      if (filters.from_date) {
        query = query.gte('created_at', filters.from_date)
      }
      if (filters.to_date) {
        query = query.lte('created_at', filters.to_date)
      }

      const { data, error, count } = await query

      if (error) throw error

      // Transformar datos para mejor acceso
      const purchases = (data || []).map(item => ({
        purchase_id: item.inventory_move_id,
        sku: item.variant?.sku || '',
        variant_name: item.variant?.variant_name || '',
        product_name: item.variant?.product?.name || '',
        location_name: item.location?.name || '',
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        line_total: item.quantity * item.unit_cost,
        purchased_at: item.created_at,
        purchased_by_name: item.created_by_user?.full_name || '',
        note: item.note,
        // Para compatibilidad con cálculo de precio actual
        current_price: item.variant?.price || 0
      }))

      return {
        success: true,
        data: purchases,
        total: count || 0
      }
    } catch (error) {
      console.error('Error getting purchases:', error)
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      }
    }
  }

  /**
   * Obtener detalle completo de una compra con todas sus líneas
   * @param {string} tenantId - ID del tenant
   * @param {string} purchaseId - ID de la compra (source_id)
   */
  async getPurchaseDetail(tenantId, purchaseId) {
    try {
      // Obtener cabecera de la compra (incluye proveedor)
      const { data: header } = await supabaseService.client
        .from('purchases')
        .select(`
          purchase_id, note, total, created_at,
          location:location_id(name),
          supplier:supplier_id(third_party_id, legal_name, trade_name, phone, document_number),
          created_by_user:created_by(full_name)
        `)
        .eq('tenant_id', tenantId)
        .eq('purchase_id', purchaseId)
        .maybeSingle()

      const { data, error } = await supabaseService.client
        .from('inventory_moves')
        .select(`
          inventory_move_id,
          move_type,
          location_id,
          variant_id,
          quantity,
          unit_cost,
          created_at,
          note,
          source_id,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            product:product_id(name)
          ),
          created_by_user:created_by(full_name)
        `)
        .eq('tenant_id', tenantId)
        .eq('move_type', 'PURCHASE_IN')
        .eq('source_id', purchaseId)
        .order('created_at', { ascending: true })

      if (error) throw error

      const { data: returnSummary } = await supabaseService.client
        .from('purchase_return_lines')
        .select('source_inventory_move_id, qty')
        .eq('tenant_id', tenantId)
        .eq('purchase_id', purchaseId)

      const returnedBySourceLine = (returnSummary || []).reduce((acc, row) => {
        const key = row.source_inventory_move_id
        const current = Number(acc[key] || 0)
        acc[key] = current + Number(row.qty || 0)
        return acc
      }, {})

      const { data: returnsList } = await supabaseService.client
        .from('purchase_returns')
        .select(`
          purchase_return_id,
          note,
          total,
          created_at,
          created_by_user:created_by(full_name)
        `)
        .eq('tenant_id', tenantId)
        .eq('purchase_id', purchaseId)
        .order('created_at', { ascending: false })

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Compra no encontrada'
        }
      }

      const firstLine = data[0]

      const lines = data.map(item => ({
        line_id: item.inventory_move_id,
        variant_id: item.variant_id,
        sku: item.variant?.sku || '',
        variant_name: item.variant?.variant_name || '',
        product_name: item.variant?.product?.name || '',
        quantity: item.quantity,
        returned_qty: Number(returnedBySourceLine[item.inventory_move_id] || 0),
        returnable_qty: Math.max(Number(item.quantity || 0) - Number(returnedBySourceLine[item.inventory_move_id] || 0), 0),
        unit_cost: item.unit_cost,
        line_total: item.quantity * item.unit_cost
      }))

      const total = lines.reduce((sum, line) => sum + line.line_total, 0)

      return {
        success: true,
        data: {
          purchase_id: purchaseId,
          location_id: firstLine.location_id,
          location_name: header?.location?.name || firstLine.location?.name || '',
          created_at: header?.created_at || firstLine.created_at,
          created_by_name: header?.created_by_user?.full_name || firstLine.created_by_user?.full_name || '',
          note: header?.note || firstLine.note || '',
          supplier: header?.supplier || null,
          lines,
          returns: returnsList || [],
          total: header?.total || total,
          items_count: lines.length
        }
      }
    } catch (error) {
      console.error('Error getting purchase detail:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Crear orden de compra en estado DRAFT (sin afectar inventario).
   * @param {Object} payload
   * @param {string} payload.tenantId
   * @param {string} payload.locationId
   * @param {string|null} payload.supplierId
   * @param {string} payload.createdBy
   * @param {Array} payload.lines
   * @param {string|null} payload.note
   */
  async createPurchaseOrder({ tenantId, locationId, supplierId = null, createdBy, lines, note = null }) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_create_purchase_order', {
        p_tenant: tenantId,
        p_location: locationId,
        p_supplier_id: supplierId,
        p_created_by: createdBy,
        p_lines: lines,
        p_note: note
      })

      if (error) throw error

      return {
        success: true,
        data
      }
    } catch (error) {
      console.error('Error creating purchase order:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Obtener ordenes de compra pendientes por recibir (status DRAFT).
   * @param {string} tenantId
   */
  async getOpenPurchaseOrders(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          tenant_id,
          location_id,
          supplier_id,
          status,
          note,
          total,
          created_at,
          location:location_id(name),
          supplier:supplier_id(third_party_id, legal_name, trade_name, document_number),
          lines:purchase_order_lines(
            purchase_order_line_id,
            variant_id,
            qty_ordered,
            qty_received,
            unit_cost,
            batch_number,
            expiration_date,
            physical_location,
            variant:variant_id(
              sku,
              variant_name,
              product:product_id(name)
            )
          )
        `)
        .eq('tenant_id', tenantId)
        .in('status', ['DRAFT', 'PARTIAL'])
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error

      const mapped = (data || []).map(order => ({
        ...order,
        lines_count: order.lines?.length || 0,
        pending_lines_count: order.lines?.filter(line => Number(line.qty_received || 0) < Number(line.qty_ordered || 0)).length || 0,
        computed_total: order.lines?.reduce((sum, line) => {
          return sum + (Number(line.qty_ordered || 0) * Number(line.unit_cost || 0))
        }, 0) || 0,
        lines: (order.lines || []).map(line => ({
          ...line,
          qty_received: Number(line.qty_received || 0),
          qty_remaining: Math.max(Number(line.qty_ordered || 0) - Number(line.qty_received || 0), 0)
        }))
      }))

      return {
        success: true,
        data: mapped
      }
    } catch (error) {
      console.error('Error getting open purchase orders:', error)
      return {
        success: false,
        error: error.message,
        data: []
      }
    }
  }

  /**
   * Recibir una orden de compra DRAFT y convertirla en compra de inventario.
   * @param {Object} payload
   * @param {string} payload.tenantId
   * @param {string} payload.purchaseOrderId
   * @param {string} payload.createdBy
   * @param {string|null} payload.note
   */
  async receivePurchaseOrder({ tenantId, purchaseOrderId, createdBy, note = null }) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_receive_purchase_order', {
        p_tenant: tenantId,
        p_purchase_order_id: purchaseOrderId,
        p_created_by: createdBy,
        p_note: note
      })

      if (error) throw error

      return {
        success: true,
        data
      }
    } catch (error) {
      console.error('Error receiving purchase order:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Recibir parcialmente una orden de compra.
   * @param {Object} payload
   * @param {string} payload.tenantId
   * @param {string} payload.purchaseOrderId
   * @param {string} payload.createdBy
   * @param {Array} payload.lines
   * @param {string|null} payload.note
   */
  async receivePurchaseOrderPartial({ tenantId, purchaseOrderId, createdBy, lines, note = null }) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_receive_purchase_order_partial', {
        p_tenant: tenantId,
        p_purchase_order_id: purchaseOrderId,
        p_created_by: createdBy,
        p_lines: lines,
        p_note: note
      })

      if (error) throw error

      return {
        success: true,
        data
      }
    } catch (error) {
      console.error('Error receiving purchase order partially:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Crear devolucion a proveedor para una compra.
   * @param {Object} payload
   * @param {string} payload.tenantId
   * @param {string} payload.purchaseId
   * @param {string} payload.createdBy
   * @param {Array} payload.lines
   * @param {string|null} payload.note
   */
  async createPurchaseReturn({ tenantId, purchaseId, createdBy, lines, note = null }) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_create_purchase_return', {
        p_tenant: tenantId,
        p_purchase_id: purchaseId,
        p_created_by: createdBy,
        p_lines: lines,
        p_note: note
      })

      if (error) throw error

      return {
        success: true,
        data
      }
    } catch (error) {
      console.error('Error creating purchase return:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Obtener cuenta por pagar asociada a una compra.
   * @param {string} tenantId
   * @param {string} purchaseId
   */
  async getSupplierPayableByPurchase(tenantId, purchaseId) {
    try {
      const { data, error } = await supabaseService.client
        .from('supplier_payables')
        .select(`
          payable_id,
          tenant_id,
          supplier_id,
          purchase_id,
          invoice_number,
          due_date,
          total_amount,
          paid_amount,
          balance,
          status,
          note,
          created_at,
          updated_at,
          supplier:supplier_id(third_party_id, legal_name, document_number),
          payments:supplier_payable_payments(
            payable_payment_id,
            amount,
            payment_method,
            note,
            created_at,
            created_by_user:created_by(full_name)
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('purchase_id', purchaseId)
        .maybeSingle()

      if (error) throw error

      return {
        success: true,
        data: data || null
      }
    } catch (error) {
      console.error('Error getting supplier payable by purchase:', error)
      return {
        success: false,
        error: error.message,
        data: null
      }
    }
  }

  /**
   * Crear cuenta por pagar para una compra.
   * @param {Object} payload
   */
  async createSupplierPayable({ tenantId, purchaseId, createdBy, dueDate = null, invoiceNumber = null, note = null }) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_create_supplier_payable', {
        p_tenant: tenantId,
        p_purchase_id: purchaseId,
        p_created_by: createdBy,
        p_due_date: dueDate,
        p_invoice_number: invoiceNumber,
        p_note: note
      })

      if (error) throw error

      return {
        success: true,
        data
      }
    } catch (error) {
      console.error('Error creating supplier payable:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Registrar abono en cuenta por pagar.
   * @param {Object} payload
   */
  async registerSupplierPayment({ tenantId, payableId, amount, createdBy, paymentMethod = null, note = null }) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_register_supplier_payment', {
        p_tenant: tenantId,
        p_payable_id: payableId,
        p_amount: amount,
        p_created_by: createdBy,
        p_payment_method: paymentMethod,
        p_note: note
      })

      if (error) throw error

      return {
        success: true,
        data
      }
    } catch (error) {
      console.error('Error registering supplier payment:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Obtener bandeja global de cuentas por pagar a proveedores.
   * @param {Object} payload
   * @param {string} payload.tenantId
   * @param {string} [payload.status='OPEN_PARTIAL'] - ALL | OPEN_PARTIAL | OPEN | PARTIAL | PAID | CANCELLED
   * @param {number|null} [payload.dueInDays=null] - incluir facturas con vencimiento <= hoy + n dias
   * @param {number} [payload.page=1] - pagina actual
   * @param {number} [payload.pageSize=20] - tamano de pagina
   */
  async getSupplierPayablesDashboard({
    tenantId,
    status = 'OPEN_PARTIAL',
    dueInDays = null,
    page = 1,
    pageSize = 20
  }) {
    try {
      const safePage = Number.isInteger(page) && page > 0 ? page : 1
      const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 20
      const from = (safePage - 1) * safePageSize
      const to = from + safePageSize - 1

      let query = supabaseService.client
        .from('supplier_payables')
        .select(`
          payable_id,
          purchase_id,
          supplier_id,
          invoice_number,
          due_date,
          total_amount,
          paid_amount,
          balance,
          status,
          created_at,
          purchase:purchase_id(
            location_id,
            location:location_id(name)
          ),
          supplier:supplier_id(
            legal_name,
            trade_name
          )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)

      if (status === 'OPEN_PARTIAL') {
        query = query.in('status', ['OPEN', 'PARTIAL'])
      } else if (status && status !== 'ALL') {
        query = query.eq('status', status)
      }

      if (dueInDays !== null && dueInDays !== undefined) {
        const baseDate = new Date()
        const untilDate = new Date(baseDate)
        untilDate.setDate(baseDate.getDate() + Number(dueInDays))
        const untilDateStr = untilDate.toISOString().slice(0, 10)
        query = query.not('due_date', 'is', null).lte('due_date', untilDateStr)
      }

      const { data, error, count } = await query
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const mapped = (data || []).map(row => {
        const dueDate = row.due_date ? new Date(`${row.due_date}T00:00:00`) : null
        const daysToDue = dueDate
          ? Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          : null

        return {
          ...row,
          supplier_name: row.supplier?.trade_name || row.supplier?.legal_name || 'Proveedor',
          location_id: row.purchase?.location_id || null,
          location_name: row.purchase?.location?.name || 'Sin sede',
          days_to_due: daysToDue,
          is_overdue: dueDate ? dueDate.getTime() < today.getTime() : false
        }
      })

      return {
        success: true,
        data: mapped,
        total: count || 0
      }
    } catch (error) {
      console.error('Error getting supplier payables dashboard:', error)
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      }
    }
  }
}

export default new PurchasesService()

