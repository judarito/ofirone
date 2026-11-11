# ADR 011 — Acceso de autenticación a `identity_credentials`

- **Estado:** propuesta; no aplicada en `database/migrations`.
- **Fecha:** 2026-11-09.
- **Boceto SQL:** [`proposals/identity_credentials_auth_access.sql`](../database-portability/_data/contracts/proposals/identity_credentials_auth_access.sql).
- **Evidencia de la brecha:** [`validation-identity-credentials-0016.txt`](../database-portability/_data/validation-identity-credentials-0016.txt).
- **Contexto de consumo:** `backend-go/internal/auth/pgstore.go` (`FindLogin`) hace `JOIN public.identity_credentials` por email/tenant.

## Contexto

`0016_identity_credentials` crea la tabla con RLS FORCE y una única política
`SELECT` para la propia identidad (`identity_id = current_identity_id()`).
El login busca por **email + tenant**, no por `identity_id` de sesión. Un rol
de runtime `NOBYPASSRLS` no puede leer el hash y el login falla. Además no hay
políticas INSERT/UPDATE: la provisión de credenciales no tiene camino con el
rol de runtime.

## Decisión

- Rol dedicado **`ofirone_auth`** (`NOBYPASSRLS`) para el servicio de auth.
- Política `identity_credentials_auth_read` `FOR SELECT TO ofirone_auth USING (true)`.
  Es necesaria para resolver `email + tenant`; el rol solo existe para auth.
- **Sin INSERT/UPDATE/DELETE** para `ofirone_auth`: la creación/rotación de
  credenciales la hace el migrador o un procedimiento administrativo auditado.
- Grants mínimos: `USAGE` en esquemas, `SELECT` solo en `identity_credentials`
  (más las tablas que el login ya necesita: `identities`, `sessions`,
  `refresh_tokens`, membresías/roles/permisos).
- Alternativa futura (si el backend puede cambiar): función
  `SECURITY DEFINER app_private.find_login(...)` con `search_path` fijo y
  `EXECUTE` solo para auth; la tabla quedaría sin lectura directa para auth.

## Consecuencias

- El servicio de auth puede leer hashes de todos los tenants; es el mínimo
  necesario para autenticar por email. Riesgo aceptado con rol dedicado,
  secreto gestionado y sin acceso desde API/web.
- Un compromiso del rol auth expone hashes (Argon2id), no contraseñas.
- El alta/rotación de credenciales requiere un rol/procedimiento separado; no
  se debe conceder INSERT/UPDATE al runtime.
- RLS sigue FORCE; la política nueva es adicional y específica de rol.

## Pruebas propuestas

1. Rol `ofirone_auth` con política: `SELECT` de credenciales de A y B funciona (login por email).
2. Rol API sin política: `SELECT` denegado (`42501`).
3. `INSERT/UPDATE/DELETE` de `ofirone_auth`: denegado (`42501`/0 filas).
4. Migrador puede provisionar/rotar credenciales.
5. Login end-to-end en Go contra base desechable.
