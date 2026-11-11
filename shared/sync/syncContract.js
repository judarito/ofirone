import { OUTBOX_STATUSES as OUTBOX_STATUS_VALUES } from './core/outboxState.js';

export const SYNC_ENTITY_TYPES = Object.freeze({
  SALE: 'sale',
  SALE_PAYMENT: 'sale_payment',
  INVENTORY_MOVE: 'inventory_move',
  CUSTOMER: 'customer',
  PRODUCT: 'product',
  PRODUCT_VARIANT: 'product_variant',
});

export const SYNC_OPERATION_TYPES = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  CREATE_SALE: 'create_sale',
  REGISTER_PAYMENT: 'register_payment',
  REGISTER_INVENTORY_MOVE: 'register_inventory_move',
});

const [PENDING, PROCESSING, SYNCED, CONFLICT, FAILED, DEAD_LETTER] = OUTBOX_STATUS_VALUES;

export const SYNC_OUTBOX_STATUSES = Object.freeze({
  PENDING,
  PROCESSING,
  SYNCED,
  CONFLICT,
  FAILED,
  DEAD_LETTER,
});

export const LEGACY_PENDING_OP_STATUS_MAP = Object.freeze({
  PENDING: SYNC_OUTBOX_STATUSES.PENDING,
  PROCESSING: SYNC_OUTBOX_STATUSES.PROCESSING,
  DONE: SYNC_OUTBOX_STATUSES.SYNCED,
  FAILED: SYNC_OUTBOX_STATUSES.FAILED,
});

export const LEGACY_PENDING_OP_STATUS_REVERSE_MAP = Object.freeze({
  [SYNC_OUTBOX_STATUSES.PENDING]: 'PENDING',
  [SYNC_OUTBOX_STATUSES.PROCESSING]: 'PROCESSING',
  [SYNC_OUTBOX_STATUSES.SYNCED]: 'DONE',
  [SYNC_OUTBOX_STATUSES.CONFLICT]: 'FAILED',
  [SYNC_OUTBOX_STATUSES.FAILED]: 'FAILED',
  [SYNC_OUTBOX_STATUSES.DEAD_LETTER]: 'FAILED',
});

export const NON_RETRYABLE_ERROR_PREFIX = 'NO_RETRY:';

const ALLOWED_ENTITY_TYPES = new Set(Object.values(SYNC_ENTITY_TYPES));
const ALLOWED_OPERATION_TYPES = new Set(Object.values(SYNC_OPERATION_TYPES));
const ALLOWED_OUTBOX_STATUSES = new Set(Object.values(SYNC_OUTBOX_STATUSES));

