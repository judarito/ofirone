# Propuesta de esquema de identidad portable

- **Fecha:** 2026-11-09
- **Tarea:** #3 de [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md)
- **Estado:** propuesta completa; **DDL no ejecutado**. No implementa autenticación.
- **Alcance:** modelo de datos de usuarios, tenants, membresías, roles, permisos, sesiones y refresh tokens; migración desde `auth.users`; hash Argon2id; auditoría y revocación; compatibilidad OIDC futura.
- **Documentos relacionados:** [identity-implementation.md](identity-implementation.md) (baseline ya redactado), [schema-inventory.md](schema-inventory.md), [supabase-dependencies.md](supabase-dependencies.md), [rpc-migration-matrix.md](rpc-migration-matrix.md).
- **ADRs:** [ADR-005](../decisions/ADR-005-modelo-identidad-portable.md) (modelo), [ADR-006](../decisions/ADR-006-credenciales-migracion-y-oidc.md) (credenciales y OIDC). Contexto del plan: [ADR-002](../decisions/ADR-002-baseline-postgresql-portable.md), [ADR-003](../decisions/ADR-003-aislamiento-multi-tenant.md), [ADR-004](../decisions/ADR-004-rpc-sql-vs-go.md).
- **Nota de numeración:** los ADR 002–004 del plan ya fueron cubiertos por los entregables de baseline, aislamiento y RPC; los ADR de identidad se numeraron 005–006 para no colisionar.

