import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

const UNITS_CACHE_TTL_MS = 10 * 60 * 1000

class UnitsOfMeasureService {
  constructor() {
    this.table = 'units_of_measure'
  }

  /**
   * Obtener todas las unidades (sistema + tenant)
   * @param {string} tenantId - ID del tenant
   * @param {number} page - Página actual
   * @param {number} pageSize - Tamaño de página
   * @param {string} search - Texto de búsqueda
   * @returns {Promise<{success: boolean, data: array, total: number}>}
   */
  async getUnits(tenantId, page = 1, pageSize = 50, search = '') {
    try {
      const normalizedSearch = String(search || '').trim().toLowerCase()
      return await queryCache.getOrLoad(
        `units:list:${JSON.stringify({ page, pageSize, search: normalizedSearch })}`,
        async () => {
          const from = (page - 1) * pageSize
          const to = from + pageSize - 1

          let query = supabaseService.client
            .from(this.table)
            .select('*', { count: 'exact' })
            .order('is_system', { ascending: false })
            .order('name', { ascending: true })
            .range(from, to)

          if (tenantId) {
            query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
          }

          if (normalizedSearch) {
            query = query.or(
              `code.ilike.%${normalizedSearch}%,name.ilike.%${normalizedSearch}%,description.ilike.%${normalizedSearch}%,dian_code.ilike.%${normalizedSearch}%`
            )
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
          ttlMs: UNITS_CACHE_TTL_MS,
          storage: 'session',
          tags: ['units'],
          shouldCache: (result) => result?.success === true,
        }
      )
    } catch (error) {
      console.error('Error getUnits:', error)
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      }
    }
  }

  /**
   * Obtener unidad por ID
   * @param {string} unitId - ID de la unidad
   * @returns {Promise<{success: boolean, data: object}>}
   */
  async getUnitById(unitId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.table)
        .select('*')
        .eq('unit_id', unitId)
        .single()

      if (error) throw error
      queryCache.invalidateByTags(['units'], { tenantId })

