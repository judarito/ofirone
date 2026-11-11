import {
  GATEWAY_ERROR_CODES,
  createGatewayError,
} from '../../../shared/contracts/gatewayErrors.js';

function assertWorkerEnv(env) {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw createGatewayError('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY para ejecutar workers.', {
      code: GATEWAY_ERROR_CODES.BACKEND_UNAVAILABLE,
      domain: 'async_jobs',
      operation: 'assertWorkerEnv',
      retryable: true,
      status: 500,
    });
  }
}

async function rpc(functionName, body, {
  env,
  fetchImpl = fetch,
} = {}) {
  assertWorkerEnv(env);

  const response = await fetchImpl(`${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseServiceRoleKey,
      authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw createGatewayError(payload?.message || payload?.error || `RPC ${functionName} respondió ${response.status}.`, {
      code: GATEWAY_ERROR_CODES.DATA_ACCESS_ERROR,
      domain: 'async_jobs',
      operation: functionName,
      retryable: response.status >= 500,
      status: response.status,
      details: payload,
    });
  }

  return payload;
}

export function createAsyncJobsClient(deps) {
  return {
    claim(queue, { workerId, limit, lockSeconds = 300 } = {}) {
      return rpc('fn_claim_async_jobs', {
        p_queue: queue,
        p_worker_id: workerId,
        p_limit: limit,
        p_lock_seconds: lockSeconds,
      }, deps);
    },

    complete(jobId, { workerId, result = {}, completedWithWarnings = false } = {}) {
      return rpc('fn_complete_async_job', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_result: result,
        p_completed_with_warnings: completedWithWarnings,
      }, deps);
    },

    fail(jobId, { workerId, error = {}, retryable = true } = {}) {
      return rpc('fn_fail_async_job', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_error: error,
        p_retryable: retryable,
      }, deps);
    },
  };
}

