export const BILLING_FEATURE_CODES = Object.freeze({
  POS_CORE: 'POS_CORE',
  OFFLINE_MODE: 'OFFLINE_MODE',
  AI_ASSISTANT: 'AI_ASSISTANT',
  OCR_IMPORT: 'OCR_IMPORT',
  ADVANCED_REPORTS: 'ADVANCED_REPORTS',
})

export const BILLING_LIMIT_CODES = Object.freeze({
  USERS_ACTIVE: 'users_active',
  LOCATIONS_MAX: 'locations_max',
  CASH_REGISTERS_MAX: 'cash_registers_max',
  PRODUCTS_MAX: 'products_max',
  INVOICES_PER_MONTH: 'invoices_per_month',
})

const ALWAYS_ALLOWED_PATHS = ['/about', '/help', '/tenant-config', '/setup']
const SALES_PATHS = [
  '/pos',
  '/sales',
  '/cash-sessions',
  '/cash-registers',
  '/cash-assignments',
  '/payment-methods',
  '/layaway',
  '/cartera',
]
const REPORTS_PATHS = ['/reports']
const AI_PATHS = [
  '/ai-insights',
  '/accounting/assistant',
  '/contabilidad/asistente-ia',
  '/accounting/control-ia',
  '/contabilidad/control-ia',
]

const SCREEN_ROUTE_HINTS = Object.freeze({
  Home: '/',
  About: '/about',
  HelpCenter: '/help',
  TenantConfig: '/tenant-config',
  Setup: '/setup',
  PointOfSale: '/pos',
  Sales: '/sales',
  CashSessions: '/cash-sessions',
  CashRegisters: '/cash-registers',
  CashAssignments: '/cash-assignments',
  PaymentMethods: '/payment-methods',
  Layaway: '/layaway',
  Cartera: '/cartera',
  Reports: '/reports',
  AIInsights: '/ai-insights',
})

