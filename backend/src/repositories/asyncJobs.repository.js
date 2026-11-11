import { supabaseRestGet } from './supabaseRestClient.js';
import { supabaseRpc } from './supabaseRpcClient.js';

function summarizeJobs(rows = []) {
  return rows.reduce((summary, job) => {
    const queue = job.queue || 'unknown';
    const status = job.status || 'unknown';
    summary.total += 1;
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
    summary.byQueue[queue] ||= { total: 0, byStatus: {} };
    summary.byQueue[queue].total += 1;
    summary.byQueue[queue].byStatus[status] = (summary.byQueue[queue].byStatus[status] || 0) + 1;
    return summary;
  }, { total: 0, byStatus: {}, byQueue: {} });
}

function normalizeQueueList(queues) {
  if (!queues) return [];
  const source = Array.isArray(queues) ? queues : String(queues).split(',');
  return source
    .map((queue) => String(queue || '').trim())
    .filter(Boolean);
}

export function createAsyncJobsRepository(deps) {
  return {
    async enqueue({
      tenantId,
      queue,
      jobType,
      payload = {},
      dedupeKey = null,
      priority = 100,
      runAfter = null,
      maxAttempts = 3,
      source = 'backend',
      correlationId = deps.correlationId,
    } = {}) {
      const jobId = await supabaseRpc('fn_enqueue_async_job', {
        p_tenant_id: tenantId,
        p_queue: queue,
        p_job_type: jobType,
        p_payload: payload,
        p_dedupe_key: dedupeKey,
        p_priority: priority,
        p_run_after: runAfter,
        p_max_attempts: maxAttempts,
        p_source: source,
        p_correlation_id: correlationId,
      }, {
        ...deps,
        domain: 'async_jobs',
        operation: 'enqueue',
      });

      return { job_id: jobId };
    },

    async getBacklog({ limit = 500 } = {}) {
      const rows = await supabaseRestGet(
        `/async_jobs?select=job_id,queue,job_type,status,attempts,max_attempts,run_after,created_at,updated_at,error,correlation_id&order=created_at.desc&limit=${Number(limit) || 500}`,
        {
          ...deps,
          domain: 'async_jobs',
          operation: 'getBacklog',
        },
      );

      return {
        summary: summarizeJobs(rows),
        jobs: rows,
      };
    },

    async getHistory({ limit = 100, queues = [] } = {}) {
      const normalizedQueues = normalizeQueueList(queues);
      const queueFilter = normalizedQueues.length
        ? `&queue=in.(${normalizedQueues.map(encodeURIComponent).join(',')})`
        : '';
      const rows = await supabaseRestGet(
        `/async_jobs?select=job_id,queue,job_type,status,attempts,max_attempts,run_after,created_at,updated_at,started_at,completed_at,failed_at,error,result,payload,correlation_id&order=created_at.desc&limit=${Number(limit) || 100}${queueFilter}`,
        {
          ...deps,
          domain: 'async_jobs',
          operation: 'getHistory',
        },
      );

      return {
        summary: summarizeJobs(rows),
        jobs: rows,
      };
    },
  };
}
