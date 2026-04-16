import { supabase } from '../lib/supabase';
import { getPageCache, getSimpleCache, savePageCache, saveSimpleCache } from './offlineCache.service';

const BATCHES_NS = 'batch-management-list';
const ALERTS_CACHE_KEY = (tenantId, locationId, alertLevel) =>
  `batch-management-alerts:${tenantId}:${locationId || 'all'}:${alertLevel || 'all'}`;
const DASHBOARD_CACHE_KEY = (tenantId) => `batch-management-dashboard:${tenantId}`;
const TOP_RISK_CACHE_KEY = (tenantId, locationId, limit) => `batch-management-top-risk:${tenantId}:${locationId || 'all'}:${limit || 10}`;
const TRACEABILITY_CACHE_KEY = (tenantId, batchId) => `batch-management-traceability:${tenantId}:${batchId || 'all'}`;

export function createBatchDraft(defaultLocationId = '', seed = {}) {
  return {
    batch_id: seed.batch_id || '',
    location_id: seed.location_id || defaultLocationId || '',
    variant_id: seed.variant_id || '',
    variant_label: seed.variant_label || '',
    batch_number: seed.batch_number || '',
    expiration_date: seed.expiration_date || '',
    on_hand: seed.on_hand !== undefined && seed.on_hand !== null ? String(seed.on_hand) : '0',
    unit_cost: seed.unit_cost !== undefined && seed.unit_cost !== null ? String(seed.unit_cost) : '0',
    physical_location: seed.physical_location || '',
    notes: seed.notes || '',
  };
}

