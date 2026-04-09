import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

const PAYMENT_METHODS_CACHE_TTL_MS = 10 * 60 * 1000

class PaymentMethodsService {
  constructor() {
    this.table = 'payment_methods'
  }

  // Obtener métodos de pago con paginación
  async getPaymentMethods(tenantId, page = 1, pageSize = 10, search = '', options = {}) {
    try {
      const normalizedSearch = String(search || '').trim().toLowerCase()
      const cacheParams = {
        page,
        pageSize,
        search: normalizedSearch,
        activeOnly: Boolean(options.activeOnly),
        excludeCodes: Array.isArray(options.excludeCodes) ? [...options.excludeCodes].sort() : [],
      }

      return await queryCache.getOrLoad(
        `payment-methods:list:${JSON.stringify(cacheParams)}`,
        async () => {
          const from = (page - 1) * pageSize
          const to = from + pageSize - 1

          let query = supabaseService.client
            .from(this.table)
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true })
            .range(from, to)

          if (normalizedSearch) {
            query = query.or(`name.ilike.%${normalizedSearch}%,code.ilike.%${normalizedSearch}%`)
          }

          if (options.activeOnly) {
            query = query.eq('is_active', true)
          }

          if (options.excludeCodes && Array.isArray(options.excludeCodes) && options.excludeCodes.length > 0) {
            query = query.not('code', 'in', `(${options.excludeCodes.join(',')})`)
          }

          const { data, error, count } = await query

          if (error) throw error

          return {
            success: true,
            data: data || [],
            total: count || 0
          }
        },
        {
          tenantId,
          ttlMs: PAYMENT_METHODS_CACHE_TTL_MS,
          storage: 'session',
          tags: ['payment-methods'],
          shouldCache: (result) => result?.success === true,
        }
      )
    } catch (error) {
      console.error('Error fetching payment methods:', error)
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      }
    }
  }

  /**
   * Obtener métodos de pago para usar en dropdowns
   * Excluye automáticamente LAYAWAY (método interno) y devuelve solo activos
   */
  async getPaymentMethodsForDropdown(tenantId, page = 1, pageSize = 100) {
    return this.getPaymentMethods(tenantId, page, pageSize, '', {
      activeOnly: true,
      excludeCodes: ['LAYAWAY']
    })
  }

  // Crear método de pago
  async createPaymentMethod(tenantId, paymentMethod) {
    try {
      const { data, error } = await supabaseService.insert(this.table, {
        tenant_id: tenantId,
        code: paymentMethod.code.toUpperCase(),
        name: paymentMethod.name,
        is_active: paymentMethod.is_active !== false,
        sort_order: paymentMethod.sort_order ?? 0
      })

      if (error) throw error
      queryCache.invalidateByTags(['payment-methods'], { tenantId })

      return { success: true, data: data[0] }
    } catch (error) {
      console.error('Error creating payment method:', error)
      return { success: false, error: error.message }
    }
  }

  // Actualizar método de pago
  async updatePaymentMethod(tenantId, paymentMethodId, updates) {
    try {
      const updateData = {
        name: updates.name,
        is_active: updates.is_active,
        sort_order: updates.sort_order ?? 0
      }

      if (updates.code) {
        updateData.code = updates.code.toUpperCase()
      }

      const { data, error } = await supabaseService.update(
        this.table,
        updateData,
        {
          tenant_id: tenantId,
          payment_method_id: paymentMethodId
        }
      )

      if (error) throw error
      queryCache.invalidateByTags(['payment-methods'], { tenantId })

      return { success: true, data: data[0] }
    } catch (error) {
      console.error('Error updating payment method:', error)
      return { success: false, error: error.message }
    }
  }

  // Eliminar método de pago
  async deletePaymentMethod(tenantId, paymentMethodId) {
    try {
      const { error } = await supabaseService.delete(this.table, {
        tenant_id: tenantId,
        payment_method_id: paymentMethodId
      })

      if (error) throw error
      queryCache.invalidateByTags(['payment-methods'], { tenantId })

      return { success: true }
    } catch (error) {
      console.error('Error deleting payment method:', error)
      return { success: false, error: error.message }
    }
  }

  // Verificar si el código ya existe
  async checkCodeExists(tenantId, code, excludeId = null) {
    try {
      let query = supabaseService.client
        .from(this.table)
        .select('payment_method_id')
        .eq('tenant_id', tenantId)
        .eq('code', code.toUpperCase())

      if (excludeId) {
        query = query.neq('payment_method_id', excludeId)
      }

      const { data, error } = await query

      if (error) throw error

      return data && data.length > 0
    } catch (error) {
      console.error('Error checking code:', error)
      return false
    }
  }
}

export default new PaymentMethodsService()
