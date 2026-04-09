import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

const LOCATIONS_CACHE_TTL_MS = 5 * 60 * 1000

class LocationsService {
  constructor() {
    this.table = 'locations'
  }

  // Obtener sedes con paginación
  async getLocations(tenantId, page = 1, pageSize = 10, search = '') {
    try {
      const normalizedSearch = String(search || '').trim().toLowerCase()
      return await queryCache.getOrLoad(
        `locations:list:${JSON.stringify({ page, pageSize, search: normalizedSearch })}`,
        async () => {
          const from = (page - 1) * pageSize
          const to = from + pageSize - 1

          let query = supabaseService.client
            .from(this.table)
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .order('name', { ascending: true })
            .range(from, to)

          if (normalizedSearch) {
            query = query.or(`name.ilike.%${normalizedSearch}%,address.ilike.%${normalizedSearch}%,type.ilike.%${normalizedSearch}%`)
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
          ttlMs: LOCATIONS_CACHE_TTL_MS,
          storage: 'session',
          tags: ['locations'],
          shouldCache: (result) => result?.success === true,
        }
      )
    } catch (error) {
      console.error('Error fetching locations:', error)
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      }
    }
  }

  // Crear sede
  async createLocation(tenantId, location) {
    try {
      const { data, error } = await supabaseService.insert(this.table, {
        tenant_id: tenantId,
        name: location.name,
        type: location.type || 'STORE',
        address: location.address || null,
        is_active: location.is_active !== false
      })

      if (error) throw error
      queryCache.invalidateByTags(['locations'], { tenantId })

      return { success: true, data: data[0] }
    } catch (error) {
      console.error('Error creating location:', error)
      return { success: false, error: error.message }
    }
  }

  // Actualizar sede
  async updateLocation(tenantId, locationId, updates) {
    try {
      const updateData = {
        name: updates.name,
        type: updates.type || 'STORE',
        address: updates.address || null,
        is_active: updates.is_active
      }

      const { data, error } = await supabaseService.update(
        this.table,
        updateData,
        {
          tenant_id: tenantId,
          location_id: locationId
        }
      )

      if (error) throw error
      queryCache.invalidateByTags(['locations'], { tenantId })

      return { success: true, data: data[0] }
    } catch (error) {
      console.error('Error updating location:', error)
      return { success: false, error: error.message }
    }
  }

  // Eliminar sede
  async deleteLocation(tenantId, locationId) {
    try {
      const { error } = await supabaseService.delete(this.table, {
        tenant_id: tenantId,
        location_id: locationId
      })

      if (error) throw error
      queryCache.invalidateByTags(['locations'], { tenantId })

      return { success: true }
    } catch (error) {
      console.error('Error deleting location:', error)
      return { success: false, error: error.message }
    }
  }

  // Obtener todas las sedes activas (sin paginación)
  async getActiveLocations(tenantId) {
    try {
      return await queryCache.getOrLoad(
        'locations:active',
        async () => {
          const { data, error } = await supabaseService.client
            .from(this.table)
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('name', { ascending: true })

          if (error) throw error

          return {
            success: true,
            data: data || []
          }
        },
        {
          tenantId,
          ttlMs: LOCATIONS_CACHE_TTL_MS,
          storage: 'session',
          tags: ['locations'],
          shouldCache: (result) => result?.success === true,
        }
      )
    } catch (error) {
      console.error('Error fetching active locations:', error)
      return {
        success: false,
        error: error.message,
        data: []
      }
    }
  }
}

export default new LocationsService()
