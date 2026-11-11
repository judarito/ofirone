import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../lib/supabase';
import { getOrCreateDeviceId } from './device.service';

const AI_TELEMETRY_KEY = 'ofirone_ai_telemetry_events';
const AI_TELEMETRY_REMOTE_TABLE = 'ai_telemetry_events';
const MAX_EVENTS = 250;
const REPLAY_BATCH = 20;
const REMOTE_ENABLED = process.env.EXPO_PUBLIC_AI_TELEMETRY_REMOTE_ENABLED === 'true';

function buildId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readStoredEvents() {
  try {
    const raw = await AsyncStorage.getItem(AI_TELEMETRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function writeStoredEvents(events) {
  try {
    await AsyncStorage.setItem(AI_TELEMETRY_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch (_error) {
    // Telemetry must never break the operational flow.
  }
}

async function removeStoredEvent(id) {
  const current = await readStoredEvents();
  if (!current.some((event) => event.id === id)) return;
  await writeStoredEvents(current.filter((event) => event.id !== id));
}

export function estimateAITokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return Math.max(0, Math.ceil(text.length / 4));
}

export function normalizeAITelemetryEvent(event = {}) {
  return {
    id: event.id || buildId(),
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

export async function recordAITelemetryEvent(event = {}) {
  let deviceId = event.device_id || null;
  if (!deviceId) {
    try {
      deviceId = await getOrCreateDeviceId();
    } catch (_error) {
      deviceId = null;
    }
  }

  const normalized = normalizeAITelemetryEvent({
    ...event,
    device_id: deviceId,
  });
  const current = await readStoredEvents();
  await writeStoredEvents([...current, normalized]);
  if (REMOTE_ENABLED && normalized.tenant_id) {
    persistAITelemetryEvent(normalized)
      .then((response) => {
        if (response?.success) {
          // Ya está remoto: no acumular duplicados en la cola local.
          return removeStoredEvent(normalized.id);
        }
        // Falló: reintentar junto a los pendientes acumulados.
        return flushPendingAITelemetryEvents({ limit: REPLAY_BATCH }).catch(() => null);
      })
      .catch(() => flushPendingAITelemetryEvents({ limit: REPLAY_BATCH }).catch(() => null));
  }
  return normalized;
}

export async function getAITelemetryEvents() {
  return readStoredEvents();
}

export async function clearAITelemetryEvents() {
  await writeStoredEvents([]);
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
    const { error } = await supabase
      .from(AI_TELEMETRY_REMOTE_TABLE)
      .upsert(toRemoteRow(normalized), { onConflict: 'tenant_id,event_id' });

    if (error) return { success: false, error: error.message || String(error) };
    return { success: true, data: normalized };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

let activeFlushPromise = null;

async function runPendingFlush({ limit }) {
  const pending = await readStoredEvents();
  const candidates = pending.filter((event) => event.tenant_id).slice(0, Math.max(1, limit));
  if (!candidates.length) {
    return { success: true, sent: 0, failed: 0, remaining: 0 };
  }

  const failedIds = new Set();
  let sent = 0;
  for (const event of candidates) {
    const response = await persistAITelemetryEvent(event);
    if (response?.success) {
      sent += 1;
    } else {
      failedIds.add(event.id);
    }
  }

  const succeededIds = new Set(
    candidates.filter((event) => !failedIds.has(event.id)).map((event) => event.id)
  );
  if (succeededIds.size > 0) {
    const remaining = pending.filter((event) => !succeededIds.has(event.id));
    await writeStoredEvents(remaining);
  }

  return {
    success: true,
    sent,
    failed: candidates.length - sent,
    remaining: Math.max(0, pending.length - sent),
  };
}

// Reintenta persistir los eventos que quedaron en la cola local (p. ej. por
// falta de conexión). Idempotente gracias al upsert por (tenant_id, event_id).
export async function flushPendingAITelemetryEvents({ limit = REPLAY_BATCH } = {}) {
  if (!REMOTE_ENABLED) {
    const pending = await readStoredEvents();
    return { success: true, sent: 0, failed: 0, remaining: pending.length, skipped: true };
  }
  if (activeFlushPromise) {
    return activeFlushPromise;
  }
  activeFlushPromise = runPendingFlush({ limit: Number(limit) || REPLAY_BATCH }).finally(() => {
    activeFlushPromise = null;
  });
  return activeFlushPromise;
}

export async function getRemoteAITelemetryEvents({ tenantId, limit = MAX_EVENTS } = {}) {
  if (!REMOTE_ENABLED) return { success: true, data: [], skipped: true };
  if (!tenantId) return { success: true, data: [] };

  try {
    const { data, error } = await supabase
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
