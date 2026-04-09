/**
 * Servicio para gestión de Tenants
 */
import supabaseService from './supabase.service'
import { serviceErrorResult } from '@/utils/appErrors'

const isDev = import.meta.env.DEV
const debugLog = (...args) => {
  if (isDev) console.log(...args)
}

const tenantsService = {
  /**
   * Obtiene template JSON de configuración de un tenant
   */
  async getTenantTemplate(tenantId) {
    try {
      const { data, error } = await supabaseService.client.rpc(
        'fn_get_tenant_template_json',
        { p_tenant_id: tenantId }
      )

      if (error) throw error

      return { success: true, data }
    } catch (error) {
      console.error('Error obteniendo template de tenant:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Crea un nuevo tenant completo con configuración por defecto
   * @param {Object} tenantData - Datos del tenant
   * @param {string} tenantData.name - Nombre del tenant *
   * @param {string} tenantData.legal_name - Razón social
   * @param {string} tenantData.tax_id - NIT/RUT
   * @param {string} tenantData.email - Email
   * @param {string} tenantData.phone - Teléfono
   * @param {string} tenantData.address - Dirección
   * @param {string} tenantData.invoice_prefix - Prefijo de facturas (ej: "FAC")
   * @param {number} tenantData.invoice_start_number - Número inicial de facturación
   * @param {Object} adminData - Datos del administrador
   * @param {string} adminData.email - Email del admin *
   * @param {string} adminData.full_name - Nombre completo *
   * @param {string} adminData.password - Contraseña
   * @param {string} adminData.user_id - UUID del usuario en auth (si ya existe)
   */
  async createTenant(tenantData, adminData) {
    try {
      // 1. Validar y sanitizar email
      const adminEmail = adminData.email?.trim().toLowerCase()
      if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        throw new Error(`Email inválido: "${adminEmail}"`)
      }

      debugLog('📧 Email sanitizado para creación de tenant')

      // 2. Crear usuario en Supabase Auth
      let authUserId = adminData.user_id
      
      if (!authUserId) {
        // Generar contraseña temporal si no viene
        const tempPassword = adminData.password || `Temp${crypto.randomUUID().substring(0, 12)}!`
        
        debugLog('🔐 Creando usuario en Supabase Auth...')
        
        // Usar signUp (requiere deshabilitar email confirmation en Dashboard)
        const { data: authData, error: authError } = await supabaseService.client.auth.signUp({
          email: adminEmail,
          password: tempPassword,
          options: {
            data: {
              full_name: adminData.full_name,
              tenant_name: tenantData.name
            }
          }
        })

        if (authError) {
          console.error('❌ Error creando Auth user:', authError)
          throw new Error(`Error creando usuario Auth: ${authError.message}`)
        }

        if (!authData?.user?.id) {
          throw new Error('No se obtuvo ID de usuario Auth')
        }

        authUserId = authData.user.id
        debugLog('✅ Usuario Auth creado para tenant')
      }

      // 3. Llamar al SP para crear tenant completo (con defaults)
      const { data, error } = await supabaseService.client.rpc('fn_create_tenant', {
        p_tenant_data: {
          name: tenantData.name,
          legal_name: tenantData.legal_name || tenantData.name,
          tax_id: tenantData.tax_id,
          email: tenantData.email,
          phone: tenantData.phone,
          address: tenantData.address,
          invoice_prefix: tenantData.invoice_prefix || 'FAC',
          invoice_start_number: tenantData.invoice_start_number || 1,
          is_active: true
        },
        p_admin_data: {
          user_id: authUserId,
          email: adminEmail,  // Usar email sanitizado
          full_name: adminData.full_name
        }
      })

      if (error) throw error

      // Verificar resultado del SP
      if (!data?.success) {
        throw new Error(data?.message || 'Error desconocido creando tenant')
      }

      return { 
        success: true, 
        data: {
          ...data,
          auth_user_id: authUserId
        }
      }
    } catch (error) {
      console.error('Error creando tenant:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Lista todos los tenants (requiere permisos de super admin)
   */
  async getAllTenants() {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_superadmin_list_tenants')

      if (!error) {
        return { success: true, data: data || [] }
      }

      const functionMissing =
        error?.code === 'PGRST202' ||
        error?.message?.includes('fn_superadmin_list_tenants') ||
        error?.message?.includes('Could not find the function')

      if (!functionMissing) throw error

      const { data: fallbackData, error: fallbackError } = await supabaseService.client
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false })

      if (fallbackError) throw fallbackError

      return { success: true, data: fallbackData || [] }
    } catch (error) {
      console.error('Error obteniendo tenants:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Obtiene un tenant por ID
   */
  async getTenantById(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('tenants')
        .select('*')
        .eq('tenant_id', tenantId)
        .single()

      if (error) throw error

      return { success: true, data }
    } catch (error) {
      console.error('Error obteniendo tenant:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Actualiza un tenant
   */
  async updateTenant(tenantId, updates) {
    try {
      const { data, error } = await supabaseService.client
        .from('tenants')
        .update(updates)
        .eq('tenant_id', tenantId)
        .select()
        .single()

      if (error) throw error

      return { success: true, data }
    } catch (error) {
      console.error('Error actualizando tenant:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Activa/Desactiva un tenant
   */
  async toggleTenantStatus(tenantId, isActive) {
    return this.updateTenant(tenantId, { is_active: isActive })
  }
}

export default tenantsService
