import {
  createLegacySalePendingOp,
  createSaleSyncOutboxOperation,
  normalizeLegacyPendingOp,
} from '../services/syncOutbox.service';

describe('syncOutbox.service', () => {
  it('crea operación canónica para venta offline', () => {
    const operation = createSaleSyncOutboxOperation({
      operationId: 'op-sale-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      deviceId: 'device-1',
      payload: { total: 12000 },
      createdAt: '2026-08-30T00:00:00.000Z',
    });

    expect(operation.operation_id).toBe('op-sale-1');
    expect(operation.entity_type).toBe('sale');
    expect(operation.operation_type).toBe('create_sale');
    expect(operation.idempotency_key).toBe('sync:tenant-1:device-1:create_sale:sale:op-sale-1');
  });

  it('mantiene compatibilidad con pending_ops mobile', () => {
    const legacy = createLegacySalePendingOp({
      operationId: 'op-sale-2',
      tenantId: 'tenant-1',
      userId: 'user-1',
      deviceId: 'device-1',
      payload: { total: 8000 },
      createdAt: '2026-08-30T00:00:00.000Z',
    });

    expect(legacy.opId).toBe('op-sale-2');
    expect(legacy.opType).toBe('CREATE_SALE');
    expect(legacy.payload.sync.entity_type).toBe('sale');
    expect(legacy.payload.sync.idempotency_key).toBe('sync:tenant-1:device-1:create_sale:sale:op-sale-2');

    const normalized = normalizeLegacyPendingOp(legacy);
    expect(normalized.operation_id).toBe('op-sale-2');
    expect(normalized.status).toBe('pending');
  });
});
