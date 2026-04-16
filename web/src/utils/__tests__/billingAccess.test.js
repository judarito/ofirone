import { describe, expect, it } from 'vitest'
import {
  BILLING_FEATURE_CODES,
  BILLING_LIMIT_CODES,
  evaluateBillingLimit,
  filterMenuTreeByBilling,
  getBillingAccessForRequirement,
  getBillingPlanLimit,
  getBillingRouteAccess,
  getBillingScreenAccess,
  hasBillingFeature,
  isOfflineModeAllowed,
} from '../../../../shared/utils/billingAccess'

function buildSummary(overrides = {}) {
  return {
    can_operate_sales: true,
    can_operate_admin: true,
    feature_flags: {
      [BILLING_FEATURE_CODES.POS_CORE]: true,
      [BILLING_FEATURE_CODES.AI_ASSISTANT]: true,
      [BILLING_FEATURE_CODES.OCR_IMPORT]: true,
      [BILLING_FEATURE_CODES.ADVANCED_REPORTS]: true,
      [BILLING_FEATURE_CODES.OFFLINE_MODE]: true,
    },
    plan_limits: {
      [BILLING_LIMIT_CODES.PRODUCTS_MAX]: { value: 100, unit: 'count' },
    },
    ...overrides,
  }
}

describe('billingAccess', () => {
  it('permite rutas operativas seguras como setup aunque el admin esté bloqueado', () => {
    const access = getBillingRouteAccess(buildSummary({ can_operate_admin: false }), '/setup')
    expect(access.allowed).toBe(true)
  })

  it('bloquea reportes cuando el plan no incluye ADVANCED_REPORTS', () => {
    const access = getBillingRouteAccess(buildSummary({
      feature_flags: {
        [BILLING_FEATURE_CODES.ADVANCED_REPORTS]: false,
      },
    }), '/reports/ventas')

    expect(access.allowed).toBe(false)
    expect(access.restriction).toBe('feature')
    expect(access.featureCode).toBe(BILLING_FEATURE_CODES.ADVANCED_REPORTS)
  })

  it('bloquea AIInsights cuando el plan no incluye AI_ASSISTANT', () => {
    const access = getBillingScreenAccess(buildSummary({
      feature_flags: {
        [BILLING_FEATURE_CODES.AI_ASSISTANT]: false,
      },
    }), 'AIInsights')

    expect(access.allowed).toBe(false)
    expect(access.featureCode).toBe(BILLING_FEATURE_CODES.AI_ASSISTANT)
  })

  it('bloquea POS cuando billing no permite ventas', () => {
    const access = getBillingRouteAccess(buildSummary({ can_operate_sales: false }), '/pos')
    expect(access.allowed).toBe(false)
    expect(access.restriction).toBe('sales')
  })

  it('bloquea módulos administrativos genéricos cuando el admin está suspendido', () => {
    const access = getBillingRouteAccess(buildSummary({ can_operate_admin: false }), '/products')
    expect(access.allowed).toBe(false)
    expect(access.restriction).toBe('admin')
  })

  it('usa routeHint en mobile para resolver pantallas sin mapeo fijo', () => {
    const access = getBillingScreenAccess(buildSummary({
      feature_flags: {
        [BILLING_FEATURE_CODES.ADVANCED_REPORTS]: false,
      },
    }), 'CustomReportsScreen', { routeHint: '/reports/inventario' })

    expect(access.allowed).toBe(false)
    expect(access.restriction).toBe('feature')
    expect(access.featureCode).toBe(BILLING_FEATURE_CODES.ADVANCED_REPORTS)
  })

  it('permite por defecto un feature faltante, pero respeta defaultValue false cuando se pide explícitamente', () => {
    const summary = buildSummary({ feature_flags: {} })

    expect(hasBillingFeature(summary, BILLING_FEATURE_CODES.AI_ASSISTANT)).toBe(true)
    expect(hasBillingFeature(summary, BILLING_FEATURE_CODES.AI_ASSISTANT, { defaultValue: false })).toBe(false)
  })

  it('resuelve acceso por requirement combinando restricción base y feature', () => {
    const access = getBillingAccessForRequirement(buildSummary({
      can_operate_sales: true,
      feature_flags: {
        [BILLING_FEATURE_CODES.POS_CORE]: false,
      },
    }), {
      baseRestriction: 'sales',
      featureCode: BILLING_FEATURE_CODES.POS_CORE,
    })

    expect(access.allowed).toBe(false)
    expect(access.restriction).toBe('feature')
    expect(access.baseRestriction).toBe('sales')
  })

  it('evalúa correctamente los límites cuantitativos del plan', () => {
    const result = evaluateBillingLimit(
      buildSummary(),
      { [BILLING_LIMIT_CODES.PRODUCTS_MAX]: 100 },
      BILLING_LIMIT_CODES.PRODUCTS_MAX,
      1,
    )

    expect(result.allowed).toBe(false)
    expect(result.current).toBe(100)
    expect(result.limit.value).toBe(100)
  })

  it('permite acciones cuando el plan no define límite para ese recurso', () => {
    const result = evaluateBillingLimit(
      buildSummary({ plan_limits: {} }),
      { [BILLING_LIMIT_CODES.PRODUCTS_MAX]: 999 },
      BILLING_LIMIT_CODES.PRODUCTS_MAX,
      10,
    )

    expect(result.allowed).toBe(true)
    expect(result.limit).toBeNull()
    expect(result.remaining).toBeNull()
  })

  it('normaliza el límite configurado del plan', () => {
    const limit = getBillingPlanLimit(buildSummary(), BILLING_LIMIT_CODES.PRODUCTS_MAX)
    expect(limit).toEqual({
      code: BILLING_LIMIT_CODES.PRODUCTS_MAX,
      value: 100,
      unit: 'count',
    })
  })

  it('filtra el árbol de menú dejando solo módulos permitidos por billing', () => {
    const menuTree = [
      {
        label: 'Operación',
        children: [
          { label: 'POS', route: '/pos' },
          { label: 'IA', route: '/ai-insights' },
        ],
      },
      { label: 'Reportes', route: '/reports' },
    ]

    const filtered = filterMenuTreeByBilling(buildSummary({
      feature_flags: {
        [BILLING_FEATURE_CODES.POS_CORE]: true,
        [BILLING_FEATURE_CODES.AI_ASSISTANT]: false,
        [BILLING_FEATURE_CODES.ADVANCED_REPORTS]: false,
      },
    }), menuTree)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].children).toHaveLength(1)
    expect(filtered[0].children[0].route).toBe('/pos')
  })

  it('conserva grupos padre si al menos un hijo sigue permitido, aunque la ruta del padre esté bloqueada', () => {
    const menuTree = [
      {
        label: 'Analítica',
        route: '/reports',
        children: [
          { label: 'Ayuda', route: '/help' },
        ],
      },
    ]

    const filtered = filterMenuTreeByBilling(buildSummary({
      can_operate_admin: false,
    }), menuTree)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].children).toHaveLength(1)
    expect(filtered[0].children[0].route).toBe('/help')
  })

  it('elimina grupos vacíos y conserva acciones sin ruta porque no dependen del route guard', () => {
    const menuTree = [
      {
        label: 'Bloqueado',
        children: [{ label: 'IA', route: '/ai-insights' }],
      },
      {
        label: 'Acción',
        action: 'open-support-chat',
      },
    ]

    const filtered = filterMenuTreeByBilling(buildSummary({
      feature_flags: {
        [BILLING_FEATURE_CODES.AI_ASSISTANT]: false,
      },
    }), menuTree)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].action).toBe('open-support-chat')
  })

  it('solo permite modo offline cuando el feature OFFLINE_MODE está activo', () => {
    expect(isOfflineModeAllowed(buildSummary({
      feature_flags: {
        [BILLING_FEATURE_CODES.OFFLINE_MODE]: true,
      },
    }))).toBe(true)

    expect(isOfflineModeAllowed(buildSummary({
      feature_flags: {
        [BILLING_FEATURE_CODES.OFFLINE_MODE]: false,
      },
    }))).toBe(false)
  })
})
