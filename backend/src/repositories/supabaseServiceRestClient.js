import {
  GATEWAY_ERROR_CODES,
  createGatewayError,
} from '../../../shared/contracts/gatewayErrors.js';

function assertServiceEnv(env, operation) {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw createGatewayError('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.', {
      code: GATEWAY_ERROR_CODES.BACKEND_UNAVAILABLE,
      domain: 'supabase_service',
      operation,
      status: 500,
      retryable: true,
    });
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function serviceRestRequest(path, {
  env,
  fetchImpl = fetch,
  method = 'GET',
  body,
  operation = 'serviceRestRequest',
  prefer = null,
} = {}) {
  assertServiceEnv(env, operation);

  const headers = {
    apikey: env.supabaseServiceRoleKey,
    authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;

  const response = await fetchImpl(`${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw createGatewayError(payload?.message || payload?.error || `Supabase REST respondió ${response.status}.`, {
      code: GATEWAY_ERROR_CODES.DATA_ACCESS_ERROR,
      domain: 'supabase_service',
      operation,
      status: response.status,
      retryable: response.status >= 500,
      details: payload,
    });
  }

  return payload;
}

export async function downloadStorageObject(bucket, fileKey, {
  env,
  fetchImpl = fetch,
  operation = 'downloadStorageObject',
} = {}) {
  assertServiceEnv(env, operation);

  const encodedKey = String(fileKey || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const response = await fetchImpl(`${env.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`, {
    headers: {
      apikey: env.supabaseServiceRoleKey,
      authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
  });

  if (!response.ok) {
    throw createGatewayError(`No se pudo descargar archivo de Storage (${response.status}).`, {
      code: GATEWAY_ERROR_CODES.DATA_ACCESS_ERROR,
      domain: 'supabase_storage',
      operation,
      status: response.status,
      retryable: response.status >= 500,
    });
  }

  return Buffer.from(await response.arrayBuffer());
}

