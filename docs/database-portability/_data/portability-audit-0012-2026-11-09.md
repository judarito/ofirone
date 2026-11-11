# Auditoría de portabilidad — migraciones 0001–0012

- **Fecha:** 2026-11-09
- **Alcance:** `database/migrations/0001–0020` (20 migraciones, 45 tablas + 2 vistas).
- **Método:** lectura estática + consultas de catálogo en DEV (solo lectura) + ejecución en base desechable.
- **Evidencia de ejecución:** [`validation-business-0012-2026-11-09.txt`](validation-business-0012-2026-11-09.txt), [`validation-pagination-0012-2026-11-09.txt`](validation-pagination-0012-2026-11-09.txt).

## 1. Dependencias de Supabase / extensiones

| Búsqueda | Resultado |
|---|---|
| `auth.*`, `storage.*`, `realtime`, `supabase` en migraciones | **0 referencias** |
| `CREATE EXTENSION` | **0**; solo `plpgsql` presente |
| `uuid-ossp`, `pgcrypto`, `postgis` u otras extensiones | **0** |
| `gen_random_uuid()` | Función integrada de PostgreSQL 13+; no requiere extensión |
| Tipos propietarios | Ninguno; `uuid`, `text`, `numeric`, `timestamptz`, `jsonb`, `date`, `boolean` |

**Conclusión:** el esquema es PostgreSQL estándar. No hay dependencia de `auth.users`, `storage.objects` ni `realtime`.

## 2. Compatibilidad PostgreSQL 15+

- Se ejecutó completo en PostgreSQL **18.6** (base desechable): `up` de las 12 migraciones, siembra, pruebas y `up → down → up`.
- No se detectaron construcciones que exijan >15 (`MERGE`, `NULLS NOT DISTINCT`, `uuidv7`, `WITH (FORCE)` en migraciones, etc.).
- `FORCE ROW LEVEL SECURITY`, `jsonb`, `timestamptz`, `numeric(19,6)` y `gen_random_uuid()` son compatibles con 15+.
- **Bloqueado:** repetir la creación en un PostgreSQL 15 real. Se intentó con Docker, pero el daemon responde `permission denied` sobre `/var/run/docker.sock`; no se observó nada que impida 15.

## 3. RLS y privilegios

| Métrica | Valor |
|---|---|
| Tablas públicas | 45 + 2 vistas (DEV, snapshot: 702 constraints, 190 índices, 76 FKs, 39 triggers) |
| Con `ROW LEVEL SECURITY` | 45 |
| Con `FORCE ROW LEVEL SECURITY` | 45 |
| Políticas | 49 |
| Funciones | 15 |
| Triggers | 39 |
| Tablas con `tenant_id` sin RLS | **0** |
| Tablas sin `tenant_id` | `identities`, `permissions`, `schema_migrations` |

- `schema_migrations` es global y su acceso está revocado a `PUBLIC` (solo rol migrador).
- `permissions` es catálogo global con política de lectura `true`; escritura reservada a provisión.
- `identities` tiene lectura propia vía `app_identity_id` (sin listado global).
- **Riesgo R1 (alto):** el owner de Neon tiene `BYPASSRLS`. Cualquier prueba de RLS debe ejecutarse con un rol `NOBYPASSRLS`; el rol de runtime de producción **no** debe tener `BYPASSRLS` ni ser owner de las tablas.
- Permisos mínimos del rol de runtime (verificados en la suite): `USAGE` en `public` y `app_private`, `EXECUTE` en `app_private.current_tenant_id()`/`current_identity_id()`, y `SELECT/INSERT/UPDATE` sobre las tablas que use. Sin `CREATE` ni `BYPASSRLS`.

## 4. Funciones

| Función | SECURITY DEFINER | search_path |
|---|---|---|
| `app_private.current_tenant_id()` | No | `pg_catalog` |
| `app_private.current_identity_id()` | No | `pg_catalog` |
| `app_private.set_updated_at()` | No | `pg_catalog` |

Sin `SECURITY DEFINER` ni `search_path` inseguro. No hay funciones `auth.*`. `0015` añade 6 funciones de caja con `search_path` fijo y `cash_movements` append-only.

Roles propuestos (migrador/auth/API, todos `NOBYPASSRLS`): [`contracts/runtime-roles-proposal.sql`](contracts/runtime-roles-proposal.sql). No ejecutados.

## 5. Hallazgos clasificados

| Clase | Hallazgo | Acción |
|---|---|---|
| **Bloqueante** | Ninguno en el esquema 0001–0012 | — |
| **Riesgo** | Owner con `BYPASSRLS`; pruebas sin rol aislado darían falsos PASS | Usar siempre rol `NOBYPASSRLS`; runtime sin `BYPASSRLS` |
| **Riesgo** | Migraciones no idempotentes (`42P06` al re-aplicar) | El ledger debe impedir re-ejecución (runner ya diseñado) |
| **Riesgo** | `schema_migrations` depende de que el runner valide nombres/checksums exactos | Verificación automática en `validate_business_disposable.py` |
| **Mejora** | 18 columnas de filtro sin índice líder (detectado en baseline; revisar con datos) | Evaluar índices antes de carga real |
| **Mitigado** | `audit_log` mutable | `0021_audit_append_only` aplicada: UPDATE/DELETE `23514` |
| **Riesgo (propuesta)** | `identity_credentials` solo permite lectura propia; el login por email/tenant no funciona con runtime | ADR-011 validado: rol `ofirone_auth` con SELECT específico y sin escritura; pendiente de migración/role provisioning |
| **Mejora** | `permissions` con lectura global | Confirmar que el catálogo no es sensible entre tenants |
| **Mejora** | Sin matviews/vistas todavía (N16/N17 bloqueados) | Diseñar `security_invoker`/RLS al crearlas |

## 6. Límites de esta auditoría

- No se ejecutó en PostgreSQL 15 real.
- No se probaron cargas concurrentes reales ni `EXPLAIN` con volúmenes de producción (sí 130 filas por listado).
- N8, N9, N10, N16 y N17 siguen bloqueados por tablas/vistas no migradas.
