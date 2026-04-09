import supabaseService from './supabase.service'
import thirdPartiesService from './thirdParties.service'

class CustomersService {
  // Mantener la API existente, pero delegar en `third_parties`.
  constructor() {
    this.table = 'third_parties'
  }

  async _mapThirdPartyToCustomer(tp) {
    return {
      customer_id: tp.third_party_id,
      full_name: tp.legal_name || tp.trade_name || '',
      document: tp.document_number,
      dv: tp.dv,
      phone: tp.phone,
      email: tp.email,
      address: tp.address,
      is_active: tp.is_active,
      max_credit_amount: tp.max_credit_amount || null,
      default_payment_terms: tp.default_payment_terms || null,
      default_currency: tp.default_currency || 'COP',
      // Mantener compatibilidad con customer_credit_accounts structure used by UI
      customer_credit_accounts: [{ credit_account_id: null, credit_limit: tp.max_credit_amount || 0, current_balance: 0, is_active: tp.is_active }]
    }
  }

  async getCustomers(tenantId, page = 1, pageSize = 10, search = '') {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const cols = 'third_party_id, tenant_id, document_type, document_number, dv, legal_name, trade_name, phone, email, fiscal_email, address, city, department, max_credit_amount, default_payment_terms, default_currency, is_active, created_at'
      let query = supabaseService.client
        .from(this.table)
        .select(cols, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('legal_name', { ascending: true })
        .range(from, to)

      if (search) {
        const q = `%${search}%`
        query = supabaseService.client
          .from(this.table)
          .select(cols, { count: 'exact' })
          .eq('tenant_id', tenantId)
          .or(`legal_name.ilike.${q},document_number.ilike.${q},phone.ilike.${q},email.ilike.${q}`)
          .order('legal_name', { ascending: true })
          .range(from, to)
      }

      const { data, error, count } = await query
      if (error) throw error
      const mapped = (data || []).map(d => this._mapThirdPartyToCustomer(d))
      return { success: true, data: mapped, total: count || 0 }
    } catch (error) {
      return { success: false, error: error.message, data: [], total: 0 }
    }
  }

  async searchCustomers(tenantId, search, limit = 20) {
    try {
      const q = `%${search}%`
      const { data, error } = await supabaseService.client
        .from(this.table)
        .select('third_party_id, legal_name, document_number, phone')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .or(`legal_name.ilike.${q},document_number.ilike.${q},phone.ilike.${q}`)
        .limit(limit)

      if (error) throw error
      const mapped = (data || []).map(d => ({ customer_id: d.third_party_id, full_name: d.legal_name, document: d.document_number, phone: d.phone }))
      return { success: true, data: mapped }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async createCustomer(tenantId, customer) {
    try {
      const payload = {
        tenant_id: tenantId,
        document_number: customer.document || null,
        dv: customer.dv || null,
        legal_name: customer.full_name,
        trade_name: customer.trade_name || customer.full_name,
        phone: customer.phone || null,
        email: customer.email || null,
        address: customer.address || null,
        is_active: customer.is_active !== false,
        max_credit_amount: customer.max_credit_amount || null,
        default_payment_terms: customer.default_payment_terms || null,
        default_currency: customer.default_currency || 'COP'
      }

      const plain = JSON.parse(JSON.stringify(payload))
      const { error } = await supabaseService.client
        .from(this.table)
        .insert(plain)

      if (error) throw error
      // Fetchear sin .select() encadenado para evitar error _vts
      const cols = 'third_party_id, tenant_id, document_type, document_number, dv, legal_name, trade_name, phone, email, fiscal_email, address, city, department, max_credit_amount, default_payment_terms, default_currency, is_active, created_at'
      const { data: fetched, error: fe } = await supabaseService.client
        .from(this.table).select(cols)
        .eq('tenant_id', tenantId)
        .eq('document_number', payload.document_number || '')
        .order('created_at', { ascending: false }).limit(1).single()
      if (fe) throw fe
      return { success: true, data: await this._mapThirdPartyToCustomer(fetched) }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async updateCustomer(tenantId, customerId, updates) {
    try {
      const payload = {
        document_number: updates.document || null,
        dv: updates.dv || null,
        legal_name: updates.full_name,
        trade_name: updates.trade_name || updates.full_name,
        phone: updates.phone || null,
        email: updates.email || null,
        address: updates.address || null,
        is_active: updates.is_active,
        max_credit_amount: updates.max_credit_amount || null,
        default_payment_terms: updates.default_payment_terms || null
      }

      const plain = JSON.parse(JSON.stringify(payload))
      const { error } = await supabaseService.client
        .from(this.table)
        .update(plain)
        .match({ tenant_id: tenantId, third_party_id: customerId })

      if (error) throw error
      // Fetchear sin .select() encadenado para evitar error _vts
      const cols = 'third_party_id, tenant_id, document_type, document_number, dv, legal_name, trade_name, phone, email, fiscal_email, address, city, department, max_credit_amount, default_payment_terms, default_currency, is_active, created_at'
      const { data: fetched, error: fe } = await supabaseService.client
        .from(this.table).select(cols)
        .eq('tenant_id', tenantId).eq('third_party_id', customerId).single()
      if (fe) throw fe
      return { success: true, data: await this._mapThirdPartyToCustomer(fetched) }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async deleteCustomer(tenantId, customerId) {
    try {
      const { error } = await supabaseService.client
        .from(this.table)
        .delete()
        .match({ tenant_id: tenantId, third_party_id: customerId })

      if (error) throw error
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}

export default new CustomersService()
