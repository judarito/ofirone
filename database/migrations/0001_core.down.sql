-- Destructive rollback: run only after 0002_identity.down.sql.
BEGIN;
DROP TABLE public.tenants;
DROP FUNCTION app_private.set_updated_at();
DROP FUNCTION app_private.current_identity_id();
DROP FUNCTION app_private.current_tenant_id();
DROP SCHEMA app_private;
COMMIT;
