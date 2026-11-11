import {
  getPendingOps,
  markPendingOpDone,
  markPendingOpFailed,
  markPendingOpProcessing,
  resetStuckProcessingOps,
} from '../storage/sqlite/database';
import { createSale } from './pos.service';
import {
  DEFAULT_SYNC_RETRY_POLICY,
  isTaggedNoRetry,
  resolveSyncFailureMessage,
  shouldDeferRetry,
  tagNoRetry,
} from '../../../shared/sync/retryPolicy';

// ─── Operation handlers ───────────────────────────────────────────────────────
// Register a handler here to add support for a new op_type.
// Each handler receives the full op object and must throw on failure.

async function processCreateSale(op) {
  const payload = op.payload || {};
  const result = await createSale(op.tenantId, {
    ...payload,
    operation_id: op.opId,
  });
  if (!result.success) {
    throw new Error(result.error || 'No fue posible sincronizar venta offline');
  }
}

const OP_HANDLERS = {
  CREATE_SALE: processCreateSale,
  // Future handlers:
  // CREATE_CARTERA_PAYMENT: processCarteraPayment,
  // CREATE_SUPPLIER_PAYMENT: processSupplierPayment,
  // CREATE_RETURN: processReturn,
};

// ─── Main sync function ───────────────────────────────────────────────────────

let activeSyncPromise = null;

async function runSyncPendingOperations({ limit = 20, tenantId = null, userId = null } = {}) {
  await resetStuckProcessingOps();

  const pending = await getPendingOps({ limit, tenantId, userId });
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const nowMs = Date.now();

  for (const op of pending) {
    if (
      Number(op?.retryCount || 0) >= DEFAULT_SYNC_RETRY_POLICY.maxRetries &&
      !isTaggedNoRetry(op?.lastError)
    ) {
      await markPendingOpFailed(
        op.opId,
        tagNoRetry(
          `Se alcanzo el maximo de reintentos (${DEFAULT_SYNC_RETRY_POLICY.maxRetries}). Error previo: ${op.lastError || 'sin detalle'}`
        ),
        'MAX_RETRIES_REACHED'
      );
      failed += 1;
      continue;
    }

    if (shouldDeferRetry(op, nowMs)) {
      skipped += 1;
      continue;
    }

    const handler = OP_HANDLERS[op.opType];
    if (!handler) {
      await markPendingOpFailed(
        op.opId,
        `NO_RETRY:Tipo de operacion no soportado: ${op.opType}`,
        'UNSUPPORTED_OP_TYPE'
      );
      failed += 1;
      continue;
    }

    try {
      await markPendingOpProcessing(op.opId);
      await handler(op);
      await markPendingOpDone(op.opId);
      processed += 1;
    } catch (error) {
      const nextRetryCount = Number(op?.retryCount || 0) + 1;
      await markPendingOpFailed(op.opId, resolveSyncFailureMessage(error, { nextRetryCount }));
      failed += 1;
    }
  }

  return {
    success: true,
    processed,
    failed,
    skipped,
    total: pending.length,
  };
}

export async function syncPendingOperations(options = {}) {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = runSyncPendingOperations(options).finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}
