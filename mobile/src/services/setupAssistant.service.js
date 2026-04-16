import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

const SETUP_CACHE_KEY = (tenantId) => `setup-readiness:${tenantId}`;

export const SETUP_STATE_META = {
  BLOCKED: {
    label: 'Bloqueado',
    color: '#ef4444',
    accent: '#7f1d1d',
  },
  IN_PROGRESS: {
    label: 'En progreso',
    color: '#f59e0b',
    accent: '#78350f',
  },
  READY_FOR_TEST: {
    label: 'Listo para probar',
    color: '#38bdf8',
    accent: '#0c4a6e',
  },
  OPERATIONAL: {
    label: 'Operativo',
    color: '#22c55e',
    accent: '#14532d',
  },
};

const STATE_ORDER = {
  BLOCKED: 0,
  IN_PROGRESS: 1,
  READY_FOR_TEST: 2,
  OPERATIONAL: 3,
};

function asFilters(query, filters = []) {
  return filters.reduce((current, apply) => apply(current), query);
}

async function safeCount(table, filters = []) {
  try {
    const query = asFilters(
      supabase.from(table).select('*', { count: 'exact', head: true }),
      filters,
    );
    const { count, error } = await query;
    if (error) throw error;
    return Number(count || 0);
  } catch (_error) {
    return 0;
  }
}

async function safeMaybeSingle(table, columns, filters = []) {
  try {
    const query = asFilters(
      supabase.from(table).select(columns).maybeSingle(),
      filters,
    );
    const { data, error } = await query;
    if (error) throw error;
    return data || null;
  } catch (_error) {
    return null;
  }
}

function createStep({
  id,
  title,
  description,
  screen,
  required = true,
  completed = false,
  actionLabel = 'Abrir módulo',
  kind = 'setup',
  webOnly = false,
}) {
  return {
    id,
    title,
    description,
    screen,
    required,
    completed,
    actionLabel,
    kind,
    webOnly,
  };
}

export function finalizeSetupProcess(process) {
  const requiredSteps = (process.steps || []).filter((step) => step.required);
  const completedRequired = requiredSteps.filter((step) => step.completed).length;
  const missingRequired = requiredSteps.filter((step) => !step.completed);
  const proofStep = (process.steps || []).find((step) => step.kind === 'proof');
  const pendingOptional = (process.steps || []).filter((step) => !step.required && !step.completed);

  let state = 'IN_PROGRESS';
  if (missingRequired.length > 0) {
    state = 'BLOCKED';
  } else if (proofStep && !proofStep.completed) {
    state = 'READY_FOR_TEST';
  } else if (pendingOptional.length > 0) {
    state = 'IN_PROGRESS';
  } else {
    state = 'OPERATIONAL';
  }

  const progressPercentage = (process.steps || []).length > 0
    ? Math.round((((process.steps || []).filter((step) => step.completed).length) / process.steps.length) * 100)
    : 0;
  const nextStep = missingRequired[0] || (process.steps || []).find((step) => !step.completed) || null;
  const meta = SETUP_STATE_META[state] || SETUP_STATE_META.IN_PROGRESS;

  return {
    ...process,
    state,
    stateLabel: meta.label,
    stateColor: meta.color,
    stateAccent: meta.accent,
    requiredStepsCount: requiredSteps.length,
    completedRequired,
    progressPercentage,
    nextStep,
    blockers: missingRequired.map((step) => step.title),
  };
}

