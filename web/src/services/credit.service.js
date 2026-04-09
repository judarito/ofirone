import supabaseService from './supabase.service'

class CreditService {
  // ─── Cuenta de crédito de un cliente ────────────────────────────────────
  async getCreditAccount(tenantId, customerId) {
    try {
      const { data, error } = await supabaseService.client
        .from('customer_credit_accounts')
        .select('credit_account_id, credit_limit, current_balance, is_active')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .maybeSingle()
      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  // Disponible = cupo - saldo actual
  availableCredit(account) {
    if (!account) return 0
    return Math.max(0, (parseFloat(account.credit_limit) || 0) - (parseFloat(account.current_balance) || 0))
  }

  // ─── Asegurar que existe una cuenta de crédito ───────────────────────────
  async upsertCreditAccount(tenantId, customerId, creditLimit) {
    try {
      const { data, error } = await supabaseService.client
        .from('customer_credit_accounts')
        .upsert({ tenant_id: tenantId, customer_id: customerId, credit_limit: creditLimit, is_active: true },
          { onConflict: 'tenant_id,customer_id', ignoreDuplicates: false })
        .select('credit_account_id, credit_limit, current_balance')
        .single()
      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ─── Registrar movimiento de venta a crédito (suma deuda) ───────────────
  async registerCreditSale(tenantId, creditAccountId, saleId, amount, userId) {
    try {
      // Insertar movimiento
      const { error: mvErr } = await supabaseService.client
        .from('customer_credit_movements')
        .insert({
          tenant_id: tenantId,
          credit_account_id: creditAccountId,
          source: 'SALE',
          source_id: saleId,
          amount: Math.abs(amount),      // positivo = deuda
          note: 'Venta a crédito',
          created_by: userId
        })
      if (mvErr) throw mvErr

      // Actualizar saldo
      const { error: upErr } = await supabaseService.client.rpc('fn_update_credit_balance', {
        p_credit_account_id: creditAccountId,
        p_delta: Math.abs(amount)
      })
      if (upErr) throw upErr

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ─── Registrar abono (reduce deuda) ─────────────────────────────────────
  async registerPayment(tenantId, creditAccountId, amount, note, userId) {
    try {
      const { error: mvErr } = await supabaseService.client
        .from('customer_credit_movements')
        .insert({
          tenant_id: tenantId,
          credit_account_id: creditAccountId,
          source: 'PAYMENT',
          source_id: null,
          amount: -Math.abs(amount),     // negativo = abono
          note: note || 'Abono a cartera',
          created_by: userId
        })
      if (mvErr) throw mvErr

      const { error: upErr } = await supabaseService.client.rpc('fn_update_credit_balance', {
        p_credit_account_id: creditAccountId,
        p_delta: -Math.abs(amount)
      })
      if (upErr) throw upErr

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ─── Lista de deudores (saldo > 0) ──────────────────────────────────────
  async getDebtors(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('customer_credit_accounts')
        .select(`
          credit_account_id, credit_limit, current_balance, is_active,
          customer:customer_id(customer_id, full_name, document, phone, email)
        `)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .gt('current_balance', 0)
        .order('current_balance', { ascending: false })
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─── Todos los clientes con cuenta de crédito ───────────────────────────
  async getAllCreditAccounts(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('customer_credit_accounts')
        .select(`
          credit_account_id, credit_limit, current_balance, is_active,
          customer:customer_id(customer_id, full_name, document, phone, email)
        `)
        .eq('tenant_id', tenantId)
        .order('current_balance', { ascending: false })
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─── Historial de movimientos de un cliente ──────────────────────────────
  async getCreditMovements(tenantId, creditAccountId) {
    try {
      const { data, error } = await supabaseService.client
        .from('customer_credit_movements')
        .select('movement_id, source, source_id, amount, note, created_at, created_by_user:created_by(full_name)')
        .eq('tenant_id', tenantId)
        .eq('credit_account_id', creditAccountId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  // ─── Resumen general de cartera ──────────────────────────────────────────
  async getPortfolioSummary(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('customer_credit_accounts')
        .select('credit_limit, current_balance, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
      if (error) throw error

      const rows = data || []
      const summary = {
        total_accounts:   rows.length,
        total_debt:       rows.reduce((s, r) => s + (parseFloat(r.current_balance) || 0), 0),
        total_limit:      rows.reduce((s, r) => s + (parseFloat(r.credit_limit)    || 0), 0),
        accounts_with_debt: rows.filter(r => parseFloat(r.current_balance) > 0).length,
        accounts_overdue: rows.filter(r => parseFloat(r.current_balance) > parseFloat(r.credit_limit)).length
      }
      return { success: true, data: summary }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }
}

export default new CreditService()
