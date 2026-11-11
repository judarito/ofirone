import { NON_RETRYABLE_ERROR_PREFIX } from './syncContract.js';

export const DEFAULT_SYNC_RETRY_POLICY = Object.freeze({
  maxRetries: 8,
  baseDelayMs: 15000,
  maxDelayMs: 15 * 60 * 1000,
});

function toLowerText(value) {
  return String(value || '').toLowerCase();
}

function parseIsoDateMs(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isTaggedNoRetry(message) {
  return String(message || '').startsWith(NON_RETRYABLE_ERROR_PREFIX);
}

export function tagNoRetry(message) {
  const cleanMessage = String(message || 'Error de sincronizacion').trim();
  return isTaggedNoRetry(cleanMessage) ? cleanMessage : `${NON_RETRYABLE_ERROR_PREFIX}${cleanMessage}`;
}

export function isNonRetriableSyncError(message) {
  const text = toLowerText(message);
  return (
    text.includes('stock insuficiente') ||
    text.includes('insufficient stock') ||
    (text.includes('disponible:') && text.includes('requerido:')) ||
    text.includes('sp_create_sale_idempotent') ||
    text.includes('does not exist')
  );
}

export function computeRetryDelayMs(retryCount, policy = DEFAULT_SYNC_RETRY_POLICY) {
  const count = Math.max(1, Number(retryCount || 1));
  const multiplier = 2 ** Math.max(0, count - 1);
  return Math.min(Number(policy.baseDelayMs || 0) * multiplier, Number(policy.maxDelayMs || 0));
}

export function shouldDeferRetry(op, nowMs = Date.now(), policy = DEFAULT_SYNC_RETRY_POLICY) {
  if (op?.status !== 'FAILED' && op?.status !== 'failed') return false;
  const retries = Number(op?.retryCount ?? op?.attempt_count ?? 0);
  if (retries <= 0) return false;
  const referenceMs = parseIsoDateMs(op?.updatedAt || op?.updated_at) || parseIsoDateMs(op?.createdAt || op?.created_at);
  if (!referenceMs) return false;
  return nowMs - referenceMs < computeRetryDelayMs(retries, policy);
}

export function resolveSyncFailureMessage(error, {
  nextRetryCount = 1,
  policy = DEFAULT_SYNC_RETRY_POLICY,
} = {}) {
  const baseMessage = error?.message || String(error || '') || 'Error de sincronizacion';
  const shouldStopRetrying = isNonRetriableSyncError(baseMessage) || Number(nextRetryCount || 0) >= policy.maxRetries;
  return shouldStopRetrying ? tagNoRetry(baseMessage) : baseMessage;
}
