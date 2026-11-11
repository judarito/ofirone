import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NON_RETRYABLE_ERROR_PREFIX,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATION_TYPES,
  SYNC_OUTBOX_STATUSES,
  createIdempotencyKey,
  createOutboxOperation,
  fromLegacyPendingOp,
  isRetryableOutboxOperation,
  normalizeOutboxStatus,
  toLegacyPendingOp,
} from './syncContract.js';

describe('sync contract', () => {
  it('crea operación de outbox con idempotencia estable', () => {
    const operation = createOutboxOperation({
      operationId: 'op-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      deviceId: 'device-1',
      entityType: SYNC_ENTITY_TYPES.SALE,
      entityId: 'sale-1',
      operationType: SYNC_OPERATION_TYPES.CREATE_SALE,
      payload: { total: 1000 },
      createdAt: '2026-08-30T00:00:00.000Z',
    });

    assert.equal(operation.status, SYNC_OUTBOX_STATUSES.PENDING);
    assert.equal(operation.attempt_count, 0);
    assert.equal(operation.idempotency_key, 'sync:tenant-1:device-1:create_sale:sale:sale-1');
  });

  it('normaliza estados legacy de pending_ops', () => {
    assert.equal(normalizeOutboxStatus('PENDING'), 'pending');
    assert.equal(normalizeOutboxStatus('PROCESSING'), 'processing');
    assert.equal(normalizeOutboxStatus('DONE'), 'synced');
    assert.equal(normalizeOutboxStatus('FAILED'), 'failed');
  });

  it('convierte operaciones nuevas al formato mobile legacy sin perder metadata sync', () => {
    const operation = createOutboxOperation({
      operationId: 'op-2',
      tenantId: 'tenant-1',
      userId: 'user-1',
      deviceId: 'device-1',
      entityType: SYNC_ENTITY_TYPES.SALE,
      entityId: 'sale-2',
      operationType: SYNC_OPERATION_TYPES.CREATE_SALE,
      payload: { total: 500 },
      status: SYNC_OUTBOX_STATUSES.FAILED,
    });

    const legacy = toLegacyPendingOp(operation);

    assert.equal(legacy.opId, 'op-2');
    assert.equal(legacy.opType, 'CREATE_SALE');
    assert.equal(legacy.status, 'FAILED');
    assert.equal(legacy.payload.sync.entity_type, 'sale');
    assert.equal(legacy.payload.sync.idempotency_key, operation.idempotency_key);
  });

  it('recupera una operación desde pending_ops legacy', () => {
    const operation = fromLegacyPendingOp({
      opId: 'op-3',
      opType: 'CREATE_SALE',
      tenantId: 'tenant-1',
      userId: 'user-1',
      deviceId: 'device-1',
      payload: { total: 700 },
      status: 'PENDING',
      retryCount: 1,
      createdAt: '2026-08-30T00:00:00.000Z',
    });

    assert.equal(operation.entity_type, SYNC_ENTITY_TYPES.SALE);
    assert.equal(operation.operation_type, SYNC_OPERATION_TYPES.CREATE_SALE);
    assert.equal(operation.attempt_count, 1);
  });

  it('distingue errores permanentes de operaciones reintentables', () => {
    assert.equal(isRetryableOutboxOperation({ status: 'failed', error_message: 'timeout' }), true);
    assert.equal(
      isRetryableOutboxOperation({ status: 'failed', error_message: `${NON_RETRYABLE_ERROR_PREFIX}stock agotado` }),
      false,
    );
    assert.equal(isRetryableOutboxOperation({ status: 'dead_letter' }), false);
  });

  it('crea idempotency key con operationId cuando no hay entityId', () => {
    assert.equal(createIdempotencyKey({
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      operationType: SYNC_OPERATION_TYPES.CREATE,
      entityType: SYNC_ENTITY_TYPES.CUSTOMER,
      operationId: 'op-customer',
    }), 'sync:tenant-1:device-1:create:customer:op-customer');
  });
});
