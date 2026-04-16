import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';
import {
  BILLING_FEATURE_CODES,
  evaluateBillingLimit,
  getBillingAccessForRequirement,
  getBillingRouteAccess as resolveBillingRouteAccess,
  getBillingScreenAccess as resolveBillingScreenAccess,
  hasBillingFeature,
  isOfflineModeAllowed,
} from '../../../shared/utils/billingAccess';

const STATUS_LABELS = {
  trialing: 'En prueba',
  active: 'Activo',
  pending_activation: 'Pendiente de activación',
  past_due: 'Vencido',
  grace_period: 'En gracia',
  suspended: 'Suspendido',
  canceled: 'Cancelado',
  expired: 'Expirado',
};

function billingCacheKey(tenantId) {
  return `tenant-billing-summary:${tenantId}`;
}

function billingLimitUsageCacheKey(tenantId) {
  return `tenant-billing-limit-usage:${tenantId}`;
}

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function computeDaysToExpiry(expirationDate) {
  if (!expirationDate) return null;
  const target = new Date(expirationDate);
  if (Number.isNaN(target.getTime())) return null;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffMs = startOfTarget.getTime() - startOfToday.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

export function getBillingStatusLabel(status) {
  return STATUS_LABELS[String(status || '').trim()] || 'Sin estado';
}

function readCachedBillingSummary(record) {
  if (!record || !Object.prototype.hasOwnProperty.call(record, 'value')) {
    return { hasCache: false, data: null, cachedAt: null };
  }

  const payload = record.value;
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'hasSummary')) {
    return {
      hasCache: true,
      data: normalizeTenantBillingSummary(payload.summary),
      cachedAt: record.cachedAt || null,
    };
  }

  return {
    hasCache: true,
    data: normalizeTenantBillingSummary(payload),
    cachedAt: record.cachedAt || null,
  };
}

export function normalizeTenantBillingSummary(data) {
  if (!data || typeof data !== 'object') return null;

  const expirationDate = data.current_period_end || data.trial_end_at || data.grace_end_at || null;
  const parsedDaysToExpiry = Number(data.days_to_expiry);

  return {
    ...data,
    status: String(data.status || '').trim(),
    status_label: getBillingStatusLabel(data.status),
    feature_flags: normalizeJsonObject(data.feature_flags),
    plan_limits: normalizeJsonObject(data.plan_limits),
    expiration_date: expirationDate,
    days_to_expiry: Number.isFinite(parsedDaysToExpiry) ? parsedDaysToExpiry : computeDaysToExpiry(expirationDate),
  };
}

export function getBillingRouteAccess(summary, path) {
  return resolveBillingRouteAccess(summary, path);
}

export function getBillingScreenAccess(summary, screenName, options = {}) {
  return resolveBillingScreenAccess(summary, screenName, options);
}

export async function getTenantBillingSummary(tenantId, { offlineMode = false } = {}) {
  if (!tenantId) {
    return {
      success: false,
      error: 'tenantId es requerido',
      data: null,
      source: 'default',
    };
  }

  const cacheKey = billingCacheKey(tenantId);

  if (offlineMode) {
    const cached = readCachedBillingSummary(await getSimpleCache(cacheKey));
    if (cached.hasCache) {
      return {
        success: true,
        data: cached.data,
        source: 'cache',
        cachedAt: cached.cachedAt,
      };
    }
    return {
      success: true,
      data: null,
      source: 'default',
      cachedAt: null,
    };
  }

  try {
    const { data, error } = await supabase.rpc('fn_get_my_tenant_billing_summary');
    if (error) throw error;

    const summary = normalizeTenantBillingSummary(Array.isArray(data) ? (data[0] || null) : data || null);
    await saveSimpleCache(cacheKey, { hasSummary: Boolean(summary), summary });

    return {
      success: true,
      data: summary,
      source: 'server',
      cachedAt: null,
    };
  } catch (error) {
    const cached = readCachedBillingSummary(await getSimpleCache(cacheKey));
    if (cached.hasCache) {
      return {
        success: true,
        data: cached.data,
        source: 'cache',
        cachedAt: cached.cachedAt,
      };
    }

    return {
      success: false,
      error: error.message || 'No fue posible cargar el resumen de suscripción.',
      data: null,
      source: 'default',
      cachedAt: null,
    };
  }
}