export function getBatchAlertLevel(expirationDate, { warnDays = 30, criticalDays = 7, baseDate = new Date() } = {}) {
  if (!expirationDate) return 'NO_EXP';

  const current = new Date(baseDate);
  current.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expirationDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 'UNKNOWN';

  const diffDays = Math.floor((expiry.getTime() - current.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 'EXPIRED';
  if (diffDays <= criticalDays) return 'CRITICAL';
  if (diffDays <= warnDays) return 'WARNING';
  return 'OK';
}

export function formatDaysToExpiry(days) {
  if (!Number.isFinite(days)) return 'Sin fecha';
  if (days < 0) return 'Vencido';
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `${days} días`;
}

export function buildBatchAlertMeta(expirationDate, baseDate = new Date()) {
  if (!expirationDate) {
    return {
      level: 'NO_EXP',
      daysToExpiry: null,
      label: 'Sin vencimiento',
      color: '#64748b',
    };
  }

  const current = new Date(baseDate);
  current.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expirationDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) {
    return {
      level: 'UNKNOWN',
      daysToExpiry: null,
      label: 'Fecha inválida',
      color: '#94a3b8',
    };
  }

  const daysToExpiry = Math.floor((expiry.getTime() - current.getTime()) / (24 * 60 * 60 * 1000));
  const level = getBatchAlertLevel(expirationDate, { baseDate });
  const palette = {
    EXPIRED: '#ef4444',
    CRITICAL: '#f97316',
    WARNING: '#f59e0b',
    OK: '#16a34a',
    NO_EXP: '#64748b',
    UNKNOWN: '#94a3b8',
  };
  const baseLabel = {
    EXPIRED: 'Vencido',
    CRITICAL: 'Crítico',
    WARNING: 'Advertencia',
    OK: 'OK',
    NO_EXP: 'Sin vencimiento',
    UNKNOWN: 'Fecha inválida',
  };

  if (level === 'NO_EXP' || level === 'UNKNOWN') {
    return {
      level,
      daysToExpiry,
      label: baseLabel[level],
      color: palette[level],
    };
  }

  return {
    level,
    daysToExpiry,
    label: `${baseLabel[level]} · ${formatDaysToExpiry(daysToExpiry)}`,
    color: palette[level],
  };
}

function parseDecimalInput(value, fallback = 0) {
  const normalized = String(value ?? '').replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBatchFormPayload(form = {}) {
  return {
    location_id: form.location_id || null,
    variant_id: form.variant_id || null,
    batch_number: String(form.batch_number || '').trim() || null,
    expiration_date: String(form.expiration_date || '').trim() || null,
    on_hand: parseDecimalInput(form.on_hand, 0),
    unit_cost: parseDecimalInput(form.unit_cost, 0),
    physical_location: String(form.physical_location || '').trim() || null,
    notes: String(form.notes || '').trim() || null,
  };
}

function buildBatchesPageFilters({ locationId = '', alertLevel = '', search = '' } = {}) {
  return {
    location_id: locationId || '',
    alert_level: alertLevel || '',
    search: String(search || '').trim(),
  };
}

export async function listManagedBatches({
  tenantId,
  locationId = null,
  alertLevel = null,
  search = '',
  limit = 20,
  offset = 0,
  offlineMode = false,
} = {}) {
  const page = Math.floor(offset / limit) + 1;
  const filters = buildBatchesPageFilters({ locationId, alertLevel, search });

  if (offlineMode) {
    const cached = await getPageCache({
      namespace: BATCHES_NS,
      tenantId,
      page,
      pageSize: limit,
      filters,
    });
    return {
      success: true,
      data: cached?.items || [],
      total: Number(cached?.total || 0),
      source: 'cache',
    };
  }

  try {
    let query = supabase
      .from('inventory_batches')
      .select(
        `
          batch_id,
          tenant_id,
          location_id,
          variant_id,
          batch_number,
          expiration_date,
          on_hand,
          reserved,
          unit_cost,
          is_active,
          received_at,
          physical_location,
          notes,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            cost,
            product:product_id(name,requires_expiration)
          )
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('expiration_date', { ascending: true, nullsFirst: false })
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    if (alertLevel) {
      const today = new Date().toISOString().slice(0, 10);
      if (alertLevel === 'EXPIRED') {
        query = query.not('expiration_date', 'is', null).lt('expiration_date', today);
      } else if (alertLevel === 'CRITICAL') {
        const critical = new Date();
        critical.setDate(critical.getDate() + 7);
        query = query
          .not('expiration_date', 'is', null)
          .gte('expiration_date', today)
          .lte('expiration_date', critical.toISOString().slice(0, 10));
      } else if (alertLevel === 'WARNING') {
        const warningStart = new Date();
        warningStart.setDate(warningStart.getDate() + 8);
        const warningEnd = new Date();
        warningEnd.setDate(warningEnd.getDate() + 30);
        query = query
          .not('expiration_date', 'is', null)
          .gte('expiration_date', warningStart.toISOString().slice(0, 10))
          .lte('expiration_date', warningEnd.toISOString().slice(0, 10));
      } else if (alertLevel === 'OK') {
        const warningEnd = new Date();
        warningEnd.setDate(warningEnd.getDate() + 30);
        query = query
          .not('expiration_date', 'is', null)
          .gt('expiration_date', warningEnd.toISOString().slice(0, 10));
      } else if (alertLevel === 'NO_EXP') {
        query = query.is('expiration_date', null);
      }
    }

    const trimmedSearch = String(search || '').trim();
    if (trimmedSearch) {
      query = query.ilike('batch_number', `%${trimmedSearch}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    await savePageCache({
      namespace: BATCHES_NS,
      tenantId,
      page,
      pageSize: limit,
      filters,
      items: data || [],
      total: Number(count || 0),
    });

    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    const cached = await getPageCache({
      namespace: BATCHES_NS,
      tenantId,
      page,
      pageSize: limit,
      filters,
    });
    if (cached?.items?.length) {
      return {
        success: true,
        data: cached.items,
        total: Number(cached.total || 0),
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createBatch({ tenantId, createdBy = null, form }) {
  try {
    const payload = normalizeBatchFormPayload(form);
    const { data, error } = await supabase
      .from('inventory_batches')
      .insert({
        tenant_id: tenantId,
        ...payload,
        reserved: 0,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateBatch(batchId, form) {
  try {
    const payload = normalizeBatchFormPayload(form);
    const { data, error } = await supabase
      .from('inventory_batches')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('batch_id', batchId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function generateBatchNumber({
  tenantId,
  variantId,
  locationId = null,
  prefix = 'BATCH',
}) {
  try {
    const { data, error } = await supabase.rpc('fn_generate_batch_number', {
      p_tenant: tenantId,
      p_variant: variantId,
      p_location: locationId,
      p_prefix: prefix,
    });
    if (error) throw error;
    return { success: true, batchNumber: data };
  } catch (error) {
    const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
    return {
      success: true,
      batchNumber: `${prefix}-${String(variantId || 'SKU').slice(0, 6)}-${suffix}`,
      warning: error.message,
    };
  }
}

export async function getExpiringProducts({
  tenantId,
  locationId = null,
  alertLevel = null,
  offlineMode = false,
} = {}) {
  const cacheKey = ALERTS_CACHE_KEY(tenantId, locationId, alertLevel);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return { success: true, data: cached?.value || [], source: 'cache' };
  }

  try {
    let query = supabase
      .from('vw_expiring_products')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('days_to_expiry', { ascending: true });

    if (locationId) query = query.eq('location_id', locationId);
    if (alertLevel) query = query.eq('alert_level', alertLevel);

    const { data, error } = await query;
    if (error) throw error;
    await saveSimpleCache(cacheKey, data || []);
    return { success: true, data: data || [] };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value?.length) {
      return { success: true, data: cached.value, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function getExpirationDashboard({ tenantId, offlineMode = false } = {}) {
  const cacheKey = DASHBOARD_CACHE_KEY(tenantId);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return { success: true, data: cached?.value || [], source: 'cache' };
  }

  try {
    const { data, error } = await supabase
      .from('vw_expiration_dashboard')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('total_value_at_risk', { ascending: false });

    if (error) throw error;
    await saveSimpleCache(cacheKey, data || []);
    return { success: true, data: data || [] };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value?.length) {
      return { success: true, data: cached.value, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function getTopAtRiskProducts({
  tenantId,
  locationId = null,
  limit = 10,
  offlineMode = false,
} = {}) {
  const cacheKey = TOP_RISK_CACHE_KEY(tenantId, locationId, limit);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return { success: true, data: cached?.value || [], source: 'cache' };
  }

  try {
    const { data, error } = await supabase.rpc('fn_top_at_risk_products', {
      p_tenant: tenantId,
      p_location: locationId,
      p_limit: limit,
    });

    if (error) throw error;
    await saveSimpleCache(cacheKey, data || []);
    return { success: true, data: data || [] };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value?.length) {
      return { success: true, data: cached.value, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function getBatchTraceability({
  tenantId,
  batchId,
  offlineMode = false,
} = {}) {
  const cacheKey = TRACEABILITY_CACHE_KEY(tenantId, batchId);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return { success: true, data: cached?.value || [], source: 'cache' };
  }

  try {
    const { data, error } = await supabase
      .from('vw_batch_traceability')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('batch_id', batchId)
      .order('sold_at', { ascending: false });

    if (error) throw error;
    await saveSimpleCache(cacheKey, data || []);
    return { success: true, data: data || [] };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value?.length) {
      return { success: true, data: cached.value, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [] };
  }
}
