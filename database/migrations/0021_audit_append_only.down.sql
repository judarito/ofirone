-- 0021_audit_append_only.down.sql
DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
DROP FUNCTION IF EXISTS app_private.audit_log_append_only();
