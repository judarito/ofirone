import {
  GATEWAY_ERROR_CODES,
  createGatewayError,
} from '../../../shared/contracts/gatewayErrors.js';

export async function supabaseRpc(functionName, body, {
  env,
  token,
  fetchImpl = fetch,
  correlationId,
  domain,
  operation,
} = {}) {
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

  const response = await fetchImpl(`${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${functionName}`, {
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
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw createGatewayError(payload?.message || payload?.error || `RPC ${functionName} respondió ${response.status}.`, {
      code: GATEWAY_ERROR_CODES.DATA_ACCESS_ERROR,
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

