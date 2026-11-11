import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { utils, write } from 'xlsx';
import { processBulkImportJob } from './bulkImportProcessor.js';

function workbookBuffer(sheetName, rows) {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.json_to_sheet(rows), sheetName);
  return write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('bulk import processor', () => {
  it('genera preview y errores sin aplicar productos aun', async () => {
    const xlsxBuffer = workbookBuffer('productos', [
      { product_name: 'Camisa', unit_price: 45000 },
      { product_name: '', unit_price: 30000 },
    ]);
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/rest/v1/bulk_imports?select=*')) {
        return Response.json([{
          import_id: 'import-1',
          tenant_id: 'tenant-1',
          import_type: 'product_variants',
          file_key: 'tenant-1/productos.xlsx',
          file_name: 'productos.xlsx',
          status: 'pending',
        }]);
      }

      if (String(url).includes('/storage/v1/object/dataimport/tenant-1/productos.xlsx')) {
        return new Response(xlsxBuffer);
      }

      if (String(url).includes('/rest/v1/bulk_import_errors') && options.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      if (String(url).endsWith('/rest/v1/bulk_import_errors') && options.method === 'POST') {
        return Response.json(body);
      }

      if (String(url).includes('/rest/v1/bulk_imports?import_id=eq.import-1') && options.method === 'PATCH') {
        return Response.json([body]);
      }

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await processBulkImportJob(
      {
        job_id: 'job-1',
        tenant_id: 'tenant-1',
        queue: 'import_jobs',
        job_type: 'bulk_import_process',
        payload: { import_id: 'import-1' },
      },
      {
        env: {
          supabaseUrl: 'https://test.supabase.co',
          supabaseServiceRoleKey: 'service-role',
        },
        fetchImpl,
      },
    );

    assert.equal(result.phase, 'preview_ready');
    assert.equal(result.validRows, 1);
    assert.equal(result.invalidRows, 1);
    assert.ok(calls.some((call) => call.url.includes('/storage/v1/object/dataimport/tenant-1/productos.xlsx')));
    const finalPatch = calls.filter((call) => call.method === 'PATCH').at(-1);
    assert.equal(finalPatch.body.status, 'completed');
    assert.equal(finalPatch.body.processed_count, 0);
    assert.equal(finalPatch.body.error_count, 1);
    assert.equal(finalPatch.body.summary.phase, 'preview_ready');
  });

  it('aplica terceros por lotes desde worker', async () => {
    const xlsxBuffer = workbookBuffer('terceros', [
      { legal_name: 'Proveedor Demo', document_number: '900123', type: 'proveedor' },
      { legal_name: '', document_number: '123' },
    ]);
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/rest/v1/bulk_imports?select=*')) {
        return Response.json([{
          import_id: 'import-2',
          tenant_id: 'tenant-1',
          import_type: 'third_parties',
          file_key: 'tenant-1/terceros.xlsx',
          file_name: 'terceros.xlsx',
          status: 'completed',
        }]);
      }

      if (String(url).includes('/storage/v1/object/dataimport/tenant-1/terceros.xlsx')) {
        return new Response(xlsxBuffer);
      }

      if (String(url).includes('/rest/v1/third_parties?select=third_party_id')) {
        return Response.json([]);
      }

      if (String(url).endsWith('/rest/v1/rpc/fn_upsert_third_party')) {
        return Response.json({ third_party_id: 'tp-1' });
      }

      if (String(url).includes('/rest/v1/bulk_import_errors') && options.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      if (String(url).endsWith('/rest/v1/bulk_import_errors') && options.method === 'POST') {
        return Response.json(body);
      }

      if (String(url).includes('/rest/v1/bulk_imports?import_id=eq.import-2') && options.method === 'PATCH') {
        return Response.json([body]);
      }

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await processBulkImportJob(
      {
        job_id: 'job-2',
        tenant_id: 'tenant-1',
        queue: 'import_jobs',
        job_type: 'bulk_import_apply_third_parties',
        payload: { import_id: 'import-2' },
      },
      {
        env: {
          supabaseUrl: 'https://test.supabase.co',
          supabaseServiceRoleKey: 'service-role',
        },
        fetchImpl,
      },
    );

    assert.equal(result.phase, 'imported');
    assert.equal(result.processed, 1);
    assert.equal(result.errors, 1);
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/rpc/fn_upsert_third_party')));
    const finalPatch = calls.filter((call) => call.method === 'PATCH').at(-1);
    assert.equal(finalPatch.body.status, 'completed');
    assert.equal(finalPatch.body.processed_count, 1);
    assert.equal(finalPatch.body.error_count, 1);
  });
});