export function buildSetupProcesses(snapshot = {}) {
  const settings = snapshot.settings || {};
  const businessConfigured = Boolean(settings.business_name && settings.invoice_prefix);
  const accountingConfigured = Boolean(settings.accounting_enabled);
  const accountingAutomationConfigured = Boolean(
    settings.accounting_auto_post_sales || settings.accounting_auto_post_purchases,
  );
  const catalogConfigured = Number(snapshot.productsCount || 0) > 0 && Number(snapshot.productVariantsCount || 0) > 0;
  const inventoryProductsConfigured = Number(snapshot.inventoryProductsCount || 0) > 0;

  const processes = [
    finalizeSetupProcess({
      id: 'sales',
      title: 'Vender',
      description: 'Deja listo el POS para cobrar, facturar y operar caja sin fricción.',
      icon: 'cart-outline',
      screen: 'PointOfSale',
      steps: [
        createStep({
          id: 'sales-company',
          title: 'Configurar empresa y prefijo',
          description: 'Define datos comerciales básicos para recibos y facturación.',
          screen: 'TenantConfig',
          completed: businessConfigured,
          actionLabel: 'Configurar empresa',
        }),
        createStep({
          id: 'sales-location',
          title: 'Tener una sede activa',
          description: 'La venta necesita al menos una sede donde operar inventario.',
          screen: 'Locations',
          completed: Number(snapshot.locationsCount || 0) > 0,
          actionLabel: 'Crear sede',
        }),
        createStep({
          id: 'sales-register',
          title: 'Configurar una caja',
          description: 'El POS necesita una caja lista para abrir sesión.',
          screen: 'CashRegisters',
          completed: Number(snapshot.registersCount || 0) > 0,
          actionLabel: 'Crear caja',
        }),
        createStep({
          id: 'sales-payment-methods',
          title: 'Activar medios de pago',
          description: 'Verifica que existan métodos de pago operativos.',
          screen: 'PaymentMethods',
          completed: Number(snapshot.paymentMethodsCount || 0) > 0,
          actionLabel: 'Revisar pagos',
        }),
        createStep({
          id: 'sales-products',
          title: 'Preparar productos y variantes',
          description: 'El POS vende variantes. Deja listo el catálogo antes de cobrar.',
          screen: 'Products',
          completed: catalogConfigured,
          actionLabel: 'Preparar catálogo',
        }),
        createStep({
          id: 'sales-assignments',
          title: 'Asignar usuarios a caja',
          description: 'Reduce fricción inicial asignando usuarios a una caja.',
          screen: 'CashAssignments',
          required: false,
          completed: Number(snapshot.cashAssignmentsCount || 0) > 0,
          actionLabel: 'Asignar caja',
        }),
        createStep({
          id: 'sales-proof',
          title: 'Hacer una venta de prueba',
          description: 'Confirma que todo el flujo de venta ya está operativo.',
          screen: 'PointOfSale',
          required: false,
          completed: Number(snapshot.salesCount || 0) > 0,
          actionLabel: 'Probar venta',
          kind: 'proof',
        }),
      ],
    }),
    finalizeSetupProcess({
      id: 'purchases',
      title: 'Comprar',
      description: 'Prepara la recepción de mercancía y la base de cuentas por pagar.',
      icon: 'receipt-outline',
      screen: 'Purchases',
      steps: [
        createStep({
          id: 'purchases-suppliers',
          title: 'Crear un proveedor',
          description: 'Las compras necesitan un tercero tipo proveedor o mixto.',
          screen: 'ThirdParties',
          completed: Number(snapshot.suppliersCount || 0) > 0,
          actionLabel: 'Crear proveedor',
        }),
        createStep({
          id: 'purchases-location',
          title: 'Definir sede de recepción',
          description: 'La compra debe entrar a una sede o bodega real.',
          screen: 'Locations',
          completed: Number(snapshot.locationsCount || 0) > 0,
          actionLabel: 'Revisar sedes',
        }),
        createStep({
          id: 'purchases-products',
          title: 'Tener variantes listas para comprar',
          description: 'Necesitas catálogo operativo para recibir mercancía.',
          screen: 'Products',
          completed: catalogConfigured,
          actionLabel: 'Preparar catálogo',
        }),
        createStep({
          id: 'purchases-proof',
          title: 'Registrar una compra de prueba',
          description: 'Valida recepción, costo y entrada al inventario.',
          screen: 'Purchases',
          required: false,
          completed: Number(snapshot.purchasesCount || 0) > 0,
          actionLabel: 'Probar compra',
          kind: 'proof',
        }),
      ],
    }),
    finalizeSetupProcess({
      id: 'cash',
      title: 'Operar caja',
      description: 'Asegura apertura, asignación y cierre de caja sin bloqueos.',
      icon: 'cash-outline',
      screen: 'CashSessions',
      steps: [
        createStep({
          id: 'cash-registers',
          title: 'Configurar caja activa',
          description: 'La operación de caja parte de una caja habilitada.',
          screen: 'CashRegisters',
          completed: Number(snapshot.registersCount || 0) > 0,
          actionLabel: 'Configurar caja',
        }),
        createStep({
          id: 'cash-assignments',
          title: 'Asignar caja a un usuario',
          description: 'Sin asignación, abrir sesión será más difícil.',
          screen: 'CashAssignments',
          completed: Number(snapshot.cashAssignmentsCount || 0) > 0,
          actionLabel: 'Asignar caja',
        }),
        createStep({
          id: 'cash-proof',
          title: 'Abrir o cerrar una sesión de prueba',
          description: 'Comprueba arqueos y sesiones de punta a punta.',
          screen: 'CashSessions',
          required: false,
          completed: Number(snapshot.cashSessionsCount || 0) > 0,
          actionLabel: 'Probar caja',
          kind: 'proof',
        }),
      ],
    }),
    finalizeSetupProcess({
      id: 'inventory',
      title: 'Controlar inventario',
      description: 'Valida catálogo, stock inicial y un primer movimiento real.',
      icon: 'cube-outline',
      screen: 'Inventory',
      steps: [
        createStep({
          id: 'inventory-products',
          title: 'Configurar productos inventariables',
          description: 'Activa control de inventario en los productos operativos.',
          screen: 'Products',
          completed: inventoryProductsConfigured,
          actionLabel: 'Revisar productos',
        }),
        createStep({
          id: 'inventory-variants',
          title: 'Asegurar variantes listas',
          description: 'Cada producto debe tener una variante operativa para mover stock.',
          screen: 'Products',
          completed: Number(snapshot.productVariantsCount || 0) > 0,
          actionLabel: 'Gestionar variantes',
        }),
        createStep({
          id: 'inventory-stock',
          title: 'Registrar stock inicial',
          description: 'Carga inventario desde compras o desde operaciones manuales.',
          screen: 'Inventory',
          completed: Number(snapshot.stockWithQtyCount || 0) > 0,
          actionLabel: 'Cargar stock',
        }),
        createStep({
          id: 'inventory-proof',
          title: 'Generar un movimiento de prueba',
          description: 'Confirma en kardex que el inventario ya refleja una operación real.',
          screen: 'Inventory',
          required: false,
          completed: Number(snapshot.inventoryMovesCount || 0) > 0,
          actionLabel: 'Probar inventario',
          kind: 'proof',
        }),
      ],
    }),
  ];

  if (accountingConfigured) {
    processes.push(
      finalizeSetupProcess({
        id: 'accounting',
        title: 'Contabilidad',
        description: 'El tenant ya activó parámetros contables, pero la operación completa sigue concentrada en web.',
        icon: 'calculator-outline',
        screen: 'TenantConfig',
        webOnly: true,
        steps: [
          createStep({
            id: 'accounting-enable',
            title: 'Activar parámetros contables base',
            description: 'Define modo contable y automatización inicial del tenant.',
            screen: 'TenantConfig',
            completed: accountingConfigured,
            actionLabel: 'Revisar empresa',
          }),
          createStep({
            id: 'accounting-automation',
            title: 'Definir automatización inicial',
            description: 'Activa al menos una automatización de ventas o compras.',
            screen: 'TenantConfig',
            required: false,
            completed: accountingAutomationConfigured,
            actionLabel: 'Ajustar contabilidad',
          }),
          createStep({
            id: 'accounting-proof',
            title: 'Validar adopción contable en web',
            description: 'Plan de cuentas, cola y asientos siguen siendo una tarea web-only.',
            screen: null,
            required: false,
            completed: Number(snapshot.accountingEntriesCount || 0) > 0,
            actionLabel: 'Continuar en web',
            kind: 'proof',
            webOnly: true,
          }),
        ],
      }),
    );
  }

  return processes;
}

