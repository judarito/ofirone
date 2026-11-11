import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEDIA_JOB_TYPES,
  createMediaProcessingJobPayload,
} from './mediaProcessingContract.js';

describe('media processing contract', () => {
  it('crea payload estándar sobre async_jobs para una foto de factura', () => {
    const job = createMediaProcessingJobPayload({
      tenantId: 'tenant-1',
      type: MEDIA_JOB_TYPES.PURCHASE_INVOICE_PHOTO,
      fileKey: 'tenant-1/invoices/photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      correlationId: 'corr-1',
    });

    assert.equal(job.tenant_id, 'tenant-1');
    assert.equal(job.queue, 'media_processing');
    assert.equal(job.job_type, 'purchase_invoice_photo');
    assert.equal(job.dedupe_key, 'media-processing:purchase_invoice_photo:tenant-1/invoices/photo.jpg');
    assert.equal(job.payload.bucket, 'media-processing');
    assert.equal(job.payload.file_key, 'tenant-1/invoices/photo.jpg');
    assert.equal(job.payload.mime_type, 'image/jpeg');
    assert.equal(job.payload.size_bytes, 1234);
    assert.equal(job.correlation_id, 'corr-1');
  });

  it('rechaza tipos no soportados', () => {
    assert.throws(
      () => createMediaProcessingJobPayload({
        tenantId: 'tenant-1',
        type: 'unknown',
        fileKey: 'file.jpg',
      }),
      /no soportado/,
    );
  });
});