      return {
        success: true,
        data: data || null
      }
    } catch (error) {
      console.error('Error getUnitById:', error)
      return {
        success: false,
        error: error.message,
        data: null
      }
    }
  }

  /**
   * Crear nueva unidad (solo para tenant, no sistema)
   * @param {string} tenantId - ID del tenant
   * @param {object} unitData - Datos de la unidad
   * @returns {Promise<{success: boolean, data: object}>}
   */
  async createUnit(tenantId, unitData) {
    try {
      const newUnit = {
        tenant_id: tenantId,
        code: unitData.code.toUpperCase().trim(),
        dian_code: unitData.dian_code ? unitData.dian_code.toUpperCase().trim() : null,
        name: unitData.name.trim(),
        description: unitData.description || null,
        is_active: unitData.is_active !== undefined ? unitData.is_active : true,
        is_system: false  // Usuarios nunca pueden crear unidades sistema
      }

      const { data, error } = await supabaseService.client
        .from(this.table)
        .insert([newUnit])
        .select()
        .single()

      if (error) throw error
      queryCache.invalidateByTags(['units'], { tenantId })

      return {
        success: true,
        data: data
      }
    } catch (error) {
      console.error('Error createUnit:', error)
      return {
        success: false,
        error: error.message,
        data: null
      }
    }
  }

  /**
   * Actualizar unidad existente (solo tenant, no sistema)
   * @param {string} tenantId - ID del tenant
   * @param {string} unitId - ID de la unidad
   * @param {object} unitData - Datos actualizados
   * @returns {Promise<{success: boolean, data: object}>}
   */
  async updateUnit(tenantId, unitId, unitData) {
    try {
      const updatedUnit = {
        code: unitData.code.toUpperCase().trim(),
        dian_code: unitData.dian_code ? unitData.dian_code.toUpperCase().trim() : null,
        name: unitData.name.trim(),
        description: unitData.description || null,
        is_active: unitData.is_active !== undefined ? unitData.is_active : true
      }

      const { data, error } = await supabaseService.client
        .from(this.table)
        .update(updatedUnit)
        .eq('unit_id', unitId)
        .eq('tenant_id', tenantId)  // Seguridad: solo su tenant
        .eq('is_system', false)      // Seguridad: no editar sistema
        .select()
        .single()

      if (error) throw error

      return {
        success: true,
        data: data
      }
    } catch (error) {
      console.error('Error updateUnit:', error)
      return {
        success: false,
        error: error.message,
        data: null
      }
    }
  }

  /**
   * Eliminar unidad (solo tenant, no sistema)
   * @param {string} tenantId - ID del tenant
   * @param {string} unitId - ID de la unidad
   * @returns {Promise<{success: boolean}>}
   */
  async deleteUnit(tenantId, unitId) {
    try {
      // Validar que no esté en uso
      const usageCheck = await this.checkUnitUsage(unitId)
      if (!usageCheck.success) {
        throw new Error('Error al verificar uso de la unidad')
      }

      if (usageCheck.inUse) {
        throw new Error(
          `No se puede eliminar: La unidad está siendo usada en ${usageCheck.usage.products} productos, ` +
          `${usageCheck.usage.variants} variantes y ${usageCheck.usage.bom_components} componentes BOM`
        )
      }

      const { error } = await supabaseService.client
        .from(this.table)
        .delete()
        .eq('unit_id', unitId)
        .eq('tenant_id', tenantId)  // Seguridad: solo su tenant
        .eq('is_system', false)      // Seguridad: no eliminar sistema

      if (error) throw error
      queryCache.invalidateByTags(['units'], { tenantId })

      return { success: true }
    } catch (error) {
      console.error('Error deleteUnit:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Verificar si una unidad está en uso
   * @param {string} unitId - ID de la unidad
   * @returns {Promise<{success: boolean, inUse: boolean, usage: object}>}
   */
  async checkUnitUsage(unitId) {
    try {
      // Verificar productos
      const { count: productsCount } = await supabaseService.client
        .from('products')
        .select('product_id', { count: 'exact', head: true })
        .eq('unit_id', unitId)

      // Verificar variantes
      const { count: variantsCount } = await supabaseService.client
        .from('product_variants')
        .select('variant_id', { count: 'exact', head: true })
        .eq('unit_id', unitId)

      // Verificar bom_components (si existe la tabla)
      let bomComponentsCount = 0
      const { count: bomCount } = await supabaseService.client
        .from('bom_components')
        .select('component_id', { count: 'exact', head: true })
        .eq('unit_id', unitId)
        .then(res => res)
        .catch(() => ({ count: 0 }))  // Ignorar si tabla no existe

      bomComponentsCount = bomCount || 0

      const totalUsage = (productsCount || 0) + (variantsCount || 0) + bomComponentsCount

      return {
        success: true,
        inUse: totalUsage > 0,
        usage: {
          products: productsCount || 0,
          variants: variantsCount || 0,
          bom_components: bomComponentsCount,
          total: totalUsage
        }
      }
    } catch (error) {
      console.error('Error checkUnitUsage:', error)
      return {
        success: false,
        inUse: false,
        usage: { products: 0, variants: 0, bom_components: 0, total: 0 }
      }
    }
  }

  /**
   * Obtener unidades activas (para dropdowns)
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<{success: boolean, data: array}>}
   */
  async getActiveUnits(tenantId) {
    try {
      return await queryCache.getOrLoad(
        'units:active',
        async () => {
          let query = supabaseService.client
            .from(this.table)
            .select('unit_id, code, name, dian_code, is_system')
            .eq('is_active', true)
            .order('is_system', { ascending: false })
            .order('name', { ascending: true })

          if (tenantId) {
            query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
          }

          const { data, error } = await query

          if (error) throw error

          return {
            success: true,
            data: data || []
          }
        },
        {
          tenantId,
          ttlMs: UNITS_CACHE_TTL_MS,
          storage: 'session',
          tags: ['units'],
          shouldCache: (result) => result?.success === true,
        }
      )
    } catch (error) {
      console.error('Error getActiveUnits:', error)
      return {
        success: false,
        error: error.message,
        data: []
      }
    }
  }

  /**
   * Buscar unidad por código
   * @param {string} tenantId - ID del tenant
   * @param {string} code - Código de la unidad
   * @returns {Promise<{success: boolean, data: object}>}
   */
  async getUnitByCode(tenantId, code) {
    try {
      let query = supabaseService.client
        .from(this.table)
        .select('*')
        .ilike('code', code.trim())
        .eq('is_active', true)
        .limit(1)

      // Buscar primero en tenant, luego sistema
      if (tenantId) {
        query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      }

      const { data, error } = await query

      if (error) throw error

      return {
        success: true,
        data: data && data.length > 0 ? data[0] : null
      }
    } catch (error) {
      console.error('Error getUnitByCode:', error)
      return {
        success: false,
        error: error.message,
        data: null
      }
    }
  }
}

export default new UnitsOfMeasureService()
