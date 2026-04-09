import { computed, ref, watch } from 'vue'
import { useTenant } from './useTenant'
import { supabase } from '@/plugins/supabase'

const STATE_META = {
  BLOCKED: {
    label: 'Bloqueado',
    color: 'error',
    icon: 'mdi-alert-circle'
  },
  IN_PROGRESS: {
    label: 'En progreso',
    color: 'warning',
    icon: 'mdi-progress-clock'
  },
  READY_FOR_TEST: {
    label: 'Listo para probar',
    color: 'info',
    icon: 'mdi-flask-outline'
  },
  OPERATIONAL: {
    label: 'Operativo',
    color: 'success',
    icon: 'mdi-check-decagram'
  }
}

const STATE_ORDER = {
  BLOCKED: 0,
  IN_PROGRESS: 1,
  READY_FOR_TEST: 2,
  OPERATIONAL: 3
}

function asFilters(query, filters = []) {
  return filters.reduce((current, apply) => apply(current), query)
}

async function safeCount(table, filters = []) {
  try {
    const query = asFilters(
      supabase.from(table).select('*', { count: 'exact', head: true }),
      filters
    )
    const { count, error } = await query
    if (error) throw error
    return count || 0
  } catch (error) {
    console.warn(`[setup-assistant] No se pudo contar ${table}:`, error.message)
    return 0
  }
}

async function safeMaybeSingle(table, columns, filters = []) {
  try {
    const query = asFilters(
      supabase.from(table).select(columns).maybeSingle(),
      filters
    )
    const { data, error } = await query
    if (error) throw error
    return data || null
  } catch (error) {
    console.warn(`[setup-assistant] No se pudo leer ${table}:`, error.message)
    return null
  }
}

function createStep({
  id,
  title,
  description,
  route,
  required = true,
  completed = false,
  actionLabel = 'Ir al modulo',
  kind = 'setup'
}) {
  return {
    id,
    title,
    description,
    route,
    required,
    completed,
    actionLabel,
    kind,
    stateLabel: completed ? 'Completado' : (required ? 'Pendiente' : 'Recomendado'),
    stateColor: completed ? 'success' : (required ? 'warning' : 'grey')
  }
}

function routeToTenantConfig(tab, onboarding) {
  return {
    path: '/tenant-config',
    query: {
      tab,
      onboarding
    }
  }
}

function routeToAccounting(tab, onboarding) {
  return {
    path: '/accounting',
    query: {
      tab,
      onboarding
    }
  }
}

function routeToInventory(tab, onboarding) {
  return {
    path: '/inventory',
    query: {
      tab,
      onboarding
    }
  }
}

function routeToProducts(tab, onboarding, action = null) {
  const query = {
    tab,
    onboarding
  }

  if (action) {
    query.action = action
  }

  return {
    path: '/products',
    query
  }
}

function finalizeProcess(process) {
  const requiredSteps = process.steps.filter((step) => step.required)
  const completedRequired = requiredSteps.filter((step) => step.completed).length
  const missingRequired = requiredSteps.filter((step) => !step.completed)
  const proofStep = process.steps.find((step) => step.kind === 'proof')
  const pendingOptional = process.steps.filter((step) => !step.required && !step.completed)

  let state = 'IN_PROGRESS'
  if (missingRequired.length > 0) {
    state = 'BLOCKED'
  } else if (proofStep && !proofStep.completed) {
    state = 'READY_FOR_TEST'
  } else if (pendingOptional.length > 0) {
    state = 'IN_PROGRESS'
  } else {
    state = 'OPERATIONAL'
  }

  const progressPercentage = process.steps.length > 0
    ? Math.round((process.steps.filter((step) => step.completed).length / process.steps.length) * 100)
    : 0
  const nextStep = missingRequired[0] || process.steps.find((step) => !step.completed) || null
  const stateMeta = STATE_META[state]

  return {
    ...process,
    state,
    stateLabel: stateMeta.label,
    stateColor: stateMeta.color,
    stateIcon: stateMeta.icon,
    requiredStepsCount: requiredSteps.length,
    completedRequired,
    missingRequired,
    progressPercentage,
    nextStep,
    blockers: missingRequired.map((step) => step.title)
  }
}

