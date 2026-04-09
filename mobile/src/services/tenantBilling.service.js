import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

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
