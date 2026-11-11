// Motor de pull incremental del sync engine (fase 15A.4 / B2).
// Orquesta la descarga "solo cambios después del último checkpoint" en lotes
// paginados; es agnóstico del transporte (Supabase, backend gateway, …) y del
// almacén de checkpoints (sync_state). Se prueba con transporte/almacén fake.

import {
  SYNC_PULL_DEFAULT_BATCH,
  buildPullCheckpointKey,
  reducePullCursor,
  resolvePullCursor,
  serializePullCheckpoint,
  shouldRunFullPull,
} from '../core/pullState.js';

export const SYNC_PULL_MAX_BATCHES = 50;

/**
 * Ejecuta un pull incremental de una entidad.
 *
 * @param {object} options
 * @param {string} options.entityType - Tipo de entidad (product, product_variant, customer, …).
 * @param {(params:{since:string|null, limit:number}) => Promise<Array>} options.fetchPage
 *   Transporte: devuelve filas con `updated_at` (o el campo configurado).
 * @param {(key:string) => Promise<string|null>} options.readCheckpoint - Lee el valor persistido.
 * @param {(key:string, value:string) => Promise<void>} options.writeCheckpoint - Persiste el checkpoint.
 * @param {number} [options.batchSize=200]
 * @param {number} [options.maxBatches=50]
 * @param {string} [options.field='updated_at'] - Campo cursor en las filas.
 * @param {(rows:Array) => Promise<void>|void} [options.onRows] - Hook por lote (persistir filas).
 */
export async function runIncrementalPull({
  entityType,
  fetchPage,
  readCheckpoint,
  writeCheckpoint,
  batchSize = SYNC_PULL_DEFAULT_BATCH,
  maxBatches = SYNC_PULL_MAX_BATCHES,
  field = 'updated_at',
  onRows = null,
} = {}) {
  if (!entityType || typeof fetchPage !== 'function') {
    throw new Error('entityType y fetchPage son requeridos para runIncrementalPull');
  }
  const limit = Number(batchSize) > 0 ? Math.floor(Number(batchSize)) : SYNC_PULL_DEFAULT_BATCH;
  const key = buildPullCheckpointKey(entityType);
  const stored = (await readCheckpoint?.(key)) ?? null;
  const mode = shouldRunFullPull(stored) ? 'full' : 'incremental';
  let cursor = resolvePullCursor(stored);
  let batches = 0;
  let rowsTotal = 0;
  let earlyStop = null;

  for (;;) {
    if (batches >= maxBatches) {
      earlyStop = 'max_batches';
      break;
    }

    const list = (await fetchPage({ since: cursor, limit })) || [];
    rowsTotal += list.length;
    if (onRows && list.length) {
      await onRows(list);
    }

    const previousCursor = cursor;
    const nextCursor = reducePullCursor(list, { field, current: cursor });
    if (nextCursor) cursor = nextCursor;
    batches += 1;

    if (list.length < limit) break; // lote parcial → no hay más páginas
    if (!nextCursor) {
      earlyStop = 'no_cursor_progress'; // lote lleno sin cursor: evita loop
      break;
    }
    if (nextCursor === previousCursor) {
      earlyStop = 'cursor_stalled';
      break;
    }
  }

  const serialized = serializePullCheckpoint({ entityType, updatedAt: cursor, count: rowsTotal });
  if (writeCheckpoint) {
    await writeCheckpoint(serialized.key, serialized.value);
  }

  return {
    entityType,
    mode,
    batches,
    rows: rowsTotal,
    cursor,
    earlyStop,
  };
}
