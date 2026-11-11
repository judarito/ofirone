# Reporte Tarea 2 — Inventario de dependencias Supabase

**Fecha:** 2026-11-09
**Documento base:** [supabase-dependencies.md](../supabase-dependencies.md)
**Estado:** completada (análisis estático)

## Tarea

Buscar referencias a `auth.uid()`, `auth.users`, `auth.jwt()`, `storage.*`, `realtime`, `supabase_functions` y APIs propietarias; identificar funciones y políticas dependientes de claims; clasificar cada dependencia por dificultad de reemplazo.

## Estado

Completada con limitaciones. No se observó el esquema desplegado ni se ejecutó SQL; los conteos son referencias en archivos. DEV estaba vacía al momento del análisis (hoy con baseline aplicado) y PROD bloqueado ([supabase-dependencies.md §2.2](../supabase-dependencies.md#L73-L83)).

## Archivos creados/modificados

- [`docs/database-portability/supabase-dependencies.md`](../supabase-dependencies.md) — entregable principal.
- [`docs/database-portability/_data/supabase-deps.json`](../_data/supabase-deps.json) — evidencia.
- [`tools/database/supabase_dependency_scan.py`](../../../tools/database/supabase_dependency_scan.py) — reproducibilidad.

## Hallazgos principales

| Dependencia | Canónico | Extras | Total |
|---|---:|---:|---:|
| `auth.uid()` | 160 refs / 29 archivos | 41 / 12 | 201 / 41 |
| `auth.users` (DDL/DML) | 0 (solo un comentario) | 0 | 0 |
| Columna `auth_user_id` | 171 / 30 | 42 / 12 | 213 |
| Políticas RLS | 223 (218 únicas) | 57 | 280 |
| Políticas que usan `auth.*` directo | 85 | 24 | 109 |
| Políticas con helpers de identidad | 132 | 32 | — |
| Políticas sin identidad | 16 | 1 | — |
| Políticas sobre `storage.objects` | 8 | 4 | 12 |
| Extensiones | `pgcrypto`, `pg_cron` | +`pg_net`; `vault` | — |
| Edge Functions | 13 | 7 | 20 únicos |

1. **La autorización es Supabase Auth:** 207 de 223 políticas canónicas (93 %) dependen de `auth.uid()` directa o indirectamente ([§1.2](../supabase-dependencies.md#L43-L56)).
2. **«Superadmin = autenticado sin perfil»** es una regla implementada en SQL; fuera de Supabase no existe y es un riesgo de escalada ([§3.5](../supabase-dependencies.md#L158-L173)).
3. **`create_auth_user` no crea usuarios de Auth:** genera un UUID sintético ([`FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:42-44`](../../../shared/supabase/migrations/FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql#L42-L44)).
4. **Storage no es portable como esquema:** 12 políticas sobre `storage.objects`, tres buckets (`storefront`, `dataimport`, `productmedia`) y un bucket público con comprobantes ([§4](../supabase-dependencies.md#L195-L236)).
5. **Realtime depende de la publicación `supabase_realtime`:** dos tablas (`system_alerts`, `notifications`) y seis handlers en clientes ([§5](../supabase-dependencies.md#L237-L258)).
6. **`pg_net` + Vault** es el único puente SQL → Edge Function (`PUSH_DISPATCHER_*`), solo en `web/` y `mobile/` ([§6.3](../supabase-dependencies.md#L280-L289)).
7. **No hay `supabase_functions`:** los webhooks son Edge Functions ([§6.5](../supabase-dependencies.md#L301-L310)).
8. **El directorio canónico está incompleto:** una migración móvil habilita RLS en 28 tablas y genera hasta 87 políticas por plantilla, ausentes de `shared/` ([§1.2](../supabase-dependencies.md#L43-L56)).

## Riesgos

- Reemplazar `auth.uid()` por un GUC sin validar la membresía reproduce la vulnerabilidad con otro nombre.
- Migrar `storage.objects` como tabla propia sin manifiesto de objetos deja archivos inaccesibles o públicos.
- `pg_cron`/`pg_net`/Vault no tienen equivalente directo en PostgreSQL estándar; requieren workers y secret manager.
- Las políticas de `web/`/`mobile/` no inventariadas pueden contener reglas de negocio distintas.

## Decisiones recomendadas

- Sustituir identidad por **membresía explícita + contexto de transacción** (`app.tenant_id`), nunca por claims ([ADR-003](../../decisions/ADR-003-aislamiento-multi-tenant.md), [ADR-005](../../decisions/ADR-005-modelo-identidad-portable.md)).
- Reemplazar Storage por metadatos propios + S3, con autorización en Go ([baseline-proposal.md:91-98](../baseline-proposal.md#L91-L98)).
- Reemplazar Realtime por outbox durable y workers.
- Eliminar `pg_cron`, `pg_net`, Vault y `NOTIFY pgrst` del baseline.

## Pruebas ejecutadas

- Escaneo reproducible con `supabase_dependency_scan.py` sobre 189 archivos.
- Conteos contrastados con [schema-inventory.md](../schema-inventory.md).
- **No ejecutado:** consulta a `pg_policies`, `pg_extension` o `pg_proc` en una base real.

## Dependencias para otros agentes

- [Tarea 3](../identity-schema-proposal.md): reemplazo de Auth.
- [Tarea 4](../multitenancy-isolation.md): reescritura de RLS.
- [Tarea 5](../rpc-migration-matrix.md): funciones con claims y `SECURITY DEFINER`.
- [Cierre documental](../README.md): ADRs de identidad y RLS, índice y QA.
