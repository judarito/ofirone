# Dependencias de Supabase — análisis estático

- **Fecha:** 2026-11-08
- **Tarea:** #2 de [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md)
- **Estado:** completada con limitaciones (análisis estático; sin observación del esquema desplegado)
- **Fuente canónica:** [`shared/supabase/migrations/`](../../shared/supabase/migrations/) — 161 archivos `.sql`
- **Fuentes adicionales:** [`web/migrations/`](../../web/migrations/) (17 archivos propios) y [`mobile/migrations/`](../../mobile/migrations/) (11 propios)
- **Artefacto de evidencia:** [`_data/supabase-deps.json`](_data/supabase-deps.json)
- **Script reproducible:** [`tools/database/supabase_dependency_scan.py`](../../tools/database/supabase_dependency_scan.py)
- **Inventario relacionado:** [`schema-inventory.md`](schema-inventory.md)

> **Regla de lectura.** Todos los conteos son **sentencias o referencias en archivos**, no el estado final de una base. Las redefiniciones y el DDL dinámico pueden inflar o esconder objetos. Donde no fue posible confirmar el estado desplegado se indica **«a verificar»**. No se repitieron conexiones: DEV está vacía y PROD está bloqueado por política (ver [`schema-inventory.md`](schema-inventory.md) §2.2).

---

## 1. Resumen ejecutivo

### 1.1 Métricas principales

| Dependencia | Canónico (`shared/`) | Extras (`web/` + `mobile/`) | Lectura |
|---|---:|---:|---|
| Archivos `.sql` analizados | 161 | 28 | 189 archivos distintos por nombre |
| `auth.uid()` | **160** refs / 29 archivos | 41 / 12 archivos | **201 refs / 41 archivos** en total |
| `auth.role()` | 12 / 3 archivos | 0 | Todo el uso canónico está en billing y signups |
| `auth.jwt()` | 1 (comentario) | 4 / 2 archivos | Canónico: solo diagnóstico; extras: contabilidad |
| `auth.email()` | 2 / 1 archivo | 1 | Claims de email usados en logs y respuestas |
| `auth.users` | 1 (comentario) | 0 | **No hay DDL/DML contra `auth.users` en migraciones** |
| Columna `auth_user_id` | 171 / 30 archivos | 42 / 12 archivos | Puente real entre identidad y negocio |
| Políticas RLS (`create policy`) | **223** (218 únicas) | 57 (52 únicas + 5 plantillas dinámicas) | 280 sentencias en total |
| Políticas que usan `auth.*` directo | 85 (83 `uid` + 2 `role`) | 24 | 109 directas |
| Políticas que usan helpers de identidad | 132 | 32 | `get_current_user_tenant_id`, `has_permission`, etc. |
| Políticas sin dependencia de identidad | 16 | 1 | Catálogos, `USING (true)`, `FALSE`, `anon` |
| Tablas con RLS habilitado | 74 | 15 resueltas + 28 en plantillas dinámicas | Hasta 117 en el papel (74 + 15 + 28), sin descontar solapamientos |
| Políticas sobre `storage.objects` | 8 | 4 | 12 en total |
| Buckets referenciados por SQL | 3 | 1 (ya referenciado en `shared/`) | `storefront`, `dataimport`, `productmedia` |
| Tablas publicadas en `supabase_realtime` | 1 alta (`system_alerts`) + 1 baja (`third_parties`) | 1 alta (`notifications`) | No incluye tablas no publicadas |
| Extensiones | 2 (`pgcrypto`, `pg_cron`) | +`pg_net`; `vault` sin `create extension` | `vault` es provisto por la plataforma |
| Jobs de `pg_cron` | 1 | 2 | 3 nombres de job |
| Archivos con `NOTIFY pgrst` | 19 | 1 | Dependencia de PostgREST, no de PostgreSQL |
| Funciones con claims/identidad | 28 nombres / 40 definiciones | 14 nombres / 19 definiciones | 42 entradas; `fn_current_user_tenant_id` se repite |
| Edge Functions | 13 | 7 adicionales | 20 nombres únicos |

### 1.2 Hallazgos que condicionan la migración

