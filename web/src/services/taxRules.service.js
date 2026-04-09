import supabaseService from './supabase.service'

class TaxRulesService {
  constructor() {
    this.table = 'tax_rules'
  }

  async getAllRules(tenantId, page = 1, pageSize = 20, filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.table)
        .select(`
          *,
          tax:tax_id(code, name, rate, is_active),
          category:category_id(name),
          product:product_id(name),
          variant:variant_id(sku, variant_name)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('scope', { ascending: true })
        .order('priority', { ascending: false })
        .range(from, to)

      if (filters.scope) {
        query = query.eq('scope', filters.scope)
      }
      if (filters.tax_id) {
        query = query.eq('tax_id', filters.tax_id)
      }
      if (typeof filters.is_active === 'boolean') {
        query = query.eq('is_active', filters.is_active)
      }

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return { success: false, error: error.message, data: [], total: 0 }
    }
  }

  async createRule(tenantId, rule) {
    try {
      const { data, error } = await supabaseService.insert(this.table, {
        tenant_id: tenantId,
        tax_id: rule.tax_id,
        scope: rule.scope,
        category_id: rule.scope === 'CATEGORY' ? rule.category_id : null,
        product_id: rule.scope === 'PRODUCT' ? rule.product_id : null,
        variant_id: rule.scope === 'VARIANT' ? rule.variant_id : null,
        priority: rule.priority || 0,
        is_active: rule.is_active !== false
      })
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async updateRule(tenantId, taxRuleId, updates) {
    try {
      const { data, error } = await supabaseService.update(this.table, {
        tax_id: updates.tax_id,
        category_id: updates.scope === 'CATEGORY' ? updates.category_id : null,
        product_id: updates.scope === 'PRODUCT' ? updates.product_id : null,
        variant_id: updates.scope === 'VARIANT' ? updates.variant_id : null,
        priority: updates.priority || 0,
        is_active: updates.is_active
      }, { tenant_id: tenantId, tax_rule_id: taxRuleId })
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async deleteRule(tenantId, taxRuleId) {
    try {
      const { error } = await supabaseService.delete(this.table, {
        tenant_id: tenantId, tax_rule_id: taxRuleId
      })
      if (error) throw error
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}

export default new TaxRulesService()
