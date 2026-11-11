# ADR 005 — Modelo de identidad portable: cuenta global y membresía por tenant

Estado: **propuesta**; no implementada. Pendiente de aprobación e implementación en `database/migrations/`.
Fecha: 2026-11-09.
Contexto completo: [identity-schema-proposal.md](../database-portability/identity-schema-proposal.md).

## Contexto

El esquema histórico define `public.users` con `tenant_id` y `unique (tenant_id, email)` ([`InitDB.sql:30-39`](../../shared/supabase/migrations/InitDB.sql#L30-L39)). La identidad real está en Supabase Auth y el puente es `users.auth_user_id`, nullable y sin FK ([supabase-dependencies.md §3.3](../database-portability/supabase-dependencies.md#L121-L144)). Esto produce tres problemas:

1. Una persona con acceso a dos tenants necesita dos filas y dos `user_id`; las FK de negocio apuntan al perfil tenant-scoped, no a la cuenta.
2. Puede haber perfiles sin cuenta y cuentas sin perfil.
3. La regla `fn_is_super_admin()` considera superadmin a cualquier cuenta sin perfil ([`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:17-23`](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql#L17-L23)).

El baseline [`0002_identity.up.sql`](../../database/migrations/0002_identity.up.sql) ya separa `identities` (cuenta global) de `tenant_memberships`, pero le faltan campos de credenciales, auditoría y administración de plataforma.

## Decisión

1. **Separar cuenta y vínculo.** `users` (nombre lógico; físicamente `identities` en el baseline) representa a la persona y es global. `memberships` (físicamente `tenant_memberships`) representa el vínculo con un tenant y tiene como máximo una fila por `(tenant_id, user_id)`.
2. **Conservar UUID históricos donde corresponda.** `memberships.membership_id` toma el `public.users.user_id` histórico; `users.user_id` toma `auth.users.id`. Las FK de negocio se reapuntan a `memberships(membership_id)` en la migración de datos.
3. **Autorización local.** Roles y permisos se asignan a la membresía (`membership_roles`), no al usuario global. `roles` es local al tenant; `permissions` es catálogo global.
4. **Superadmin explícito.** Se crea `platform_admins` con `granted_by`, `granted_at`, `reason` y revocación. Se elimina `fn_is_super_admin()` y se prohíbe inferir privilegios por ausencia de perfil.
5. **Nombres físicos estables.** No se renombra `identities`/`tenant_memberships` en esta fase. `users`/`memberships` son nombres de contrato y API; si el producto exige la tabla física `users`, se hace en una migración separada con vistas de compatibilidad y reapuntado de FK (decisión D1).
6. **Integridad por FK compuesta.** `(tenant_id, membership_id)`, `(tenant_id, role_id)` y `(tenant_id, membership_id, user_id)` impiden cruces de tenant incluso con UUID conocidos.

## Consecuencias

- El login debe resolver una cuenta global y luego una membresía activa; si hay varias, el cliente elige tenant. Esto cambia el contrato actual, que asume una fila de `users` por `auth_user_id` ([`useAuth.js:45-63`](../../web/src/composables/useAuth.js#L45-L63)).
- La migración debe deduplicar emails globalmente y tratar perfiles huérfanos; no es una copia directa.
- `public.users` histórico no se borra: queda en solo lectura hasta validar conteos y reapuntar FK.
- RLS protege el perímetro por tenant; la evaluación de permisos sigue en Go.

## Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Mantener `users` tenant-scoped | Impide una cuenta global y obliga a duplicar identidad; no resuelve multi-tenant real. |
| Usar `auth.users.id` como `users.user_id` y conservar `public.users.user_id` como PK de negocio | Mezcla dos conceptos y deja FKs apuntando a una tabla que ya no representa la cuenta. |
| Reproducir `service_role` o superadmin por ausencia | Reproduce el privilegio, no la autorización; riesgo de escalada. |
| Crear `profiles` además de `users` | Dos fuentes de verdad; el fallback dinámico ya es un problema ([`ADD_TENANT_BILLING_MONETIZATION.sql:509-550`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L509-L550)). |

## Verificación pendiente

- Aplicar el DDL propuesto en PostgreSQL 15+ desechable y probar constraints.
- Validar que un usuario con dos membresías no puede leer datos del otro tenant.
- Validar que `platform_admins` solo se concede explícitamente y queda auditado.
- Confirmar el mapeo de UUID con una copia de datos de prueba; no se ejecutó en esta tarea.

## Referencias

- [identity-schema-proposal.md](../database-portability/identity-schema-proposal.md) §3–§4.
- [0002_identity.up.sql](../../database/migrations/0002_identity.up.sql).
- [ADR-002](ADR-002-baseline-postgresql-portable.md) (baseline), [ADR-003](ADR-003-aislamiento-multi-tenant.md) (aislamiento), [ADR-006](ADR-006-credenciales-migracion-y-oidc.md) (credenciales y OIDC).
