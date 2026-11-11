import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processProductCatalogPhotoJob } from './productCatalogPhotoProcessor.js';

const env = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'anon',
  supabaseServiceRoleKey: 'service-role',
  mediaMaxFileBytes: 1024 * 1024,
  productCatalogPhotoFunction: 'product-photo-parser',
  productCatalogPhotoModel: 'deepseek-chat',
  allowedImportFunctions: ['product-photo-parser'],
};

describe('product catalog photo processor', () => {
  it('descarga imagen, invoca parser y genera draft de productos', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/storage/v1/object/dataimport/tenant-1/media/product_catalog_photo/photo.jpg')) {
        return new Response(Buffer.from('fake-product-photo'));
      }

      if (String(url).endsWith('/functions/v1/product-photo-parser')) {
        return Response.json({
          products: [
            { product_name: 'Jean slim', unit_price: 99000, initial_stock: 8, confidence: 0.91 },
          ],
          warnings: ['texto borroso'],
          ocr_text: 'Jean slim 99000 8',
          model: 'deepseek-chat',
        });
      }

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await processProductCatalogPhotoJob({
      job_id: 'job-1',
      tenant_id: 'tenant-1',
      queue: 'media_processing',
      job_type: 'product_catalog_photo',
      payload: {
        bucket: 'dataimport',
        file_key: 'tenant-1/media/product_catalog_photo/photo.jpg',
        mime_type: 'image/jpeg',
      },
    }, { env, fetchImpl });

    assert.equal(result.phase, 'draft_ready');
    assert.equal(result.type, 'product_catalog_photo');
    assert.equal(result.draft.rows.length, 1);
    assert.equal(result.draft.rows[0].product_name, 'Jean slim');
    assert.equal(result.draft.warnings[0], 'texto borroso');
    const edgeCall = calls.find((call) => call.url.endsWith('/functions/v1/product-photo-parser'));
    assert.equal(edgeCall.body.image, Buffer.from('fake-product-photo').toString('base64'));
    assert.equal(edgeCall.body.mime_type, 'image/jpeg');
  });

  it('rechaza parser sin productos válidos', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('/storage/v1/object/dataimport/')) {
        return new Response(Buffer.from('fake-product-photo'));
      }
      return Response.json({ products: [] });
    };

    await assert.rejects(
      () => processProductCatalogPhotoJob({
        job_id: 'job-1',
        tenant_id: 'tenant-1',
        queue: 'media_processing',
        job_type: 'product_catalog_photo',
        payload: {
          bucket: 'dataimport',
          file_key: 'tenant-1/media/product_catalog_photo/photo.jpg',
          mime_type: 'image/jpeg',
        },
      }, { env, fetchImpl }),
      /no se detectaron productos/,
    );
  });
});
