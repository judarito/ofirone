import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processJob, runWorkerOnce } from './asyncJobWorker.js';
import { createAsyncJobsClient } from './asyncJobsClient.js';

const env = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'anon',
  supabaseServiceRoleKey: 'service-role',
  workerId: 'worker-test',
  workerQueues: ['import_jobs', 'ai_jobs'],
  workerBatchSize: 2,
  mediaMaxFileBytes: 1024 * 1024,
  purchaseInvoiceOcrFunction: 'deepseek-ocr-proxy',
  purchaseInvoiceTextModel: 'deepseek-chat',
  allowedImportFunctions: ['deepseek-ocr-proxy'],
};

describe('async job worker', () => {
  it('procesa un job exitoso y lo completa', async () => {
    const calls = [];
    const client = {
      complete: async (jobId, payload) => calls.push(['complete', jobId, payload]),
      fail: async (jobId, payload) => calls.push(['fail', jobId, payload]),
    };

    const result = await processJob(
      { job_id: 'job-1', queue: 'import_jobs', job_type: 'noop' },
      { client, workerId: 'worker-test' }
    );

    assert.equal(result.status, 'completed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'complete');
  });

  it('falla un job con error normalizado', async () => {
    const calls = [];
    const client = {
      complete: async (jobId, payload) => calls.push(['complete', jobId, payload]),
      fail: async (jobId, payload) => calls.push(['fail', jobId, payload]),
    };

    const result = await processJob(
      { job_id: 'job-1', queue: 'import_jobs', job_type: 'unknown' },
      { client, workerId: 'worker-test' }
    );

    assert.equal(result.status, 'failed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'fail');
    assert.equal(calls[0][2].retryable, true);
    assert.match(calls[0][2].error.message, /Handler de importación pendiente/);
  });

  it('bulk_import_process valida payload antes de procesar', async () => {
    const calls = [];
    const client = {
      complete: async (jobId, payload) => calls.push(['complete', jobId, payload]),
      fail: async (jobId, payload) => calls.push(['fail', jobId, payload]),
    };

    const result = await processJob(
      { job_id: 'job-1', queue: 'import_jobs', job_type: 'bulk_import_process' },
      { client, workerId: 'worker-test' }
    );

    assert.equal(result.status, 'failed');
    assert.match(calls[0][2].error.message, /payload.import_id/);
  });

  it('reclama jobs por cola y usa RPCs de completar', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push([String(url), body]);
      if (String(url).endsWith('/rpc/fn_claim_async_jobs')) {
        if (body.p_queue === 'import_jobs') {
          return Response.json([{ job_id: 'job-1', queue: 'import_jobs', job_type: 'noop' }]);
        }
        return Response.json([]);
      }
      return Response.json(null);
    };

    const summary = await runWorkerOnce({ env, fetchImpl });

    assert.equal(summary.claimed, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.failed, 0);
    assert.ok(calls.some(([url]) => url.endsWith('/rpc/fn_complete_async_job')));
  });

  it('cliente RPC exige service role', async () => {
    const client = createAsyncJobsClient({
      env: { supabaseUrl: 'https://test.supabase.co', supabaseServiceRoleKey: '' },
      fetchImpl: async () => Response.json([]),
    });

    await assert.rejects(
      () => client.claim('import_jobs', { workerId: 'worker-test', limit: 1 }),
      /SUPABASE_SERVICE_ROLE_KEY/
    );
  });

  it('procesa media_processing purchase_invoice_photo y completa draft', async () => {
    const calls = [];
    const client = {
      complete: async (jobId, payload) => calls.push(['complete', jobId, payload]),
      fail: async (jobId, payload) => calls.push(['fail', jobId, payload]),
    };
    const fetchImpl = async (url) => {
      if (
        String(url).includes(
          '/storage/v1/object/dataimport/tenant-1/media/purchase_invoice_photo/photo.jpg'
        )
      ) {
        return new Response(Buffer.from('fake-image'));
      }
      if (String(url).endsWith('/functions/v1/deepseek-ocr-proxy')) {
        return Response.json({
          content: JSON.stringify({
            invoice: { vendor_name: 'Proveedor Demo' },
            line_items: [{ raw_name: 'Producto factura', quantity: 1 }],
          }),
        });
      }
      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await processJob(
      {
        job_id: 'job-media-1',
        tenant_id: 'tenant-1',
        queue: 'media_processing',
        job_type: 'purchase_invoice_photo',
        payload: {
          bucket: 'dataimport',
          file_key: 'tenant-1/media/purchase_invoice_photo/photo.jpg',
          mime_type: 'image/jpeg',
        },
      },
      {
        client,
        workerId: 'worker-test',
        handlerDeps: { env, fetchImpl },
      }
    );

    assert.equal(result.status, 'completed');
    assert.equal(calls[0][0], 'complete');
    assert.equal(calls[0][2].result.phase, 'draft_ready');
    assert.equal(calls[0][2].result.draft.line_items[0].raw_name, 'Producto factura');
  });

  it('procesa media_processing product_catalog_photo y completa draft', async () => {
    const calls = [];
    const client = {
      complete: async (jobId, payload) => calls.push(['complete', jobId, payload]),
      fail: async (jobId, payload) => calls.push(['fail', jobId, payload]),
    };
    const fetchImpl = async (url) => {
      if (
        String(url).includes(
          '/storage/v1/object/dataimport/tenant-1/media/product_catalog_photo/photo.jpg'
        )
      ) {
        return new Response(Buffer.from('fake-product-photo'));
      }
      if (String(url).endsWith('/functions/v1/product-photo-parser')) {
        return Response.json({
          products: [{ product_name: 'Jean slim', unit_price: 99000 }],
        });
      }
      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await processJob(
      {
        job_id: 'job-media-2',
        tenant_id: 'tenant-1',
        queue: 'media_processing',
        job_type: 'product_catalog_photo',
        payload: {
          bucket: 'dataimport',
          file_key: 'tenant-1/media/product_catalog_photo/photo.jpg',
          mime_type: 'image/jpeg',
        },
      },
      {
        client,
        workerId: 'worker-test',
        handlerDeps: {
          env: {
            ...env,
            productCatalogPhotoFunction: 'product-photo-parser',
            productCatalogPhotoModel: 'deepseek-chat',
            allowedImportFunctions: ['deepseek-ocr-proxy', 'product-photo-parser'],
          },
          fetchImpl,
        },
      }
    );

    assert.equal(result.status, 'completed');
    assert.equal(calls[0][0], 'complete');
    assert.equal(calls[0][2].result.phase, 'draft_ready');
    assert.equal(calls[0][2].result.draft.rows[0].product_name, 'Jean slim');
  });

  it('falla rápido (no retryable) un job ai_jobs sin handler', async () => {
    const calls = [];
    const client = {
      complete: async (jobId, payload) => calls.push(['complete', jobId, payload]),
      fail: async (jobId, payload) => calls.push(['fail', jobId, payload]),
    };

    const result = await processJob(
      { job_id: 'job-ai-1', queue: 'ai_jobs', job_type: 'deep_insight' },
      { client, workerId: 'worker-test' }
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.code, 'AI_HANDLER_NOT_IMPLEMENTED');
    assert.equal(calls[0][2].retryable, false);
  });

  it('falla rápido (no retryable) un media job sin procesador', async () => {
    const calls = [];
    const client = {
      complete: async (jobId, payload) => calls.push(['complete', jobId, payload]),
      fail: async (jobId, payload) => calls.push(['fail', jobId, payload]),
    };

    const result = await processJob(
      { job_id: 'job-media-x', queue: 'media_processing', job_type: 'handwritten_order_photo' },
      { client, workerId: 'worker-test' }
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.code, 'MEDIA_HANDLER_NOT_IMPLEMENTED');
  });
});
