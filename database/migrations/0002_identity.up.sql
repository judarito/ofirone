-- Depends on 0001_core. Global identity; tenant-scoped authorization/sessions.
BEGIN;

CREATE TABLE public.identities (
    identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    email_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identities_email_normalized CHECK (
        email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254
        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
    CONSTRAINT identities_name_nonempty CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    CONSTRAINT identities_status_valid CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE public.tenant_memberships (
    membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    identity_id uuid NOT NULL REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, identity_id),
    UNIQUE (tenant_id, membership_id),
    UNIQUE (tenant_id, membership_id, identity_id),
    CONSTRAINT tenant_memberships_status_valid CHECK (status IN ('active', 'suspended', 'revoked'))
);
CREATE INDEX tenant_memberships_identity_idx ON public.tenant_memberships (identity_id, tenant_id);
CREATE INDEX tenant_memberships_page_idx ON public.tenant_memberships
    (tenant_id, created_at DESC, membership_id DESC);

CREATE TABLE public.roles (
    role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, role_id),
    UNIQUE (tenant_id, code),
    CONSTRAINT roles_code_format CHECK (length(code) BETWEEN 1 AND 100 AND code ~ '^[a-z][a-z0-9_.:-]*$'),
    CONSTRAINT roles_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 200)
);
CREATE INDEX roles_page_idx ON public.roles (tenant_id, name, role_id);

-- Global catalogue, writable only by a provisioned administrator/migrator.
CREATE TABLE public.permissions (
    permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT permissions_code_format CHECK (
        length(code) BETWEEN 1 AND 150 AND code ~ '^[a-z][a-z0-9_.:-]*$'
    )
);

CREATE TABLE public.role_permissions (
    tenant_id uuid NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL REFERENCES public.permissions (permission_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, role_id, permission_id),
    FOREIGN KEY (tenant_id, role_id) REFERENCES public.roles (tenant_id, role_id) ON DELETE RESTRICT
);
CREATE INDEX role_permissions_permission_idx ON public.role_permissions (permission_id);

CREATE TABLE public.membership_roles (
    tenant_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, membership_id, role_id),
    FOREIGN KEY (tenant_id, membership_id)
        REFERENCES public.tenant_memberships (tenant_id, membership_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, role_id) REFERENCES public.roles (tenant_id, role_id) ON DELETE RESTRICT
);
CREATE INDEX membership_roles_role_idx ON public.membership_roles (tenant_id, role_id);

CREATE TABLE public.sessions (
    session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, session_id),
    FOREIGN KEY (tenant_id, membership_id, identity_id)
        REFERENCES public.tenant_memberships (tenant_id, membership_id, identity_id) ON DELETE RESTRICT,
    CONSTRAINT sessions_expiration_valid CHECK (expires_at > created_at),
    CONSTRAINT sessions_revocation_valid CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX sessions_membership_page_idx ON public.sessions
    (tenant_id, membership_id, created_at DESC, session_id DESC);
CREATE INDEX sessions_identity_idx ON public.sessions (identity_id);
CREATE INDEX sessions_expiration_idx ON public.sessions (expires_at, session_id) WHERE revoked_at IS NULL;

CREATE TABLE public.refresh_tokens (
    refresh_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (tenant_id, session_id) REFERENCES public.sessions (tenant_id, session_id) ON DELETE RESTRICT,
    CONSTRAINT refresh_tokens_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT refresh_tokens_expiration_valid CHECK (expires_at > created_at),
    CONSTRAINT refresh_tokens_consumption_valid CHECK (consumed_at IS NULL OR consumed_at >= created_at),
    CONSTRAINT refresh_tokens_revocation_valid CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX refresh_tokens_session_page_idx ON public.refresh_tokens
    (tenant_id, session_id, created_at DESC, refresh_token_id DESC);
CREATE INDEX refresh_tokens_expiration_idx ON public.refresh_tokens
    (expires_at, refresh_token_id) WHERE revoked_at IS NULL;

-- All mutable entities get server-managed timestamps. Assignment rows are immutable:
-- remove/reinsert to change a grant, preserving created_at as its grant time.
DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'identities', 'tenant_memberships', 'roles', 'permissions', 'sessions', 'refresh_tokens'
    ] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at()',
            table_name || '_updated_at', table_name);
    END LOOP;

    FOREACH table_name IN ARRAY ARRAY[
        'tenant_memberships', 'roles', 'role_permissions', 'membership_roles', 'sessions', 'refresh_tokens'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (tenant_id = app_private.current_tenant_id()) WITH CHECK (tenant_id = app_private.current_tenant_id())', table_name);
    END LOOP;
END;
$$;

ALTER TABLE public.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identities FORCE ROW LEVEL SECURITY;
CREATE POLICY identities_self_read ON public.identities FOR SELECT
USING (identity_id = app_private.current_identity_id());
-- No self-writes or implicit administrator privileges.
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY permissions_read ON public.permissions FOR SELECT USING (true);

REVOKE ALL ON public.identities, public.tenant_memberships, public.roles, public.permissions,
    public.role_permissions, public.membership_roles, public.sessions, public.refresh_tokens FROM PUBLIC;

COMMIT;
