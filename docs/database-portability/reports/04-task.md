# Reporte Tarea 4 — Diseño de aislamiento multi-tenant

**Fecha:** 2026-11-09
**Documento base:** [multitenancy-isolation.md](../multitenancy-isolation.md)
**Estado:** completada (análisis estático)

## Tarea

Revisar todas las tablas y marcar `tenant_id` directo o derivado; detectar relaciones de acceso cruzado; proponer constraints y claves compuestas; separar controles PostgreSQL/Go; proponer RLS portable; crear casos negativos A/B.

## Estado

Completada como análisis y diseño. No se añadieron constraints ni se ejecutaron pruebas negativas: DEV estaba vacía al momento del análisis (hoy con baseline aplicado) y PROD bloqueado ([multitenancy-isolation.md §1](../multitenancy-isolation.md#L16-L47)).

## Archivos creados/modificados

- [`docs/database-portability/multitenancy-isolation.md`](../multitenancy-isolation.md) — matriz de 116 objetos, riesgos, constraints, RLS y casos N1–N20.
- ADR [003](../../decisions/ADR-003-aislamiento-multi-tenant.md) — decisión de aislamiento.
- Insumos: [`_data/table-catalog.json`](../_data/table-catalog.json), [`_data/static-analysis.json`](../_data/static-analysis.json).

## Hallazgos principales

| Métrica | Valor |
|---|---:|
| Objetos con ámbito de tabla | 116 (115 tablas + `stock_balances`) |
| Objetos con `tenant_id` | 98 |
| Objetos sin `tenant_id` | 18 (5 derivadas + 12 catálogos + 1 respaldo) |
| Tablas puente sin tenant | 2 (`user_roles`, `role_permissions`) |
| **FK compuestas con `tenant_id`** | **0** |
| Tablas con `tenant_id` y sin RLS (canónico) | 23 |
| `UNIQUE` que empiezan por `tenant_id` | ≥ 53 |
| Casos negativos diseñados | N1–N20 |

1. **`tenant_id` es omnipresente pero no relacional:** todas las FK históricas referencian solo el UUID del padre; la base acepta que una fila del tenant A apunte a una del B ([§5.1](../multitenancy-isolation.md#L141-L170)).
2. **Tablas puente sin tenant:** `user_roles` y `role_permissions` se protegen con `has_permission(...)` sin comprobar que rol y usuario sean del mismo tenant ([`RLS_Security.sql:92-100`](../../../shared/supabase/migrations/RLS_Security.sql#L92-L100)).
3. **Tenant anulable o sin FK:** `third_parties.tenant_id` es nullable; `audit_log.tenant_id` no tiene FK; seis tablas de facturación lo añaden dinámicamente ([§5.3](../multitenancy-isolation.md#L183-L193)).
4. **Funciones críticas confían en `p_tenant`:** `sp_create_sale` valida variante/caja/método pero no que `p_location`, `p_customer` o `p_sold_by` sean del tenant ([§5.5](../multitenancy-isolation.md#L203-L215)).
5. **`stock_balances` es matview:** no admite RLS; cualquier rol con `SELECT` ve todos los tenants ([§5.4](../multitenancy-isolation.md#L194-L202)).
6. **Workers globales:** `fn_claim_async_jobs` reclama jobs de todos los tenants y complete/fail no validan lease ([`ADD_ASYNC_JOB_QUEUE.sql:219-356`](../../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L219-L356)).

## Riesgos

- Migrar sin FK compuestas deja la integridad multi-tenant solo en Go; un worker o SQL manual puede cruzar tenants.
- Añadir `tenant_id NOT NULL` sin backfill previo falla o fuerza valores arbitrarios.
- RLS sobre matviews no existe; `stock_balances` requiere vista normal o grants restringidos.
- Reutilizar conexiones del pool sin limpiar `app.tenant_id` filtra el tenant anterior.

## Decisiones recomendadas

- `tenant_id` directo y `NOT NULL` en toda tabla de negocio; excepciones explícitas para catálogos globales ([ADR-003 §1](../../decisions/ADR-003-aislamiento-multi-tenant.md)).
- `UNIQUE (tenant_id, <pk>)` en todo padre y **FK compuestas** en todo hijo ([ADR-003 §2-3](../../decisions/ADR-003-aislamiento-multi-tenant.md)).
- RLS como **defensa en profundidad**, no autorización primaria; contexto con `set_config('app.tenant_id', $1, true)` y `FORCE ROW LEVEL SECURITY`.
- RBAC y validación de IDs del payload en Go; la FK compuesta es la red de seguridad.
- Ejecutar N1–N20 antes de declarar aislamiento.

## Pruebas ejecutadas

- Análisis estático de 116 objetos y cruce con el catálogo de tablas.
- Casos negativos **diseñados** con SQLSTATE esperados (`42501`, `23503`, `23502`, `23505`, `23514`) ([§9](../multitenancy-isolation.md#L482-L575)).
- **No ejecutado:** constraints, RLS, casos N1–N20, reutilización de pool.

## Dependencias para otros agentes

- [Tarea 3](../identity-schema-proposal.md): `tenant_memberships` como raíz de identidad.
- [Tarea 5](../rpc-migration-matrix.md): primitivas que reciben tenant/actor explícitos.
- [Tarea 7](../data-migration-runbook.md): backfill y detección de filas cruzadas.
- Backend Go: resolver tenant desde la membresía, fijar contexto y mapear `42501`/`23503`.
