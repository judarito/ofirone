import {
  SYNC_ENTITY_TYPES,
  SYNC_OPERATION_TYPES,
  createOutboxOperation,
  fromLegacyPendingOp,
  toLegacyPendingOp,
} from '../../../shared/sync/syncContract';

export function createSaleSyncOutboxOperation({
  operationId,
  tenantId,
  userId,
  deviceId,
  payload = {},
  createdAt = new Date().toISOString(),
} = {}) {
  return createOutboxOperation({
    operationId,
    tenantId,
    userId,
    deviceId,
    entityType: SYNC_ENTITY_TYPES.SALE,
    entityId: operationId,
    operationType: SYNC_OPERATION_TYPES.CREATE_SALE,
    payload,
    createdAt,
  });
}

export function createLegacySalePendingOp(input = {}) {
  return toLegacyPendingOp(createSaleSyncOutboxOperation(input));
}

export function normalizeLegacyPendingOp(op = {}) {
  return fromLegacyPendingOp(op);
}
