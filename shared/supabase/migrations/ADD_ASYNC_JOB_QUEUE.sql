/*
  ADD_ASYNC_JOB_QUEUE.sql

  Cola genérica para procesos asíncronos: sync, IA, importaciones, media,
  reportes pesados, webhooks y trabajos de backend.

  No reemplaza inmediatamente colas existentes como notification_outbox o
  accounting_event_queue; sirve como contrato común para nuevos workers y para
  migraciones graduales.
*/

CREATE TABLE IF NOT EXISTS async_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  queue TEXT NOT NULL CHECK (queue IN (
    'sync_outbox',
    'notification_outbox',
    'accounting_events',
    'billing_jobs',
    'payment_webhooks',
    'ai_jobs',
    'import_jobs',
    'media_processing',
    'report_jobs'
  )),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing',
    'waiting_retry',
    'completed',
    'completed_with_warnings',
    'failed',
    'dead_letter',
    'cancelled'
  )),
  priority INTEGER NOT NULL DEFAULT 100,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  error JSONB,
  dedupe_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  lock_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  dead_letter_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'backend' CHECK (source IN ('web', 'mobile', 'backend', 'worker', 'system', 'sync')),
  correlation_id TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_async_jobs_dedupe
  ON async_jobs(tenant_id, queue, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status NOT IN ('cancelled', 'dead_letter');

CREATE INDEX IF NOT EXISTS ix_async_jobs_claim
  ON async_jobs(queue, status, run_after, priority, created_at)
  WHERE status IN ('pending', 'waiting_retry');

CREATE INDEX IF NOT EXISTS ix_async_jobs_tenant_created
  ON async_jobs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_async_jobs_correlation
  ON async_jobs(correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS async_job_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES async_jobs(job_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  worker_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'completed_with_warnings', 'failed', 'dead_letter')),
  error JSONB,
  result JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_async_job_attempts_job
  ON async_job_attempts(job_id, attempt_number DESC);

ALTER TABLE async_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE async_job_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS async_jobs_tenant_select ON async_jobs;
CREATE POLICY async_jobs_tenant_select
ON async_jobs FOR SELECT
TO authenticated
USING (tenant_id = get_current_user_tenant_id());

DROP POLICY IF EXISTS async_jobs_tenant_insert ON async_jobs;
CREATE POLICY async_jobs_tenant_insert
ON async_jobs FOR INSERT
TO authenticated
WITH CHECK (tenant_id = get_current_user_tenant_id());

DROP POLICY IF EXISTS async_job_attempts_tenant_select ON async_job_attempts;
CREATE POLICY async_job_attempts_tenant_select
ON async_job_attempts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM async_jobs j
    WHERE j.job_id = async_job_attempts.job_id
      AND j.tenant_id = get_current_user_tenant_id()
  )
);

GRANT SELECT, INSERT ON async_jobs TO authenticated;
GRANT SELECT ON async_job_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON async_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON async_job_attempts TO service_role;

CREATE OR REPLACE FUNCTION fn_async_jobs_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_async_jobs_updated_at ON async_jobs;
CREATE TRIGGER trg_async_jobs_updated_at
BEFORE UPDATE ON async_jobs
FOR EACH ROW
EXECUTE FUNCTION fn_async_jobs_touch_updated_at();

