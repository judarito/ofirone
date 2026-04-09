import supabaseService from './supabase.service'
import { serviceErrorResult } from '@/utils/appErrors'

class CashService {
  constructor() {
    this.registersTable = 'cash_registers'
    this.sessionsTable = 'cash_sessions'
    this.movementsTable = 'cash_movements'
  }

  // ---- Cajas registradoras ----
  async getCashRegisters(tenantId, page = 1, pageSize = 10, search = '') {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.registersTable)
        .select('*, location:location_id(name)', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
        .range(from, to)

      if (search) query = query.ilike('name', `%${search}%`)

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  async getAllCashRegisters(tenantId, locationId = null) {
    try {
      let query = supabaseService.client
        .from(this.registersTable)
        .select('cash_register_id, name, location_id, location:location_id(name)')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name')

      if (locationId) query = query.eq('location_id', locationId)

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  async createCashRegister(tenantId, register) {
    try {
      const { data, error } = await supabaseService.insert(this.registersTable, {
        tenant_id: tenantId,
        location_id: register.location_id,
        name: register.name,
        is_active: register.is_active !== false
      })
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async updateCashRegister(tenantId, registerId, updates) {
    try {
      const { data, error } = await supabaseService.update(this.registersTable, {
        name: updates.name,
        location_id: updates.location_id,
        is_active: updates.is_active
      }, { tenant_id: tenantId, cash_register_id: registerId })
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async deleteCashRegister(tenantId, registerId) {
    try {
      const { error } = await supabaseService.delete(this.registersTable, {
        tenant_id: tenantId, cash_register_id: registerId
      })
      if (error) throw error
      return { success: true }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // ---- Sesiones de caja ----
  async getCashSessions(tenantId, page = 1, pageSize = 10, search = '', status = null) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.sessionsTable)
        .select(`
          *,
          cash_register:cash_register_id(name, location:location_id(name)),
          opened_by_user:opened_by(full_name),
          closed_by_user:closed_by(full_name)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('opened_at', { ascending: false })
        .range(from, to)

      if (status) query = query.eq('status', status)

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  async getOpenSession(tenantId, cashRegisterId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.sessionsTable)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('cash_register_id', cashRegisterId)
        .eq('status', 'OPEN')
        .maybeSingle()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async openCashSession(tenantId, cashRegisterId, userId, openingAmount) {
    try {
      const { data, error } = await supabaseService.insert(this.sessionsTable, {
        tenant_id: tenantId,
        cash_register_id: cashRegisterId,
        opened_by: userId,
        opening_amount: openingAmount || 0,
        status: 'OPEN'
      })
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async closeCashSession(tenantId, sessionId, userId, closingAmountCounted) {
    try {
      // Calcular monto esperado: apertura + ingresos - egresos
      const { data: movements, error: mErr } = await supabaseService.client
        .from(this.movementsTable)
        .select('type, amount')
        .eq('tenant_id', tenantId)
        .eq('cash_session_id', sessionId)

      if (mErr) throw mErr

      const { data: sessionData, error: sErr } = await supabaseService.client
        .from(this.sessionsTable)
        .select('opening_amount')
        .eq('cash_session_id', sessionId)
        .single()

      if (sErr) throw sErr

      let expected = parseFloat(sessionData.opening_amount) || 0
      ;(movements || []).forEach(m => {
        if (m.type === 'INCOME') expected += parseFloat(m.amount)
        else expected -= parseFloat(m.amount)
      })

      // Agregar pagos en efectivo de ventas
      const { data: cashPayments, error: pErr } = await supabaseService.client
        .from('sale_payments')
        .select('amount, payment_method:payment_method_id(code)')
        .eq('tenant_id', tenantId)
        .eq('cash_session_id', sessionId)

      if (!pErr && cashPayments) {
        cashPayments.forEach(p => {
          if (p.payment_method?.code === 'CASH') {
            expected += parseFloat(p.amount)
          }
        })
      }

      const difference = parseFloat(closingAmountCounted) - expected

      const { data, error } = await supabaseService.update(this.sessionsTable, {
        closed_by: userId,
        closed_at: new Date().toISOString(),
        closing_amount_counted: closingAmountCounted,
        closing_amount_expected: expected,
        difference,
        status: 'CLOSED'
      }, { tenant_id: tenantId, cash_session_id: sessionId })

      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async forceCloseSession(tenantId, sessionId, userId) {
    try {
      const { data, error } = await supabaseService.update(
        this.sessionsTable,
        {
          closed_by: userId,
          closed_at: new Date().toISOString(),
          status: 'FORCE_CLOSED'
        },
        { tenant_id: tenantId, cash_session_id: sessionId }
      )
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Retorna sesiones OPEN que llevan más de hoursThreshold horas abiertas
  async getExpiredSessions(tenantId, hoursThreshold = 24) {
    try {
      const cutoff = new Date(Date.now() - hoursThreshold * 3600 * 1000).toISOString()
      const { data, error } = await supabaseService.client
        .from(this.sessionsTable)
        .select('*, cash_register:cash_register_id(name, location:location_id(name)), opened_by_user:opened_by(full_name)')
        .eq('tenant_id', tenantId)
        .eq('status', 'OPEN')
        .lt('opened_at', cutoff)
        .order('opened_at', { ascending: true })
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  // ---- Movimientos de caja (gastos/ingresos) ----
  async getCashMovements(tenantId, sessionId, page = 1, pageSize = 20) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await supabaseService.client
        .from(this.movementsTable)
        .select('*, created_by_user:created_by(full_name)', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('cash_session_id', sessionId)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  async createCashMovement(tenantId, sessionId, movement, userId) {
    try {
      const { data, error } = await supabaseService.insert(this.movementsTable, {
        tenant_id: tenantId,
        cash_session_id: sessionId,
        type: movement.type,
        category: movement.category || null,
        amount: Math.abs(movement.amount),
        note: movement.note || null,
        created_by: userId
      })
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }
}

export default new CashService()
