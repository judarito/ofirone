-- Execute ONLY on a disposable local database after both up migrations.
-- Requires a privileged local test owner; all fixtures and the role roll back.
BEGIN;
CREATE ROLE ofirone_baseline_test_actor NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, app_private TO ofirone_baseline_test_actor;
GRANT EXECUTE ON FUNCTION app_private.current_tenant_id(), app_private.current_identity_id()
    TO ofirone_baseline_test_actor;
GRANT SELECT, INSERT ON public.tenants, public.identities, public.tenant_memberships,
    public.roles, public.permissions, public.role_permissions, public.membership_roles,
    public.sessions, public.refresh_tokens TO ofirone_baseline_test_actor;
GRANT UPDATE ON public.roles TO ofirone_baseline_test_actor;

-- Fixture setup intentionally requires the privileged local test owner (RLS bypass).
INSERT INTO public.tenants (tenant_id, slug, name) VALUES
    ('00000000-0000-0000-0000-000000000001', 'baseline-a', 'A'),
    ('00000000-0000-0000-0000-000000000002', 'baseline-b', 'B');
INSERT INTO public.identities (identity_id, email, display_name) VALUES
    ('10000000-0000-0000-0000-000000000001', 'a@example.test', 'A'),
    ('10000000-0000-0000-0000-000000000002', 'b@example.test', 'B');
INSERT INTO public.tenant_memberships (membership_id, tenant_id, identity_id) VALUES
    ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
INSERT INTO public.roles (role_id, tenant_id, code, name) VALUES
    ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
    ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'owner', 'Owner');
INSERT INTO public.sessions (session_id, tenant_id, membership_id, identity_id, expires_at) VALUES
    ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', clock_timestamp() + interval '1 day');

SET LOCAL ROLE ofirone_baseline_test_actor;
SELECT set_config('app.tenant_id', '', true), set_config('app.identity_id', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.tenants) OR EXISTS (SELECT FROM public.roles)
        OR EXISTS (SELECT FROM public.identities) THEN
        RAISE EXCEPTION 'RLS leaked rows without context';
    END IF;
    BEGIN
        INSERT INTO public.roles (tenant_id, code, name)
        VALUES ('00000000-0000-0000-0000-000000000001', 'no-context', 'Denied');
        RAISE EXCEPTION 'Insert without context accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true),
       set_config('app.identity_id', '10000000-0000-0000-0000-000000000001', true);
DO $$ BEGIN
    IF (SELECT count(*) FROM public.tenants) <> 1
        OR (SELECT count(*) FROM public.tenant_memberships) <> 1
        OR (SELECT count(*) FROM public.roles) <> 1
        OR (SELECT count(*) FROM public.identities) <> 1 THEN
        RAISE EXCEPTION 'RLS context failed';
    END IF;

    BEGIN
        INSERT INTO public.roles (tenant_id, code, name)
        VALUES ('00000000-0000-0000-0000-000000000002', 'intruder', 'Intruder');
        RAISE EXCEPTION 'Cross-tenant insert accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.roles SET tenant_id = '00000000-0000-0000-0000-000000000002', code = 'moved'
        WHERE role_id = '30000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'Cross-tenant update accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.membership_roles (tenant_id, membership_id, role_id)
        VALUES ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
        RAISE EXCEPTION 'Cross-tenant role FK accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.sessions (tenant_id, membership_id, identity_id, expires_at)
        VALUES ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', clock_timestamp() + interval '1 day');
        RAISE EXCEPTION 'Mismatched session identity accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.refresh_tokens (tenant_id, session_id, token_hash, expires_at)
        VALUES ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', decode('01', 'hex'), clock_timestamp() + interval '1 hour');
        RAISE EXCEPTION 'Short token hash accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

INSERT INTO public.membership_roles (tenant_id, membership_id, role_id)
VALUES ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
INSERT INTO public.refresh_tokens (tenant_id, session_id, token_hash, expires_at)
VALUES ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', decode(repeat('01', 32), 'hex'), clock_timestamp() + interval '1 hour');

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.sessions) OR EXISTS (SELECT FROM public.refresh_tokens)
        OR EXISTS (SELECT FROM public.membership_roles) THEN
        RAISE EXCEPTION 'Tenant B can see tenant A sessions/tokens/grants';
    END IF;
END $$;
RESET ROLE;
ROLLBACK;