1. **La autorización es, en la práctica, Supabase Auth.** De 223 políticas canónicas, **207 (93 %) dependen de `auth.uid()` directa o indirectamente**; solo 16 no lo hacen. No es un detalle de RLS: es el modelo de autorización completo.
2. **«Superadmin = usuario autenticado sin perfil en `public.users`»** es una regla de negocio implementada en funciones y políticas ([`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:17-28`](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql#L17-L28)). Fuera de Supabase ese concepto no existe; además, si el proveedor permite auto-registro, cualquier cuenta nueva sin perfil sería superadmin. **Riesgo crítico a verificar en PROD.**
3. **`create_auth_user` no crea usuarios de Auth.** Genera un UUID sintético y comenta que la creación real debe hacerse con la Admin API ([`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:42-44`](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L42-L44)). Se pueden haber creado perfiles huérfanos sin credenciales.
4. **Storage no es portable como esquema:** `storage.objects`, `storage.buckets`, `storage.create_bucket` y `storage.foldername()` son de la plataforma. Hay 12 políticas sobre `storage.objects` y un bucket público con comprobantes de pago subidos por `anon`.
5. **Realtime se apoya en una publicación creada por Supabase** (`supabase_realtime`). Dos tablas (`system_alerts`, `notifications`) y seis handlers de cliente en cinco archivos dependen de `postgres_changes`.
6. **El único puente SQL → Edge Function** es `net.http_post` con URL y secreto leídos de Vault (`PUSH_DISPATCHER_URL`, `PUSH_DISPATCHER_SECRET`), en migraciones **solo de `web/` y `mobile/`**; no está en el directorio canónico.
7. **`pg_net` y `vault` no aparecen en `shared/`**, pero sí en extras. `pg_cron` sí está en el canónico. La conclusión de que «no había `pg_net` ni `vault`» aplica solo a `shared/`; **el esquema realmente desplegado puede incluirlos**.
8. **No se detectó `supabase_functions`** en SQL ni en Edge Functions. Los webhooks se implementan como Edge Functions (`mercadopago-webhook`), no con el esquema `supabase_functions`.
9. **El directorio canónico está incompleto.** La migración móvil [`HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql`](../../mobile/migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql) habilita RLS en 28 tablas del núcleo y genera hasta 87 políticas por plantilla; nada de eso está en `shared/`.

---

## 2. Metodología y límites

### 2.1 Qué se hizo

1. Lectura estática de los 161 archivos de [`shared/supabase/migrations/`](../../shared/supabase/migrations/), más los 28 archivos que solo existen en `web/` o `mobile/` (comparación por nombre).
2. Búsqueda de patrones de identidad, storage, realtime, extensiones, roles, PostgREST y Edge Functions.
3. Extracción de políticas RLS: nombre, tabla y cuerpo, con conteo directo (`auth.*`) e indirecto (helpers que a su vez usan `auth.uid()`).
4. Extracción de funciones por bloque `$$ … $$`: nombre, archivo, línea y APIs de identidad usadas en el cuerpo.
5. Lectura puntual de Edge Functions para verificar el uso de Auth Admin, `SUPABASE_*` y secretos, y de clientes para verificar buckets y `postgres_changes`.
6. Generación reproducible de [`_data/supabase-deps.json`](_data/supabase-deps.json):

```bash
python3 tools/database/supabase_dependency_scan.py --include-extras \
  --json docs/database-portability/_data/supabase-deps.json
```

### 2.2 Límites explícitos

- **No es un parser SQL.** El DDL dinámico (`EXECUTE format('CREATE POLICY … %I …')`) se detecta como texto, no como objeto resuelto. Por eso se informa como «plantilla dinámica» y no como tabla.
- **DEV vacía y PROD bloqueado.** No hay observación del esquema desplegado: ni `pg_policies`, ni `pg_proc`, ni `pg_publication_tables`, ni `storage.buckets` reales. Todo el análisis es textual.
- **Orden de migraciones desconocido.** Una función puede estar redefinida y la «última aparición textual» no es necesariamente la vigente. Hay 49 funciones redefinidas en el canónico.
- **El conteo de políticas subestima el despliegue.** La migración móvil de hardening usa 5 plantillas que pueden generar hasta 87 políticas sobre 28 tablas; el escáner las cuenta como 5 sentencias dinámicas.
- **Los `grant` reales no se verificaron.** El repo declara grants a `anon`, `authenticated` y `service_role`, pero los permisos efectivos dependen de la base.
- **No se inspeccionaron los cuerpos de las 46 vistas** ni se resolvió si usan `security_invoker`; sus dependencias de `auth.uid()` quedan **a verificar** (algunas vistas por rol sí lo usan, ver §8).

---

## 3. Dependencias de identidad

### 3.1 `auth.uid()`

| Aspecto | Dato | Evidencia |
|---|---|---|
| Referencias canónicas | **160** en **29 archivos** | [`_data/supabase-deps.json`](_data/supabase-deps.json) |
| Uso en políticas RLS | **83 políticas** lo invocan directamente | §7 |
| Uso indirecto en políticas | **132 políticas** llaman a helpers que lo usan | §7.2 |
| Funciones dependientes de identidad (cualquier claim) | **28 nombres / 40 definiciones** (32 usan `auth.uid()`) | §8 |
| Archivos con más referencias | `SECURITY_FIXES.sql` (30), `ADD_ONLINE_STORE_MVP.sql` (14), `FIX_RLS_ALL_TABLES.sql` (12), `FIX_RLS_CASHIER_RESTRICTIONS.sql` (11), `FIX_RLS_CASHIER_PRIVACY.sql` (10) | [`SECURITY_FIXES.sql:196`](../../shared/supabase/migrations/SECURITY_FIXES.sql#L196), [`ADD_ONLINE_STORE_MVP.sql:61`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L61) |

Patrón dominante: `users.auth_user_id = auth.uid()` para resolver el tenant y el usuario de negocio. Ejemplos:

- [`RLS_Security.sql:6-14`](../../shared/supabase/migrations/RLS_Security.sql#L6-L14): `get_current_user_tenant_id()`.
- [`RLS_Security.sql:16-27`](../../shared/supabase/migrations/RLS_Security.sql#L16-L27): `has_permission()`.
- [`FIX_RLS_CASHIER_PRIVACY.sql:19-33`](../../shared/supabase/migrations/FIX_RLS_CASHIER_PRIVACY.sql#L19-L33): `is_user_admin()`.
- [`ADD_ASYNC_JOB_QUEUE.sql:211`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L211): `fn_enqueue_async_job` usa `auth.uid()` como actor.

**Consecuencia:** `auth.uid()` no es una función de PostgreSQL estándar. Si el baseline se ejecuta en PostgreSQL limpio, **fallan las 207 políticas que dependen de identidad y las 32 definiciones de función que invocan `auth.uid()`** (40 si se cuentan todas las que dependen de claims), salvo que se defina un reemplazo o se reescriban.

### 3.2 `auth.role()`, `auth.email()` y `auth.jwt()`

| API | Refs canónicas | Archivos | Uso real | Evidencia |
|---|---:|---:|---|---|
| `auth.role()` | 12 | 3 | Autorización de operaciones de billing y lectura de signups por `service_role` | [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:41`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L41), [`ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:77-78`](../../shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql#L77-L78) |
| `auth.email()` | 2 | 1 | Log de superadmin y campo `superadmin_email` en la respuesta de `fn_create_tenant` | [`SECURE_TENANT_MANAGEMENT.sql:68`](../../shared/supabase/migrations/SECURE_TENANT_MANAGEMENT.sql#L68), [`SECURE_TENANT_MANAGEMENT.sql:231`](../../shared/supabase/migrations/SECURE_TENANT_MANAGEMENT.sql#L231) |
| `auth.jwt()` | 1 (comentario) | 1 | Solo una consulta de diagnóstico comentada | [`DIAGNOSE_BOM_ACCESS.sql:47`](../../shared/supabase/migrations/DIAGNOSE_BOM_ACCESS.sql#L47) |

`auth.role() = 'service_role'` se usa como **bypass de autorización** en funciones de billing:

- [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:170`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L170): si no es `service_role` ni superadmin, rechaza.
- [`ADD_TENANT_BILLING_RENEWALS.sql:55`](../../shared/supabase/migrations/ADD_TENANT_BILLING_RENEWALS.sql#L55) y [`ADD_TENANT_BILLING_RENEWALS.sql:325`](../../shared/supabase/migrations/ADD_TENANT_BILLING_RENEWALS.sql#L325): mismo patrón.
- [`ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:73-78`](../../shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql#L73-L78): políticas `FOR ALL` limitadas a `service_role`.

`service_role` es un rol de plataforma que **omite RLS** en Supabase. En PostgreSQL estándar no existe; crearlo con `BYPASSRLS` reproduciría el privilegio, no la semántica de autorización.

### 3.3 `auth.users` y el puente `auth_user_id`

- **No hay `create table auth.users` ni DML contra `auth.users` en las migraciones.** Solo un comentario que asume su existencia: [`CreateTenantSP.sql:324`](../../shared/supabase/migrations/CreateTenantSP.sql#L324).
- El puente real es `public.users.auth_user_id`:

```sql
create table users (
  user_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique, -- ID del usuario de Supabase Auth
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  ...
);
```

Evidencia: [`InitDB.sql:30-38`](../../shared/supabase/migrations/InitDB.sql#L30-L38).

| Hecho | Implicación |
|---|---|
| `auth_user_id` es `unique` pero **nullable** y **sin FK** a `auth.users` | Puede haber perfiles sin cuenta de Auth y cuentas sin perfil; la integridad no la garantiza la base |
| 171 referencias canónicas en 30 archivos | Es la clave de unión de todo el modelo; cambiarla afecta RLS, RPC y Edge Functions |
| `create_auth_user` inserta un UUID sintético | Crea perfiles que no pueden iniciar sesión; el mensaje de éxito es engañoso |
| `change_user_password` no cambia la contraseña | Solo devuelve un mensaje indicando que debe hacerse con la Admin API ([`UserFunctions.sql:122-127`](../../shared/supabase/migrations/UserFunctions.sql#L122-L127)) |

**Función de identidad real:** la creación/actualización de usuarios vive en Edge Functions con `auth.admin.*` (§6.6), no en SQL. Las migraciones no contienen el esquema de Auth ni los hashes de contraseña.

### 3.4 Fallback a `profiles` y deriva de esquema

`get_current_user_tenant_id()` intenta tres modelos distintos en tiempo de ejecución, consultando `information_schema`:

1. `public.users(auth_user_id, tenant_id)` — modelo vigente.
2. `public.profiles(id, tenant_id)` — modelo alterno.
3. `public.profiles(auth_user_id, tenant_id)` — variante.

Evidencia: [`ADD_TENANT_BILLING_MONETIZATION.sql:486-557`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L486-L557), con `EXECUTE 'select tenant_id from public.profiles where id = auth.uid() …'` en la línea 529.

**Riesgo:** si en PROD existe `profiles`, hay dos fuentes de verdad de identidad y el helper elige según el esquema. **A verificar** si `profiles` existe y qué datos contiene.

### 3.5 La regla «superadmin por ausencia de perfil»

Está implementada en al menos cinco archivos:

| Evidencia | Qué hace |
|---|---|
| [`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:17-28`](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql#L17-L28) | `return not exists(select 1 from users where auth_user_id = auth.uid())` |
| [`SECURE_TENANT_MANAGEMENT.sql:26-33`](../../shared/supabase/migrations/SECURE_TENANT_MANAGEMENT.sql#L26-L33) | Misma idea, con una versión anterior que compara `users.user_id = auth.uid()` |
| [`ADD_THIRD_PARTIES.sql:230-247`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L230-L247) | Políticas de lectura/escritura con `OR NOT EXISTS (…)` como «Superadmin» |
| [`RECREATE_THIRD_PARTIES.sql:94-109`](../../shared/supabase/migrations/RECREATE_THIRD_PARTIES.sql#L94-L109) | Repite las políticas con el mismo bypass |
| [`ROLES_MENUS_SYSTEM.sql:579-622`](../../shared/supabase/migrations/ROLES_MENUS_SYSTEM.sql#L579-L622) | Escritura de menús solo para quien no tiene perfil |

Además, la Edge Function [`create-tenant-user/index.ts:75-84`](../../shared/supabase/functions/create-tenant-user/index.ts#L75-L84) replica la regla en TypeScript.

**Por qué es crítico:** en Supabase, `auth.users` puede contener cuentas creadas por auto-registro, OAuth o invitaciones que aún no tienen fila en `public.users`. Cualquiera de esas cuentas sería superadmin. En un modelo portable con usuarios creados explícitamente, la regla deja de tener sentido y debe reemplazarse por un permiso explícito (`platform.superadmin` o similar).

### 3.6 Claims y headers

| Patrón | Canónico | Extras | Nota |
|---|---:|---:|---|
| `current_setting('request.jwt.claims', …)` | 0 | 8 | Contabilidad web; GUC inyectado por PostgREST |
| `current_setting('request.jwt.claim.role', …)` | 0 | 4 | Variante legacy del claim |
| `set_config('request.jwt.claim.role', …)` | 0 | 1 | [`ADD_SUPABASE_CRON_PIPELINES.sql:52`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L52) |
| `set_config('request.jwt.claims', …)` | 0 | 1 | [`ADD_SUPABASE_CRON_PIPELINES.sql:53`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L53) emula `service_role` |
| `request.headers` / `current_setting('request.headers')` | 0 | 0 | No hay dependencia SQL de headers HTTP |

El caso más delicado es `fn_accounting_process_queue_all_tenants`: para reutilizar una función que exige `service_role`, **escribe el claim en la sesión** y luego la invoca:

```sql
PERFORM set_config('request.jwt.claim.role', 'service_role', true);
PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
```

Evidencia: [`ADD_SUPABASE_CRON_PIPELINES.sql:50-65`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L50-L65). Fuera de Supabase, `auth.jwt()` no existe y el `set_config` no basta: la función falla antes de llegar al fallback.

---

## 4. Dependencias de Storage

### 4.1 Objetos de plataforma usados

| Objeto | Refs canónicas | Evidencia | Portabilidad |
|---|---:|---|---|
| `storage.objects` | 15 | [`SETUP_DATAIMPORT_BUCKET.sql:31-92`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L31-L92) | Tabla de plataforma; no existe en PostgreSQL limpio |
| `storage.buckets` | 5 | [`ADD_ONLINE_STORE_MVP.sql:31-41`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L31-L41) | Tabla de plataforma |
| `storage.create_bucket()` | 5 | [`SETUP_DATAIMPORT_BUCKET.sql:7`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L7) | Función de plataforma; el `EXCEPTION` la omite silenciosamente si no existe |
| `storage.foldername(name)` | 5 | [`ADD_ONLINE_STORE_MVP.sql:58`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L58) | Helper de Supabase Storage; en un bucket S3 se reemplaza por parsing de prefijo |
| `bucket_id` | 12 | [`ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:24`](../../shared/supabase/migrations/ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql#L24) | Columna de `storage.objects` |

### 4.2 Buckets declarados o usados

| Bucket | Visibilidad declarada | Dónde se crea / configura | Políticas | Consumidores |
|---|---|---|---|---|
| `storefront` | **Público** (`TRUE`) | [`ADD_ONLINE_STORE_MVP.sql:20`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L20), [`ADD_ONLINE_STORE_MVP.sql:31-41`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L31-L41), reafirmado en [`ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:6-8`](../../shared/supabase/migrations/ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql#L6-L8) | 4 (`storefront_auth_can_*` + `storefront_anon_can_upload_payment_proofs`) | Web: branding y comprobantes |
| `dataimport` | **Privado** (`FALSE`) | [`SETUP_DATAIMPORT_BUCKET.sql:7`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L7) | 4 (`dataimport_*`) + trigger de metadata | Web: importaciones masivas |
| `productmedia` | **Contradictorio:** se crea privado en móvil y se marca público en `shared` | Creación: [`ADD_PRODUCT_MEDIA_PHOTOS.sql:11`](../../mobile/migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql#L11); `UPDATE storage.buckets SET public = TRUE`: [`ADD_ONLINE_STORE_PUBLIC_IMAGES.sql:7-9`](../../shared/supabase/migrations/ADD_ONLINE_STORE_PUBLIC_IMAGES.sql#L7-L9) | 4 en móvil (`productmedia_*`) | Web y móvil: fotos de producto |
| `storefront/public-proofs/` | Carpeta dentro del bucket público | [`ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:19-26`](../../shared/supabase/migrations/ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql#L19-L26) | 1 (subida `anon`) | Tienda online: comprobantes de pago |

### 4.3 Políticas sobre `storage.objects`

**Canónico (8):**

1. `dataimport_select|insert|update|delete` filtran por `metadata->>'tenant_id' = fn_current_user_tenant_id()` ([`SETUP_DATAIMPORT_BUCKET.sql:31-65`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L31-L65)).
2. Un trigger `BEFORE INSERT` rellena `metadata.tenant_id` para evitar que el cliente lo falsifique ([`SETUP_DATAIMPORT_BUCKET.sql:68-92`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L68-L92)).
3. `storefront_auth_can_upload|update|delete` exigen que la primera carpeta sea el `tenant_id` del usuario ([`ADD_ONLINE_STORE_MVP.sql:52-117`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L52-L117)).
4. `storefront_anon_can_upload_payment_proofs` permite a **`anon` y `authenticated`** insertar en `storefront/public-proofs` sin más condición que la carpeta ([`ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:19-26`](../../shared/supabase/migrations/ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql#L19-L26)).

**Extras (4):** `productmedia_select|insert|update|delete`, con `storage.foldername(name))[1] = fn_current_user_tenant_id()::text` ([`ADD_PRODUCT_MEDIA_PHOTOS.sql:180-213`](../../mobile/migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql#L180-L213)).

### 4.4 Hallazgos de storage

- **Comprobantes de pago en bucket público:** `storefront` es público y la política permite subir a `public-proofs` a `anon`. Si el bucket es público, la lectura por URL pública no pasa por RLS: cualquier persona con la URL puede leer el comprobante. **Riesgo alto, a verificar en PROD.**
- **`productmedia` público vs. firmado:** el código web y móvil usa `createSignedUrl` para fotos de producto ([`productMedia.service.js:141`](../../web/src/services/productMedia.service.js#L141), [`productsCatalog.service.js:74`](../../mobile/src/services/productsCatalog.service.js#L74)), lo que presupone bucket privado. La migración canónica lo hace público. **Contradicción de configuración.**
- **Los objetos físicos no están en la base.** `storage.objects` solo guarda metadata; el binario vive en el backend de Storage. Una migración SQL no puede extraerlos.
- **`storage.create_bucket` va envuelto en `EXCEPTION`:** si no existe, la migración continúa y el bucket queda sin crear; el fallo es silencioso ([`SETUP_DATAIMPORT_BUCKET.sql:5-13`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L5-L13), [`ADD_ONLINE_STORE_MVP.sql:17-29`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L17-L29)).
- **Las políticas de `storage.objects` pueden fallar por permisos:** el propio repo advierte «must be owner of table objects» ([`SETUP_DATAIMPORT_BUCKET.sql:27-28`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L27-L28)).

---

## 5. Dependencias de Realtime

| Elemento | Evidencia | Detalle |
|---|---|---|
| Publicación `supabase_realtime` | [`FIX_STOCK_ALERTS_REALTIME.sql:59`](../../shared/supabase/migrations/FIX_STOCK_ALERTS_REALTIME.sql#L59) | `ALTER PUBLICATION supabase_realtime ADD TABLE system_alerts` |
| `system_alerts` (idempotente) | [`ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql:107-111`](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql#L107-L111) | Comprueba `pg_publication_tables` antes de añadir |
| `third_parties` fuera de realtime | [`ADD_THIRD_PARTIES.sql:291-305`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L291-L305), [`RECREATE_THIRD_PARTIES.sql:119-122`](../../shared/supabase/migrations/RECREATE_THIRD_PARTIES.sql#L119-L122) | `DROP TABLE third_parties` de la publicación |
| `notifications` (extra móvil) | [`ADD_IN_APP_NOTIFICATION_CENTER.sql:623-627`](../../mobile/migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql#L623-L627) | Añade la tabla de notificaciones |

**Suscripciones de cliente (6 handlers en 5 archivos):**

- Móvil: `notifications` con filtro `tenant_id=eq.…` ([`notifications.service.js:124-151`](../../mobile/src/services/notifications.service.js#L124-L151)).
- Móvil y web: `system_alerts` con filtro de tenant ([`alerts.service.js:26-36`](../../mobile/src/services/alerts.service.js#L26-L36), [`alerts.service.js:84-97`](../../web/src/services/alerts.service.js#L84-L97)).
- Móvil: `system_alerts` para alertas de pedidos online ([`onlineOrders.service.js:134-148`](../../mobile/src/services/onlineOrders.service.js#L134-L148)).
- Web: método genérico `postgres_changes` ([`supabase.service.js:269-274`](../../web/src/services/supabase.service.js#L269-L274)).

**No detectado:** referencias SQL a `realtime.messages`, `realtime.subscription`, `broadcast` o `presence`. La dependencia es la publicación y el protocolo `postgres_changes`, no tablas del esquema `realtime`.

**Portabilidad:** `supabase_realtime` es creada por la plataforma; `ALTER PUBLICATION` falla si no existe. Además, la entrega WAL → WebSocket, los filtros por columna y la aplicación de RLS a la suscripción no son reproducibles con PostgreSQL estándar sin un servicio equivalente.

---

## 6. Extensiones, plataforma y capa API

### 6.1 Extensiones

| Extensión | Dónde | Dificultad | Justificación |
|---|---|---|---|
| `pgcrypto` | [`InitDB.sql:2`](../../shared/supabase/migrations/InitDB.sql#L2) y 5 archivos más | **Baja** | Extensión estándar; `gen_random_uuid()` ya es nativo desde PostgreSQL 13. No se detectó uso de `pgcrypto` para cifrar columnas |
| `pg_cron` | [`ADD_ALERTS_CRON_SCHEDULE.sql:8`](../../shared/supabase/migrations/ADD_ALERTS_CRON_SCHEDULE.sql#L8) | **Media** | No es parte del core; requiere paquete y `shared_preload_libraries`. Se puede sustituir por worker/cron externo |
| `pg_net` | [`ADD_SUPABASE_CRON_PIPELINES.sql:20`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L20) | **Alta** | Extensión con background worker; no estándar. Se sustituye por HTTP desde Go/worker |
| `vault` | [`ADD_SUPABASE_CRON_PIPELINES.sql:138-170`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L138-L170) | **Alta** | Supabase Vault; el secreto se descifra con la clave raíz de la plataforma. No hay `create extension` en el repo |

### 6.2 Jobs de `pg_cron`

| Job | Frecuencia | Evidencia |
|---|---|---|
| `poslite_refresh_all_alerts_hourly` | Cada hora | [`ADD_ALERTS_CRON_SCHEDULE.sql:54-55`](../../shared/supabase/migrations/ADD_ALERTS_CRON_SCHEDULE.sql#L54-L55) |
| `poslite_process_accounting_queue_every_minute` | Cada minuto | [`ADD_SUPABASE_CRON_PIPELINES.sql:231-235`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L231-L235) |
| `poslite_push_dispatcher_every_minute` | Cada minuto | [`ADD_SUPABASE_CRON_PIPELINES.sql:247-251`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L247-L251), duplicado en [`ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql:158-162`](../../mobile/migrations/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql#L158-L162) |

Los jobs se crean condicionalmente: si `cron.job` no existe, se emite un `NOTICE` y **no se programa nada** ([`ADD_ALERTS_CRON_SCHEDULE.sql:22-30`](../../shared/supabase/migrations/ADD_ALERTS_CRON_SCHEDULE.sql#L22-L30)). En una migración a PostgreSQL estándar, la pérdida es silenciosa.

### 6.3 `pg_net` + Vault: el puente SQL → Edge Function

El único egreso HTTP desde SQL está en migraciones de extras:

1. Lee `PUSH_DISPATCHER_URL` y `PUSH_DISPATCHER_SECRET` de `vault.decrypted_secrets` ([`ADD_SUPABASE_CRON_PIPELINES.sql:154-170`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L154-L170); mismo patrón en [`ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql:73-89`](../../mobile/migrations/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql#L73-L89)).
2. Hace `net.http_post(url := …, headers := {'Authorization': 'Bearer ' || secreto}, body := {'limit': …})` ([`ADD_SUPABASE_CRON_PIPELINES.sql:180-194`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L180-L194)).
3. La Edge Function `push-dispatcher` valida ese mismo `PUSH_DISPATCHER_SECRET` en el header `Authorization` ([`push-dispatcher/index.ts:546-553`](../../mobile/supabase/functions/push-dispatcher/index.ts#L546-L553)).

No hay una URL literal en SQL: **la URL real está en Vault y no se imprime en este documento**. El nombre del destino es `push-dispatcher` (comentario en [`ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql:5`](../../mobile/migrations/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql#L5)).

### 6.4 PostgREST, roles y grants

| Dependencia | Evidencia | Consecuencia |
|---|---|---|
| `NOTIFY pgrst, 'reload schema'` | 19 archivos canónicos; p. ej. [`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:93`](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L93) | Es un `NOTIFY` inofensivo fuera de PostgREST, pero delata que el contrato asume recarga de schema cache |
| Roles `anon`, `authenticated`, `service_role` | 44 archivos canónicos; 126 `grant/revoke`; 115 menciones de `authenticated`, 46 de `service_role`, 21 de `anon` | En PostgreSQL limpio los `GRANT` fallan si los roles no existen. `service_role` además implica `BYPASSRLS` |
| Exposición REST/RPC | `create_auth_user`, `fn_*` y `sp_*` con `GRANT EXECUTE` | El backend actual llama RPC por PostgREST; la superficie HTTP no está en el repo |
| `search_path` implícito | 38 funciones `SECURITY DEFINER` sin `SET search_path` (inventario §7) | Riesgo de *search_path hijacking* en el destino; no es dependencia Supabase, pero afecta la portabilidad |

**Secuencia implícita de identidad:** [`ADD_ONLINE_STORE_MVP.sql:300`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L300) hace `GRANT … ON SEQUENCE online_orders_order_number_seq`, pero no hay un `create sequence` explícito en los tres directorios. La secuencia la genera PostgreSQL de forma implícita por `order_number BIGINT GENERATED BY DEFAULT AS IDENTITY` ([`ADD_ONLINE_STORE_MVP.sql:207`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L207)). El `GRANT` depende del nombre por defecto y del orden de creación de la tabla; **a verificar** en el baseline, pero no es un objeto necesariamente ausente.

### 6.5 `supabase_functions`

**No detectado.** Cero referencias a `supabase_functions` en:

- 189 archivos `.sql`;
- 20 Edge Functions (`.ts`);
- clientes web/móvil.

Los webhooks de pago se implementan como Edge Functions (`mercadopago-webhook`), no con `supabase_functions.http_request`. No hay dependencia SQL de ese esquema.

### 6.6 Edge Functions

**20 nombres únicos** en tres directorios:

| Directorio | Funciones |
|---|---|
| `shared/supabase/functions/` (13) | `chat-order-parser`, `create-tenant-user`, `mercadopago-create-preference`, `mercadopago-create-preference-v2`, `mercadopago-webhook`, `notification-dispatcher`, `online-order-cleanup-worker`, `online-order-email`, `subscription-create-preference`, `subscription-provision-signup`, `subscription-renewal-checkout`, `subscription-renewal-worker`, `tenant-mercadopago-config` |
| `web/supabase/functions/` (2 propios) | `accounting-queue-worker`, `deepseek-proxy` |
| `mobile/supabase/functions/` (5 propios) | `deepseek-ocr-proxy`, `ops-rag-agent`, `product-photo-analyzer`, `product-photo-parser`, `push-dispatcher` |

**Dependencias de plataforma:**

- Las 20 usan `SUPABASE_URL`; 15 usan `SUPABASE_SERVICE_ROLE_KEY`; 12 usan `auth.getUser()` o `auth.admin.*`.
- 4 archivos usan la **Auth Admin API**: `createUser` (4), `updateUserById` (3), `listUsers` (3), `generateLink` (3), `getUserById` (2), `deleteUser` (2). Evidencia: [`create-tenant-user/index.ts:156`](../../shared/supabase/functions/create-tenant-user/index.ts#L156), [`:265`](../../shared/supabase/functions/create-tenant-user/index.ts#L265), [`subscription-provision-signup/index.ts:114`](../../shared/supabase/functions/subscription-provision-signup/index.ts#L114), [`mercadopago-webhook/index.ts:248-279`](../../shared/supabase/functions/mercadopago-webhook/index.ts#L248-L279).
- Dependen de secretos de plataforma y de terceros (Mercado Pago, Resend, DeepSeek, OCR, Expo/FCM). No se imprimen valores.

**Invocación desde SQL:** solo `push-dispatcher` (vía URL de Vault + `pg_net`). Las demás se invocan desde clientes con `supabase.functions.invoke(...)`; no hay llamadas SQL por nombre. **No se puede ejecutar una Edge Function en PostgreSQL estándar**: requiere runtime Deno y el gateway de Supabase.

---

## 7. RLS: conteo y ejemplos notables

### 7.1 Conteo

| Métrica | Canónico | Extras | Método |
|---|---:|---:|---|
| Sentencias `create policy` | **223** | 57 | Regex sobre el texto, incluye nombres entre comillas |
| Políticas únicas (tabla + nombre) | 218 | 52 + 5 plantillas | Se normaliza `public.` y comillas |
| Tablas con políticas | 75 | 26 | `storage.objects` incluida |
| Tablas con `ENABLE ROW LEVEL SECURITY` | 74 | 15 | `alter table … enable row level security` |
| Políticas con `auth.uid()` directo | 83 | 24 | 107 en total |
| Políticas con `auth.role()` directo | 2 | 0 | `public_subscription_signups*` |
| Políticas con helper de identidad | 132 | 32 | `get_current_user_tenant_id`, `has_permission`, etc. |
| Políticas sin identidad | 16 | 1 | `USING (true)`, `FALSE`, `anon`, GUC `app.*` |
| Políticas sobre `storage.objects` | 8 | 4 | 12 en total |

> **Cálculo de dependencia real:** 85 políticas usan `auth.*` directo; 132 usan helpers que a su vez llaman a `auth.uid()`; 10 usan ambos; **solo 16 no dependen de identidad**. Es decir, **207/223 (93 %)** en el canónico; en extras, **56/57**. El modelo de autorización no se puede separar de Supabase Auth sin reescribir las políticas.

**DDL dinámico no resuelto:** la migración móvil [`HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql`](../../mobile/migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql) recorre 21 tablas de negocio y crea hasta 4 políticas por tabla si no tiene ninguna ([`:25-88`](../../mobile/migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql#L25-L88)); además habilita RLS deny-all en 4 tablas internas ([`:95-106`](../../mobile/migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql#L95-L106)) y lectura para 3 catálogos ([`:111-134`](../../mobile/migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql#L111-L134)). Son **28 tablas y hasta 87 políticas potenciales** que el conteo estático no resuelve.

### 7.2 Ejemplos notables

| # | Política / patrón | Evidencia | Por qué importa |
|---|---|---|---|
| 1 | `users_select_policy` por tenant | [`RLS_Security.sql:46-48`](../../shared/supabase/migrations/RLS_Security.sql#L46-L48) | Depende de `get_current_user_tenant_id()`, que usa `auth.uid()` |
| 2 | `has_permission('SECURITY.USERS.MANAGE')` | [`RLS_Security.sql:51-56`](../../shared/supabase/migrations/RLS_Security.sql#L51-L56) | Autorización por permiso, no por rol; el helper consulta `users.auth_user_id` |
| 3 | `permissions_select_policy: auth.uid() IS NOT NULL` | [`RLS_Security.sql:152-154`](../../shared/supabase/migrations/RLS_Security.sql#L152-L154) | Cualquier usuario autenticado ve el catálogo global |
| 4 | Superadmin por ausencia de perfil en `third_parties` | [`ADD_THIRD_PARTIES.sql:230-247`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L230-L247) | Bypass total de tenant para cuentas sin perfil |
| 5 | Escritura de menús solo para «sin perfil» | [`ROLES_MENUS_SYSTEM.sql:579-622`](../../shared/supabase/migrations/ROLES_MENUS_SYSTEM.sql#L579-L622) | Convierte un estado de datos en un privilegio |
| 6 | `billing_plans` visible para cualquier autenticado | [`ADD_TENANT_BILLING_MONETIZATION.sql:634-637`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L634-L637) | `USING (auth.uid() IS NOT NULL)`; no hay aislamiento por tenant porque es catálogo |
| 7 | `dataimport_*` por `metadata->>'tenant_id'` | [`SETUP_DATAIMPORT_BUCKET.sql:31-65`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L31-L65) | Depende de metadata de Storage y de un trigger |
| 8 | `storefront_auth_can_*` por primera carpeta = tenant | [`ADD_ONLINE_STORE_MVP.sql:52-117`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L52-L117) | El aislamiento depende del naming de paths |
| 9 | `storefront_anon_can_upload_payment_proofs` | [`ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:19-26`](../../shared/supabase/migrations/ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql#L19-L26) | `anon` escribe en bucket público; sin límite de tamaño/tipo en la política |
| 10 | `tenant_gateway_credentials` deny-all | [`ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql:54-59`](../../shared/supabase/migrations/ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql#L54-L59) | Se apoya en que solo `service_role`/Edge accede; el privilegio de plataforma es la autorización |
| 11 | `units_of_measure` con GUC `app.current_tenant_id` | [`CREATE_UNITS_OF_MEASURE.sql:258-263`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L258-L263) | **Precedente portable**: no usa `auth.uid()` |
| 12 | `tenant_isolation_policy` con GUC `app.current_tenant` | [`full_migration.sql:507-509`](../../shared/supabase/migrations/full_migration.sql#L507-L509) | Otro precedente, pero con **otro nombre de GUC**; inconsistencia a resolver |

---

## 8. Funciones que dependen de claims o headers

### 8.1 Canónico (`shared/`, 28 nombres / 40 definiciones)

| Función | Claim(s) | Evidencia (primera definición) | Defs |
|---|---|---|---:|
| `change_user_password` | `auth.uid()` | [`UserFunctions.sql:100`](../../shared/supabase/migrations/UserFunctions.sql#L100) | 1 |
| `create_auth_user` | `auth.uid()` | [`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:4`](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L4) | 2 |
| `fn_change_subscription_plan` | `auth.role()` | [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:6`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L6) | 1 |
| `fn_change_subscription_plan_prorated` | `auth.role()` | [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:639`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L639) | 1 |
| `fn_confirm_online_manual_order` | `auth.uid()` | [`ADD_ONLINE_STORE_AUDIT_HISTORY.sql:30`](../../shared/supabase/migrations/ADD_ONLINE_STORE_AUDIT_HISTORY.sql#L30) | 3 |
| `fn_create_tenant` | `auth.email()` | [`SECURE_TENANT_MANAGEMENT.sql:38`](../../shared/supabase/migrations/SECURE_TENANT_MANAGEMENT.sql#L38) | 1 |
| `fn_create_tenant_subscription_renewal_invoice` | `auth.role()` | [`ADD_TENANT_BILLING_RENEWALS.sql:21`](../../shared/supabase/migrations/ADD_TENANT_BILLING_RENEWALS.sql#L21) | 1 |
| `fn_current_user_tenant_id` | `auth.uid()` | [`SETUP_DATAIMPORT_BUCKET.sql:16`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L16) | 1 |
| `fn_enqueue_async_job` | `auth.uid()` | [`ADD_ASYNC_JOB_QUEUE.sql:140`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L140) | 1 |
| `fn_get_tenant_payment_history` | `auth.role()` | [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:280`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L280) | 1 |
| `fn_is_admin_or_manager` | `auth.uid()` | [`ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql:6`](../../shared/supabase/migrations/ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql#L6) | 1 |
| `fn_is_super_admin` | `auth.uid()` | [`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:2`](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql#L2) | 2 |
| `fn_online_order_actor_name` | `auth.uid()` | [`ADD_ONLINE_STORE_AUDIT_HISTORY.sql:16`](../../shared/supabase/migrations/ADD_ONLINE_STORE_AUDIT_HISTORY.sql#L16) | 1 |
| `fn_process_tenant_subscription_expirations` | `auth.role()` | [`ADD_TENANT_BILLING_RENEWALS.sql:310`](../../shared/supabase/migrations/ADD_TENANT_BILLING_RENEWALS.sql#L310) | 2 |
| `fn_reject_online_manual_order` | `auth.uid()` | [`ADD_ONLINE_STORE_AUDIT_HISTORY.sql:196`](../../shared/supabase/migrations/ADD_ONLINE_STORE_AUDIT_HISTORY.sql#L196) | 3 |
| `fn_superadmin_list_all_payments` | `auth.role()` | [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:774`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L774) | 1 |
| `fn_superadmin_record_manual_payment` | `auth.role()`, `auth.uid()` | [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:152`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L152) | 1 |
| `fn_user_assigned_locations` | `auth.uid()` | [`ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql:21`](../../shared/supabase/migrations/ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql#L21) | 1 |
| `get_cash_movements_by_role` | `auth.uid()` | [`CREATE_ROLE_FILTER_FUNCTIONS.sql:230`](../../shared/supabase/migrations/CREATE_ROLE_FILTER_FUNCTIONS.sql#L230) | 1 |
| `get_current_user_tenant_id` | `auth.uid()` | [`ADD_TENANT_BILLING_MONETIZATION.sql:485`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L485) | 3 |
| `get_sale_lines_by_role` | `auth.uid()` | [`CREATE_ROLE_FILTER_FUNCTIONS.sql:100`](../../shared/supabase/migrations/CREATE_ROLE_FILTER_FUNCTIONS.sql#L100) | 1 |
| `get_sale_payments_by_role` | `auth.uid()` | [`CREATE_ROLE_FILTER_FUNCTIONS.sql:170`](../../shared/supabase/migrations/CREATE_ROLE_FILTER_FUNCTIONS.sql#L170) | 1 |
| `get_sales_by_role` | `auth.uid()` | [`CREATE_ROLE_FILTER_FUNCTIONS.sql:14`](../../shared/supabase/migrations/CREATE_ROLE_FILTER_FUNCTIONS.sql#L14) | 1 |
| `get_user_assigned_locations` | `auth.uid()` | [`FIX_RLS_CASHIER_RESTRICTIONS.sql:11`](../../shared/supabase/migrations/FIX_RLS_CASHIER_RESTRICTIONS.sql#L11) | 1 |
| `get_users_with_roles` | `auth.uid()` | [`UserFunctions.sql:138`](../../shared/supabase/migrations/UserFunctions.sql#L138) | 1 |
| `has_permission` | `auth.uid()` | [`ADD_TENANT_BILLING_MONETIZATION.sql:559`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L559) | 2 |
| `is_user_admin` | `auth.uid()` | [`FIX_RLS_CASHIER_PRIVACY.sql:19`](../../shared/supabase/migrations/FIX_RLS_CASHIER_PRIVACY.sql#L19) | 2 |
| `is_user_cashier` | `auth.uid()` | [`FIX_RLS_CASHIER_PRIVACY.sql:35`](../../shared/supabase/migrations/FIX_RLS_CASHIER_PRIVACY.sql#L35) | 2 |

### 8.2 Extras (`web/` + `mobile/`, 14 nombres / 19 definiciones)

| Función | Claim(s) | Evidencia | Nota |
|---|---|---|---|
| `fn_accounting_close_period` | `auth.uid()` | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:485`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L485) | Solo en `web/` |
| `fn_accounting_get_withholding_summary` | `auth.jwt()`, `auth.uid()`, GUC `request.jwt.claim*` | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:359`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L359) | Fallback triple de rol |
| `fn_accounting_open_period` | `auth.uid()` | [`ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:105`](../../web/migrations/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql#L105) | — |
| `fn_accounting_post_entry` | `auth.uid()` | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:628`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L628) | 3 definiciones |
| `fn_accounting_process_queue` | `auth.jwt()`, `auth.uid()`, GUC | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:705`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L705) | 3 definiciones |
| `fn_accounting_process_queue_all_tenants` | GUC `request.jwt.claim*` + `set_config` | [`ADD_SUPABASE_CRON_PIPELINES.sql:27`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L27) | Emula `service_role` |
| `fn_accounting_reopen_period` | `auth.uid()` | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:568`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L568) | — |
| `fn_accounting_summary` | `auth.uid()` | [`ADD_ACCOUNTING_CO_MODULE.sql:250`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L250) | Solo en `web/` |
| `fn_accounting_trial_balance` | `auth.uid()` | [`ADD_ACCOUNTING_CO_MODULE.sql:317`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L317) | Solo en `web/` |
| `fn_current_user_tenant_id` | `auth.uid()` | [`ADD_PRODUCT_MEDIA_PHOTOS.sql:18`](../../mobile/migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql#L18) | Duplica el helper canónico para Storage |
| `fn_reports_dashboard_summary` | `auth.uid()` | [`ADD_REPORTS_DASHBOARD_SUMMARY_RPC.sql:1`](../../web/migrations/ADD_REPORTS_DASHBOARD_SUMMARY_RPC.sql#L1) | Solo en `web/` |
| `fn_superadmin_assign_tenant_plan` | `auth.email()` | [`ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:229`](../../web/migrations/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql#L229) | Gate por email |
| `fn_superadmin_list_tenants` | `auth.uid()` | [`ADD_SUPERADMIN_TENANTS_LIST_RPC.sql:5`](../../web/migrations/ADD_SUPERADMIN_TENANTS_LIST_RPC.sql#L5) | Solo en `web/` |
| `get_current_user_app_user_id` | `auth.uid()` | [`ADD_IN_APP_NOTIFICATION_CENTER.sql:10`](../../mobile/migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql#L10) | Solo en `mobile/` |

> **No se incluyen** las funciones que solo reciben un `tenant_id` o un `user_id` por parámetro y no leen claims. Tampoco las que usan `current_setting('app.*')`, que son el precedente portable (§7.2, ejemplos 11-12).

**Funciones que deben conservar atomicidad y que hoy dependen del contexto de Auth:** `sp_create_sale`, `sp_create_return_v2`, `sp_create_purchase`, `sp_receive_purchase_order_partial`, `sp_create_purchase_return`, `fn_allocate_stock_fefo`, `fn_consume_batch_stock`, `fn_complete_production`, `fn_claim_async_jobs`, `fn_complete_async_job`, `fn_fail_async_job`. La dependencia de claims está en las validaciones de actor/tenant, no en la transacción; se caracterizan en la tarea #5.

---

## 9. Clasificación por dificultad de reemplazo

**Criterio:** *baja* = cambio local y mecánico; *media* = requiere código o contrato nuevo, pero la semántica es reproducible; *alta* = no existe equivalente en PostgreSQL estándar, o el reemplazo cambia seguridad/comportamiento y exige migración de datos o de plataforma.

| # | Dependencia | Dificultad | Justificación | Evidencia |
|---|---|---|---|---|
| 1 | `auth.uid()` dentro de RLS | **Alta** | 207/223 políticas dependen de identidad; reescribir políticas o introducir un contexto de sesión `app.*` exige decidir el modelo de autorización y probar aislamiento | §7 |
| 2 | `auth.uid()` dentro de funciones | **Media** | Reemplazo mecánico por parámetro o `current_setting('app.current_user_id', true)`; el riesgo está en 32 definiciones que invocan `auth.uid()` (40 si se cuentan todas las dependientes de claims) y en la semántica de `SECURITY DEFINER` | §8 |
| 3 | `auth.role() = 'service_role'` | **Alta** | `service_role` es un rol de plataforma con `BYPASSRLS`; modelarlo como superusuario reproduce el privilegio, no la autorización | [`ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:41`](../../shared/supabase/migrations/ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql#L41) |
| 4 | `auth.jwt()` / `request.jwt.claims` / `set_config` | **Alta** | Claims inyectados por PostgREST; el GUC legacy no es contrato estable. La emulación de `service_role` en cron depende de que `auth.jwt()` exista | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:370-377`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L370-L377) |
| 5 | `auth.email()` | **Media** | Se reemplaza por `users.email`; el problema es que un gate de superadmin dependa del claim | [`SECURE_TENANT_MANAGEMENT.sql:68`](../../shared/supabase/migrations/SECURE_TENANT_MANAGEMENT.sql#L68) |
| 6 | `auth.users` + Auth Admin API | **Alta** | GoTrue gestiona contraseñas, sesiones, refresh tokens, MFA, OAuth y verificación; no hay DDL en el repo y los datos no se pueden exportar sin acceso privilegiado | §3.3, §6.6 |
| 7 | Puente `auth_user_id` + UUID sintético | **Alta** | Hay que reconciliar cuentas y perfiles, detectar huérfanos y decidir el `sub`; `create_auth_user` puede haber generado IDs sin cuenta | [`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:42-44`](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L42-L44) |
| 8 | Superadmin por ausencia de perfil | **Alta** | No existe el concepto fuera de Auth; migrarlo mal crea escalada de privilegios o bloquea a los administradores reales | [`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:17-28`](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql#L17-L28) |
| 9 | Fallback a `profiles` | **Media** | Se puede eliminar el `EXECUTE` dinámico y quedarse con `users`; requiere saber si `profiles` existe y tiene datos | [`ADD_TENANT_BILLING_MONETIZATION.sql:516-554`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L516-L554) |
| 10 | Políticas sobre `storage.objects` | **Alta** | No hay RLS de Storage en PostgreSQL; hay que mover la autorización de objetos a la aplicación y migrar metadata | §4.3 |
| 11 | `storage.buckets` / `storage.create_bucket()` | **Alta** | Tabla y función de plataforma; en un S3/MinIO se reemplazan por provisión de buckets y una tabla propia | [`SETUP_DATAIMPORT_BUCKET.sql:7`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L7) |
| 12 | `storage.foldername()` / metadata | **Media** | El parsing de paths y la metadata se pueden replicar con columnas propias, pero cambia el contrato de subida | [`ADD_ONLINE_STORE_MVP.sql:58`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L58) |
| 13 | URLs públicas / firmadas / CDN | **Alta** | Es una capacidad del servicio de Storage; requiere firmar URLs y servir objetos desde otro backend | [`productMedia.service.js:141`](../../web/src/services/productMedia.service.js#L141) |
| 14 | Publicación `supabase_realtime` | **Alta** | La publicación la crea la plataforma; `ALTER PUBLICATION` falla si no existe. Además, RLS sobre Realtime no es estándar | [`FIX_STOCK_ALERTS_REALTIME.sql:59`](../../shared/supabase/migrations/FIX_STOCK_ALERTS_REALTIME.sql#L59) |
| 15 | `postgres_changes` en clientes | **Alta** | Protocolo y filtros de Supabase Realtime; hay que reescribir clientes (fuera del perímetro de este agente) | [`alerts.service.js:26-36`](../../mobile/src/services/alerts.service.js#L26-L36) |
| 16 | `pg_cron` y jobs | **Media** | Se puede auto-hospedar la extensión o mover a worker/cron; cambia la observabilidad y el arranque | [`ADD_ALERTS_CRON_SCHEDULE.sql:8`](../../shared/supabase/migrations/ADD_ALERTS_CRON_SCHEDULE.sql#L8) |
| 17 | `pg_net` | **Alta** | Extensión con worker de red; el reemplazo natural es un worker Go con reintentos e idempotencia | [`ADD_SUPABASE_CRON_PIPELINES.sql:180-194`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L180-L194) |
| 18 | Vault | **Alta** | Los secretos se descifran con la clave raíz de Supabase; hay que rotarlos y moverlos a un secret manager | [`ADD_SUPABASE_CRON_PIPELINES.sql:138-170`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql#L138-L170) |
| 19 | `NOTIFY pgrst` | **Baja** | Es un `NOTIFY` a un canal que fuera de PostgREST no tiene consumidor; no rompe SQL | [`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:93`](../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L93) |
| 20 | Roles `anon` / `authenticated` / `service_role` y `GRANT` | **Media** | Crear roles `NOLOGIN` o quitar los grants es mecánico; la semántica de `service_role` es alta (fila 3) | 44 archivos canónicos |
| 21 | Edge Functions | **Alta** | Runtime Deno + secretos + gateway de Supabase; hay que portarlas a Go u otro servicio y reemplazar Auth Admin | §6.6 |
| 22 | `pgcrypto` | **Baja** | Extensión estándar; `gen_random_uuid()` es nativo desde PostgreSQL 13 | [`InitDB.sql:2`](../../shared/supabase/migrations/InitDB.sql#L2) |
| 23 | `supabase_functions` | **Baja / sin acción** | Cero referencias; no hay nada que reemplazar | §6.5 |

---

## 10. Lo que no se puede reproducir fuera de Supabase

> **Alcance:** no se puede reproducir **con PostgreSQL estándar y las migraciones actuales**. Algunos elementos se pueden sustituir por componentes open source (S3/MinIO, worker Go, cron del sistema), pero eso es un reemplazo, no una copia.

1. **El contexto de identidad por request (`auth.uid()`, `auth.jwt()`, `auth.role()`, `auth.email()`).**
   No son funciones del core: las provee el esquema `auth` de Supabase y se alimentan del JWT que inyecta PostgREST/Kong. En PostgreSQL limpio no existen. Sin ellas fallan las 207 políticas que dependen de identidad y las 32 definiciones que invocan `auth.uid()` (40 si se cuentan todas las que dependen de claims). **No se pueden recrear solo con SQL** porque el valor depende de la sesión HTTP.

2. **El almacén de identidad de Supabase Auth (GoTrue).**
   `auth.users`, identidades OAuth, sesiones, refresh tokens, verificación de email, recuperación de contraseña, MFA y la Admin API (`createUser`, `updateUserById`, `generateLink`, `deleteUser`). No hay DDL de `auth` en el repo; las contraseñas y tokens no están en tablas públicas. Los datos no se pueden exportar con SQL corriente y PROD está bloqueado.

3. **La semántica de `service_role`.**
   `service_role` no es «un rol más»: omite RLS por diseño. Reproducirlo con un superusuario o `BYPASSRLS` mantiene el privilegio pero elimina la barrera de autorización que el código cree tener.

4. **El servicio de Storage.**
   Los binarios, las URLs públicas/firmadas, el CDN, las transformaciones de imagen, la subida reanudable y la metadata administrada por `storage.objects`. La base solo contiene rutas y metadata; **los archivos no están en PostgreSQL**. Las políticas sobre `storage.objects` tampoco son RLS estándar de una tabla propia.

5. **El servicio de Realtime.**
   La decodificación WAL → WebSocket, la publicación `supabase_realtime`, los filtros `postgres_changes`, la aplicación de RLS a cada suscripción y, si se usara, `broadcast`/`presence`. Nada de eso es una extensión SQL estándar.

6. **Vault.**
   El secreto se guarda cifrado y se descifra con la clave raíz de la plataforma (`vault.decrypted_secrets`). Sin esa clave, una copia de la tabla no sirve. Hay que rotar `PUSH_DISPATCHER_URL` y `PUSH_DISPATCHER_SECRET` al migrar.

7. **`pg_net` y el planificador de `pg_cron`.**
   `pg_cron` se puede auto-hospedar, pero no es parte del core y requiere configuración del servidor. `pg_net` necesita un background worker y no es una extensión estándar. Los jobs actuales se omiten silenciosamente si no están.

8. **Edge Functions.**
   Runtime Deno, secretos de plataforma, verificación de JWT y el gateway `/functions/v1`. No se ejecutan en PostgreSQL. Las 20 funciones dependen de `SUPABASE_URL`; 15 usan la service role key; 4 usan Auth Admin.

9. **PostgREST y su contrato implícito.**
   Exposición automática de tablas y RPC, cambio de rol por request, `NOTIFY pgrst, 'reload schema'` y el schema cache. El backend actual consume `/rest/v1` y `/rest/v1/rpc`; el reemplazo es la API Go, no una base de datos.

10. **La publicación y los grants por defecto de la plataforma.**
    `anon`, `authenticated` y `service_role` los crea Supabase; los `GRANT` de las migraciones fallan en una base limpia si no se crean antes. La publicación `supabase_realtime` también la crea la plataforma.

---

## 11. A verificar (no concluyente con análisis estático)

1. **Estado real de PROD:** `pg_policies`, `pg_proc`, `pg_publication_tables`, `storage.buckets` y grants efectivos. PROD está bloqueado por no tener usuario de solo lectura.
2. **Auto-registro en Supabase Auth y explotabilidad de «superadmin por ausencia».** Es el riesgo más alto del análisis; requiere revisar la configuración de Auth y los datos.
3. **Si `HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql` se aplicó.** De ser así, hay RLS y hasta 87 políticas nuevas en 28 tablas del núcleo que no están en `shared/`.
4. **Si existe `public.profiles`** y si tiene datos; el helper `get_current_user_tenant_id()` la usa como fallback.
5. **Conteo de huérfanos:** filas de `users` sin `auth.users` (por `create_auth_user`) y cuentas de Auth sin fila en `users`. Sin acceso a `auth.users` no se puede calcular.
6. **Visibilidad real de los buckets** `storefront` y `productmedia`; en particular, si los comprobantes de pago son públicamente legibles.
7. **Si `pg_cron`, `pg_net` y `vault` están habilitados en PROD**, y si los tres jobs existen y se ejecutan.
8. **Secretos de Vault:** si `PUSH_DISPATCHER_URL` apunta a `push-dispatcher`, si el secreto coincide con el de la Edge Function y si hay rotación.
9. **Grants reales a `anon`/`authenticated`/`service_role`** por tabla y función; el repo solo declara intenciones.
10. **Secuencia implícita `online_orders_order_number_seq`:** confirmar que `order_number` sigue siendo `GENERATED BY DEFAULT AS IDENTITY` y que el `GRANT` de [`ADD_ONLINE_STORE_MVP.sql:300`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L300) se ejecuta después de crear la tabla.
11. **Versión vigente de las funciones redefinidas** (49 en el canónico; `sp_create_sale` ×7). El análisis estático no resuelve el orden.
12. **Cifrado de secretos en tablas** (`tenant_gateway_credentials.access_token`, `tenant_payment_methods.provider_token`, `fe_provider_config.api_key`), fuera del alcance de esta tarea pero relevante para la migración.
13. **Vistas:** si las 46 vistas usan `security_invoker` y si su cuerpo depende de `auth.uid()`; no se analizaron.

---

## 12. Propuestas pendientes (fuera del perímetro; no implementadas)

> Estas propuestas requieren decisión del agente principal. No se modificó código de backend, web, mobile, contratos ni migraciones históricas.

- **P1. Contrato de identidad explícito.** Definir si el sujeto será `users.user_id` o un `subject` estable, y cómo se transportan `user_id`, `tenant_id`, roles y `is_service` en la sesión de base. Insumo para la tarea #3.
- **P2. Contexto de sesión portable.** Reemplazar `auth.uid()` por `current_setting('app.current_user_id', true)::uuid` (o parámetro explícito en RPC) y unificar los dos GUC ya existentes: `app.current_tenant` y `app.current_tenant_id`. Precedente: [`CREATE_UNITS_OF_MEASURE.sql:258-263`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L258-L263).
- **P3. Rol de servicio explícito y de mínimo privilegio.** Sustituir `auth.role() = 'service_role'` por un rol `ofirone_worker` con grants acotados, sin `BYPASSRLS`, y un claim/GUC explícito solo para workers.
- **P4. Autorización de Storage en aplicación.** Definir una tabla propia de objetos (`tenant_id`, `bucket`, `path`, `visibility`, `owner_id`, `content_type`, `size`, `checksum`) y mover las políticas de `storage.objects` a la API/worker. Los comprobantes de pago **no** deben ir a un bucket público.
- **P5. Realtime alternativo.** Definir eventos de dominio y transporte (SSE/WebSocket en Go o `LISTEN/NOTIFY` con payload acotado); retirar `postgres_changes` de los clientes en una tarea coordinada (fuera de este perímetro).
- **P6. Schedulers y secretos.** Reemplazar `pg_cron`/`pg_net`/Vault por un worker Go con reintentos e idempotencia y un secret manager; migrar `PUSH_DISPATCHER_URL`/`PUSH_DISPATCHER_SECRET` con rotación.
- **P7. Edge Functions.** Portar a Go o desplegar como servicio independiente; reemplazar Auth Admin por el nuevo servicio de identidad. No es parte de esta tarea.
- **P8. Baseline limpio.** En el baseline portable: crear roles `anon`/`authenticated`/`service_role` (o quitar los grants), quitar `NOTIFY pgrst`, quitar `storage.*`/`auth.*` y verificar el `GRANT` sobre la secuencia implícita de `online_orders`.
- **P9. Reconciliación de identidad antes de migrar.** Detectar y corregir perfiles con `auth_user_id` sintético, cuentas sin perfil y usuarios sin credenciales; definir el tratamiento antes de la tarea #3.
- **P10. Un solo directorio de migraciones.** El hardening móvil y el módulo contable web demuestran que `shared/` no es suficiente; decidir la fuente de verdad antes de construir el baseline.

---

## 13. Anexo: reproducibilidad y alcance

### 13.1 Comandos

```bash
# Escaneo canónico + extras, con evidencia archivo:línea
python3 tools/database/supabase_dependency_scan.py --include-extras \
  --json docs/database-portability/_data/supabase-deps.json

# Solo canónico
python3 tools/database/supabase_dependency_scan.py
```

El script no se conecta a ninguna base, no lee `.env`, no imprime credenciales y solo escribe el JSON indicado.

### 13.2 Artefactos

| Archivo | Contenido |
|---|---|
| [`_data/supabase-deps.json`](_data/supabase-deps.json) | Conteos por categoría, archivos, evidencias `archivo:linea`, políticas, funciones y tablas RLS |
| [`tools/database/supabase_dependency_scan.py`](../../tools/database/supabase_dependency_scan.py) | Escáner reproducible y no destructivo |
| [`schema-inventory.md`](schema-inventory.md) | Inventario de tablas, vistas, funciones, triggers e índices |
| [`PHASE-0-FINDINGS.md`](PHASE-0-FINDINGS.md) | Hallazgos iniciales y bloqueadores P0 |

### 13.3 Fuentes citadas

- [`InitDB.sql`](../../shared/supabase/migrations/InitDB.sql) — `users.auth_user_id`, baseline.
- [`RLS_Security.sql`](../../shared/supabase/migrations/RLS_Security.sql) — helpers y primeras políticas.
- [`FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql`](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql) — superadmin por ausencia.
- [`ADD_TENANT_BILLING_MONETIZATION.sql`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql) — `profiles`, billing y `service_role`.
- [`ADD_ONLINE_STORE_MVP.sql`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql) — bucket `storefront` y políticas.
- [`SETUP_DATAIMPORT_BUCKET.sql`](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql) — bucket `dataimport`.
- [`ADD_ONLINE_STORE_PUBLIC_IMAGES.sql`](../../shared/supabase/migrations/ADD_ONLINE_STORE_PUBLIC_IMAGES.sql) — `productmedia` público.
- [`ADD_SUPABASE_CRON_PIPELINES.sql`](../../web/migrations/ADD_SUPABASE_CRON_PIPELINES.sql) — `pg_net`, Vault y jobs.
- [`ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql`](../../mobile/migrations/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql) — push dispatcher.
- [`HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql`](../../mobile/migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql) — RLS dinámico.
- [`push-dispatcher/index.ts`](../../mobile/supabase/functions/push-dispatcher/index.ts) — validación del secreto.
- [`create-tenant-user/index.ts`](../../shared/supabase/functions/create-tenant-user/index.ts) — Auth Admin y superadmin.

### 13.4 Lo que este documento no cubre

| Tema | Tarea |
|---|---|
| Modelo de identidad portable (tablas, sesiones, refresh tokens, OIDC) | #3 |
| Aislamiento multi-tenant y casos negativos | #4 |
| Matriz de RPCs y atomicidad | #5 |
| Paginación e índices | #6 |
| Runbook de migración de datos | #7 |
| Scripts de validación contra base | #8 |
