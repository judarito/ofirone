export const GATEWAY_ERROR_CODES = Object.freeze({
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  DATA_ACCESS_ERROR: 'DATA_ACCESS_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

export function createCorrelationId(prefix = 'ofr') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}

export function createGatewayContext({
  correlationId = createCorrelationId(),
  domain = 'unknown',
  operation = 'unknown',
} = {}) {
  return { correlationId, domain, operation };
}

export function createGatewayError(
  message,
  {
    code = GATEWAY_ERROR_CODES.UNKNOWN_ERROR,
    domain = 'unknown',
    operation = 'unknown',
    correlationId = createCorrelationId(),
    retryable = false,
    status = null,
    details = null,
    cause = null,
  } = {}
) {
  const error = new Error(message || 'No fue posible completar la operación.');
  error.name = 'OfironeGatewayError';
  error.code = code;
  error.domain = domain;
  error.operation = operation;
  error.correlationId = correlationId;
  error.retryable = Boolean(retryable);
  error.status = status;
  error.details = details;
  if (cause) error.cause = cause;
  return error;
}

export function normalizeGatewayError(error, context = {}) {
  if (error?.name === 'OfironeGatewayError') return error;

  return createGatewayError(error?.message || String(error || ''), {
    code: context.code || GATEWAY_ERROR_CODES.UNKNOWN_ERROR,
    domain: context.domain,
    operation: context.operation,
    correlationId: context.correlationId,
    retryable: context.retryable,
    status: context.status || error?.status || null,
    details: context.details || error?.details || null,
    cause: error,
  });
}
