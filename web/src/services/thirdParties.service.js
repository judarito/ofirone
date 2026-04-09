import { supabase } from '@/plugins/supabase'

const cols = `third_party_id, tenant_id, type, document_type, document_number, dv, legal_name, trade_name, phone, email, fiscal_email, address, city, city_code, department, postal_code, country_code, tax_regime, is_responsible_for_iva, obligated_accounting, ciiu_code, electronic_invoicing_enabled, max_credit_amount, default_payment_terms, default_currency, is_active, created_at`

const thirdPartiesService = {
  // List with optional search; RLS en DB limita por tenant cuando corresponde
  async list({ search = '', limit = 100, offset = 0, type = null } = {}) {
    try {
      let query = supabase.from('third_parties').select(cols)
        .order('legal_name', { ascending: true })
        .range(offset, offset + limit - 1)

      if (type) query = query.in('type', [type, 'both'])

      if (search && search.trim() !== '') {
        const q = `%${search.trim()}%`
        query = supabase.from('third_parties')
          .select(cols)
          .or(`legal_name.ilike.${q},document_number.ilike.${q}`)
          .order('legal_name', { ascending: true })
          .range(offset, offset + limit - 1)
        if (type) query = query.in('type', [type, 'both'])
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    } catch (err) {
      console.error('thirdParties.list error', err)
      throw err
    }
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('third_parties')
      .select(cols)
      .eq('third_party_id', id)
      .single()
    if (error) throw error
    return data
  },

  async create(payload) {
    // Serializar a objeto plano (elimina proxy reactivo de Vue con _vts)
    const plain = JSON.parse(JSON.stringify(payload))
    const { data, error } = await supabase.rpc('fn_upsert_third_party', { p_data: plain })
    if (error) throw error
    return data
  },

  async update(id, payload) {
    const plain = JSON.parse(JSON.stringify(payload))
    // Asegurarse que viene el ID en el payload para que la función haga UPDATE
    if (!plain.third_party_id) plain.third_party_id = id
    const { data, error } = await supabase.rpc('fn_upsert_third_party', { p_data: plain })
    if (error) throw error
    return data
  },

  async remove(id, tenantId) {
    const { data, error } = await supabase.rpc('fn_delete_third_party', { p_id: id, p_tenant_id: tenantId })
    if (error) throw error
    return { third_party_id: id }
  }
}

export default thirdPartiesService
