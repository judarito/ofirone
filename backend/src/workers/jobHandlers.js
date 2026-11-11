import { processBulkImportJob } from '../imports/bulkImportProcessor.js';
import { handleMediaProcessingJob } from '../media/mediaJobHandlers.js';

export async function handleAsyncJob(job, deps = {}) {
  if (job.job_type === 'noop') {
    return {
      handled: true,
      message: 'noop completado',
      queue: job.queue,
      job_type: job.job_type,
    };
  }

  if (job.queue === 'ai_jobs') {
    const error = new Error(`Handler AI aún no implementado para job_type=${job.job_type}.`);
    error.code = 'AI_HANDLER_NOT_IMPLEMENTED';
    error.retryable = false;
    throw error;
  }

  if (job.queue === 'import_jobs') {
    if (
      job.job_type === 'bulk_import_process' ||
      job.job_type === 'bulk_import_apply_products' ||
      job.job_type === 'bulk_import_apply_third_parties'
    ) {
      return processBulkImportJob(job, deps);
    }
    throw new Error(`Handler de importación pendiente para job_type=${job.job_type}.`);
  }

  if (job.queue === 'media_processing') {
    return handleMediaProcessingJob(job, deps);
  }

  if (job.queue === 'report_jobs') {
    const error = new Error(
      `Handler de reportes aún no implementado para job_type=${job.job_type}.`
    );
    error.code = 'REPORT_HANDLER_NOT_IMPLEMENTED';
    error.retryable = false;
    throw error;
  }

  throw new Error(`Queue no soportada por este worker: ${job.queue}.`);
}
