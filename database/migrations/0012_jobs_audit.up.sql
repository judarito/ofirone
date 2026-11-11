-- Portable operational jobs and tenant audit trail.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.async_jobs (
    job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    job_type text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'queued',
    priority integer NOT NULL DEFAULT 100,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    locked_at timestamptz,
    locked_by text,
    last_error text,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, job_id),
    UNIQUE (tenant_id, job_type, idempotency_key),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    CONSTRAINT async_jobs_type_valid CHECK (length(btrim(job_type)) BETWEEN 1 AND 100),
    CONSTRAINT async_jobs_key_valid CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
    CONSTRAINT async_jobs_status_valid CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT async_jobs_priority_valid CHECK (priority BETWEEN 0 AND 1000),
    CONSTRAINT async_jobs_attempts_valid CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 100),
    CONSTRAINT async_jobs_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX async_jobs_claim_idx ON public.async_jobs
    (status, priority, available_at, created_at, job_id)
    WHERE status = 'queued';
CREATE INDEX async_jobs_tenant_page_idx ON public.async_jobs
    (tenant_id, created_at DESC, job_id DESC);
CREATE TRIGGER async_jobs_updated_at BEFORE UPDATE ON public.async_jobs
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.audit_log (
    audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    actor_identity_id uuid,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    request_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, audit_id),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_identity_id) REFERENCES public.identities (identity_id) ON DELETE SET NULL,
    CONSTRAINT audit_action_valid CHECK (length(btrim(action)) BETWEEN 1 AND 100),
    CONSTRAINT audit_resource_valid CHECK (length(btrim(resource_type)) BETWEEN 1 AND 100),
    CONSTRAINT audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_log_page_idx ON public.audit_log
    (tenant_id, created_at DESC, audit_id DESC);
CREATE INDEX audit_log_resource_idx ON public.audit_log
    (tenant_id, resource_type, resource_id, created_at DESC, audit_id DESC);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['async_jobs', 'audit_log'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (tenant_id = app_private.current_tenant_id()) WITH CHECK (tenant_id = app_private.current_tenant_id())',
            table_name
        );
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', table_name);
    END LOOP;
END;
$$;
