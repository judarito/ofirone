import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

const TAX_INFO_TTL_MS = 5 * 60 * 1000

class TaxesService {
  constructor() {
    this.table = 'taxes'
    this.rulesTable = 'tax_rules'
  }

  async getTaxes(tenantId, page = 1, pageSize = 10, search = '') {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.table)
        .select('tax_id, code, name, rate, is_active, created_at, updated_at', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
        .range(from, to)

      if (search) {
        query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
      }

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return { success: false, error: error.message, data: [], total: 0 }
    }
  }

  async getAllTaxes(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.table)
        .select('tax_id, code, name, rate')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async createTax(tenantId, tax) {
    try {
      const { data, error } = await supabaseService.insert(this.table, {
        tenant_id: tenantId,
        code: tax.code.toUpperCase(),
        name: tax.name,
        rate: tax.rate,
        is_active: tax.is_active !== false
      })
      if (error) throw error
      queryCache.invalidateByTags(['taxes', 'tax-info'], { tenantId })
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async updateTax(tenantId, taxId, updates) {
    try {
      const { data, error } = await supabaseService.update(this.table, {
        code: updates.code.toUpperCase(),
        name: updates.name,
        rate: updates.rate,
        is_active: updates.is_active
      }, { tenant_id: tenantId, tax_id: taxId })
      if (error) throw error
      queryCache.invalidateByTags(['taxes', 'tax-info'], { tenantId })
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async deleteTax(tenantId, taxId) {
    try {
      const { error } = await supabaseService.delete(this.table, {
        tenant_id: tenantId, tax_id: taxId
      })
      if (error) throw error
      queryCache.invalidateByTags(['taxes', 'tax-info'], { tenantId })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ---- Tax Rules ----
  async getTaxRules(tenantId, taxId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.rulesTable)
        .select(`
          *,
          tax:tax_id(code, name, rate),
          category:category_id(name),
          product:product_id(name),
          variant:variant_id(sku, variant_name)
        `)
        .eq('tenant_id', tenantId)
        .eq('tax_id', taxId)
        .order('priority', { ascending: false })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async createTaxRule(tenantId, rule) {
    try {
      const { data, error } = await supabaseService.insert(this.rulesTable, {
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
      queryCache.invalidateByTags(['taxes', 'tax-rules', 'tax-info'], { tenantId })
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async deleteTaxRule(tenantId, taxRuleId) {
    try {
      const { error } = await supabaseService.delete(this.rulesTable, {
        tenant_id: tenantId, tax_rule_id: taxRuleId
      })
      if (error) throw error
      queryCache.invalidateByTags(['taxes', 'tax-rules', 'tax-info'], { tenantId })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Obtener tasa de impuesto para una variante
  async getTaxRateForVariant(tenantId, variantId) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_get_tax_rate_for_variant', {
          p_tenant: tenantId,
          p_variant: variantId
        })
      
      if (error) throw error
      return { success: true, rate: data || 0 }
    } catch (error) {
      console.warn('Error getting tax rate:', error)
      return { success: false, rate: 0, error: error.message }
    }
  }

  // Obtener información completa del impuesto para una variante
  async getTaxInfoForVariant(tenantId, variantId) {
    try {
      return await queryCache.getOrLoad(
        `taxes:variant-info:${variantId}`,
        async () => {
          const { data, error } = await supabaseService.client
            .rpc('fn_get_tax_info_for_variant', {
              p_tenant: tenantId,
              p_variant: variantId
            })

          if (error) throw error

          return {
            success: true,
            rate: data?.rate || 0,
            code: data?.code || null,
            name: data?.name || null
          }
        },
        {
          tenantId,
          ttlMs: TAX_INFO_TTL_MS,
          storage: 'memory',
          tags: ['taxes', 'tax-info'],
          shouldCache: (result) => result?.success === true
        }
      )
    } catch (error) {
      console.warn('Error getting tax info:', error)
      return {
        success: false,
        rate: 0,
        code: null,
        name: null,
        error: error.message
      }
    }
  }
}

export default new TaxesService()