CREATE OR REPLACE FUNCTION fn_enqueue_async_job(
  p_tenant_id UUID,
  p_queue TEXT,
  p_job_type TEXT,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_dedupe_key TEXT DEFAULT NULL,
  p_priority INTEGER DEFAULT 100,
  p_run_after TIMESTAMPTZ DEFAULT NOW(),
  p_max_attempts INTEGER DEFAULT 3,
  p_source TEXT DEFAULT 'backend',
  p_correlation_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_job_id UUID;
  v_job_id UUID;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id es requerido para encolar jobs.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_queue, '')), '') IS NULL THEN
    RAISE EXCEPTION 'queue es requerido para encolar jobs.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_job_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'job_type es requerido para encolar jobs.';
  END IF;

  IF p_dedupe_key IS NOT NULL THEN
    SELECT job_id
    INTO v_existing_job_id
    FROM async_jobs
    WHERE tenant_id = p_tenant_id
      AND queue = p_queue
      AND dedupe_key = p_dedupe_key
      AND status NOT IN ('cancelled', 'dead_letter')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_job_id IS NOT NULL THEN
      RETURN v_existing_job_id;
    END IF;
  END IF;

  INSERT INTO async_jobs (
    tenant_id,
    queue,
    job_type,
    payload,
    dedupe_key,
    priority,
    run_after,
    max_attempts,
    source,
    correlation_id,
    created_by
  )
  VALUES (
    p_tenant_id,
    p_queue,
    p_job_type,
    COALESCE(p_payload, '{}'::JSONB),
    p_dedupe_key,
    COALESCE(p_priority, 100),
    COALESCE(p_run_after, NOW()),
    GREATEST(COALESCE(p_max_attempts, 3), 1),
    COALESCE(NULLIF(TRIM(p_source), ''), 'backend'),
    p_correlation_id,
    auth.uid()
  )
  RETURNING job_id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_claim_async_jobs(
  p_queue TEXT,
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lock_seconds INTEGER DEFAULT 300
) RETURNS SETOF async_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT job_id
    FROM async_jobs
    WHERE queue = p_queue
      AND status IN ('pending', 'waiting_retry')
      AND run_after <= NOW()
      AND (lock_expires_at IS NULL OR lock_expires_at < NOW())
      AND attempts < max_attempts
    ORDER BY priority ASC, run_after ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
  ),
  claimed AS (
    UPDATE async_jobs j
    SET
      status = 'processing',
      attempts = attempts + 1,
      locked_at = NOW(),
      locked_by = COALESCE(NULLIF(TRIM(p_worker_id), ''), 'worker'),
      lock_expires_at = NOW() + make_interval(secs => GREATEST(COALESCE(p_lock_seconds, 300), 30)),
      started_at = COALESCE(started_at, NOW())
    FROM candidates c
    WHERE j.job_id = c.job_id
    RETURNING j.*
  )
  SELECT * FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION fn_complete_async_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_result JSONB DEFAULT '{}'::JSONB,
  p_completed_with_warnings BOOLEAN DEFAULT FALSE
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_job async_jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM async_jobs
  WHERE job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job no encontrado.';
  END IF;

  UPDATE async_jobs
  SET
    status = CASE WHEN p_completed_with_warnings THEN 'completed_with_warnings' ELSE 'completed' END,
    result = COALESCE(p_result, '{}'::JSONB),
    completed_at = NOW(),
    locked_at = NULL,
    locked_by = NULL,
    lock_expires_at = NULL
  WHERE job_id = p_job_id;

  INSERT INTO async_job_attempts (
    job_id,
    attempt_number,
    worker_id,
    status,
    result,
    started_at,
    finished_at,
    duration_ms
  )
  VALUES (
    p_job_id,
    v_job.attempts,
    p_worker_id,
    CASE WHEN p_completed_with_warnings THEN 'completed_with_warnings' ELSE 'completed' END,
    COALESCE(p_result, '{}'::JSONB),
    COALESCE(v_job.locked_at, v_job.started_at, NOW()),
    NOW(),
    GREATEST((EXTRACT(EPOCH FROM (NOW() - COALESCE(v_job.locked_at, v_job.started_at, NOW()))) * 1000)::INTEGER, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_fail_async_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error JSONB DEFAULT '{}'::JSONB,
  p_retryable BOOLEAN DEFAULT TRUE
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_job async_jobs%ROWTYPE;
  v_next_status TEXT;
  v_next_run_after TIMESTAMPTZ;
BEGIN
  SELECT *
  INTO v_job
  FROM async_jobs
  WHERE job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job no encontrado.';
  END IF;

  IF p_retryable AND v_job.attempts < v_job.max_attempts THEN
    v_next_status := 'waiting_retry';
    v_next_run_after := NOW() + make_interval(secs => LEAST(POWER(2, GREATEST(v_job.attempts - 1, 0))::INTEGER * 30, 3600));
  ELSIF p_retryable THEN
    v_next_status := 'dead_letter';
    v_next_run_after := NOW();
  ELSE
    v_next_status := 'failed';
    v_next_run_after := NOW();
  END IF;

  UPDATE async_jobs
  SET
    status = v_next_status,
    error = COALESCE(p_error, '{}'::JSONB),
    run_after = v_next_run_after,
    failed_at = NOW(),
    dead_letter_at = CASE WHEN v_next_status = 'dead_letter' THEN NOW() ELSE dead_letter_at END,
    locked_at = NULL,
    locked_by = NULL,
    lock_expires_at = NULL
  WHERE job_id = p_job_id;

  INSERT INTO async_job_attempts (
    job_id,
    attempt_number,
    worker_id,
    status,
    error,
    started_at,
    finished_at,
    duration_ms
  )
  VALUES (
    p_job_id,
    v_job.attempts,
    p_worker_id,
    CASE WHEN v_next_status = 'waiting_retry' THEN 'failed' ELSE v_next_status END,
    COALESCE(p_error, '{}'::JSONB),
    COALESCE(v_job.locked_at, v_job.started_at, NOW()),
    NOW(),
    GREATEST((EXTRACT(EPOCH FROM (NOW() - COALESCE(v_job.locked_at, v_job.started_at, NOW()))) * 1000)::INTEGER, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_enqueue_async_job(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, TIMESTAMPTZ, INTEGER, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_claim_async_jobs(TEXT, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION fn_complete_async_job(UUID, TEXT, JSONB, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION fn_fail_async_job(UUID, TEXT, JSONB, BOOLEAN) TO service_role;
