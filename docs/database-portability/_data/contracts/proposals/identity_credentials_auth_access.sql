-- ============================================================================
-- PROPUESTA — NO EJECUTAR COMO MIGRACIÓN REAL (ADR-011)
-- Acceso del servicio de autenticación a public.identity_credentials.
--
-- Problema: 0016 solo define política SELECT para la propia identidad
-- (identity_id = current_identity_id()). El login busca por email/tenant, así
-- que un rol de runtime NOBYPASSRLS no puede leer el hash y el login falla.
--
-- Solución propuesta:
--   1) rol dedicado `ofirone_auth` (NOBYPASSRLS) para el servicio de auth;
--   2) política SELECT específica para ese rol (lectura necesaria para login);
--   3) sin INSERT/UPDATE/DELETE: la provisión de credenciales es del migrador;
--   4) grants mínimos y auditoría de accesos.
-- Alternativa futura: función SECURITY DEFINER app_private.find_login(...) con
-- search_path fijo; requiere cambiar el query del backend (fuera del perímetro).
-- ============================================================================

-- El rol debe existir antes de la política (creación fuera de la migración).
-- create role ofirone_auth login nosuperuser nobypassrls nocreatedb nocreaterole;

grant usage on schema public, app_private to ofirone_auth;
grant select on public.identity_credentials to ofirone_auth;
revoke insert, update, delete, truncate on public.identity_credentials from ofirone_auth;

create policy identity_credentials_auth_read
    on public.identity_credentials
    for select
    to ofirone_auth
    using (true);

comment on policy identity_credentials_auth_read on public.identity_credentials is
    'ADR-011: el servicio de auth lee hashes para login por email/tenant; sin escritura.';

-- Rollback (comentado):
-- drop policy if exists identity_credentials_auth_read on public.identity_credentials;
-- revoke select on public.identity_credentials from ofirone_auth;