export function buildSetupOverall(processes = []) {
  const totalProcesses = processes.length;
  const operationalProcesses = processes.filter((process) => process.state === 'OPERATIONAL').length;
  const requiredSteps = processes.reduce((acc, process) => acc + Number(process.requiredStepsCount || 0), 0);
  const completedRequired = processes.reduce((acc, process) => acc + Number(process.completedRequired || 0), 0);
  const progressPercentage = requiredSteps > 0
    ? Math.round((completedRequired / requiredSteps) * 100)
    : 0;

  const nextProcess = [...processes]
    .sort((left, right) => {
      const stateDiff = Number(STATE_ORDER[left.state] || 0) - Number(STATE_ORDER[right.state] || 0);
      if (stateDiff !== 0) return stateDiff;
      return Number(left.progressPercentage || 0) - Number(right.progressPercentage || 0);
    })
    .find((process) => process.state !== 'OPERATIONAL') || null;

  const nextAction = nextProcess?.nextStep
    ? {
        processId: nextProcess.id,
        processTitle: nextProcess.title,
        title: nextProcess.nextStep.title,
        screen: nextProcess.nextStep.screen || nextProcess.screen || null,
        label: nextProcess.nextStep.actionLabel || 'Continuar',
        description: nextProcess.nextStep.description,
        webOnly: nextProcess.nextStep.webOnly === true,
      }
    : null;

  return {
    totalProcesses,
    operationalProcesses,
    requiredSteps,
    completedRequired,
    progressPercentage,
    isFullyOperational: totalProcesses > 0 && operationalProcesses === totalProcesses,
    nextProcess,
    nextAction,
  };
}

