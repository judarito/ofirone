# Reporte Tarea 5 — Portabilidad de RPCs y funciones SQL

**Fecha:** 2026-11-09
**Documento base:** [rpc-migration-matrix.md](../rpc-migration-matrix.md)
**Estado:** completada (análisis estático)

## Tarea

Enumerar todas las funciones SQL/RPC; clasificarlas como mantener en PostgreSQL, mover a Go, dividir SQL/Go o eliminar; documentar parámetros, retornos, efectos, permisos, atomicidad, locks e idempotencia.

## Estado

Completada con **265 firmas** clasificadas, una por una, en la matriz. No se ejecutó SQL ni se caracterizó ninguna función contra una base ([rpc-migration-matrix.md §1](../rpc-migration-matrix.md#L15-L40)).

## Archivos creados/modificados

- [`docs/database-portability/rpc-migration-matrix.md`](../rpc-migration-matrix.md) — tabla maestra de 265 firmas y prioridades.
- [`docs/database-portability/rpc-characterization-matrix.md`](../rpc-characterization-matrix.md) — contratos y pruebas de paridad.
- [`docs/database-portability/_data/listings-and-rpcs.md`](../_data/listings-and-rpcs.md) — inventario de firmas (§B.2–B.3).
- [`docs/database-portability/_data/sql-functions.json`](../_data/sql-functions.json) — evidencia.
- ADR [004](../../decisions/ADR-004-rpc-sql-vs-go.md).

## Hallazgos principales

| Métrica | Valor |
|---|---:|
| Sentencias `CREATE FUNCTION` en los tres directorios | 363 |
| **Firmas únicas clasificadas** | **265** |
| Nombres únicos / redefinidos | 256 / 60 |
| `SECURITY DEFINER` / sin `search_path` | 160 / 61 |
| Funciones que leen `auth.uid()`/`auth.jwt()` | 57 |
| Funciones trigger | 57 |

**Distribución por clase** (265 firmas):

| Clase | Destino | Firmas |
|---|---|---:|
| M | Mantener como función/vista PostgreSQL | 64 |
| G | Trasladar a caso de uso Go | 54 |
| X | Dividir: primitiva SQL + lógica Go | 68 |
| E | Eliminar por obsolescencia | 30 |
| T | Trigger | 49 |

1. **La lógica crítica vive en SQL:** venta, stock, layaway, compras y contabilidad son `plpgsql` que mezclan autorización, validación, numeración y efectos multi-tabla ([§1](../rpc-migration-matrix.md#L20-L34)).
2. **El stock está duplicado:** `stock_balances` (tabla→matview), `inventory_moves` (ledger) e `inventory_batches`; `fn_apply_stock_delta` es la mayor fuente de doble aplicación ([§5.4](../rpc-migration-matrix.md)).
3. **Idempotencia global:** `sp_create_sale_idempotent` usa `operation_id` como PK global sin tenant ni hash ([`mobile/ADD_IDEMPOTENT_MOBILE_SALES.sql:15-16`](../../../mobile/migrations/ADD_IDEMPOTENT_MOBILE_SALES.sql#L15-L16)).
4. **`SECURITY DEFINER` sustituye autorización:** 61 definiciones sin `search_path`; tres funciones contables devuelven errores como JSON `success:false`, no como excepción ([§1](../rpc-migration-matrix.md#L20-L34)).
5. **Colas incompletas:** claim usa `FOR UPDATE SKIP LOCKED`, pero complete/fail no validan `locked_by` ni lease ([`ADD_ASYNC_JOB_QUEUE.sql:258-356`](../../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L258-L356)).
6. **Dispatchers no portables:** `fn_push_dispatcher_cron` usa `pg_cron` + `net.http_post` + Vault; debe ser worker Go.
7. **La importación masiva no tiene RPC:** son tablas, trigger de `storage.objects` y trigger de email; hay que portar el flujo.

## Riesgos

- Elegir la «última aparición textual» como definición vigente es incorrecto sin `pg_proc` del esquema desplegado.
- Mover todo a Go pierde atomicidad, locks y rendimiento set-based.
- Mantener todo en SQL conserva `auth.*`, `SECURITY DEFINER` sin `search_path` y lógica no testeable.
- Firmas X mal delimitadas pueden fragmentar una venta en commits independientes.
- Las claves de idempotencia globales pueden devolver el resultado de otro tenant.

## Decisiones recomendadas

- Aprobar [ADR-004](../../decisions/ADR-004-rpc-sql-vs-go.md): primitivas transaccionales estrechas en SQL (`M`/`X`), autorización y orquestación en Go (`G`), eliminación de helpers de plataforma (`E`).
- Fijar **una definición vigente por nombre** con procedencia y parches incorporados.
- Reescribir las funciones conservadas con `SECURITY INVOKER`, `search_path` fijo y sin `auth.*`.
- Incluir `tenant_id` en toda clave de idempotencia y añadir hash de payload.
- Caracterizar las P0 (venta, devolución, stock, layaway, compras, contabilidad, colas) antes de retirar una función.

## Pruebas ejecutadas

- Clasificación estática de las 265 firmas y cruce con `_data/listings-and-rpcs.md`.
- Conteo de clases verificado sobre la tabla maestra.
- **No ejecutado:** caracterización, concurrencia, locks, idempotencia, planes de ejecución ni paridad con Go.

## Dependencias para otros agentes

- Backend Go: implementar `G`, abrir transacciones `X` y mapear errores.
- [Tarea 6](../pagination-query-matrix.md): vistas/funciones usadas por listados.
- [Tarea 7](../data-migration-runbook.md): no reejecutar efectos al cargar históricos.
- [Tarea 8](08-task.md): validador de `SECURITY DEFINER` y `auth.*`.