> **Regla de lectura.** Este documento es un **borrador de diseño**. Ningún `create table`, `alter table`, `insert` ni consulta de este documento se ejecutó. Las referencias `archivo:línea` describen el repositorio, no una base desplegada. DEV está **vacía** y PROD está **bloqueado por política** ([schema-inventory.md §2.2](schema-inventory.md#L68-L75)); no hay observación del esquema real.

> **Convención de nombres.** El encargo pide las tablas `users` y `memberships`. El baseline ya redactado en [`database/migrations/0002_identity.up.sql`](../../database/migrations/0002_identity.up.sql) usa `identities` y `tenant_memberships`. Para no crear dos fuentes de verdad, el DDL de §3.3 usa **nombres lógicos** (`users`, `memberships`) y §3.4 define la equivalencia exacta. Recomendación: conservar los nombres físicos ya escritos y tratar `users`/`memberships` como nombres de contrato/API (decisión D1 en §10).

---

## 1. Situación actual y problema

### 1.1 El modelo histórico: un usuario por tenant

El baseline histórico define `public.users` como un perfil **con alcance de tenant**, no como una cuenta global:

```sql
create table users (
  user_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique, -- ID del usuario de Supabase Auth
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  email text not null,
  full_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
```

Evidencia: [`InitDB.sql:30-39`](../../shared/supabase/migrations/InitDB.sql#L30-L39). La identidad real vive en `auth.users` (Supabase Auth) y `public.users.auth_user_id` es el puente; `auth_user_id` es **nullable**, **unique** y **sin FK** a `auth.users` ([supabase-dependencies.md §3.3](supabase-dependencies.md#L121-L144)). El resto del modelo de autorización se apoya en ese puente: `get_current_user_tenant_id()` y `has_permission()` resuelven tenant y permisos con `auth.uid()` ([`RLS_Security.sql:6-27`](../../shared/supabase/migrations/RLS_Security.sql#L6-L27)).

Consecuencias del diseño histórico:

| Hecho | Consecuencia |
|---|---|
| `unique (tenant_id, email)` | El mismo email puede existir en dos tenants; no hay una cuenta global. |
| `auth_user_id` nullable | Un perfil puede no tener cuenta de Auth y una cuenta de Auth puede no tener perfil. |
| `tenant_id` en `users` | Un usuario con acceso a dos tenants necesita dos filas y dos `user_id` distintos. |
| FKs de negocio a `users(user_id)` | `sales.sold_by` ([`InitDB.sql:282`](../../shared/supabase/migrations/InitDB.sql#L282)), `cash_sessions.opened_by` ([`InitDB.sql:238`](../../shared/supabase/migrations/InitDB.sql#L238)) y otras tablas apuntan al `user_id` del perfil, no a la cuenta de Auth. |
| Sin columnas de credenciales | No hay hash de contraseña, MFA, sesiones ni refresh tokens en el esquema público. |

La creación de usuarios tampoco resolvía la identidad: `create_auth_user` genera un `auth_user_id` sintético y deja la creación real a la Admin API ([`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:42-44`](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L42-L44)); `change_user_password` no cambia la contraseña y solo devuelve un mensaje ([`UserFunctions.sql:122-127`](../../shared/supabase/migrations/UserFunctions.sql#L122-L127)). La creación y el cambio de contraseña ocurren en la Edge Function `create-tenant-user` con `auth.admin.createUser` / `updateUserById` ([`create-tenant-user/index.ts:265`](../../shared/supabase/functions/create-tenant-user/index.ts#L265), [`:461`](../../shared/supabase/functions/create-tenant-user/index.ts#L461)).

### 1.2 La regla «superadmin por ausencia de perfil»

`fn_is_super_admin()` devuelve `true` cuando el `auth.uid()` **no** tiene fila en `users`:

```sql
return not exists(select 1 from users where auth_user_id = auth.uid());
```

Evidencia: [`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:17-23`](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql#L17-L23). En Supabase, cualquier cuenta creada por auto-registro, OAuth o invitación sin perfil sería superadministradora. Fuera de Supabase el concepto no existe y **no debe reproducirse**. La propuesta lo sustituye por una tabla explícita `platform_admins` (§3.3) y prohíbe inferir privilegios desde la ausencia de datos.

### 1.3 El fallback a `profiles`

`get_current_user_tenant_id()` prueba tres modelos en tiempo de ejecución: `users(auth_user_id, tenant_id)`, `profiles(id, tenant_id)` y `profiles(auth_user_id, tenant_id)`, consultando `information_schema` y ejecutando SQL dinámico ([`ADD_TENANT_BILLING_MONETIZATION.sql:509-550`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L509-L550)). **No se encontró un `create table ... profiles` en `shared/`, `web/` ni `mobile/`**; el fallback existe por si el esquema desplegado tuviera esa tabla. Debe eliminarse: una sola fuente de verdad (`users` + `memberships`).

### 1.4 Baseline portable ya redactado

[`0001_core.up.sql`](../../database/migrations/0001_core.up.sql) y [`0002_identity.up.sql`](../../database/migrations/0002_identity.up.sql) ya definen una primera versión sin Supabase:

| Tabla implementada | Rol | Estado |
|---|---|---|
| `tenants` | Raíz multi-tenant, `slug` único, estados `active/suspended/archived` | `0001_core.up.sql:32-54` |
| `identities` | Cuenta global, email único normalizado, sin contraseña | `0002_identity.up.sql:4-18` |
| `tenant_memberships` | Una membresía por `(tenant_id, identity_id)` | `0002_identity.up.sql:20-34` |
| `roles` | Rol local al tenant, `(tenant_id, code)` único | `0002_identity.up.sql:36-48` |
| `permissions` | Catálogo global por `code` | `0002_identity.up.sql:51-60` |
| `role_permissions` / `membership_roles` | Asignaciones con FK compuestas por tenant | `0002_identity.up.sql:62-82` |
| `sessions` | Sesión por tenant/membresía/identidad | `0002_identity.up.sql:84-102` |
| `refresh_tokens` | Hash SHA-256 de 32 bytes, consumo y revocación | `0002_identity.up.sql:104-123` |

Fortalezas del baseline: usa UUID, `timestamptz`, `numeric` cuando aplica, checks en lugar de ENUM, FK compuestas que impiden cruces de tenant, `FORCE ROW LEVEL SECURITY` y contexto por GUC (`app.tenant_id`, `app.identity_id`) definido en [`0001_core.up.sql:9-17`](../../database/migrations/0001_core.up.sql#L9-L17). También evita el error de modelar `service_role` como superusuario.

Huecos respecto al encargo: no hay `phone`, `password_hash`, `last_sign_in_at`, `metadata`, `auth_identities`, auditoría de identidad, `platform_admins`, familia de refresh tokens ni política de reuso. La propuesta de §3 los añade.

### 1.5 Contradicción documental sobre el estado de DEV

Hay dos afirmaciones incompatibles en el repositorio:

- [`MIGRACION_BACKEND_GO_POSTGRES.md:512-513`](../../MIGRACION_BACKEND_GO_POSTGRES.md#L512-L513) dice que `0001_core.up.sql` y `0002_identity.up.sql` fueron aplicadas en DEV y validadas.
- [identity-implementation.md:3](identity-implementation.md#L3) dice «no aplicado a DEV, PROD ni otras bases», y [§Validación](identity-implementation.md#L91-L105) aclara que solo se validó sintaxis con `pglast`, sin conexiones.
- El hecho fijo de esta reanudación es que **DEV está vacía** ([schema-inventory.md §2.2](schema-inventory.md#L68-L75)).

**Lectura adoptada:** las migraciones existen y están redactadas, pero **no se consideran desplegadas** hasta verificarlo. Todo el DDL de este documento es una propuesta; ninguna tabla de identidad se asume creada en DEV ni en PROD.

### 1.6 Impacto en los clientes actuales

El cliente web resuelve el perfil con una consulta a `users` filtrada por `auth_user_id` y espera **una** fila con `tenant_id` ([`useAuth.js:45-63`](../../web/src/composables/useAuth.js#L45-L63)). La administración lista usuarios por tenant y pagina por `created_at` ([`users.service.js:13-39`](../../web/src/services/users.service.js#L13-L39)); también existe una carga sin paginación para selects ([`users.service.js:65-87`](../../web/src/services/users.service.js#L65-L87)). Un modelo de cuenta global con varias membresías rompe esa suposición: el login debe elegir tenant/membresía activa y la API debe exponer esa selección. Es un cambio de contrato fuera del perímetro de esta tarea (ver §12).

---

## 2. Principios de diseño

1. **Cuenta global, autorización local.** `users` representa a la persona; `memberships` representa su vínculo con un tenant. Los roles y permisos efectivos se calculan por membresía y tenant.
2. **UUID estables.** `users.user_id` se conserva como sujeto (`sub`) en todos los tokens; no se reutiliza el `user_id` histórico de perfil, que era tenant-scoped.
3. **Sin Supabase.** Nada depende de `auth.uid()`, `auth.users`, `auth.jwt()`, `service_role`, RLS de plataforma ni extensiones propietarias.
4. **Contraseñas fuera de SQL.** El hash se calcula y verifica en el servicio de autenticación (Go); la base solo almacena el PHC string. Argon2id es el algoritmo objetivo (ADR-006).
5. **Sesiones como unidad de revocación.** La sesión es la familia; los refresh tokens se rotan y se detecta su reuso. Los access tokens son de vida corta.
6. **Privilegio explícito.** No existe superadmin por ausencia de perfil. `platform_admins` es una concesión registrada y auditable.
7. **Aislamiento por construcción.** FK compuestas `(tenant_id, …)` y RLS por tenant; la API no usa `BYPASSRLS`. La autorización fina (RBAC) se valida en Go además de RLS.
8. **Auditoría sin secretos.** Se registran eventos de identidad con hash de IP y user-agent, nunca contraseñas, tokens, hashes de token ni PII innecesaria.
9. **Migración no destructiva.** Se conserva el esquema histórico en solo lectura hasta validar conteos; no se borran usuarios ni se infieren privilegios.
10. **PostgreSQL 15+.** `gen_random_uuid()` es nativo; no se requieren extensiones.

---

## 3. Modelo propuesto

### 3.1 Diagrama lógico

```text
tenants 1 ──── * memberships * ──── 1 users
                    │                  │
                    │                  ├── * auth_identities (OIDC)
                    │                  └── * sessions ─── * refresh_tokens
                    ├── * membership_roles * ─── 1 roles
                    │                                │
                    │                                └── * role_permissions * ─── 1 permissions
                    └── * identity_events (tenant, usuario, sesión)

platform_admins ── 1 users   (concesión explícita, fuera del tenant)
```

Reglas estructurales:

- Un `user` puede tener N `memberships`, como máximo una por tenant.
- Un `membership` pertenece a un solo tenant y a un solo `user`.
- Un `role` pertenece a un tenant; un `permission` es global.
- Una `session` pertenece a una membresía y al usuario exacto de esa membresía.
- Un `refresh_token` pertenece a una sesión; su hash es único y su familia permite detectar reuso.

### 3.2 Resumen de tablas

| Tabla | Ámbito | Propósito | PII / sensibilidad | RLS |
|---|---|---|---|---|
| `tenants` | Global | Raíz del aislamiento y estado del tenant | Baja (nombre, slug) | Lectura del tenant actual |
| `users` | Global | Cuenta de persona; email, teléfono, credenciales | Alta: email, teléfono, hash | Solo lectura propia |
| `memberships` | Tenant | Vínculo usuario↔tenant y estado | Media | Por `tenant_id` |
| `roles` | Tenant | Roles locales; `code` estable | Baja | Por `tenant_id` |
| `permissions` | Global | Catálogo de permisos; sin privilegios implícitos | Baja | Lectura global |
| `role_permissions` | Tenant | Permisos concedidos a un rol | Baja | Por `tenant_id` |
| `membership_roles` | Tenant | Roles concedidos a una membresía | Media (privilegios) | Por `tenant_id` |
| `sessions` | Tenant | Sesión autenticada y revocación | Media: hash IP/UA | Propias o por tenant |
| `refresh_tokens` | Tenant | Rotación y detección de reuso | Alta: hash del token | Solo servicio de auth |
| `auth_identities` | Global | Vínculo con IdP OIDC (issuer/subject) | Media: email del proveedor | Solo el usuario/servicio |
| `identity_events` | Global/Tenant | Auditoría de identidad append-only | Media: hash IP/UA | Lectura administrativa acotada |
| `platform_admins` | Global | Superadministración explícita | Alta (privilegio) | Sin acceso API directo |

### 3.3 DDL propuesto (borrador, no ejecutar)

> **No ejecutar.** Es un contrato de diseño. Si se adopta sobre `0002_identity.up.sql`, lean `users` como `identities` y `memberships` como `tenant_memberships`; ver §3.4. No se incluyen `BEGIN`/`COMMIT` ni `DROP` para evitar que alguien lo aplique por accidente.

```sql
-- PostgreSQL 15+. Propuesta de identidad portable. NO EJECUTAR.

create table tenants (
    tenant_id   uuid primary key default gen_random_uuid(),
    slug        text not null unique,
    name        text not null,
    status      text not null default 'active',
    created_at  timestamptz not null default clock_timestamp(),
    updated_at  timestamptz not null default clock_timestamp(),
    constraint tenants_slug_format check (
        length(slug) between 1 and 63
        and slug = lower(btrim(slug))
        and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
    constraint tenants_name_nonempty check (length(btrim(name)) between 1 and 200),
    constraint tenants_status_valid check (status in ('active', 'suspended', 'archived'))
);

create table users (
    user_id            uuid primary key default gen_random_uuid(),
    email              text not null,
    email_verified_at  timestamptz,
    phone              text,
    phone_verified_at  timestamptz,
    display_name       text not null,
    password_hash      text,
    password_changed_at timestamptz,
    status             text not null default 'active',
    last_sign_in_at    timestamptz,
    metadata           jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default clock_timestamp(),
    updated_at         timestamptz not null default clock_timestamp(),
    deleted_at         timestamptz,
    constraint users_email_normalized check (
        email = lower(btrim(email))
        and length(email) between 3 and 254
        and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
    constraint users_phone_e164 check (
        phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'
    ),
    constraint users_display_name_nonempty check (length(btrim(display_name)) between 1 and 200),
    constraint users_status_valid check (status in ('active', 'disabled', 'pending_deletion')),
    -- Hash PHC de Argon2id; se admite bcrypt solo durante la transición.
    constraint users_password_hash_format check (
        password_hash is null
        or password_hash ~ '^\$(argon2id|2a|2b|2y)\$'
    ),
    constraint users_deleted_consistency check (
        deleted_at is null or status = 'pending_deletion'
    ),
    constraint users_metadata_object check (jsonb_typeof(metadata) = 'object')
);

-- Un email activo solo puede pertenecer a una cuenta. Los emails de cuentas
-- eliminadas quedan fuera del índice para permitir reutilización controlada.
create unique index users_email_active_key
    on users (email)
    where deleted_at is null;

create table memberships (
    membership_id uuid primary key default gen_random_uuid(),
    tenant_id     uuid not null references tenants (tenant_id) on delete restrict,
    user_id       uuid not null references users (user_id) on delete restrict,
    status        text not null default 'invited',
    joined_at     timestamptz,
    created_at    timestamptz not null default clock_timestamp(),
    updated_at    timestamptz not null default clock_timestamp(),
    unique (tenant_id, user_id),
    unique (tenant_id, membership_id),
    -- Permite FK compuestas que incluyen la identidad exacta.
    unique (tenant_id, membership_id, user_id),
    constraint memberships_status_valid check (
        status in ('invited', 'active', 'suspended', 'revoked')
    )
);

create index memberships_user_idx on memberships (user_id, tenant_id);
create index memberships_page_idx
    on memberships (tenant_id, created_at desc, membership_id desc);

create table roles (
    role_id    uuid primary key default gen_random_uuid(),
    tenant_id  uuid not null references tenants (tenant_id) on delete restrict,
    code       text not null,
    name       text not null,
    is_system  boolean not null default false,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (tenant_id, role_id),
    unique (tenant_id, code),
    constraint roles_code_format check (
        length(code) between 1 and 100
        and code = lower(code)
        and code ~ '^[a-z][a-z0-9_.:-]*$'
    ),
    constraint roles_name_nonempty check (length(btrim(name)) between 1 and 200)
);

create index roles_page_idx on roles (tenant_id, name, role_id);

create table permissions (
    permission_id uuid primary key default gen_random_uuid(),
    code          text not null unique,
    description   text not null default '',
    created_at    timestamptz not null default clock_timestamp(),
    updated_at    timestamptz not null default clock_timestamp(),
    constraint permissions_code_format check (
        length(code) between 1 and 150
        and code = lower(code)
        and code ~ '^[a-z][a-z0-9_.:-]*$'
    )
);

create table role_permissions (
    tenant_id     uuid not null,
    role_id       uuid not null,
    permission_id uuid not null references permissions (permission_id) on delete restrict,
    created_at    timestamptz not null default clock_timestamp(),
    primary key (tenant_id, role_id, permission_id),
    foreign key (tenant_id, role_id)
        references roles (tenant_id, role_id) on delete restrict
);

create index role_permissions_permission_idx
    on role_permissions (permission_id);

create table membership_roles (
    tenant_id     uuid not null,
    membership_id uuid not null,
    role_id       uuid not null,
    created_at    timestamptz not null default clock_timestamp(),
    primary key (tenant_id, membership_id, role_id),
    foreign key (tenant_id, membership_id)
        references memberships (tenant_id, membership_id) on delete restrict,
    foreign key (tenant_id, role_id)
        references roles (tenant_id, role_id) on delete restrict
);

create index membership_roles_role_idx
    on membership_roles (tenant_id, role_id);

create table sessions (
    session_id     uuid primary key default gen_random_uuid(),
    tenant_id      uuid not null,
    membership_id  uuid not null,
    user_id        uuid not null,
    auth_method    text not null default 'password',
    created_at     timestamptz not null default clock_timestamp(),
    last_seen_at   timestamptz,
    expires_at     timestamptz not null,
    revoked_at     timestamptz,
    revoke_reason  text,
    ip_hash        bytea,
    user_agent_hash bytea,
    unique (tenant_id, session_id),
    foreign key (tenant_id, membership_id, user_id)
        references memberships (tenant_id, membership_id, user_id) on delete restrict,
    constraint sessions_expiration_valid check (expires_at > created_at),
    constraint sessions_revocation_valid check (
        revoked_at is null or revoked_at >= created_at
    ),
    constraint sessions_auth_method_valid check (
        auth_method in ('password', 'oidc', 'refresh', 'invite')
    ),
    constraint sessions_ip_hash_length check (
        ip_hash is null or octet_length(ip_hash) = 32
    ),
    constraint sessions_user_agent_hash_length check (
        user_agent_hash is null or octet_length(user_agent_hash) = 32
    )
);

create index sessions_membership_page_idx
    on sessions (tenant_id, membership_id, created_at desc, session_id desc);
create index sessions_user_idx on sessions (user_id, created_at desc);
create index sessions_expiration_idx
    on sessions (expires_at, session_id) where revoked_at is null;

create table refresh_tokens (
    refresh_token_id uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null,
    session_id       uuid not null,
    token_hash       bytea not null,
    family_id        uuid not null,
    replaced_by_token_id uuid,
    issued_at        timestamptz not null default clock_timestamp(),
    expires_at       timestamptz not null,
    consumed_at      timestamptz,
    revoked_at       timestamptz,
    revoke_reason    text,
    created_at       timestamptz not null default clock_timestamp(),
    updated_at       timestamptz not null default clock_timestamp(),
    unique (token_hash),
    unique (tenant_id, refresh_token_id),
    foreign key (tenant_id, session_id)
        references sessions (tenant_id, session_id) on delete restrict,
    foreign key (tenant_id, replaced_by_token_id)
        references refresh_tokens (tenant_id, refresh_token_id) on delete restrict,
    constraint refresh_tokens_hash_length check (octet_length(token_hash) = 32),
    constraint refresh_tokens_expiration_valid check (expires_at > issued_at),
    constraint refresh_tokens_consumption_valid check (
        consumed_at is null or consumed_at >= issued_at
    ),
    constraint refresh_tokens_revocation_valid check (
        revoked_at is null or revoked_at >= issued_at
    ),
    constraint refresh_tokens_no_self_replacement check (
        replaced_by_token_id is null or replaced_by_token_id <> refresh_token_id
    )
);

create index refresh_tokens_session_page_idx
    on refresh_tokens (tenant_id, session_id, created_at desc, refresh_token_id desc);
create index refresh_tokens_family_idx on refresh_tokens (family_id);
create index refresh_tokens_expiration_idx
    on refresh_tokens (expires_at, refresh_token_id) where revoked_at is null;

-- Compatibilidad OIDC. El subject del proveedor no reemplaza a users.user_id.
create table auth_identities (
    auth_identity_id uuid primary key default gen_random_uuid(),
    user_id          uuid not null references users (user_id) on delete restrict,
    provider         text not null,
    issuer           text not null,
    subject          text not null,
    email_at_provider text,
    email_verified_at timestamptz,
    created_at       timestamptz not null default clock_timestamp(),
    updated_at       timestamptz not null default clock_timestamp(),
    last_login_at    timestamptz,
    unique (issuer, subject),
    unique (user_id, issuer, subject),
    constraint auth_identities_provider_format check (
        length(provider) between 1 and 50 and provider = lower(provider)
    ),
    constraint auth_identities_issuer_nonempty check (length(btrim(issuer)) between 1 and 500),
    constraint auth_identities_subject_nonempty check (length(btrim(subject)) between 1 and 500),
    constraint auth_identities_email_normalized check (
        email_at_provider is null
        or (email_at_provider = lower(btrim(email_at_provider))
            and email_at_provider ~ '^[^[:space:]@]+@[^[:space:]@]+$')
    )
);

create index auth_identities_user_idx on auth_identities (user_id);

-- Auditoría de identidad, separada de audit_log de negocio.
create table identity_events (
    event_id      uuid primary key default gen_random_uuid(),
    tenant_id     uuid references tenants (tenant_id) on delete restrict,
    user_id       uuid references users (user_id) on delete restrict,
    session_id    uuid,
    actor_user_id uuid references users (user_id) on delete restrict,
    event_type    text not null,
    outcome       text not null default 'success',
    ip_hash       bytea,
    user_agent_hash bytea,
    metadata      jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default clock_timestamp(),
    constraint identity_events_type_valid check (event_type in (
        'login_succeeded', 'login_failed', 'logout',
        'refresh_rotated', 'refresh_reuse_detected', 'session_revoked',
        'password_changed', 'password_reset_requested', 'email_verified',
        'membership_created', 'membership_status_changed',
        'role_assigned', 'role_revoked',
        'oidc_linked', 'oidc_unlinked',
        'platform_admin_granted', 'platform_admin_revoked'
    )),
    constraint identity_events_outcome_valid check (
        outcome in ('success', 'failure', 'denied')
    ),
    constraint identity_events_ip_hash_length check (
        ip_hash is null or octet_length(ip_hash) = 32
    ),
    constraint identity_events_ua_hash_length check (
        user_agent_hash is null or octet_length(user_agent_hash) = 32
    ),
    constraint identity_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index identity_events_tenant_date_idx
    on identity_events (tenant_id, created_at desc, event_id desc);
create index identity_events_user_date_idx
    on identity_events (user_id, created_at desc, event_id desc);
create index identity_events_type_date_idx
    on identity_events (event_type, created_at desc);

-- Superadministración explícita. Sustituye a fn_is_super_admin().
create table platform_admins (
    user_id    uuid primary key references users (user_id) on delete restrict,
    granted_by uuid not null references users (user_id) on delete restrict,
    granted_at timestamptz not null default clock_timestamp(),
    revoked_at timestamptz,
    revoked_by uuid references users (user_id) on delete restrict,
    reason     text not null default '',
    constraint platform_admins_revocation_consistency check (
        (revoked_at is null and revoked_by is null)
        or (revoked_at is not null and revoked_by is not null and revoked_at >= granted_at)
    )
);
```

Notas del DDL:

- **Bootstrap del primer `platform_admin`:** se inserta primero el `users` del administrador y luego `platform_admins` con `granted_by = user_id`, `reason = 'bootstrap'`. Las concesiones posteriores exigen un `granted_by` distinto y quedan auditadas. No se crea un admin por defecto ni por ausencia de perfil.

- `clock_timestamp()` sigue el baseline implementado; no se usa `now()` para `updated_at`.
- Los `updated_at` se mantienen con un trigger `app_private.set_updated_at()` como el de [`0001_core.up.sql:19-28`](../../database/migrations/0001_core.up.sql#L19-L28). El DDL no repite el trigger para no duplicarlo.
- `permissions` es global y sin `tenant_id`; es una decisión heredada ([schema-inventory.md §5.1](schema-inventory.md#L159-L171)). Si se necesitan permisos por tenant, ver D18.
- `identity_events.session_id` no lleva FK: una sesión puede purgarse y el evento debe sobrevivir. `tenant_id`/`user_id` usan `on delete restrict` porque las entidades se desactivan, no se borran.
- No se crean tablas de invitaciones, verificación de email ni reset de contraseña en este borrador; son parte del flujo de autenticación (§12, D15).

### 3.4 Correspondencia con el esquema actual

#### 3.4.1 Con `public.users` (histórico)

| Histórico | Destino propuesto | Regla |
|---|---|---|
| `users.user_id` | `memberships.membership_id` | **Conservar el UUID** como identificador de membresía. Las FK de negocio que hoy apuntan a `users.user_id` deben reapuntarse a `memberships.membership_id` (tarea #7). |
| `users.auth_user_id` | `users.user_id` | Si no es nulo, es la clave de la cuenta global. Si es nulo, se genera un `user_id` nuevo y la cuenta queda sin credenciales. |
| `users.tenant_id` | `memberships.tenant_id` | Directo. |
| `users.email` | `users.email` | Normalizar; resolver colisiones globales (§4.4). |
| `users.full_name` | `users.display_name` | Si hay conflicto entre tenants, elegir de forma determinista y guardar el original en `metadata`. |
| `users.is_active` | `users.status` y `memberships.status` | `false` → `disabled` / `suspended`; `true` → `active`. |
| `users.created_at` | `users.created_at` y `memberships.created_at` | Conservar. |
| `user_roles` | `membership_roles` | Mapear `user_id` → `membership_id`; `role_id` se conserva si el rol se migra con el mismo UUID. |
| `roles.name` | `roles.code` + `roles.name` | Generar `code` normalizado; conservar `name`. |
| `permissions.code` | `permissions.code` | Directo; el catálogo es global. |

**Por qué no se puede conservar `users.user_id` como `users.user_id` global:** un mismo `auth_user_id` puede tener una fila por tenant, y `users.user_id` es distinto en cada una. El UUID que las tablas de negocio referencian es el del **perfil tenant-scoped**, no el de la cuenta. Por eso se propone que ese UUID pase a ser `membership_id` y que las FK se reapunten. Si se intentara usar el `user_id` histórico como `users.user_id`, dos tenants con la misma persona colisionarían o se duplicaría la cuenta.

Para preservar la trazabilidad y permitir el reapuntado gradual de FK, se propone una tabla auxiliar **solo de migración** (no forma parte del modelo final):

```sql
-- Auxiliar de migración. No es parte del modelo operativo.
create table legacy_user_ids (
    legacy_user_id uuid primary key,
    user_id        uuid not null references users (user_id) on delete restrict,
    membership_id  uuid not null references memberships (membership_id) on delete restrict,
    source         text not null default 'public.users',
    migrated_at    timestamptz not null default clock_timestamp(),
    unique (user_id, membership_id)
);
```

Evidencia de las FK que obligan a este cuidado: `sales.sold_by` ([`InitDB.sql:282`](../../shared/supabase/migrations/InitDB.sql#L282)), `cash_sessions.opened_by`/`closed_by` ([`InitDB.sql:238-241`](../../shared/supabase/migrations/InitDB.sql#L238-L241)), `sale_returns.created_by` ([`InitDB.sql:323`](../../shared/supabase/migrations/InitDB.sql#L323)), `inventory_moves.created_by` ([`InitDB.sql:357`](../../shared/supabase/migrations/InitDB.sql#L357)) y `cash_register_assignments.user_id` ([`AsignacionCajerosCaja.sql:25`](../../shared/supabase/migrations/AsignacionCajerosCaja.sql#L25)).

#### 3.4.2 Con el baseline `0002_identity.up.sql`

| Propuesta lógica | Implementado | Delta necesario |
|---|---|---|
| `users` | `identities` | Añadir `phone`, `phone_verified_at`, `password_hash`, `password_changed_at`, `last_sign_in_at`, `metadata`, `deleted_at`; `status` ya existe (`active/disabled`), ampliar a `pending_deletion` si se adopta. |
| `memberships` | `tenant_memberships` | Añadir `joined_at`; ampliar estados con `invited`; conservar `unique (tenant_id, identity_id)`. |
| `roles` | `roles` | Añadir `is_system`; ya tiene `(tenant_id, code)`. |
| `permissions` | `permissions` | Sin cambios. |
| `role_permissions` | `role_permissions` | Sin cambios. |
| `membership_roles` | `membership_roles` | Sin cambios. |
| `sessions` | `sessions` | Añadir `auth_method`, `last_seen_at`, `revoke_reason`, `ip_hash`, `user_agent_hash`. |
| `refresh_tokens` | `refresh_tokens` | Añadir `family_id`, `replaced_by_token_id`, `issued_at`, `revoke_reason`. |
| `auth_identities` | — | Nueva. |
| `identity_events` | — | Nueva. |
| `platform_admins` | — | Nueva. |

**Alcance de `tenants`.** La tabla propuesta es deliberadamente mínima (identidad y aislamiento). El histórico añade `tax_id`, `currency_code` e `is_active` ([`InitDB.sql:7-14`](../../shared/supabase/migrations/InitDB.sql#L7-L14)); la migración debe conservarlos en `tenants` o moverlos a `tenant_settings`, no descartarlos. Facturación, moneda y configuración de tenant quedan fuera de esta tarea.

**Conflicto de códigos de permiso.** El catálogo histórico usa códigos en mayúsculas (`SALES.CREATE`, `SECURITY.USERS.MANAGE`) —[`InitDB.sql:50`](../../shared/supabase/migrations/InitDB.sql#L50), [`RLS_Security.sql:51-56`](../../shared/supabase/migrations/RLS_Security.sql#L51-L56)— mientras que `0002_identity.up.sql:57-59` exige minúsculas (`^[a-z][a-z0-9_.:-]*$`). La migración debe normalizar el catálogo y **actualizar todos los literales** de `has_permission(...)` en funciones, políticas y Edge Functions; si solo se normaliza la tabla, las comprobaciones dejan de encontrar el permiso. Es un cambio de datos y de código, no solo de constraint.

**Recomendación:** no renombrar `identities`/`tenant_memberships` en caliente. Son tablas ya redactadas, con RLS y pruebas, y el nombre `users` choca con la tabla histórica `public.users` que todavía existe en el esquema de origen. Mantener los nombres físicos y usar `users`/`memberships` como nombres de contrato/API evita una migración de renombrado y una vista de compatibilidad. Si el producto exige una tabla física `users`, la alternativa es una migración `0003` que:

1. renombre `public.users` histórico a `legacy.users` (o lo deje en un esquema `legacy`);
2. renombre `identities` → `users` y `tenant_memberships` → `memberships`;
3. cree vistas `identities`/`tenant_memberships` con `security_invoker = true` para el código antiguo;
4. repunte las FK de negocio a `memberships(membership_id)`.

Ese trabajo **no** se ejecuta aquí; queda en §12 y en la decisión D1.

#### 3.4.3 Con `profiles`

No hay `create table ... profiles` en el repositorio; solo el fallback dinámico de [`ADD_TENANT_BILLING_MONETIZATION.sql:509-550`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L509-L550). La propuesta **no** crea `profiles`: `users` + `memberships` cubren esos datos. Si en PROD existiera, se migra como una fuente más de `users`/`memberships` y se elimina el `EXECUTE` dinámico.

### 3.5 Invariantes y constraints clave

| Invariante | Dónde se garantiza |
|---|---|
| Email activo único a nivel global | `users_email_active_key` (índice parcial único) + normalización en app |
| Una membresía por usuario y tenant | `unique (tenant_id, user_id)` |
| Un rol pertenece a un tenant | `roles.tenant_id` + `unique (tenant_id, role_id)` |
| Un permiso no se asigna a un rol de otro tenant | FK `(tenant_id, role_id)` en `role_permissions` |
| Un rol de membresía es del mismo tenant que la membresía | FK `(tenant_id, membership_id)` y `(tenant_id, role_id)` en `membership_roles` |
| Una sesión no puede mezclar usuario y membresía de tenants distintos | FK `(tenant_id, membership_id, user_id)` a `memberships` |
| Un refresh token pertenece a la sesión y tenant correctos | FK `(tenant_id, session_id)` a `sessions` |
| No hay reemplazo circular de refresh token | `replaced_by_token_id <> refresh_token_id` |
| Un superadmin es una concesión explícita | `platform_admins` con `granted_by` y `reason` |
| No hay privilegios por ausencia de fila | Se elimina `fn_is_super_admin()`; no se recrea |

**Lo que PostgreSQL no puede garantizar solo:** que la membresía esté `active` al crear la sesión, que el usuario esté `active`, que el refresh token no esté vencido en el instante de uso, que el nuevo token no supere la expiración de la sesión y que el rol concedido sea "asignable" por el actor. Eso se valida en la transacción del servicio de autenticación (Go) y se prueba con casos negativos.

### 3.6 Índices y paginación

| Consulta | Índice |
|---|---|
| Login por email | `users_email_active_key` (lookup exacto) |
| Membresías de un usuario | `memberships_user_idx (user_id, tenant_id)` |
| Listado de usuarios de un tenant | `memberships_page_idx (tenant_id, created_at desc, membership_id desc)` |
| Roles por nombre en un tenant | `roles_page_idx (tenant_id, name, role_id)` |
| Permisos de un rol | PK `(tenant_id, role_id, permission_id)` |
| Roles de una membresía | PK `(tenant_id, membership_id, role_id)` + `membership_roles_role_idx` |
| Sesiones de una membresía | `sessions_membership_page_idx` |
| Sesiones a revocar/expirar | `sessions_expiration_idx` (parcial) |
| Refresh por sesión | `refresh_tokens_session_page_idx` |
| Detección de reuso por familia | `refresh_tokens_family_idx` |
| Auditoría por tenant/fecha | `identity_events_tenant_date_idx` |
| Auditoría por usuario/fecha | `identity_events_user_date_idx` |

Todas las paginaciones deben llevar desempate (`membership_id`, `role_id`, `session_id`, `event_id`) para no duplicar filas entre páginas, en línea con la regla del plan ([MIGRACION_BACKEND_GO_POSTGRES.md:191](../../MIGRACION_BACKEND_GO_POSTGRES.md#L191)). Los listados de usuarios deben salir de `memberships` + `users`, no de una tabla `users` tenant-scoped.

---

## 4. Migración de datos desde Supabase Auth

### 4.1 Campos de `auth.users`

`auth.users` no tiene DDL en el repositorio; solo se asume su existencia ([supabase-dependencies.md §3.3](supabase-dependencies.md#L121-L144)). La exportación requiere acceso privilegiado y **PROD está bloqueado**; este mapeo es una especificación, no una extracción ejecutada.

| Campo de `auth.users` | Destino | Regla |
|---|---|---|
| `id` | `users.user_id` | Conservar el UUID. Es el `sub` estable y la clave de unión con `public.users.auth_user_id`. |
| `email` | `users.email` | `lower(btrim(email))`; validar formato; resolver duplicados globales (§4.4). |
| `email_confirmed_at` | `users.email_verified_at` | Directo; `null` se conserva como no verificado. |
| `phone` | `users.phone` | Normalizar a E.164; si es inválido, no bloquear la migración: guardar en `metadata.legacy_phone` y dejar `phone = null`. |
| `phone_confirmed_at` | `users.phone_verified_at` | Directo si existe; si no existe la columna, `null`. |
| `created_at` | `users.created_at` | Conservar; fallback `clock_timestamp()`. |
| `updated_at` | `users.updated_at` | Conservar; fallback `created_at`. |
| `last_sign_in_at` | `users.last_sign_in_at` | Directo; puede ser `null`. |
| `raw_user_meta_data` | `users.display_name` + `users.metadata` | Extraer `full_name`, `name`, `display_name`, `avatar_url`, `locale`; si no hay nombre, usar la parte local del email como `display_name`. Guardar el JSON original solo si no contiene secretos; si contiene, guardar una lista blanca. |
| `encrypted_password` | **No se copia por defecto** | Ver §4.5. Si se opta por transición, se copia como hash bcrypt y se rehashea en el primer login. |
| `identities` (tabla relacionada) | `auth_identities` | Mapear `provider_id`/`provider`, `identity_data->>'sub'`, email del proveedor. |
| `sessions`, `refresh_tokens` | **No se migran** | Son opacos y ligados a GoTrue. Se fuerza re-login. |
| `mfa_factors`, `mfa_challenges` | **No se migran** | Re-enrolamiento; decisión D7. |
| `aud`, `role` | **No se migran** | No son autorización de negocio; `service_role` no se reproduce. |

### 4.2 De `public.users` a `users` + `memberships`

| Paso | Acción | Validación |
|---:|---|---|
| 1 | Exportar/leer `auth.users` y `auth.identities` a un esquema de staging (`identity_import`). | Conteos por tabla; no tocar producción. |
| 2 | Normalizar emails y agrupar por email. | Duplicados exactos y case-insensitive. |
| 3 | Resolver cada `auth.users` a un `users.user_id = auth.id`. | UUID válido; sin colisión. |
| 4 | Crear `users` con estado `active` y `email_verified_at` según `email_confirmed_at`. | Emails únicos; nulos permitidos solo si el origen lo permite. |
| 5 | Resolver cada `public.users` por `auth_user_id`. | Huérfanos: perfiles sin Auth y Auth sin perfil. |
| 6 | Insertar `memberships` con `membership_id = public.users.user_id`. | `unique (tenant_id, user_id)`; un usuario puede tener N membresías. |
| 7 | Migrar `tenants`, `roles`, `permissions`, `role_permissions`, `user_roles`. | Mismos UUID donde sea posible; `roles.code` generado. |
| 8 | Migrar `auth.identities` a `auth_identities` si el proveedor es OIDC/Social. | `unique (issuer, subject)`. |
| 9 | Registrar `legacy_user_ids` para cada perfil. | Correspondencia 1:1 con `public.users`. |
| 10 | **No** crear `platform_admins` automáticamente. | Lista candidata revisada por el owner. |
| 11 | **No** crear sesiones ni refresh tokens. | Todos los usuarios deberán autenticarse de nuevo. |
| 12 | Validar conteos, huérfanos y cruces de tenant. | Ver §4.7. |

### 4.3 Algoritmo de reconciliación (pseudocódigo, no ejecutable)

```text
para cada auth_user en auth.users:
    email := normalizar(auth_user.email)
    user := users.buscar_por_email(email)
    si user existe y user.user_id != auth_user.id:
        si ambos emails están verificados:
            fusionar cuentas (mover membresías, identities, sesiones inexistentes)
        si no:
            cuarentena(auth_user.id, "email duplicado no verificado")
    si no existe:
        users.insert(user_id = auth_user.id, email, email_verified_at, ...)

para cada profile en public.users:
    user := users.buscar_por_auth_user_id(profile.auth_user_id)
    si user es null:
        user := crear_usuario_sin_credenciales(profile)
        marcar "perfil huérfano; requiere invitación"
    membership := memberships.insert(
        membership_id = profile.user_id,
        tenant_id = profile.tenant_id,
        user_id = user.user_id,
        status = profile.is_active ? 'active' : 'suspended',
        joined_at = profile.created_at
    )
    legacy_user_ids.insert(profile.user_id, user.user_id, membership.membership_id)
```

No se muestra SQL de `INSERT` ejecutable a propósito: la migración real debe implementarse en la tarea #7 con transacción, staging, checksums y rollback.

### 4.4 Conflictos y decisiones de reconciliación

| Caso | Tratamiento propuesto | Riesgo si no se trata |
|---|---|---|
| Mismo email en dos tenants, misma persona | Una `users` con dos `memberships`; elegir la cuenta con email verificado y más antigua como canónica. | Duplicar personas y romper auditoría. |
| Mismo email, cuentas no verificadas | Cuarentena; no fusionar automáticamente. | Account takeover. |
| `public.users` con `auth_user_id` nulo | Crear `users` sin `password_hash`, estado `disabled` o `invited`; no puede iniciar sesión hasta invitación. | Suplantación o cuentas activas sin credenciales. |
| `auth.users` sin `public.users` | Crear solo `users`; **no** crear membresía ni superadmin. | Escalada de privilegios (regla histórica). |
| `public.users` con `auth_user_id` que no existe en Auth | Huérfano; conservar en cuarentena y mapear a `users` sin credenciales. | Perfil que no puede autenticarse. |
| Email inválido o vacío | No inventar email; registrar en cuarentena; no bloquear el resto. | Pérdida de cuenta o email falso. |
| Cuenta solo teléfono (`auth.users.email` nulo) | Cuarentena y completar email antes de activar; no generar un email ficticio. Alternativa D8: permitir email nullable y login por teléfono. | Cuenta inaccesible o email falso. |
| Teléfono duplicado | No imponer unicidad global inicialmente; marcar conflicto. | Bloqueo de migración por datos sucios. |
| Usuario `is_active = false` | `users.status = 'disabled'`, `memberships.status = 'suspended'`; conservar ambos. | Reactivación accidental. |
| Superadmin histórico | No se infiere; se propone lista explícita para aprobación. | Cualquier cuenta sin perfil sería admin. |
| Email de cuenta eliminada | `deleted_at` no nulo, fuera del índice único; conservar para auditoría. | Reutilización de email con historial confuso. |

### 4.5 Contraseñas: qué migrar y qué no

**Recomendación principal:** **no migrar `encrypted_password`**. Supabase Auth usa bcrypt y los hashes no se pueden convertir a Argon2id sin la contraseña en claro. El flujo correcto es forzar un restablecimiento o una invitación:

1. Crear `users` con `password_hash = null` y `status = 'active'` solo si el email está verificado.
2. Enviar un enlace de activación/reset de un solo uso (token aleatorio, hash SHA-256, TTL 15–30 min).
3. En el primer login, establecer Argon2id.

**Alternativa de transición (solo si el negocio exige continuidad y el hash es accesible):**

- Copiar el hash bcrypt a `password_hash` con prefijo `$2a$`/`$2b$`, que el check permite.
- En el login, detectar el prefijo, verificar con bcrypt en Go y, si es correcto, rehashear a Argon2id y actualizar `password_hash` + `password_changed_at` en la misma transacción.
- Tras una ventana definida, forzar reset a quienes sigan en bcrypt.

**Nunca:**

- Guardar contraseñas en claro, hashes en logs, hashes en `identity_events` ni hashes en respuestas de error.
- Migrar `encrypted_password` si no se puede garantizar el borrado seguro del staging.
- Usar el hash bcrypt como contraseña o como token.

### 4.6 Qué no se migra

| Objeto | Motivo | Consecuencia |
|---|---|---|
| `auth.sessions` | Formato y ciclo de vida de GoTrue; no es contrato estable. | Re-login obligatorio. |
| `auth.refresh_tokens` | Opacos, cifrados/ligados a GoTrue. | Re-login obligatorio. |
| `auth.mfa_factors` / `mfa_challenges` | Secretos MFA; requieren re-enrolamiento seguro. | Usuarios con MFA deben configurarla de nuevo. |
| `auth.flow_state`, `auth.one_time_tokens` | Efímeros. | Descartar. |
| `auth.audit_log_entries` | Puede contener PII/secretos; no es necesario para operar. | Conservar solo si legal lo exige, fuera de la base nueva. |
| `storage.*`, `realtime.*` | No son identidad. | Ver tareas #2/#7. |

### 4.7 Validaciones de migración (solo lectura, no destructivas)

```sql
-- Conteos de origen y destino (ejecutar en staging, no en PROD).
select count(*) as auth_users from auth.users;
select count(*) as legacy_profiles from public.users;
select count(*) as new_users from users;
select count(*) as new_memberships from memberships;

-- Perfiles sin cuenta global.
select count(*) from public.users u
left join users nu on nu.user_id = u.auth_user_id
where nu.user_id is null;

-- Cuentas sin membresía (puede ser legítimo: usuarios de plataforma).
select count(*) from users u
left join memberships m on m.user_id = u.user_id
where m.membership_id is null;

-- Emails duplicados activos.
select email, count(*) from users
where deleted_at is null
group by email having count(*) > 1;

-- Membresías con usuario de otro tenant (debe ser 0 por FK).
select count(*) from memberships m
join users u on u.user_id = m.user_id
where u.user_id is null;

-- Roles asignados a membresías de otro tenant (debe ser 0).
select count(*) from membership_roles mr
join memberships m on m.membership_id = mr.membership_id
where m.tenant_id <> mr.tenant_id;

-- Integridad de refresh tokens.
select count(*) from refresh_tokens where octet_length(token_hash) <> 32;
```

Los conteos deben compararse por tenant y por tabla, y ejecutarse antes y después del corte. No se ejecutó ninguna de estas consultas en esta tarea.

---

## 5. Hash de contraseñas con Argon2id

### 5.1 Formato almacenado

Se almacena el **PHC string** completo, que incluye algoritmo, versión, parámetros, salt y tag:

```text
$argon2id$v=19$m=65536,t=3,p=1$<salt-base64>$<hash-base64>
```

- `salt`: 16 bytes aleatorios por usuario (`crypto/rand`), no un salt global.
- `hash`: 32 bytes.
- `password_hash` es `text`; el check de §3.3 acepta `$argon2id$` y, solo durante la transición, bcrypt `$2a$`/`$2b$`/`$2y$`.
- No se guarda el algoritmo en una columna separada: el prefijo PHC es la fuente de verdad y permite migrar parámetros sin cambiar el esquema.

### 5.2 Parámetros recomendados y configurables

| Parámetro | Base recomendada | Mínimo aceptable | Configuración |
|---|---:|---:|---|
| Memoria (`m`) | 65 536 KiB (64 MiB) | 19 456 KiB (19 MiB) | `AUTH_ARGON2_MEMORY_KIB` |
| Iteraciones (`t`) | 3 | 2 | `AUTH_ARGON2_ITERATIONS` |
| Paralelismo (`p`) | 1 | 1 | `AUTH_ARGON2_PARALLELISM` |
| Salt | 16 bytes | 16 bytes | `AUTH_ARGON2_SALT_BYTES` (no configurable a menos) |
| Tag | 32 bytes | 32 bytes | `AUTH_ARGON2_KEY_BYTES` |
| Versión | 19 (`0x13`) | 19 | fijada por la librería |

Los valores concretos se eligen por entorno y se documentan en la configuración del servicio; **no se escriben secretos reales en el repositorio**. El objetivo es ~50–150 ms por hash en el hardware de despliegue; se debe medir y ajustar, no copiar el número sin benchmark. Un valor demasiado alto permite DoS por login; uno demasiado bajo debilita el hash.

Reglas de operación:

1. **Verificar con los parámetros almacenados**, no con los actuales. Si el PHC trae `m=65536,t=3,p=1`, se usa eso.
2. **Rehash en login** si el PHC usa parámetros inferiores a la política actual; actualizar `password_hash` y `password_changed_at`.
3. **Comparación en tiempo constante** (`subtle.ConstantTimeCompare` o la API de la librería).
4. **Hash ficticio** para emails inexistentes, con el mismo costo, para no filtrar existencia por timing.
5. **Límite de longitud** de contraseña (por ejemplo, 8–256 caracteres; rechazar entradas gigantes antes de Argon2).
6. **Pepper opcional:** si se usa, aplicarlo como HMAC-SHA-256 con una clave del secret manager antes de Argon2; documentar que rotar el pepper exige rehash y que no se guarda en la base. Recomendación inicial: **sin pepper**, para simplificar la operación; el hash Argon2id con salt es suficiente.
7. **No usar `pgcrypto`** para Argon2id: PostgreSQL no lo implementa de forma estándar. El cálculo vive en Go (`golang.org/x/crypto/argon2`), que ya es el runtime del backend.

### 5.3 Migración y rehash

| Situación | Acción |
|---|---|
| `password_hash` nulo | Invitación/reset; no permitir login con contraseña. |
| `password_hash` Argon2id con parámetros actuales | Verificar normal. |
| `password_hash` Argon2id con parámetros antiguos | Verificar y rehashear en login. |
| `password_hash` bcrypt (transición) | Verificar bcrypt; si es correcto, rehashear a Argon2id y borrar el bcrypt. |
| Hash corrupto o algoritmo desconocido | Rechazar login, registrar `login_failed` con motivo técnico, forzar reset. |
| Contraseña comprometida (futuro) | Revocar sesiones, forzar cambio, auditar. |

### 5.4 Política de contraseñas y anti-enumeración

- Longitud mínima 12 caracteres para cuentas nuevas (o 8 si el producto lo exige); máximo 256.
- No imponer composición arbitraria; sí comprobar contra listas de contraseñas filtradas si se dispone de ellas.
- Rate limit por IP y por cuenta; backoff exponencial; bloqueo temporal tras N fallos.
- Mensaje de error uniforme: «credenciales inválidas», sin distinguir email inexistente, cuenta deshabilitada o contraseña incorrecta.
- No registrar el email completo en logs de fallo; usar hash o ID interno.
- Reset de contraseña: token aleatorio de 256 bits, hash SHA-256 en base, un solo uso, TTL 15–30 min, invalidar tokens anteriores, revocar sesiones tras el cambio.

---

## 6. Sesiones, refresh tokens y revocación

### 6.1 Modelo de tokens

| Token | Formato | Vida | Almacenamiento | Revocación |
|---|---|---|---|---|
| Access | JWT firmado (Ed25519 o RS256 con `kid`) | 10–15 min | Cliente (memoria/cookie segura) | TTL corto; `sid` y estado de sesión |
| Refresh | Opaco, 32 bytes aleatorios (base64url) | 30 días absolutos; rotación por uso | Solo hash SHA-256 en `refresh_tokens` | `revoked_at`, consumo, familia |
| Reset/verificación | Opaco, 32 bytes | 15–30 min | Hash SHA-256 en tabla futura | Un solo uso |
| Invitación | Opaco, 32 bytes | 24–72 h | Hash SHA-256 en tabla futura | Un solo uso |

El access token **no** se guarda en la base. Claims mínimos:

```json
{
  "sub": "<users.user_id>",
  "tid": "<tenants.tenant_id>",
  "mid": "<memberships.membership_id>",
  "sid": "<sessions.session_id>",
  "amr": ["pwd"],
  "iat": 0,
  "exp": 0,
  "jti": "<uuid>",
  "iss": "ofirone",
  "aud": "ofirone-api"
}
```

No incluir email, nombre, permisos completos ni datos sensibles. Los permisos se resuelven en el servidor por `membership_id` y se cachean con invalidación por versión de autorización. Si se incluyen roles/permisos en el token, deben ser pocos y con TTL corto; la fuente de verdad sigue siendo la base.

### 6.2 Ciclo de refresh con rotación

1. El cliente presenta el refresh token; el servicio calcula SHA-256 y busca `refresh_tokens.token_hash`.
2. En una transacción: bloquear la **sesión** y luego el **token** con `FOR UPDATE` (orden fijo para evitar deadlocks).
3. Validar sesión no revocada, no vencida; token no consumido, no revocado, no vencido; membresía y usuario activos; tenant activo.
4. Marcar el token actual `consumed_at = clock_timestamp()`.
5. Emitir un token nuevo con el mismo `family_id`, `replaced_by_token_id = nuevo`, `expires_at <= sessions.expires_at`.
6. Si el token presentado ya estaba consumido: **reuso**. Revocar toda la familia, revocar la sesión, registrar `refresh_reuse_detected` y devolver error genérico.
7. Confirmar la transacción; devolver el nuevo par solo una vez.

El refresh token nunca se devuelve en logs, mensajes de error ni auditoría. El hash SHA-256 es suficiente porque el token tiene 256 bits de entropía; no se necesita Argon2 para tokens aleatorios.

### 6.3 Revocación

| Evento | Acción |
|---|---|
| Logout | `sessions.revoked_at`, `revoke_reason='logout'`; revocar tokens pendientes de la sesión. |
| Logout global | Revocar todas las sesiones del `user_id` (o de la membresía, según el caso). |
| Cambio de contraseña | Revocar todas las sesiones excepto la actual (o todas, y re-login). |
| Reset de contraseña | Revocar todas las sesiones del usuario. |
| Cuenta deshabilitada | `users.status='disabled'`; rechazar refresh y API; revocar sesiones. |
| Membresía suspendida/revocada | Rechazar refresh y API para ese tenant; no afectar otras membresías. |
| Tenant suspendido | Rechazar refresh/API para ese tenant; conservar datos. |
| Reuso de refresh | Revocar familia y sesión; auditar; no revelar detalles al cliente. |
| Compromiso de clave JWT | Rotar `kid`; los access tokens antiguos expiran por TTL; revocar sesiones si es necesario. |

Los access tokens ya emitidos no se pueden invalidar instantáneamente sin estado. Con TTL de 10–15 min, la ventana es aceptable; si el negocio exige revocación inmediata, la API debe comprobar `sessions.revoked_at` en cada request (o una caché de `sid` revocados) y aceptar el costo. Esto se decide en D6.

### 6.4 Límites y almacenamiento en clientes

- Web: cookie `HttpOnly`, `Secure`, `SameSite=Lax` para refresh; access en memoria. Si se usa `Authorization: Bearer`, evitar `localStorage` para refresh.
- Mobile: almacenamiento seguro del sistema (Keychain/Keystore); no SQLite en claro.
- No registrar tokens en analytics, crash reports ni URLs.
- CSRF: si el refresh va en cookie, exigir `SameSite` y/o token anti-CSRF; si va en body, evaluar el riesgo de XSS.
- Expiración absoluta de sesión 30 días; inactividad 7 días (configurable). `last_seen_at` se actualiza con throttling (por ejemplo, cada 5 min) para no escribir en cada request.

### 6.5 Limpieza

- Borrar refresh tokens consumidos/revocados cuando la sesión haya vencido y haya pasado la retención de detección de reuso (por ejemplo, 30 días después de `sessions.expires_at`).
- Borrar sesiones vencidas/revocadas tras la retención.
- Conservar `identity_events` según la política de auditoría; no borrar en cascada con el usuario.
- Job programado (worker Go o cron) con lotes y `FOR UPDATE SKIP LOCKED`; nunca un `DELETE` masivo sin límite.

---

## 7. Auditoría de identidad

### 7.1 Por qué una tabla separada

`audit_log` existe y es de negocio: `tenant_id` sin FK, `user_id` nullable, `action`, `entity`, `before_data`, `after_data` ([`InitDB.sql:373-383`](../../shared/supabase/migrations/InitDB.sql#L373-L383)). No es adecuada para identidad porque:

- un login fallido puede no tener tenant ni usuario;
- un evento de plataforma (concesión de `platform_admin`) no pertenece a un tenant;
- mezclar PII de autenticación con auditoría comercial complica la retención;
- `audit_log` no tiene FK ni append-only forzado.

Se propone `identity_events`, append-only, con `tenant_id`/`user_id` opcionales.

### 7.2 Qué registrar

| Evento | Campos mínimos | No registrar |
|---|---|---|
| `login_succeeded` | `user_id`, `tenant_id`, `session_id`, `auth_method`, `ip_hash`, `ua_hash` | Email completo, token, contraseña |
| `login_failed` | `user_id` si se conoce, email hasheado o null, motivo técnico en `metadata` | Contraseña, hash, si el email existe |
| `logout` | `session_id`, `user_id` | Token |
| `refresh_rotated` | `session_id`, `family_id`, `refresh_token_id` | Token/hash |
| `refresh_reuse_detected` | `session_id`, `family_id`, `refresh_token_id` | Token/hash |
| `session_revoked` | `session_id`, `actor_user_id`, `revoke_reason` | — |
| `password_changed` | `user_id`, `actor_user_id` | Hash |
| `password_reset_requested` | `user_id`, canal | Token |
| `email_verified` | `user_id` | Token |
| `membership_created` / `membership_status_changed` | `tenant_id`, `membership_id`, `actor_user_id`, estado anterior/nuevo | Datos personales innecesarios |
| `role_assigned` / `role_revoked` | `tenant_id`, `membership_id`, `role_id`, `actor_user_id` | — |
| `oidc_linked` / `oidc_unlinked` | `user_id`, `auth_identity_id`, `issuer` | Tokens del IdP |
| `platform_admin_granted` / `platform_admin_revoked` | `user_id`, `actor_user_id`, `reason` | — |

### 7.3 Reglas

- **Append-only:** el rol de la API solo tiene `INSERT` (o lo hace el servicio de auth con `SECURITY DEFINER`); no `UPDATE`/`DELETE`. Si se necesita retención, un job con rol administrativo borra por fecha.
- **PII mínima:** `ip_hash` y `user_agent_hash` SHA-256 con un pepper opcional; no IP ni user-agent en claro. `metadata` solo con campos técnicos acotados (por ejemplo, `reason_code`, `provider`), nunca payloads completos.
- **Correlación:** `request_id`/`trace_id` en `metadata` para cruzar con logs de API.
- **Retención:** 90–365 días para eventos de login; 1–5 años para cambios de privilegios, según legal. Documentar y automatizar.
- **Acceso:** un administrador de tenant ve eventos de su tenant; `platform_admins` ve eventos globales; nadie ve hashes de tokens (no existen).
- **Inmutabilidad:** idealmente particionar por mes y usar `REVOKE UPDATE, DELETE`; si se particiona, el borrado es `DROP PARTITION` con retención.

---

## 8. Compatibilidad con OIDC futuro

### 8.1 Separar cuenta interna de identidad externa

`users.user_id` es el sujeto interno estable. `auth_identities` guarda la relación con cada proveedor:

- `issuer`: URL del emisor (`https://idp.example.com`).
- `subject`: claim `sub` del IdP.
- `provider`: etiqueta operativa (`oidc`, `google`, `microsoft`, etc.).
- `email_at_provider` y `email_verified_at`: solo para linking y diagnóstico; no se usan como clave.
- `unique (issuer, subject)`: un subject no puede pertenecer a dos cuentas.
- `unique (user_id, issuer, subject)`: evita duplicados del mismo vínculo.

El JWT de la API sigue usando `sub = users.user_id`, no el `sub` del IdP. Así se puede cambiar de proveedor sin reescribir tokens, sesiones ni FKs.

### 8.2 Vinculación de cuentas

| Caso | Regla |
|---|---|
| Usuario nuevo por OIDC | Crear `users` con email verificado por el IdP; crear `auth_identities`; no crear membresía ni admin. |
| Email ya existe y está verificado en ambos lados | Permitir linking **solo** con confirmación del usuario autenticado (login previo o email de confirmación). |
| Email ya existe pero no verificado en alguno de los lados | **No** auto-vincular; cuarentena o flujo de verificación. |
| Subject ya vinculado a otra cuenta | Rechazar; auditar `oidc_linked` fallido; posible incidente. |
| Usuario quiere desvincular su último método | Rechazar si no tiene contraseña u otro proveedor; evitar bloqueo. |
| Múltiples IdP | Permitir N `auth_identities` por usuario; el login elige proveedor. |

Nunca auto-vincular por email no verificado: es un vector clásico de account takeover.

### 8.3 Validación del ID token

- Verificar firma con JWKS del `issuer`, `alg` permitido (nunca `none`), `kid`, `iss`, `aud`, `exp`, `nbf`, `iat` y `nonce`/`state` en el flujo.
- Cachear JWKS con TTL y rotación; tolerancia de reloj pequeña (±60 s).
- Exigir `email_verified = true` para crear cuenta o vincular.
- No confiar en claims de rol/grupo sin allowlist y mapeo explícito; los grupos del IdP no son permisos de Ofirone.
- Si se usa back-channel logout, validar el token de logout y revocar la sesión local; si no, el logout del IdP no invalida el refresh local (documentarlo).

### 8.4 Claims y multi-tenant

| Claim | Uso |
|---|---|
| `sub` | Identidad en el IdP; se guarda en `auth_identities.subject`. |
| `email`, `email_verified` | Alta y linking; no autorización. |
| `name` | `display_name` inicial. |
| `groups` / `roles` | Solo si hay mapeo allowlist a roles locales; nunca `platform_admin` automático. |
| `tid` / `tenant` | No confiar para seleccionar tenant; la membresía se valida en la base. |

La selección de tenant es una decisión de la aplicación después del login: listar `memberships` activas, pedir selección si hay más de una, emitir un token con `tid`/`mid` de la membresía elegida. No se acepta `tenant_id` del cliente sin validar la membresía.

### 8.5 Transición desde contraseña

- `password_hash` nullable permite cuentas solo-OIDC.
- Un usuario puede tener contraseña y uno o más proveedores; el login ofrece ambos.
- Si el IdP exige MFA, se delega; las cuentas con contraseña necesitan TOTP/WebAuthn futuro (D7).
- Al desactivar un proveedor, revocar `auth_identities` y sesiones asociadas; no borrar la cuenta.
- Migración de `auth.identities` de Supabase: mapear `provider_id` y `identity_data->>'sub'`; si el proveedor no es OIDC estándar, guardar `provider` y documentar el mapeo.

---

## 9. RLS, contexto y autorización

### 9.1 Contexto de sesión

Se mantiene el patrón del baseline: `app.tenant_id` y `app.identity_id` como GUC locales de transacción, leídos por funciones privadas con `search_path` fijo ([`0001_core.up.sql:9-17`](../../database/migrations/0001_core.up.sql#L9-L17)). La API debe:

1. Validar el access token y la sesión.
2. Verificar que la membresía está activa y pertenece al tenant.
3. Abrir la transacción y ejecutar `set_config('app.tenant_id', …, true)` y `set_config('app.identity_id', …, true)`.
4. Ejecutar la operación; RLS filtra por tenant.
5. Confirmar/rollback.

El GUC **no es una credencial**: es un contexto de confianza del backend. Un cliente nunca lo establece directamente. Sin contexto, las políticas devuelven cero filas y rechazan escrituras.

### 9.2 Políticas propuestas

| Tabla | Política |
|---|---|
| `tenants` | `select` solo si `tenant_id = app_private.current_tenant_id()`; creación/eliminación con rol de provisión. |
| `users` | `select` solo si `user_id = app_private.current_identity_id()`; sin auto-escritura. |
| `memberships` | `ALL` con `tenant_id = current_tenant_id()` y `WITH CHECK` del mismo tenant. |
| `roles`, `role_permissions`, `membership_roles` | `ALL` por tenant; `WITH CHECK` impide mover a otro tenant. |
| `permissions` | `select` global para roles con `SELECT`; escritura solo por migrador/provisión. |
| `sessions` | `select` de la propia sesión o de sesiones del tenant según permiso; `update` de revocación solo por servicio autorizado. |
| `refresh_tokens` | Sin acceso para el rol de API; solo el servicio de auth (`BYPASSRLS` acotado) o funciones `SECURITY DEFINER` mínimas. |
| `auth_identities` | `select` propio; escritura solo por servicio de auth. |
| `identity_events` | `INSERT` por servicio de auth; `SELECT` por tenant con permiso de auditoría; sin `UPDATE`/`DELETE`. |
| `platform_admins` | Sin acceso API; solo provisión/administración de plataforma. |

Todas las tablas con `tenant_id` deben usar `ENABLE` y `FORCE ROW LEVEL SECURITY`, como en [`0002_identity.up.sql:127-145`](../../database/migrations/0002_identity.up.sql#L127-L145). El propietario de las tablas no debe ser el rol de la API; `FORCE` no protege contra superusuario/`BYPASSRLS`.

### 9.3 Qué queda en PostgreSQL y qué en Go

| Control | PostgreSQL | Go |
|---|---|---|
| Aislamiento por tenant | FK compuestas + RLS | Verificación de contexto y membresía |
| RBAC (permisos) | Catálogo y asignaciones | Evaluación por caso de uso; caché con invalidación |
| Propiedad de sesión | FK y estados | Reglas de revocación y rotación |
| Superadmin | `platform_admins` | Verificación explícita; nunca por ausencia |
| Límites de plan | Triggers/constraints si aplica | Validación de negocio |
| Auditoría | Append-only y grants | Emisión de eventos y correlación |
| Rate limiting | No | Middleware/Redis o memoria |

**Regla:** RLS es defensa en profundidad, no la única autorización. Un `SELECT` permitido por RLS todavía debe pasar la validación de permiso del caso de uso.

### 9.4 Casos negativos de prueba (para la tarea #4)

| # | Caso | Resultado esperado |
|---:|---|---|
| 1 | Tenant A lee `memberships` de B con contexto A | 0 filas |
| 2 | Tenant A inserta membresía con `tenant_id = B` | Error de `WITH CHECK`/FK |
| 3 | Sesión de A con `membership_id` de B | FK compuesta rechaza |
| 4 | Refresh token de A usado en sesión de B | FK/validación rechaza |
| 5 | Usuario sin contexto consulta `users` | 0 filas |
| 6 | Usuario A lee `users` de B | 0 filas (solo self) |
| 7 | Rol de A asignado a membresía de B | FK compuesta rechaza |
| 8 | API sin `BYPASSRLS` intenta `SELECT` global | Solo filas del tenant |
| 9 | `platform_admin` no concedido intenta administrar plataforma | `403`/`denied` auditado |
| 10 | Reuso de refresh consumido | Sesión y familia revocadas |

---

## 10. Decisiones abiertas

| ID | Decisión | Opciones | Recomendación | Bloquea |
|---|---|---|---|---|
| D1 | Nombre físico de la cuenta global | `identities` (actual) vs `users` (encargo) vs rename + vistas | Mantener `identities` y usar `users` como nombre de contrato; rename solo con justificación | Implementación de auth |
| D2 | Unicidad global de email | Global activo vs por tenant vs por proveedor | Global para emails activos; cuentas eliminadas fuera del índice | Migración |
| D3 | Auto-vinculación OIDC por email | Nunca vs solo verificado en ambos vs siempre | Solo si ambos están verificados y con confirmación | OIDC |
| D4 | Representación de superadmin | `platform_admins` vs permiso global vs rol de tenant | `platform_admins` explícito y auditado | Migración de admins |
| D5 | Transición de contraseñas | Reset forzado vs bcrypt temporal + rehash | Reset forzado; bcrypt temporal solo con aprobación | Corte |
| D6 | Revocación de access tokens | Solo TTL vs chequeo de sesión por request | TTL 10–15 min; chequeo de sesión para operaciones sensibles | API auth |
| D7 | MFA | Delegar a OIDC vs TOTP propio vs WebAuthn | Delegar en OIDC; TOTP para cuentas con contraseña en fase 2 | Producto |
| D8 | Unicidad de teléfono | Global vs por tenant vs ninguna | Por tenant/membresía si se usa para login; no bloquear migración | Migración |
| D9 | Soft delete y retención | Borrado lógico vs anonimización vs borrado físico | Lógico + anonimización tras retención legal | Legal |
| D10 | RLS como defensa vs autorización principal | RLS + Go vs solo Go | RLS + Go; nunca solo RLS | Tarea #4 |
| D11 | Quién crea tenants | Provisión de plataforma vs autoservicio | Provisión explícita inicial; autoservicio con verificación después | Producto |
| D12 | Email case-insensitive | Normalizar a lower vs `citext` | Normalizar en app + check; sin extensión | Esquema |
| D13 | Retención de `identity_events` | 90 días vs 1 año vs 5 años | 1 año login; 5 años privilegios; configurable | Legal |
| D14 | Rol de servicio de auth | `BYPASSRLS` acotado vs funciones `SECURITY DEFINER` | Rol dedicado con `BYPASSRLS`, sin DDL, pool separado | Implementación |
| D15 | Tablas de invitación/reset | Ahora vs fase 2 | Fase 2, pero el flujo de migración las necesita para activar cuentas | Migración |
| D16 | Permisos por tenant | Global (actual) vs por tenant | Global inicial; evaluar `tenant_id` si el producto lo exige | Producto |
| D17 | Multi-membresía en UI | Selector de tenant vs una cuenta por tenant | Selector; la API debe exponer `memberships` activas | Web/mobile |
| D18 | `permissions.code` vs `id` en tokens | Código vs UUID | Código estable; no meter permisos completos en el token | API |

---

## 11. Riesgos

| # | Riesgo | Severidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Colisión de emails entre tenants al globalizar | Alta | Pérdida/fusión incorrecta de cuentas | Staging, informe de duplicados, cuarentena, decisión manual |
| R2 | Perfiles con `auth_user_id` sintético | Alta | Cuentas que no pueden iniciar sesión | Detección, invitación/reset, no borrar |
| R3 | Regla histórica de superadmin por ausencia | Crítica | Escalada de privilegios | Eliminar `fn_is_super_admin`; `platform_admins` explícito; auditoría |
| R4 | FKs de negocio apuntan a `users.user_id` histórico | Alta | Ruptura de integridad al dividir la tabla | `membership_id = user_id` histórico; reapuntar FK en tarea #7 |
| R5 | No se pueden exportar hashes de Auth | Alta | Usuarios deben resetear contraseña | Comunicación, tokens de activación, ventana de transición |
| R6 | Access tokens no revocables al instante | Media | Ventana de 10–15 min tras revocación | TTL corto; chequeo de sesión en operaciones sensibles |
| R7 | Reuso de refresh no detectado | Alta | Sesión comprometida persiste | Rotación + familia + `consumed_at` + revocación |
| R8 | RLS mal configurada o `BYPASSRLS` en API | Alta | Fuga entre tenants | Rol sin bypass, `FORCE RLS`, tests negativos |
| R9 | Account takeover por linking OIDC con email no verificado | Crítica | Suplantación | Exigir `email_verified` en ambos lados; confirmación |
| R10 | Auditoría con PII o tokens | Media | Incidente de privacidad | Hash de IP/UA; lista blanca de metadata; revisión |
| R11 | Clientes asumen una sola membresía | Media | Login roto en multi-tenant | Cambio de contrato + selector de tenant (fuera de perímetro) |
| R12 | Migración sin rollback | Alta | Pérdida de datos | Staging, backup, esquema de cuarentena, corte reversible |
| R13 | DoS por Argon2id con parámetros altos | Media | Latencia/CPU | Benchmark, rate limit, límite de longitud, cola |
| R14 | `platform_admins` incompleto | Alta | Bloqueo de administradores reales | Lista candidata revisada; período de doble control |
| R15 | DEV vacía/PROD bloqueado | Alta | No se puede validar contra datos reales | Análisis estático; pruebas en PostgreSQL local; solicitar réplica segura |
| R16 | Divergencia documental sobre migraciones aplicadas | Media | Decisiones sobre supuestos falsos | Verificar `schema_migrations`/objetos antes de implementar |
| R17 | Permisos globales sin tenant | Media | Imposible permiso específico por tenant | D16; evaluar `tenant_id` en `permissions` |
| R18 | Fuga de tokens en logs/crash reports | Alta | Secuestro de sesión | Redacción, lint de logs, no PII |
| R19 | Códigos de permiso históricos en mayúsculas vs baseline en minúsculas | Media | Permisos que dejan de coincidir | Normalizar catálogo y literales de `has_permission` en una misma migración; probar cada permiso |

---

## 12. PROPUESTA PENDIENTE (fuera de `docs/` y `tools/`)

> **No implementado.** Esta sección existe para cumplir la regla del perímetro: cualquier cambio en código, migraciones, contratos o configuración debe aprobarlo el agente principal. Nada de lo siguiente se ejecutó ni se modificó en esta tarea.

### 12.1 Migraciones y base de datos

- Crear `database/migrations/0003_identity_hardening.up.sql` / `.down.sql` con:
  - columnas nuevas en `identities`/`tenant_memberships`/`sessions`/`refresh_tokens`;
  - tablas `auth_identities`, `identity_events`, `platform_admins`, `legacy_user_ids`;
  - triggers de `updated_at` y políticas RLS;
  - grants mínimos para el rol de API y el servicio de auth.
- Si se adopta D1 con rename: migración separada, vistas de compatibilidad y reapuntado de FK; no mezclar con el hardening.
- Añadir tabla de control de migraciones (`schema_migrations` con checksum) — sigue pendiente del plan ([schema-inventory.md P2](schema-inventory.md#L557)).

### 12.2 Backend Go

- Implementar el servicio de identidad: login, refresh, logout, revocación, reset, verificación, Argon2id, JWT con `kid`, rate limiting y anti-enumeración.
- Definir puertos/interfaces y repositorios; no acoplar a `pgx` en el dominio.
- Establecer el contexto `app.tenant_id`/`app.identity_id` en la transacción, después de validar la sesión.
- Separar el pool del servicio de auth (privilegios mínimos) del pool de la API comercial.
- Añadir pruebas unitarias de hash/tokens y de integración con PostgreSQL real.

### 12.3 Contratos y clientes

- Exponer `GET /api/v1/auth/me` con `user`, `memberships`, `active_tenant`, roles/permisos.
- Añadir selección de tenant/membresía y refresh token rotation al contrato.
- Adaptar `web/src/composables/useAuth.js`, `web/src/services/users.service.js` y equivalentes mobile para dejar de consultar `users` por `auth_user_id` y asumir una sola fila.
- Sustituir `create-tenant-user` y `change_user_password` por endpoints Go; retirar la dependencia de `auth.admin`.
- Actualizar `shared/contracts` (fuera de perímetro) y documentar breaking changes.

### 12.4 Operación y seguridad

- Configurar `AUTH_ARGON2_*`, TTLs, pepper (si se usa) y claves JWT en el secret manager; nunca en el repositorio.
- Definir backup/restore y prueba de rollback antes del corte.
- Configurar alertas de `refresh_reuse_detected`, fallos de login y latencia de Argon2id.
- Revisar retención de `identity_events` con legal.
- Verificar en DEV/PROD la existencia real de `profiles`, `auth.identities` y hashes antes de cualquier extracción.

### 12.5 Validación pendiente

- Ejecutar el DDL en PostgreSQL 15+ desechable, aplicar `0001`/`0002`/`0003`, correr pruebas y hacer `down` + segundo `up`.
- Medir Argon2id en el hardware objetivo.
- Probar rotación concurrente de refresh y reuso.
- Probar aislamiento A/B y RLS sin contexto.
- Comparar conteos de migración por tenant.

---

## 13. Criterios de aceptación de esta propuesta

- [x] Tablas de usuarios, tenants, membresías, roles, permisos, sesiones y refresh tokens definidas con PK, FK, unique, check e índices.
- [x] Correspondencia explícita con `public.users`, `auth_user_id`, `user_roles`, `roles` y `permissions`.
- [x] Mapeo de campos de `auth.users` y reglas de conflicto.
- [x] Estrategia Argon2id con parámetros configurables, sin secretos reales.
- [x] Auditoría y revocación de sesiones/refresh tokens.
- [x] Compatibilidad OIDC y linking seguro.
- [x] Decisiones abiertas y riesgos con mitigación.
- [x] Sección de propuesta pendiente fuera de `docs/`/`tools/`.
- [ ] Validación en PostgreSQL real (pendiente; no se ejecutó DDL).
- [ ] Aprobación de D1–D18 por el agente principal.

---

## 14. Anexos

### 14.1 Mapeo rápido histórico → propuesta

| Histórico | Propuesta | Nota |
|---|---|---|
| `tenants.tenant_id` | `tenants.tenant_id` | Conservar UUID. |
| `tenants.name` | `tenants.name` | Añadir `slug` si no existe. |
| `users.user_id` | `memberships.membership_id` | UUID histórico tenant-scoped. |
| `users.auth_user_id` | `users.user_id` | Cuenta global. |
| `users.tenant_id` | `memberships.tenant_id` | — |
| `users.email` | `users.email` | Globalizar y deduplicar. |
| `users.full_name` | `users.display_name` | — |
| `users.is_active` | `users.status` + `memberships.status` | — |
| `roles.role_id` | `roles.role_id` | Conservar. |
| `roles.name` | `roles.name` + `roles.code` | Generar código. |
| `permissions.permission_id` | `permissions.permission_id` | Conservar. |
| `permissions.code` | `permissions.code` | Conservar. |
| `user_roles` | `membership_roles` | `user_id` → `membership_id`. |
| `role_permissions` | `role_permissions` | Añadir `tenant_id` y FK compuesta. |
| `auth.users.id` | `users.user_id` | Conservar. |
| `auth.users.email` | `users.email` | Normalizar. |
| `auth.users.encrypted_password` | `users.password_hash` | Solo transición; preferir reset. |

### 14.2 Checklist de implementación futura

- [ ] Aprobar D1–D18.
- [ ] Verificar estado real de DEV/PROD (objetos, `profiles`, `auth.identities`).
- [ ] Crear migración `0003` con DDL y rollback.
- [ ] Migrar datos en staging y validar conteos.
- [ ] Implementar servicio de auth y Argon2id.
- [ ] Implementar refresh rotation/reuse detection.
- [ ] Implementar `platform_admins` y retirar `fn_is_super_admin`.
- [ ] Adaptar API y clientes a multi-membresía.
- [ ] Probar aislamiento, revocación, OIDC y rollback.
- [ ] Documentar operación y retención.

### 14.3 Referencias citadas

- [InitDB.sql](../../shared/supabase/migrations/InitDB.sql) — `tenants`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_log`.
- [RLS_Security.sql](../../shared/supabase/migrations/RLS_Security.sql) — helpers `get_current_user_tenant_id`, `has_permission`.
- [FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql) — regla de superadmin por ausencia.
- [FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql) — UUID sintético.
- [UserFunctions.sql](../../shared/supabase/migrations/UserFunctions.sql) — `change_user_password` sin efecto.
- [ADD_TENANT_BILLING_MONETIZATION.sql](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql) — fallback a `profiles`.
- [create-tenant-user/index.ts](../../shared/supabase/functions/create-tenant-user/index.ts) — Auth Admin API.
- [0001_core.up.sql](../../database/migrations/0001_core.up.sql) y [0002_identity.up.sql](../../database/migrations/0002_identity.up.sql) — baseline portable.
- [identity-implementation.md](identity-implementation.md) — decisiones y pendientes del baseline.
- [schema-inventory.md](schema-inventory.md) — inventario y riesgos.
- [supabase-dependencies.md](supabase-dependencies.md) — dependencias de Auth.
- [rpc-migration-matrix.md](rpc-migration-matrix.md) — clasificación de funciones de identidad.
- [MIGRACION_BACKEND_GO_POSTGRES.md](../../MIGRACION_BACKEND_GO_POSTGRES.md) — plan general y estado de DEV.
