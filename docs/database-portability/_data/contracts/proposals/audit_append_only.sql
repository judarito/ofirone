-- ============================================================================
-- PROPUESTA — NO EJECUTAR COMO MIGRACIÓN REAL (ADR-010)
-- Auditoría append-only: bloquea UPDATE/DELETE sobre audit_log.
-- Base 0001–0012; PostgreSQL 15+. Sin credenciales.
-- ============================================================================

create function app_private.audit_log_append_only() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    raise exception 'audit_log es append-only: % no permitido', tg_op
        using errcode = '23514';
end;
$$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
before update or delete on public.audit_log
for each row execute function app_private.audit_log_append_only();

-- Endurecimiento de privilegios (aplicar al rol de runtime, no al migrador):
-- revoke update, delete, truncate on public.audit_log from ofirone_api;
-- grant select, insert on public.audit_log to ofirone_api;

comment on function app_private.audit_log_append_only() is
    'PROPUESTA ADR-010: impide UPDATE/DELETE sobre audit_log; los eventos son inmutables.';
