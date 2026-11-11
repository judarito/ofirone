import {
  createCorrelationId,
  createGatewayError,
} from '../../../shared/contracts/gatewayErrors.js';
import { requireSupabaseUser, getBearerToken } from '../auth/supabaseAuth.js';
import { getEnv } from '../config/env.js';
import { createAiGateway } from '../gateways/ai.gateway.js';
import { createImportGateway } from '../gateways/import.gateway.js';
import { createAsyncJobsRepository } from '../repositories/asyncJobs.repository.js';
import { createCustomersRepository } from '../repositories/customers.repository.js';
import { createInventoryRepository } from '../repositories/inventory.repository.js';
import { createLookupsRepository } from '../repositories/lookups.repository.js';
import { createMediaProcessingRepository } from '../repositories/mediaProcessing.repository.js';
import { createPurchasesRepository } from '../repositories/purchases.repository.js';
import { createSalesRepository } from '../repositories/sales.repository.js';
import { errorResponse, jsonResponse } from './respond.js';
import { createRateLimiter } from './rateLimit.js';

function getCorrelationId(request) {
  return request.headers.get('x-correlation-id') || createCorrelationId();
}

function resolveClientKey(request) {
  // Cloudflare expone la IP real en cf-connecting-ip; los proxies suelen
  // ponerla en x-forwarded-for.
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('cf-connecting-ip') || 'anonymous';
}

const envLimiters = new WeakMap();

function resolveLimiter(env, deps) {
  if (deps?.rateLimiter) return deps.rateLimiter;
  let limiter = envLimiters.get(env);
  if (!limiter) {
    limiter = createRateLimiter({
      max: env.rateLimitMax,
      windowMs: env.rateLimitWindowMs,
    });
    envLimiters.set(env, limiter);
  }
  return limiter;
}

