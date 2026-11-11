import {
  GATEWAY_ERROR_CODES,
  createGatewayError,
} from '../../../shared/contracts/gatewayErrors.js';

function assertAllowedFunction(functionName, allowedFunctions, context) {
  if (!allowedFunctions.includes(functionName)) {
    throw createGatewayError('Función no permitida por el gateway.', {
      code: GATEWAY_ERROR_CODES.FORBIDDEN,
      status: 403,
      ...context,
    });
  }
}

export async function invokeSupabaseEdgeFunction(functionName, body, {
  env,
  token,
  fetchImpl = fetch,
  correlationId,
  domain,
  operation,
  allowedFunctions,
} = {}) {
  assertAllowedFunction(functionName, allowedFunctions, { correlationId, domain, operation });

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw createGatewayError('Supabase no está configurado en el backend.', {
      code: GATEWAY_ERROR_CODES.BACKEND_UNAVAILABLE,
      domain,
      operation,
      correlationId,
      status: 500,
      retryable: true,
    });
  }

  const response = await fetchImpl(`${env.supabaseUrl.replace(/\/+$/, '')}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseAnonKey,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(body || {}),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    throw createGatewayError('La Edge Function respondió un payload inválido.', {
      code: GATEWAY_ERROR_CODES.INVALID_RESPONSE,
      domain,
      operation,
      correlationId,
      status: response.status,
      retryable: response.status >= 500,
      details: { raw: text.slice(0, 500) },
      cause: error,
    });
  }

  if (!response.ok) {
    throw createGatewayError(payload?.error || payload?.message || `Edge Function respondió ${response.status}.`, {
      code: response.status === 401 ? GATEWAY_ERROR_CODES.UNAUTHORIZED : GATEWAY_ERROR_CODES.BACKEND_UNAVAILABLE,
      domain,
      operation,
      correlationId,
      status: response.status,
      retryable: response.status >= 500,
      details: payload,
    });
  }

  return payload;
}
