import { MEDIA_JOB_TYPES } from '../../../shared/media/mediaProcessingContract.js';
import { processProductCatalogPhotoJob } from './productCatalogPhotoProcessor.js';
import { processPurchaseInvoicePhotoJob } from './purchaseInvoicePhotoProcessor.js';

export async function handleMediaProcessingJob(job, deps = {}) {
  if (job.job_type === MEDIA_JOB_TYPES.PURCHASE_INVOICE_PHOTO) {
    return processPurchaseInvoicePhotoJob(job, deps);
  }

  if (job.job_type === MEDIA_JOB_TYPES.PRODUCT_CATALOG_PHOTO) {
    return processProductCatalogPhotoJob(job, deps);
  }

  // Tipos de media sin procesador: fallan rápido y sin reintentos (evita
  // jobs que agotan intentos hasta dead-letter). Se elimina cuando se
  // implemente cada procesador (ver hoja de ruta, Núcleo A4).
  const error = new Error(`Handler de media aún no implementado para job_type=${job.job_type}.`);
  error.code = 'MEDIA_HANDLER_NOT_IMPLEMENTED';
  error.retryable = false;
  throw error;
}
