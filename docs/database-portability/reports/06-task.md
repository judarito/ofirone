# Reporte Tarea 6 — Paginación y consultas de listados

**Fecha:** 2026-11-09
**Documento base:** [pagination-query-matrix.md](../pagination-query-matrix.md)
**Estado:** completada (análisis estático)

## Tarea

Enumerar los listados de web y mobile; detectar falta de límite, paginación incompleta u orden no determinista; proponer índices para filtros/orden/cursor; decidir total exacto vs `has_next`; detectar joins que multiplican filas; documentar queries de referencia con `EXPLAIN` esperado.

## Estado

Completada como análisis. **No se ejecutó SQL ni `EXPLAIN`**: DEV estaba vacía al momento del análisis (hoy con baseline aplicado) y PROD bloqueado ([pagination-query-matrix.md §1](../pagination-query-matrix.md#L15-L43)). Los planes del documento son hipótesis.

## Archivos creados/modificados

- [`docs/database-portability/pagination-query-matrix.md`](../pagination-query-matrix.md) — 200 listados, offsets, cursores, índices y patrón keyset.
- [`docs/database-portability/_data/listings-and-rpcs.md`](../_data/listings-and-rpcs.md) — Parte A (200 listados, 466 consultas).
- [`docs/database-portability/_data/query-sites.json`](../_data/query-sites.json) — evidencia.
- [`tools/database/extract_query_sites.py`](../../../tools/database/extract_query_sites.py) — reproducibilidad.

## Hallazgos principales

| Métrica | Valor |
|---|---:|
| Consultas de tabla inventariadas | 466 |
| **Listados analizados** | **200** |
| Listados sin límite | 102 |
| Listados con offset (`.range`) | 48 |
| Listados con orden sin desempate único | 179 |
| Listados sin orden declarado | 21 |
| Listados con `count: "exact"` | 53 |
| Listados sobre vistas o `stock_balances` | 39 |
| Entidades distintas | 78 |

1. **El problema principal es la estabilidad, no el tamaño:** 179 de 200 listados no incluyen clave única en `ORDER BY`; con offset o keyset sin desempate se duplican u omiten filas ([§1](../pagination-query-matrix.md#L15-L43)).
2. **102 listados descargan todo el tenant:** once son `stock_balances`, siete `locations`, cinco `categories`, cinco `product_media` y cuatro `inventory_moves`.
3. **48 usan offset; 45 piden además `count: "exact"`.** El offset crece linealmente y es incorrecto ante cambios concurrentes ([§5](../pagination-query-matrix.md#L233-L301)).
4. **53 piden total exacto, a menudo sin límite ni orden;** `supplier_payables` es el ejemplo citado ([`mobile/src/services/purchases.service.js:774`](../../../mobile/src/services/purchases.service.js#L774)).
5. **Hay consultas que no filtran tenant y dependen de RLS:** `third_parties` en mobile y el conteo de notificaciones no leídas; en PostgreSQL portable el `COUNT` sería global ([§1](../pagination-query-matrix.md#L15-L43)).
6. **Vistas y matview mezclan grano:** `stock_balances` agrega por `(tenant_id, location_id, variant_id)`; `vw_kardex` es una fila por movimiento, no por venta ([`SpVistasFN.sql:616-641`](../../../shared/supabase/migrations/SpVistasFN.sql#L616-L641)).
7. **Los índices existentes no cubren los cursores:** `ix_sales_tenant_date` es `(tenant_id, sold_at DESC)` sin `sale_id` ([`InitDB.sql:388`](../../../shared/supabase/migrations/InitDB.sql#L388)); el de terceros usa `lower(legal_name)` sin `id` ([`ADD_THIRD_PARTIES.sql:61`](../../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L61)).
8. **`ILIKE '%texto%'` no es paginable barato sin trigramas;** no se asume `pg_trgm` ni `unaccent` ([§9.5](../pagination-query-matrix.md#L549-L560)).

## Riesgos

- Añadir `LIMIT` sin orden total traslada el problema: páginas inestables.
- Un `COUNT(*)` exacto sobre 102 listados sin filtro es caro y puede bloquear.
- Paginar vistas con joins que multiplican filas produce totales y páginas incorrectas.
- El cursor debe vincularse a tenant, filtros, orden y versión del contrato; si no, se puede reutilizar entre consultas.
- Los planes propuestos no están medidos; crear 45 índices sin `EXPLAIN` encarece escrituras.

## Decisiones recomendadas

- Adoptar **keyset/cursor con orden total y `has_next`**; reservar el total exacto para primera página de catálogos/backoffice con conteo indexado y cacheado.
- Añadir el desempate por PK a todo `ORDER BY` antes de definir el cursor.
- Crear primero los índices de §9.2 en base desechable con datos sintéticos y medir `EXPLAIN (ANALYZE, BUFFERS)`.
- Calcular totales y sumas con los mismos filtros sobre el conjunto completo; no sumar la página.
- Resolver reportes/exportaciones por streaming/agregado, no por páginas.

## Pruebas ejecutadas

- Inventario estático de 466 consultas y clasificación de 200 listados.
- Revisión de patrones de orden, offset, `count` y joins multiplicadores.
- **No ejecutado:** `EXPLAIN`, `EXPLAIN ANALYZE`, conteos reales, pruebas de páginas consecutivas.

## Dependencias para otros agentes

- Backend Go: implementar cursor, `has_next` y filtros server-side.
- Frontend: adaptar contratos de paginación (fuera del perímetro de este plan).
- [Tarea 5](../rpc-migration-matrix.md): vistas/funciones que alimentan listados.
- [Tarea 7](../data-migration-runbook.md): validar que la paginación no duplica/omite tras la carga.
