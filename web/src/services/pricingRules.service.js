import supabaseService from './supabase.service'

class PricingRulesService {
  constructor() {
    this.table = 'pricing_rules'
  }

  /**
   * Obtener todas las políticas de precio con paginación
   */
  async getPricingRules(tenantId, page = 1, pageSize = 50, filters = {}) {
    try {
      let query = supabaseService.client
        .from(this.table)
        .select(`
          *,
          location:location_id(location_id, name),
          category:category_id(category_id, name),
          product:product_id(product_id, name),
          variant:variant_id(variant_id, sku, variant_name)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })

      // Aplicar filtros
      if (filters.scope) query = query.eq('scope', filters.scope)
      if (filters.is_active !== null && filters.is_active !== undefined) {
        query = query.eq('is_active', filters.is_active)
      }
      if (filters.location_id) query = query.eq('location_id', filters.location_id)
      if (filters.category_id) query = query.eq('category_id', filters.category_id)

      // Paginación
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, error, count } = await query

      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      console.error('Error al obtener políticas de precio:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Obtener política de precio por ID
   */
  async getPricingRuleById(tenantId, pricingRuleId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.table)
        .select(`
          *,
          location:location_id(location_id, name),
          category:category_id(category_id, name),
          product:product_id(product_id, name),
          variant:variant_id(variant_id, sku, variant_name, product:products(name))
        `)
        .eq('tenant_id', tenantId)
        .eq('pricing_rule_id', pricingRuleId)
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      console.error('Error al obtener política de precio:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Crear nueva política de precio
   */
  async createPricingRule(tenantId, rule) {
    try {
      const { data, error } = await supabaseService.insert(this.table, {
        tenant_id: tenantId,
        scope: rule.scope,
        location_id: rule.location_id || null,
        category_id: rule.category_id || null,
        product_id: rule.product_id || null,
        variant_id: rule.variant_id || null,
        pricing_method: rule.pricing_method || 'MARKUP',
        markup_percentage: rule.markup_percentage || 20,
        price_rounding: rule.price_rounding || 'NONE',
        rounding_to: rule.rounding_to || 1,
        priority: rule.priority || 0,
        is_active: rule.is_active !== false
      })

      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      console.error('Error al crear política de precio:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Actualizar política de precio
   */
  async updatePricingRule(tenantId, pricingRuleId, updates) {
    try {
      const { data, error } = await supabaseService.update(this.table, {
        pricing_method: updates.pricing_method,
        markup_percentage: updates.markup_percentage,
        price_rounding: updates.price_rounding,
        rounding_to: updates.rounding_to,
        priority: updates.priority,
        is_active: updates.is_active
      }, { tenant_id: tenantId, pricing_rule_id: pricingRuleId })

      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      console.error('Error al actualizar política de precio:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Eliminar política de precio
   */
  async deletePricingRule(tenantId, pricingRuleId) {
    try {
      const { error } = await supabaseService.delete(this.table, {
        tenant_id: tenantId,
        pricing_rule_id: pricingRuleId
      })

      if (error) throw error
      return { success: true }
    } catch (error) {
      console.error('Error al eliminar política de precio:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Obtener política aplicable para una variante
   */
  async getPolicyForVariant(tenantId, variantId, locationId = null) {
    try {
      const { data, error } = await supabaseService.rpc('fn_get_pricing_policy', {
        p_tenant: tenantId,
        p_variant: variantId,
        p_location: locationId
      })

      if (error) throw error
      return { success: true, data: data[0] || null }
    } catch (error) {
      console.error('Error al obtener política aplicable:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Calcular precio según política
   */
  async calculatePrice(tenantId, variantId, cost, locationId = null) {
    try {
      const { data, error } = await supabaseService.rpc('fn_calculate_price', {
        p_tenant: tenantId,
        p_variant: variantId,
        p_cost: cost,
        p_location: locationId
      })

      if (error) throw error
      return { success: true, price: data }
    } catch (error) {
      console.error('Error al calcular precio:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Obtener todas las sedes para el selector
   */
  async getLocations(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('locations')
        .select('location_id, name')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error al obtener sedes:', error)
      return { success: false, error: error.message }
    }
  }
}

export default new PricingRulesService()
