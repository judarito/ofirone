export function jsonResponse(payload, { status = 200, headers = {}, corsOrigin = '*' } = {}) {
  // 204/304 no pueden llevar cuerpo en la spec de Fetch/undici.
  const body = status === 204 || status === 304 ? null : JSON.stringify(payload);
  const resHeaders = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': corsOrigin,
    'access-control-allow-headers': 'authorization,content-type,x-correlation-id',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    ...headers,
  };
  // El cliente web usa fetch con credentials:'include': con un origen explícito
  // (p. ej. http://localhost:5173) hay que permitir credenciales y reflejar el
  // origen exacto. Con '*' (default) no se añaden credenciales (incompatible).
  if (corsOrigin && corsOrigin !== '*') {
    resHeaders['access-control-allow-credentials'] = 'true';
  }
  return new Response(body, { status, headers: resHeaders });
}

export function errorResponse(error, { corsOrigin = '*', correlationId = null } = {}) {
  const status = error?.status || 500;
  const body = {
    error: error?.message || 'No fue posible completar la operación.',
    code: error?.code || 'UNKNOWN_ERROR',
    correlationId: error?.correlationId || correlationId,
    // Estándar de errores del gateway (plan 18A.5): el cliente necesita saber
    // dominio/operación, si es reintentable y el status para decidir el retry.
    domain: error?.domain || 'unknown',
    operation: error?.operation || 'unknown',
    retryable: error?.retryable === true,
  };
  if (Number.isInteger(status)) body.status = status;
  if (error?.details != null) body.details = error.details;
  return jsonResponse(body, { status, corsOrigin });
}
