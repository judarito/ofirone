import { createAsyncJobsClient } from './asyncJobsClient.js';
import { handleAsyncJob } from './jobHandlers.js';

function toJobError(error) {
  return {
    message: error?.message || String(error || 'Error desconocido.'),
    code: error?.code || 'JOB_HANDLER_ERROR',
    retryable: error?.retryable !== false,
  };
}

export async function processJob(job, {
  client,
  workerId,
  handler = handleAsyncJob,
  handlerDeps = {},
  logger = null,
} = {}) {
  try {
    const result = await handler(job, handlerDeps);
    await client.complete(job.job_id, { workerId, result });
    logger?.info?.(`job completed ${job.job_id} ${job.queue}/${job.job_type}`);
    return { jobId: job.job_id, status: 'completed' };
  } catch (error) {
    const jobError = toJobError(error);
    await client.fail(job.job_id, {
      workerId,
      error: jobError,
      retryable: jobError.retryable,
    });
    logger?.error?.(`job failed ${job.job_id} ${job.queue}/${job.job_type}: ${jobError.message}`);
    return { jobId: job.job_id, status: 'failed', error: jobError };
  }
}

export async function runWorkerOnce({
  env,
  fetchImpl = fetch,
  handler = handleAsyncJob,
  logger = null,
} = {}) {
  const client = createAsyncJobsClient({ env, fetchImpl });
  const workerId = env.workerId;
  const queues = env.workerQueues || [];
  const limit = env.workerBatchSize || 5;
  const summary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    byQueue: {},
  };

  for (const queue of queues) {
    const jobs = await client.claim(queue, { workerId, limit });
    summary.claimed += jobs.length;
    summary.byQueue[queue] = { claimed: jobs.length, completed: 0, failed: 0 };

    for (const job of jobs) {
      const result = await processJob(job, {
        client,
        workerId,
        handler,
        handlerDeps: { env, fetchImpl },
        logger,
      });
      summary[result.status] += 1;
      summary.byQueue[queue][result.status] += 1;
    }
  }

  return summary;
}

export async function runWorkerLoop({
  env,
  fetchImpl = fetch,
  handler = handleAsyncJob,
  logger = console,
  shouldContinue = () => true,
  maxConsecutiveErrors = 0, // 0 = reintenta indefinidamente (transitorios)
} = {}) {
  let consecutiveErrors = 0;
  while (shouldContinue()) {
    try {
      const summary = await runWorkerOnce({ env, fetchImpl, handler, logger });
      consecutiveErrors = 0;
      logger?.info?.(`worker tick ${JSON.stringify(summary)}`);
    } catch (error) {
      consecutiveErrors += 1;
      logger?.error?.(
        `worker tick falló (${consecutiveErrors} seguidos): ${
          error?.message || String(error)
        }`
      );
      if (maxConsecutiveErrors > 0 && consecutiveErrors >= maxConsecutiveErrors) {
        logger?.error?.('Demasiados errores consecutivos; deteniendo worker.');
        break;
      }
    }
    await new Promise((resolve) => {
      setTimeout(resolve, env.workerPollMs || 5000);
    });
  }
}
