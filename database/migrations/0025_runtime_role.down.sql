-- 0025_runtime_role.down.sql
DROP POLICY IF EXISTS identity_credentials_auth_read ON public.identity_credentials;
REVOKE SELECT ON public.identity_credentials FROM ofirone_auth;