function requireValue(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${fieldName} es requerido para crear una operación de sync.`);
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

export function normalizeOutboxStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (ALLOWED_OUTBOX_STATUSES.has(normalized)) return normalized;
  return LEGACY_PENDING_OP_STATUS_MAP[normalizeText(status).toUpperCase()] || normalized;
}

export function createIdempotencyKey({
  tenantId,
  deviceId,
  operationType,
  entityType,
  entityId,
  operationId,
} = {}) {
  requireValue(tenantId, 'tenantId');
  requireValue(deviceId, 'deviceId');
  requireValue(operationType, 'operationType');
  requireValue(entityType, 'entityType');
  requireValue(entityId || operationId, 'entityId u operationId');

  return [
    'sync',
    normalizeText(tenantId),
    normalizeText(deviceId),
    normalizeText(operationType),
    normalizeText(entityType),
    normalizeText(entityId || operationId),
  ].join(':');
}

export function createOutboxOperation({
  operationId,
  tenantId,
  userId,
  deviceId,
  entityType,
  entityId = operationId,
  operationType,
  payload = {},
  idempotencyKey = null,
  createdAt = new Date().toISOString(),
  attemptCount = 0,
  lastAttemptAt = null,
  status = SYNC_OUTBOX_STATUSES.PENDING,
  errorCode = null,
  errorMessage = null,
  dependencies = [],
  clientVersion = null,
} = {}) {
  requireValue(operationId, 'operationId');
  requireValue(tenantId, 'tenantId');
  requireValue(userId, 'userId');
  requireValue(deviceId, 'deviceId');
  requireValue(entityType, 'entityType');
  requireValue(operationType, 'operationType');

  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    throw new Error(`entityType no soportado para sync: ${entityType}.`);
  }
  if (!ALLOWED_OPERATION_TYPES.has(operationType)) {
    throw new Error(`operationType no soportado para sync: ${operationType}.`);
  }

  const normalizedStatus = normalizeOutboxStatus(status);
  if (!ALLOWED_OUTBOX_STATUSES.has(normalizedStatus)) {
    throw new Error(`status no soportado para sync: ${status}.`);
  }

  return {
    operation_id: operationId,
    tenant_id: tenantId,
    user_id: userId,
    device_id: deviceId,
    entity_type: entityType,
    entity_id: entityId || operationId,
    operation_type: operationType,
    payload,
    idempotency_key:
      idempotencyKey ||
      createIdempotencyKey({
        tenantId,
        deviceId,
        operationType,
        entityType,
        entityId: entityId || operationId,
        operationId,
      }),
    created_at: createdAt,
    attempt_count: Number(attemptCount || 0),
    last_attempt_at: lastAttemptAt,
    status: normalizedStatus,
    error_code: errorCode,
    error_message: errorMessage,
    dependencies: Array.isArray(dependencies) ? dependencies : [],
    client_version: clientVersion,
  };
}

export function isRetryableOutboxOperation(operation = {}) {
  const status = normalizeOutboxStatus(operation.status);
  if (
    [
      SYNC_OUTBOX_STATUSES.SYNCED,
      SYNC_OUTBOX_STATUSES.CONFLICT,
      SYNC_OUTBOX_STATUSES.DEAD_LETTER,
    ].includes(status)
  ) {
    return false;
  }

  const errorMessage = String(operation.error_message || operation.lastError || '');
  return !errorMessage.startsWith(NON_RETRYABLE_ERROR_PREFIX);
}

export function toLegacyPendingOp(operation = {}) {
  const normalized = createOutboxOperation({
    operationId: operation.operation_id || operation.opId,
    tenantId: operation.tenant_id || operation.tenantId,
    userId: operation.user_id || operation.userId,
    deviceId: operation.device_id || operation.deviceId,
    entityType: operation.entity_type || operation.entityType,
    entityId: operation.entity_id || operation.entityId || operation.operation_id || operation.opId,
    operationType: operation.operation_type || operation.operationType,
    payload: operation.payload || {},
    idempotencyKey: operation.idempotency_key || operation.idempotencyKey,
    createdAt: operation.created_at || operation.createdAt || new Date().toISOString(),
    attemptCount: operation.attempt_count ?? operation.retryCount ?? 0,
    lastAttemptAt: operation.last_attempt_at || operation.lastAttemptAt || null,
    status: operation.status || SYNC_OUTBOX_STATUSES.PENDING,
    errorCode: operation.error_code || operation.errorCode || null,
    errorMessage: operation.error_message || operation.lastError || null,
    dependencies: operation.dependencies || [],
    clientVersion: operation.client_version || operation.clientVersion || null,
  });

  return {
    opId: normalized.operation_id,
    opType: normalized.operation_type.toUpperCase(),
    tenantId: normalized.tenant_id,
    userId: normalized.user_id,
    deviceId: normalized.device_id,
    payload: {
      ...normalized.payload,
      sync: {
        entity_type: normalized.entity_type,
        entity_id: normalized.entity_id,
        idempotency_key: normalized.idempotency_key,
        dependencies: normalized.dependencies,
        client_version: normalized.client_version,
      },
    },
    status: LEGACY_PENDING_OP_STATUS_REVERSE_MAP[normalized.status],
    retryCount: normalized.attempt_count,
    lastError: normalized.error_message,
    createdAt: normalized.created_at,
    updatedAt: operation.updated_at || operation.updatedAt || normalized.created_at,
  };
}

export function fromLegacyPendingOp(op = {}) {
  const syncMeta = op.payload?.sync || {};
  const operationType = normalizeText(op.opType).toLowerCase();

  return createOutboxOperation({
    operationId: op.opId,
    tenantId: op.tenantId,
    userId: op.userId,
    deviceId: op.deviceId,
    entityType: syncMeta.entity_type || inferEntityTypeFromLegacyOpType(op.opType),
    entityId: syncMeta.entity_id || op.opId,
    operationType,
    payload: op.payload || {},
    idempotencyKey: syncMeta.idempotency_key || null,
    createdAt: op.createdAt,
    attemptCount: op.retryCount,
    status: normalizeOutboxStatus(op.status),
    errorMessage: op.lastError || null,
    dependencies: syncMeta.dependencies || [],
    clientVersion: syncMeta.client_version || null,
  });
}

export function inferEntityTypeFromLegacyOpType(opType) {
  switch (normalizeText(opType).toUpperCase()) {
    case 'CREATE_SALE':
      return SYNC_ENTITY_TYPES.SALE;
    default:
      return SYNC_ENTITY_TYPES.SALE;
  }
}
