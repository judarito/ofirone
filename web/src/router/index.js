import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '@/plugins/supabase'
import { canManageTenants } from '@/utils/superAdmin'
import rolesService from '@/services/roles.service'
import supabaseService from '@/services/supabase.service'
import tenantBillingService, { getBillingRouteAccess } from '@/services/tenantBilling.service'

const Login = () => import('@/views/Login.vue')
const Home = () => import('@/views/Home.vue')
const About = () => import('@/views/About.vue')
const Settings = () => import('@/views/Settings.vue')
const Users = () => import('@/views/Users.vue')
const PaymentMethods = () => import('@/views/PaymentMethods.vue')
const Locations = () => import('@/views/Locations.vue')
const Categories = () => import('@/views/Categories.vue')
const UnitsOfMeasure = () => import('@/views/UnitsOfMeasure.vue')
const Products = () => import('@/views/Products.vue')
const BulkImports = () => import('@/views/BulkImports.vue')
const Customers = () => import('@/views/Customers.vue')
const ThirdParties = () => import('@/views/ThirdParties.vue')
const Taxes = () => import('@/views/Taxes.vue')
const TaxRules = () => import('@/views/TaxRules.vue')
const PricingRules = () => import('@/views/PricingRules.vue')
const Roles = () => import('@/views/Roles.vue')
const CashSessions = () => import('@/views/CashSessions.vue')
const CashRegisters = () => import('@/views/CashRegisters.vue')
const PointOfSale = () => import('@/views/PointOfSale.vue')
const Sales = () => import('@/views/Sales.vue')
const Inventory = () => import('@/views/Inventory.vue')
const BatchManagement = () => import('@/views/BatchManagement.vue')
const ReportsHub = () => import('@/views/ReportsHub.vue')
const SalesReport = () => import('@/views/SalesReport.vue')
const InventoryReport = () => import('@/views/InventoryReport.vue')
const ProductionReport = () => import('@/views/ProductionReport.vue')
const CashReport = () => import('@/views/CashReport.vue')
const FinancialReport = () => import('@/views/FinancialReport.vue')
const TenantConfig = () => import('@/views/TenantConfig.vue')
const TenantManagement = () => import('@/views/TenantManagement.vue')
const LayawayContracts = () => import('@/views/LayawayContracts.vue')
const LayawayDetail = () => import('@/views/LayawayDetail.vue')
const CashRegisterAssignments = () => import('@/views/CashRegisterAssignments.vue')
const Purchases = () => import('@/views/Purchases.vue')
const ProductionOrders = () => import('@/views/ProductionOrders.vue')
const BOMs = () => import('@/views/BOMs.vue')
const Cartera = () => import('@/views/Cartera.vue')
const Accounting = () => import('@/views/Accounting.vue')
const AccountingJournal = () => import('@/views/AccountingJournal.vue')
const AccountingLedger = () => import('@/views/AccountingLedger.vue')
const AccountingWithholdings = () => import('@/views/AccountingWithholdings.vue')
const AccountingClosing = () => import('@/views/AccountingClosing.vue')
const AccountingAutomation = () => import('@/views/AccountingAutomation.vue')
const AccountingManualEntries = () => import('@/views/AccountingManualEntries.vue')
const AccountingChartOfAccounts = () => import('@/views/AccountingChartOfAccounts.vue')
const AccountingStatements = () => import('@/views/AccountingStatements.vue')
const AccountingTaxCenter = () => import('@/views/AccountingTaxCenter.vue')
const AccountingReconciliation = () => import('@/views/AccountingReconciliation.vue')
const AccountingAIControl = () => import('@/views/AccountingAIControl.vue')
const SetupWizard = () => import('@/components/SetupWizard.vue')
const HelpCenter = () => import('@/views/HelpCenter.vue')
const SuperAdminBilling = () => import('@/views/SuperAdminBilling.vue')

function isRouteAlwaysAllowed(path) {
  return path === '/' || path === '/about' || path === '/setup' || path === '/help'
}
function canAccessPathByMenu(path, allowedRoutes) {
  if (!Array.isArray(allowedRoutes) || allowedRoutes.length === 0) return true
  if (isRouteAlwaysAllowed(path)) return true
  return allowedRoutes.some((menuRoute) => {
    if (!menuRoute || menuRoute === '/') return path === menuRoute
    return path === menuRoute || path.startsWith(`${menuRoute}/`)
  })
}

