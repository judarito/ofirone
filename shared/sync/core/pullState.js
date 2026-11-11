// Estado de pull incremental del sync engine (fase 15A.4).
// Funciones puras para construir/persistir/leer checkpoints por entidad.
// El checkpoint se guarda en la tabla/almacén de `sync_state` con una clave
// estable; el cursor es el `updated_at` (o versión) desde el que pedir cambios.

export const SYNC_PULL_DEFAULT_BATCH = 200;

export const SYNC_PULL_CHECKPOINT_PREFIX = 'pull_checkpoint:';

export function buildPullCheckpointKey(entityType) {
  return `${SYNC_PULL_CHECKPOINT_PREFIX}${String(entityType || 'unknown').trim()}`;
}

// Valor serializado que se persiste en sync_state para una entidad.
export function serializePullCheckpoint({
  entityType,
  updatedAt,
  lastId = null,
  count = 0,
  pulledAt = null,
} = {}) {
  const key = buildPullCheckpointKey(entityType);
  const value = JSON.stringify({
    updated_at: updatedAt || null,
    last_id: lastId || null,
    count: Math.max(0, Number(count) || 0),
    pulled_at: pulledAt || new Date().toISOString(),
  });
  return { key, value };
}

export function parsePullCheckpoint(storedValue) {
  if (storedValue == null) return null;
  try {
    const parsed = typeof storedValue === 'string' ? JSON.parse(storedValue) : storedValue;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      updatedAt: parsed.updated_at || null,
      lastId: parsed.last_id || null,
      count: Math.max(0, Number(parsed.count) || 0),
      pulledAt: parsed.pulled_at || null,
    };
  } catch (_error) {
    return null;
  }
}

function toTimestamp(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

// true si `candidate` es más reciente que `baseline` (ambos ISO/Date).
export function isCursorNewer(candidate, baseline) {
  const candidateTs = toTimestamp(candidate);
  const baselineTs = toTimestamp(baseline);
  if (candidateTs == null) return false;
  if (baselineTs == null) return true;
  return candidateTs > baselineTs;
}

// Decide si se necesita un pull completo (sin checkpoint previo) o incremental.
export function shouldRunFullPull(storedValue) {
  const checkpoint = parsePullCheckpoint(storedValue);
  return !checkpoint || !checkpoint.updatedAt;
}

// Cursor desde el que pedir cambios: el último `updated_at` conocido.
export function resolvePullCursor(storedValue) {
  const checkpoint = parsePullCheckpoint(storedValue);
  return checkpoint?.updatedAt || null;
}

// Indica si conviene seguir pidiendo páginas del lote actual.
export function hasMorePullPages({ receivedCount = 0, batchSize = SYNC_PULL_DEFAULT_BATCH } = {}) {
  const batch = Number(batchSize) > 0 ? Number(batchSize) : SYNC_PULL_DEFAULT_BATCH;
  return Number(receivedCount) >= batch;
}

// Reduce el cursor incremental al máximo `updated_at` observado en el lote.
export function reducePullCursor(rows, { field = 'updated_at', current = null } = {}) {
  let cursor = current;
  for (const row of rows || []) {
    const value = row?.[field];
    if (isCursorNewer(value, cursor)) cursor = value;
  }
  return cursor;
}