function normalizePath(path) {
  const value = String(path || '').trim().toLowerCase()
  if (!value) return ''
  if (value === '/') return value
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function matchesPath(path, candidates = []) {
  const normalizedPath = normalizePath(path)
  if (!normalizedPath) return false
  if (normalizedPath === '/') return true

  return candidates.some((candidate) => {
    const normalizedCandidate = normalizePath(candidate)
    if (!normalizedCandidate) return false
    return normalizedPath === normalizedCandidate || normalizedPath.startsWith(`${normalizedCandidate}/`)
  })
}

function normalizeFeatureCode(featureCode) {
  return String(featureCode || '').trim().toUpperCase()
}

function normalizeLimitCode(limitCode) {
  return String(limitCode || '').trim().toLowerCase()
}

function toFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function hasBillingFeature(summary, featureCode, options = {}) {
  const normalizedFeature = normalizeFeatureCode(featureCode)
  const defaultValue = options.defaultValue !== false
  if (!normalizedFeature) return defaultValue

  const featureFlags = summary?.feature_flags
  if (!featureFlags || typeof featureFlags !== 'object') return defaultValue
  if (!Object.prototype.hasOwnProperty.call(featureFlags, normalizedFeature)) return defaultValue

  return featureFlags[normalizedFeature] === true
}

export function getBillingPlanLimit(summary, limitCode) {
  const normalizedLimit = normalizeLimitCode(limitCode)
  if (!normalizedLimit) return null

  const planLimits = summary?.plan_limits
  if (!planLimits || typeof planLimits !== 'object') return null

  const rawLimit = planLimits[normalizedLimit]
  if (!rawLimit || typeof rawLimit !== 'object') return null

  const value = toFiniteNumber(rawLimit.value)
  return {
    code: normalizedLimit,
    value,
    unit: String(rawLimit.unit || '').trim().toLowerCase() || 'count',
  }
}

export function evaluateBillingLimit(summary, usage = {}, limitCode, requestedUnits = 1) {
  const normalizedLimit = normalizeLimitCode(limitCode)
  const limit = getBillingPlanLimit(summary, normalizedLimit)
  if (!limit || limit.value == null) {
    return {
      allowed: true,
      limit: null,
      current: 0,
      requestedUnits: Math.max(0, Number(requestedUnits || 0)),
      next: 0,
      remaining: null,
    }
  }

  const current = Math.max(0, Number(usage?.[normalizedLimit] || 0))
  const safeRequestedUnits = Math.max(0, Number(requestedUnits || 0))
  const next = current + safeRequestedUnits
  const remaining = limit.value - current

  return {
    allowed: next <= limit.value,
    limit,
    current,
    requestedUnits: safeRequestedUnits,
    next,
    remaining,
  }
}

export function getBillingAccessForRequirement(summary, requirement = {}) {
  if (!summary || typeof summary !== 'object') {
    return {
      allowed: true,
      restriction: null,
      featureCode: null,
      baseRestriction: requirement.baseRestriction || null,
    }
  }

  const baseRestriction = requirement.baseRestriction === 'sales' ? 'sales' : 'admin'
  const featureCode = normalizeFeatureCode(requirement.featureCode)

  const canOperate = baseRestriction === 'sales'
    ? summary.can_operate_sales !== false
    : summary.can_operate_admin !== false

  if (!canOperate) {
    return {
      allowed: false,
      restriction: baseRestriction,
      featureCode: null,
      baseRestriction,
    }
  }

  if (featureCode && !hasBillingFeature(summary, featureCode)) {
    return {
      allowed: false,
      restriction: 'feature',
      featureCode,
      baseRestriction,
    }
  }

  return {
    allowed: true,
    restriction: null,
    featureCode,
    baseRestriction,
  }
}

function getRouteRequirement(path) {
  const normalizedPath = normalizePath(path)
  if (!normalizedPath) return null

  if (normalizedPath === '/' || matchesPath(normalizedPath, ALWAYS_ALLOWED_PATHS)) {
    return null
  }

  if (matchesPath(normalizedPath, AI_PATHS)) {
    return {
      baseRestriction: 'admin',
      featureCode: BILLING_FEATURE_CODES.AI_ASSISTANT,
    }
  }

  if (matchesPath(normalizedPath, REPORTS_PATHS)) {
    return {
      baseRestriction: 'admin',
      featureCode: BILLING_FEATURE_CODES.ADVANCED_REPORTS,
    }
  }

  if (matchesPath(normalizedPath, SALES_PATHS)) {
    return {
      baseRestriction: 'sales',
      featureCode: BILLING_FEATURE_CODES.POS_CORE,
    }
  }

  return {
    baseRestriction: 'admin',
    featureCode: null,
  }
}

export function getBillingRouteAccess(summary, path) {
  const requirement = getRouteRequirement(path)
  if (!requirement) {
    return {
      allowed: true,
      restriction: null,
      featureCode: null,
      baseRestriction: null,
    }
  }

  return getBillingAccessForRequirement(summary, requirement)
}

export function getBillingScreenAccess(summary, screenName, options = {}) {
  const routeHint = normalizePath(options.routeHint || SCREEN_ROUTE_HINTS[String(screenName || '').trim()] || '')
  if (!routeHint) {
    return {
      allowed: true,
      restriction: null,
      featureCode: null,
      baseRestriction: null,
    }
  }

  return getBillingRouteAccess(summary, routeHint)
}

export function filterMenuTreeByBilling(summary, items = [], options = {}) {
  const childrenKey = options.childrenKey || 'children'
  const routeKey = options.routeKey || 'route'
  const actionKey = options.actionKey || 'action'

  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const current = item && typeof item === 'object' ? { ...item } : null
    if (!current) return acc

    const children = filterMenuTreeByBilling(summary, current[childrenKey] || [], options)
    const route = current[routeKey]
    const action = current[actionKey]
    const hasRoute = Boolean(String(route || '').trim())
    const hasAction = Boolean(String(action || '').trim())
    const access = hasRoute ? getBillingRouteAccess(summary, route) : { allowed: true }

    if (hasRoute && !access.allowed && children.length === 0) {
      return acc
    }

    if (!hasRoute && !hasAction && children.length === 0) {
      return acc
    }

    current[childrenKey] = children
    acc.push(current)
    return acc
  }, [])
}

export function isOfflineModeAllowed(summary) {
  return hasBillingFeature(summary, BILLING_FEATURE_CODES.OFFLINE_MODE)
}