function isRecoveryNavigation(to) {
  const hash = (to.hash || '').toLowerCase()
  const fullPath = (to.fullPath || '').toLowerCase()
  return hash.includes('type=recovery') || fullPath.includes('type=recovery')
}
async function getAllowedMenuRoutes(authUserId) {
  return getAllowedMenuRoutesWithOptions(authUserId, { force: false })
}

async function getAllowedMenuRoutesWithOptions(authUserId, options = {}) {
  try {
    const result = await rolesService.getUserMenus(authUserId, { force: options?.force === true })
    if (!result.success) {
      console.warn('No se pudo validar acceso por menu (fn_get_user_menus):', result.error)
      return null
    }
    const routes = [...new Set((result.flat || []).map((item) => item.route).filter(Boolean))]
    return routes
  } catch (error) {
    console.warn('Error al cargar menus para guard de rutas:', error.message)
    return null
  }
}

async function canAccessTenantConfig() {
  try {
    if (await canManageTenants()) return true

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return false

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_user_id', user.id)
      .single()

    if (profileError || !profile?.user_id) return false

    const { data: userRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('role:role_id(name)')
      .eq('user_id', profile.user_id)

    if (rolesError) return false

    const roleNames = (userRoles || []).map(r => r.role?.name).filter(Boolean)
    return roleNames.includes('ADMINISTRADOR') || roleNames.includes('GERENTE')
  } catch (error) {
    console.error('Error checking tenant-config access:', error)
    return false
  }
}

async function getCurrentUserTenantId(authUserId) {
  if (!authUserId) return null

  try {
    const { data, error } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (error) return null
    return data?.tenant_id || null
  } catch (_error) {
    return null
  }
}

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresGuest: true }
  },
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: { requiresAuth: true }
  },
  {
    path: '/about',
    name: 'About',
    component: About,
    meta: { requiresAuth: true }
  },
  {
    path: '/help',
    name: 'HelpCenter',
    component: HelpCenter,
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: Settings,
    meta: { requiresAuth: true }
  },
  {
    path: '/auth',
    name: 'Users',
    component: Users,
    meta: { requiresAuth: true }
  },
  {
    path: '/payment-methods',
    name: 'PaymentMethods',
    component: PaymentMethods,
    meta: { requiresAuth: true }
  },
  {
    path: '/locations',
    name: 'Locations',
    component: Locations,
    meta: { requiresAuth: true }
  },
  {
    path: '/categories',
    name: 'Categories',
    component: Categories,
    meta: { requiresAuth: true }
  },
  {
    path: '/units',
    name: 'UnitsOfMeasure',
    component: UnitsOfMeasure,
    meta: { requiresAuth: true }
  },
  {
    path: '/products',
    name: 'Products',
    component: Products,
    meta: { requiresAuth: true }
  },
  {
    path: '/bulk-imports',
    name: 'BulkImports',
    component: BulkImports,
    meta: { requiresAuth: true }
  },
  {
    path: '/production-orders',
    name: 'ProductionOrders',
    component: ProductionOrders,
    meta: { requiresAuth: true }
  },
  {
    path: '/boms',
    name: 'BOMs',
    component: BOMs,
    meta: { requiresAuth: true }
  },
  {
    path: '/customers',
    name: 'Customers',
    component: Customers,
    meta: { requiresAuth: true }
  },
  {
    path: '/third-parties',
    name: 'ThirdParties',
    component: ThirdParties,
    meta: { requiresAuth: true }
  },
  {
    path: '/taxes',
    name: 'Taxes',
    component: Taxes,
    meta: { requiresAuth: true }
  },
  {
    path: '/tax-rules',
    name: 'TaxRules',
    component: TaxRules,
    meta: { requiresAuth: true }
  },
  {
    path: '/pricing-rules',
    name: 'PricingRules',
    component: PricingRules,
    meta: { requiresAuth: true }
  },
  {
    path: '/roles',
    name: 'Roles',
    component: Roles,
    meta: { requiresAuth: true } // Read-only para tenant admins; edición solo en /superadmin/roles-menus
  },
  {
    path: '/superadmin/billing',
    name: 'SuperAdminBilling',
    component: SuperAdminBilling,
    meta: { requiresAuth: true, requiresSuperAdmin: true }
  },
  {
    path: '/superadmin/roles-menus',
    name: 'SuperAdminRolesMenus',
    component: () => import('@/views/SuperAdminRolesMenus.vue'),
    meta: { requiresAuth: true, requiresSuperAdmin: true }
  },
  {
    path: '/cash-sessions',
    name: 'CashSessions',
    component: CashSessions,
    meta: { requiresAuth: true }
  },
  {
    path: '/cash-registers',
    name: 'CashRegisters',
    component: CashRegisters,
    meta: { requiresAuth: true }
  },
  {
    path: '/cash-assignments',
    name: 'CashRegisterAssignments',
    component: CashRegisterAssignments,
    meta: { requiresAuth: true }
  },
  {
    path: '/pos',
    name: 'PointOfSale',
    component: PointOfSale,
    meta: { requiresAuth: true }
  },
  {
    path: '/sales',
    name: 'Sales',
    component: Sales,
    meta: { requiresAuth: true }
  },
  {
    path: '/inventory',
    name: 'Inventory',
    component: Inventory,
    meta: { requiresAuth: true }
  },
  {
    path: '/batches',
    name: 'BatchManagement',
    component: BatchManagement,
    meta: { requiresAuth: true }
  },
  {
    path: '/purchases',
    name: 'Purchases',
    component: Purchases,
    meta: { requiresAuth: true }
  },
  {
    path: '/reports',
    name: 'Reports',
    component: ReportsHub,
    meta: { requiresAuth: true }
  },
  {
    path: '/reports/ventas',
    name: 'SalesReport',
    component: SalesReport,
    meta: { requiresAuth: true }
  },
  {
    path: '/reports/inventario',
    name: 'InventoryReport',
    component: InventoryReport,
    meta: { requiresAuth: true }
  },
  {
    path: '/reports/produccion',
    name: 'ProductionReport',
    component: ProductionReport,
    meta: { requiresAuth: true }
  },
  {
    path: '/reports/cajas',
    name: 'CashReport',
    component: CashReport,
    meta: { requiresAuth: true }
  },
  {
    path: '/reports/financiero',
    name: 'FinancialReport',
    component: FinancialReport,
    meta: { requiresAuth: true }
  },
  {
    path: '/tenant-config',
    name: 'TenantConfig',
    component: TenantConfig,
    meta: { requiresAuth: true, requiresTenantConfigAccess: true }
  },
  {
    path: '/tenant-management',
    name: 'TenantManagement',
    component: TenantManagement,
    meta: { requiresAuth: true, requiresSuperAdmin: true }
  },
  {
    path: '/setup',
    name: 'SetupWizard',
    component: SetupWizard,
    meta: { requiresAuth: true }
  },
  {
    path: '/layaway',
    name: 'LayawayContracts',
    component: LayawayContracts,
    meta: { requiresAuth: true }
  },
  {
    path: '/layaway/:id',
    name: 'LayawayDetail',
    component: LayawayDetail,
    meta: { requiresAuth: true }
  },
  {
    path: '/cartera',
    name: 'Cartera',
    component: Cartera,
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting',
    name: 'Accounting',
    component: Accounting,
    alias: ['/contabilidad'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/dashboard',
    name: 'AccountingDashboard',
    component: Accounting,
    alias: ['/contabilidad/dashboard'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/compliance',
    name: 'AccountingCompliance',
    component: Accounting,
    alias: ['/contabilidad/compliance'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/queue',
    name: 'AccountingQueue',
    component: Accounting,
    alias: ['/contabilidad/queue'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/assistant',
    name: 'AccountingAssistant',
    component: Accounting,
    alias: ['/contabilidad/asistente-ia'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/asientos-manuales',
    name: 'AccountingManualEntries',
    component: AccountingManualEntries,
    alias: ['/contabilidad/asientos-manuales'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/plan-cuentas',
    name: 'AccountingChartOfAccounts',
    component: AccountingChartOfAccounts,
    alias: ['/contabilidad/plan-cuentas'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/estados-financieros',
    name: 'AccountingStatements',
    component: AccountingStatements,
    alias: ['/contabilidad/estados-financieros'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/centro-tributario',
    name: 'AccountingTaxCenter',
    component: AccountingTaxCenter,
    alias: ['/contabilidad/centro-tributario'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/conciliacion',
    name: 'AccountingReconciliation',
    component: AccountingReconciliation,
    alias: ['/contabilidad/conciliacion'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/control-ia',
    name: 'AccountingAIControl',
    component: AccountingAIControl,
    alias: ['/contabilidad/control-ia'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/retenciones',
    name: 'AccountingWithholdings',
    component: AccountingWithholdings,
    alias: ['/contabilidad/retenciones'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/cierre',
    name: 'AccountingClosing',
    component: AccountingClosing,
    alias: ['/contabilidad/cierre'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/automatizacion',
    name: 'AccountingAutomation',
    component: AccountingAutomation,
    alias: ['/contabilidad/automatizacion'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/diario',
    name: 'AccountingJournal',
    component: AccountingJournal,
    alias: ['/contabilidad/diario'],
    meta: { requiresAuth: true }
  },
  {
    path: '/accounting/mayor',
    name: 'AccountingLedger',
    component: AccountingLedger,
    alias: ['/contabilidad/mayor'],
    meta: { requiresAuth: true }
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Guard de navegación
router.beforeEach(async (to, from, next) => {
  try {
    const session = await supabaseService.getValidSession({ redirectOnFail: false })
    const isAuthenticated = !!session

    // Validación de autenticación
    if (to.meta.requiresAuth && !isAuthenticated) {
      next('/login')
      return
    }
    
    if (to.meta.requiresGuest && isAuthenticated) {
      if (to.path === '/login' && isRecoveryNavigation(to)) {
        next()
        return
      }
      next('/')
      return
    }

    if (to.path === '/' && isAuthenticated) {
      const isTenantSuperAdmin = await canManageTenants()
      if (isTenantSuperAdmin) {
        next('/tenant-management')
        return
      }
    }

    // Validación de Super Admin para gestión de tenants
    if (to.meta.requiresSuperAdmin && isAuthenticated) {
      const isSuperAdmin = await canManageTenants()
      if (!isSuperAdmin) {
        console.warn('🔐 Acceso denegado: Solo Super Admins pueden gestionar tenants')
        next('/') // Redirigir a home
        return
      }
    }

    if (to.meta.requiresTenantConfigAccess && isAuthenticated) {
      const allowedTenantConfig = await canAccessTenantConfig()
      if (!allowedTenantConfig) {
        console.warn('Acceso denegado: configuración de tenant requiere rol autorizado')
        next('/')
        return
      }
    }

    if (
      to.meta.requiresAuth &&
      !to.meta.requiresSuperAdmin &&
      isAuthenticated &&
      session?.user?.id
    ) {
      const isSuperAdmin = await canManageTenants()
      if (!isSuperAdmin) {
        const tenantId = await getCurrentUserTenantId(session.user.id)
        if (tenantId) {
          const billingResult = await tenantBillingService.getTenantBillingSummary(tenantId)
          if (billingResult.success && billingResult.data) {
            const access = getBillingRouteAccess(billingResult.data, to.path)
            if (!access.allowed) {
              console.warn(`Acceso denegado por billing (${access.restriction}): ${to.path}`)
              next({
                path: '/about',
                query: {
                  billing_blocked: access.restriction,
                },
              })
              return
            }
          }
        }
      }
    }

    // Guard adicional: bloquear acceso directo por URL si la ruta no existe en el menu permitido del usuario.
    // Excluye rutas con validacion dedicada (superadmin/tenant-config).
    if (
      to.meta.requiresAuth &&
      !to.meta.requiresSuperAdmin &&
      !to.meta.requiresTenantConfigAccess &&
      session?.user?.id
    ) {
      const allowedRoutes = await getAllowedMenuRoutes(session.user.id)
      if (Array.isArray(allowedRoutes) && !canAccessPathByMenu(to.path, allowedRoutes)) {
        // Reintento forzado para evitar falsos bloqueos por caché de menús desactualizado.
        const freshAllowedRoutes = await getAllowedMenuRoutesWithOptions(session.user.id, { force: true })
        if (Array.isArray(freshAllowedRoutes) && !canAccessPathByMenu(to.path, freshAllowedRoutes)) {
          console.warn(`Acceso denegado por menú: ${to.path}`)
          next('/')
          return
        }
      }
    }
    next()
  } catch (error) {
    console.error('Router guard error:', error)
    // En caso de error, dejar pasar a login para evitar app congelada
    if (to.meta.requiresAuth) {
      next('/login')
    } else {
      next()
    }
  }
})

export default router
