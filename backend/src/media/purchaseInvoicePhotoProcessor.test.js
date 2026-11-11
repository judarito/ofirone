import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processPurchaseInvoicePhotoJob } from './purchaseInvoicePhotoProcessor.js';

const env = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'anon',
  supabaseServiceRoleKey: 'service-role',
  mediaMaxFileBytes: 1024 * 1024,
  purchaseInvoiceOcrFunction: 'deepseek-ocr-proxy',
  purchaseInvoiceTextModel: 'deepseek-chat',
  allowedImportFunctions: ['deepseek-ocr-proxy'],
};

describe('purchase invoice photo processor', () => {
  it('descarga imagen, invoca OCR y genera draft revisable', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/storage/v1/object/dataimport/tenant-1/media/purchase_invoice_photo/photo.jpg')) {
        return new Response(Buffer.from('fake-image'));
      }

      if (String(url).endsWith('/functions/v1/deepseek-ocr-proxy')) {
        return Response.json({
          content: JSON.stringify({
            invoice: {
              vendor_name: 'Proveedor Demo',
              invoice_number: 'FAC-1',
              total: 100000,
            },
            line_items: [
              { raw_name: 'Camisa azul M', quantity: 2, unit_price: 50000 },
            ],
          }),
          ocr_text: 'Camisa azul M 2 50000',
          model: 'deepseek-chat',
        });
      }

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await processPurchaseInvoicePhotoJob({
      job_id: 'job-1',
      tenant_id: 'tenant-1',
      queue: 'media_processing',
      job_type: 'purchase_invoice_photo',
      payload: {
        bucket: 'dataimport',
        file_key: 'tenant-1/media/purchase_invoice_photo/photo.jpg',
        mime_type: 'image/jpeg',
      },
    }, { env, fetchImpl });

    assert.equal(result.phase, 'draft_ready');
    assert.equal(result.type, 'purchase_invoice_photo');
    assert.equal(result.draft.invoice.vendor_name, 'Proveedor Demo');
    assert.equal(result.draft.line_items.length, 1);
    assert.equal(result.draft.line_items[0].quantity, 2);
    const edgeCall = calls.find((call) => call.url.endsWith('/functions/v1/deepseek-ocr-proxy'));
    assert.equal(edgeCall.body.mime_type, 'image/jpeg');
    assert.equal(edgeCall.body.image, Buffer.from('fake-image').toString('base64'));
  });

  it('rechaza respuestas de OCR sin line_items', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('/storage/v1/object/dataimport/')) {
        return new Response(Buffer.from('fake-image'));
      }
      return Response.json({ content: '{"invoice":{}}' });
    };

    await assert.rejects(
      () => processPurchaseInvoicePhotoJob({
        job_id: 'job-1',
        tenant_id: 'tenant-1',
        queue: 'media_processing',
        job_type: 'purchase_invoice_photo',
        payload: {
          bucket: 'dataimport',
          file_key: 'tenant-1/media/purchase_invoice_photo/photo.jpg',
          mime_type: 'image/jpeg',
        },
      }, { env, fetchImpl }),
      /No se pudo parsear/,
    );
  });
});
