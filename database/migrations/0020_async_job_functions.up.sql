-- 0020_async_job_functions.up.sql
-- Slice H (autorizado): N18/N19 claim/complete con tenant, lease e idempotencia.
-- Sin BEGIN/COMMIT. Requiere 0012 (async_jobs).
create or replace function public.fn_claim_async_jobs(
    p_job_type text,
    p_worker_id text,
    p_limit integer default 10,
    p_lease_seconds integer default 300
)
returns setof public.async_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
    v_tenant uuid := app_private.current_tenant_id();
    v_limit integer := greatest(least(coalesce(p_limit, 10), 100), 1);
    v_lease integer := greatest(coalesce(p_lease_seconds, 300), 30);
begin
    if v_tenant is null then
        raise exception 'app.tenant_id is required to claim jobs'
            using errcode = '42501';
    end if;

    if p_worker_id is null or btrim(p_worker_id) = '' then
        raise exception 'worker_id is required'
            using errcode = '22023';
    end if;

    if p_job_type is not null and btrim(p_job_type) = '' then
        raise exception 'job_type must be null or non-empty'
            using errcode = '22023';
    end if;

    return query
    with candidates as (
        select j.job_id
        from public.async_jobs j
        where j.tenant_id = v_tenant
          and (p_job_type is null or j.job_type = p_job_type)
          and j.attempts < j.max_attempts
          and (
                (j.status = 'queued' and j.available_at <= clock_timestamp())
                or
                (j.status = 'running'
                 and j.locked_at is not null
                 and j.locked_at < clock_timestamp() - make_interval(secs => v_lease))
              )
        order by j.priority asc, j.available_at asc, j.created_at asc, j.job_id asc
        limit v_limit
        for update skip locked
    )
    update public.async_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           locked_at = clock_timestamp(),
           locked_by = p_worker_id,
           updated_at = clock_timestamp()
      from candidates c
     where j.job_id = c.job_id
       and j.tenant_id = v_tenant
    returning j.*;
end;
$$;

comment on function public.fn_claim_async_jobs(text, text, integer, integer) is
    'PROPUESTA N18. Claim por tenant con FOR UPDATE SKIP LOCKED y lease en '
    'locked_at. Falla 42501 sin app.tenant_id. No reclamar jobs de otro tenant.';

create or replace function public.fn_complete_async_job(
    p_job_id uuid,
    p_worker_id text,
    p_lease_seconds integer default 300
)
returns public.async_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
    v_tenant uuid := app_private.current_tenant_id();
    v_job public.async_jobs%rowtype;
    v_lease integer := greatest(coalesce(p_lease_seconds, 300), 30);
begin
    if v_tenant is null then
        raise exception 'app.tenant_id is required to complete jobs'
            using errcode = '42501';
    end if;

    if p_worker_id is null or btrim(p_worker_id) = '' then
        raise exception 'worker_id is required'
            using errcode = '22023';
    end if;

    select *
      into v_job
      from public.async_jobs j
     where j.job_id = p_job_id
       and j.tenant_id = v_tenant
     for update;

    if not found then
        raise exception 'job % is not visible for the current tenant', p_job_id
            using errcode = '42501';
    end if;

    -- Idempotencia: repetir complete con el mismo worker devuelve el job ya
    -- terminado sin volver a escribirlo ni fallar.
    if v_job.status = 'succeeded' and v_job.locked_by = p_worker_id then
        return v_job;
    end if;

    if v_job.status <> 'running'
       or v_job.locked_by is distinct from p_worker_id
       or v_job.locked_at is null
       or v_job.locked_at < clock_timestamp() - make_interval(secs => v_lease) then
        raise exception 'job % is not leased by worker % or the lease expired',
            p_job_id, p_worker_id
            using errcode = '42501';
    end if;

    update public.async_jobs
       set status = 'succeeded',
           completed_at = clock_timestamp(),
           last_error = null,
           locked_at = clock_timestamp(),
           locked_by = p_worker_id,
           updated_at = clock_timestamp()
     where job_id = p_job_id
       and tenant_id = v_tenant
    returning * into v_job;

    return v_job;
end;
$$;

comment on function public.fn_complete_async_job(uuid, text, integer) is
    'PROPUESTA N19. Complete solo si tenant, worker y lease coinciden; '
    'idempotente para el mismo worker. Falla 42501 en caso contrario. '
    'No persiste p_result: 0001–0012 no tiene async_jobs.result.';

-- FIRMA LEGACY PARA CUANDO EXISTA `async_jobs.result` (no ejecutar ahora):
--   fn_complete_async_job(
--       p_job_id uuid,
--       p_worker_id text,
--       p_result jsonb default '{}'::jsonb,
--       p_lease_seconds integer default 300
--   ) returns public.async_jobs
--   ... set result = coalesce(p_result, '{}'::jsonb) ...
-- Mientras no exista la columna, el resultado operativo va a `audit_log` o a Go.

revoke all on function public.fn_claim_async_jobs(text, text, integer, integer) from public;
revoke all on function public.fn_complete_async_job(uuid, text, integer) from public;

-- Endurecimiento pendiente: crear el rol worker NOLOGIN y asignar owner/grants.
-- alter function public.fn_claim_async_jobs(text, text, integer, integer) owner to ofirone_worker;
-- alter function public.fn_complete_async_job(uuid, text, integer) owner to ofirone_worker;
-- grant execute on function public.fn_claim_async_jobs(text, text, integer, integer) to ofirone_worker;
-- grant execute on function public.fn_complete_async_job(uuid, text, integer) to ofirone_worker;


-- =============================================================================
