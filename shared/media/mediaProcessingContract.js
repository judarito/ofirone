import {
  ASYNC_JOB_QUEUES,
  createAsyncJobPayload,
} from '../jobs/asyncJobContract.js';

export const MEDIA_JOB_TYPES = Object.freeze({
  PURCHASE_INVOICE_PHOTO: 'purchase_invoice_photo',
  PRODUCT_CATALOG_PHOTO: 'product_catalog_photo',
  PRICE_LIST_PHOTO: 'price_list_photo',
  PHYSICAL_INVENTORY_PHOTO: 'physical_inventory_photo',
  HANDWRITTEN_ORDER_PHOTO: 'handwritten_order_photo',
  SUPPORT_DOCUMENT_PHOTO: 'support_document_photo',
});

const ALLOWED_MEDIA_JOB_TYPES = new Set(Object.values(MEDIA_JOB_TYPES));

function assertMediaJobType(type) {
  if (!ALLOWED_MEDIA_JOB_TYPES.has(type)) {
    throw new Error(`Tipo de media job no soportado: ${type || '(vacío)'}.`);
  }
}

export function createMediaProcessingJobPayload({
  tenantId,
  type,
  fileKey,
  bucket = 'media-processing',
  mimeType = null,
  sizeBytes = null,
  context = {},
  dedupeKey = null,
  priority = 60,
  runAfter = null,
  maxAttempts = 3,
  source = 'web',
  correlationId = null,
} = {}) {
  assertMediaJobType(type);
  if (!fileKey) throw new Error('fileKey es requerido para crear un media processing job.');

  return createAsyncJobPayload({
    tenantId,
    queue: ASYNC_JOB_QUEUES.MEDIA_PROCESSING,
    type,
    payload: {
      bucket,
      file_key: fileKey,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      context,
    },
    dedupeKey: dedupeKey || `media-processing:${type}:${fileKey}`,
    priority,
    runAfter,
    maxAttempts,
    source,
    correlationId,
  });
}
