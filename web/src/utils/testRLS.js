// Utilidad para probar políticas RLS desde la aplicación
import { supabaseService } from '@/services/supabase.service'

export async function testCashierRLS() {
  console.group('🔍 Test RLS - Usuario Cajero')
  
  try {
    // 1. Obtener usuario actual
    const { data: { user }, error: authError } = await supabaseService.client.auth.getUser()
    
    if (authError || !user) {
      console.error('❌ Error obteniendo usuario:', authError)
      return
    }
    
    console.log('✅ Usuario autenticado:', user.email)
    console.log('📋 auth.uid():', user.id)
    
    // 2. Verificar datos en tabla users
    const { data: userData, error: userError } = await supabaseService.client
      .from('users')
      .select('user_id, full_name, email, tenant_id, is_active')
      .eq('auth_user_id', user.id)
      .single()
    
    if (userError) {
      console.error('❌ Error buscando en users:', userError)
      return
    }
    
    console.log('✅ Datos del usuario:', userData)
    
    // 3. Verificar roles
    const { data: roles, error: rolesError } = await supabaseService.client
      .from('user_roles')
      .select(`
        user_id,
        roles (
          role_id,
          name
        )
      `)
      .eq('user_id', userData.user_id)
    
    if (rolesError) {
      console.error('❌ Error obteniendo roles:', rolesError)
    } else {
      console.log('✅ Roles asignados:', roles.map(r => r.roles.name).join(', '))
    }
    
    // 4. Probar funciones helper con RPC
    const { data: isAdmin } = await supabaseService.client.rpc('is_user_admin')
    const { data: isCashier } = await supabaseService.client.rpc('is_user_cashier')
    const { data: tenantId } = await supabaseService.client.rpc('get_current_user_tenant_id')
    
    console.log('🔧 Funciones Helper:')
    console.log('  - is_user_admin():', isAdmin)
    console.log('  - is_user_cashier():', isCashier)
    console.log('  - get_current_user_tenant_id():', tenantId)
    
    // 5. Verificar sesiones de caja
    const { data: sessions, error: sessionsError } = await supabaseService.client
      .from('cash_sessions')
      .select('cash_session_id, cash_register_id, opened_at, status')
    
    if (sessionsError) {
      console.error('❌ Error obteniendo sesiones:', sessionsError)
    } else {
      console.log('✅ Sesiones de caja visibles:', sessions.length)
      console.table(sessions)
    }
    
    // 6. Verificar ventas
    const { data: sales, error: salesError } = await supabaseService.client
      .from('sales')
      .select('sale_id, cash_session_id, total, sold_at')
      .order('sold_at', { ascending: false })
      .limit(10)
    
    if (salesError) {
      console.error('❌ Error obteniendo ventas:', salesError)
    } else {
      console.log('✅ Ventas visibles:', sales.length)
      console.table(sales)
      
      // Verificar si hay ventas sin cash_session_id
      const salesWithoutSession = sales.filter(s => !s.cash_session_id)
      if (salesWithoutSession.length > 0) {
        console.warn('⚠️ Ventas sin cash_session_id:', salesWithoutSession.length)
      }
    }
    
    // 7. Verificar si RLS está habilitado
    try {
      const { data: rlsCheck } = await supabaseService.client.rpc('check_rls_enabled')
      console.log('🔒 Estado RLS:', rlsCheck || 'Verificar manualmente')
    } catch (rlsError) {
      console.log('🔒 Estado RLS: No se pudo verificar (función no existe o sin permisos)')
    }
    
  } catch (error) {
    console.error('❌ Error en test RLS:', error)
  }
  
  console.groupEnd()
}

// Función para verificar RLS (crear en Supabase)
export const CHECK_RLS_FUNCTION = `
CREATE OR REPLACE FUNCTION check_rls_enabled()
RETURNS TABLE(table_name text, rls_enabled boolean, policies_count bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    tablename::text,
    rowsecurity,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND pg_policies.tablename = pg_tables.tablename)
  FROM pg_tables
  WHERE schemaname = 'public' 
    AND tablename IN ('sales', 'cash_sessions', 'sale_lines', 'sale_payments')
  ORDER BY tablename;
$$;
`
