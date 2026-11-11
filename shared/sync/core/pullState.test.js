import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPullCheckpointKey,
  hasMorePullPages,
  isCursorNewer,
  parsePullCheckpoint,
  reducePullCursor,
  resolvePullCursor,
  serializePullCheckpoint,
  shouldRunFullPull,
} from './pullState.js';

describe('pull state (checkpoints incrementales)', () => {
  it('construye claves estables por entidad', () => {
    assert.equal(buildPullCheckpointKey('product_variant'), 'pull_checkpoint:product_variant');
  });

  it('serializa y parsea el checkpoint', () => {
    const { key, value } = serializePullCheckpoint({
      entityType: 'sale',
      updatedAt: '2026-08-23T04:00:00.000Z',
      count: 42,
    });
    assert.equal(key, 'pull_checkpoint:sale');
    const parsed = parsePullCheckpoint(value);
    assert.equal(parsed.updatedAt, '2026-08-23T04:00:00.000Z');
    assert.equal(parsed.count, 42);
    assert.ok(parsed.pulledAt);
    assert.equal(parsePullCheckpoint(null), null);
    assert.equal(parsePullCheckpoint('{no json'), null);
  });

  it('decide pull completo cuando no hay checkpoint o cursor', () => {
    assert.equal(shouldRunFullPull(null), true);
    assert.equal(shouldRunFullPull('{}'), true);
    const { value } = serializePullCheckpoint({
      entityType: 'product',
      updatedAt: '2026-08-23T04:00:00.000Z',
    });
    assert.equal(shouldRunFullPull(value), false);
    assert.equal(resolvePullCursor(value), '2026-08-23T04:00:00.000Z');
    assert.equal(resolvePullCursor(null), null);
  });

  it('compara cursores por tiempo', () => {
    assert.equal(isCursorNewer('2026-08-24T04:00:00.000Z', '2026-08-23T04:00:00.000Z'), true);
    assert.equal(isCursorNewer('2026-08-23T04:00:00.000Z', '2026-08-24T04:00:00.000Z'), false);
    assert.equal(isCursorNewer('no-valido', '2026-08-23T04:00:00.000Z'), false);
    assert.equal(isCursorNewer('2026-08-23T04:00:00.000Z', null), true);
  });

  it('reduce el cursor al updated_at mas reciente del lote', () => {
    const rows = [
      { updated_at: '2026-08-22T01:00:00.000Z' },
      { updated_at: '2026-08-23T02:00:00.000Z' },
      { updated_at: null },
    ];
    assert.equal(reducePullCursor(rows), '2026-08-23T02:00:00.000Z');
  });

  it('indica si quedan paginas por pedir', () => {
    assert.equal(hasMorePullPages({ receivedCount: 200, batchSize: 200 }), true);
    assert.equal(hasMorePullPages({ receivedCount: 120, batchSize: 200 }), false);
    assert.equal(hasMorePullPages({ receivedCount: 0 }), false);
  });
});
