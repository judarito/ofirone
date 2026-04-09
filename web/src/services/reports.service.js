import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

const DASHBOARD_SUMMARY_TTL_MS = 60 * 1000
const getDateKey = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().substring(0, 10)
}

class ReportsService {
  constructor() {
    // Las políticas RLS en las tablas sales, sale_lines, etc. ya filtran por rol
    this.salesTable = 'sales'
    this.saleLinesTable = 'sale_lines'
    this.salePaymentsTable = 'sale_payments'
    this.saleReturnsTable = 'sale_returns'
    this.cashSessionsTable = 'cash_sessions'
    this.cashMovementsTable = 'cash_movements'
  }

  // Resumen de ventas por período
  async getSalesSummary(tenantId, fromDate, toDate, locationId = null) {
    try {
      // Las políticas RLS de sales ya filtran por rol automáticamente
      let query = supabaseService.client
        .from('sales')
        .select('sale_id, subtotal, discount_total, tax_total, total, status, sold_at')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', fromDate)
        .lte('sold_at', toDate)

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error

      const summary = {
        total_sales: (data || []).length,
        gross_subtotal: 0,
        gross_discount: 0,
        gross_tax: 0,
        gross_total: 0,
        returns_total: 0,
        net_total: 0
      }

      ;(data || []).forEach(s => {
        const subtotal = parseFloat(s.subtotal) || 0
        const discount = parseFloat(s.discount_total) || 0
        const tax = parseFloat(s.tax_total) || 0
        const total = parseFloat(s.total) || 0

        if (s.status === 'RETURNED' || s.status === 'PARTIAL_RETURN') {
          summary.returns_total += Math.abs(total)
          return
        }

        summary.gross_subtotal += subtotal
        summary.gross_discount += discount
        summary.gross_tax += tax
        summary.gross_total += total
      })

      summary.net_total = summary.gross_total - summary.returns_total

      return { success: true, data: summary }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Ventas agrupadas por día
  async getSalesByDay(tenantId, fromDate, toDate, locationId = null) {
    try {
      let query = supabaseService.client
        .from(this.salesTable)
        .select('sold_at, total, status')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', fromDate)
        .lte('sold_at', toDate)
        .order('sold_at', { ascending: true })

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error

      const byDay = {}
      ;(data || []).forEach(s => {
        const day = getDateKey(s.sold_at)
        if (!day) return
        if (!byDay[day]) byDay[day] = { date: day, count: 0, gross_total: 0, returns_total: 0, net_total: 0 }
        byDay[day].count++
        const total = parseFloat(s.total) || 0
        
        if (s.status === 'RETURNED' || s.status === 'PARTIAL_RETURN') {
          byDay[day].returns_total += Math.abs(total)
          return
        }

        byDay[day].gross_total += total
      })

      // Calcular neto
      Object.values(byDay).forEach(d => {
        d.net_total = d.gross_total - d.returns_total
      })

      return { success: true, data: Object.values(byDay) }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Productos más vendidos
  async getTopProducts(tenantId, fromDate, toDate, limit = 20) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.saleLinesTable)
        .select(`
          variant_id, quantity, line_total,
          variant:variant_id(
            sku, variant_name, cost,
            product:product_id(name)
          ),
          sale:sale_id!inner(tenant_id, status, sold_at)
        `)
        .eq('sale.tenant_id', tenantId)
        .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sale.sold_at', fromDate)
        .lte('sale.sold_at', toDate)

      if (error) throw error

      // Agrupar por variante
      const grouped = {}
      ;(data || []).forEach(line => {
        const key = line.variant_id
        if (!grouped[key]) {
          grouped[key] = {
            variant_id: key,
            sku: line.variant?.sku,
            product_name: line.variant?.product?.name,
            variant_name: line.variant?.variant_name,
            total_qty: 0,
            total_revenue: 0,
            total_cost: 0
          }
        }
        grouped[key].total_qty += parseFloat(line.quantity) || 0
        grouped[key].total_revenue += parseFloat(line.line_total) || 0
        grouped[key].total_cost += (parseFloat(line.variant?.cost) || 0) * (parseFloat(line.quantity) || 0)
      })

      const sorted = Object.values(grouped)
        .sort((a, b) => b.total_qty - a.total_qty)
        .slice(0, limit)
        .map(p => ({ ...p, profit: p.total_revenue - p.total_cost }))

      return { success: true, data: sorted }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Ventas por vendedor
  async getSalesBySeller(tenantId, fromDate, toDate) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.salesTable)
        .select('sold_by, total, sold_by_user:sold_by(full_name)')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', fromDate)
        .lte('sold_at', toDate)

      if (error) throw error

      const grouped = {}
      ;(data || []).forEach(s => {
        if (!grouped[s.sold_by]) {
          grouped[s.sold_by] = { user_id: s.sold_by, name: s.sold_by_user?.full_name, count: 0, total: 0 }
        }
        grouped[s.sold_by].count++
        grouped[s.sold_by].total += parseFloat(s.total) || 0
      })

      return { success: true, data: Object.values(grouped).sort((a, b) => b.total - a.total) }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Ventas por método de pago
  async getSalesByPaymentMethod(tenantId, fromDate, toDate) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.salePaymentsTable)
        .select(`
          amount,
          payment_method:payment_method_id(code, name),
          sale:sale_id!inner(tenant_id, status, sold_at)
        `)
        .eq('sale.tenant_id', tenantId)
        .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sale.sold_at', fromDate)
        .lte('sale.sold_at', toDate)

      if (error) throw error

      const grouped = {}
      ;(data || []).forEach(p => {
        const code = p.payment_method?.code || 'N/A'
        if (!grouped[code]) {
          grouped[code] = { code, name: p.payment_method?.name, count: 0, total: 0 }
        }
        grouped[code].count++
        grouped[code].total += parseFloat(p.amount) || 0
      })

      return { success: true, data: Object.values(grouped).sort((a, b) => b.total - a.total) }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Movimientos de caja (gastos e ingresos)
  async getCashMovements(tenantId, fromDate, toDate, locationId = null, type = null) {
    try {
      let query = supabaseService.client
        .from(this.cashMovementsTable)
        .select(`
          cash_movement_id,
          type,
          category,
          amount,
          note,
          created_at,
          created_by_user:created_by(full_name),
          session:cash_session_id(
            cash_register:cash_register_id(name, location:location_id(name))
          )
        `)
        .eq('tenant_id', tenantId)
        .gte('created_at', fromDate)
        .lte('created_at', toDate)
        .order('created_at', { ascending: false })

      if (type) query = query.eq('type', type)
      
      // Filtrar por location si se especifica
      const { data, error } = await query
      if (error) throw error

      let filteredData = data || []
      
      // Si hay filtro de ubicación, filtrar por la sede de la caja registradora
      if (locationId) {
        filteredData = filteredData.filter(m => 
          m.session?.cash_register?.location?.location_id === locationId
        )
      }

      // Calcular resumen
      const summary = {
        total_income: 0,
        total_expense: 0,
        count_income: 0,
        count_expense: 0,
        net: 0
      }

      filteredData.forEach(m => {
        const amount = parseFloat(m.amount) || 0
        if (m.type === 'INCOME') {
          summary.total_income += amount
          summary.count_income++
        } else {
          summary.total_expense += amount
          summary.count_expense++
        }
      })

      summary.net = summary.total_income - summary.total_expense

      return { success: true, data: filteredData, summary }
    } catch (error) {
      return { success: false, error: error.message, data: [], summary: null }
    }
  }

  // Movimientos agrupados por categoría
  async getCashMovementsByCategory(tenantId, fromDate, toDate, locationId = null) {
    try {
      const r = await this.getCashMovements(tenantId, fromDate, toDate, locationId)
      if (!r.success) return r

      const grouped = {}
      ;(r.data || []).forEach(m => {
        const category = m.category || 'Sin categoría'
        const key = `${m.type}_${category}`
        
        if (!grouped[key]) {
          grouped[key] = {
            type: m.type,
            category,
            count: 0,
            total: 0
          }
        }
        grouped[key].count++
        grouped[key].total += parseFloat(m.amount) || 0
      })

      return { success: true, data: Object.values(grouped).sort((a, b) => b.total - a.total) }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Resumen de plan separe
  async getLayawaySummary(tenantId, fromDate, toDate, locationId = null) {
    try {
      let query = supabaseService.client
        .from('vw_layaway_report')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', fromDate)
        .lte('created_at', toDate)

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error

      const summary = {
        total_contracts: (data || []).length,
        active_contracts: 0,
        completed_contracts: 0,
        cancelled_contracts: 0,
        expired_contracts: 0,
        total_value: 0,
        total_paid: 0,
        total_balance: 0
      }

      ;(data || []).forEach(c => {
        if (c.status === 'ACTIVE') summary.active_contracts++
        if (c.status === 'COMPLETED') summary.completed_contracts++
        if (c.status === 'CANCELLED') summary.cancelled_contracts++
        if (c.status === 'EXPIRED') summary.expired_contracts++
        
        summary.total_value += parseFloat(c.total) || 0
        summary.total_paid += parseFloat(c.paid_total) || 0
        summary.total_balance += parseFloat(c.balance) || 0
      })

      return { success: true, summary, contracts: data || [] }
    } catch (error) {
      return { success: false, error: error.message, summary: null, contracts: [] }
    }
  }

  // Abonos de plan separe
  async getLayawayPayments(tenantId, fromDate, toDate, locationId = null) {
    try {
      let query = supabaseService.client
        .from('vw_layaway_payments_report')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('paid_at', fromDate)
        .lte('paid_at', toDate)
        .order('paid_at', { ascending: false })

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error

      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Reporte de costos de producción (órdenes manufacturadas)
  async getProductionCostReport(tenantId, fromDate, toDate, locationId = null, status = null) {
    try {
      let query = supabaseService.client
        .from('vw_production_cost_report')
        .select('*')
        .eq('tenant_id', tenantId)

      // Filtrar por fecha de finalización
      if (fromDate && toDate) {
        query = query
          .gte('fecha_fin_real', fromDate)
          .lte('fecha_fin_real', toDate)
      }

      if (locationId) query = query.eq('location_id', locationId)
      if (status) query = query.eq('status', status)

      query = query.order('fecha_fin_real', { ascending: false, nullsFirst: false })

      const { data, error } = await query
      if (error) throw error

      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Resumen de costos por producto manufacturado (últimos 90 días)
  async getProductionCostSummary(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_production_cost_summary_by_product')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('total_ordenes', { ascending: false })

      if (error) throw error

      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Top productos manufacturados por margen
  async getTopManufacturedByMargin(tenantId, limit = 10) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_top_manufactured_products_by_margin', {
          p_tenant_id: tenantId,
          p_limit: limit
        })

      if (error) throw error

      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // VENTAS POR CATEGORÍA
  // ─────────────────────────────────────────────────────
  async getSalesByCategory(tenantId, fromDate, toDate, locationId = null) {
    try {
      const { data, error } = await supabaseService.client
        .from('sale_lines')
        .select(`
          quantity, line_total, unit_cost,
          variant:variant_id(
            product:product_id(
              category:category_id(name)
            )
          ),
          sale:sale_id!inner(tenant_id, status, sold_at, location_id)
        `)
        .eq('sale.tenant_id', tenantId)
        .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sale.sold_at', fromDate)
        .lte('sale.sold_at', toDate)

      if (error) throw error

      const grouped = {}
      ;(data || []).forEach(line => {
        if (locationId && line.sale?.location_id !== locationId) return
        const cat = line.variant?.product?.category?.name || 'Sin categoría'
        if (!grouped[cat]) {
          grouped[cat] = { category: cat, qty: 0, revenue: 0, cost: 0 }
        }
        grouped[cat].qty += parseFloat(line.quantity) || 0
        grouped[cat].revenue += parseFloat(line.line_total) || 0
        grouped[cat].cost += (parseFloat(line.unit_cost) || 0) * (parseFloat(line.quantity) || 0)
      })

      const result = Object.values(grouped).map(c => ({
        ...c,
        profit: c.revenue - c.cost,
        margin: c.revenue > 0 ? ((c.revenue - c.cost) / c.revenue * 100).toFixed(1) : 0
      })).sort((a, b) => b.revenue - a.revenue)

      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // INVENTARIO: valor total
  // ─────────────────────────────────────────────────────
  async getInventoryValue(tenantId, locationId = null) {
    try {
      let query = supabaseService.client
        .from('stock_balances')
        .select(`
          on_hand, reserved,
          variant:variant_id(cost, sku, variant_name, product:product_id(name, category:category_id(name))),
          location:location_id(name)
        `)
        .eq('tenant_id', tenantId)
        .gt('on_hand', 0)

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error

      let totalValue = 0
      let totalUnits = 0
      const byCategory = {}

      const rows = (data || []).map(sb => {
        const cost = parseFloat(sb.variant?.cost) || 0
        const qty = parseFloat(sb.on_hand) || 0
        const value = qty * cost
        totalValue += value
        totalUnits += qty

        const cat = sb.variant?.product?.category?.name || 'Sin categoría'
        if (!byCategory[cat]) byCategory[cat] = { category: cat, units: 0, value: 0 }
        byCategory[cat].units += qty
        byCategory[cat].value += value

        return {
          sku: sb.variant?.sku,
          product_name: sb.variant?.product?.name,
          variant_name: sb.variant?.variant_name,
          category: cat,
          location: sb.location?.name,
          on_hand: qty,
          reserved: parseFloat(sb.reserved) || 0,
          available: qty - (parseFloat(sb.reserved) || 0),
          unit_cost: cost,
          total_value: value
        }
      })

      return {
        success: true,
        summary: { total_value: totalValue, total_units: totalUnits },
        by_category: Object.values(byCategory).sort((a, b) => b.value - a.value),
        data: rows.sort((a, b) => b.total_value - a.total_value)
      }
    } catch (error) {
      return { success: false, error: error.message, data: [], summary: null, by_category: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // INVENTARIO: productos sin movimiento (N días)
  // ─────────────────────────────────────────────────────
  async getProductsWithNoMovement(tenantId, days = 30, locationId = null) {
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - days)
      const cutoff = cutoffDate.toISOString()

      // Obtener variantes con stock que NO tuvieron movimento en el período
      let stockQuery = supabaseService.client
        .from('stock_balances')
        .select(`
          variant_id, on_hand, location_id,
          variant:variant_id(sku, variant_name, cost, product:product_id(name, category:category_id(name))),
          location:location_id(name)
        `)
        .eq('tenant_id', tenantId)
        .gt('on_hand', 0)

      if (locationId) stockQuery = stockQuery.eq('location_id', locationId)

      const { data: stockData, error: stockError } = await stockQuery
      if (stockError) throw stockError

      // Obtener variantes que SÍ tuvieron movimiento
      const { data: moveData, error: moveError } = await supabaseService.client
        .from('inventory_moves')
        .select('variant_id')
        .eq('tenant_id', tenantId)
        .gte('created_at', cutoff)

      if (moveError) throw moveError

      const activeVariants = new Set((moveData || []).map(m => m.variant_id))

      const result = (stockData || [])
        .filter(sb => !activeVariants.has(sb.variant_id))
        .map(sb => ({
          sku: sb.variant?.sku,
          product_name: sb.variant?.product?.name,
          variant_name: sb.variant?.variant_name,
          category: sb.variant?.product?.category?.name || 'Sin categoría',
          location: sb.location?.name,
          on_hand: parseFloat(sb.on_hand) || 0,
          unit_cost: parseFloat(sb.variant?.cost) || 0,
          frozen_value: (parseFloat(sb.on_hand) || 0) * (parseFloat(sb.variant?.cost) || 0)
        }))
        .sort((a, b) => b.frozen_value - a.frozen_value)

      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // INVENTARIO: próximos a vencer
  // ─────────────────────────────────────────────────────
  async getProductsExpiringSoon(tenantId, days = 90, locationId = null) {
    try {
      const today = new Date().toISOString().substring(0, 10)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() + days)
      const cutoffStr = cutoff.toISOString().substring(0, 10)

      let query = supabaseService.client
        .from('inventory_batches')
        .select(`
          batch_id, batch_number, expiration_date, quantity_on_hand,
          variant:variant_id(sku, variant_name, cost, product:product_id(name)),
          location:location_id(name)
        `)
        .eq('tenant_id', tenantId)
        .gt('quantity_on_hand', 0)
        .lte('expiration_date', cutoffStr)
        .order('expiration_date', { ascending: true })

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error

      const result = (data || []).map(b => {
        const expDate = new Date(b.expiration_date)
        const todayDate = new Date(today)
        const diff = Math.floor((expDate - todayDate) / (1000 * 60 * 60 * 24))
        return {
          batch_number: b.batch_number,
          expiration_date: b.expiration_date,
          days_to_expiry: diff,
          status: diff < 0 ? 'EXPIRED' : diff <= 7 ? 'CRITICAL' : diff <= 30 ? 'WARNING' : 'NEAR',
          sku: b.variant?.sku,
          product_name: b.variant?.product?.name,
          variant_name: b.variant?.variant_name,
          location: b.location?.name,
          quantity: parseFloat(b.quantity_on_hand) || 0,
          unit_cost: parseFloat(b.variant?.cost) || 0,
          at_risk_value: (parseFloat(b.quantity_on_hand) || 0) * (parseFloat(b.variant?.cost) || 0)
        }
      })

      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // INVENTARIO: por ubicación
  // ─────────────────────────────────────────────────────
  async getInventoryByLocation(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('stock_balances')
        .select(`
          on_hand, location_id,
          variant:variant_id(cost),
          location:location_id(name)
        `)
        .eq('tenant_id', tenantId)
        .gt('on_hand', 0)

      if (error) throw error

      const grouped = {}
      ;(data || []).forEach(sb => {
        const loc = sb.location?.name || sb.location_id
        if (!grouped[loc]) grouped[loc] = { location: loc, units: 0, value: 0, skus: 0 }
        grouped[loc].units += parseFloat(sb.on_hand) || 0
        grouped[loc].value += (parseFloat(sb.on_hand) || 0) * (parseFloat(sb.variant?.cost) || 0)
        grouped[loc].skus++
      })

      return { success: true, data: Object.values(grouped).sort((a, b) => b.value - a.value) }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // PRODUCCIÓN: componentes más utilizados
  // ─────────────────────────────────────────────────────
  async getTopBomComponents(tenantId, fromDate, toDate, locationId = null) {
    try {
      let query = supabaseService.client
        .from('sale_line_components')
        .select(`
          component_variant_id, quantity, total_cost,
          variant:component_variant_id(sku, variant_name, product:product_id(name)),
          sale_line:sale_line_id!inner(
            sale:sale_id!inner(tenant_id, sold_at, location_id)
          )
        `)
        .eq('sale_line.sale.tenant_id', tenantId)
        .gte('sale_line.sale.sold_at', fromDate)
        .lte('sale_line.sale.sold_at', toDate)

      const { data, error } = await query
      if (error) throw error

      const grouped = {}
      ;(data || []).forEach(c => {
        if (locationId && c.sale_line?.sale?.location_id !== locationId) return
        const key = c.component_variant_id
        if (!grouped[key]) {
          grouped[key] = {
            variant_id: key,
            sku: c.variant?.sku,
            product_name: c.variant?.product?.name,
            variant_name: c.variant?.variant_name,
            total_qty: 0,
            total_cost: 0,
            uses: 0
          }
        }
        grouped[key].total_qty += parseFloat(c.quantity) || 0
        grouped[key].total_cost += parseFloat(c.total_cost) || 0
        grouped[key].uses++
      })

      return {
        success: true,
        data: Object.values(grouped).sort((a, b) => b.total_qty - a.total_qty)
      }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // CAJAS: ventas por caja registradora
  // ─────────────────────────────────────────────────────
  async getSalesByCashRegister(tenantId, fromDate, toDate, locationId = null) {
    try {
      let query = supabaseService.client
        .from('sales')
        .select(`
          sale_id, total, sold_at, status,
          session:cash_session_id(
            cash_register:cash_register_id(
              cash_register_id, name, location:location_id(name, location_id)
            )
          )
        `)
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', fromDate)
        .lte('sold_at', toDate)

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error

      const grouped = {}
      ;(data || []).forEach(s => {
        const regId = s.session?.cash_register?.cash_register_id || 'sin_caja'
        const regName = s.session?.cash_register?.name || 'Sin caja'
        const locName = s.session?.cash_register?.location?.name || '-'
        if (!grouped[regId]) {
          grouped[regId] = { cash_register_id: regId, name: regName, location: locName, count: 0, total: 0 }
        }
        grouped[regId].count++
        grouped[regId].total += parseFloat(s.total) || 0
      })

      return { success: true, data: Object.values(grouped).sort((a, b) => b.total - a.total) }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // CAJAS: sesiones de caja con detalles
  // ─────────────────────────────────────────────────────
  async getCashSessionsReport(tenantId, fromDate, toDate, locationId = null) {
    try {
      let query = supabaseService.client
        .from('cash_sessions')
        .select(`
          cash_session_id, status, opened_at, closed_at,
          opening_amount, closing_amount, declared_amount,
          opened_by_user:opened_by(full_name),
          closed_by_user:closed_by(full_name),
          cash_register:cash_register_id(name, location:location_id(name, location_id))
        `)
        .eq('tenant_id', tenantId)
        .gte('opened_at', fromDate)
        .lte('opened_at', toDate)
        .order('opened_at', { ascending: false })

      const { data, error } = await query
      if (error) throw error

      let sessions = data || []
      if (locationId) {
        sessions = sessions.filter(s => s.cash_register?.location?.location_id === locationId)
      }

      // Para cada sesión, obtener total de ventas
      const sessionIds = sessions.map(s => s.cash_session_id)
      let salesTotals = {}

      if (sessionIds.length > 0) {
        const { data: salesData } = await supabaseService.client
          .from('sales')
          .select('cash_session_id, total, status')
          .eq('tenant_id', tenantId)
          .in('cash_session_id', sessionIds)
          .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])

        ;(salesData || []).forEach(s => {
          if (!salesTotals[s.cash_session_id]) {
            salesTotals[s.cash_session_id] = { count: 0, total: 0 }
          }
          salesTotals[s.cash_session_id].count++
          salesTotals[s.cash_session_id].total += parseFloat(s.total) || 0
        })
      }

      const result = sessions.map(s => {
        const st = salesTotals[s.cash_session_id] || { count: 0, total: 0 }
        const declared = parseFloat(s.declared_amount) || 0
        const closing = parseFloat(s.closing_amount) || 0
        const opening = parseFloat(s.opening_amount) || 0
        const salesTotal = st.total

        // Diferencia = declarado - (apertura + ventas - gastos aproximado)
        // Simplificado: diferencia entre declared y closing
        const difference = declared > 0 ? declared - closing : null

        let duration = null
        if (s.opened_at && s.closed_at) {
          const mins = Math.round((new Date(s.closed_at) - new Date(s.opened_at)) / 60000)
          duration = mins
        }

        const avgPerSale = st.count > 0 ? salesTotal / st.count : 0

        return {
          cash_session_id: s.cash_session_id,
          register_name: s.cash_register?.name,
          location: s.cash_register?.location?.name,
          status: s.status,
          opened_at: s.opened_at,
          closed_at: s.closed_at,
          opened_by: s.opened_by_user?.full_name,
          closed_by: s.closed_by_user?.full_name,
          opening_amount: opening,
          closing_amount: closing,
          declared_amount: declared,
          sales_count: st.count,
          sales_total: salesTotal,
          avg_per_sale: avgPerSale,
          difference,
          has_difference: difference !== null && Math.abs(difference) > 0.01,
          duration_minutes: duration
        }
      })

      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─────────────────────────────────────────────────────
  // FINANCIERO: resumen financiero
  // ─────────────────────────────────────────────────────
  async getFinancialSummary(tenantId, fromDate, toDate, locationId = null) {
    try {
      // 1. ingresos por ventas
      let salesQuery = supabaseService.client
        .from('sales')
        .select('total, subtotal, discount_total, tax_total, status')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', fromDate)
        .lte('sold_at', toDate)

      if (locationId) salesQuery = salesQuery.eq('location_id', locationId)

      // 2. costo de ventas (unit_cost * qty por línea)
      let cogsQuery = supabaseService.client
        .from('sale_lines')
        .select(`
          quantity, unit_cost, line_total,
          sale:sale_id!inner(tenant_id, status, sold_at, location_id)
        `)
        .eq('sale.tenant_id', tenantId)
        .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sale.sold_at', fromDate)
        .lte('sale.sold_at', toDate)

      // 3. gastos de caja (cash_movements tipo EXPENSE)
      let expQuery = supabaseService.client
        .from('cash_movements')
        .select('amount, type')
        .eq('tenant_id', tenantId)
        .eq('type', 'EXPENSE')
        .gte('created_at', fromDate)
        .lte('created_at', toDate)

      // 4. otros ingresos caja (INCOME)
      let incQuery = supabaseService.client
        .from('cash_movements')
        .select('amount, type')
        .eq('tenant_id', tenantId)
        .eq('type', 'INCOME')
        .gte('created_at', fromDate)
        .lte('created_at', toDate)

      const [r1, r2, r3, r4] = await Promise.all([
        salesQuery,
        cogsQuery,
        expQuery,
        incQuery
      ])

      if (r1.error) throw r1.error
      if (r2.error) throw r2.error

      const sales = r1.data || []
      const lines = r2.data || []
      const expenses = r3.data || []
      const otherIncome = r4.data || []

      let gross_revenue = 0, discount_total = 0, tax_total = 0
      sales.forEach(s => {
        gross_revenue += parseFloat(s.total) || 0
        discount_total += parseFloat(s.discount_total) || 0
        tax_total += parseFloat(s.tax_total) || 0
      })

      let cogs = 0
      lines.forEach(l => {
        if (!locationId || l.sale?.location_id === locationId) {
          cogs += (parseFloat(l.unit_cost) || 0) * (parseFloat(l.quantity) || 0)
        }
      })

      let total_expenses = 0
      expenses.forEach(e => { total_expenses += parseFloat(e.amount) || 0 })

      let other_income = 0
      otherIncome.forEach(i => { other_income += parseFloat(i.amount) || 0 })

      const gross_profit = gross_revenue - cogs
      const gross_margin = gross_revenue > 0 ? (gross_profit / gross_revenue * 100) : 0
      const net_profit = gross_profit - total_expenses + other_income
      const net_margin = gross_revenue > 0 ? (net_profit / gross_revenue * 100) : 0

      return {
        success: true,
        data: {
          gross_revenue,
          discount_total,
          tax_total,
          net_revenue: gross_revenue - tax_total,
          cogs,
          gross_profit,
          gross_margin: parseFloat(gross_margin.toFixed(2)),
          operating_expenses: total_expenses,
          other_income,
          net_profit,
          net_margin: parseFloat(net_margin.toFixed(2)),
          sales_count: sales.length
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  // ─────────────────────────────────────────────────────
  // FINANCIERO: flujo de efectivo por día
  // ─────────────────────────────────────────────────────
  async getCashFlowByDay(tenantId, fromDate, toDate, locationId = null) {
    try {
      let salesQuery = supabaseService.client
        .from('sales')
        .select('total, sold_at, location_id')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', fromDate)
        .lte('sold_at', toDate)

      if (locationId) salesQuery = salesQuery.eq('location_id', locationId)

      const [r1, r2] = await Promise.all([
        salesQuery,
        supabaseService.client
          .from('cash_movements')
          .select('amount, type, created_at')
          .eq('tenant_id', tenantId)
          .gte('created_at', fromDate)
          .lte('created_at', toDate)
      ])

      const byDay = {}

      ;(r1.data || []).forEach(s => {
        const d = getDateKey(s.sold_at)
        if (!d) return
        if (!byDay[d]) byDay[d] = { date: d, ingresos_ventas: 0, gastos: 0, otros_ingresos: 0, neto: 0 }
        byDay[d].ingresos_ventas += parseFloat(s.total) || 0
      })

      ;(r2.data || []).forEach(m => {
        const d = m.created_at.substring(0, 10)
        if (!byDay[d]) byDay[d] = { date: d, ingresos_ventas: 0, gastos: 0, otros_ingresos: 0, neto: 0 }
        const amt = parseFloat(m.amount) || 0
        if (m.type === 'EXPENSE') byDay[d].gastos += amt
        else byDay[d].otros_ingresos += amt
      })

      const result = Object.values(byDay).map(d => ({
        ...d,
        neto: d.ingresos_ventas + d.otros_ingresos - d.gastos
      })).sort((a, b) => a.date.localeCompare(b.date))

      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Dashboard resumen principal — KPIs + gráficas
  async getDashboardSummary(tenantId, locationId = null) {
    try {
      return await queryCache.getOrLoad(
        `reports:dashboard-summary:${locationId || 'all'}`,
        async () => {
          const { data, error } = await supabaseService.client.rpc('fn_reports_dashboard_summary', {
            p_tenant_id: tenantId,
            p_location_id: locationId || null
          })

          if (error) throw error
          if (!data?.success) {
            throw new Error('La RPC fn_reports_dashboard_summary no devolvió una respuesta válida.')
          }

          return {
            success: true,
            kpis: data.kpis || null,
            dailySeries: data.daily_series || [],
            topProducts: data.top_products || [],
            paymentMethods: data.payment_methods || []
          }
        },
        {
          tenantId,
          ttlMs: DASHBOARD_SUMMARY_TTL_MS,
          storage: 'session',
          tags: ['reports', 'dashboard-summary'],
          shouldCache: (result) => result?.success === true
        }
      )
    } catch (error) {
      return {
        success: false,
        error: error.message || 'No se pudo cargar el dashboard resumido.'
      }
    }
  }

  async getDashboardSummaryLegacy(tenantId, locationId = null) {
    try {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const monthEnd   = now.toISOString()

      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
      const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()

      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString()
      const yearEnd   = now.toISOString()

      const last30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).toISOString()

      const base = (from, to) => {
        let q = supabaseService.client
          .from('sales')
          .select('total, status, sold_at')
          .eq('tenant_id', tenantId)
          .in('status', ['COMPLETED', 'PARTIAL_RETURN'])
          .gte('sold_at', from)
          .lte('sold_at', to)
        if (locationId) q = q.eq('location_id', locationId)
        return q
      }

      const [rToday, rMonth, rPrevMonth, rYear, rLast30, rTopProducts, rPayments] = await Promise.all([
        base(todayStart, todayEnd),
        base(monthStart, monthEnd),
        base(prevMonthStart, prevMonthEnd),
        base(yearStart, yearEnd),
        // últimos 30 días agrupados por día (raw para procesar en JS)
        base(last30Start, yearEnd),
        // top productos del mes (sale_lines)
        (() => {
          let q = supabaseService.client
            .from('sale_lines')
            .select('variant_id, quantity, line_total, variant:variant_id(variant_name, product:product_id(name)), sale:sale_id!inner(tenant_id, status, sold_at, location_id)')
            .eq('sale.tenant_id', tenantId)
            .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN'])
            .gte('sale.sold_at', monthStart)
            .lte('sale.sold_at', monthEnd)
          if (locationId) q = q.eq('sale.location_id', locationId)
          return q
        })(),
        // métodos de pago del mes
        (() => {
          let q = supabaseService.client
            .from('sale_payments')
            .select('amount, payment_method:payment_method_id(code, name), sale:sale_id!inner(tenant_id, status, sold_at, location_id)')
            .eq('sale.tenant_id', tenantId)
            .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN'])
            .gte('sale.sold_at', monthStart)
            .lte('sale.sold_at', monthEnd)
          if (locationId) q = q.eq('sale.location_id', locationId)
          return q
        })()
      ])

      const sum = rows => (rows || []).reduce((acc, r) => acc + (parseFloat(r.total) || 0), 0)

      // KPIs
      const kpis = {
        today:      { total: sum(rToday.data),     count: (rToday.data     || []).length },
        month:      { total: sum(rMonth.data),     count: (rMonth.data     || []).length },
        prev_month: { total: sum(rPrevMonth.data), count: (rPrevMonth.data || []).length },
        year:       { total: sum(rYear.data),      count: (rYear.data      || []).length },
      }
      kpis.month.vs_prev = kpis.prev_month.total > 0
        ? ((kpis.month.total - kpis.prev_month.total) / kpis.prev_month.total * 100).toFixed(1)
        : null

      // Serie diaria últimos 30 días
      const dailyMap = {}
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
        const key = d.toISOString().substring(0, 10)
        dailyMap[key] = 0
      }
      ;(rLast30.data || []).forEach(s => {
        const key = getDateKey(s.sold_at)
        if (!key) return
        if (key in dailyMap) dailyMap[key] += parseFloat(s.total) || 0
      })
      const dailySeries = Object.entries(dailyMap).map(([date, total]) => ({ date, total }))

      // Top 7 productos
      const prodMap = {}
      ;(rTopProducts.data || []).forEach(l => {
        const key = l.variant_id || 'unknown'
        if (!prodMap[key]) prodMap[key] = {
          name: (l.variant?.product?.name || 'Producto') + (l.variant?.variant_name ? ` (${l.variant.variant_name})` : ''),
          revenue: 0,
          qty: 0
        }
        prodMap[key].revenue += parseFloat(l.line_total) || 0
        prodMap[key].qty += parseFloat(l.quantity) || 0
      })
      const topProducts = Object.values(prodMap)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 7)

      // Métodos de pago
      const payMap = {}
      ;(rPayments.data || []).forEach(p => {
        const k = p.payment_method?.name || p.payment_method?.code || 'Otro'
        if (!payMap[k]) payMap[k] = 0
        payMap[k] += parseFloat(p.amount) || 0
      })
      const paymentMethods = Object.entries(payMap).map(([method, total]) => ({ method, total }))

      return { success: true, kpis, dailySeries, topProducts, paymentMethods }
    } catch (error) {
      return { success: false, error: error.message, kpis: null, dailySeries: [], topProducts: [], paymentMethods: [] }
    }
  }
}

export default new ReportsService()
