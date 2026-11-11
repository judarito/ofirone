# Análisis de brechas P1–P2 — PostgreSQL portable

- **Fecha:** 2026-11-09
- **Alcance:** capacidades P1 (operación administrativa) y P2 (capacidades diferidas) sobre el baseline portable `database/migrations/0001–0012`, más las brechas P0/P1 ya detectadas.
- **Base de evidencia:** análisis estático de las 12 migraciones y de las suites sintéticas ya ejecutadas. **No se aplicaron migraciones, no se ejecutó DDL y no se conectó a DEV ni a PROD en esta tarea.**
- **Perímetro respetado:** solo se crea este documento en `docs/database-portability/`. No se modificaron README, `TAREAS_LLM_EXTERNO_POSTGRES.md`, migraciones, backend, web, mobile ni CI.
- **Datos:** ningún host, credencial ni dato real. Las pruebas referidas usan UUID sintéticos y dominios `.example.test`.

## 0. Veredicto ejecutivo

El baseline portable cubre **38 tablas** y ninguna vista: la operación administrativa P1 tiene un núcleo de datos razonable, pero **no tiene cierre de caja ni funciones de claim de jobs**, y varias capacidades están validadas solo a nivel de agregados, no de ciclo de vida. P2 **no está implementado** en el baseline portable; las tablas que aparecen en el corpus histórico de Supabase no cuentan como existentes.

| Prioridad | Estado real | Qué falta para cerrar la validación |
|---|---|---|
| **P0 — vender** | **PARCIAL** (18 PASS, 0 FAIL) | `sales.customer_id`; la prueba actual solo comprueba la columna, no la atribución real de una venta |
| **P1 — administración** | **PARCIAL** (44 PASS, 0 FAIL, 6 BLOQ en la suite de negocio) | Cierre de caja, claim/complete de jobs, ciclo de vida de compras/apartados, contratos de reportes y pruebas negativas específicas |
| **P2 — diferido** | **BLOQ-P2 / backlog** | No hay tablas ni implementación en `0001–0012`; no debe bloquear P0/P1 |

**Regla aplicada:** una tabla del corpus histórico (`shared/supabase/migrations/`, `web/migrations/`, `mobile/migrations/`) **no** se considera parte del baseline portable. Se cita solo como referencia de lo que existió y de lo que habría que rediseñar.

---

## 1. Matriz P1 — operación administrativa

### 1.0 Resumen

| # | Capacidad | Tablas portables | Validación existente | Clasificación |
|---:|---|---|---|---|
| 1 | Compras y proveedores | `purchases`, `purchase_lines`, `third_parties` | PASS sintético de totales y reconciliación; sin prueba de ciclo de vida | **PARCIAL** |
| 2 | Cuentas por pagar | `supplier_payables`, `supplier_payable_payments` | PASS sintético (original 100 / pagado 30) | **PARCIAL** |
| 3 | Cartera cliente | `customer_credit_accounts`, `customer_credit_movements`, `customers` | PASS sintético (saldo 20 = movimientos 20) | **PARCIAL**, condicionada por P0 |
| 4 | Plan separe y abonos | `layaway_contracts`, `layaway_items`, `layaway_installments`, `layaway_payments` | PASS sintético (total 100 / pagado 20 / saldo 80) | **PARCIAL** |
| 5 | Auditoría | `audit_log` | PASS de aislamiento N20; sin prueba de inmutabilidad | **PARCIAL** |
| 6 | `async_jobs` e idempotencia | `async_jobs` | PASS de aislamiento de tabla N18/N19; claim/complete BLOQ | **PARCIAL / BLOQ-P1** |
| 7 | Cierre de caja | Solo `payment_methods` | BLOQ-P1: no existen tablas de caja | **BLOQ-P1** |
| 8 | Reportes operativos | Consultas sobre tablas P1; **0 vistas** | Sumas y reconciliación PASS; sin contratos de reporte | **PARCIAL** |

La suite que sostiene esta tabla es [`_data/validation-business-0012-2026-11-09.txt`](_data/validation-business-0012-2026-11-09.txt): 44 PASS, 0 FAIL, 6 BLOQ y 1 HALLAZGO. Los conteos de tablas y la ausencia de vistas se verificaron con `grep` sobre `database/migrations/*.up.sql` (38 `CREATE TABLE public`, 0 `CREATE VIEW`/`CREATE MATERIALIZED VIEW`).

---

### 1.1 Compras y proveedores

**Tablas existentes**

