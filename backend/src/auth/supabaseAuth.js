import {
  GATEWAY_ERROR_CODES,
  createGatewayError,
} from '../../../shared/contracts/gatewayErrors.js';

export function getBearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

export async function requireSupabaseUser(request, {
  env,
  fetchImpl = fetch,
  correlationId,
} = {}) {
  const token = getBearerToken(request);
  if (!token) {
    throw createGatewayError('Sesión requerida.', {
      code: GATEWAY_ERROR_CODES.UNAUTHORIZED,
      domain: 'auth',
      operation: 'requireSupabaseUser',
      correlationId,
      status: 401,
    });
  }

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw createGatewayError('Supabase no está configurado en el backend.', {
      code: GATEWAY_ERROR_CODES.BACKEND_UNAVAILABLE,
      domain: 'auth',
      operation: 'requireSupabaseUser',
      correlationId,
      status: 500,
      retryable: true,
    });
  }

  const response = await fetchImpl(`${env.supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: {
      apikey: env.supabaseAnonKey,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw createGatewayError('Sesión inválida o expirada.', {
      code: GATEWAY_ERROR_CODES.UNAUTHORIZED,
      domain: 'auth',
      operation: 'requireSupabaseUser',
      correlationId,
      status: 401,
    });
  }

  return response.json();
}

