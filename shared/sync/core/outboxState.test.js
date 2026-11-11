import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LEGACY_OUTBOX_STATUS_MAP,
  OUTBOX_PENDING_STATUSES,
  OUTBOX_TERMINAL_STATUSES,
  isNoRetryMessage,
  isOutboxPendingStatus,
  isOutboxTerminalStatus,
  normalizeOutboxStatus,
  outboxFailureTarget,
  resolveOutboxErrorCode,
} from './outboxState.js';

describe('outbox state (canonical)', () => {
  it('normaliza estados legacy a canónicos', () => {
    assert.equal(normalizeOutboxStatus('PENDING'), 'pending');
    assert.equal(normalizeOutboxStatus('PROCESSING'), 'processing');
    assert.equal(normalizeOutboxStatus('DONE'), 'synced');
    assert.equal(normalizeOutboxStatus('FAILED'), 'failed');
    assert.equal(normalizeOutboxStatus('CONFLICT'), 'conflict');
    assert.equal(normalizeOutboxStatus('pending'), 'pending');
    assert.equal(normalizeOutboxStatus(null), 'pending');
    assert.equal(normalizeOutboxStatus('desconocido'), 'pending');
  });

  it('expone pendientes, terminales y el mapa legacy', () => {
    assert.deepEqual([...OUTBOX_PENDING_STATUSES], ['pending', 'failed']);
    assert.ok(OUTBOX_TERMINAL_STATUSES.includes('synced'));
    assert.ok(OUTBOX_TERMINAL_STATUSES.includes('dead_letter'));
    assert.equal(LEGACY_OUTBOX_STATUS_MAP.DONE, 'synced');
  });

  it('clasifica pendiente/terminal', () => {
    assert.equal(isOutboxPendingStatus('failed'), true);
    assert.equal(isOutboxPendingStatus('PENDING'), true);
    assert.equal(isOutboxPendingStatus('synced'), false);
    assert.equal(isOutboxTerminalStatus('dead_letter'), true);
    assert.equal(isOutboxTerminalStatus('pending'), false);
  });

  it('distingue mensajes NO_RETRY (dead-letter) de fallos reintentables', () => {
    assert.equal(isNoRetryMessage('NO_RETRY:Se alcanzo el maximo de reintentos'), true);
    assert.equal(isNoRetryMessage('error transitorio de red'), false);
    assert.equal(outboxFailureTarget({ message: 'NO_RETRY:maximo' }), 'dead_letter');
    assert.equal(outboxFailureTarget({ message: 'red caida' }), 'failed');
    assert.equal(outboxFailureTarget({ isNoRetry: false }), 'failed');
  });

  it('resuelve error_code explícito, extraído del tag o genérico', () => {
    assert.equal(resolveOutboxErrorCode('x', 'MAX_RETRIES_REACHED'), 'MAX_RETRIES_REACHED');
    assert.equal(resolveOutboxErrorCode('NO_RETRY:TIPO:detalle'), 'TIPO');
    assert.equal(resolveOutboxErrorCode('NO_RETRY:bloqueado'), 'BLOCKED');
    assert.equal(resolveOutboxErrorCode('fallo genérico'), 'SYNC_FAILED');
  });
});
