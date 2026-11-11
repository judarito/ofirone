import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NON_RETRYABLE_ERROR_PREFIX,
} from './syncContract.js';
import {
  computeRetryDelayMs,
  isNonRetriableSyncError,
  isTaggedNoRetry,
  resolveSyncFailureMessage,
  shouldDeferRetry,
  tagNoRetry,
} from './retryPolicy.js';

describe('sync retry policy', () => {
  it('calcula backoff exponencial con máximo', () => {
    assert.equal(computeRetryDelayMs(1), 15000);
    assert.equal(computeRetryDelayMs(2), 30000);
    assert.equal(computeRetryDelayMs(10), 900000);
  });

  it('detecta errores no reintentables de negocio', () => {
    assert.equal(isNonRetriableSyncError('Stock insuficiente para variante abc'), true);
    assert.equal(isNonRetriableSyncError('network timeout'), false);
  });

  it('etiqueta errores permanentes una sola vez', () => {
    assert.equal(tagNoRetry('stock agotado'), `${NON_RETRYABLE_ERROR_PREFIX}stock agotado`);
    assert.equal(tagNoRetry(`${NON_RETRYABLE_ERROR_PREFIX}stock agotado`), `${NON_RETRYABLE_ERROR_PREFIX}stock agotado`);
    assert.equal(isTaggedNoRetry(`${NON_RETRYABLE_ERROR_PREFIX}stock agotado`), true);
  });

  it('difiere retry fallido hasta cumplir la ventana de backoff', () => {
    const nowMs = new Date('2026-08-30T00:00:20.000Z').getTime();
    assert.equal(shouldDeferRetry({
      status: 'FAILED',
      retryCount: 2,
      updatedAt: '2026-08-30T00:00:00.000Z',
    }, nowMs), true);
    assert.equal(shouldDeferRetry({
      status: 'FAILED',
      retryCount: 1,
      updatedAt: '2026-08-30T00:00:00.000Z',
    }, nowMs), false);
  });

  it('marca como no retry al superar reintentos máximos', () => {
    assert.equal(resolveSyncFailureMessage(new Error('timeout'), { nextRetryCount: 8 }), `${NON_RETRYABLE_ERROR_PREFIX}timeout`);
    assert.equal(resolveSyncFailureMessage(new Error('timeout'), { nextRetryCount: 2 }), 'timeout');
  });
});