- `purchases`: cabecera con `location_id`, `supplier_id`, numeración por sede, estado y totales ([`0009_purchases.up.sql:5-36`](../../database/migrations/0009_purchases.up.sql#L5-L36)).
- `purchase_lines`: líneas con `variant_id`, costo, impuestos, descuento y `quantity_received` ([`0009_purchases.up.sql:42-68`](../../database/migrations/0009_purchases.up.sql#L42-L68)).
- `third_parties`: maestro de proveedores/clientes; el proveedor se referencia con FK compuesta por tenant ([`0008_parties.up.sql:4-27`](../../database/migrations/0008_parties.up.sql#L4-L27), [`0009_purchases.up.sql:25-26`](../../database/migrations/0009_purchases.up.sql#L25-L26)).
- Índices de listado y proveedor ([`0009_purchases.up.sql:37-38`](../../database/migrations/0009_purchases.up.sql#L37-L38)) y de líneas ([`0009_purchases.up.sql:69-72`](../../database/migrations/0009_purchases.up.sql#L69-L72)).

**Qué falta**

- No hay **recepción por evento**: `quantity_received` es un acumulador en la línea; no existe tabla de recepciones, ni asignación compra-línea → lote (`purchase_receipts`, `purchase_line_batches`).
- No hay **devoluciones de compra** ni notas de crédito de proveedor.
- No hay datos comerciales del proveedor (plazo, moneda, retención) ni número de factura del proveedor; `purchases` no tiene un `supplier_invoice_number` ni un `reference`.
- No hay flujo de aprobación ni transiciones de estado impuestas por la base; `status` solo está restringido por `CHECK` ([`0009_purchases.up.sql:30`](../../database/migrations/0009_purchases.up.sql#L30)).
- El efecto en inventario y la creación de la cuenta por pagar son responsabilidad de casos de uso posteriores, no de la migración ([`0009_purchases.up.sql:1-2`](../../database/migrations/0009_purchases.up.sql#L1-L2)).

**Estado de validación**

`PASS` sintético de agregados: una compra de 100, `total = líneas`, y conciliación sin descuadres ([`_data/validation-business-0012-2026-11-09.txt`](_data/validation-business-0012-2026-11-09.txt)). **No** hay una prueba negativa explícita de compra con proveedor de otro tenant. La cobertura es de suma, no de ciclo de vida.

**Siguiente prueba concreta**

1. Crear dos tenants A/B con proveedores A/B.
2. Insertar una compra de A con `supplier_id` de B: debe fallar por FK compuesta (`23503`).
3. Recibir parcialmente una línea (p. ej. 40 de 100), registrar el movimiento de inventario y verificar que el saldo del lote y `quantity_received` coinciden.
4. Cancelar una compra y comprobar que no se genera cuenta por pagar ni movimiento de inventario.

---

### 1.2 Cuentas por pagar

**Tablas existentes**

- `supplier_payables`: obligación por proveedor y compra, con `original_amount`, `paid_amount`, `due_date` y estado ([`0010_credit_payables.up.sql:5-26`](../../database/migrations/0010_credit_payables.up.sql#L5-L26)).
- `supplier_payable_payments`: pagos con método de pago, fecha y referencia ([`0010_credit_payables.up.sql:34-49`](../../database/migrations/0010_credit_payables.up.sql#L34-L49)).
- Índices de aging/listado por estado y vencimiento ([`0010_credit_payables.up.sql:27-30`](../../database/migrations/0010_credit_payables.up.sql#L27-L30)).

**Qué falta**

- `UNIQUE (tenant_id, purchase_id)` ([`0010_credit_payables.up.sql:18`](../../database/migrations/0010_credit_payables.up.sql#L18)) impide **más de una cuenta por compra**; no modela pagos fraccionados como cuentas separadas ni notas de crédito.
- No hay vista ni contrato de **aging** (corriente, 1–30, 31–60, 61–90, >90).
- No hay trigger que derive `status` de `paid_amount`; la transición `open → partially_paid → paid` es responsabilidad de la aplicación.
- No hay pago en exceso a nivel de esquema más allá de `paid_amount <= original_amount` ([`0010_credit_payables.up.sql:24`](../../database/migrations/0010_credit_payables.up.sql#L24)); el redondeo y la aplicación a una cuenta concreta no están modelados.
- No hay asiento contable ni moneda explícita por cuenta.

**Estado de validación**

`PASS` sintético: original 100, pagado 30, y conciliación `pagado = suma de pagos` ([`_data/validation-business-0012-2026-11-09.txt`](_data/validation-business-0012-2026-11-09.txt)). Falta probar sobrepago, pago duplicado y cuenta de otro tenant.

**Siguiente prueba concreta**

1. Pagar 30 + 70 y verificar `paid_amount = 100`, `status = paid`.
2. Intentar un pago de 1 adicional: debe fallar por `CHECK` (`23514`) o por la regla de caso de uso.
3. Insertar un pago con `payable_id` de B bajo contexto A: debe fallar (`42501`/`23503`).
4. Ejecutar la consulta de aging con fechas sintéticas y verificar los cinco buckets.

---

### 1.3 Cartera cliente

**Tablas existentes**

- `customers`: cliente por tenant, con `credit_enabled` y `credit_limit` ([`0008_parties.up.sql:31-45`](../../database/migrations/0008_parties.up.sql#L31-L45)).
- `customer_credit_accounts`: cuenta por cliente, límite, saldo y estado ([`0010_credit_payables.up.sql:53-69`](../../database/migrations/0010_credit_payables.up.sql#L53-L69)).
- `customer_credit_movements`: cargos, pagos, ajustes y castigos, con `source_type`/`source_id` ([`0010_credit_payables.up.sql:75-90`](../../database/migrations/0010_credit_payables.up.sql#L75-L90)).
- Índices de cuenta y movimientos ([`0010_credit_payables.up.sql:70-71`](../../database/migrations/0010_credit_payables.up.sql#L70-L71), [`0010_credit_payables.up.sql:91-92`](../../database/migrations/0010_credit_payables.up.sql#L91-L92)).

**Qué falta**

- **No se puede originar un cargo desde una venta** mientras `sales` no tenga `customer_id` (brecha P0, §3). `customer_credit_movements.source_type/source_id` no tiene FK ni unicidad, así que la idempotencia del cargo depende del caso de uso.
- `current_balance` es una columna denormalizada: no hay trigger que la mantenga igual a la suma de movimientos; la consistencia es responsabilidad de la transacción de aplicación.
- El límite de crédito no se impone en la base: solo se valida `credit_limit >= 0` ([`0010_credit_payables.up.sql:66`](../../database/migrations/0010_credit_payables.up.sql#L66)) y `current_balance >= 0` ([`0010_credit_payables.up.sql:67`](../../database/migrations/0010_credit_payables.up.sql#L67)); no hay `CHECK (current_balance <= credit_limit)`.
- Hay duplicación de límite entre `customers.credit_limit` ([`0008_parties.up.sql:36`](../../database/migrations/0008_parties.up.sql#L36)) y `customer_credit_accounts.credit_limit` ([`0010_credit_payables.up.sql:57`](../../database/migrations/0010_credit_payables.up.sql#L57)); no está definida la fuente de verdad.
- No hay estado de cuenta, aging ni bloqueo de cliente moroso.

**Estado de validación**

`PASS` sintético: movimientos por 20 y saldo 20; conciliación `saldo = movimientos` ([`_data/validation-business-0012-2026-11-09.txt`](_data/validation-business-0012-2026-11-09.txt)). La prueba no cubre cargo desde venta ni enforcement del límite.

**Siguiente prueba concreta**

1. Cargo de 30 y pago de 10: saldo 20 y movimientos 30/10.
2. Repetir el mismo cargo con el mismo `source_id`: debe rechazarse o ser idempotente (requiere regla o constraint; hoy no existe).
3. Intentar saldo > límite: debe rechazarlo el caso de uso; si se quiere garantía de base, evaluar un `CHECK` con trigger.
4. Insertar movimiento con `credit_account_id` de B bajo contexto A: `42501`/`23503`.

---

### 1.4 Plan separe y abonos

**Tablas existentes**

- `layaway_contracts`: cabecera con cliente, sede, totales, `paid_total`, `balance_due`, expiración y flags de reserva ([`0011_layaway.up.sql:5-38`](../../database/migrations/0011_layaway.up.sql#L5-L38)).
- `layaway_items`: líneas con variante, cantidad y precio ([`0011_layaway.up.sql:46-66`](../../database/migrations/0011_layaway.up.sql#L46-L66)).
- `layaway_installments`: cuotas con vencimiento, monto y estado ([`0011_layaway.up.sql:69-88`](../../database/migrations/0011_layaway.up.sql#L69-L88)).
- `layaway_payments`: abonos con método, referencia y vínculo opcional a cuota ([`0011_layaway.up.sql:94-115`](../../database/migrations/0011_layaway.up.sql#L94-L115)).

**Qué falta**

- No hay `converted_sale_id` ni relación formal apartado → venta al completarse; la conversión no deja trazabilidad en el esquema.
- No hay flujo de cancelación/devolución de abonos ni tabla de reembolsos.
- `stock_reserved_on_create` es un booleano informativo ([`0011_layaway.up.sql:12-13`](../../database/migrations/0011_layaway.up.sql#L12-L13)); no hay FK ni vínculo con `stock_reservations`.
- `layaway_payments.installment_id` es nullable ([`0011_layaway.up.sql:98`](../../database/migrations/0011_layaway.up.sql#L98)): un abono puede no aplicarse a una cuota concreta.
- No hay transiciones de estado impuestas por trigger; `status` solo tiene `CHECK` ([`0011_layaway.up.sql:31`](../../database/migrations/0011_layaway.up.sql#L31)).
- No hay proceso de expiración/cobro de mora; `expires_at` es solo una fecha.

**Estado de validación**

`PASS` sintético: total 100, pagado 20, saldo 80; `balance_due = total - paid_total` y líneas = total ([`_data/validation-business-0012-2026-11-09.txt`](_data/validation-business-0012-2026-11-09.txt)). Falta el ciclo completo (última cuota → conversión a venta) y la cancelación.

**Siguiente prueba concreta**

1. Pagar la última cuota, verificar `balance_due = 0` y convertir el apartado en venta; comprobar que la venta y el apartado quedan enlazados (cuando exista la columna).
2. Cancelar un apartado con stock reservado y verificar que la reserva se libera.
3. Intentar un abono con `layaway_id` de B bajo contexto A: `42501`/`23503`.
4. Repetir un abono con la misma referencia: debe ser idempotente o rechazado.

---

### 1.5 Auditoría

**Tablas existentes**

- `audit_log`: tenant, actor, acción, recurso, `request_id`, metadata JSONB y fecha ([`0012_jobs_audit.up.sql:39-59`](../../database/migrations/0012_jobs_audit.up.sql#L39-L59)).
- Índice de página y de recurso ([`0012_jobs_audit.up.sql:56-59`](../../database/migrations/0012_jobs_audit.up.sql#L56-L59)).
- RLS y `FORCE RLS` en el bloque de la migración ([`0012_jobs_audit.up.sql:61-73`](../../database/migrations/0012_jobs_audit.up.sql#L61-L73)).

**Qué falta**

- **No hay inmutabilidad en la base**: no existe trigger que rechace `UPDATE`/`DELETE`; la política RLS es `FOR ALL` ([`0012_jobs_audit.up.sql:67-70`](../../database/migrations/0012_jobs_audit.up.sql#L67-L70)). Si el rol de runtime recibe `UPDATE`/`DELETE`, la auditoría es mutable.
- No hay automatización de eventos: ningún trigger escribe en `audit_log`.
- `actor_identity_id` es nullable ([`0012_jobs_audit.up.sql:42`](../../database/migrations/0012_jobs_audit.up.sql#L42)); no se distingue actor humano de proceso.
- No hay política de retención, partición ni exportación.
- No hay matriz de “operaciones sensibles que deben auditarse” (venta, anulación, pago, cierre de caja, cambio de precio, ajuste de inventario).

**Estado de validación**

`PASS` sintético de aislamiento: N20 rechaza un `audit_log` con tenant B bajo contexto A; la siembra deja 1 evento ([`_data/validation-business-0012-2026-11-09.txt`](_data/validation-business-0012-2026-11-09.txt)). No hay prueba de append-only ni de cobertura.

**Siguiente prueba concreta**

1. Con rol de runtime, intentar `UPDATE audit_log` y `DELETE FROM audit_log`: debe fallar por privilegios (`42501`).
2. Insertar un evento por cada operación sensible definida y verificar `resource_type`/`resource_id`.
3. Consultar por `(tenant_id, resource_type, resource_id)` y verificar el uso de `audit_log_resource_idx` con `EXPLAIN`.

---

### 1.6 `async_jobs` e idempotencia

**Tablas existentes**

- `async_jobs`: tipo, clave de idempotencia, payload, estado, prioridad, intentos, lease y error ([`0012_jobs_audit.up.sql:4-30`](../../database/migrations/0012_jobs_audit.up.sql#L4-L30)).
- Unicidad `UNIQUE (tenant_id, job_type, idempotency_key)` ([`0012_jobs_audit.up.sql:22`](../../database/migrations/0012_jobs_audit.up.sql#L22)).
- Índice parcial de claim y de listado por tenant ([`0012_jobs_audit.up.sql:31-35`](../../database/migrations/0012_jobs_audit.up.sql#L31-L35)).

**Qué falta**

- No existen `fn_claim_async_jobs` ni `fn_complete_async_job`; el contrato propuesto está en [`_data/contracts/reference_queries.sql:48-86`](_data/contracts/reference_queries.sql#L48-L86) y [`_data/contracts/README.md:35-40`](_data/contracts/README.md#L35-L40).
- No hay reclamo de leases vencidos (`locked_at` sin umbral), backoff, dead-letter ni reintento programado.
- No hay outbox transaccional; `async_jobs` no sustituye un outbox de eventos.
- No hay prueba de dos workers concurrentes ni de que la misma clave de idempotencia devuelva el job existente.

**Estado de validación**

`PASS` de aislamiento de tabla: N18 (A solo ve su job) y N19 (A no puede cerrar el job de B). **BLOQ** para claim/complete por ausencia de funciones ([`_data/validation-business-0012-2026-11-09.txt`](_data/validation-business-0012-2026-11-09.txt)).

**Siguiente prueba concreta**

1. Insertar el mismo `(tenant_id, job_type, idempotency_key)` dos veces: `23505` o retorno del existente según contrato.
2. Dos workers hacen claim simultáneo: cada uno obtiene una fila distinta (`FOR UPDATE SKIP LOCKED`), sin doble ejecución.
3. Simular lease vencido y verificar que el job vuelve a ser reclamable.
4. Completar con `locked_by` ajeno: 0 filas/`42501`.

---

### 1.7 Cierre de caja (BLOQ-P1)

**Tablas existentes**

- Solo `payment_methods`, con `method_type = 'cash'` ([`0004_reference_catalog.up.sql:87-107`](../../database/migrations/0004_reference_catalog.up.sql#L87-L107)).
- `sale_payments` registra el medio y el monto ([`0007_sales.up.sql:67-84`](../../database/migrations/0007_sales.up.sql#L67-L84)), pero **no** hay `cash_session_id` en `sales` ni en `sale_payments`.

**Qué falta**

- `cash_registers`, `cash_sessions`, `cash_movements`, `cash_register_assignments` y el cierre/arqueo por turno.
- Vínculo venta → sesión de caja; hoy no existe forma de reconstruir el efectivo esperado de un turno.
- Apertura, cierre, diferencia (contado vs esperado), retiros/ingresos y bloqueo de sesiones cerradas.
- Reporte de cierre y su inmutabilidad.

Las tablas de caja existieron en el corpus histórico ([`multitenancy-isolation.md:100`](multitenancy-isolation.md#L100), [`data-migration-runbook.md:90`](data-migration-runbook.md#L90)), pero **no están en `0001–0012`**. No se deben contar como existentes.

**Estado de validación**

`BLOQ-P1` explícito en [`_data/validation-p0-sell-flow-0012.txt`](_data/validation-p0-sell-flow-0012.txt) y en [`_data/contracts/README.md:80`](_data/contracts/README.md#L80). Es la brecha que impide declarar P1 cerrado.

**Siguiente prueba concreta**

1. Abrir una sesión de caja para A/sede A y registrar ventas en efectivo con `cash_session_id`.
2. Cerrar la sesión con un conteo distinto: verificar diferencia y que la sesión cerrada rechaza movimientos posteriores.
3. Bajo contexto B, intentar leer/cerrar la sesión de A: `42501`/0 filas.

---

### 1.8 Reportes operativos

**Tablas existentes**

- Los datos base están en ventas, pagos, inventario, compras, cartera y apartados (§1.1–§1.6).
- **No hay vistas ni vistas materializadas** en `0001–0012` (0 `CREATE VIEW`/`CREATE MATERIALIZED VIEW`). Los agregados se calculan con SQL directo.
- Índices de paginación en ventas, productos, clientes, compras, terceros, apartados, jobs y auditoría ([`0007_sales.up.sql:34-35`](../../database/migrations/0007_sales.up.sql#L34-L35), [`0009_purchases.up.sql:37-38`](../../database/migrations/0009_purchases.up.sql#L37-L38), [`0010_credit_payables.up.sql:27-30`](../../database/migrations/0010_credit_payables.up.sql#L27-L30), [`0011_layaway.up.sql:39-42`](../../database/migrations/0011_layaway.up.sql#L39-L42), [`0012_jobs_audit.up.sql:56-59`](../../database/migrations/0012_jobs_audit.up.sql#L56-L59)).

**Qué falta**

- Contratos de reporte con columnas, filtros, orden y totales: ventas del día, ventas por medio de pago, inventario valorizado, compras del período, aging de proveedores, aging de cartera y avance de apartados.
- Reporte de **cierre de caja** (depende de §1.7).
- Definición de moneda, zona horaria y redondeo en los agregados.
- Consultas de reporte con `EXPLAIN` y volumen; hoy la suite de paginación solo documenta `EXPLAIN` de productos, ventas, clientes y jobs ([`_data/validation-pagination-0012-2026-11-09.txt`](_data/validation-pagination-0012-2026-11-09.txt)).
- No hay `pg_trgm` ni búsqueda avanzada; no es un requisito P1.

**Estado de validación**

`PARCIAL`: las sumas y conciliaciones P1 pasan, y la paginación de 9 listados pasa con 130 filas cada uno; **no** existe una suite de reportes ni valores esperados por reporte. El cierre de caja es BLOQ-P1.

**Siguiente prueba concreta**

1. Definir 5–7 consultas de referencia (ventas del día, ventas por método, compras del período, aging CxP, aging cartera, avance de apartados) en un documento de contratos.
2. Ejecutarlas sobre el fixture sintético de 130 filas y comparar contra totales calculados en la siembra.
3. Medir `EXPLAIN (ANALYZE, BUFFERS)` y proponer índices solo si el plan no usa los existentes.
4. Añadir el reporte de cierre de caja cuando §1.7 exista.

---

## 2. Matriz P2 — capacidades diferidas

**Regla:** P2 no se valida con tablas vacías ni con DDL especulativo. Solo se implementa y prueba cuando exista una decisión de producto y una migración del track Go. Hasta entonces se clasifica **BLOQ-P2** o **backlog**, y no bloquea P0/P1.

| Capacidad | Qué existe en el baseline portable | Qué falta / tablas ausentes | Referencia histórica (no portable) | Clasificación |
|---|---|---|---|---|
| **Tienda online** | Nada específico. Solo ventas, clientes y reservas de stock como dependencias | `online_stores`, `online_store_catalog`, `online_orders`, `online_order_lines`, `online_order_reservations`; catálogo público, checkout, estados de pedido y pago | [`multitenancy-isolation.md:106`](multitenancy-isolation.md#L106), [`multitenancy-isolation.md:130-131`](multitenancy-isolation.md#L130-L131) | **BLOQ-P2** |
| **Manufactura / BOM** | Señales de modelo, no capacidad: `products.product_type` admite `manufactured` ([`0005_products.up.sql:25`](../../database/migrations/0005_products.up.sql#L25)) y los movimientos admiten `production_in`/`consumption_out` ([`0006_inventory.up.sql:56-58`](../../database/migrations/0006_inventory.up.sql#L56-L58)) | `bill_of_materials`, `bom_components`, `production_orders`, `production_order_lines`, `production_outputs`, `component_allocations`, `service_deliveries`; explosión de BOM, costeo y consumo de lotes | [`multitenancy-isolation.md:104`](multitenancy-isolation.md#L104), [`multitenancy-isolation.md:158-159`](multitenancy-isolation.md#L158-L159) | **BLOQ-P2** |
| **Offline / sync** | `async_jobs` solo para trabajos internos; no es un outbox ni un checkpoint móvil | Outbox durable, cola de sincronización, checkpoints por dispositivo, tombstones, resolución de conflictos y operaciones idempotentes de venta móvil | Propuesta, no migración: [`baseline-proposal.md:32`](baseline-proposal.md#L32), [`baseline-proposal.md:79`](baseline-proposal.md#L79), [`baseline-proposal.md:113`](baseline-proposal.md#L113) | **BLOQ-P2 / backlog** |
| **OCR, IA, realtime y notificaciones** | Nada. No hay tablas, funciones, extensiones ni publicación de realtime en `0001–0012` | `notifications`, `notification_events`, `notification_outbox`, `notification_push_queue`, `user_push_devices`, `system_alerts`; eventos realtime, OCR de documentos, embeddings/IA y preferencias | [`multitenancy-isolation.md:111`](multitenancy-isolation.md#L111), [`multitenancy-isolation.md:666-669`](multitenancy-isolation.md#L666-L669) | **BLOQ-P2** |
| **Storage / media avanzado** | Nada específico. El baseline no depende de `storage.*`; no hay metadatos de archivos | `product_media`, metadatos de objetos, buckets, URLs firmadas, variantes/thumbnails, cuarentena y autorización de descarga | [`data-migration-runbook.md:144`](data-migration-runbook.md#L144), [`data-migration-runbook.md:185-207`](data-migration-runbook.md#L185-L207) | **BLOQ-P2** |
| **Optimizaciones no requeridas por P0** | Índices de paginación y FEFO; sin vistas materializadas; sin extensiones de búsqueda | `stock_balances` como matview, read models de reportes, `pg_trgm`, particionado, caché de agregados | [`baseline-proposal.md:39`](baseline-proposal.md#L39), [`pagination-query-matrix.md:39`](pagination-query-matrix.md#L39) | **Backlog** |

### 2.1 Notas de clasificación

- **No inventar tablas.** La existencia de `product_type = 'manufactured'` o de `movement_type = 'production_in'` no demuestra manufactura: son solo valores permitidos por `CHECK`. La capacidad no existe hasta que existan BOM y órdenes.
- **`async_jobs` no es outbox.** La tabla de jobs resuelve trabajo interno con idempotencia, pero no garantiza publicación de eventos ni sincronización offline.
- **Tienda online y manufactura dependen de P0/P1.** Cualquier diseño de tienda necesita venta atribuida a cliente y control de stock; manufactura necesita inventario y costos. No se deben adelantar antes de cerrar las brechas P0/P1.
- **Storage es una decisión de arquitectura, no una tabla.** El baseline portable evita `storage.objects`; los metadatos propios y la autorización de archivos pertenecen al backend, no a RLS.

---

## 3. Brechas P0/P1 ya detectadas

Esta sección solo resume impacto y referencias. **No redefine el diseño**: las decisiones de DDL pertenecen al track Go y a los ADR vigentes.

| Brecha | Evidencia | Impacto | Efecto en la validación | Referencia de decisión |
|---|---|---|---|---|
| **P0: `sales.customer_id` ausente** | `sales` no tiene la columna ([`0007_sales.up.sql:5-32`](../../database/migrations/0007_sales.up.sql#L5-L32)); `customers` sí existe ([`0008_parties.up.sql:31-45`](../../database/migrations/0008_parties.up.sql#L31-L45)); la suite P0 lo marca BLOQ-P0 ([`_data/validation-p0-sell-flow-0012.txt`](_data/validation-p0-sell-flow-0012.txt)) | No se puede atribuir una venta a un cliente: se rompen historial de compras, comprobantes personalizados, cartera originada por venta y conversión de tienda online | P0 queda **PARCIAL** aunque los 18 PASS se mantengan; la prueba actual solo verifica que la columna exista, no que una venta se registre con cliente | Propuesta registrada en [`_data/contracts/README.md:79`](_data/contracts/README.md#L79); patrón de FK compuesta en [ADR-003](../decisions/ADR-003-aislamiento-multi-tenant.md); atomicidad en [ADR-004](../decisions/ADR-004-rpc-sql-vs-go.md). **No hay ADR específico todavía** |
| **P1: cierre de caja ausente** | Solo existe `payment_methods` tipo `cash` ([`0004_reference_catalog.up.sql:87-107`](../../database/migrations/0004_reference_catalog.up.sql#L87-L107)); no hay tablas de caja en `0001–0012`; la suite P0 lo marca BLOQ-P1 ([`_data/validation-p0-sell-flow-0012.txt`](_data/validation-p0-sell-flow-0012.txt)) | No se puede cuadrar el efectivo por turno, detectar faltantes/sobrantes ni cerrar la operación diaria de la sede | P1 no puede declararse cerrado; cualquier reporte de caja queda bloqueado | Brecha registrada en [`_data/contracts/README.md:80`](_data/contracts/README.md#L80); las tablas históricas están descritas en [`data-migration-runbook.md:90`](data-migration-runbook.md#L90) |
| **P0/P1: la prueba P0 de `customer_id` es superficial** | La comprobación consulta `information_schema.columns` y marca PASS si la columna existe ([`tools/database/validate_p0_sell_flow.py:231-232`](../../tools/database/validate_p0_sell_flow.py#L231-L232)) | Un DDL que agregue la columna pero no la use podría “cerrar” P0 sin demostrar atribución real | La aceptación P0 debe ampliarse antes de confiar en el resultado | Este documento, §4.4 |

**Impacto combinado:** la venta actual puede registrar productos, cantidades y pagos, pero no puede responder “¿a qué cliente se vendió?” ni “¿en qué turno de caja se cobró?”. Esas dos preguntas son requisito de P0/P1 y explican por qué el resultado global es **PARCIAL**, no **PASS**.

---

## 4. Plan de validación priorizado

### 4.1 Precondiciones

- Ejecutar solo contra **DEV** o una base desechable creada por el propio validador. **Nunca PROD** mientras el usuario no sea de solo lectura.
- Cargar las credenciales desde `.env.database.local` o variables de entorno; no escribirlas en comandos, documentos ni evidencia.
- Usar siempre un rol `NOBYPASSRLS` para las pruebas de aislamiento; el owner con `BYPASSRLS` produce falsos PASS ([`_data/portability-audit-0012-2026-11-09.md:41`](_data/portability-audit-0012-2026-11-09.md#L41)).
- Datos exclusivamente sintéticos: dos tenants, UUID sintéticos, dominios `.example.test`.
- **Esta tarea no ejecutó los validadores.** Los que crean base temporal aplican las migraciones y hacen `CREATE DATABASE`/`DROP DATABASE`; requieren autorización explícita del owner.

### 4.2 Secuencia

| Fase | Objetivo | Suite / comando | Criterio de salida |
|---:|---|---|---|
| **0. Estático** | Integridad documental y de scripts | `python3 tools/database/check_no_secrets.py`; `python3 tools/database/validate_sql_basic.py`; `python3 -m py_compile tools/database/*.py` | 0 secretos, 7/7 SQL sin errores básicos, compilación OK |
| **1. P0** | Venta end-to-end y aislamiento | `python3 tools/database/validate_p0_sell_flow.py` | 0 FAIL y 0 BLOQ-P0; con `customer_id`, la prueba ampliada debe insertar y leer una venta con cliente |
| **2. P1 negocio** | Compras, CxP, cartera, apartados, auditoría, jobs | `python3 tools/database/validate_business_disposable.py --env DEV --connections-file .env.database.local --evidence docs/database-portability/_data/validation-p1-0012-2026-11-09.txt` | 0 FAIL; BLOQ solo los justificados en §5; conciliaciones con 0 descuadres |
| **3. P1 paginación** | Listados P1 y planes | `python3 tools/database/validate_pagination_perf.py --env DEV --connections-file .env.database.local --evidence docs/database-portability/_data/validation-p1-pagination-0012-2026-11-09.txt` | 130 filas ×9 listados sin duplicados/omisiones; `EXPLAIN` usa índices esperados |
| **4. Roles y esquema** | Aislamiento y privilegios | `python3 tools/database/validate_runtime_roles.py`; `python3 tools/database/validate_portable_schema.py --env DEV all` | API/auth `NOBYPASSRLS`; 0 huérfanos; 0 funciones con `auth.*` |
| **5. Ledger** | Control de migraciones | `python3 tools/database/verify_migration_checksums.py --directory database/migrations`; `python3 tools/database/test_ledger_contract.py` | Versiones consecutivas, checksums exactos, `dirty=false`, duplicado rechazado |
| **6. Read-only** | Inspección segura | `python3 tools/database/run_readonly_sql.py --env DEV` | 7/7 scripts OK en transacción read-only |
| **7. P2** | Solo si hay implementación | Suite nueva del dominio correspondiente | Si no hay tablas/implementación: **BLOQ-P2** documentado, sin bloquear P0/P1 |

### 4.3 Comandos de referencia

```bash
# Estático (no requiere base)
python3 tools/database/check_no_secrets.py
python3 tools/database/validate_sql_basic.py
python3 -m py_compile tools/database/*.py

# P0 (crea base desechable y aplica 0001–0012)
python3 tools/database/validate_p0_sell_flow.py

# P1 negocio y paginación (crean base desechable)
python3 tools/database/validate_business_disposable.py \
  --env DEV --connections-file .env.database.local \
  --evidence docs/database-portability/_data/validation-p1-0012-2026-11-09.txt

python3 tools/database/validate_pagination_perf.py \
  --env DEV --connections-file .env.database.local \
  --evidence docs/database-portability/_data/validation-p1-pagination-0012-2026-11-09.txt

# Roles, esquema, ledger y solo lectura
python3 tools/database/validate_runtime_roles.py
python3 tools/database/validate_portable_schema.py --env DEV all
python3 tools/database/verify_migration_checksums.py --directory database/migrations
python3 tools/database/test_ledger_contract.py
python3 tools/database/run_readonly_sql.py --env DEV
```

> Los scripts que crean base desechable **no son solo lectura**: crean y eliminan una base temporal y aplican migraciones. No ejecutarlos sin autorización; `--env DEV` es el único entorno permitido.

### 4.4 Criterios de aceptación

**P0**

1. 0 `FAIL` y 0 `BLOQ-P0`.
2. Insertar una venta con `customer_id` de A y leerla de vuelta con `customer_id` correcto.
3. Insertar una venta de A con `customer_id` de B: debe fallar (`23503`/`42501`).
4. La venta sigue cuadrando: `total = subtotal + tax_total - discount_total`, `total = líneas`, `total = pagos`.
5. Aislamiento A/B: A no ve productos, ventas ni clientes de B; sin contexto no ve filas.

**P1**

1. 0 `FAIL`; los `BLOQ` deben ser solo los de §5 y con objeto exacto citado.
2. Cada capacidad P1 tiene al menos **una prueba positiva y una negativa**: compras/proveedor, CxP/pago, cartera/movimiento, apartado/abono, auditoría/aislamiento, jobs/claim, caja/apertura-cierre.
3. Conciliaciones con 0 descuadres: ventas, compras, CxP, cartera, inventario y apartados.
4. Cierre de caja: sesión abierta, ventas en efectivo, cierre con diferencia y rechazo de movimientos posteriores.
5. Jobs: dos workers no ejecutan el mismo job; la misma clave de idempotencia no crea duplicados.
6. Reportes: valores esperados calculados por la siembra coinciden con la consulta de referencia.

**P2**

1. No se declara PASS por una tabla vacía ni por un `CHECK` que admita un valor.
2. Solo se valida si existe migración + caso de uso + contrato.
3. Si no existe: `BLOQ-P2` con la lista de objetos ausentes y el prerrequisito P0/P1; no se marca como fallo del producto mínimo.

**Regla de evidencia**

- `PASS` exige comando reproducible y salida observada.
- `FAIL` exige SQLSTATE o descuadre reproducible.
- `BLOQ` exige nombrar el objeto ausente y el archivo donde debería estar; no se convierte en PASS por renombrar la prueba.
- La evidencia se guarda saneada en `docs/database-portability/_data/`, sin URLs, hosts, roles de infraestructura ni PII.

---

## 5. Bloqueos reales

| Bloqueo | Tipo | Impacto | Desbloqueo |
|---|---|---|---|
| **N8 — `user_roles` no existe** | Nomenclatura / diseño de prueba | La suite marca BLOQ, pero el baseline portable sí tiene `membership_roles` ([`0002_identity.up.sql:72-82`](../../database/migrations/0002_identity.up.sql#L72-L82)) | **Reapuntar N8** a `membership_roles` con FK compuesta; no requiere tabla nueva. Es un bloqueo de prueba, no de producto |
| **N9 — `sale_line_batches` no existe** | Capacidad P1 | No hay trazabilidad lote↔línea de venta; afecta devoluciones y costeo por lote | Migración nueva del track Go o aceptar `BLOQ-P1` con decisión explícita |
| **N10 — `online_store_catalog` no existe** | P2 esperado | Ninguno para P0/P1 | No bloquea; se reevalúa cuando exista tienda online (BLOQ-P2) |
| **N16 — matview `stock_balances` no existe** | Diseño de prueba | La prueba histórica esperaba una matview; el baseline usa suma de `inventory_moves` ([`0006_inventory.up.sql:36-66`](../../database/migrations/0006_inventory.up.sql#L36-L66)) | **Rediseñar N16** como suma de movimientos; no crear la matview sin decisión de rendimiento |
| **N17 — `vw_sales_summary` no existe** | Diseño de prueba | El baseline no tiene vistas por diseño | **Rediseñar N17** como consulta de agregados con RLS; o crear la vista con `security_invoker` si se decide |
| **`fn_claim_async_jobs` / `fn_complete_async_job` no existen** | P1 | Los workers no pueden reclamar/completar jobs de forma concurrente y segura | Implementar el contrato de [`_data/contracts/reference_queries.sql:48-86`](_data/contracts/reference_queries.sql#L48-L86) o resolverlo en Go con la misma semántica (`FOR UPDATE SKIP LOCKED`, lease) |
| **PostgreSQL 15 real no probado** | Entorno | Las suites corrieron sobre PostgreSQL 18.6; Docker está bloqueado por permisos sobre el socket | Provisionar un PostgreSQL 15+ desechable (contenedor o servicio) y repetir el ciclo completo; documentar la versión observada |
| **Sin datos reales** | Datos | La reconciliación solo cubre datos sintéticos; no se validan volúmenes, cardinalidades ni casos históricos | Copia restaurada de DEV o dataset autorizado, tratado como solo lectura y saneado |
| **PROD sin usuario de solo lectura** | Política | No se puede analizar PROD; cualquier conexión sería un riesgo | Provisionar rol `SELECT` sin `CREATE`/`BYPASSRLS`; hasta entonces, PROD permanece bloqueado ([`README.md:8`](README.md#L8)) |
| **Owner con `BYPASSRLS`** | Seguridad / pruebas | Un owner que consulta sin rol aislado ve todos los tenants y produce falsos PASS | Usar siempre rol `NOBYPASSRLS`; el runtime no debe ser owner ([`_data/portability-audit-0012-2026-11-09.md:41`](_data/portability-audit-0012-2026-11-09.md#L41)) |
| **Deriva documental del README** | Documentación | El README describe el baseline como `0001–0003` y “migraciones de negocio posteriores no escritas” ([`README.md:8`](README.md#L8), [`README.md:14-16`](README.md#L14-L16)), mientras `0004–0012` existen y la suite usa 38 tablas | Actualización por el owner del README; **no se editó en esta tarea** |

---

## 6. Hallazgos, riesgos y próximos pasos

### 6.1 Hallazgos principales

1. **P1 tiene datos, pero poca semántica de ciclo de vida.** Compras, CxP, cartera y apartados validan sumas y reconciliación, no transiciones (recibir parcial, cancelar, convertir apartado, aplicar pago, cerrar caja).
2. **Cierre de caja es la brecha P1 dominante.** Sin `cash_sessions`/`cash_movements`, P1 no puede cerrarse aunque las demás suites pasen.
3. **Jobs sin claim no son operables.** `async_jobs` tiene el modelo y la unicidad, pero no el mecanismo de reclamo/lease seguro.
4. **Auditoría existe, pero no es inmutable.** `audit_log` tiene RLS y buenos índices; le falta garantía append-only y cobertura de eventos.
5. **No hay reportes persistidos.** Cero vistas/matviews en el baseline; los reportes son consultas que aún no tienen contrato ni valores esperados.
6. **P0 sigue parcial por atribución de cliente.** La prueba actual de `customer_id` es de existencia de columna, no de atribución real; debe endurecerse.
7. **P2 está completamente fuera del baseline portable.** Las tablas del corpus histórico no cuentan; no se debe crear DDL especulativo para “tener algo”.

### 6.2 Riesgos

- **Falso cierre de P0/P1:** aceptar PASS de agregados sin ciclo de vida ni pruebas negativas.
- **Deriva de saldos denormalizados:** `customer_credit_accounts.current_balance`, `layaway_contracts.paid_total/balance_due` y `supplier_payables.paid_amount` dependen de la aplicación; una transacción incompleta deja saldos inconsistentes.
- **Auditoría mutable:** si el rol de runtime recibe `UPDATE`/`DELETE`, se pierde la garantía de trazabilidad.
- **Doble ejecución de jobs:** sin claim/lease, dos workers pueden procesar el mismo job.
- **Fuga por owner con `BYPASSRLS`:** pruebas y operación con el owner invalidan RLS.
- **Compatibilidad PG15 no demostrada:** el baseline declara PostgreSQL ≥ 15, pero solo se ejecutó en 18.6.
- **Confusión legacy ↔ portable:** citar tablas de `shared/supabase/migrations` como si existieran en `0001–0012` infla el alcance y oculta brechas reales.
- **Alcance P2 prematuro:** diseñar tienda/manufactura antes de cerrar P0/P1 multiplica retrabajo.

### 6.3 Próximos pasos priorizados

1. **P0:** agregar `sales.customer_id` en una migración del track Go y ampliar `validate_p0_sell_flow.py` para insertar/leer una venta con cliente y probar FK cross-tenant.
2. **P1 caja:** definir y migrar caja (registro, sesión, movimientos, asignación) y su prueba de apertura/cierre/diferencia.
3. **P1 jobs:** implementar claim/complete con lease y probar concurrencia e idempotencia.
4. **P1 ciclo de vida:** añadir pruebas de recepción parcial, cancelación, conversión de apartado, aging y sobrepago.
5. **Reapuntar pruebas obsoletas:** N8 → `membership_roles`; N16/N17 → consultas de agregados; documentar N9 como brecha P1 real.
6. **Contratos de reportes:** definir consultas de referencia y valores esperados antes de optimizar.
7. **P2:** solo después de P0/P1; mantener `BLOQ-P2` y no crear tablas sin caso de uso.
8. **Documentación:** actualizar README y tabla de estado del plan por el owner; esta tarea no los modifica.

---

## Apéndice A — Evidencia de conteo

Comandos usados (solo lectura):

```bash
grep -n "CREATE TABLE public" database/migrations/*.up.sql   # 38 tablas
grep -cE "CREATE( OR REPLACE)? (MATERIALIZED )?VIEW" database/migrations/*.up.sql  # 0 vistas
grep -rniE "cash_sessions|cash_movements|cash_registers" database/migrations/*.up.sql  # sin tablas de caja
grep -rniE "online_store|bom|manufactur|offline|realtime|notification|storage|media" database/migrations/*.up.sql  # solo valores de CHECK, sin tablas P2
```

Las tablas P2 citadas en §2 provienen del corpus histórico y se enlazan a los documentos que las describen, no a `database/migrations/0001–0012`.


---

## Actualización — suite P1 ejecutada (2026-11-09)

`tools/database/validate_p1_lifecycle.py` en base desechable: **8 PASS, 0 FAIL, 1 BLOQ-P1, 2 HALLAZGOS**.

- PASS: recepción parcial 4/10 y cierre 10/10, rechazo de sobre-recepción y estado inválido, abono 40/saldo 60, cierre de apartado, rechazo de sobrepago del contrato, aging CxP 0–30=50 y 31–60=70.
- **HALLAZGO:** `received → draft` se acepta (no hay guard de transiciones).
- **HALLAZGO:** un pago de CxP puede exceder el saldo (no hay control agregado pagos vs original).
- **BLOQ-P1:** no existe enlace apartado→venta (columna/FK o tabla de conversión).
- Evidencia: [`_data/validation-p1-lifecycle-0012.txt`](_data/validation-p1-lifecycle-0012.txt).

- **Propuestas de cierre (validadas):** ADR-009 (transiciones de compra, sobrepago CxP con sincronización, apartado→venta) y ADR-010 (auditoría append-only) → [`_data/validation-p1-guards-proposal.txt`](_data/validation-p1-guards-proposal.txt) PASS. Siguen pendientes de aprobación e implementación en `database/migrations`.
