export const ASYNC_JOB_STATUSES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  WAITING_RETRY: 'waiting_retry',
  COMPLETED: 'completed',
  COMPLETED_WITH_WARNINGS: 'completed_with_warnings',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
  CANCELLED: 'cancelled',
});

export const ASYNC_JOB_QUEUES = Object.freeze({
  SYNC_OUTBOX: 'sync_outbox',
  NOTIFICATION_OUTBOX: 'notification_outbox',
  ACCOUNTING_EVENTS: 'accounting_events',
  BILLING_JOBS: 'billing_jobs',
  PAYMENT_WEBHOOKS: 'payment_webhooks',
  AI_JOBS: 'ai_jobs',
  IMPORT_JOBS: 'import_jobs',
  MEDIA_PROCESSING: 'media_processing',
  REPORT_JOBS: 'report_jobs',
});

export function createAsyncJobPayload({
  tenantId,
  queue,
  type,
  payload = {},
  dedupeKey = null,
  priority = 100,
  runAfter = null,
  maxAttempts = 3,
  source = 'backend',
  correlationId = null,
} = {}) {
  if (!tenantId) throw new Error('tenantId es requerido para crear un job.');
  if (!queue) throw new Error('queue es requerido para crear un job.');
  if (!type) throw new Error('type es requerido para crear un job.');

  return {
    tenant_id: tenantId,
    queue,
    job_type: type,
    payload,
    dedupe_key: dedupeKey,
    priority,
    run_after: runAfter,
    max_attempts: maxAttempts,
    source,
    correlation_id: correlationId,
  };
}