async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const raw = await request.text();
  if (!raw) return {};
  // Compatible Node/Workers: sin Buffer (Cloudflare no lo expone por defecto).
  const byteLength = new TextEncoder().encode(raw).length;
  if (byteLength > maxBytes) {
    throw createGatewayError('El cuerpo de la solicitud excede el tamaño permitido.', {
      code: 'PAYLOAD_TOO_LARGE',
      domain: 'http',
      operation: 'read_body',
      retryable: false,
      status: 413,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    throw createGatewayError('El cuerpo de la solicitud no es JSON válido.', {
      code: 'VALIDATION_ERROR',
      domain: 'http',
      operation: 'parse_body',
      retryable: false,
      status: 400,
    });
  }
}

export async function routeRequest(request, deps = {}) {
  const env = deps.env || getEnv();
  const fetchImpl = deps.fetchImpl || fetch;
  const logger = deps.logger || null;
  const url = new URL(request.url);
  const correlationId = getCorrelationId(request);
  const startedAt = Date.now();

  const finish = (response, error = null) => {
    const durationMs = Date.now() - startedAt;
    response.headers.set('x-correlation-id', correlationId);
    response.headers.set('x-response-time-ms', String(durationMs));
    if (logger?.info) {
      logger.info(
        JSON.stringify({
          type: 'gateway_request',
          method: request.method,
          path: url.pathname,
          status: response.status,
          durationMs,
          correlationId,
          errorCode: error?.code || null,
        })
      );
    }
    return response;
  };

  if (request.method === 'OPTIONS') {
    return finish(jsonResponse({}, { status: 204, corsOrigin: env.corsOrigin }));
  }

  try {
    const isHealth = request.method === 'GET' && url.pathname === '/health';
    if (!isHealth && request.method !== 'OPTIONS') {
      const decision = resolveLimiter(env, deps).allow(resolveClientKey(request));
      if (!decision.allowed) {
        const limited = errorResponse(
          createGatewayError('Demasiadas solicitudes. Intenta de nuevo más tarde.', {
            code: 'RATE_LIMITED',
            domain: 'gateway',
            operation: 'rate_limit',
            retryable: false,
            status: 429,
            correlationId,
          }),
          { corsOrigin: env.corsOrigin, correlationId }
        );
        limited.headers.set(
          'retry-after',
          String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000)))
        );
        return finish(limited, null);
      }
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return finish(
        jsonResponse(
          {
            status: 'ok',
            service: 'ofirone-backend-gateway',
            correlationId,
          },
          { corsOrigin: env.corsOrigin }
        )
      );
    }

    if (request.method === 'GET' && url.pathname.startsWith('/lookups/')) {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createLookupsRepository({ env, token, fetchImpl, correlationId });

      if (url.pathname === '/lookups/document-types') {
        return finish(
          jsonResponse(await repository.listDocumentTypes(), { corsOrigin: env.corsOrigin })
        );
      }

      if (url.pathname === '/lookups/departments') {
        return finish(
          jsonResponse(await repository.listDepartments(), { corsOrigin: env.corsOrigin })
        );
      }

      if (url.pathname === '/lookups/cities') {
        return finish(
          jsonResponse(await repository.listCities(url.searchParams.get('department_id')), {
            corsOrigin: env.corsOrigin,
          })
        );
      }
    }

    if (request.method === 'GET' && url.pathname === '/sales') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createSalesRepository({ env, token, fetchImpl, correlationId });
      const result = await repository.listSales({
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('page_size') || url.searchParams.get('pageSize') || 20,
      });
      return finish(jsonResponse(result, { corsOrigin: env.corsOrigin }));
    }

    if (request.method === 'GET' && url.pathname === '/purchases') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createPurchasesRepository({ env, token, fetchImpl, correlationId });
      const result = await repository.listPurchases({
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('page_size') || url.searchParams.get('pageSize') || 20,
      });
      return finish(jsonResponse(result, { corsOrigin: env.corsOrigin }));
    }

    if (request.method === 'GET' && url.pathname === '/customers') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createCustomersRepository({ env, token, fetchImpl, correlationId });
      const result = await repository.listCustomers({
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('page_size') || url.searchParams.get('pageSize') || 20,
        search: url.searchParams.get('search') || '',
      });
      return finish(jsonResponse(result, { corsOrigin: env.corsOrigin }));
    }

    if (request.method === 'GET' && url.pathname === '/inventory/stock-balances') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createInventoryRepository({ env, token, fetchImpl, correlationId });
      const result = await repository.listStockBalances({
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('page_size') || url.searchParams.get('pageSize') || 20,
        locationId: url.searchParams.get('location_id') || null,
        variantId: url.searchParams.get('variant_id') || null,
        lowStock: url.searchParams.get('low_stock') || null,
      });
      return finish(jsonResponse(result, { corsOrigin: env.corsOrigin }));
    }

    if (request.method === 'GET' && url.pathname === '/async-jobs/backlog') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createAsyncJobsRepository({ env, token, fetchImpl, correlationId });
      return finish(
        jsonResponse(
          await repository.getBacklog({
            limit: url.searchParams.get('limit') || 500,
          }),
          { corsOrigin: env.corsOrigin }
        )
      );
    }

    if (request.method === 'GET' && url.pathname === '/async-jobs/history') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createAsyncJobsRepository({ env, token, fetchImpl, correlationId });
      return finish(
        jsonResponse(
          await repository.getHistory({
            limit: url.searchParams.get('limit') || 100,
            queues: url.searchParams.get('queues') || '',
          }),
          { corsOrigin: env.corsOrigin }
        )
      );
    }

    if (request.method === 'POST' && url.pathname === '/async-jobs') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createAsyncJobsRepository({ env, token, fetchImpl, correlationId });
      const body = await readJsonBody(request, env.maxBodyBytes);
      return finish(
        jsonResponse(
          await repository.enqueue({
            tenantId: body.tenant_id,
            queue: body.queue,
            jobType: body.job_type,
            payload: body.payload || {},
            dedupeKey: body.dedupe_key || null,
            priority: body.priority || 100,
            runAfter: body.run_after || null,
            maxAttempts: body.max_attempts || 3,
            source: body.source || 'backend',
            correlationId,
          }),
          { status: 202, corsOrigin: env.corsOrigin }
        )
      );
    }

    if (request.method === 'POST' && url.pathname === '/media-processing/jobs') {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const token = getBearerToken(request);
      const repository = createMediaProcessingRepository({ env, token, fetchImpl, correlationId });
      const body = await readJsonBody(request, env.maxBodyBytes);
      return finish(
        jsonResponse(
          await repository.enqueueMediaJob({
            tenantId: body.tenant_id,
            type: body.type,
            fileKey: body.file_key,
            bucket: body.bucket,
            mimeType: body.mime_type,
            sizeBytes: body.size_bytes,
            context: body.context || {},
            dedupeKey: body.dedupe_key || null,
            priority: body.priority || 60,
            runAfter: body.run_after || null,
            maxAttempts: body.max_attempts || 3,
            source: body.source || 'web',
          }),
          { status: 202, corsOrigin: env.corsOrigin }
        )
      );
    }

    if (request.method === 'POST' && url.pathname.startsWith('/ai/functions/')) {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const functionName = decodeURIComponent(url.pathname.replace('/ai/functions/', ''));
      const token = getBearerToken(request);
      const gateway = createAiGateway({ env, token, fetchImpl, correlationId });
      return finish(
        jsonResponse(
          await gateway.invokeFunction(functionName, await readJsonBody(request, env.maxBodyBytes)),
          { corsOrigin: env.corsOrigin }
        )
      );
    }

    if (request.method === 'POST' && url.pathname.startsWith('/imports/functions/')) {
      await requireSupabaseUser(request, { env, fetchImpl, correlationId });
      const functionName = decodeURIComponent(url.pathname.replace('/imports/functions/', ''));
      const token = getBearerToken(request);
      const gateway = createImportGateway({ env, token, fetchImpl, correlationId });
      return finish(
        jsonResponse(
          await gateway.invokeFunction(functionName, await readJsonBody(request, env.maxBodyBytes)),
          { corsOrigin: env.corsOrigin }
        )
      );
    }

    return finish(
      jsonResponse(
        {
          error: 'Ruta no encontrada.',
          code: 'NOT_FOUND',
          correlationId,
        },
        { status: 404, corsOrigin: env.corsOrigin }
      )
    );
  } catch (error) {
    return finish(errorResponse(error, { corsOrigin: env.corsOrigin, correlationId }), error);
  }
}
