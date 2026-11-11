import { createMediaProcessingJobPayload } from '../../../shared/media/mediaProcessingContract.js';
import { createAsyncJobsRepository } from './asyncJobs.repository.js';

export function createMediaProcessingRepository(deps) {
  const asyncJobs = createAsyncJobsRepository(deps);

  return {
    async enqueueMediaJob({
      tenantId,
      type,
      fileKey,
      bucket,
      mimeType,
      sizeBytes,
      context,
      dedupeKey,
      priority,
      runAfter,
      maxAttempts,
      source,
    } = {}) {
      const job = createMediaProcessingJobPayload({
        tenantId,
        type,
        fileKey,
        bucket,
        mimeType,
        sizeBytes,
        context,
        dedupeKey,
        priority,
        runAfter,
        maxAttempts,
        source,
        correlationId: deps.correlationId,
      });

      return asyncJobs.enqueue({
        tenantId: job.tenant_id,
        queue: job.queue,
        jobType: job.job_type,
        payload: job.payload,
        dedupeKey: job.dedupe_key,
        priority: job.priority,
        runAfter: job.run_after,
        maxAttempts: job.max_attempts,
        source: job.source,
        correlationId: job.correlation_id,
      });
    },
  };
}
