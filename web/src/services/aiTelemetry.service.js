const AI_TELEMETRY_KEY = 'ofirone_ai_telemetry_events';
const AI_TELEMETRY_REMOTE_TABLE = 'ai_telemetry_events';
const MAX_EVENTS = 250;
const CLOUD_SOURCES = new Set(['cloud_llm']);
const REMOTE_ENABLED = import.meta.env.VITE_AI_TELEMETRY_REMOTE_ENABLED === 'true';

let memoryEvents = [];

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (_error) {}
  return null;
}

function readStoredEvents() {
  const storage = getStorage();
  if (!storage) return memoryEvents;

  try {
    const raw = storage.getItem(AI_TELEMETRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeStoredEvents(events) {
  const next = events.slice(-MAX_EVENTS);
  const storage = getStorage();
  if (!storage) {
    memoryEvents = next;
    return;
  }

  try {
    storage.setItem(AI_TELEMETRY_KEY, JSON.stringify(next));
  } catch (_error) {
    memoryEvents = next;
  }
}

export function estimateAITokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return Math.max(0, Math.ceil(text.length / 4));
}

export function normalizeAITelemetryEvent(event = {}) {
  return {
    id: event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp || new Date().toISOString(),
    tenant_id: event.tenant_id || null,
    user_id: event.user_id || null,
    device_id: event.device_id || null,
    feature: event.feature || 'unknown',
    input_type: event.input_type || 'text',
    engine: event.engine || null,
    model: event.model || null,
    resolution_source: event.resolution_source || 'unknown',
    latency_ms: Math.max(0, Number(event.latency_ms || 0)),
    confidence: event.confidence == null ? null : Number(event.confidence),
    tokens_input: Math.max(0, Number(event.tokens_input || 0)),
    tokens_output: Math.max(0, Number(event.tokens_output || 0)),
    estimated_cost: Math.max(0, Number(event.estimated_cost || 0)),
    cache_hit: event.cache_hit === true,
    fallback: event.fallback || null,
    success: event.success !== false,
    error: event.error ? String(event.error).slice(0, 500) : null,
    corrected_at: event.corrected_at || null,
    corrected_by_user_id: event.corrected_by_user_id || null,
    correction_source: event.correction_source || null,
    corrected_payload: event.corrected_payload || null,
  };
}

export function recordAITelemetryEvent(event = {}) {
  const normalized = normalizeAITelemetryEvent(event);
  const current = readStoredEvents();
  writeStoredEvents([...current, normalized]);
  if (REMOTE_ENABLED && normalized.tenant_id) {
    void persistAITelemetryEvent(normalized).catch(() => null);
  }
  return normalized;
}

export function getAITelemetryEvents() {
  return readStoredEvents();
}

export function clearAITelemetryEvents() {
  writeStoredEvents([]);
}

export function isRemoteAITelemetryEnabled() {
  return REMOTE_ENABLED;
}

function toRemoteRow(event) {
  return {
    event_id: event.id,
    tenant_id: event.tenant_id,
    user_id: event.user_id,
    device_id: event.device_id,
    feature: event.feature,
    input_type: event.input_type,
    engine: event.engine,
    model: event.model,
    resolution_source: event.resolution_source,
    latency_ms: Math.round(Number(event.latency_ms || 0)),
    confidence: event.confidence,
    tokens_input: Math.round(Number(event.tokens_input || 0)),
    tokens_output: Math.round(Number(event.tokens_output || 0)),
    estimated_cost: Number(event.estimated_cost || 0),
    cache_hit: event.cache_hit === true,
    fallback: event.fallback,
    success: event.success !== false,
    error: event.error,
    occurred_at: event.timestamp,
    corrected_at: event.corrected_at || null,
    corrected_by_user_id: event.corrected_by_user_id || null,
    correction_source: event.correction_source || null,
    corrected_payload: event.corrected_payload || null,
  };
}

function fromRemoteRow(row = {}) {
  return normalizeAITelemetryEvent({
    id: row.event_id || row.ai_telemetry_event_id,
    timestamp: row.occurred_at || row.created_at,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    device_id: row.device_id,
    feature: row.feature,
    input_type: row.input_type,
    engine: row.engine,
    model: row.model,
    resolution_source: row.resolution_source,
    latency_ms: row.latency_ms,
    confidence: row.confidence,
    tokens_input: row.tokens_input,
    tokens_output: row.tokens_output,
    estimated_cost: row.estimated_cost,
    cache_hit: row.cache_hit,
    fallback: row.fallback,
    success: row.success,
    error: row.error,
    corrected_at: row.corrected_at,
    corrected_by_user_id: row.corrected_by_user_id,
    correction_source: row.correction_source,
    corrected_payload: row.corrected_payload,
  });
}

export async function persistAITelemetryEvent(event = {}) {
  const normalized = normalizeAITelemetryEvent(event);
  if (!normalized.tenant_id) {
    return { success: false, error: 'tenant_id es requerido para persistir telemetria IA' };
  }

  try {
    const { default: supabaseService } = await import('./supabase.service');
    const { error } = await supabaseService.client
      .from(AI_TELEMETRY_REMOTE_TABLE)
      .upsert(toRemoteRow(normalized), { onConflict: 'tenant_id,event_id' });

    if (error) return { success: false, error: error.message || String(error) };
    return { success: true, data: normalized };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

export async function getRemoteAITelemetryEvents({ tenantId, limit = MAX_EVENTS } = {}) {
  if (!REMOTE_ENABLED) return { success: true, data: [], skipped: true };
  if (!tenantId) return { success: true, data: [] };

  try {
    const { default: supabaseService } = await import('./supabase.service');
    const { data, error } = await supabaseService.client
      .from(AI_TELEMETRY_REMOTE_TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(Math.max(1, Math.min(MAX_EVENTS, Number(limit || MAX_EVENTS))));

    if (error) return { success: false, error: error.message || String(error), data: [] };
    return { success: true, data: (data || []).map(fromRemoteRow) };
  } catch (error) {
    return { success: false, error: error.message || String(error), data: [] };
  }
}

function percentile(values, target) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  if (!numbers.length) return 0;
  const index = Math.ceil((target / 100) * numbers.length) - 1;
  return numbers[Math.max(0, Math.min(numbers.length - 1, index))];
}

function incrementMap(map, key, seed = {}) {
  const normalizedKey = key || 'unknown';
  const current = map.get(normalizedKey) || { key: normalizedKey, count: 0, ...seed };
  current.count += 1;
  map.set(normalizedKey, current);
  return current;
}

export function buildAITelemetrySummary(events = []) {
  const normalizedEvents = Array.isArray(events) ? events.map(normalizeAITelemetryEvent) : [];
  const total = normalizedEvents.length;
  const cloudEvents = normalizedEvents.filter((event) =>
    CLOUD_SOURCES.has(event.resolution_source)
  );
  const ocrImageEvents = normalizedEvents.filter(
    (event) => event.feature === 'invoice_ocr_image' && event.input_type === 'image'
  );
  const ocrImageCloudEvents = ocrImageEvents.filter((event) =>
    CLOUD_SOURCES.has(event.resolution_source)
  );
  const errors = normalizedEvents.filter((event) => !event.success || event.error);
  const totalCost = normalizedEvents.reduce(
    (sum, event) => sum + Number(event.estimated_cost || 0),
    0
  );
  const cloudAvoidanceRate = total ? ((total - cloudEvents.length) / total) * 100 : 0;
  const latencyP95 = percentile(
    normalizedEvents.map((event) => event.latency_ms),
    95
  );

  const byFeature = new Map();
  const bySource = new Map();
  const byTenant = new Map();
  const errorsByModel = new Map();
  const fallbacksToCloud = new Map();

  normalizedEvents.forEach((event) => {
    const feature = incrementMap(byFeature, event.feature, { cost: 0, errors: 0, cloud: 0 });
    feature.cost += Number(event.estimated_cost || 0);
    feature.errors += event.success && !event.error ? 0 : 1;
    feature.cloud += CLOUD_SOURCES.has(event.resolution_source) ? 1 : 0;

    const source = incrementMap(bySource, event.resolution_source, { latency_values: [] });
    source.latency_values.push(event.latency_ms);

    if (CLOUD_SOURCES.has(event.resolution_source) && event.fallback) {
      incrementMap(fallbacksToCloud, event.fallback);
    }

    const tenant = incrementMap(byTenant, event.tenant_id || 'sin tenant', { cost: 0 });
    tenant.cost += Number(event.estimated_cost || 0);

    if (!event.success || event.error) {
      incrementMap(errorsByModel, event.model || event.engine || 'unknown');
    }
  });

  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayCostMap = new Map();
  normalizedEvents.forEach((event) => {
    const ts = new Date(event.timestamp || nowMs).getTime();
    if (!Number.isFinite(ts)) return;
    const date = new Date(ts).toISOString().slice(0, 10);
    const entry = dayCostMap.get(date) || { date, cost: 0, cloud_events: 0 };
    entry.cost += Number(event.estimated_cost || 0);
    if (CLOUD_SOURCES.has(event.resolution_source)) entry.cloud_events += 1;
    dayCostMap.set(date, entry);
  });
  const costByDay = [...dayCostMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  function sumCostInWindow(windowMs) {
    return normalizedEvents.reduce((sum, event) => {
      const ts = new Date(event.timestamp || nowMs).getTime();
      return Number.isFinite(ts) && nowMs - ts <= windowMs
        ? sum + Number(event.estimated_cost || 0)
        : sum;
    }, 0);
  }

  return {
    total_events: total,
    cloud_events: cloudEvents.length,
    non_cloud_events: total - cloudEvents.length,
    cloud_avoidance_rate: cloudAvoidanceRate,
    ocr_image_events: ocrImageEvents.length,
    ocr_image_cloud_events: ocrImageCloudEvents.length,
    ocr_image_cloud_rate: ocrImageEvents.length
      ? (ocrImageCloudEvents.length / ocrImageEvents.length) * 100
      : 0,
    total_cost: totalCost,
    cost_last_7_days: Math.round(sumCostInWindow(7 * dayMs) * 1e8) / 1e8,
    cost_last_30_days: Math.round(sumCostInWindow(30 * dayMs) * 1e8) / 1e8,
    cost_by_day: costByDay,
    corrected_events: normalizedEvents.filter((event) => event.corrected_at).length,
    latency_p95_ms: latencyP95,
    error_rate: total ? (errors.length / total) * 100 : 0,
    by_feature: [...byFeature.values()].sort((a, b) => b.count - a.count),
    by_source: [...bySource.values()]
      .map((item) => ({
        key: item.key,
        count: item.count,
        percent: total ? (item.count / total) * 100 : 0,
        latency_p95_ms: percentile(item.latency_values, 95),
      }))
      .sort((a, b) => b.count - a.count),
    by_tenant: [...byTenant.values()].sort((a, b) => b.count - a.count),
    errors_by_model: [...errorsByModel.values()].sort((a, b) => b.count - a.count),
    fallbacks_to_cloud: [...fallbacksToCloud.values()].sort((a, b) => b.count - a.count),
    latest_events: normalizedEvents.slice(-20).reverse(),
  };
}

// Resumen de costo agregado en servidor (RPC fn_ai_telemetry_cost_summary).
// Evita depender de la ventana de eventos descargados en el cliente.
export async function getRemoteAICostSummary({ tenantId, days = 30 } = {}) {
  if (!REMOTE_ENABLED) {
    return { success: true, data: null, skipped: true };
  }
  if (!tenantId) return { success: false, error: 'tenant_id es requerido', data: null };

  try {
    const { default: supabaseService } = await import('./supabase.service');
    const { data, error } = await supabaseService.client.rpc('fn_ai_telemetry_cost_summary', {
      p_tenant_id: tenantId,
      p_window_days: Number(days) || 30,
    });

    if (error) return { success: false, error: error.message || String(error), data: null };

    const row = Array.isArray(data) && data.length ? data[0] : null;
    if (!row) {
      return {
        success: true,
        data: {
          total_cost: 0,
          cost_last_7_days: 0,
          cost_last_30_days: 0,
          cloud_events: 0,
          total_events: 0,
          cost_by_day: [],
        },
      };
    }

    return {
      success: true,
      data: {
        total_cost: Number(row.total_cost || 0),
        cost_last_7_days: Number(row.cost_last_7_days || 0),
        cost_last_30_days: Number(row.cost_last_30_days || 0),
        cloud_events: Number(row.cloud_events || 0),
        total_events: Number(row.total_events || 0),
        cost_by_day: Array.isArray(row.cost_by_day) ? row.cost_by_day : [],
      },
    };
  } catch (error) {
    return { success: false, error: error.message || String(error), data: null };
  }
}
