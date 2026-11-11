import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeRequest } from './app.js';

const env = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'anon',
  corsOrigin: '*',
  allowedAiFunctions: ['deepseek-proxy'],
  allowedImportFunctions: ['product-photo-parser'],
};

describe('backend gateway app', () => {
  it('responde healthcheck', async () => {
    const response = await routeRequest(new Request('http://localhost/health'), { env });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ofirone-backend-gateway');
    assert.ok(body.correlationId);
    assert.ok(response.headers.get('x-correlation-id'));
    assert.ok(response.headers.get('x-response-time-ms'));
  });

  it('rechaza lookups sin JWT', async () => {
    const response = await routeRequest(new Request('http://localhost/lookups/document-types'), {
      env,
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, 'UNAUTHORIZED');
    assert.ok(response.headers.get('x-response-time-ms'));
  });

  it('valida JWT y responde lookups desde Supabase REST', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json([{ code: 'CC', label: 'Cédula' }]);
    };
    const request = new Request('http://localhost/lookups/document-types', {
      headers: { authorization: 'Bearer user-token', 'x-correlation-id': 'corr-1' },
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, [{ code: 'CC', label: 'Cédula' }]);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].endsWith('/auth/v1/user'));
    assert.ok(calls[1].includes('/rest/v1/document_types'));
  });

  it('invoca AiGateway con función permitida', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    };
    const request = new Request('http://localhost/ai/functions/deepseek-proxy', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] }),
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.choices[0].message.content, 'ok');
    assert.ok(calls[1].endsWith('/functions/v1/deepseek-proxy'));
  });

  it('bloquea AiGateway con función fuera de allowlist', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json({});
    };
    const request = new Request('http://localhost/ai/functions/not-allowed', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, 'FORBIDDEN');
  });

  it('invoca ImportGateway con función permitida', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json({ rows: [{ name: 'Producto' }] });
    };
    const request = new Request('http://localhost/imports/functions/product-photo-parser', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'base64' }),
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.rows[0].name, 'Producto');
    assert.ok(calls[1].endsWith('/functions/v1/product-photo-parser'));
  });

  it('responde backlog de jobs usando RLS del usuario', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json([
        { job_id: 'job-1', queue: 'import_jobs', status: 'pending' },
        { job_id: 'job-2', queue: 'import_jobs', status: 'waiting_retry' },
        { job_id: 'job-3', queue: 'ai_jobs', status: 'completed' },
      ]);
    };
    const request = new Request('http://localhost/async-jobs/backlog?limit=50', {
      headers: { authorization: 'Bearer user-token' },
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.summary.total, 3);
    assert.equal(body.summary.byStatus.pending, 1);
    assert.equal(body.summary.byQueue.import_jobs.total, 2);
    assert.ok(calls[1].includes('/rest/v1/async_jobs'));
  });

  it('responde historial de cargues filtrando jobs de importación y media', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json([
        {
          job_id: 'job-1',
          queue: 'import_jobs',
          job_type: 'bulk_import_process',
          status: 'completed',
        },
        {
          job_id: 'job-2',
          queue: 'media_processing',
          job_type: 'product_catalog_photo',
          status: 'processing',
        },
      ]);
    };
    const request = new Request(
      'http://localhost/async-jobs/history?queues=import_jobs,media_processing&limit=20',
      {
        headers: { authorization: 'Bearer user-token' },
      }
    );

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.summary.total, 2);
    assert.equal(body.summary.byQueue.import_jobs.total, 1);
    assert.equal(body.summary.byQueue.media_processing.total, 1);
    assert.ok(calls[1].includes('/rest/v1/async_jobs'));
    assert.ok(calls[1].includes('queue=in.(import_jobs,media_processing)'));
    assert.ok(calls[1].includes('result'));
    assert.ok(calls[1].includes('payload'));
  });

  it('encola async job con JWT del usuario', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push([String(url), options.body ? JSON.parse(options.body) : null]);
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json('job-123');
    };
    const request = new Request('http://localhost/async-jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant-1',
        queue: 'import_jobs',
        job_type: 'bulk_import_process',
        payload: { import_id: 'import-1' },
        dedupe_key: 'bulk-import:import-1',
      }),
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.job_id, 'job-123');
    assert.ok(calls[1][0].endsWith('/rest/v1/rpc/fn_enqueue_async_job'));
    assert.equal(calls[1][1].p_queue, 'import_jobs');
    assert.equal(calls[1][1].p_job_type, 'bulk_import_process');
  });

  it('encola media processing job con contrato controlado', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push([String(url), options.body ? JSON.parse(options.body) : null]);
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json('media-job-1');
    };
    const request = new Request('http://localhost/media-processing/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant-1',
        type: 'purchase_invoice_photo',
        file_key: 'tenant-1/invoices/photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1234,
        context: { purchase_id: 'purchase-1' },
      }),
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.job_id, 'media-job-1');
    assert.ok(calls[1][0].endsWith('/rest/v1/rpc/fn_enqueue_async_job'));
    assert.equal(calls[1][1].p_queue, 'media_processing');
    assert.equal(calls[1][1].p_job_type, 'purchase_invoice_photo');
    assert.equal(calls[1][1].p_payload.file_key, 'tenant-1/invoices/photo.jpg');
    assert.equal(calls[1][1].p_payload.context.purchase_id, 'purchase-1');
    assert.equal(
      calls[1][1].p_dedupe_key,
      'media-processing:purchase_invoice_photo:tenant-1/invoices/photo.jpg'
    );
  });

  it('devuelve el estándar de error completo (domain/operation/retryable/status)', async () => {
    const response = await routeRequest(new Request('http://localhost/lookups/document-types'), {
      env,
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, 'UNAUTHORIZED');
    assert.ok(body.correlationId);
    assert.equal(typeof body.domain, 'string');
    assert.equal(typeof body.operation, 'string');
    assert.equal(body.retryable, false);
    assert.equal(body.status, 401);
  });

  it('aplica rate limiting por cliente y responde 429 con retry-after', async () => {
    const { createRateLimiter } = await import('./rateLimit.js');
    const rateLimiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    const request = () =>
      new Request('http://localhost/lookups/document-types', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });

    const first = await routeRequest(request(), { env, rateLimiter });
    const second = await routeRequest(request(), { env, rateLimiter });
    const third = await routeRequest(request(), { env, rateLimiter });

    assert.ok([401, 200].includes(first.status));
    assert.ok([401, 200].includes(second.status));
    assert.equal(third.status, 429);
    const body = await third.json();
    assert.equal(body.code, 'RATE_LIMITED');
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
  });

  it('rechaza cuerpos que exceden el límite configurado', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json('job-123');
    };
    const smallEnv = { ...env, maxBodyBytes: 32 };
    const request = new Request('http://localhost/async-jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: 'tenant-1', queue: 'import_jobs', job_type: 'x' }),
    });

    const response = await routeRequest(request, { env: smallEnv, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.equal(body.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(body.retryable, false);
  });

  it('rechaza JSON inválido con error normalizado', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json('job-123');
    };
    const request = new Request('http://localhost/async-jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: 'esto no es json',
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(body.domain, 'http');
  });

  it('lista clientes paginado con count y búsqueda', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json([
        { third_party_id: 'tp-1', legal_name: 'Cliente A', document_number: '1' },
        { third_party_id: 'tp-2', legal_name: 'Cliente B', document_number: '2' },
      ]);
    };
    const request = new Request('http://localhost/customers?page=1&page_size=10&search=cliente', {
      headers: { authorization: 'Bearer user-token' },
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.length, 2);
    const restCall = calls.find((url) => url.includes('/rest/v1/third_parties'));
    assert.ok(restCall.includes('or=(legal_name.ilike.%25cliente%25'));
    assert.ok(restCall.includes('order=legal_name.asc'));
  });

  it('lista stock balances con count desde content-range y filtro de sede', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push([String(url), options.headers || {}]);
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json([{ variant_id: 'v-1', on_hand: 5, reserved: 1 }], {
        headers: { 'content-range': '0-0/1' },
      });
    };
    const request = new Request(
      'http://localhost/inventory/stock-balances?page_size=20&location_id=loc-1',
      { headers: { authorization: 'Bearer user-token' } }
    );

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.total, 1);
    assert.equal(body.data[0].variant_id, 'v-1');
    const [restUrl, restHeaders] = calls.find(([url]) => url.includes('/rest/v1/stock_balances'));
    assert.ok(restUrl.includes('location_id=eq.loc-1'));
    assert.equal(restHeaders.prefer, 'count=exact');
    assert.equal(restHeaders['range-unit'], 'items');
  });

  it('responde el preflight CORS (OPTIONS) con 204 sin cuerpo y no crashea', async () => {
    const corsEnv = { ...env, corsOrigin: 'http://localhost:5173' };
    const request = new Request('http://localhost/lookups/document-types', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });

    const response = await routeRequest(request, { env: corsEnv });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.ok(response.headers.get('access-control-allow-headers'));
  });

  it('lista ventas paginado (RLS) desde la tabla sales', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push([String(url), options.headers || {}]);
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json(
        [{ sale_id: 's-1', total: 1200, created_at: '2026-08-01T00:00:00.000Z' }],
        {
          headers: { 'content-range': '0-0/1' },
        }
      );
    };
    const request = new Request('http://localhost/sales?page=1&page_size=10', {
      headers: { authorization: 'Bearer user-token' },
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.total, 1);
    assert.equal(body.data[0].sale_id, 's-1');
    const [url, headers] = calls.find(([u]) => u.includes('/rest/v1/sales'));
    assert.ok(url.includes('order=created_at.desc'));
    assert.equal(headers.prefer, 'count=exact');
    assert.equal(headers['range-unit'], 'items');
  });

  it('lista compras paginado (RLS) desde la tabla purchases', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push([String(url), options.headers || {}]);
      if (String(url).endsWith('/auth/v1/user')) {
        return Response.json({ id: 'user-1' });
      }
      return Response.json(
        [{ purchase_id: 'p-1', total: 500, created_at: '2026-08-01T00:00:00.000Z' }],
        {
          headers: { 'content-range': '0-0/1' },
        }
      );
    };
    const request = new Request('http://localhost/purchases?page=1&page_size=10', {
      headers: { authorization: 'Bearer user-token' },
    });

    const response = await routeRequest(request, { env, fetchImpl });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.total, 1);
    assert.equal(body.data[0].purchase_id, 'p-1');
    const [url] = calls.find(([u]) => u.includes('/rest/v1/purchases'));
    assert.ok(url.includes('order=created_at.desc'));
  });
});
