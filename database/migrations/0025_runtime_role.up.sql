-- Crea el rol si no existe (provisioning inicial); idempotente.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ofirone_auth') THEN
        CREATE ROLE ofirone_auth LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
END $$;
-- 0025_runtime_role.up.sql
-- Endurece ofirone_auth: sin BYPASSRLS y con lectura específica de credenciales.
-- La creación del rol es externa (provisioning); este archivo es idempotente.
ALTER ROLE ofirone_auth NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, app_private TO ofirone_auth;
GRANT SELECT ON public.identity_credentials TO ofirone_auth;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.identity_credentials FROM ofirone_auth;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='identity_credentials'
          AND policyname='identity_credentials_auth_read'
    ) THEN
        CREATE POLICY identity_credentials_auth_read
            ON public.identity_credentials
            FOR SELECT TO ofirone_auth
            USING (true);
    END IF;
END $$;