function buildProcesses(snapshot) {
  const businessConfigured = Boolean(snapshot.settings?.business_name && snapshot.settings?.invoice_prefix)
  const accountingConfigured = Boolean(snapshot.settings?.accounting_enabled)
  const accountingAutomationConfigured = Boolean(
    snapshot.settings?.accounting_auto_post_sales || snapshot.settings?.accounting_auto_post_purchases
  )
  const catalogConfigured = snapshot.productsCount > 0 && snapshot.productVariantsCount > 0
  const processes = [
    finalizeProcess({
      id: 'sales',
      title: 'Vender',
      description: 'Deja listo el POS para atender clientes sin friccion.',
      icon: 'mdi-point-of-sale',
      route: '/pos',
      onboardingTitle: 'Primera venta guiada',
      onboardingDescription: 'Antes de vender, confirma datos comerciales, sede, caja y un catalogo con productos y variantes listas para cobrar.',
      steps: [
        createStep({
          id: 'sales-company',
          title: 'Configurar datos de empresa y prefijo',
          description: 'Ajusta datos comerciales basicos para facturar y emitir recibos correctamente.',
          route: routeToTenantConfig('general', 'sales-company'),
          completed: businessConfigured,
          actionLabel: 'Configurar empresa'
        }),
        createStep({
          id: 'sales-location',
          title: 'Tener al menos una sede activa',
          description: 'La venta necesita una ubicacion operativa donde descontar inventario.',
          route: '/locations',
          completed: snapshot.locationsCount > 0,
          actionLabel: 'Crear sede'
        }),
        createStep({
          id: 'sales-register',
          title: 'Configurar una caja registradora',
          description: 'La caja define donde se abriran sesiones y se registraran pagos.',
          route: '/cash-registers',
          completed: snapshot.registersCount > 0,
          actionLabel: 'Crear caja'
        }),
        createStep({
          id: 'sales-payment-methods',
          title: 'Activar medios de pago',
          description: 'Verifica que existan medios de pago activos para cerrar la venta.',
          route: '/payment-methods',
          completed: snapshot.paymentMethodsCount > 0,
          actionLabel: 'Revisar pagos'
        }),
        createStep({
          id: 'sales-products',
          title: 'Configurar productos y variantes',
          description: 'El POS vende variantes. Crea el producto manualmente en catalogo o usa cargue masivo si ya vienes con Excel.',
          route: routeToProducts('products', 'sales-products', 'create-product'),
          completed: catalogConfigured,
          actionLabel: 'Configurar catalogo'
        }),
        createStep({
          id: 'sales-assignments',
          title: 'Asignar usuarios a caja',
          description: 'Asigna al menos un usuario a una caja para operar sin bloqueos.',
          route: '/cash-assignments',
          required: false,
          completed: snapshot.cashAssignmentsCount > 0,
          actionLabel: 'Asignar caja'
        }),
        createStep({
          id: 'sales-proof',
          title: 'Hacer una venta de prueba',
          description: 'Confirma que el flujo de venta realmente ya esta operativo.',
          route: '/pos',
          required: false,
          completed: snapshot.salesCount > 0,
          actionLabel: 'Probar venta',
          kind: 'proof'
        })
      ]
    }),
    finalizeProcess({
      id: 'purchases',
      title: 'Comprar',
      description: 'Prepara compras, recepcion de mercancia y cuentas por pagar.',
      icon: 'mdi-cart-plus',
      route: '/purchases',
      onboardingTitle: 'Primera compra guiada',
      onboardingDescription: 'La compra inicial debe validar proveedor, sede, catalogo con variantes y entrada real al inventario.',
      steps: [
        createStep({
          id: 'purchases-suppliers',
          title: 'Crear al menos un proveedor',
          description: 'Las compras necesitan un tercero tipo proveedor o mixto.',
          route: '/third-parties',
          completed: snapshot.suppliersCount > 0,
          actionLabel: 'Crear proveedor'
        }),
        createStep({
          id: 'purchases-location',
          title: 'Definir sede de recepcion',
          description: 'La compra debe saber a que sede o bodega entra el inventario.',
          route: '/locations',
          completed: snapshot.locationsCount > 0,
          actionLabel: 'Revisar sedes'
        }),
        createStep({
          id: 'purchases-products',
          title: 'Tener productos y variantes para comprar',
          description: 'Necesitas el catalogo listo para recibir mercancia, ya sea creado en Productos o cargado masivamente.',
          route: routeToProducts('products', 'purchases-products'),
          completed: catalogConfigured,
          actionLabel: 'Preparar catalogo'
        }),
        createStep({
          id: 'purchases-proof',
          title: 'Registrar una compra de prueba',
          description: 'Valida recepcion, costos y actualizacion de inventario.',
          route: '/purchases',
          required: false,
          completed: snapshot.purchasesCount > 0,
          actionLabel: 'Probar compra',
          kind: 'proof'
        })
      ]
    }),
    finalizeProcess({
      id: 'cash',
      title: 'Operar caja',
      description: 'Asegura apertura, asignacion y cierre de caja.',
      icon: 'mdi-cash-register',
      route: '/cash-sessions',
      onboardingTitle: 'Caja operativa sin bloqueos',
      onboardingDescription: 'Asigna una caja al usuario y valida una sesion real para evitar friccion en el POS.',
      steps: [
        createStep({
          id: 'cash-registers',
          title: 'Configurar caja activa',
          description: 'La operacion de caja parte de al menos una caja habilitada.',
          route: '/cash-registers',
          completed: snapshot.registersCount > 0,
          actionLabel: 'Configurar caja'
        }),
        createStep({
          id: 'cash-assignments',
          title: 'Asignar caja a un usuario',
          description: 'Sin asignacion, el usuario tendra friccion al abrir sesion.',
          route: '/cash-assignments',
          completed: snapshot.cashAssignmentsCount > 0,
          actionLabel: 'Asignar caja'
        }),
        createStep({
          id: 'cash-proof',
          title: 'Abrir o cerrar una sesion de prueba',
          description: 'Comprueba que arqueos y sesiones funcionan de punta a punta.',
          route: '/cash-sessions',
          required: false,
          completed: snapshot.cashSessionsCount > 0,
          actionLabel: 'Probar caja',
          kind: 'proof'
        })
      ]
    }),
    finalizeProcess({
      id: 'inventory',
      title: 'Controlar inventario',
      description: 'Valida catalogo, variantes, stock inicial y movimientos operativos.',
      icon: 'mdi-warehouse',
      route: '/inventory',
      onboardingTitle: 'Inventario visible y confiable',
      onboardingDescription: 'Carga stock inicial por compras, operaciones de inventario o cargue masivo, y valida luego un movimiento en kardex.',
      steps: [
        createStep({
          id: 'inventory-products',
          title: 'Configurar productos inventariables',
          description: 'Crea productos con control de inventario activo para poder registrar existencias reales.',
          route: routeToProducts('products', 'inventory-products', 'create-product'),
          completed: snapshot.inventoryProductsCount > 0,
          actionLabel: 'Revisar productos'
        }),
        createStep({
          id: 'inventory-variants',
          title: 'Asegurar variantes listas para operar',
          description: 'Cada producto debe tener al menos una variante disponible para comprar, mover o vender stock.',
          route: routeToProducts('products', 'inventory-variants'),
          completed: snapshot.productVariantsCount > 0,
          actionLabel: 'Gestionar variantes'
        }),
        createStep({
          id: 'inventory-stock',
          title: 'Registrar stock inicial',
          description: 'Puedes cargar inventario desde Compras, desde Operaciones de Inventario o con cargue masivo de productos y variantes con stock inicial.',
          route: routeToInventory('operations', 'inventory-stock'),
          completed: snapshot.stockWithQtyCount > 0,
          actionLabel: 'Cargar stock'
        }),
        createStep({
          id: 'inventory-proof',
          title: 'Generar un movimiento o ajuste',
          description: 'Comprueba en kardex que compras, ajustes o traslados ya reflejan la operacion real.',
          route: routeToInventory('kardex', 'inventory-proof'),
          required: false,
          completed: snapshot.inventoryMovesCount > 0,
          actionLabel: 'Probar inventario',
          kind: 'proof'
        })
      ]
    }),
  ]

  if (accountingConfigured) {
    processes.push(
      finalizeProcess({
        id: 'accounting',
        title: 'Activar contabilidad',
        description: 'Habilita la integracion contable sin bloquear POS ni compras.',
        icon: 'mdi-scale-balance',
        route: '/accounting',
        onboardingTitle: 'Adopcion contable gradual',
        onboardingDescription: 'Primero activa el modulo, luego configura plan de cuentas y por ultimo valida un evento real.',
        onboardingChecklist: [
          'Activa contabilidad desde Configuracion de Empresa.',
          'Carga cuentas base para posteo y automatizacion.',
          'Valida automatizacion y revisa cola/asientos con una operacion real.'
        ],
        steps: [
          createStep({
            id: 'accounting-enable',
            title: 'Habilitar modulo contable',
            description: 'Activa contabilidad y define modo base desde configuracion de empresa.',
            route: routeToTenantConfig('accounting', 'accounting-enable'),
            completed: accountingConfigured,
            actionLabel: 'Activar contabilidad'
          }),
          createStep({
            id: 'accounting-chart',
            title: 'Configurar cuentas contables base',
            description: 'Necesitas plan de cuentas minimo para automatizar eventos.',
            route: {
              path: '/accounting/plan-cuentas',
              query: {
                from: 'setup',
                onboarding: 'accounting-chart'
              }
            },
            completed: snapshot.accountingAccountsCount > 0,
            actionLabel: 'Configurar cuentas'
          }),
          createStep({
            id: 'accounting-automation',
            title: 'Definir automatizacion de ventas o compras',
            description: 'Activa al menos una automatizacion para que la operacion genere impacto contable.',
            route: routeToTenantConfig('accounting', 'accounting-automation'),
            required: false,
            completed: accountingAutomationConfigured,
            actionLabel: 'Ajustar automatizacion'
          }),
          createStep({
            id: 'accounting-proof',
            title: 'Verificar el primer asiento o evento',
            description: 'Confirma que la contabilidad recibe y procesa movimiento real.',
            route: routeToAccounting('queue', 'accounting-proof'),
            required: false,
            completed: snapshot.accountingEntriesCount > 0,
            actionLabel: 'Validar contabilidad',
            kind: 'proof'
          })
        ]
      })
    )
  }

  return processes
}