export async function getTenantPlanLimitUsage(tenantId, { offlineMode = false } = {}) {
  if (!tenantId) {
    return {
      success: false,
      error: 'tenantId es requerido',
      data: {},
      source: 'default',
    };
  }

  const cacheKey = billingLimitUsageCacheKey(tenantId);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return {
      success: true,
      data: cached?.value && typeof cached.value === 'object' ? cached.value : {},
      source: cached?.value ? 'cache' : 'default',
      cachedAt: cached?.cachedAt || null,
    };
  }

  try {
    const { data, error } = await supabase.rpc('fn_get_tenant_billing_limit_usage', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;

    const normalized = Object.entries(data || {}).reduce((acc, [key, value]) => {
      const numericValue = Number(value);
      acc[key] = Number.isFinite(numericValue) ? numericValue : 0;
      return acc;
    }, {});

    await saveSimpleCache(cacheKey, normalized);

    return {
      success: true,
      data: normalized,
      source: 'server',
      cachedAt: null,
    };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value && typeof cached.value === 'object') {
      return {
        success: true,
        data: cached.value,
        source: 'cache',
        cachedAt: cached.cachedAt || null,
      };
    }

    return {
      success: false,
      error: error.message || 'No fue posible cargar el uso de límites del plan.',
      data: {},
      source: 'default',
      cachedAt: null,
    };
  }
}

export function hasTenantBillingFeature(summary, featureCode, options = {}) {
  return hasBillingFeature(summary, featureCode, options);
}

export function getTenantBillingFeatureAccess(summary, featureCode, options = {}) {
  return getBillingAccessForRequirement(summary, {
    baseRestriction: options.baseRestriction || 'admin',
    featureCode,
  });
}

export async function ensureTenantBillingFeature(tenantId, featureCode, options = {}) {
  const result = await getTenantBillingSummary(tenantId, {
    offlineMode: options.offlineMode === true,
  });

  if (!result.success) {
    return { success: true, data: null };
  }

  const access = getTenantBillingFeatureAccess(result.data, featureCode, options);
  if (access.allowed) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: options.errorMessage || `Tu plan actual no incluye ${options.featureLabel || featureCode}.`,
    featureCode: access.featureCode || featureCode,
    code: access.restriction,
  };
}

export async function ensureTenantOfflineModeAccess(tenantId, options = {}) {
  const result = await getTenantBillingSummary(tenantId, {
    offlineMode: options.offlineMode === true,
  });

  if (!result.success) {
    return { success: true, data: null };
  }

  if (isOfflineModeAllowed(result.data)) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: options.errorMessage || 'Tu plan actual no incluye operación offline.',
    featureCode: BILLING_FEATURE_CODES.OFFLINE_MODE,
  };
}

export async function ensureTenantPlanLimit(tenantId, limitCode, options = {}) {
  const [summaryResult, usageResult] = await Promise.all([
    getTenantBillingSummary(tenantId, { offlineMode: options.offlineMode === true }),
    getTenantPlanLimitUsage(tenantId, { offlineMode: options.offlineMode === true }),
  ]);

  if (!summaryResult.success || !usageResult.success) {
    return { success: true, data: null };
  }

  const evaluation = evaluateBillingLimit(
    summaryResult.data,
    usageResult.data,
    limitCode,
    options.requestedUnits || 1,
  );

  if (evaluation.allowed) {
    return { success: true, data: evaluation };
  }

  const planName = summaryResult.data?.plan_name || summaryResult.data?.plan_code || 'actual';
  return {
    success: false,
    error: options.errorMessage || `Tu plan ${planName} ya alcanzó el límite disponible para esta acción.`,
    data: evaluation,
  };
}
