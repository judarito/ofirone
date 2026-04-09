/**
 * Servicio exclusivo para Superadmin: gestión de menús, roles y permisos
 * Superadmin = usuario autenticado SIN registro en tabla `users` (sin tenant)
 *
 * Responsabilidades:
 * - CRUD de menu_items (catálogo global)
 * - Asignar permisos a menús (menu_permissions)
 * - Crear/actualizar roles en TODOS los tenants (fn_superadmin_*)
 * - Gestionar role_menu_templates (plantillas estándar por nombre de rol)
 */
import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

class SuperAdminRolesService {
  // ============================================================
  // MENU ITEMS
  // ============================================================

  /**
   * Obtener todos los menu_items ordenados por sort_order
   * Incluye si es superadmin_only para distinguirlos en la UI
   */
  async getAllMenuItems() {
    try {
      const { data, error } = await supabaseService.client
        .from('menu_items')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('code', { ascending: true })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  /**
   * Obtener árbol de menús (grupos con sus hijos)
   * Útil para renderizar la UI de gestión
   */
  async getMenuTree() {
    try {
      const { data, error } = await supabaseService.client
        .from('menu_items')
        .select(`
          *,
          menu_permissions(
            permission_id,
            permissions:permission_id(permission_id, code, description)
          )
        `)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (error) throw error

      const items = data || []
      // Construir árbol: primero los raíz (parent_code = null)
      const roots = items.filter(i => !i.parent_code)
      const childrenMap = {}
      items.forEach(i => {
        if (i.parent_code) {
          if (!childrenMap[i.parent_code]) childrenMap[i.parent_code] = []
          childrenMap[i.parent_code].push(i)
        }
      })
      const tree = roots.map(r => ({
        ...r,
        children: childrenMap[r.code] || []
      }))

      return { success: true, data: tree }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  /**
   * Crear un nuevo ítem de menú
   */
  async createMenuItem(menuItem) {
    try {
      const { data, error } = await supabaseService.client
        .from('menu_items')
        .insert({
          code: menuItem.code?.toUpperCase(),
          label: menuItem.label,
          icon: menuItem.icon || null,
          route: menuItem.route || null,
          action: menuItem.action || null,
          parent_code: menuItem.parent_code || null,
          sort_order: menuItem.sort_order || 0,
          is_superadmin_only: menuItem.is_superadmin_only || false,
          is_active: true
        })
        .select()
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Actualizar un ítem de menú
   */
  async updateMenuItem(menuItemId, updates) {
    try {
      const { data, error } = await supabaseService.client
        .from('menu_items')
        .update({
          label: updates.label,
          icon: updates.icon || null,
          route: updates.route || null,
          action: updates.action || null,
          parent_code: updates.parent_code || null,
          sort_order: updates.sort_order ?? 0,
          is_superadmin_only: updates.is_superadmin_only || false,
          is_active: updates.is_active ?? true
        })
        .eq('menu_item_id', menuItemId)
        .select()
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Activar/desactivar un ítem de menú
   */
  async toggleMenuItemActive(menuItemId, isActive) {
    try {
      const { error } = await supabaseService.client
        .from('menu_items')
        .update({ is_active: isActive })
        .eq('menu_item_id', menuItemId)

      if (error) throw error
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ============================================================
  // MENU PERMISSIONS (permisos requeridos por menú)
  // ============================================================

  /**
   * Obtener permisos asignados a un menú
   */
  async getMenuPermissions(menuItemId) {
    try {
      const { data, error } = await supabaseService.client
        .from('menu_permissions')
        .select('permission_id, permissions:permission_id(permission_id, code, description)')
        .eq('menu_item_id', menuItemId)

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  /**
   * Reemplazar permisos de un menú (elimina existentes e inserta nuevos)
   */
  async setMenuPermissions(menuItemId, permissionIds) {
    try {
      // Eliminar existentes
      const { error: delError } = await supabaseService.client
        .from('menu_permissions')
        .delete()
        .eq('menu_item_id', menuItemId)

      if (delError) throw delError

      // Insertar nuevos
      if (permissionIds.length > 0) {
        const rows = permissionIds.map(pid => ({
          menu_item_id: menuItemId,
          permission_id: pid
        }))
        const { error: insError } = await supabaseService.client
          .from('menu_permissions')
          .insert(rows)

        if (insError) throw insError
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ============================================================
  // ROLE MENU TEMPLATES (plantillas globales por nombre de rol)
  // ============================================================

  /**
   * Obtener la plantilla de menús para un nombre de rol
   */
  async getRoleMenuTemplate(roleName) {
    try {
      const { data, error } = await supabaseService.client
        .from('role_menu_templates')
        .select('menu_item_id, menu_items:menu_item_id(code, label, icon, route)')
        .eq('role_name', roleName)

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  /**
   * Obtener todas las plantillas agrupadas por nombre de rol
   */
  async getAllRoleMenuTemplates() {
    try {
      const { data, error } = await supabaseService.client
        .from('role_menu_templates')
        .select('role_name, menu_item_id, menu_items:menu_item_id(code, label, icon, sort_order)')
        .order('role_name')

      if (error) throw error

      // Agrupar por role_name
      const grouped = {}
      ;(data || []).forEach(row => {
        if (!grouped[row.role_name]) grouped[row.role_name] = []
        grouped[row.role_name].push(row)
      })

      return { success: true, data: grouped }
    } catch (error) {
      return { success: false, data: {}, error: error.message }
    }
  }

  // ============================================================
  // OPERACIONES BULK EN TODOS LOS TENANTS (via RPC)
  // ============================================================

  /**
   * Crear un rol nuevo en TODOS los tenants con permisos y menús
   * Usa fn_superadmin_create_role_for_all_tenants (SECURITY DEFINER)
   */
  async createRoleForAllTenants(roleName, permissionIds = [], menuCodes = []) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_superadmin_create_role_for_all_tenants', {
          p_role_name: roleName,
          p_permission_ids: permissionIds,
          p_menu_codes: menuCodes
        })

      if (error) throw error
      if (!data?.success) throw new Error(data?.message || 'Error desconocido')
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Actualizar menús de un rol en TODOS los tenants (reemplaza)
   * Usa fn_superadmin_sync_menus_to_role_all_tenants (SECURITY DEFINER)
   */
  async syncRoleMenusToAllTenants(roleName, menuCodes = []) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_superadmin_sync_menus_to_role_all_tenants', {
          p_role_name: roleName,
          p_menu_codes: menuCodes
        })

      if (error) throw error
      if (!data?.success) throw new Error(data?.message || 'Error desconocido')
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ============================================================
  // PERMISOS GLOBALES (solo lectura para Superadmin también)
  // ============================================================

  /**
   * Obtener todos los permisos del sistema agrupados por módulo
   */
  async getAllPermissionsGrouped() {
    try {
      const { data, error } = await supabaseService.client
        .from('permissions')
        .select('*')
        .order('code')

      if (error) throw error

      // Agrupar por módulo (primera parte del código: SALES.VIEW → SALES)
      const grouped = {}
      ;(data || []).forEach(p => {
        const module = p.code.split('.')[0] || 'GENERAL'
        if (!grouped[module]) grouped[module] = []
        grouped[module].push(p)
      })

      return { success: true, data: grouped, flat: data || [] }
    } catch (error) {
      return { success: false, data: {}, flat: [], error: error.message }
    }
  }

  // ============================================================
  // INFORMACIÓN POR TENANT (para panel de Superadmin)
  // ============================================================

  /**
   * Obtener los menús asignados a un role_id específico
   */
  async getRoleMenusByRoleId(roleId) {
    try {
      const { data, error } = await supabaseService.client
        .from('role_menus')
        .select('menu_item_id, menu_items:menu_item_id(code, label, icon, route, sort_order)')
        .eq('role_id', roleId)

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  /**
   * Establecer los menús de un role_id específico (reemplaza)
   */
  async setRoleMenusByRoleId(roleId, menuItemIds = []) {
    try {
      const { error: delError } = await supabaseService.client
        .from('role_menus')
        .delete()
        .eq('role_id', roleId)

      if (delError) throw delError

      if (menuItemIds.length > 0) {
        const rows = menuItemIds.map(mid => ({ role_id: roleId, menu_item_id: mid }))
        const { error: insError } = await supabaseService.client
          .from('role_menus')
          .insert(rows)

        if (insError) throw insError
      }

      queryCache.invalidateByTags(['menus'])
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Obtener nombres de roles estándar únicos (de las plantillas)
   */
  async getStandardRoleNames() {
    try {
      const { data, error } = await supabaseService.client
        .from('role_menu_templates')
        .select('role_name')

      if (error) throw error

      const names = [...new Set((data || []).map(r => r.role_name))].sort()
      return { success: true, data: names }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }
}

export default new SuperAdminRolesService()