export function useSetupAssistant() {
  const { tenantId } = useTenant()

  const loading = ref(false)
  const error = ref('')
  const processes = ref([])
  const lastLoadedAt = ref(null)

  const loadSetupReadiness = async () => {
    if (!tenantId.value) {
      processes.value = []
      error.value = ''
      lastLoadedAt.value = null
      return []
    }

    loading.value = true
    error.value = ''

    try {
      const tid = tenantId.value
      const [
        settings,
        locationsCount,
        registersCount,
        paymentMethodsCount,
        productsCount,
        productVariantsCount,
        inventoryProductsCount,
        cashAssignmentsCount,
        salesCount,
        suppliersCount,
        purchasesCount,
        stockWithQtyCount,
        inventoryMovesCount,
        cashSessionsCount,
        accountingAccountsCount,
        accountingEntriesCount
      ] = await Promise.all([
        safeMaybeSingle('tenant_settings', 'business_name, invoice_prefix, accounting_enabled, accounting_auto_post_sales, accounting_auto_post_purchases', [
          (query) => query.eq('tenant_id', tid)
        ]),
        safeCount('locations', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.eq('is_active', true)
        ]),
        safeCount('cash_registers', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.eq('is_active', true)
        ]),
        safeCount('payment_methods', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.eq('is_active', true)
        ]),
        safeCount('products', [
          (query) => query.eq('tenant_id', tid)
        ]),
        safeCount('product_variants', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.eq('is_active', true)
        ]),
        safeCount('products', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.eq('track_inventory', true),
          (query) => query.eq('is_active', true)
        ]),
        safeCount('cash_register_assignments', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.eq('is_active', true)
        ]),
        safeCount('sales', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        ]),
        safeCount('third_parties', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.in('type', ['supplier', 'both']),
          (query) => query.eq('is_active', true)
        ]),
        safeCount('purchases', [
          (query) => query.eq('tenant_id', tid)
        ]),
        safeCount('stock_balances', [
          (query) => query.eq('tenant_id', tid),
          (query) => query.gt('on_hand', 0)
        ]),
        safeCount('inventory_moves', [
          (query) => query.eq('tenant_id', tid)
        ]),
        safeCount('cash_sessions', [
          (query) => query.eq('tenant_id', tid)
        ]),
        safeCount('accounting_accounts', [
          (query) => query.eq('tenant_id', tid)
        ]),
        safeCount('accounting_entries', [
          (query) => query.eq('tenant_id', tid)
        ])
      ])

      processes.value = buildProcesses({
        settings,
        locationsCount,
        registersCount,
        paymentMethodsCount,
        productsCount,
        productVariantsCount,
        inventoryProductsCount,
        cashAssignmentsCount,
        salesCount,
        suppliersCount,
        purchasesCount,
        stockWithQtyCount,
        inventoryMovesCount,
        cashSessionsCount,
        accountingAccountsCount,
        accountingEntriesCount
      })
      lastLoadedAt.value = new Date().toISOString()
      return processes.value
    } catch (currentError) {
      error.value = currentError.message || 'No se pudo evaluar el estado del asistente.'
      processes.value = []
      return []
    } finally {
      loading.value = false
    }
  }

  watch(tenantId, () => {
    processes.value = []
    error.value = ''
    lastLoadedAt.value = null
  }, { immediate: true })

  const overall = computed(() => {
    const totalProcesses = processes.value.length
    const operationalProcesses = processes.value.filter((process) => process.state === 'OPERATIONAL').length
    const requiredSteps = processes.value.reduce((acc, process) => acc + process.requiredStepsCount, 0)
    const completedRequired = processes.value.reduce((acc, process) => acc + process.completedRequired, 0)
    const progressPercentage = requiredSteps > 0
      ? Math.round((completedRequired / requiredSteps) * 100)
      : 0

    const nextProcess = [...processes.value]
      .sort((left, right) => {
        const stateDiff = STATE_ORDER[left.state] - STATE_ORDER[right.state]
        if (stateDiff !== 0) return stateDiff
        return left.progressPercentage - right.progressPercentage
      })
      .find((process) => process.state !== 'OPERATIONAL') || null

    const nextAction = nextProcess?.nextStep
      ? {
          processId: nextProcess.id,
          processTitle: nextProcess.title,
          title: nextProcess.nextStep.title,
          route: nextProcess.nextStep.route || nextProcess.route,
          label: nextProcess.nextStep.actionLabel || 'Continuar',
          description: nextProcess.nextStep.description
        }
      : null

    return {
      totalProcesses,
      operationalProcesses,
      requiredSteps,
      completedRequired,
      progressPercentage,
      isFullyOperational: totalProcesses > 0 && operationalProcesses === totalProcesses,
      nextProcess,
      nextAction
    }
  })

  const processMap = computed(() => {
    return processes.value.reduce((acc, process) => {
      acc[process.id] = process
      return acc
    }, {})
  })

  return {
    loading,
    error,
    processes,
    processMap,
    overall,
    lastLoadedAt,
    loadSetupReadiness
  }
}
