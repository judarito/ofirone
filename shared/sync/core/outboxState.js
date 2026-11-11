// Estados canónicos del outbox de sincronización.
// Fuente única de verdad para mobile/web/desktop (shared sync engine).
// El runtime SQLite histórico usaba estados legacy en mayúsculas
// (PENDING/PROCESSING/DONE/FAILED); este módulo define el mapeo y las
// transiciones válidas hacia el contrato canónico del plan (Fase 15A.2).

export const OUTBOX_STATUSES = Object.freeze([
  'pending',
  'processing',
  'synced',
  'conflict',
  'failed',
  'dead_letter',
]);

// Estados que siguen "vivos" (pendientes de reintento o reintentables).
export const OUTBOX_PENDING_STATUSES = Object.freeze(['pending', 'failed']);

export const OUTBOX_TERMINAL_STATUSES = Object.freeze(['synced', 'conflict', 'dead_letter']);

export const LEGACY_OUTBOX_STATUS_MAP = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict',
  DEAD_LETTER: 'dead_letter',
});

const NO_RETRY_PREFIX = 'NO_RETRY:';

// Normaliza cualquier valor (canónico o legacy) al estado canónico.
export function normalizeOutboxStatus(status) {
  if (status == null) return 'pending';
  const lowered = String(status).trim().toLowerCase();
  if (OUTBOX_STATUSES.includes(lowered)) return lowered;
  const legacy = String(status).trim().toUpperCase();
  return LEGACY_OUTBOX_STATUS_MAP[legacy] || 'pending';
}

export function isNoRetryMessage(message) {
  return String(message || '').startsWith(NO_RETRY_PREFIX);
}

export function isOutboxPendingStatus(status) {
  return OUTBOX_PENDING_STATUSES.includes(normalizeOutboxStatus(status));
}

export function isOutboxTerminalStatus(status) {
  return OUTBOX_TERMINAL_STATUSES.includes(normalizeOutboxStatus(status));
}

// Estado destino de un fallo: dead-letter solo cuando el error es permanente
// (etiquetado NO_RETRY), si no `failed` (reintentable por retry/backoff).
export function outboxFailureTarget({ message = '', isNoRetry = null } = {}) {
  const blocked = isNoRetry == null ? isNoRetryMessage(message) : Boolean(isNoRetry);
  return blocked ? 'dead_letter' : 'failed';
}

// Código de error legible para la columna `error_code`.
// Prioriza el código explícito; si el mensaje trae `NO_RETRY:CODE:...`, lo extrae.
export function resolveOutboxErrorCode(message = '', explicitCode = null) {
  if (explicitCode) return String(explicitCode);
  const match = String(message || '').match(/^NO_RETRY:([A-Z0-9_]+):/);
  return match ? match[1] : isNoRetryMessage(message) ? 'BLOCKED' : 'SYNC_FAILED';
}