export async function loadSetupReadiness({ tenantId, offlineMode = false } = {}) {
  if (!tenantId) {
    return {
      success: true,
      data: { processes: [], overall: buildSetupOverall([]), snapshot: {} },
      source: 'default',
    };
  }

  const cacheKey = SETUP_CACHE_KEY(tenantId);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      const processes = buildSetupProcesses(cached.value.snapshot || {});
      return {
        success: true,
        data: {
          snapshot: cached.value.snapshot || {},
          processes,
          overall: buildSetupOverall(processes),
        },
        source: 'cache',
      };
    }
    return {
      success: true,
      data: { processes: [], overall: buildSetupOverall([]), snapshot: {} },
      source: 'default',
    };
  }

  try {
    const tid = tenantId;
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
      accountingEntriesCount,
    ] = await Promise.all([
      safeMaybeSingle(
        'tenant_settings',
        'business_name, invoice_prefix, accounting_enabled, accounting_auto_post_sales, accounting_auto_post_purchases',
        [(query) => query.eq('tenant_id', tid)],
      ),
      safeCount('locations', [(query) => query.eq('tenant_id', tid), (query) => query.eq('is_active', true)]),
      safeCount('cash_registers', [(query) => query.eq('tenant_id', tid), (query) => query.eq('is_active', true)]),
      safeCount('payment_methods', [(query) => query.eq('tenant_id', tid), (query) => query.eq('is_active', true)]),
      safeCount('products', [(query) => query.eq('tenant_id', tid)]),
      safeCount('product_variants', [(query) => query.eq('tenant_id', tid), (query) => query.eq('is_active', true)]),
      safeCount('products', [
        (query) => query.eq('tenant_id', tid),
        (query) => query.eq('track_inventory', true),
        (query) => query.eq('is_active', true),
      ]),
      safeCount('cash_register_assignments', [
        (query) => query.eq('tenant_id', tid),
        (query) => query.eq('is_active', true),
      ]),
      safeCount('sales', [
        (query) => query.eq('tenant_id', tid),
        (query) => query.in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED']),
      ]),
      safeCount('third_parties', [
        (query) => query.eq('tenant_id', tid),
        (query) => query.in('type', ['supplier', 'both']),
        (query) => query.eq('is_active', true),
      ]),
      safeCount('purchases', [(query) => query.eq('tenant_id', tid)]),
      safeCount('stock_balances', [(query) => query.eq('tenant_id', tid), (query) => query.gt('on_hand', 0)]),
      safeCount('inventory_moves', [(query) => query.eq('tenant_id', tid)]),
      safeCount('cash_sessions', [(query) => query.eq('tenant_id', tid)]),
      safeCount('accounting_entries', [(query) => query.eq('tenant_id', tid)]),
    ]);

    const snapshot = {
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
      accountingEntriesCount,
    };

    await saveSimpleCache(cacheKey, { snapshot });
    const processes = buildSetupProcesses(snapshot);

    return {
      success: true,
      data: {
        snapshot,
        processes,
        overall: buildSetupOverall(processes),
      },
      source: 'server',
    };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      const processes = buildSetupProcesses(cached.value.snapshot || {});
      return {
        success: true,
        data: {
          snapshot: cached.value.snapshot || {},
          processes,
          overall: buildSetupOverall(processes),
        },
        source: 'cache',
        warning: error.message,
      };
    }

    return {
      success: false,
      error: error.message || 'No fue posible evaluar el asistente.',
      data: { processes: [], overall: buildSetupOverall([]), snapshot: {} },
    };
  }
}
