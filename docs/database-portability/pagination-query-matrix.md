# Matriz de paginación y consultas de listados

- **Fecha:** 2026-11-09
- **Tarea:** #6 de [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md) — «Paginación y consultas de listados»
- **Estado:** completada (análisis estático); **sin ejecutar SQL ni `EXPLAIN`** contra DEV o PROD
- **Entregable:** este documento
- **Insumos principales:** [`_data/listings-and-rpcs.md`](_data/listings-and-rpcs.md) (Parte A: 200 listados), [`_data/query-sites.json`](_data/query-sites.json), [`schema-inventory.md`](schema-inventory.md), [`rpc-migration-matrix.md`](rpc-migration-matrix.md), [`baseline-proposal.md`](baseline-proposal.md)
- **Fuente del código:** `web/src/` y `mobile/src/` a la fecha del análisis; rutas relativas a la raíz del repositorio
- **Alcance:** consultas y estructura de datos. **No se crean endpoints, repositorios, migraciones ni índices.**

> **Regla de lectura.** Todo conteo es de **sitios de consulta en archivos**, no de filas ni de planes reales. DEV está vacía (0 objetos, PostgreSQL 18.6) y PROD está bloqueado por política (el usuario no es de solo lectura), por lo que **no existe validación en base** ([`schema-inventory.md` §2.2](schema-inventory.md#22-estado-de-las-bases-dato-ya-capturado-no-se-repitieron-conexiones)). Donde el análisis estático no alcanza se escribe **«a verificar»**. Los `EXPLAIN` de este documento son **hipótesis de plan**, no observaciones.

---

## 1. Resumen ejecutivo

| Métrica | Valor | Fuente |
|---|---:|---|
| Consultas de tabla inventariadas | 466 | [`_data/listings-and-rpcs.md` §A.1](_data/listings-and-rpcs.md#a1-cobertura-y-método) |
| **Listados** analizados | **200** | ídem; [`_data/query-sites.json`](_data/query-sites.json) |
| Listados **sin límite** (ni `range`, ni `limit`, ni `count`) | **102** | [`_data/listings-and-rpcs.md` §A.1](_data/listings-and-rpcs.md#a1-cobertura-y-método) |
| Listados con **offset** (`.range(...)`) | **48** | ídem |
| Listados con **orden sin clave de desempate** | **179** | ídem |
| Listados **sin orden declarado** | 21 | ídem |
| Listados que piden **`count: "exact"`** | **53** | ídem |
| Conteos `head: true` | 17 con entidad resuelta (+1 dinámico) | ídem; [`_data/query-sites.json`](_data/query-sites.json) |
| Listados sobre **vistas o `stock_balances` (matview)** | 39 (26 sobre 17 vistas + 13 sobre la matview) | [`_data/listings-and-rpcs.md` §A.3](_data/listings-and-rpcs.md#a3-consultas-de-tabla) |
| Entidades distintas con listados | 78 | ídem |

**Hallazgos que condicionan el diseño**

1. **El problema no es solo el tamaño: es la estabilidad.** De 200 listados, 179 no incluyen una clave única en `ORDER BY`. Con offset, una inserción o un empate desplaza filas entre páginas; con keyset, un empate sin desempate también puede duplicar u omitir. La solución exige **orden total** (columna de orden + PK/`UNIQUE`) antes de elegir cursor.
2. **102 listados devuelven el conjunto completo del tenant.** Once son `stock_balances`, siete `locations`, cinco `categories`, cinco `product_media` y cuatro `inventory_moves`; el resto se reparte entre catálogos, vistas y reportes (§4). No todos deben paginarse: los reportes y exportaciones deben resolverse por streaming/agregado, no por páginas.
3. **48 listados usan offset**; 45 de ellos piden además `count: "exact"`. El offset crece linealmente en costo y es incorrecto ante cambios concurrentes. La tabla completa y el cursor propuesto por entidad están en §5.
4. **El total exacto se pide 53 veces, a menudo sin límite y sin orden.** `supplier_payables` pide `count: "exact"` sin `limit` ni `order` (por ejemplo [`mobile/src/services/purchases.service.js:774`](../../mobile/src/services/purchases.service.js#L774)). Contar y luego traer todo el conjunto no es paginación: es un `COUNT(*)` caro seguido de una descarga completa.
5. **Hay consultas que ni siquiera filtran tenant** y que hoy se apoyan en RLS de Supabase: `third_parties` en mobile ([`mobile/src/services/thirdParties.service.js:9`](../../mobile/src/services/thirdParties.service.js#L9)) y el conteo de notificaciones no leídas ([`mobile/src/services/notifications.service.js:22`](../../mobile/src/services/notifications.service.js#L22), solo `is_read = false`). En PostgreSQL portable el `COUNT` sería **global entre tenants**. Se documenta aquí porque invalida cualquier total y cualquier cursor.
6. **Las vistas y la vista materializada mezclan grano.** `stock_balances` es una matview agregada por `(tenant_id, location_id, variant_id)` ([`ADD_EXPIRATION_BATCHES_PHASE2.sql:165-176`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L165-L176)); `vw_kardex` es una fila por movimiento, no por venta ([`SpVistasFN.sql:616-641`](../../shared/supabase/migrations/SpVistasFN.sql#L616-L641)). Contar «ventas» sobre el kardex o unir la matview con `inventory_batches` multiplica filas.
7. **Los índices existentes no cubren los cursores propuestos.** `ix_sales_tenant_date` es `(tenant_id, sold_at DESC)` y **no incluye `sale_id`** ([`InitDB.sql:388`](../../shared/supabase/migrations/InitDB.sql#L388)); el índice de terceros es sobre `lower(legal_name)` y sin `third_party_id` ([`ADD_THIRD_PARTIES.sql:61`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L61)), mientras las consultas ordenan por `legal_name` sin `lower()`. §9 detalla las brechas.
8. **La búsqueda `ILIKE '%texto%'` no es paginable de forma barata sin una decisión explícita.** No se asume `pg_trgm` ni `unaccent`: son extensiones de `contrib`, no del núcleo, y requieren `CREATE EXTENSION`; su instalación y sus índices son una decisión de despliegue. §9.5 y §11.6 plantean la alternativa portable (prefijo) y la decisión pendiente.

**Decisión recomendada en una frase:** adoptar **keyset/cursor con orden total y `has_next`**, reservar el **total exacto** para la primera página de catálogos y backoffice con conteo indexado y cacheado, y **no migrar a ciegas**: primero índices y datos sintéticos, luego repositorios, luego UI.

---

## 2. Método, alcance y convenciones

### 2.1 Fuente y definición de «listado»

La Parte A de [`_data/listings-and-rpcs.md`](_data/listings-and-rpcs.md) se generó con [`tools/database/build_listings_and_rpcs.py`](../../tools/database/build_listings_and_rpcs.py). La clasificación usada aquí es la misma del generador ([`build_listings_and_rpcs.py:359-369`](../../tools/database/build_listings_and_rpcs.py#L359-L369)):

| Tipo | Criterio estático | Universo |
|---|---|---:|
| `listado` | tiene `order`, `range`, `limit > 1`, `count`, es vista `vw_*` o es `stock_balances` | **200** |
| `conteo` | `count: "exact"` + `head: true` | 17 (+1 dinámico) |
| `detalle` | `limit(1)` / `.single()` / `.maybeSingle()` | 166 |
| `consulta` | multirregistro sin orden ni límite | 83 |

Un «listado» es, por tanto, una consulta **pensada para devolver varias filas a una pantalla**. No incluye mutaciones (74) ni tablas dinámicas no resueltas (7). El inventario completo, con los mismos campos, está en [`_data/query-sites.json`](_data/query-sites.json); el catálogo de los 200 listados está en el [Anexo A](#anexo-a--catálogo-de-los-200-listados).

### 2.2 Estado de las bases y por qué no hay planes reales

| Entorno | Estado | Consecuencia para esta tarea |
|---|---|---|
| **DEV** | Conectable pero **vacía**: 0 tablas, 0 vistas, 0 funciones. PostgreSQL 18.6. | No hay datos ni estadísticas: un `EXPLAIN` daría planes triviales y engañosos. |
| **PROD** | **Bloqueado por política**: el usuario tiene `CREATE`, no es de solo lectura. No se analizó. | No se puede observar el esquema desplegado, los índices reales ni la distribución de datos. |

Por eso este documento **no ejecuta** `EXPLAIN` ni `EXPLAIN ANALYZE`. Los planes de §11 son **outlines esperados** que deben validarse en una base desechable con datos sintéticos representativos (al menos 100k ventas, 20k variantes, 50k movimientos y dos tenants de tamaños distintos). El detalle de la limitación está en [`schema-inventory.md` §2.2-2.3](schema-inventory.md#22-estado-de-las-bases-dato-ya-capturado-no-se-repitieron-conexiones).

### 2.3 Códigos de la matriz

En el [Anexo A](#anexo-a--catálogo-de-los-200-listados) cada fila usa códigos compactos:

| Columna | Código | Significado |
|---|---|---|
| **Paginación** | `SL` | sin límite, sin `range`, sin `count` |
| | `SL/T` | sin límite, pero con `count: "exact"` |
| | `OFF` | `.range(from, to)` o `.range(offset, offset+n)` |
| | `LF n` | límite fijo literal (`limit(50)`, `limit(100)`…) |
| | `LV` | límite variable (`limit`, `pageSize`, `Math.max(...)`) |
| **Total** | `T` | pide `count: "exact"` |
| | `H` | no pide total; se recomienda `has_next` |
| **Orden** | `D` | incluye una clave `*_id`/`id` en `ORDER BY` (determinista) |
| | `ND` | no incluye clave única: **orden no determinista** (puede ser único por constraint, a verificar) |
| | `—` | sin `ORDER BY` |
| **Tenant** | `S` | filtra `tenant_id` explícito |
| | `I` | solo por FK (`sale_id`, `cash_session_id`, `cash_register_id`…) |
| | `N` | no filtra tenant |
| | `G` | catálogo global / `N/A` por diseño |
| **Riesgo** | `L` | sin límite |
| | `O` | offset |
| | `D` | orden sin desempate |
| | `N` | sin tenant explícito (o solo por FK) |

> **Nota:** `ND` no implica que el orden sea aleatorio. Un `ORDER BY name` puede ser único si existe `UNIQUE (tenant_id, name)`; el análisis estático no lo garantiza para todas las entidades. La regla conservadora es **añadir la PK al `ORDER BY`** y al índice.

### 2.4 Lo que este documento no hace

- No crea endpoints, rutas HTTP, DTOs ni repositorios Go.
- No modifica consultas de `web/src/` ni `mobile/src/`.
- No crea índices ni migraciones; solo propone DDL para revisión.
- No ejecuta `EXPLAIN`, `COUNT(*)` ni ninguna consulta contra DEV/PROD.
- No decide la sintaxis final de la API; solo el **contrato de datos** que la soporta.

### 2.5 Correspondencia con los requisitos de la Tarea 6

| Requisito | Sección | Evidencia |
|---|---|---|
| Enumerar todos los listados de web y mobile | [Anexo A](#anexo-a--catálogo-de-los-200-listados) | 200 filas con `archivo:línea`, entidad, orden, paginación, total y tenant |
| Identificar sin límite, paginación incompleta y orden no determinista | §4, §4.4, §5, §6 | 102 sin límite; 48 offset; 179 sin desempate; 16 top-N; 26 límite variable |
| Proponer índices para filtros, orden y cursor | §9 | 45 índices concretos + brechas de los existentes |
| Definir total exacto vs `has_next` | §7 | Criterios, familias y conteos incorrectos |
| Detectar joins que multiplican filas o alteran conteos | §8 | 9 casos con evidencia y regla de conteo |
| Documentar queries de referencia con `EXPLAIN` esperado | §11 | 7 outlines + resumen; **no ejecutados** |
| Patrón keyset portable | §10 | Contrato, SQL, variantes, nulos, colación y prueba |
| No crear endpoints | §2.4 | Alcance explícito |

---

## 3. Diagnóstico agregado

### 3.1 Entidades con más listados y más riesgo

Ordenadas por una puntuación simple de riesgo (`3 × offset + 2 × sin_límite + sin_desempate`). Es una priorización, no una métrica de negocio.

| Entidad | Listados | Sin límite | Offset | Sin desempate | `count` exacto | Lectura |
|---|---:|---:|---:|---:|---:|---|
| `stock_balances` (matview) | 13 | 11 | 2 | 3 | 2 | Agregado de lotes; 11 consultas traen todo el tenant. |
| `locations` | 9 | 7 | 2 | 9 | 2 | Catálogo pequeño, pero usado como filtro en cascada. |
| `third_parties` | 6 | 0 | **6** | 6 | 4 | Todo offset; dos consultas mobile **sin tenant**. |
| `categories` | 7 | 5 | 2 | 7 | 2 | Catálogo; orden por `name` sin `id`. |
| `inventory_batches` | 5 | 2 | 3 | 5 | 3 | FEFO y vencimientos; orden por `expiration_date`. |
| `product_media` | 5 | 5 | 0 | 5 | 0 | Galería; sin límite ni orden total. |
| `products` | 6 | 0 | 3 | 5 | 2 | Embebe variantes 1:N; conteo exacto. |
| `users` | 4 | 2 | 2 | 4 | 2 | Orden por `created_at` sin `user_id`. |
| `cash_registers` | 4 | 2 | 2 | 4 | 2 | Catálogo de cajas. |
| `cash_sessions` | 4 | 2 | 2 | 4 | 2 | Turnos; orden por `opened_at`. |
| `roles` | 4 | 2 | 2 | 4 | 2 | Catálogo por tenant. |
| `taxes` | 4 | 2 | 2 | 4 | 2 | Catálogo por tenant. |
| `units_of_measure` | 4 | 2 | 2 | 4 | 2 | Catálogo global + tenant (`tenant_id IS NULL`). |
| `inventory_moves` | 4 | **4** | 0 | 4 | 0 | Kardex; todo sin límite. |
| `sales` | 4 | 1 | 2 | 3 | 2 | Historial; offset + `count` exacto. |
| `cash_movements` | 3 | 1 | 2 | 3 | 2 | Arqueo por sesión; offset. |
| `payment_methods` | 3 | 1 | 2 | 3 | 2 | Catálogo; orden `sort_order, name`. |
| `bill_of_materials` | 3 | 1 | 2 | 3 | 2 | Manufactura; offset. |
| `tax_rules` | 3 | 1 | 2 | 3 | 2 | Reglas; orden `scope, priority`. |
| `product_variants` | **11** | 0 | 0 | **10** | 0 | Muchos límites fijos pequeños; orden por `sku`. |
| `customer_credit_accounts` | 3 | 3 | 0 | 3 | 0 | Cartera; orden por `current_balance`. |
| `permissions` | 3 | 3 | 0 | 3 | 0 | Catálogo global. |
| `menu_items` | 3 | 3 | 0 | 3 | 0 | Catálogo global. |
| `pricing_rules` | 3 | 1 | 1 | 3 | 2 | Prioridad + fecha. |
| `production_orders` | 2 | 0 | 2 | 2 | 2 | Offset + `count` exacto. |
| `accounting_accounts` | 2 | 2 | 0 | 2 | 0 | Plan contable; orden por `code`. |
| `vw_kardex` | 2 | 0 | 1 | 2 | 2 | Vista 1:1 con movimientos; offset. |
| `purchases` | 2 | 0 | 1 | 2 | 2 | Historial de compras; offset. |
| `cash_register_assignments` | 2 | 0 | 1 | 1 | 2 | Filtro por `cash_register.location_id` embebido. |
| `supplier_payables` | 2 | 0 | 0 | 0 | 2 | `count` exacto sin límite ni orden. |
| `system_alerts` | 3 | 0 | 0 | 3 | 0 | Orden por `created_at` sin `alert_id`. |
| `customer_credit_movements` | 3 | 0 | 0 | 3 | 0 | Límite 200/8000; orden por `created_at`. |

El resto de las 78 entidades aparece en el [Anexo A](#anexo-a--catálogo-de-los-200-listados). La tabla agregada de 30 entidades de [`_data/listings-and-rpcs.md` §A.4](_data/listings-and-rpcs.md#a4-señales-agregadas-por-entidad) confirma el mismo patrón: `units_of_measure`, `product_variants`, `sales`, `products`, `categories`, `locations` y `stock_balances` concentran las señales.

### 3.2 Tres regímenes distintos que no deben tratarse igual

| Régimen | Ejemplos | Estrategia de paginación | Total |
|---|---|---|---|
| **Catálogo pequeño y estable** | `categories`, `locations`, `taxes`, `roles`, `units_of_measure`, `payment_methods`, `menu_items`, `permissions`, `billing_plans`, `document_types` | Límite máximo duro (p. ej. 500) + keyset por `(name, id)`; si el catálogo cabe, una sola consulta con `LIMIT` y sin cursor | Exacto aceptable con índice; cachear |
| **Transaccional / historial** | `sales`, `cash_sessions`, `cash_movements`, `purchases`, `production_orders`, `inventory_batches`, `inventory_moves`, `supplier_payables`, `sale_returns`, `online_orders` | **Keyset obligatorio**; offset solo como compatibilidad temporal | `has_next` por defecto; exacto en primera página si se necesita |
| **Vistas / agregados** | `stock_balances`, `vw_kardex`, `vw_layaway_summary`, `vw_stock_alerts`, `vw_expiring_products`, `vw_inventory_rotation_analysis` | Keyset sobre columnas del agregado; definir **grano** antes de contar | `has_next`; el total exacto suele ser caro y engañoso |

### 3.3 Hallazgos transversales

1. **El tenant no siempre está en la consulta.** 11 listados/consultas no filtran `tenant_id` y 8 lo hacen solo por una FK ([`_data/listings-and-rpcs.md` §A.1](_data/listings-and-rpcs.md#a1-cobertura-y-método)); en listados puros, los casos más graves son `third_parties` mobile y notificaciones. Sin tenant explícito, el prefijo de todo índice multi-tenant pierde sentido y el conteo es incorrecto.
2. **`count: "exact"` se combina con `SELECT *` y embeds.** Ver §8. El conteo debe ejecutarse sobre la **tabla raíz**, con el mismo `WHERE` y sin joins, o aceptar que el número no coincide con las filas devueltas.
3. **La búsqueda es `ILIKE '%…%'` en la mayoría de los catálogos.** Eso impide un `Index Scan` por rango; sin trigramas, el plan esperado es `Seq Scan`/`Parallel Seq Scan` con filtro. La paginación por cursor sigue funcionando, pero el costo por página no baja. Es una decisión de producto y de extensión (§9.5).
4. **Los catálogos globales con `tenant_id IS NULL`** (`units_of_measure`, `permissions`, `menu_items`, `billing_plans`, `document_types`) requieren un cursor que distinga el bloque global del bloque del tenant. `ORDER BY is_system DESC, name` no basta: `is_system` no es único y `name` puede repetirse entre global y tenant.
5. **La duplicación web/mobile** hace que la misma entidad tenga dos contratos de página. `product_variants` tiene 11 listados con límites fijos de 20 a 500; `sales` tiene offset en web y mobile con `pageSize` distinto. El backend Go debe imponer un **límite máximo único** y un cursor único, no replicar ambos.
6. **`stock_balances` se refresca por trigger o manualmente** ([`ADD_EXPIRATION_BATCHES_PHASE2.sql:192`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L192)). Un cursor sobre `updated_at` de la matview puede «saltar» filas si el refresh cambia `updated_at` entre páginas. Es aceptable para un tablero, no para un arqueo.

---

## 4. Listados sin límite (102)

### 4.1 Distribución

| Entidad | Listados sin límite | Observación |
|---|---:|---|
| `stock_balances` | 11 | Todo el stock del tenant; usado en POS, reportes y manufactura. |
| `locations` | 7 | Catálogo pequeño; se puede limitar a 500. |
| `categories` | 5 | Catálogo; árbol por `parent_category_id`. |
| `product_media` | 5 | Galería por producto; debería ser 1 consulta por producto o `LIMIT`. |
| `inventory_moves` | 4 | Kardex completo por compra/rango; crece sin techo. |
| `customer_credit_accounts` / `permissions` / `menu_items` | 3 cada una (9) | Cartera y catálogos globales. |
| `accounting_accounts`, `bulk_import_errors`, `cash_registers`, `cash_sessions`, `inventory_batches`, `layaway_installments`, `online_order_lines`, `online_order_reservations`, `roles`, `taxes`, `units_of_measure`, `users` | 2 cada una (24) | Catálogos, cuotas, líneas de pedido y usuarios. |
| `vw_batch_traceability`, `vw_expiration_dashboard`, `vw_expiring_products`, `vw_layaway_payments`, `vw_layaway_report` | 2 cada una (10) | Vistas de vencimiento, trazabilidad y separados. |
| 27 entidades con 1 (incluye 8 vistas y 19 tablas) | 27 | `sales`, `cash_movements`, `bill_of_materials`, `billing_plans`, `tenants`, `tenant_subscriptions`, `role_menu_templates`, `vw_stock_alerts`, `vw_stock_for_cashier`, etc. |

### 4.2 Qué hacer con cada grupo

| Grupo | Acción recomendada | Motivo |
|---|---|---|
| Catálogos pequeños (`categories`, `locations`, `taxes`, `roles`, `units_of_measure`, `payment_methods`, `permissions`, `menu_items`, `document_types`) | **Límite máximo duro** (200–500) y keyset si se supera; no crear cursor si el producto garantiza el tamaño | Evita el `SELECT *` accidental sin complicar la UI |
| `product_media` | Cargar por producto (`product_id = $1`) con `LIMIT`; no listar toda la galería del tenant | El patrón actual hace N consultas o una descarga masiva |
| `inventory_moves`, `stock_balances`, `inventory_batches` | **Keyset** por `(created_at/updated_at, id)` o `(expiration_date, batch_id)`; límite 100–200 | Kardex y stock crecen con la operación |
| `customer_credit_accounts` | Keyset por `(current_balance DESC, credit_account_id)`; límite 100 | Cartera completa puede ser grande; el orden por saldo es el de negocio |
| `sales` sin límite | Es un **reporte** (rango de fechas); no paginar por offset; agregar en SQL o exportar por streaming | [`web/src/services/reports.service.js:79`](../../web/src/services/reports.service.js#L79) ordena por `sold_at` sin límite |
| `layaway_installments`, `online_order_lines`, `online_order_reservations` | Filtrar por contrato/pedido y limitar; el conjunto hijo suele ser pequeño | Evita `N+1` y páginas gigantes |
| Vistas de reporte | Mantener como **consulta agregada** o exportación; si se muestran en tabla, keyset sobre la columna de fecha + clave del grano | El total exacto de una vista puede requerir escanear todo |

### 4.3 Vistas y `stock_balances`: primero el grano, después el límite

- `stock_balances` tiene **una fila por `(tenant_id, location_id, variant_id)`** y `updated_at = MAX(updated_at)` de los lotes activos ([`ADD_EXPIRATION_BATCHES_PHASE2.sql:165-176`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L165-L176)). No es «una fila por lote»: unirla a `inventory_batches` multiplica.
- `vw_kardex` es **una fila por movimiento** (`inventory_moves`), con joins 1:1 a `locations`, `product_variants` y `products` ([`SpVistasFN.sql:616-641`](../../shared/supabase/migrations/SpVistasFN.sql#L616-L641)). Contar «ventas» sobre el kardex cuenta movimientos, no ventas.
- `vw_layaway_summary` es una fila por contrato con joins 1:1 a `locations` y `customers` ([`PlanSepare.sql:671-692`](../../shared/supabase/migrations/PlanSepare.sql#L671-L692)). El join no multiplica; el riesgo es que `customers` sea la tabla legada (ver [`schema-inventory.md` §12.3](schema-inventory.md#123-customers--third_parties)).
- `vw_stock_alerts` y `vw_expiring_products` se alimentan de alertas y lotes; su grano es la alerta o el lote, no el producto. Verificar antes de contar «productos con alerta».

**Regla:** documentar el grano de cada vista en el repositorio Go (`stock position`, `movement`, `contract`, `alert`) y no reutilizar el mismo `COUNT` para dos granos.

### 4.4 Completitud de la paginación actual (los 200 listados)

| Estado actual | Sitios | Qué significa | Acción |
|---|---:|---|---|
| **Sin límite** (`SL`) | 102 | Devuelve todo el conjunto del tenant; no hay página siguiente porque no hay página | Límite máximo duro o keyset; los reportes van a agregado/streaming |
| **Sin límite + `count` exacto** (`SL/T`) | 8 | Cuenta todo y luego devuelve todo; el `COUNT` no sirve para paginar | Igual que `SL`; el total solo tiene sentido con página |
| **Offset** (`OFF`) | 48 | Página completa, pero inestable y O(offset) | Migrar a keyset (§5); compatibilidad temporal con tope |
| **Límite fijo** (`LF`) | 16 | Top-N silencioso: si hay más filas, la UI no lo sabe | Documentar como top-N o añadir cursor; no presentar como listado completo |
| **Límite variable** (`LV`) | 26 | Typeahead/búsqueda con `limit`; no es paginación | Tope máximo y, si necesita «ver más», cursor |
| **Total** | **200** | — | — |

Los 16 `LF` se reparten entre `product_variants` (4, typeahead de POS/compras con 20–500), `customer_credit_movements` (3, 200/8000), `transfer_requests` (2), `vw_inventory_rotation_analysis` (2), `purchase_orders` (2), `sales` (1) y `sale_lines` (1); son aceptables como top-N, no como historial. Los 26 `LV` incluyen `product_variants` (7), `system_alerts` (3), `ai_telemetry_events` (2), `bulk_imports` (2), `online_orders` (2), `customers` (2) y `products` (2); deben llevar tope en el repositorio.

---

## 5. Paginación por offset (48)

### 5.1 Los 48 sitios y el cursor propuesto

Todos usan `.range(...)`; 45 piden `count: "exact"` y 3 no. La columna «Cursor propuesto» es la clave de orden total que debe usar el keyset, no una decisión de UI.

| # | Sitio | Entidad | Orden actual | Total | Cursor propuesto |
|---:|---|---|---|---|---|
| 26 | [`mobile/src/services/inventoryCatalog.service.js:514`](../../mobile/src/services/inventoryCatalog.service.js#L514) | `bill_of_materials` | `created_at desc` | exacto | `(created_at DESC, bom_id DESC)` |
| 29 | [`web/src/services/manufacturing.service.js:62`](../../web/src/services/manufacturing.service.js#L62) | `bill_of_materials` | `created_at desc` | exacto | `(created_at DESC, bom_id DESC)` |
| 46 | [`mobile/src/services/cashMenu.service.js:384`](../../mobile/src/services/cashMenu.service.js#L384) | `cash_movements` | `created_at desc` | exacto | `(created_at DESC, cash_movement_id DESC)` |
| 50 | [`web/src/services/cash.service.js:272`](../../web/src/services/cash.service.js#L272) | `cash_movements` | `created_at desc` | exacto | `(created_at DESC, cash_movement_id DESC)` |
| 56 | [`mobile/src/services/cashMenu.service.js:451`](../../mobile/src/services/cashMenu.service.js#L451) | `cash_register_assignments` | `assigned_at desc` | exacto | `(assigned_at DESC, assignment_id DESC)` |
| 58 | [`mobile/src/services/cashMenu.service.js:52`](../../mobile/src/services/cashMenu.service.js#L52) | `cash_registers` | `name` | exacto | `(lower(name), cash_register_id)` |
| 62 | [`web/src/services/cash.service.js:20`](../../web/src/services/cash.service.js#L20) | `cash_registers` | `name` | exacto | `(lower(name), cash_register_id)` |
| 64 | [`mobile/src/services/cashMenu.service.js:152`](../../mobile/src/services/cashMenu.service.js#L152) | `cash_sessions` | `opened_at desc` | exacto | `(opened_at DESC, cash_session_id DESC)` |
| 71 | [`web/src/services/cash.service.js:117`](../../web/src/services/cash.service.js#L117) | `cash_sessions` | `opened_at desc` | exacto | `(opened_at DESC, cash_session_id DESC)` |
| 76 | [`mobile/src/services/categories.service.js:8`](../../mobile/src/services/categories.service.js#L8) | `categories` | `name` | exacto | `(lower(name), category_id)` |
| 85 | [`web/src/services/categories.service.js:21`](../../web/src/services/categories.service.js#L21) | `categories` | `name` | exacto | `(lower(name), category_id)` |
| 112 | [`mobile/src/services/batches.service.js:164`](../../mobile/src/services/batches.service.js#L164) | `inventory_batches` | `expiration_date, received_at desc` | exacto | `(expiration_date, batch_id)` con `NULLS LAST` |
| 115 | [`mobile/src/services/inventoryCatalog.service.js:262`](../../mobile/src/services/inventoryCatalog.service.js#L262) | `inventory_batches` | `expiration_date, received_at desc` | exacto | `(expiration_date, batch_id)` |
| 117 | [`web/src/services/batches.service.js:26`](../../web/src/services/batches.service.js#L26) | `inventory_batches` | `expiration_date, received_at desc` | exacto | `(expiration_date, batch_id)` |
| 151 | [`mobile/src/services/setup.service.js:319`](../../mobile/src/services/setup.service.js#L319) | `locations` | `name` | exacto | `(lower(name), location_id)` |
| 155 | [`web/src/services/locations.service.js:24`](../../web/src/services/locations.service.js#L24) | `locations` | `name` | exacto | `(lower(name), location_id)` |
| 177 | [`mobile/src/services/cashMenu.service.js:528`](../../mobile/src/services/cashMenu.service.js#L528) | `payment_methods` | `sort_order, name` | exacto | `(sort_order, lower(name), payment_method_id)` |
| 181 | [`web/src/services/paymentMethods.service.js:30`](../../web/src/services/paymentMethods.service.js#L30) | `payment_methods` | `sort_order, name` | exacto | `(sort_order, lower(name), payment_method_id)` |
| 187 | [`mobile/src/services/pricingRules.service.js:52`](../../mobile/src/services/pricingRules.service.js#L52) | `pricing_rules` | `priority desc, created_at desc` | exacto | `(priority DESC, created_at DESC, pricing_rule_id DESC)` |
| 249 | [`mobile/src/services/inventoryCatalog.service.js:446`](../../mobile/src/services/inventoryCatalog.service.js#L446) | `production_orders` | `created_at desc` | exacto | `(created_at DESC, production_order_id DESC)` |
| 253 | [`web/src/services/manufacturing.service.js:473`](../../web/src/services/manufacturing.service.js#L473) | `production_orders` | `created_at desc` | exacto | `(created_at DESC, production_order_id DESC)` |
| 259 | [`mobile/src/services/productsCatalog.service.js:220`](../../mobile/src/services/productsCatalog.service.js#L220) | `products` | `name` | exacto | `(lower(name), product_id)` |
| 271 | [`web/src/services/products.service.js:93`](../../web/src/services/products.service.js#L93) | `products` | `name` | exacto | `(lower(name), product_id)`; **no ordenar por variantes** |
| 272 | [`web/src/services/products.service.js:137`](../../web/src/services/products.service.js#L137) | `products` | `name` | — | `(lower(name), product_id)` |
| 285 | [`mobile/src/services/inventoryCatalog.service.js:326`](../../mobile/src/services/inventoryCatalog.service.js#L326) | `purchases` | `created_at desc` | exacto | `(created_at DESC, purchase_id DESC)` |
| 299 | [`mobile/src/services/rolesMenus.service.js:16`](../../mobile/src/services/rolesMenus.service.js#L16) | `roles` | `name` | exacto | `(lower(name), role_id)` |
| 306 | [`web/src/services/roles.service.js:20`](../../web/src/services/roles.service.js#L20) | `roles` | `name` | exacto | `(lower(name), role_id)` |
| 329 | [`web/src/services/sales.service.js:246`](../../web/src/services/sales.service.js#L246) | `sale_returns` | `created_at desc` | exacto | `(created_at DESC, return_id DESC)` |
| 334 | [`mobile/src/services/sales.service.js:120`](../../mobile/src/services/sales.service.js#L120) | `sales` | `sold_at desc` | exacto | `(sold_at DESC, sale_id DESC)` |
| 350 | [`web/src/services/sales.service.js:123`](../../web/src/services/sales.service.js#L123) | `sales` | `sold_at desc` | exacto | `(sold_at DESC, sale_id DESC)` |
| 354 | [`web/src/services/inventory.service.js:484`](../../web/src/services/inventory.service.js#L484) | `stock_alert_log` | `created_at desc` | exacto | `(created_at DESC, alert_id DESC)` |
| 355 | [`mobile/src/services/inventoryCatalog.service.js:122`](../../mobile/src/services/inventoryCatalog.service.js#L122) | `stock_balances` | `updated_at desc` | exacto | `(updated_at DESC, location_id DESC, variant_id DESC)` |
| 362 | [`web/src/services/inventory.service.js:133`](../../web/src/services/inventory.service.js#L133) | `stock_balances` | `updated_at desc` | exacto | `(updated_at DESC, location_id DESC, variant_id DESC)` |
| 375 | [`mobile/src/services/taxRules.service.js:45`](../../mobile/src/services/taxRules.service.js#L45) | `tax_rules` | `scope, priority desc` | exacto | `(scope, priority DESC, tax_rule_id)` |
| 378 | [`web/src/services/taxRules.service.js:14`](../../web/src/services/taxRules.service.js#L14) | `tax_rules` | `scope, priority desc` | exacto | `(scope, priority DESC, tax_rule_id)` |
| 380 | [`mobile/src/services/setup.service.js:398`](../../mobile/src/services/setup.service.js#L398) | `taxes` | `name` | exacto | `(lower(name), tax_id)` |
| 384 | [`web/src/services/taxes.service.js:18`](../../web/src/services/taxes.service.js#L18) | `taxes` | `name` | exacto | `(lower(name), tax_id)` |
| 404 | [`mobile/src/services/thirdParties.service.js:9`](../../mobile/src/services/thirdParties.service.js#L9) | `third_parties` | `legal_name` | exacto | `(lower(legal_name), third_party_id)`; **falta tenant** |
| 405 | [`mobile/src/services/thirdParties.service.js:19`](../../mobile/src/services/thirdParties.service.js#L19) | `third_parties` | `legal_name` | exacto | ídem; **falta tenant** |
| 407 | [`web/src/services/customers.service.js:54`](../../web/src/services/customers.service.js#L54) | `third_parties` | `legal_name` | exacto | `(lower(legal_name), third_party_id)` |
| 408 | [`web/src/services/customers.service.js:63`](../../web/src/services/customers.service.js#L63) | `third_parties` | `legal_name` | exacto | ídem + filtro de búsqueda |
| 412 | [`web/src/services/thirdParties.service.js:9`](../../web/src/services/thirdParties.service.js#L9) | `third_parties` | `legal_name` | — | `(lower(legal_name), third_party_id)` |
| 413 | [`web/src/services/thirdParties.service.js:17`](../../web/src/services/thirdParties.service.js#L17) | `third_parties` | `legal_name` | — | ídem + búsqueda |
| 418 | [`mobile/src/services/units.service.js:9`](../../mobile/src/services/units.service.js#L9) | `units_of_measure` | `is_system desc, name` | exacto | `(is_system DESC, lower(name), unit_id)` + bloque global |
| 423 | [`web/src/services/unitsOfMeasure.service.js:29`](../../web/src/services/unitsOfMeasure.service.js#L29) | `units_of_measure` | `is_system desc, name` | exacto | `(is_system DESC, lower(name), unit_id)` + bloque global |
| 432 | [`mobile/src/services/users.service.js:37`](../../mobile/src/services/users.service.js#L37) | `users` | `created_at desc` | exacto | `(created_at DESC, user_id DESC)` |
| 435 | [`web/src/services/users.service.js:20`](../../web/src/services/users.service.js#L20) | `users` | `created_at desc` | exacto | `(created_at DESC, user_id DESC)` |
| 448 | [`mobile/src/services/inventoryCatalog.service.js:185`](../../mobile/src/services/inventoryCatalog.service.js#L185) | `vw_kardex` | `created_at desc` | exacto | `(created_at DESC, inventory_move_id)` → requiere exponer `inventory_move_id` |
### 5.2 Por qué el offset falla aquí

1. **Corrección:** con `ORDER BY sold_at DESC` y sin `sale_id`, dos ventas con el mismo `sold_at` pueden intercambiarse entre consultas. Con inserciones retroactivas —el extra de web añade `p_sold_at` a `sp_create_sale` ([`ADD_POS_MANUAL_SALE_DATETIME.sql:35-50`](../../web/migrations/ADD_POS_MANUAL_SALE_DATETIME.sql#L35-L50))—, una fila insertada «antes» del cursor desplaza la página y se **duplica** una fila ya vista o se **omite** una no vista.
2. **Costo:** `OFFSET 10000 LIMIT 20` obliga a leer y descartar 10 000 filas. En `sales` con 1M de filas y un filtro de rango, el costo crece con la profundidad; el keyset se detiene en el cursor.
3. **Conteo:** 45 de los 48 piden `count: "exact"`, que ejecuta un segundo recorrido del mismo conjunto. Sin índice que cubra el `WHERE`, el `COUNT` puede dominar la latencia.
4. **Plan inestable:** el planner puede cambiar de `Index Scan` a `Bitmap Heap Scan` + `Sort` según la selectividad; el offset no tiene forma de reutilizar el trabajo de la página anterior.

### 5.3 Compatibilidad temporal

Mientras web/mobile no migren, el repositorio Go puede aceptar `page`/`pageSize` y traducirlos a `OFFSET`, pero con tres condiciones: (a) orden total obligatorio, (b) `OFFSET` máximo (p. ej. 10 000) y (c) respuesta con `has_next` calculado por `limit + 1`, no por `total`. Esta compatibilidad es **de transición**, no el contrato objetivo.

---

## 6. Orden no determinista (179)

### 6.1 Patrones de orden más frecuentes

De los 179 listados/consultas sin clave única en `ORDER BY`:

| Patrón | Apariciones | Entidades típicas | Desempate recomendado |
|---|---:|---|---|
| `created_at DESC` | 37 | `inventory_moves`, `purchases`, `production_orders`, `users`, `bulk_imports` | `(created_at DESC, <pk> DESC)` |
| `name` | 34 | `categories`, `locations`, `roles`, `taxes`, `products` | `(lower(name), <pk>)` + colación fija |
| `sku` | 9 | `product_variants` | `(sku, variant_id)`; `sku` puede repetirse entre tenants |
| `created_at` (ASC) | 8 | `inventory_moves` de compra | `(created_at, <pk>)` |
| `code` | 6 | `accounting_accounts`, `units_of_measure` | `(code, <pk>)` |
| `legal_name` | 6 | `third_parties` | `(lower(legal_name), third_party_id)` |
| `is_cover DESC, sort_order, created_at` | 5 | `product_media` | `(is_cover DESC, sort_order, created_at, media_id)` |
| `sold_at DESC` | 4 | `sales` | `(sold_at DESC, sale_id DESC)` |
| `sort_order, name` | 4 | `payment_methods` | `(sort_order, lower(name), payment_method_id)` |
| `is_system DESC, name` | 4 | `units_of_measure` | `(is_system DESC, lower(name), unit_id)` |
| `expiration_date, received_at DESC` | 3 | `inventory_batches` | `(expiration_date, batch_id)` o `(expiration_date, received_at DESC, batch_id)` |
| `current_balance DESC` | 3 | `customer_credit_accounts` | `(current_balance DESC, credit_account_id DESC)` |
| `full_name` | 3 | `users` | `(lower(full_name), user_id)` |

### 6.2 Reglas para un orden total

1. **Toda consulta paginada debe terminar en una clave única.** Preferir la PK (`sale_id`, `third_party_id`, `cash_movement_id`). Si la PK es UUID, el orden es estable pero no «natural»; es aceptable para el cursor.
2. **La misma expresión en `ORDER BY` y en el índice.** Si se ordena por `lower(name)`, el índice debe ser `(tenant_id, lower(name), id)` y la consulta debe ordenar por `lower(name)`, no por `name`. El índice actual de terceros es `(tenant_id, lower(legal_name))` y las consultas ordenan `legal_name` ([`ADD_THIRD_PARTIES.sql:61`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L61)); el planner no puede usarlo para el orden.
3. **Dirección explícita.** `DESC` en la consulta y `DESC` en el índice; `NULLS LAST` explícito si la columna es nullable.
4. **Colación explícita para texto.** `ORDER BY name` usa la colación de la base; una actualización de ICU/glibc puede cambiar el orden y romper cursores guardados. Para estabilidad, usar `COLLATE "C"` (orden de bytes; los acentos quedan después de `z`, revisar UX) en índice y consulta, o fijar la versión de colación en el despliegue. `lower()` no elimina acentos ni normaliza Unicode.
5. **`updated_at` no es una clave estable.** Cambia con cada actualización; un cursor sobre `updated_at` puede mover filas entre páginas. Es aceptable para tableros («lo último actualizado»), no para auditoría. Para historial, usar `created_at` o una clave inmutable.
6. **Los empates de negocio no son únicos.** `sale_number` es único por `(tenant_id, location_id)` ([`InitDB.sql:286`](../../shared/supabase/migrations/InitDB.sql#L286)), no global; los números de negocio (`sale_number`, `batch_number`) no son claves globales y sus constraints deben verificarse. Usar la PK como desempate, no el número de negocio.
7. **Las vistas deben exponer una clave de grano.** `vw_kardex` no selecciona `inventory_move_id` ([`SpVistasFN.sql:616-628`](../../shared/supabase/migrations/SpVistasFN.sql#L616-L628)); sin esa columna no hay cursor estable. `stock_balances` no tiene PK, pero su `UNIQUE (tenant_id, location_id, variant_id)` permite el desempate triple.

### 6.3 Nullables que rompen el keyset

| Columna | Tablas | Tratamiento |
|---|---|---|
| `expiration_date` | `inventory_batches` | Las consultas condicionan `NOT (expiration_date IS NULL)`; usar índice parcial `WHERE expiration_date IS NOT NULL` y no mezclar el bloque nulo en la misma página. |
| `due_date` | `layaway_contracts`, `supplier_payables` | Filtrar `due_date IS NOT NULL` o usar `(due_date NULLS LAST, id)` con un cursor que codifique el bloque nulo. |
| `updated_at` | `stock_balances` | No nulo en la matview (`MAX(updated_at)`), pero puede cambiar por refresh. |
| `closed_at` | `cash_sessions` | No usar como única clave; ordenar por `opened_at` (nulo mientras el turno está abierto). |
| `tenant_id` | `units_of_measure`, `permissions`, `menu_items`, `billing_plans` | Puede ser `NULL` (global). Ver §6.4. |

### 6.4 Catálogos globales con `tenant_id IS NULL`

`units_of_measure` se consulta con `.or('tenant_id.is.null,tenant_id.eq....')` ([`mobile/src/services/units.service.js:16`](../../mobile/src/services/units.service.js#L16)). Un keyset `(is_system DESC, name)` no distingue filas globales de filas del tenant con el mismo `name`. Opciones:

1. **Recomendada:** ordenar por `(tenant_id IS NULL) DESC, lower(name), unit_id` y usar un índice `(lower(name), unit_id)` parcial para globales + `(tenant_id, lower(name), unit_id)` para el tenant; el cursor incluye un bit `is_global`.
2. Alternativa: clonar los globales por tenant en la migración (cambia el modelo; decisión de producto).
3. Alternativa: no paginar catálogos globales (son pequeños); una consulta con `LIMIT 500` y sin cursor.

---

## 7. Total exacto vs `has_next`

### 7.1 Criterios de decisión

| Situación | Total exacto | `has_next` | Razón |
|---|---|---|---|
| Catálogo pequeño con paginación numerada y «X resultados» | ✅ | — | `COUNT` indexado y cacheable; el usuario espera el número |
| Backoffice con filtros selectivos y total mostrado | ✅ (primera página) | ✅ (siguientes) | Evita repetir el `COUNT` en cada scroll |
| Scroll infinito / mobile | — | ✅ | El usuario no necesita el total; el costo del `COUNT` no se justifica |
| Historial transaccional profundo (`sales`, `cash_movements`, `inventory_moves`) | Opcional en primera página | ✅ | `COUNT` sobre rango grande es caro; el total cambia con cada venta |
| Reporte/exportación | — | — | No paginar: agregado en SQL o streaming |
| Vista agregada (`stock_balances`, `vw_kardex`) | Solo si el grano es pequeño y el índice cubre | ✅ | El `COUNT` recorre el agregado; el refresh lo invalida |
| Conteo `head` de badge/contador | ✅ | — | Solo se necesita el número; **corregir tenant/user** |

### 7.2 Familias que pueden conservar total exacto

- **Catálogos:** `categories`, `locations`, `taxes`, `tax_rules`, `payment_methods`, `roles`, `permissions`, `menu_items`, `document_types`, `units_of_measure` (global + tenant), `billing_plans`.
- **Backoffice de usuarios y terceros:** `users`, `third_parties` (con tenant explícito y `lower(legal_name)` indexado).
- **Documentos con numeración visible:** `accounting_entries` (libro/periodo), `invoice_resolutions`, `accounting_period_closures`.
- **Conteos `head`:** 17 sitios; mantener `COUNT` separado, sin `SELECT` de filas.

### 7.3 Familias que deben migrar a `has_next`

| Familia | Sitios | Motivo |
|---|---:|---|
| `sales` | [`web/src/services/sales.service.js:123`](../../web/src/services/sales.service.js#L123), [`mobile/src/services/sales.service.js:120`](../../mobile/src/services/sales.service.js#L120) | Rango de fechas + offset; el total cambia con cada venta |
| `cash_sessions`, `cash_movements` | 4 + 3 | Arqueo por turno; el total exacto no aporta y el offset es incorrecto |
| `inventory_batches`, `inventory_moves`, `stock_balances`, `vw_kardex` | 5 + 4 + 13 + 2 | Kardex/stock crecen; la matview se refresca |
| `purchases`, `production_orders`, `bill_of_materials` | 2 + 2 + 3 | Historial operativo; offset + count |
| `supplier_payables` | [`mobile/src/services/purchases.service.js:774`](../../mobile/src/services/purchases.service.js#L774), [`web/src/services/purchases.service.js:885`](../../web/src/services/purchases.service.js#L885) | `count` exacto **sin límite ni orden**; debe ser keyset por `(due_date, payable_id)` o `(created_at, payable_id)` |
| `cash_register_assignments` | 2 | Filtro por sede embebida; el total exacto puede no coincidir con las filas |
| `stock_alert_log`, `sale_returns`, `vw_layaway_summary` | 1 + 1 + 2 | Historial/alerta; `has_next` suficiente |
| `product_media`, `layaway_installments`, `online_order_lines`, `online_order_reservations` | 5 + 2 + 2 + 2 | Conjunto hijo acotado por padre; `LIMIT` por padre |

### 7.4 Conteos y totales exactos que hoy son incorrectos

| Sitio | Filtro actual | Problema | Corrección |
|---|---|---|---|
| [`mobile/src/services/notifications.service.js:22`](../../mobile/src/services/notifications.service.js#L22) | `is_read = false` | Cuenta notificaciones de **todos los usuarios y tenants** | Añadir `tenant_id` y `user_id` (o resolver por `auth.uid()` en Go) |
| [`web/src/services/cashAssignment.service.js:109`](../../web/src/services/cashAssignment.service.js#L109) | `tenant_id` + filtros; `count` exacto sin límite | Filtra `cash_register.location_id` embebido; el total puede incluir sedes distintas | Join/`EXISTS` explícito contra `cash_registers` con `tenant_id` |
| [`mobile/src/services/thirdParties.service.js:9`](../../mobile/src/services/thirdParties.service.js#L9) | solo `type` | No filtra tenant | `tenant_id` obligatorio |
| [`mobile/src/services/setupAssistant.service.js:43`](../../mobile/src/services/setupAssistant.service.js#L43) | tabla dinámica `?table` | No se puede verificar el filtro | Revisar antes de exponer |

### 7.5 Contrato de respuesta (sin endpoint)

El contrato de datos que el futuro repositorio Go debe poder producir:

```json
{
  "items": [],
  "next_cursor": "base64url...",
  "has_next": true,
  "total": 1234,
  "total_kind": "exact"
}
```

Reglas:

1. `next_cursor` es **opaco** para el cliente; contiene la clave de orden y un hash de los filtros.
2. `has_next` se calcula con `LIMIT n + 1` y se recorta el elemento extra; **no** con `total`.
3. `total` es opcional. Si se envía, `total_kind` declara `exact` o `estimated`; nunca presentar un estimado como exacto.
4. `total` se calcula con una consulta **separada**, sobre la tabla raíz, con el mismo `WHERE` y sin embeds.
5. En la primera página se puede calcular `total`; en las siguientes se omite salvo que el cliente lo pida explícitamente (`include_total=true`) y el costo esté acotado.
6. `items` nunca depende del tamaño de un join; si se necesitan hijos, se devuelven en una segunda consulta por lote (`WHERE parent_id = ANY($1)`) o con `json_agg` en una subconsulta.

### 7.6 Consistencia entre `total` y página

`COUNT(*)` y la página se ejecutan en momentos distintos. Con inserciones concurrentes, `total` puede ser mayor o menor que la suma de páginas. Opciones:

- **Aceptar la inconsistencia** y documentarla (lo normal en listados de negocio).
- Ejecutar ambas consultas en una transacción `REPEATABLE READ` (más costo y bloqueo).
- Cachear `total` 30–60 s y mostrar «actualizado hace…».
- Para cifras financieras, no usar el total de filas: calcular el agregado monetario en una consulta aparte y reconciliarlo.

---

## 8. Joins que multiplican filas o alteran conteos

### 8.1 Casos identificados

| Caso | Evidencia | Efecto | Recomendación |
|---|---|---|---|
| `products` embebe `product_variants` (1:N) con `count: "exact"` | [`web/src/services/products.service.js:93-103`](../../web/src/services/products.service.js#L93-L103) | El payload trae un array por producto; `count` cuenta productos si PostgREST cuenta la raíz, pero **cualquier filtro sobre variantes** o un `!inner` cambia el conjunto. El largo del array no es el total. | Contar `products` por separado; filtrar variantes con `EXISTS`; no unir para paginar |
| `sales` embebe `sale_lines` en el detalle | [`web/src/services/sales.service.js:161`](../../web/src/services/sales.service.js#L161) | 1:N: una venta con 10 líneas produce 10 filas si se usa en un listado con join plano. En el detalle no se pagina, pero el patrón se puede reutilizar mal. | Mantener el detalle como consulta puntual; para listados, no unir líneas |
| `cash_register_assignments` filtra por `cash_register.location_id` embebido | [`web/src/services/cashAssignment.service.js:109`](../../web/src/services/cashAssignment.service.js#L109) | Sin `!inner`, PostgREST aplica el filtro al recurso embebido, no a la raíz: el total incluye asignaciones de otras sedes y algunas filas llegan sin `cash_register`. Con `!inner`, el total se reduce, pero puede diferir del `count`. | Join/`EXISTS` explícito contra `cash_registers` con `tenant_id`; contar sobre la raíz |
| `supplier_payables` embebe `purchase` y `supplier` (N:1) y pide `count` exacto sin límite | [`mobile/src/services/purchases.service.js:774`](../../mobile/src/services/purchases.service.js#L774) | No multiplica, pero el `COUNT` y el payload recorren todo el conjunto; el embed añade costo por fila | Keyset; contar sin embeds |
| `stock_balances` (matview) contra `inventory_batches` | [`ADD_EXPIRATION_BATCHES_PHASE2.sql:165-176`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L165-L176) | La matview ya agregó los lotes; unirla a lotes **multiplica** por lote y duplica `on_hand` | No unir; usar la matview para saldo y `inventory_batches` para detalle FEFO, por separado |
| `vw_kardex` con `inventory_moves` | [`SpVistasFN.sql:616-641`](../../shared/supabase/migrations/SpVistasFN.sql#L616-L641) | Una fila por movimiento; si una venta genera N movimientos (lotes), contar movimientos ≠ contar ventas | Definir grano «movimiento»; para ventas, contar `sales` |
| `customer_credit_accounts` con `customer_credit_movements` | [`web/src/services/credit.service.js:104`](../../web/src/services/credit.service.js#L104) | Unir cuentas con movimientos multiplica por movimiento y distorsiona el saldo | Agregar movimientos en subconsulta o cargar por cuenta |
| `layaway_contracts` con `layaway_installments` | [`web/src/services/layaway.service.js:253`](../../web/src/services/layaway.service.js#L253) | Un contrato con N cuotas produce N filas | No unir; sumar cuotas en subconsulta o consultar aparte |
| `units_of_measure` global + tenant con `.or` | [`mobile/src/services/units.service.js:9-21`](../../mobile/src/services/units.service.js#L9-L21) | No es un join, pero el `OR` puede duplicar si un `code` existe global y por tenant y la UI no distingue; el `count` incluye ambos | Clave de negocio `(tenant_id, code)` o marcar `is_global`; no unir |

### 8.2 Regla de conteo

> **Contar siempre sobre la tabla raíz del listado, con el `WHERE` del listado y sin joins ni embeds.** Si el listado necesita un filtro sobre una tabla relacionada, usar `EXISTS`/`IN` (semijoin) o un `JOIN` con `DISTINCT` sobre la PK, y validar que el `COUNT(DISTINCT pk)` coincida con el número de filas de la página.

Para PostgREST, el `count` exacto con embeds **no es confiable** sin conocer la versión y el plan que genera; en Go se controla explícitamente. Esta es una razón adicional para no replicar el cliente actual.

### 8.3 `SELECT *` y columnas

Varias consultas usan `select('*')` (por ejemplo [`web/src/services/accounting.service.js:767`](../../web/src/services/accounting.service.js#L767) y [`web/src/services/inventory.service.js:133`](../../web/src/services/inventory.service.js#L133)). En el repositorio Go se deben listar columnas: reduce I/O, permite índices de cobertura y evita arrastrar `jsonb`/PII a la página.

---

## 9. Índices propuestos

> **No se crean índices en esta tarea.** El DDL es una propuesta para revisión y medición. Los nombres son locales a este documento; el baseline puede renombrarlos. Ejecutar en una base desechable con datos sintéticos y comparar `EXPLAIN (ANALYZE, BUFFERS)` antes de producción. En producción, `CREATE INDEX CONCURRENTLY`.

### 9.1 Principios de diseño

1. **`tenant_id` primero** en toda tabla multi-tenant, salvo catálogo global.
2. **Igualdad antes que rango:** `(tenant_id, status, sold_at DESC, sale_id DESC)` sirve para `tenant = ? AND status = ? AND sold_at < ?`; `(tenant_id, sold_at, status)` no sirve igual.
3. **La columna de orden y el desempate van al final**, en la misma dirección que el `ORDER BY`.
4. **Incluir el `ORDER BY` completo** para evitar `Sort`/`Incremental Sort`. Un índice `(tenant_id, sold_at DESC)` no ordena por `sale_id`; el keyset con `(sold_at, sale_id)` necesita el tercer campo.
5. **Índices parciales** para subconjuntos calientes: no leídas, activas, abiertas, con vencimiento, no nulas.
6. **No indexar `ILIKE '%…%'`** con B-tree; requiere trigramas o cambio a prefijo (§9.5).
7. **Cuidado con la escritura:** cada índice extra encarece ventas, movimientos y refresh de la matview. Priorizar los de §9.2 y medir.
8. **Índices de cobertura (`INCLUDE`)** solo si la página selecciona pocas columnas y el `EXPLAIN` muestra `Heap Fetches` altos; no convertir cada índice en una copia de la tabla.
9. **Índices sobre expresiones** deben coincidir exactamente con la expresión de la consulta (`lower(name)`, `COLLATE "C"`).
10. **La matview `stock_balances`** ya tiene `UNIQUE (tenant_id, location_id, variant_id)` ([`ADD_EXPIRATION_BATCHES_PHASE2.sql:178-180`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L178-L180)), necesario para `REFRESH ... CONCURRENTLY`; los índices de paginación se crean después del primer refresh.

### 9.2 Índices concretos por entidad

| # | Tabla / vista | Índice propuesto | Sirve a | Notas |
|---:|---|---|---|---|
| 1 | `sales` | `(tenant_id, sold_at DESC, sale_id DESC)` | listado por fecha, keyset | Amplía `ix_sales_tenant_date` (sin `sale_id`); retirar el anterior si se confirma redundante |
| 2 | `sales` | `(tenant_id, status, sold_at DESC, sale_id DESC)` | filtro por estado + fecha | Parcial `WHERE status <> 'VOIDED'` si el negocio no muestra anuladas |
| 3 | `third_parties` | `(tenant_id, lower(legal_name), third_party_id)` | catálogo/keyset | La consulta debe ordenar por `lower(legal_name)`; el índice actual no tiene `id`. Cambia el orden case-sensitive actual: decidir con producto |
| 4 | `third_parties` | `(tenant_id, document_number)` | búsqueda exacta | Ya existe `idx_third_parties_tenant_document` ([`ADD_THIRD_PARTIES.sql:62`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L62)) |
| 5 | `cash_movements` | `(tenant_id, cash_session_id, created_at DESC, cash_movement_id DESC)` | arqueo por sesión | No hay evidencia estática de índice en esta tabla: **a verificar** |
| 6 | `cash_movements` | `(tenant_id, created_at DESC, cash_movement_id DESC)` | reporte por rango | Filtro opcional por `type` |
| 7 | `cash_sessions` | `(tenant_id, opened_at DESC, cash_session_id DESC)` | historial de turnos | — |
| 8 | `cash_sessions` | `(tenant_id, status, opened_at DESC, cash_session_id DESC)` | turnos abiertos/cerrados | Índice parcial `WHERE status = 'OPEN'` para el turno abierto |
| 9 | `cash_registers` | `(tenant_id, lower(name), cash_register_id)` | catálogo | — |
| 10 | `cash_register_assignments` | `(tenant_id, assigned_at DESC, assignment_id DESC)` | listado de asignaciones | Filtro por `user_id`/`is_active` |
| 11 | `inventory_batches` | `(tenant_id, location_id, expiration_date, batch_id)` | FEFO/vencimientos | Parcial `WHERE is_active AND expiration_date IS NOT NULL` |
| 12 | `inventory_batches` | `(tenant_id, variant_id, expiration_date, batch_id)` | lotes por variante | — |
| 13 | `inventory_moves` | `(tenant_id, created_at DESC, inventory_move_id DESC)` | kardex global | El índice existente empieza por `variant_id`, no sirve para el listado por tenant |
| 14 | `inventory_moves` | `(tenant_id, location_id, created_at DESC, inventory_move_id DESC)` | kardex por sede | — |
| 15 | `stock_balances` | `(tenant_id, updated_at DESC, location_id DESC, variant_id DESC)` | listado de stock | Matview; recrear tras refresh; el orden triple es el desempate único |
| 16 | `stock_balances` | `(tenant_id, location_id, updated_at DESC, variant_id DESC)` | stock por sede | — |
| 17 | `products` | `(tenant_id, lower(name), product_id)`; para búsqueda por prefijo, añadir `(tenant_id, lower(name) text_pattern_ops, product_id)` | catálogo y autocompletar | Si se ordena por `name` sin `lower`, crear `(tenant_id, name, product_id)` |
| 18 | `product_variants` | `(tenant_id, sku, variant_id)` | búsqueda/orden por SKU | `sku` no es único global; el desempate es `variant_id` |
| 19 | `product_variants` | `(tenant_id, product_id, variant_name, variant_id)` | variantes por producto | — |
| 20 | `product_media` | `(tenant_id, product_id, is_cover DESC, sort_order, media_id)` | galería | — |
| 21 | `locations` | `(tenant_id, lower(name), location_id)` | catálogo | — |
| 22 | `categories` | `(tenant_id, lower(name), category_id)` | catálogo | — |
| 23 | `roles` | `(tenant_id, lower(name), role_id)` | catálogo | — |
| 24 | `taxes` | `(tenant_id, lower(name), tax_id)` | catálogo | — |
| 25 | `tax_rules` | `(tenant_id, scope, priority DESC, tax_rule_id)` | reglas | — |
| 26 | `units_of_measure` | `(tenant_id, is_system DESC, lower(name), unit_id)` | catálogo por tenant | Añadir parcial global `(is_system DESC, lower(name), unit_id) WHERE tenant_id IS NULL` |
| 27 | `payment_methods` | `(tenant_id, sort_order, lower(name), payment_method_id)` | catálogo | — |
| 28 | `users` | `(tenant_id, created_at DESC, user_id DESC)` | usuarios | — |
| 29 | `accounting_entries` | `(tenant_id, entry_date DESC, created_at DESC, entry_id DESC)` | libro diario | Ya existe `(tenant_id, status, entry_date DESC)` ([`ADD_ACCOUNTING_CO_MODULE.sql:102-103`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L102-L103)) |
| 30 | `accounting_event_queue` | `(tenant_id, status, created_at, event_id)` | cola contable | Parcial `WHERE status IN ('PENDING','FAILED')` |
| 31 | `supplier_payables` | `(tenant_id, status, due_date, payable_id)` | CxP | Ya existe `(tenant_id, created_at DESC)` ([`ADD_SUPPLIER_PAYABLES_CORE.sql:34`](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L34)) |
| 32 | `layaway_contracts` | `(tenant_id, status, due_date, layaway_id)` | separados por vencer | El índice existente ordena por `created_at`, no `due_date` ([`PlanSepare.sql:166`](../../shared/supabase/migrations/PlanSepare.sql#L166)) |
| 33 | `notifications` | `(tenant_id, user_id, created_at DESC, notification_id DESC)` | centro de notificaciones | Ya existe `(tenant_id, user_id, created_at DESC)` ([`ADD_IN_APP_NOTIFICATION_CENTER.sql:144-145`](../../mobile/migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql#L144-L145)) |
| 34 | `notifications` | `(tenant_id, user_id, is_read, created_at DESC, notification_id DESC)` | no leídas | Parcial `WHERE is_read = false` |
| 35 | `purchases` | `(tenant_id, created_at DESC, purchase_id DESC)` | historial de compras | — |
| 36 | `production_orders` | `(tenant_id, created_at DESC, production_order_id DESC)` | órdenes | Parcial por `status` |
| 37 | `bill_of_materials` | `(tenant_id, created_at DESC, bom_id DESC)` | BOM | — |
| 38 | `pricing_rules` | `(tenant_id, priority DESC, created_at DESC, pricing_rule_id DESC)` | reglas de precio | — |
| 39 | `customer_credit_accounts` | `(tenant_id, current_balance DESC, credit_account_id DESC)` | cartera | — |
| 40 | `customer_credit_movements` | `(tenant_id, credit_account_id, created_at DESC, movement_id DESC)` | movimientos de cartera | — |
| 41 | `sale_returns` | `(tenant_id, created_at DESC, return_id DESC)` | devoluciones | PK es `return_id`, no `sale_return_id` |
| 42 | `stock_alert_log` | `(tenant_id, created_at DESC, alert_id DESC)` | historial de alertas | — |
| 43 | `online_orders` | `(tenant_id, created_at DESC, online_order_id DESC)` | pedidos online | — |
| 44 | `bulk_imports` | `(tenant_id, created_at DESC, import_id DESC)` | historial de importaciones | — |
| 45 | `bulk_import_errors` | `(import_id, row_number)` | errores de importación | Ya propuesto en [`_data/listings-and-rpcs.md` §A.5](_data/listings-and-rpcs.md#a5-índices-candidatos-a-validar-con-explain) |

### 9.3 Índices existentes que no bastan

| Índice existente | Definición | Brecha |
|---|---|---|
| `ix_sales_tenant_date` | `(tenant_id, sold_at DESC)` ([`InitDB.sql:388`](../../shared/supabase/migrations/InitDB.sql#L388)) | Sin `sale_id`: el keyset `(sold_at, sale_id)` requiere `Incremental Sort` o no usa el índice para el desempate |
| `idx_third_parties_tenant_name` | `(tenant_id, lower(legal_name))` ([`ADD_THIRD_PARTIES.sql:61`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L61)) | Sin `third_party_id`; la consulta ordena `legal_name` sin `lower()`, así que el índice no cubre el `ORDER BY` |
| `ix_layaway_contracts_status` | `(tenant_id, status, created_at DESC)` ([`PlanSepare.sql:166`](../../shared/supabase/migrations/PlanSepare.sql#L166)) | El listado ordena por `due_date`, no `created_at` |
| `idx_supplier_payables_tenant` | `(tenant_id, created_at DESC)` ([`ADD_SUPPLIER_PAYABLES_CORE.sql:34`](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L34)) | El listado filtra por `status` y ordena/pagina por vencimiento o creación; falta compuesto |
| `ix_notifications_tenant_user_created` | `(tenant_id, user_id, created_at DESC)` ([`ADD_IN_APP_NOTIFICATION_CENTER.sql:144-145`](../../mobile/migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql#L144-L145)) | Sin `notification_id`; el conteo no leído no filtra `user_id` en el cliente |
| `ix_inventory_moves_variant_loc_date` | `(tenant_id, variant_id, location_id, created_at DESC)` ([`InitDB.sql:391`](../../shared/supabase/migrations/InitDB.sql#L391)) | No sirve para kardex por tenant/sede sin variante; el orden empieza por `variant_id` |
| `idx_accounting_entries_tenant_status_date` | `(tenant_id, status, entry_date DESC)` ([`ADD_ACCOUNTING_CO_MODULE.sql:102-103`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L102-L103)) | El listado ordena por `entry_date DESC, created_at DESC`; falta `created_at` y `entry_id` |

No se encontró evidencia estática de índice de paginación para `cash_movements`, `cash_sessions` (salvo los únicos de caja abierta, [`AsignacionCajerosCaja.sql:43-48`](../../shared/supabase/migrations/AsignacionCajerosCaja.sql#L43-L48)), `inventory_batches`, `cash_registers`, `categories`, `locations`, `taxes`, `roles`, `users`, `products`, `product_variants` (salvo los de unidad/producción) ni `stock_balances` por `updated_at`. **A verificar en el esquema desplegado**: pueden existir en migraciones no detectadas o creadas manualmente.

### 9.4 Costos y mantenimiento

- **Escritura:** cada índice añade trabajo a `sp_create_sale`, `fn_apply_stock_delta`, compras y refresh de `stock_balances`. Los índices 1, 5, 11, 13, 15 y 33 son los de mayor impacto; medir el costo de inserción antes de añadir los 45.
- **Espacio:** un índice compuesto con UUID al final puede ser grande; usar `fillfactor` solo si hay actualizaciones frecuentes.
- **`CONCURRENTLY`:** obligatorio en producción; no dentro de una transacción. Validar `pg_index.indisvalid` después.
- **Duplicados:** antes de crear, buscar prefijos ya cubiertos (`pg_indexes`, `pg_stats`); el baseline no debe acumular índices de parches históricos.
- **Estadísticas:** ejecutar `ANALYZE` tras la carga sintética; sin estadísticas, el planner puede elegir `Seq Scan` aunque el índice exista.
- **Matview:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` requiere el `UNIQUE` existente; los índices de paginación se reconstruyen con el refresh (la matview conserva índices, pero el refresh los actualiza). Medir el costo.

### 9.5 Búsqueda `ILIKE '%texto%'`

| Opción | Portable | Costo | Decisión |
|---|---|---|---|
| `Seq Scan` + filtro | Sí | O(n) por página; no escala | Solo catálogos pequeños |
| Prefijo `name ILIKE 'texto%'` + `(tenant_id, lower(name) text_pattern_ops)` | Sí (B-tree, `text_pattern_ops`) | Rango indexado | **Recomendada** para autocompletar y catálogos; cambia la UX de «contiene» a «empieza por» |
| `pg_trgm` + GIN `gin_trgm_ops` | Extensión de `contrib`; requiere `CREATE EXTENSION` | Índice GIN, escritura más cara | **Decisión pendiente**; no asumirla en el baseline |
| `to_tsvector` + GIN | Sí, pero diccionario/idioma | Configuración y tamaño | Solo si se necesita búsqueda lingüística |
| `unaccent` + trigramas | Extensión | Dependencia adicional | No asumir |

Mientras no se decida, el repositorio Go debe: (a) aceptar búsqueda por prefijo como camino rápido, (b) limitar el término y el `LIMIT`, y (c) no prometer total exacto con `%…%` sin índice.

### 9.6 Orden de creación sugerido

1. **P0 (cursores de negocio):** `sales`, `cash_movements`, `cash_sessions`, `inventory_batches`, `inventory_moves`, `stock_balances`, `notifications`.
2. **P1 (catálogos y backoffice):** `third_parties`, `products`, `product_variants`, `locations`, `categories`, `roles`, `taxes`, `users`, `payment_methods`, `units_of_measure`.
3. **P2 (operación):** `purchases`, `production_orders`, `bill_of_materials`, `pricing_rules`, `supplier_payables`, `layaway_contracts`, `customer_credit_*`.
4. **P3 (históricos):** `sale_returns`, `stock_alert_log`, `online_orders`, `bulk_imports`, `bulk_import_errors`.

Validar cada fase con datos sintéticos y `EXPLAIN (ANALYZE, BUFFERS)`; no crear los 45 índices de una vez.

---

## 10. Patrón keyset portable

### 10.1 Contrato de cursor

```
cursor = base64url(JSON)
{
  "v": 1,
  "k": ["2026-11-09T15:04:05.123Z", "550e8400-e29b-41d4-a716-446655440000"],
  "d": "desc",
  "f": "sha256:filtros..."   // hash de tenant + filtros + orden
}
```

- `k` contiene los valores de la clave de orden en orden, incluido el desempate.
- `d` es la dirección (`asc`/`desc`) para detectar cursores incompatibles.
- `f` impide reutilizar un cursor con otro filtro/tenant; si no coincide, `400` (no se implementa aquí).
- El cliente **no** interpreta `k`; el servidor valida tipos y longitud.
- No incluir PII ni secretos en el cursor; es opaco, no cifrado. Si se necesita confidencialidad, firmar/HMAC o cifrar.

### 10.2 SQL canónico (descendente)

```sql
-- Página siguiente: cursor = (sold_at, sale_id) de la última fila vista
SELECT s.sale_id, s.sale_number, s.sold_at, s.status, s.total
FROM sales AS s
WHERE s.tenant_id = $1
  AND (s.sold_at, s.sale_id) < ($2::timestamptz, $3::uuid)
ORDER BY s.sold_at DESC, s.sale_id DESC
LIMIT $4 + 1;  -- +1 para has_next
```

Primera página (sin cursor):

```sql
SELECT s.sale_id, s.sale_number, s.sold_at, s.status, s.total
FROM sales AS s
WHERE s.tenant_id = $1
ORDER BY s.sold_at DESC, s.sale_id DESC
LIMIT $2 + 1;
```

Ascendente:

```sql
WHERE s.tenant_id = $1
  AND (s.created_at, s.purchase_id) > ($2::timestamptz, $3::uuid)
ORDER BY s.created_at ASC, s.purchase_id ASC
LIMIT $4 + 1;
```

> **No usar `($2 IS NULL OR ...)`** para unificar primera página y siguientes: impide que el planner use el índice en el caso común. Construir dos formas de SQL o usar `EXPLAIN` para confirmar que el plan genérico no se degrada.

### 10.3 Variantes

**Filtro opcional (sede, estado):** añadir la igualdad antes del rango; el índice debe incluirla:

```sql
WHERE tenant_id = $1
  AND ($2::uuid IS NULL OR location_id = $2)  -- evitar: plan genérico
```

Mejor: dos consultas o `location_id = COALESCE($2, location_id)` (puede impedir el índice). La opción portable y rápida es **construir el `WHERE` dinámicamente** en el repositorio, con un conjunto acotado de filtros permitidos.

**Direcciones mixtas** (`scope ASC, priority DESC`): la comparación de filas no aplica directamente. Expandir:

```sql
WHERE tenant_id = $1
  AND (
    scope > $2
    OR (scope = $2 AND priority < $3)
    OR (scope = $2 AND priority = $3 AND tax_rule_id < $4)
  )
ORDER BY scope ASC, priority DESC, tax_rule_id DESC
LIMIT $5 + 1;
```

El índice `(tenant_id, scope, priority DESC, tax_rule_id DESC)` puede usarlo, pero el `OR` es menos eficiente que la comparación de filas. Medir.

**Múltiples columnas de orden** (`entry_date DESC, created_at DESC, entry_id DESC`): comparación de filas de tres valores, todas en la misma dirección:

```sql
WHERE tenant_id = $1
  AND (entry_date, created_at, entry_id) < ($2::date, $3::timestamptz, $4::uuid)
ORDER BY entry_date DESC, created_at DESC, entry_id DESC
LIMIT $5 + 1;
```

**Nulos:** evitar el keyset sobre columnas nullables. Si no se puede, usar un índice parcial y dos bloques (no nulos primero, luego nulos) o una columna generada normalizada (`COALESCE(due_date, 'infinity')`) que sea inmutable y indexable. `COALESCE` en el `WHERE` sin columna generada **no** usa el índice.

### 10.4 `has_next` con `LIMIT n + 1`

```text
rows = query(limit = n + 1)
has_next = len(rows) > n
items = rows[:n]
next_cursor = items[-1].key if has_next else null
```

No usar `total > page * size` para `has_next`: el total puede ser viejo y el offset puede haber cambiado. El `+1` es la única señal consistente con la página.

### 10.5 Conteo separado

```sql
-- Solo si se necesita total exacto
SELECT count(*)
FROM sales
WHERE tenant_id = $1
  AND status = $2
  AND sold_at >= $3
  AND sold_at < $4;
```

- Sin `SELECT` de columnas, sin embeds, sin `ORDER BY`.
- Mismo `WHERE` que la página (incluido el rango, no el cursor).
- Si el `COUNT` es caro, cachear por `(tenant, filtros)` 30–60 s y etiquetar `total_kind: "cached"`.
- Para reportes, calcular sumas (`SUM(total)`, `SUM(amount)`) en la misma consulta agregada; no derivar montos del conteo de filas.

### 10.6 Trampas

| Trampa | Efecto | Mitigación |
|---|---|---|
| Actualización de la columna de orden | La fila se mueve entre páginas: duplicada u omitida | Usar clave inmutable (`created_at`, `sold_at` si no se edita) o aceptar y documentar |
| Inserción retroactiva (`sold_at` pasado) | Se inserta «antes» del cursor y no se ve | Ordenar por `created_at` si el requisito es «lo ingresado»; o aceptar para historial de ventas |
| Cambio de colación/ICU | Cursores guardados dejan de ser válidos | `COLLATE "C"` o versión fija; invalidar cursores al desplegar |
| Zona horaria | `timestamptz` se compara como instante; el cursor debe incluir offset | Serializar en UTC; mostrar en zona del tenant |
| UUID vs bigint | Mezcla de tipos en cursor | Un tipo por entidad; el cursor valida |
| `LIMIT` sin máximo | Cliente pide 1M | Cap en repositorio (100–200; 500 en catálogos) |
| Cursor reutilizado con otro filtro | Resultados incoherentes | Hash de filtros en `f`; rechazar |
| Conteo con RLS | En Supabase el `COUNT` ve lo permitido; en Go no hay RLS | `tenant_id` explícito y pruebas de aislamiento |
| `ORDER BY` con expresión no indexada | `Sort` en cada página | Índice de expresión idéntico |

### 10.7 Prueba de no duplicar/omitir

Para cada listado migrado, una prueba de propiedad con datos sintéticos:

1. Insertar N filas con empates deliberados en la columna de orden (mismo `sold_at`, mismo `name`).
2. Recorrer todas las páginas con el cursor y recolectar IDs.
3. Verificar: `count == N`, `count(distinct id) == N`, `set == conjunto completo`.
4. Insertar una fila entre la página 1 y 2; verificar que las filas no vistas siguen apareciendo (puede aparecer la nueva, pero no debe duplicar una ya vista).
5. Repetir con filtros opcionales y con `NULL` en la columna de orden.
6. Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` y comparar con el outline de §11.

---

## 11. Queries de referencia y `EXPLAIN` esperado (sin ejecutar)

> Los planes son **hipótesis** basadas en los índices propuestos y en PostgreSQL 15+. No se ejecutaron. La validación requiere datos y estadísticas; DEV está vacía y PROD bloqueado.

### 11.1 Ventas por fecha (keyset)

```sql
SELECT s.sale_id, s.sale_number, s.sold_at, s.status, s.total
FROM sales AS s
WHERE s.tenant_id = $1
  AND (s.sold_at, s.sale_id) < ($2::timestamptz, $3::uuid)
ORDER BY s.sold_at DESC, s.sale_id DESC
LIMIT $4 + 1;
```

**Outline esperado** (índice #1):

```text
Limit
  -> Index Scan using el índice #1 on sales s
       Index Cond: (tenant_id = $1)
       Index Cond: (ROW(sold_at, sale_id) < ROW($2, $3))
       -- no Sort
       -- Buffers: pocas páginas; rows ~ limit + 1
```

Con el índice actual `(tenant_id, sold_at DESC)`, el plan esperado sería `Limit -> Incremental Sort -> Index Scan` (o `Sort`), porque el índice no ordena por `sale_id`. Esa es la razón del índice #1.

### 11.2 Terceros por nombre (keyset con expresión)

```sql
SELECT t.third_party_id, t.legal_name, t.document_number
FROM third_parties AS t
WHERE t.tenant_id = $1
  AND (lower(t.legal_name), t.third_party_id) > (lower($2), $3::uuid)
ORDER BY lower(t.legal_name) ASC, t.third_party_id ASC
LIMIT $4 + 1;
```

**Outline esperado** (índice #3):

```text
Limit
  -> Index Scan using el índice #3 on third_parties t
       Index Cond: (tenant_id = $1)
       Index Cond: (ROW(lower(legal_name), third_party_id) > ROW(lower($2), $3))
       -- no Sort
```

Si la consulta ordena por `legal_name` (sin `lower`), el planner no puede usar el índice de expresión para el orden y aparece `Sort`. Si se usa `COLLATE "C"`, debe estar en índice y consulta.

### 11.3 Movimientos de caja por sesión (keyset)

```sql
SELECT m.cash_movement_id, m.type, m.amount, m.created_at
FROM cash_movements AS m
WHERE m.tenant_id = $1
  AND m.cash_session_id = $2
  AND (m.created_at, m.cash_movement_id) < ($3::timestamptz, $4::uuid)
ORDER BY m.created_at DESC, m.cash_movement_id DESC
LIMIT $5 + 1;
```

**Outline esperado** (índice #5):

```text
Limit
  -> Index Scan using el índice #5 on cash_movements m
       Index Cond: (tenant_id = $1 AND cash_session_id = $2)
       Index Cond: (ROW(created_at, cash_movement_id) < ROW($3, $4))
       -- no Sort
```

Sin índice, el plan esperado es `Seq Scan` + `Sort` + `Limit`; con muchas sesiones, `Bitmap Heap Scan`.

### 11.4 Stock por actualización (matview)

```sql
SELECT s.location_id, s.variant_id, s.on_hand, s.reserved, s.updated_at
FROM stock_balances AS s
WHERE s.tenant_id = $1
  AND (s.updated_at, s.location_id, s.variant_id) < ($2::timestamptz, $3::uuid, $4::uuid)
ORDER BY s.updated_at DESC, s.location_id DESC, s.variant_id DESC
LIMIT $5 + 1;
```

**Outline esperado** (índice #15):

```text
Limit
  -> Index Scan using el índice #15 on stock_balances s
       Index Cond: (tenant_id = $1)
       Index Cond: (ROW(updated_at, location_id, variant_id) < ROW($2, $3, $4))
       -- no Sort
```

`stock_balances` es matview: el plan puede ser `Index Scan` o `Bitmap Heap Scan` según la selectividad; el costo de `REFRESH` no aparece en este plan. Si se filtra por `location_id`, usar #16.

### 11.5 Conteo exacto (sin joins)

```sql
SELECT count(*)
FROM sales AS s
WHERE s.tenant_id = $1
  AND s.status = $2
  AND s.sold_at >= $3
  AND s.sold_at < $4;
```

**Outline esperado:**

```text
Aggregate
  -> Index Only Scan using el índice #2 on sales s
       Index Cond: (tenant_id = $1 AND status = $2 AND sold_at >= $3 AND sold_at < $4)
       Heap Fetches: 0   -- solo tras VACUUM/visibilidad
```

Si el índice no cubre todas las columnas necesarias, `Bitmap Heap Scan` + `Aggregate`; si la selectividad es baja, `Seq Scan`. El `COUNT` no debe incluir embeds ni `ORDER BY`.

### 11.6 Búsqueda por texto

```sql
-- Prefijo (recomendado para índices B-tree)
SELECT p.product_id, p.name
FROM products AS p
WHERE p.tenant_id = $1
  AND lower(p.name) LIKE lower($2) || '%'
ORDER BY lower(p.name) ASC, p.product_id ASC
LIMIT $3 + 1;
```

**Outline esperado** (índice `(tenant_id, lower(name) text_pattern_ops, product_id)`):

```text
Limit
  -> Index Scan using el índice #17 (con text_pattern_ops) on products p
       Index Cond: (tenant_id = $1 AND lower(name) ~>=~ lower($2) AND lower(name) ~<~ ...)
       Filter: (lower(name) LIKE lower($2) || '%')
       -- no Sort
```

Infijo (`LIKE '%texto%'`) sin trigramas:

```text
Limit
  -> Seq Scan on products p
       Filter: (tenant_id = $1 AND lower(name) LIKE '%texto%')
       Rows Removed by Filter: ...
```

Ese plan no mejora con la página: cada página recorre la tabla. Si se aprueba `pg_trgm`, el plan esperado es `Bitmap Index Scan on gin_trgm_ops` + `Bitmap Heap Scan`; sigue habiendo recheck.

### 11.7 Antipatrón: offset profundo

```sql
SELECT s.sale_id, s.sold_at, s.total
FROM sales AS s
WHERE s.tenant_id = $1
ORDER BY s.sold_at DESC
OFFSET $2
LIMIT $3;
```

**Outline esperado:**

```text
Limit
  -> Index Scan using ix_sales_tenant_date on sales s
       Index Cond: (tenant_id = $1)
       -- lee y descarta $2 filas; buffers crecen con $2
```

Si no hay índice que cubra el orden, aparece `Sort` sobre todo el conjunto. El costo es lineal con `OFFSET`; a diferencia del keyset, no se detiene en el cursor.

### 11.8 Resumen de planes esperados

| Consulta | Índice | Nodo esperado | ¿Sort? | Riesgo si falta el índice |
|---|---|---|---|---|
| Ventas keyset | #1 | `Index Scan` | No | `Incremental Sort`/`Sort` |
| Terceros keyset | #3 | `Index Scan` | No | `Sort` |
| Caja por sesión | #5 | `Index Scan` | No | `Seq Scan` + `Sort` |
| Stock keyset | #15 | `Index Scan` | No | `Seq Scan`/`Sort` |
| Conteo exacto | #2 | `Aggregate -> Index Only Scan` | No | `Seq Scan` |
| Prefijo | #17/text_pattern_ops | `Index Scan` | No | `Seq Scan` |
| Infijo | — | `Seq Scan` | No | O(n) por página |
| Offset | existente | `Index Scan` + descarte | No | `Sort` + descarte |

---

## 12. Plan de adopción y compatibilidad

### 12.1 Fases

| Fase | Entregable | Criterio de salida |
|---|---|---|
| **0. Contrato** | Este documento + decisión de cursor/`has_next` | Revisión del agente principal; ADR de paginación si se requiere |
| **1. Índices** | DDL de §9 en base desechable con datos sintéticos | `EXPLAIN` cumple §11; sin `Sort` en keyset; costo de escritura medido |
| **2. Repositorios Go** | Keyset por familia, límite máximo, cursor opaco, `has_next` | Pruebas de propiedad §10.7; aislamiento por tenant |
| **3. Compatibilidad** | Adaptador `page/pageSize` → offset con orden total y tope | Web/mobile siguen funcionando sin cambios |
| **4. Migración UI** | Web/mobile consumen cursor; retiran offset | Sin regresiones; total solo donde se decidió |
| **5. Limpieza** | Índices redundantes, consultas sin límite, conteos mal filtrados | Monitoreo de planes y latencia |

### 12.2 Matriz de decisión por listado

| Listado | Límite | Cursor | Total | Prioridad |
|---|---|---|---|---|
| `sales` (web/mobile) | 50–100 | `(sold_at DESC, sale_id DESC)` | `has_next`; exacto opcional en primera página | P0 |
| `cash_movements` | 100 | `(created_at DESC, cash_movement_id DESC)` | `has_next` | P0 |
| `cash_sessions` | 50 | `(opened_at DESC, cash_session_id DESC)` | `has_next` | P0 |
| `inventory_batches` | 100 | `(expiration_date, batch_id)` | `has_next` | P0 |
| `inventory_moves` / `vw_kardex` | 100–200 | `(created_at DESC, id DESC)` | `has_next` | P0 |
| `stock_balances` | 200 | `(updated_at DESC, location_id, variant_id)` | `has_next` | P0 |
| `notifications` | 50 | `(created_at DESC, notification_id DESC)` | `has_next` + badge exacto corregido | P0 |
| `third_parties` | 100 | `(lower(legal_name), third_party_id)` | exacto en catálogo; `has_next` en búsqueda | P1 |
| `products` / `product_variants` | 100–200 | `(lower(name), product_id)` / `(sku, variant_id)` | exacto en catálogo; `has_next` en POS | P1 |
| Catálogos (`categories`, `locations`, `roles`, `taxes`, `payment_methods`) | 200–500 | `(lower(name), id)` | exacto cacheado | P1 |
| `purchases`, `production_orders`, `bill_of_materials` | 100 | `(created_at DESC, id DESC)` | `has_next` | P2 |
| `supplier_payables` | 100 | `(due_date, payable_id)` o `(created_at DESC, payable_id)` | `has_next` | P2 |
| `customer_credit_accounts` / `movements` | 100 | `(current_balance DESC, id DESC)` / `(created_at DESC, id DESC)` | `has_next` | P2 |
| `sale_returns`, `stock_alert_log`, `online_orders` | 100 | `(created_at DESC, id DESC)` | `has_next` | P3 |
| Vistas de reporte | — | No paginar; agregado/exportación | — | P3 |

### 12.3 Compatibilidad con el cliente actual

- El cliente web usa `page`/`pageSize` y `from/to`; mobile usa `offset`/`limit`. El backend puede aceptar ambos y traducir, pero **no** debe exponer `offset` en el contrato nuevo.
- Los 53 listados con `count: "exact"` deben seguir mostrando un total mientras la UI no migre; el backend puede calcularlo solo en la primera página y cachearlo.
- `stock_balances` y las vistas deben mantener el mismo grano que la UI espera; cambiar el grano es un cambio de contrato, no de paginación.
- La búsqueda `%texto%` debe mantener el comportamiento actual hasta que se decida el índice/UX; no cambiar a prefijo silenciosamente.

### 12.4 Validación pendiente (no ejecutada)

- [ ] Crear datos sintéticos con dos tenants y empates deliberados.
- [ ] Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` de §11 y comparar.
- [ ] Medir costo de escritura de los índices P0 en `sp_create_sale` y `fn_apply_stock_delta`.
- [ ] Verificar que `REFRESH MATERIALIZED VIEW CONCURRENTLY` sigue funcionando con los índices nuevos.
- [ ] Probar cursores con `NULL`, colación y cambio de zona horaria.
- [ ] Validar que `COUNT` y página usan el mismo `WHERE` y el mismo tenant.
- [ ] Revisar el esquema desplegado (cuando exista un entorno con datos) para índices no detectados.

---

## 13. Riesgos y pendientes

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Análisis estático sin `EXPLAIN` real | Planes propuestos pueden no cumplirse | Fase 1 con datos sintéticos; ajustar índices |
| PROD bloqueado y DEV vacía | No se conoce el esquema desplegado ni la distribución | Inventario estático + validación futura; no asumir índices |
| Consultas sin tenant (`third_parties` mobile, notificaciones) | Fuga entre tenants y totales incorrectos | Corregir antes de paginar; pruebas de aislamiento |
| `count: "exact"` con joins/embeds | Total distinto de las filas; costo alto | Contar sobre la raíz, sin joins; `has_next` |
| Offset en 48 listados | Duplicados/omisiones y costo creciente | Keyset; compatibilidad temporal con tope |
| Colación/ICU | Cursores inestables entre versiones | `COLLATE "C"` o versión fija; invalidar cursores |
| `updated_at` en `stock_balances` | Filas que se mueven entre páginas | Aceptar para tablero; usar clave estable para arqueo |
| Búsqueda `%…%` | `Seq Scan` por página | Prefijo o decisión sobre `pg_trgm` |
| Índices en exceso | Escritura más lenta en ventas/stock | Priorizar P0/P1; medir y eliminar redundantes |
| Matview y refresh | Bloqueo o resultados obsoletos | `CONCURRENTLY`; ventana; monitoreo |
| Duplicación web/mobile | Dos contratos de página | Límite máximo y cursor único en Go |
| Migraciones históricas divergentes | Índices propuestos pueden duplicar existentes | Revisar `pg_indexes` antes de crear |

**Pendientes concretos**

1. Decidir si se autoriza `pg_trgm` (y `unaccent`) o si la búsqueda se limita a prefijo (§9.5).
2. Decidir la política de total: solo primera página, cacheado, o siempre `has_next` (§7).
3. Definir el contrato de cursor (JSON/base64, hash de filtros, expiración) y si se firma.
4. Corregir los conteos sin tenant/user antes de cualquier migración de UI.
5. Validar el grano de `stock_balances`, `vw_kardex` y `vw_layaway_summary` con el equipo de negocio.
6. Ejecutar la fase de índices en una base desechable; este documento no crea ninguno.

---

## Anexo A — Catálogo de los 200 listados

Cada fila corresponde a un sitio de la Tabla A.3 de [`_data/listings-and-rpcs.md`](_data/listings-and-rpcs.md#a3-consultas-de-tabla). El número `#` es el índice de esa tabla; para localizar el mismo sitio en [`_data/query-sites.json`](_data/query-sites.json) se usa `archivo:línea`, no el índice del array. Se agrupa por entidad y, dentro de ella, por riesgo (`O` > `L` > `D` > `N`). La columna «Paginación» usa los códigos de §2.3.

### `third_parties` (6 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 404 | [thirdParties.service.js:9](../../mobile/src/services/thirdParties.service.js#L9) | ND | OFF/T | T | N | O,D,N |
| 405 | [thirdParties.service.js:19](../../mobile/src/services/thirdParties.service.js#L19) | ND | OFF/T | T | N | O,D,N |
| 412 | [thirdParties.service.js:9](../../web/src/services/thirdParties.service.js#L9) | ND | OFF | H | N | O,D,N |
| 413 | [thirdParties.service.js:17](../../web/src/services/thirdParties.service.js#L17) | ND | OFF | H | N | O,D,N |
| 407 | [customers.service.js:54](../../web/src/services/customers.service.js#L54) | ND | OFF/T | T | S | O,D |
| 408 | [customers.service.js:63](../../web/src/services/customers.service.js#L63) | ND | OFF/T | T | S | O,D |

### `units_of_measure` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 418 | [units.service.js:9](../../mobile/src/services/units.service.js#L9) | ND | OFF/T | T | N | O,D,N |
| 423 | [unitsOfMeasure.service.js:29](../../web/src/services/unitsOfMeasure.service.js#L29) | ND | OFF/T | T | N | O,D,N |
| 419 | [units.service.js:35](../../mobile/src/services/units.service.js#L35) | ND | SL | H | N | L,D,N |
| 427 | [unitsOfMeasure.service.js:291](../../web/src/services/unitsOfMeasure.service.js#L291) | ND | SL | H | N | L,D,N |

### `stock_balances` (13 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 355 | [inventoryCatalog.service.js:122](../../mobile/src/services/inventoryCatalog.service.js#L122) | ND | OFF/T | T | S | O,D |
| 362 | [inventory.service.js:133](../../web/src/services/inventory.service.js#L133) | ND | OFF/T | T | S | O,D |
| 361 | [inventory.service.js:58](../../web/src/services/inventory.service.js#L58) | ND | SL | H | S | L,D |
| 356 | [inventoryCatalog.service.js:613](../../mobile/src/services/inventoryCatalog.service.js#L613) | — | SL | H | S | L |
| 357 | [pos.service.js:270](../../mobile/src/services/pos.service.js#L270) | — | SL | H | S | L |
| 358 | [pos.service.js:330](../../mobile/src/services/pos.service.js#L330) | — | SL | H | S | L |
| 359 | [reports.service.js:391](../../mobile/src/services/reports.service.js#L391) | — | SL | H | S | L |
| 360 | [sales.service.js:345](../../mobile/src/services/sales.service.js#L345) | — | SL | H | S | L |
| 363 | [manufacturing.service.js:411](../../web/src/services/manufacturing.service.js#L411) | — | SL | H | S | L |
| 364 | [products.service.js:487](../../web/src/services/products.service.js#L487) | — | SL | H | S | L |
| 365 | [reports.service.js:508](../../web/src/services/reports.service.js#L508) | — | SL | H | S | L |
| 366 | [reports.service.js:574](../../web/src/services/reports.service.js#L574) | — | SL | H | S | L |
| 367 | [reports.service.js:677](../../web/src/services/reports.service.js#L677) | — | SL | H | S | L |

### `locations` (9 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 151 | [setup.service.js:319](../../mobile/src/services/setup.service.js#L319) | ND | OFF/T | T | S | O,D |
| 155 | [locations.service.js:24](../../web/src/services/locations.service.js#L24) | ND | OFF/T | T | S | O,D |
| 145 | [cashMenu.service.js:20](../../mobile/src/services/cashMenu.service.js#L20) | ND | SL | H | S | L,D |
| 146 | [inventoryCatalog.service.js:21](../../mobile/src/services/inventoryCatalog.service.js#L21) | ND | SL | H | S | L,D |
| 147 | [pricingRules.service.js:151](../../mobile/src/services/pricingRules.service.js#L151) | ND | SL | H | S | L,D |
| 149 | [reports.service.js:301](../../mobile/src/services/reports.service.js#L301) | ND | SL | H | S | L,D |
| 156 | [locations.service.js:152](../../web/src/services/locations.service.js#L152) | ND | SL | H | S | L,D |
| 157 | [pricingRules.service.js:188](../../web/src/services/pricingRules.service.js#L188) | ND | SL | H | S | L,D |
| 160 | [Purchases.vue:2748](../../web/src/views/Purchases.vue#L2748) | ND | SL | H | S | L,D |

### `categories` (7 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 76 | [categories.service.js:8](../../mobile/src/services/categories.service.js#L8) | ND | OFF/T | T | S | O,D |
| 85 | [categories.service.js:21](../../web/src/services/categories.service.js#L21) | ND | OFF/T | T | S | O,D |
| 77 | [categories.service.js:29](../../mobile/src/services/categories.service.js#L29) | ND | SL | H | S | L,D |
| 80 | [pricingRules.service.js:167](../../mobile/src/services/pricingRules.service.js#L167) | ND | SL | H | S | L,D |
| 83 | [productsCatalog.service.js:357](../../mobile/src/services/productsCatalog.service.js#L357) | ND | SL | H | S | L,D |
| 84 | [taxRules.service.js:153](../../mobile/src/services/taxRules.service.js#L153) | ND | SL | H | S | L,D |
| 86 | [categories.service.js:56](../../web/src/services/categories.service.js#L56) | ND | SL | H | S | L,D |

### `products` (6 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 259 | [productsCatalog.service.js:220](../../mobile/src/services/productsCatalog.service.js#L220) | ND | OFF/T | T | S | O,D |
| 271 | [products.service.js:93](../../web/src/services/products.service.js#L93) | ND | OFF/T | T | S | O,D |
| 272 | [products.service.js:137](../../web/src/services/products.service.js#L137) | ND | OFF | H | S | O,D |
| 256 | [pricingRules.service.js:182](../../mobile/src/services/pricingRules.service.js#L182) | ND | LV | H | S | D |
| 266 | [taxRules.service.js:168](../../mobile/src/services/taxRules.service.js#L168) | ND | LV | H | S | D |
| 279 | [TaxRules.vue:428](../../web/src/views/TaxRules.vue#L428) | — | LF 50 | H | S | — |

### `inventory_batches` (5 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 112 | [batches.service.js:164](../../mobile/src/services/batches.service.js#L164) | ND | OFF/T | T | S | O,D |
| 115 | [inventoryCatalog.service.js:262](../../mobile/src/services/inventoryCatalog.service.js#L262) | ND | OFF/T | T | S | O,D |
| 117 | [batches.service.js:26](../../web/src/services/batches.service.js#L26) | ND | OFF/T | T | S | O,D |
| 116 | [reports.service.js:432](../../mobile/src/services/reports.service.js#L432) | ND | SL | H | S | L,D |
| 121 | [reports.service.js:630](../../web/src/services/reports.service.js#L630) | ND | SL | H | S | L,D |

### `cash_registers` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 58 | [cashMenu.service.js:52](../../mobile/src/services/cashMenu.service.js#L52) | ND | OFF/T | T | S | O,D |
| 62 | [cash.service.js:20](../../web/src/services/cash.service.js#L20) | ND | OFF/T | T | S | O,D |
| 59 | [cashMenu.service.js:76](../../mobile/src/services/cashMenu.service.js#L76) | ND | SL | H | S | L,D |
| 63 | [cash.service.js:39](../../web/src/services/cash.service.js#L39) | ND | SL | H | S | L,D |

### `cash_sessions` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 64 | [cashMenu.service.js:152](../../mobile/src/services/cashMenu.service.js#L152) | ND | OFF/T | T | S | O,D |
| 71 | [cash.service.js:117](../../web/src/services/cash.service.js#L117) | ND | OFF/T | T | S | O,D |
| 74 | [cash.service.js:252](../../web/src/services/cash.service.js#L252) | ND | SL | H | S | L,D |
| 75 | [reports.service.js:802](../../web/src/services/reports.service.js#L802) | ND | SL | H | S | L,D |

### `roles` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 299 | [rolesMenus.service.js:16](../../mobile/src/services/rolesMenus.service.js#L16) | ND | OFF/T | T | S | O,D |
| 306 | [roles.service.js:20](../../web/src/services/roles.service.js#L20) | ND | OFF/T | T | S | O,D |
| 304 | [users.service.js:64](../../mobile/src/services/users.service.js#L64) | ND | SL | H | S | L,D |
| 310 | [users.service.js:293](../../web/src/services/users.service.js#L293) | ND | SL | H | S | L,D |

### `sales` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 334 | [sales.service.js:120](../../mobile/src/services/sales.service.js#L120) | ND | OFF/T | T | S | O,D |
| 350 | [sales.service.js:123](../../web/src/services/sales.service.js#L123) | ND | OFF/T | T | S | O,D |
| 343 | [reports.service.js:79](../../web/src/services/reports.service.js#L79) | ND | SL | H | S | L,D |
| 330 | [aiInsights.service.js:130](../../mobile/src/services/aiInsights.service.js#L130) | — | LF 4000 | H | S | — |

### `taxes` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 380 | [setup.service.js:398](../../mobile/src/services/setup.service.js#L398) | ND | OFF/T | T | S | O,D |
| 384 | [taxes.service.js:18](../../web/src/services/taxes.service.js#L18) | ND | OFF/T | T | S | O,D |
| 383 | [taxRules.service.js:138](../../mobile/src/services/taxRules.service.js#L138) | ND | SL | H | S | L,D |
| 385 | [taxes.service.js:39](../../web/src/services/taxes.service.js#L39) | ND | SL | H | S | L,D |

### `users` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 432 | [users.service.js:37](../../mobile/src/services/users.service.js#L37) | ND | OFF/T | T | S | O,D |
| 435 | [users.service.js:20](../../web/src/services/users.service.js#L20) | ND | OFF/T | T | S | O,D |
| 430 | [cashMenu.service.js:35](../../mobile/src/services/cashMenu.service.js#L35) | ND | SL | H | S | L,D |
| 436 | [users.service.js:69](../../web/src/services/users.service.js#L69) | ND | SL | H | S | L,D |

### `bill_of_materials` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 26 | [inventoryCatalog.service.js:514](../../mobile/src/services/inventoryCatalog.service.js#L514) | ND | OFF/T | T | S | O,D |
| 29 | [manufacturing.service.js:62](../../web/src/services/manufacturing.service.js#L62) | ND | OFF/T | T | S | O,D |
| 28 | [inventoryCatalog.service.js:717](../../mobile/src/services/inventoryCatalog.service.js#L717) | ND | SL | H | S | L,D |

### `cash_movements` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 46 | [cashMenu.service.js:384](../../mobile/src/services/cashMenu.service.js#L384) | ND | OFF/T | T | S | O,D |
| 50 | [cash.service.js:272](../../web/src/services/cash.service.js#L272) | ND | OFF/T | T | S | O,D |
| 51 | [reports.service.js:237](../../web/src/services/reports.service.js#L237) | ND | SL | H | S | L,D |

### `payment_methods` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 177 | [cashMenu.service.js:528](../../mobile/src/services/cashMenu.service.js#L528) | ND | OFF/T | T | S | O,D |
| 181 | [paymentMethods.service.js:30](../../web/src/services/paymentMethods.service.js#L30) | ND | OFF/T | T | S | O,D |
| 180 | [pos.service.js:138](../../mobile/src/services/pos.service.js#L138) | ND | SL | H | S | L,D |

### `pricing_rules` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 187 | [pricingRules.service.js:52](../../mobile/src/services/pricingRules.service.js#L52) | ND | OFF/T | T | S | O,D |
| 186 | [pos.service.js:750](../../mobile/src/services/pos.service.js#L750) | ND | SL | H | S | L,D |
| 190 | [pricingRules.service.js:14](../../web/src/services/pricingRules.service.js#L14) | ND | SL/T | T | S | L,D |

### `tax_rules` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 375 | [taxRules.service.js:45](../../mobile/src/services/taxRules.service.js#L45) | ND | OFF/T | T | S | O,D |
| 378 | [taxRules.service.js:14](../../web/src/services/taxRules.service.js#L14) | ND | OFF/T | T | S | O,D |
| 379 | [taxes.service.js:102](../../web/src/services/taxes.service.js#L102) | ND | SL | H | S | L,D |

### `cash_register_assignments` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 56 | [cashMenu.service.js:451](../../mobile/src/services/cashMenu.service.js#L451) | ND | OFF/T | T | S | O,D |
| 57 | [cashAssignment.service.js:109](../../web/src/services/cashAssignment.service.js#L109) | — | SL/T | T | S | L |

### `production_orders` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 249 | [inventoryCatalog.service.js:446](../../mobile/src/services/inventoryCatalog.service.js#L446) | ND | OFF/T | T | S | O,D |
| 253 | [manufacturing.service.js:473](../../web/src/services/manufacturing.service.js#L473) | ND | OFF/T | T | S | O,D |

### `purchases` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 285 | [inventoryCatalog.service.js:326](../../mobile/src/services/inventoryCatalog.service.js#L326) | ND | OFF/T | T | S | O,D |
| 289 | [purchases.service.js:207](../../web/src/services/purchases.service.js#L207) | ND | SL/T | T | S | L,D |

### `vw_kardex` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 448 | [inventoryCatalog.service.js:185](../../mobile/src/services/inventoryCatalog.service.js#L185) | ND | OFF/T | T | S | O,D |
| 449 | [inventory.service.js:168](../../web/src/services/inventory.service.js#L168) | ND | SL/T | T | S | L,D |

### `sale_returns` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 329 | [sales.service.js:246](../../web/src/services/sales.service.js#L246) | ND | OFF/T | T | S | O,D |

### `stock_alert_log` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 354 | [inventory.service.js:484](../../web/src/services/inventory.service.js#L484) | ND | OFF/T | T | S | O,D |

### `online_order_lines` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 168 | [onlineOrders.service.js:54](../../mobile/src/services/onlineOrders.service.js#L54) | ND | SL | H | I | L,D,N |
| 169 | [onlineStore.service.js:730](../../web/src/services/onlineStore.service.js#L730) | ND | SL | H | I | L,D,N |

### `online_order_reservations` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 170 | [onlineOrders.service.js:61](../../mobile/src/services/onlineOrders.service.js#L61) | ND | SL | H | I | L,D,N |
| 171 | [onlineStore.service.js:746](../../web/src/services/onlineStore.service.js#L746) | ND | SL | H | I | L,D,N |

### `tenants` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 398 | [tenants.service.js:153](../../web/src/services/tenants.service.js#L153) | ND | SL | H | N | L,D,N |

### `product_media` (5 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 194 | [productMedia.service.js:223](../../mobile/src/services/productMedia.service.js#L223) | ND | SL | H | S | L,D |
| 201 | [productsCatalog.service.js:34](../../mobile/src/services/productsCatalog.service.js#L34) | ND | SL | H | S | L,D |
| 202 | [productsCatalog.service.js:158](../../mobile/src/services/productsCatalog.service.js#L158) | ND | SL | H | S | L,D |
| 203 | [productMedia.service.js:159](../../web/src/services/productMedia.service.js#L159) | ND | SL | H | S | L,D |
| 204 | [productMedia.service.js:222](../../web/src/services/productMedia.service.js#L222) | ND | SL | H | S | L,D |

### `inventory_moves` (4 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 122 | [inventoryCatalog.service.js:358](../../mobile/src/services/inventoryCatalog.service.js#L358) | ND | SL | H | S | L,D |
| 123 | [purchases.service.js:572](../../mobile/src/services/purchases.service.js#L572) | ND | SL | H | S | L,D |
| 125 | [purchases.service.js:241](../../web/src/services/purchases.service.js#L241) | ND | SL | H | S | L,D |
| 126 | [purchases.service.js:309](../../web/src/services/purchases.service.js#L309) | ND | SL | H | S | L,D |

### `customer_credit_accounts` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 92 | [credit.service.js:41](../../mobile/src/services/credit.service.js#L41) | ND | SL | H | S | L,D |
| 95 | [credit.service.js:104](../../web/src/services/credit.service.js#L104) | ND | SL | H | S | L,D |
| 96 | [credit.service.js:124](../../web/src/services/credit.service.js#L124) | ND | SL | H | S | L,D |

### `menu_items` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 161 | [rolesMenus.service.js:102](../../mobile/src/services/rolesMenus.service.js#L102) | ND | SL | H | G | L,D |
| 162 | [superAdminRoles.service.js:26](../../web/src/services/superAdminRoles.service.js#L26) | ND | SL | H | G | L,D |
| 163 | [superAdminRoles.service.js:46](../../web/src/services/superAdminRoles.service.js#L46) | ND | SL | H | G | L,D |

### `permissions` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 183 | [rolesMenus.service.js:88](../../mobile/src/services/rolesMenus.service.js#L88) | ND | SL | H | G | L,D |
| 184 | [roles.service.js:83](../../web/src/services/roles.service.js#L83) | ND | SL | H | G | L,D |
| 185 | [superAdminRoles.service.js:307](../../web/src/services/superAdminRoles.service.js#L307) | ND | SL | H | G | L,D |

### `accounting_accounts` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 2 | [accounting.service.js:816](../../web/src/services/accounting.service.js#L816) | ND | SL | H | S | L,D |
| 3 | [accounting.service.js:1270](../../web/src/services/accounting.service.js#L1270) | ND | SL | H | S | L,D |

### `bulk_import_errors` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 38 | [bulkImports.service.js:30](../../mobile/src/services/bulkImports.service.js#L30) | ND | SL | H | G | L,D |
| 39 | [bulkImportClient.service.js:145](../../web/src/services/bulkImportClient.service.js#L145) | ND | SL | H | G | L,D |

### `layaway_installments` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 139 | [layaway.service.js:97](../../mobile/src/services/layaway.service.js#L97) | ND | SL | H | S | L,D |
| 140 | [layaway.service.js:101](../../web/src/services/layaway.service.js#L101) | ND | SL | H | S | L,D |

### `vw_batch_traceability` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 438 | [batches.service.js:445](../../mobile/src/services/batches.service.js#L445) | ND | SL | H | S | L,D |
| 439 | [batches.service.js:313](../../web/src/services/batches.service.js#L313) | ND | SL | H | S | L,D |

### `vw_expiration_dashboard` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 441 | [batches.service.js:382](../../mobile/src/services/batches.service.js#L382) | ND | SL | H | S | L,D |
| 442 | [batches.service.js:212](../../web/src/services/batches.service.js#L212) | ND | SL | H | S | L,D |

### `vw_expiring_products` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 443 | [batches.service.js:351](../../mobile/src/services/batches.service.js#L351) | ND | SL | H | S | L,D |
| 444 | [batches.service.js:188](../../web/src/services/batches.service.js#L188) | ND | SL | H | S | L,D |

### `vw_layaway_payments` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 450 | [layaway.service.js:88](../../mobile/src/services/layaway.service.js#L88) | ND | SL | H | S | L,D |
| 451 | [layaway.service.js:91](../../web/src/services/layaway.service.js#L91) | ND | SL | H | S | L,D |

### `vw_layaway_summary` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 455 | [layaway.service.js:27](../../mobile/src/services/layaway.service.js#L27) | ND | SL/T | T | S | L,D |
| 456 | [layaway.service.js:25](../../web/src/services/layaway.service.js#L25) | ND | SL/T | T | S | L,D |

### `accounting_posting_rules` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 20 | [accounting.service.js:998](../../web/src/services/accounting.service.js#L998) | ND | SL | H | S | L,D |

### `accounting_withholding_configs` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 22 | [accounting.service.js:842](../../web/src/services/accounting.service.js#L842) | ND | SL | H | S | L,D |

### `billing_plans` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 32 | [tenantBilling.service.js:161](../../web/src/services/tenantBilling.service.js#L161) | ND | SL | H | G | L,D |

### `bundle_compositions` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 43 | [manufacturing.service.js:661](../../web/src/services/manufacturing.service.js#L661) | ND | SL | H | S | L,D |

### `departments` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 105 | [supabaseLookups.repository.js:15](../../web/src/services/adapters/supabaseLookups.repository.js#L15) | ND | SL | H | G | L,D |

### `document_types` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 106 | [supabaseLookups.repository.js:6](../../web/src/services/adapters/supabaseLookups.repository.js#L6) | ND | SL | H | G | L,D |

### `invoice_resolutions` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 132 | [electronicInvoicing.service.js:77](../../web/src/services/electronicInvoicing.service.js#L77) | ND | SL | H | S | L,D |

### `layaway_contracts` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 138 | [layaway.service.js:253](../../web/src/services/layaway.service.js#L253) | ND | SL | H | S | L,D |

### `online_store_catalog` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 174 | [onlineStore.service.js:367](../../web/src/services/onlineStore.service.js#L367) | ND | SL | H | S | L,D |

### `purchase_returns` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 284 | [purchases.service.js:349](../../web/src/services/purchases.service.js#L349) | ND | SL | H | S | L,D |

### `role_menu_templates` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 292 | [superAdminRoles.service.js:233](../../web/src/services/superAdminRoles.service.js#L233) | ND | SL | H | G | L,D |

### `tenant_subscriptions` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 393 | [tenantBilling.service.js:291](../../web/src/services/tenantBilling.service.js#L291) | ND | SL | H | S | L,D |

### `vw_component_expiration_risk` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 440 | [manufacturing.service.js:750](../../web/src/services/manufacturing.service.js#L750) | ND | SL | H | S | L,D |

### `vw_layaway_payments_report` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 452 | [reports.service.js:374](../../web/src/services/reports.service.js#L374) | ND | SL | H | S | L,D |

### `vw_production_cost_summary_by_product` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 460 | [reports.service.js:425](../../web/src/services/reports.service.js#L425) | ND | SL | H | S | L,D |

### `vw_products_expiration_config` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 461 | [batches.service.js:294](../../web/src/services/batches.service.js#L294) | ND | SL | H | S | L,D |

### `vw_stock_alerts` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 462 | [inventory.service.js:451](../../web/src/services/inventory.service.js#L451) | ND | SL | H | S | L,D |

### `vw_user_cash_registers` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 466 | [cashAssignment.service.js:31](../../web/src/services/cashAssignment.service.js#L31) | ND | SL | H | S | L,D |

### `supplier_payables` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 369 | [purchases.service.js:774](../../mobile/src/services/purchases.service.js#L774) | — | SL/T | T | S | L |
| 371 | [purchases.service.js:885](../../web/src/services/purchases.service.js#L885) | — | SL/T | T | S | L |

### `vw_layaway_report` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 453 | [reports.service.js:532](../../mobile/src/services/reports.service.js#L532) | — | SL | H | S | L |
| 454 | [reports.service.js:331](../../web/src/services/reports.service.js#L331) | — | SL | H | S | L |

### `vw_production_cost_report` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 459 | [reports.service.js:396](../../web/src/services/reports.service.js#L396) | — | SL | H | S | L |

### `vw_stock_for_cashier` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 465 | [batches.service.js:231](../../web/src/services/batches.service.js#L231) | — | SL | H | S | L |

### `customer_credit_movements` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 98 | [aiInsights.service.js:872](../../mobile/src/services/aiInsights.service.js#L872) | ND | LF 8000 | H | I | D,N |
| 99 | [credit.service.js:68](../../mobile/src/services/credit.service.js#L68) | ND | LF 200 | H | S | D |
| 100 | [credit.service.js:142](../../web/src/services/credit.service.js#L142) | ND | LF 200 | H | S | D |

### `product_variants` (11 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 213 | [pos.service.js:306](../../mobile/src/services/pos.service.js#L306) | ND | LV | H | S | D |
| 215 | [pricingRules.service.js:204](../../mobile/src/services/pricingRules.service.js#L204) | ND | LV | H | S | D |
| 221 | [purchases.service.js:108](../../mobile/src/services/purchases.service.js#L108) | ND | LV | H | S | D |
| 222 | [purchases.service.js:124](../../mobile/src/services/purchases.service.js#L124) | ND | LV | H | S | D |
| 223 | [purchases.service.js:135](../../mobile/src/services/purchases.service.js#L135) | ND | LV | H | S | D |
| 228 | [taxRules.service.js:190](../../mobile/src/services/taxRules.service.js#L190) | ND | LV | H | S | D |
| 237 | [products.service.js:529](../../web/src/services/products.service.js#L529) | ND | LV | H | S | D |
| 244 | [Purchases.vue:3056](../../web/src/views/Purchases.vue#L3056) | ND | LF 50 | H | S | D |
| 245 | [Purchases.vue:3103](../../web/src/views/Purchases.vue#L3103) | ND | LF 30 | H | S | D |
| 246 | [Purchases.vue:3469](../../web/src/views/Purchases.vue#L3469) | ND | LF 500 | H | S | D |
| 247 | [TaxRules.vue:453](../../web/src/views/TaxRules.vue#L453) | — | LF 50 | H | S | — |

### `system_alerts` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 372 | [alerts.service.js:9](../../mobile/src/services/alerts.service.js#L9) | ND | LV | H | S | D |
| 373 | [alerts.service.js:18](../../web/src/services/alerts.service.js#L18) | ND | LV | H | S | D |
| 374 | [alerts.service.js:53](../../web/src/services/alerts.service.js#L53) | ND | LV | H | S | D |

### `vw_inventory_rotation_analysis` (3 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 445 | [purchases.service.js:358](../../mobile/src/services/purchases.service.js#L358) | ND | LF 100 | H | S | D |
| 446 | [ai-pricing-advisor.service.js:62](../../web/src/services/ai-pricing-advisor.service.js#L62) | ND | LV | H | S | D |
| 447 | [purchases.service.js:110](../../web/src/services/purchases.service.js#L110) | ND | LF 100 | H | S | D |

### `ai_telemetry_events` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 24 | [aiTelemetry.service.js:248](../../mobile/src/services/aiTelemetry.service.js#L248) | ND | LV | H | S | D |
| 25 | [aiTelemetry.service.js:181](../../web/src/services/aiTelemetry.service.js#L181) | ND | LV | H | S | D |

### `bulk_imports` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 40 | [bulkImports.service.js:9](../../mobile/src/services/bulkImports.service.js#L9) | ND | LV | H | S | D |
| 42 | [bulkImportClient.service.js:130](../../web/src/services/bulkImportClient.service.js#L130) | ND | LV | H | S | D |

### `customers` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 101 | [pos.service.js:504](../../mobile/src/services/pos.service.js#L504) | ND | LV | H | S | D |
| 102 | [pos.service.js:530](../../mobile/src/services/pos.service.js#L530) | ND | LV | H | S | D |

### `online_orders` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 172 | [onlineOrders.service.js:40](../../mobile/src/services/onlineOrders.service.js#L40) | ND | LV | H | S | D |
| 173 | [onlineStore.service.js:684](../../web/src/services/onlineStore.service.js#L684) | ND | LV | H | S | D |

### `purchase_orders` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 280 | [purchases.service.js:447](../../mobile/src/services/purchases.service.js#L447) | ND | LF 100 | H | S | D |
| 281 | [purchases.service.js:586](../../web/src/services/purchases.service.js#L586) | ND | LF 100 | H | S | D |

### `transfer_requests` (2 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 415 | [inventoryOperations.service.js:158](../../mobile/src/services/inventoryOperations.service.js#L158) | ND | LF 200 | H | S | D |
| 416 | [inventory.service.js:285](../../web/src/services/inventory.service.js#L285) | ND | LF 200 | H | S | D |

### `accounting_automation_exceptions` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 7 | [accounting.service.js:1063](../../web/src/services/accounting.service.js#L1063) | ND | LV | H | S | D |

### `accounting_entries` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 12 | [accounting.service.js:767](../../web/src/services/accounting.service.js#L767) | ND | LV | H | S | D |

### `accounting_event_queue` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 17 | [accounting.service.js:784](../../web/src/services/accounting.service.js#L784) | ND | LV | H | S | D |

### `accounting_period_closures` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 19 | [accounting.service.js:913](../../web/src/services/accounting.service.js#L913) | ND | LV | H | S | D |

### `vw_ondemand_margin_analysis` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 458 | [manufacturing.service.js:734](../../web/src/services/manufacturing.service.js#L734) | ND | LV | H | S | D |

### `sale_lines` (1 listados)

| # | Sitio | Orden | Paginación | Total | Ten. | Riesgo |
|---:|---|---|---|---|:--:|---|
| 312 | [aiInsights.service.js:144](../../mobile/src/services/aiInsights.service.js#L144) | — | LF 6000 | H | I | N |

