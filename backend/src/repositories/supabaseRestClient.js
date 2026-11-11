import {
  GATEWAY_ERROR_CODES,
  createGatewayError,
} from '../../../shared/contracts/gatewayErrors.js';

export async function supabaseRestGet(
  path,
  { env, token, fetchImpl = fetch, correlationId, domain, operation } = {}
) {
  const response = await restFetch(path, {
    env,
    token,
    fetchImpl,
    correlationId,
    domain,
    operation,
  });
  return response.json();
}

// Igual que supabaseRestGet pero pidiendo `count=exact` (Prefer) y devolviendo
// { data, total } desde el header Content-Range (ej. "0-24/123").
export async function supabaseRestGetPaged(
  path,
  {
    env,
    token,
    fetchImpl = fetch,
    correlationId,
    domain,
    operation,
    range = null, // { from, to } para paginación
  } = {}
) {
  const response = await restFetch(path, {
    env,
    token,
    fetchImpl,
    correlationId,
    domain,
    operation,
    preferCount: true,
    range,
  });

  const contentRange = response.headers.get('content-range') || '';
  const match = contentRange.match(/\/(\d+)$/);
  const total = match ? Number(match[1]) : null;

  return { data: await response.json(), total };
}

async function restFetch(
  path,
  {
    env,
    token,
    fetchImpl = fetch,
    correlationId,
    domain,
    operation,
    preferCount = false,
    range = null,
  }
) {
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

  const headers = {
    apikey: env.supabaseAnonKey,
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'x-correlation-id': correlationId,
  };
  if (preferCount) headers.prefer = 'count=exact';
  if (range && Number.isInteger(range.from) && Number.isInteger(range.to)) {
    headers['range-unit'] = 'items';
    headers.range = `${range.from}-${range.to}`;
  }

  const response = await fetchImpl(`${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1${path}`, {
    headers,
  });

  if (!response.ok) {
    throw createGatewayError(`Supabase REST respondió ${response.status}.`, {
      code:
        response.status === 404
          ? GATEWAY_ERROR_CODES.NOT_FOUND
          : GATEWAY_ERROR_CODES.DATA_ACCESS_ERROR,
      domain,
      operation,
      correlationId,
      status: response.status,
      retryable: response.status >= 500,
    });
  }

  return response;
}
