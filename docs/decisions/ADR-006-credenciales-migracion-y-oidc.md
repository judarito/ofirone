# ADR 006 — Credenciales, migración desde Supabase Auth y compatibilidad OIDC

Estado: **propuesta**; no implementada. No incluye secretos reales ni ejecuta autenticación.
Fecha: 2026-11-09.
Contexto completo: [identity-schema-proposal.md](../database-portability/identity-schema-proposal.md) §4–§8.

## Contexto

Supabase Auth (GoTrue) gestiona contraseñas, sesiones, refresh tokens, MFA y OAuth. No hay DDL de `auth.users` en el repositorio y las credenciales no están en tablas públicas ([supabase-dependencies.md §3.3](../database-portability/supabase-dependencies.md#L121-L144)). El esquema histórico no tiene columnas de contraseña ni sesiones; `change_user_password` no cambia nada ([`UserFunctions.sql:122-127`](../../shared/supabase/migrations/UserFunctions.sql#L122-L127)) y `create_auth_user` genera UUID sintéticos ([`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:42-44`](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L42-L44)).

La migración debe resolver tres cosas a la vez: conservar la identidad de los usuarios, no perder acceso y no reintroducir dependencias de plataforma.

## Decisión

### 1. Hash de contraseñas: Argon2id en el servicio, PHC en la base

- Almacenar `password_hash` como PHC string: `$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>`.
- Salt de 16 bytes por usuario; tag de 32 bytes; comparación en tiempo constante.
- Parámetros base: 64 MiB, 3 iteraciones, paralelismo 1; mínimo 19 MiB/2/1. Configurables por entorno (`AUTH_ARGON2_*`); se ajustan con benchmark, no se copian a ciegas.
- Verificar con los parámetros almacenados; rehash en login si la política subió.
- El cálculo vive en Go (`golang.org/x/crypto/argon2`); no se usa `pgcrypto` para Argon2id.
- Sin pepper inicialmente. Si se añade, va en el secret manager y su rotación exige rehash.
- No se registran contraseñas, hashes ni tokens en logs ni auditoría.

### 2. Migración de credenciales: reset por defecto, bcrypt solo en transición

- **No migrar `auth.users.encrypted_password`** como mecanismo principal: es bcrypt y no se convierte a Argon2id sin la contraseña.
- Crear cuentas con `password_hash = null`; activar con invitación/reset de un solo uso (token aleatorio, hash SHA-256, TTL 15–30 min).
- Alternativa aprobada solo si el negocio exige continuidad: copiar el hash bcrypt, verificar en login y rehashear a Argon2id en la misma transacción; forzar reset al final de la ventana.
- No migrar sesiones, refresh tokens, MFA ni tokens de OAuth. Todos los usuarios se autentican de nuevo.

### 3. Refresh tokens opacos y rotación con detección de reuso

- Refresh token de 32 bytes aleatorios; guardar solo SHA-256 en `refresh_tokens.token_hash` (`bytea`, 32 bytes).
- Access token JWT de 10–15 min con `sub`, `tid`, `mid`, `sid`, `jti`, `iss`, `aud`; sin PII.
- Rotación en cada uso: consumir el token y emitir uno nuevo con el mismo `family_id`; `replaced_by_token_id` enlaza la cadena.
- Si se presenta un token ya consumido: revocar la familia y la sesión, auditar `refresh_reuse_detected`.
- Refresh nunca en logs, URLs, analytics ni auditoría.
- Revocación por logout, cambio/reset de contraseña, deshabilitación de cuenta, suspensión de membresía o tenant.

### 4. OIDC futuro sin acoplar la cuenta al proveedor

- `users.user_id` es el sujeto interno estable; `auth_identities` guarda `(issuer, subject)`, proveedor, email del proveedor y verificación.
- `unique (issuer, subject)` impide que un subject pertenezca a dos cuentas.
- Linking por email solo si **ambos** emails están verificados y con confirmación; nunca auto-vincular un email no verificado.
- Validar firma, `iss`, `aud`, `exp`, `nbf`, `nonce`/`state`, `alg` permitido y JWKS con rotación.
- Grupos/roles del IdP solo con allowlist; `platform_admin` nunca se infiere de un claim.
- El tenant se elige por membresía validada en la base, no por un claim `tid` del IdP.
- `password_hash` nullable permite cuentas solo-OIDC y convivencia con contraseña.

## Consecuencias

- Los usuarios deberán reautenticarse y, en la mayoría de los casos, restablecer contraseña; requiere comunicación y ventana de soporte.
- La base no necesita extensión criptográfica para contraseñas; sí necesita `gen_random_uuid()` (nativo en PG13+).
- La revocación inmediata de access tokens no es posible sin estado; se acepta una ventana de 10–15 min o se comprueba `sessions.revoked_at` en operaciones sensibles.
- El costo de Argon2id debe medirse; parámetros altos permiten DoS si no hay rate limit.
- La migración de `auth.identities` solo es posible si el proveedor y el subject son exportables; si no, se pospone el linking OIDC.

## Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Migrar bcrypt y quedarse en bcrypt | No cumple el objetivo Argon2id y mantiene un algoritmo con parámetros fijos. |
| Guardar refresh tokens en claro | Un dump de base permitiría secuestrar sesiones. |
| JWT de acceso de larga vida | Aumenta la ventana de revocación y el impacto de filtración. |
| Auto-vincular OIDC por email | Account takeover con emails no verificados. |
| Guardar secretos OIDC en la base | Rotación y mínimo privilegio; van al secret manager. |
| Reutilizar `auth.users` como tabla propia | Dependencia de GoTrue y de un esquema que no controlamos. |

## Verificación pendiente

- Benchmark de Argon2id en el hardware objetivo.
- Pruebas de rotación concurrente y reuso de refresh.
- Prueba de linking OIDC con email verificado/no verificado.
- Prueba de migración con una copia de datos de prueba; no se ejecutó en esta tarea.
- Revisión legal de retención de eventos y de comunicación a usuarios.

## Referencias

- [identity-schema-proposal.md](../database-portability/identity-schema-proposal.md) §4–§8.
- [supabase-dependencies.md](../database-portability/supabase-dependencies.md) §3, §6 y §10.
- [ADR-005](ADR-005-modelo-identidad-portable.md) (modelo), [ADR-003](ADR-003-aislamiento-multi-tenant.md) (aislamiento).
