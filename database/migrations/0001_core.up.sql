-- PostgreSQL >= 15. Apply to an empty database; no Supabase objects required.
BEGIN;

CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

-- Missing context yields NULL and therefore no matching RLS rows.
-- Malformed UUID context fails closed with an error.
CREATE FUNCTION app_private.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_private.current_identity_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.identity_id', true), '')::uuid $$;

CREATE FUNCTION app_private.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;

CREATE TABLE public.tenants (
    tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT tenants_slug_format CHECK (
        length(slug) BETWEEN 1 AND 63 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
    CONSTRAINT tenants_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT tenants_status_valid CHECK (status IN ('active', 'suspended', 'archived'))
);
CREATE INDEX tenants_created_page_idx ON public.tenants (created_at DESC, tenant_id DESC);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
-- Tenant creation/deletion and status administration require a separate trusted role.
CREATE POLICY tenants_read ON public.tenants FOR SELECT
USING (tenant_id = app_private.current_tenant_id());
REVOKE ALL ON public.tenants FROM PUBLIC;

COMMIT;
