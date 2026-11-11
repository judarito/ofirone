import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPullCheckpointKey } from '../core/pullState.js';
import { runIncrementalPull } from './pullDriver.js';

function makeRows(baseDate, total, stepMs = 1000) {
  const rows = [];
  for (let i = 0; i < total; i += 1) {
    rows.push({
      id: `id-${i}`,
      updated_at: new Date(new Date(baseDate).getTime() + i * stepMs).toISOString(),
    });
  }
  return rows;
}

function makeTransport(allRows, sinceField = 'updated_at') {
  const calls = [];
  return {
    fetchPage: async ({ since, limit }) => {
      calls.push({ since, limit });
      const filtered = since ? allRows.filter((row) => row[sinceField] > since) : allRows;
      return filtered.slice(0, limit);
    },
    calls,
  };
}

function makeCheckpointStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    read: async (key) => map.get(key) ?? null,
    write: async (key, value) => {
      map.set(key, value);
    },
    map,
  };
}

describe('pull incremental driver', () => {
  it('primera ejecucion: pull full paginado y persiste checkpoint', async () => {
    const rows = makeRows('2026-08-01T00:00:00.000Z', 450);
    const transport = makeTransport(rows);
    const store = makeCheckpointStore();

    const result = await runIncrementalPull({
      entityType: 'product_variant',
      fetchPage: transport.fetchPage,
      readCheckpoint: store.read,
      writeCheckpoint: store.write,
      batchSize: 200,
      onRows: () => {},
    });

    assert.equal(result.mode, 'full');
    assert.equal(result.rows, 450);
    assert.ok(result.batches >= 3);
    assert.equal(result.earlyStop, null);
    const stored = store.map.get(buildPullCheckpointKey('product_variant'));
    // Cursor = máximo updated_at observado (base + 449 segundos).
    assert.ok(stored.includes('2026-08-01T00:07:29.000Z'));
  });

  it('segunda ejecucion: pull incremental solo con cambios posteriores al cursor', async () => {
    const initialRows = makeRows('2026-08-01T00:00:00.000Z', 100);
    const store = makeCheckpointStore();
    await runIncrementalPull({
      entityType: 'product',
      fetchPage: makeTransport(initialRows).fetchPage,
      readCheckpoint: store.read,
      writeCheckpoint: store.write,
      batchSize: 50,
    });

    // Nuevos cambios posteriores al checkpoint guardado.
    const newRows = makeRows('2026-08-05T00:00:00.000Z', 30);
    const transport2 = makeTransport(newRows);
    const result = await runIncrementalPull({
      entityType: 'product',
      fetchPage: transport2.fetchPage,
      readCheckpoint: store.read,
      writeCheckpoint: store.write,
      batchSize: 50,
    });

    assert.equal(result.mode, 'incremental');
    assert.equal(result.rows, 30);
    // El transporte recibió `since` = cursor previo.
    assert.ok(transport2.calls.length > 0);
    assert.ok(transport2.calls[0].since.startsWith('2026-08-01'));
  });

  it('no pide mas paginas cuando un lote viene incompleto', async () => {
    const rows = makeRows('2026-08-01T00:00:00.000Z', 5);
    const transport = makeTransport(rows);
    const store = makeCheckpointStore();

    const result = await runIncrementalPull({
      entityType: 'customer',
      fetchPage: transport.fetchPage,
      readCheckpoint: store.read,
      writeCheckpoint: store.write,
      batchSize: 200,
    });

    assert.equal(result.rows, 5);
    assert.equal(transport.calls.length, 1);
    assert.equal(result.earlyStop, null);
  });

  it('frena por max_batches cuando el catálogo sigue avanzando', async () => {
    const rows = makeRows('2026-08-01T00:00:00.000Z', 1000, 1);
    const transport = makeTransport(rows);
    const store = makeCheckpointStore();

    const result = await runIncrementalPull({
      entityType: 'big_catalog',
      fetchPage: transport.fetchPage,
      readCheckpoint: store.read,
      writeCheckpoint: store.write,
      batchSize: 200,
      maxBatches: 3,
    });

    assert.equal(result.earlyStop, 'max_batches');
    assert.equal(result.batches, 3);
    assert.equal(result.rows, 600);
  });

  it('detiene con no_cursor_progress si el transporte no avanza el cursor', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: `x-${i}`, updated_at: null }));
    const store = makeCheckpointStore();

    const result = await runIncrementalPull({
      entityType: 'no_cursor_entity',
      fetchPage: async ({ limit }) => rows.slice(0, limit),
      readCheckpoint: store.read,
      writeCheckpoint: store.write,
      batchSize: 200,
    });

    assert.equal(result.earlyStop, 'no_cursor_progress');
  });

  it('lanza error sin entityType o fetchPage', async () => {
    await assert.rejects(
      runIncrementalPull({ entityType: 'x' }),
      /entityType y fetchPage son requeridos/
    );
    await assert.rejects(
      runIncrementalPull({ fetchPage: async () => [] }),
      /entityType y fetchPage son requeridos/
    );
  });
});
