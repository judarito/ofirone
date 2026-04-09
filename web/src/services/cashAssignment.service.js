import supabaseService from './supabase.service'

class CashAssignmentService {
  // Obtener contexto POS al login (sesión abierta + cajas asignadas)
  async getPOSHomeContext(tenantId, userId) {
    try {
      const { data, error } = await supabaseService.client.rpc('fn_pos_home_context', {
        p_tenant: tenantId,
        p_user: userId
      })

      if (error) throw error

      return {
        success: true,
        context: data?.[0] || {
          open_cash_session_id: null,
          assigned_registers_count: 0,
          single_cash_register_id: null
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Obtener cajas asignadas al usuario
  async getUserCashRegisters(tenantId, userId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_user_cash_registers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('cash_register_name')

      if (error) throw error

      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // Asignar caja a cajero (solo Admin)
  async assignCashRegisterToUser(tenantId, cashRegisterId, userId, assignedBy, isActive = true, note = null) {
    try {
      const { error } = await supabaseService.client.rpc('sp_assign_cash_register_to_user', {
        p_tenant: tenantId,
        p_cash_register: cashRegisterId,
        p_user: userId,
        p_assigned_by: assignedBy,
        p_is_active: isActive,
        p_note: note
      })

      if (error) throw error

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Abrir sesión de caja (con validación de asignación)
  async openCashSession(tenantId, cashRegisterId, openedBy, openingAmount) {
    try {
      const { data, error } = await supabaseService.client.rpc('sp_open_cash_session', {
        p_tenant: tenantId,
        p_cash_register: cashRegisterId,
        p_opened_by: openedBy,
        p_opening_amount: openingAmount
      })

      if (error) throw error

      return { success: true, sessionId: data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Cerrar sesión de caja (con validación de dueño)
  async closeCashSessionSecure(tenantId, cashSessionId, closedBy, countedAmount) {
    try {
      const { error } = await supabaseService.client.rpc('sp_close_cash_session_secure', {
        p_tenant: tenantId,
        p_cash_session: cashSessionId,
        p_closed_by: closedBy,
        p_counted_amount: countedAmount
      })

      if (error) throw error

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Obtener todas las asignaciones (para vista Admin) - Con paginación
  async getAllAssignments(tenantId, page = 1, pageSize = 20, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from('cash_register_assignments')
        .select(`
          assignment_id,
          tenant_id,
          cash_register_id,
          user_id,
          is_active,
          assigned_at,
          assigned_by,
          note,
          user:user_id (
            user_id,
            full_name
          ),
          cash_register:cash_register_id (
            cash_register_id,
            name,
            location_id,
            location:location_id (
              location_id,
              name
            )
          )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)

      if (filters.userId) query = query.eq('user_id', filters.userId)
      if (filters.cashRegisterId) query = query.eq('cash_register_id', filters.cashRegisterId)
      if (filters.locationId) query = query.eq('cash_register.location_id', filters.locationId)
      if (typeof filters.isActive === 'boolean') query = query.eq('is_active', filters.isActive)

      query = query.order('assigned_at', { ascending: false }).range(from, to)

      const { data, error, count } = await query

      if (error) throw error

      // Transformar datos al formato esperado
      const transformed = (data || []).map(item => ({
        assignment_id: item.assignment_id,
        tenant_id: item.tenant_id,
        user_id: item.user_id,
        user_name: item.user?.full_name || '',
        cash_register_id: item.cash_register_id,
        cash_register_name: item.cash_register?.name || '',
        location_id: item.cash_register?.location_id || null,
        location_name: item.cash_register?.location?.name || '',
        is_active: item.is_active,
        assigned_at: item.assigned_at,
        assigned_by: item.assigned_by,
        note: item.note
      }))

      return { success: true, data: transformed, total: count || 0 }
    } catch (error) {
      console.error('getAllAssignments error:', error)
      return { success: false, error: error.message, data: [], total: 0 }
    }
  }
}

export default new CashAssignmentService()
