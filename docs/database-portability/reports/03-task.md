# Reporte Tarea 3 — Diseño del modelo de identidad portable

**Fecha:** 2026-11-09
**Documentos base:** [identity-schema-proposal.md](../identity-schema-proposal.md), [identity-implementation.md](../identity-implementation.md)
**Estado:** completada (propuesta; DDL aplicado en DEV, no en PROD)

## Tarea

Documentar las tablas de usuarios, tenants, membresías, roles, permisos, sesiones y refresh tokens; claves, constraints e índices; datos a migrar desde `auth.users`; hash de contraseñas sin secretos; auditoría, revocación y compatibilidad OIDC. **No implementar autenticación.**

## Estado

Completada como **propuesta**. El DDL inicial existe en [`database/migrations/0002_identity.up.sql`](../../../database/migrations/0002_identity.up.sql) y su prueba en [`tests/identity.sql`](../../../database/migrations/tests/identity.sql). `0001_core` y `0002_identity` **se aplicaron y verificaron en DEV** (9 tablas, 3 funciones en `app_private`, 9 políticas RLS, 95 constraints); **no se aplicaron** en PROD. La aplicación demuestra que el DDL ejecuta, pero no que el aislamiento funcione: las pruebas negativas siguen pendientes ([DEV-STATUS-2026-11-09.md](../DEV-STATUS-2026-11-09.md)).

## Archivos creados/modificados

- [`docs/database-portability/identity-schema-proposal.md`](../identity-schema-proposal.md) — modelo, DDL, migración, Argon2id, sesiones, auditoría y OIDC.
- [`docs/database-portability/identity-implementation.md`](../identity-implementation.md) — decisiones del baseline implementado y pendientes.
- [`database/migrations/0002_identity.up.sql`](../../../database/migrations/0002_identity.up.sql) y [`.down.sql`](../../../database/migrations/0002_identity.down.sql) — DDL inicial.
- [`database/migrations/tests/identity.sql`](../../../database/migrations/tests/identity.sql) — prueba reproducible en base desechable.
- ADR [005](../../decisions/ADR-005-modelo-identidad-portable.md) y [006](../../decisions/ADR-006-credenciales-migracion-y-oidc.md).

## Hallazgos principales

1. **El modelo histórico es un usuario por tenant:** `public.users` con `unique (tenant_id, email)` y un puente `auth_user_id` nullable sin FK ([`InitDB.sql:30-39`](../../../shared/supabase/migrations/InitDB.sql#L30-L39); [supabase-dependencies.md §3.3](../supabase-dependencies.md#L121-L145)).
2. **Una persona con dos tenants necesita dos filas**; las FK de negocio apuntan al perfil, no a la cuenta ([identity-schema-proposal.md §1.1](../identity-schema-proposal.md#L19-L49)).
3. **`fn_is_super_admin()` considera superadmin a cualquier cuenta sin perfil** ([`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:17-23`](../../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql#L17-L23)).
4. **La propuesta separa cuenta global y membresía:** 12 tablas (`tenants`, `users`, `memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles`, `sessions`, `refresh_tokens`, `auth_identities`, `identity_events`, `platform_admins`) ([§3.2](../identity-schema-proposal.md#L139-L153)).
5. **Credenciales:** Argon2id en Go, PHC en base; **no** se migra `auth.users.encrypted_password` como mecanismo principal; reset/invitación por defecto ([ADR-006 §1-2](../../decisions/ADR-006-credenciales-migracion-y-oidc.md)).
6. **Sesiones:** refresh token opaco de 32 bytes, solo SHA-256 en `bytea`; rotación con detección de reuso y `family_id` ([ADR-006 §3](../../decisions/ADR-006-credenciales-migracion-y-oidc.md)).
7. **OIDC:** `(issuer, subject)` único; linking por email solo si ambos están verificados; el tenant sale de la membresía, no de un claim ([ADR-006 §4](../../decisions/ADR-006-credenciales-migracion-y-oidc.md)).
8. **RLS:** forzada por tenant con `app.tenant_id`/`app.identity_id`; sin contexto se deniega; RLS no implementa RBAC ([identity-implementation.md:40-54](../identity-implementation.md#L40-L54)).

## Riesgos

- El login actual asume una fila de `users` por `auth_user_id` ([`useAuth.js:45-63`](../../../web/src/composables/useAuth.js#L45-L63)); el nuevo modelo exige elegir membresía y cambia el contrato.
- La deduplicación global de emails y los perfiles huérfanos requieren decisión de producto; no es una copia directa.
- Argon2id mal parametrizado permite DoS; hay que medir y limitar intentos.
- Un access token de 10–15 min no se revoca de inmediato sin estado.
- La migración de `auth.identities` solo es posible si el proveedor exporta `issuer`/`subject`.

## Decisiones recomendadas

- Aprobar [ADR-005](../../decisions/ADR-005-modelo-identidad-portable.md) (cuenta global + membresía) y [ADR-006](../../decisions/ADR-006-credenciales-migracion-y-oidc.md) (Argon2id, reset, rotación, OIDC).
- Mantener `identities`/`tenant_memberships` como nombres físicos estables; `users`/`memberships` como contrato lógico.
- Conservar `public.users.user_id` como `membership_id` para no reapuntar FK en dos pasos.
- Prohibir el superadmin por ausencia de perfil; usar `platform_admins` explícito y auditado.

## Pruebas ejecutadas

- Parser PostgreSQL `pglast 7.22`: aceptó los cuatro archivos up/down y la prueba SQL, incluidos cuerpos PL/pgSQL y bloques `DO`.
- Aplicación real en DEV de `0001_core.up.sql` y `0002_identity.up.sql`: 9 tablas, 3 funciones, 9 políticas RLS y 95 constraints verificados ([DEV-STATUS-2026-11-09.md](../DEV-STATUS-2026-11-09.md)).
- **No ejecutado:** prueba `tests/identity.sql`, `down`, segundo `up`, casos de aislamiento, rotación de tokens y grants mínimos en PROD.

## Dependencias para otros agentes

- [Tarea 4](../multitenancy-isolation.md): membresía como raíz del tenant.
- [Tarea 5](../rpc-migration-matrix.md): retirar `auth.*` de las funciones.
- [Tarea 7](../data-migration-runbook.md): mapeo de usuarios y credenciales.
- Backend Go: casos de uso de login, refresh, RBAC y revocación.
