# Matriz de migración de RPCs y funciones SQL

- **Fecha:** 2026-11-08
- **Tarea:** #5 de [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md)
- **Estado:** completada (análisis estático); sin ejecución contra DEV/PROD
- **Entregable:** este documento
- **Insumos:** [`_data/listings-and-rpcs.md`](_data/listings-and-rpcs.md) (inventario de 265 firmas), [`schema-inventory.md`](schema-inventory.md), [`supabase-dependencies.md`](supabase-dependencies.md), [`rpc-characterization-matrix.md`](rpc-characterization-matrix.md), [`baseline-proposal.md`](baseline-proposal.md)
- **Artefactos de evidencia:** [`_data/sql-functions.json`](_data/sql-functions.json), [`_data/query-sites.json`](_data/query-sites.json)
- **Fuente canónica del esquema:** [`shared/supabase/migrations/`](../../shared/supabase/migrations/) (161 archivos), ampliada con los archivos propios de [`web/migrations/`](../../web/migrations/) y [`mobile/migrations/`](../../mobile/migrations/)

> **Regla de lectura.** Todo conteo es de **sentencias en archivos**, no del esquema desplegado. DEV está vacía y PROD está bloqueado por política (el usuario no es de solo lectura), por lo que **no hay validación en base**. Donde el análisis estático no alcanza se escribe **«a verificar»**. No se repitieron conexiones ni se ejecutó SQL.

---

## 1. Resumen ejecutivo

| Métrica | Valor | Fuente |
|---|---:|---|
| Sentencias `CREATE [OR REPLACE] FUNCTION` en los tres directorios | 363 | [`listings-and-rpcs.md` §B.1](_data/listings-and-rpcs.md) |
| Firmas únicas (nombre + parámetros) clasificadas aquí | **265** | ídem |
| Nombres únicos de función | 256 | ídem |
| Nombres con más de una definición | 60 | ídem |
| Definiciones `SECURITY DEFINER` | 160 | ídem |
| `SECURITY DEFINER` sin `search_path` fijo | 61 | ídem |
| Funciones que leen `auth.uid()` / `auth.jwt()` | 57 | ídem |
| Funciones trigger (`RETURNS trigger`) | 57 | ídem |
| Universo canónico solo (`shared/`): funciones / definiciones | 211 / 298 | [`schema-inventory.md` §7](schema-inventory.md) |

**Hallazgos que condicionan la migración**

1. **La lógica crítica vive en SQL, no en la API.** Venta, stock, layaway, compras y contabilidad son funciones `plpgsql` que mezclan validación, autorización, numeración, efectos multi-tabla y consumo de lotes. No se pueden «mover a Go» leyendo solo las firmas: hay que congelar una definición consolidada por firma (60 nombres están redefinidos y el orden de migración no es verificable).
2. **El modelo de stock está duplicado.** Conviven `stock_balances` (tabla → vista materializada), `inventory_moves` (ledger) y `inventory_batches` (lotes con `on_hand`/`reserved`). `fn_apply_stock_delta` escribe lotes, pero la venta base también escribe `inventory_moves` y valida contra un agregado. Es la mayor fuente de doble aplicación ([§5.4](#54-stock-fn_apply_stock_delta-y-familia-fefo)).
3. **La idempotencia existente es parcial y global.** `sp_create_sale_idempotent` usa `operation_id` como **PK global** sin `tenant_id` ni hash de payload ([`mobile/ADD_IDEMPOTENT_MOBILE_SALES.sql:15-16`](../../mobile/migrations/ADD_IDEMPOTENT_MOBILE_SALES.sql#L15-L16)); puede devolver el `sale_id` de otro tenant y no distingue reintento de payload alterado.
4. **`SECURITY DEFINER` se usa como sustituto de autorización.** 61 definiciones no fijan `search_path` y 57 leen claims de Supabase. Tres funciones contables dependen de `auth.uid()`/`auth.jwt()` y dos de ellas devuelven errores de negocio como JSON con `success:false`, no como excepción: el adaptador Go no puede tratar «HTTP 200» como éxito.
5. **Las colas son PostgreSQL estándar con semántica incompleta.** `fn_claim_async_jobs` sí usa `FOR UPDATE SKIP LOCKED` ([`shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql:219-249`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L219-L249)), pero `fn_complete_async_job` y `fn_fail_async_job` no validan `locked_by` ni el lease: un worker tardío puede cerrar trabajo reasignado.
6. **Los dispatchers de notificación no son portables.** `fn_push_dispatcher_cron` usa `pg_cron` + `net.http_post` + Vault; debe desaparecer como función y convertirse en worker Go.
7. **La importación masiva no tiene RPC.** El «bulk import» son las tablas `bulk_imports`/`bulk_import_errors` ([`shared/supabase/migrations/CREATE_BULK_IMPORT_TRACKING.sql:8-33`](../../shared/supabase/migrations/CREATE_BULK_IMPORT_TRACKING.sql#L8-L33)), un trigger sobre `storage.objects` y un trigger de email. No hay nada que portar como función; hay que portar el flujo.

---

## 2. Criterios de clasificación

Cada firma recibe **una** clase. La clase describe el destino de la **primitiva SQL**, no del endpoint HTTP.

| Clase | Significado | Criterio de decisión | Consecuencia en el baseline |
|---|---|---|---|
| **M** | Mantener como función/vista PostgreSQL | Lógica set-based o de cálculo que se ejecuta mejor junto a los datos; lectura agregada; helper interno invocado por otras funciones SQL; sin identidad ni efectos externos | Se conserva con `SECURITY INVOKER`, `search_path` fijo y sin `auth.*`. Go la invoca con SQL parametrizado |
| **G** | Trasladar a caso de uso Go | Lógica de negocio pura, autorización, orquestación multi-repositorio, CRUD simple, formateo, plantillas, reglas de fecha | La función se elimina del esquema; Go la implementa con pruebas unitarias |
| **X** | Dividir: primitiva SQL transaccional + lógica Go | Hay que preservar atomicidad, locks o unicidad, pero la decisión y la autorización son de aplicación | Se conserva **una** primitiva estrecha (INSERT/UPDATE/claim/consumo) y Go abre la transacción, valida y orquesta |
| **E** | Eliminar por obsolescencia | Duplicado superado, helper de RLS, diagnóstico, dispatcher de plataforma, SQL dinámico peligroso o identidad de Supabase | No se recrea. Si un consumidor la usa, se sustituye por consulta explícita o caso de uso |
| **T** | Trigger (no es RPC) | `RETURNS trigger`; se ejecuta por efecto de una escritura | Se decide por tabla: conservar en SQL, convertir en `CHECK`, o retirar y mover el efecto a Go **sin duplicarlo** |

**Reglas aplicadas**

1. **Una firma, una clase.** Las variantes del mismo nombre se clasifican por separado y se marca cuál se conserva. No se elige por orden alfabético de archivo.
2. **`SECURITY DEFINER` no implica M.** Se conserva solo si la primitiva es imprescindible y se reescribe con `SET search_path = pg_catalog, public`,Owner explícito y `GRANT` mínimo. En el baseline portable la autorización es de Go.
3. **Una función de solo lectura no se convierte en RPC.** Se clasifica M como vista/función y Go la consulta; el endpoint no expone SQL.
4. **E exige verificación de consumidores.** «Sin consumidor estático» no prueba que no la invoque un trigger o cron; se marca «a verificar» antes de borrar.
5. **Los efectos externos nunca quedan en SQL.** Email, push, pagos, storage y IA salen por outbox y workers Go; la transacción solo escribe la intención.

**Prioridad de migración** (se detalla en [§7](#7-prioridad-de-migración))

| Nivel | Alcance | Criterio |
|---|---|---|
| **P0** | Venta, devolución, stock, layaway, compras, contabilidad, colas | Dinero o inventario; un error duplica o pierde saldo |
| **P1** | Cartera, outbox de notificaciones, manufactura, tienda online | Efectos externos o estados irreversibles |
| **P2** | Alertas, identidad, facturación SaaS, importación masiva | Mantenimiento y provisión; riesgo acotado |
| **P3** | Reportes, telemetría IA, utilities, triggers `updated_at` | Sin efecto transaccional crítico |

---

## 3. Universo y discrepancias de conteo

| Universo | Funciones | Definiciones | Uso en este documento |
|---|---:|---:|---|
| Canónico `shared/supabase/migrations/` | 211 | 298 | Referencia de esquema ([`schema-inventory.md` §7](schema-inventory.md)) |
| Canónico + extras `web/` + `mobile/` | 256 | 363 | **Base de la clasificación** (265 firmas) |

La diferencia no es un error de conteo: `web/` aporta 34 funciones (módulo contable, superadmin, reportes) y `mobile/` aporta 31 (push, notificaciones in-app, media), mientras faltan 11 archivos de `shared/` en cada copia ([`schema-inventory.md` §12.6](schema-inventory.md)). La matriz usa **265 firmas** porque el backend Go deberá cubrir también esas funciones; el baseline debe decidir primero cuál directorio es la verdad ([`baseline-proposal.md`](baseline-proposal.md)).

**Duplicados que la clasificación resuelve** (no se conservan dos versiones):

| Nombre | Defs | Firmas | Decisión de esta matriz |
|---|---:|---:|---|
| `fn_create_online_manual_order` | 8 | 4 | Una sola firma; el resto **E** |
| `sp_create_sale` | 7 | 2 | Una firma con `p_third_party`/`p_sold_at`; resto **E** |
| `sp_create_purchase` | 5 | 1 | Una definición; resto **E** |
| `sp_create_layaway` | 4 | 1 | Una definición; resto **E** |
| `fn_online_store_create_sale` | 4 | 1 | Una definición; resto **E** |
| `sp_create_sale_idempotent` | 3 | 2 | Una firma con `p_sold_at`; resto **E** |
| `fn_generate_batch_number` | 4 | 2 | Firma con `p_location`; la de 3 args **E** |
| `fn_update_credit_balance` | 1 | 1 | Se conserva primitiva, se le añade tenant en Go |

> **A verificar:** la versión realmente desplegada de cada nombre. Sin `schema_migrations` ordenado ni introspección de `pg_proc`, «última aparición textual» no equivale a «vigente».

---

## 4. Tabla maestra de clasificación (265 firmas)

Columnas: `#` = índice del inventario en [`_data/listings-and-rpcs.md` §B.2–B.3](_data/listings-and-rpcs.md) (trazabilidad); `Clase` según [§2](#2-criterios-de-clasificación); `Destino` = qué se conserva, se mueve o se elimina.

### 4.1 Ventas y caja (32 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 1 | `fn_apply_rounding(p_tenant, p_amount)` | M | Redondeo por configuración de tenant; helper determinista que la primitiva de venta necesita. Replicar en Go con la misma tabla de casos |
| 2 | `fn_calculate_discount(p_subtotal, p_discount_value, p_discount_type)` | G | Regla pura de descuento; dominio Go con pruebas de borde |
| 3 | `fn_calculate_price(p_tenant, p_variant, p_cost, p_location)` | X | Lee política de precios (SQL) y decide precio (Go) |
| 4 | `fn_calculate_sale_price(p_tenant, p_variant, p_cost)` | G | Cálculo puro; solapa con #3, consolidar en Go |
| 5 | `fn_calculate_tax_breakdown(p_price, p_tax_rate, p_includes_tax)` | G | Desglose de impuesto puro; mismo algoritmo en Go |
| 6 | `fn_get_open_cash_session_for_user(p_tenant, p_user)` | G | Consulta + `auth.uid()`; pasa a contexto de sesión |
| 7 | `fn_get_pricing_policy(p_tenant, p_variant, p_location)` | M | Lectura de configuración de precios; vista consultada por Go |
| 8 | `fn_get_sale_warnings(p_tenant, p_sale_id)` | M | Lectura agregada para el POS; vista |
| 9 | `fn_get_sales_forecast_data(p_tenant_id, p_location_id, p_days_back)` | M | Reporte set-based; más barato en SQL |
| 10 | `fn_get_tax_info_for_variant(p_tenant, p_variant)` | M | Helper de lectura usado dentro de la venta |
| 11 | `fn_get_tax_rate_for_variant(p_tenant, p_variant)` | M | Helper de lectura usado dentro de la venta |
| 12 | `fn_next_sale_number(p_tenant, p_location)` | X | Contador atómico `INSERT … ON CONFLICT` + `UPDATE … RETURNING`; Go lo invoca dentro de su transacción |
| 13 | `fn_online_store_create_sale(...)` | X | Venta pública con SQL dinámico; una firma, autorización por token en Go |
| 14 | `fn_pos_home_context(p_tenant, p_user)` | G | Compone caja, alertas y permisos; caso de uso Go con varias consultas |
| 15 | `fn_user_can_use_cash_register(p_tenant, p_user, p_cash_register)` | G | Autorización de aplicación |
| 16 | `fn_user_is_cashier(p_user_id)` | G | Autorización; deja de usarse en RLS |
| 17 | `get_cash_movements_by_role(...)` | E | Variante legacy por rol, dependiente de `auth.uid()`/RLS, sin consumidor estático |
| 18 | `get_sale_lines_by_role(...)` | E | Ídem; sustituida por consulta con filtro explícito |
| 19 | `get_sale_payments_by_role(...)` | E | Ídem |
| 20 | `get_sales_by_role(...)` | E | Ídem |
| 21 | `is_user_cashier()` | E | Helper de políticas RLS; se retira con ellas |
| 22 | `sp_assign_cash_register_to_user(...)` | G | CRUD administrativo de sedes |
| 23 | `sp_close_cash_session(...)` | E | Superada por la variante `_secure` (#24) |
| 24 | `sp_close_cash_session_secure(...)` | X | Arqueo/descuadre atómico; primitiva + autorización Go |
| 25 | `sp_create_return(...)` | X | Reposición + reembolso en una transacción; Go orquesta y valida acumulado |
| 26 | `sp_create_return_v2(...)` | X | Valida reembolsos contra total; **fusionar** con #25 en un caso de uso |
| 27 | `sp_create_sale(...)` (8 args) | X | Núcleo transaccional; se conserva **una** primitiva consolidada |
| 28 | `sp_create_sale(..., p_third_party)` | X | Variante FE/tercero; se absorbe en la consolidada |
| 29 | `sp_create_sale_idempotent(...)` | X | Idempotencia en SQL con `UNIQUE (tenant_id, operation_id)`; Go decide clave y hash |
| 30 | `sp_create_sale_idempotent(..., p_sold_at)` | X | Variante con fecha manual; se absorbe en #29 |
| 31 | `sp_open_cash_session(...)` | G | Validación de asignación + insert; caso de uso Go |
| 32 | `trg_pricing_rules_updated_at()` | T | Trigger `updated_at`; conservar en SQL |

### 4.2 Compras y proveedores (12 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 33 | `fn_get_purchase_suggestions(p_tenant_id, p_min_priority, p_limit)` | M | Reporte de reposición; vista SQL |
| 34 | `fn_refresh_supplier_payable_alerts()` | X | Worker: `SET`-based + planificación Go |
| 35 | `sp_create_manual_purchase_ingress(...)` | E | Duplica compra de una línea; consolidar en #36 |
| 36 | `sp_create_purchase(...)` | X | Compra + lote/movimiento; primitiva + Go |
| 37 | `sp_create_purchase_order(...)` | G | Cabecera/líneas sin stock; caso de uso |
| 38 | `sp_create_purchase_return(...)` | X | Devolución con salida de stock; falta lock del acumulado |
| 39 | `sp_create_supplier_payable(...)` | X | `UNIQUE (tenant_id, purchase_id)`; Go resuelve el conflicto como idempotencia |
| 40 | `sp_get_supplier_payables_dashboard(...)` | M | Lectura agregada por estado/vencimiento |
| 41 | `sp_receive_purchase_order(...)` | X | Recepción total; wrapper de #42 |
| 42 | `sp_receive_purchase_order_partial(...)` | X | Lock de cabecera; primitiva de recepción |
| 43 | `sp_register_supplier_payment(...)` | X | Lock + saldo + estado; primitiva + Go |
| 44 | `trg_refresh_supplier_payable_alerts()` | T | Trigger de alertas; decidir en §6.1 |

### 4.3 Cartera y crédito (3 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 45 | `fn_refresh_customer_receivable_alerts(p_tenant)` | X | Recalculo set-based; worker con tenant explícito |
| 46 | `fn_update_credit_balance(p_credit_account_id, p_delta)` | X | Incremento atómico; Go debe filtrar tenant y registrar movimiento en la misma tx |
| 47 | `trg_refresh_customer_receivable_alerts()` | T | Trigger de alertas de cartera |

### 4.4 Layaway / separados (8 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 48 | `fn_expire_due_layaways(p_tenant, p_actor)` | X | Job de vencidos; set-based + worker Go |
| 49 | `fn_recalc_layaway_totals(p_tenant, p_layaway)` | M | Derivar totales dentro de la tx; una sola fuente de verdad |
| 50 | `fn_refresh_layaway_alerts()` | X | Recalculo de alertas; worker |
| 51 | `sp_add_layaway_payment(...)` | X | Lock de contrato ACTIVE + pago + recálculo |
| 52 | `sp_cancel_layaway(...)` | X | Cancela/expira y libera reserva bajo lock |
| 53 | `sp_complete_layaway_to_sale(...)` | X | Convierte a venta; consume stock y arrastra pagos |
| 54 | `sp_create_layaway(...)` | X | Contrato + items + reserva; una firma consolidada |
| 55 | `trg_layaway_contracts_alert()` | T | Trigger de alertas |

### 4.5 Importación masiva (2 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 56 | `fn_set_dataimport_tenant_metadata()` | E | Trigger sobre `storage.objects`; no portable. Sustituido por autorización de subida en Go |
| 57 | `trg_enqueue_bulk_import_email()` | T | Trigger de outbox; se recrea sin `storage` |

> No existe RPC de importación: el flujo son las tablas `bulk_imports`/`bulk_import_errors` y el procesamiento que hoy hace el cliente/Edge. Se documenta en [§5.9](#59-importación-masiva-bulk_imports).

### 4.6 Inventario y producción (58 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 58 | `fn_allocate_fefo_for_component(...)` | M | Asignación FEFO por componente; SQL con locks |
| 59 | `fn_allocate_stock_fefo(...)` | M | Asignación FEFO con `SKIP LOCKED`; primitiva de lectura con lock |
| 60 | `fn_apply_stock_delta(p_tenant, p_location, p_variant, p_delta)` | X | Primitiva de stock; consolidar modelo y quitar exposición directa |
| 61 | `fn_apply_stock_reservation_delta(...)` | M | Ajuste de `reserved` bajo lock; primitiva interna |
| 62 | `fn_calculate_bom_cost(...)` | M | Costo de BOM; cálculo set-based |
| 63 | `fn_complete_production(...)` | X | Cierre de orden + consumo + lote; primitiva + Go |
| 64 | `fn_consume_batch_stock(...)` | M | Consumo de lote con `FOR UPDATE`; primitiva interna |
| 65 | `fn_consume_bom_components(...)` | X | Consumo multi-componente; primitiva transaccional |
| 66 | `fn_create_batch(...)` | M | Alta de lote; primitiva interna |
| 67 | `fn_create_default_variant(...)` | M | Helper de alta; se mantiene como primitiva de provisión |
| 68 | `fn_create_production_order(...)` | G | Validaciones + insert sin stock; caso de uso |
| 69 | `fn_detect_bom_circular_reference(p_bom)` | M | CTE recursiva; mejor en SQL |
| 70 | `fn_expiration_report(...)` | M | Reporte de vencimientos; vista |
| 71 | `fn_explode_bundle(...)` | M | Expansión de bundle; helper interno |
| 72 | `fn_generate_batch_number(..., p_location, ...)` | X | Numeración por sede; contador atómico |
| 73 | `fn_generate_batch_number(..., sin location)` | E | Variante sin sede; unificar en #72 |
| 74 | `fn_generate_production_inventory()` | T | Trigger de inventario de producción |
| 75 | `fn_get_active_bom(p_tenant, p_variant)` | M | Lectura de BOM activa |
| 76 | `fn_get_bom_explosion(...)` | M | Explosión recursiva de BOM |
| 77 | `fn_get_default_variant(p_tenant_id, p_product_id)` | M | Helper de lectura |
| 78 | `fn_get_effective_inventory_behavior(...)` | M | Resolución de configuración; usado por otras funciones SQL |
| 79 | `fn_get_effective_is_component(...)` | M | Ídem |
| 80 | `fn_get_effective_production_type(...)` | M | Ídem |
| 81 | `fn_get_expiration_config(...)` | M | Lectura de configuración de vencimiento |
| 82 | `fn_get_variant_manufacturing_info(...)` | M | Lectura agregada de manufactura |
| 83 | `fn_log_stock_alert(...)` | E | Log legacy de stock mínimo; sustituido por `system_alerts` |
| 84 | `fn_next_production_order_number(...)` | X | Contador atómico |
| 85 | `fn_refresh_expiration_alerts()` | X | Recalculo; worker |
| 86 | `fn_refresh_stock_alerts()` | X | Recalculo `SET`-based; worker |
| 87 | `fn_refresh_stock_balances(p_concurrent)` | X | `REFRESH MATERIALIZED VIEW` o vista; nunca para decidir stock |
| 88 | `fn_release_batch_reservation(...)` | M | Libera reserva con lock |
| 89 | `fn_reserve_batch_stock(...)` | M | Reserva con lock |
| 90 | `fn_start_production(p_production_order, p_started_by)` | G | Transición de estado |
| 91 | `fn_update_average_cost(...)` | T | Trigger de costo promedio |
| 92 | `fn_update_min_stock(p_tenant, p_variant, p_min_stock)` | G | Update acotado; caso de uso |
| 93 | `fn_validate_bom_availability(...)` | M | Validación de disponibilidad previa a consumir |
| 94 | `fn_validate_bom_depth(...)` | M | Validación recursiva |
| 95 | `fn_validate_bundle_availability(...)` | M | Ídem para bundles |
| 96 | `fn_variant_requires_expiration(...)` | M | Regla de vencimiento por variante |
| 97 | `generate_production_order_number()` | T | Trigger de numeración |
| 98 | `sp_create_inventory_adjustment(...)` | X | Ajuste + movimiento; primitiva + Go |
| 99 | `sp_create_transfer_request(...)` | G | Solicitud sin movimiento de stock |
| 100 | `sp_receive_transfer_request(...)` | X | Recepción con entrada/salida y diferencias |
| 101 | `sync_bom_component_quantity()` | T | Sincronización de cantidades |
| 102 | `sync_bom_name_code()` | T | Normalización de nombre/código |
| 103 | `sync_production_line_quantity()` | T | Sincronización de líneas |
| 104 | `sync_production_order_audit_dates()` | T | Fechas de auditoría |
| 105 | `sync_production_order_dates()` | T | Fechas de orden |
| 106 | `trg_auto_create_default_variant_fn()` | T | Alta automática de variante |
| 107 | `trg_product_variants_alert()` | T | Alerta por variante |
| 108 | `trg_refresh_expiration_alerts()` | T | Alerta por lote |
| 109 | `trg_refresh_stock_after_batch_change()` | T | Refresco tras cambio de lote |
| 110 | `trg_stock_balances_alert()` | E | Trigger sobre `stock_balances`, que pasó a **matview**: inviable tal cual |
| 111 | `trg_update_average_cost()` | T | Costo promedio |
| 112 | `trg_update_batch_timestamp()` | T | `updated_at` |
| 113 | `trg_validate_batch_expiration()` | T | Validación de vencimiento; evaluar `CHECK` |
| 114 | `trg_validate_bom_on_save()` | T | Validación de BOM |
| 115 | `trg_validate_expiration_config()` | T | Validación de configuración |

### 4.7 Contabilidad (18 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 116 | `fn_accounting_close_period(...)` | X | Cierre con validación de asientos; primitiva + autorización Go |
| 117 | `fn_accounting_enqueue_event(...)` | X | Outbox contable con `UNIQUE` por tenant; primitiva de inserción |
| 118 | `fn_accounting_get_withholding_summary(...)` | M | Lectura agregada de retenciones |
| 119 | `fn_accounting_is_period_closed(...)` | M | Predicado usado por posteo |
| 120 | `fn_accounting_is_period_open(...)` | M | Predicado usado por posteo |
| 121 | `fn_accounting_open_period(...)` | X | Unicidad de periodo; primitiva + Go |
| 122 | `fn_accounting_post_entry(...)` | X | Posteo DRAFT→POSTED bajo lock; primitiva + Go |
| 123 | `fn_accounting_process_queue(...)` | X | Worker de cola; primitiva set-based + planificador Go |
| 124 | `fn_accounting_process_queue_all_tenants(...)` | X | Ídem multi-tenant; solo rol de worker |
| 125 | `fn_accounting_reopen_period(...)` | X | Reapertura con validación de asientos posteados |
| 126 | `fn_accounting_seed_chart_for_tenant(...)` | G | Provisión de catálogo; caso de uso |
| 127 | `fn_accounting_seed_competitive_defaults_new_tenant()` | G | Provisión inicial; caso de uso o trigger de tenant |
| 128 | `fn_accounting_summary(p_tenant_id)` | M | Lectura agregada |
| 129 | `fn_accounting_trg_purchases_enqueue()` | T | Encolado de compra |
| 130 | `fn_accounting_trg_sales_enqueue()` | T | Encolado de venta |
| 131 | `fn_accounting_trg_seed_chart_new_tenant()` | T | Provisión de catálogo por tenant |
| 132 | `fn_accounting_trial_balance(...)` | M | Balance de comprobación |
| 133 | `fn_billing_period_end(...)` | G | Aritmética de fechas; Go |

### 4.8 Notificaciones y outbox (31 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 134 | `fn_claim_online_order_email_notification(...)` | X | Claim atómico sobre `online_orders` con `FOR UPDATE`; primitiva |
| 135 | `fn_complete_online_order_email_notification(...)` | X | Marca enviado; primitiva |
| 136 | `fn_deactivate_my_push_device(p_expo_push_token)` | G | CRUD del usuario |
| 137 | `fn_deactivate_my_push_device(p_push_token, p_push_provider)` | G | Variante; consolidar |
| 138 | `fn_email_base_html(...)` | G | Plantilla HTML; Go |
| 139 | `fn_emit_notification_event(...)` | X | Inserta evento + notificación in-app con dedupe |
| 140 | `fn_enqueue_email_notification(...)` | X | Outbox con `ON CONFLICT (channel, dedupe_key)`; primitiva |
| 141 | `fn_enqueue_push_for_notification()` | X | Encola push desde notificación; worker |
| 142 | `fn_enqueue_subscription_status_emails(...)` | G | Decide correos de suscripción |
| 143 | `fn_list_my_notifications(...)` | G | Lectura + identidad de sesión |
| 144 | `fn_mark_all_notifications_read()` | G | Update del usuario |
| 145 | `fn_mark_notification_read(uuid)` | G | Update del usuario |
| 146 | `fn_normalize_email(text)` | G | Normalización; Go |
| 147 | `fn_notification_severity_rank(text)` | M | Orden de severidad usado en SQL |
| 148 | `fn_notify_from_system_alerts()` | X | Traducción alertas→notificaciones; worker |
| 149 | `fn_push_dispatcher_cron(int)` | E | `pg_cron` + `net.http_post` + Vault; pasa a worker Go |
| 150 | `fn_set_my_notification_pref(...)` | G | Preferencias del usuario |
| 151 | `fn_upsert_my_push_device(...)` (4 args) | G | Registro de token |
| 152 | `fn_upsert_my_push_device(...)` (7 args) | G | Variante; consolidar |
| 153 | `trg_enqueue_credit_movement_email()` | T | Outbox de crédito |
| 154 | `trg_enqueue_layaway_email()` | T | Outbox de separado |
| 155 | `trg_enqueue_layaway_payment_email()` | T | Outbox de pago |
| 156 | `trg_enqueue_online_order_email()` | T | Outbox de pedido |
| 157 | `trg_enqueue_operational_email()` | T | Outbox operativo |
| 158 | `trg_enqueue_sale_customer_email()` | T | Outbox de venta |
| 159 | `trg_enqueue_sale_return_email()` | T | Outbox de devolución |
| 160 | `trg_enqueue_subscription_email()` | T | Outbox de suscripción |
| 161 | `trg_enqueue_supplier_payable_email()` | T | Outbox de CxP |
| 162 | `trg_enqueue_user_created_email()` | T | Outbox de alta |
| 163 | `trg_touch_user_notification_prefs()` | T | `updated_at` |
| 164 | `trg_touch_user_push_devices()` | T | `updated_at` |

### 4.9 Identidad, tenancy y facturación SaaS (55 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 165 | `change_user_password(...)` | E | Hash/credenciales salen de SQL; los asume el servicio de identidad |
| 166 | `create_auth_user(...)` | E | Genera UUID sintético; no crea usuario real ([`supabase-dependencies.md` §1.2](supabase-dependencies.md)) |
| 167 | `fn_alert_location_access(jsonb)` | E | Diagnóstico |
| 168 | `fn_apply_role_menu_templates(uuid)` | G | Provisión de menús |
| 169 | `fn_attach_subscription_signup_preference(...)` | G | Estado de signup |
| 170 | `fn_can_access_location(uuid)` | G | Autorización por sede |
| 171 | `fn_change_subscription_plan(...)` | G | Cambio de plan con efectos de facturación |
| 172 | `fn_change_subscription_plan_prorated(...)` | G | Prorrateo; dominio Go |
| 173 | `fn_create_public_subscription_signup(...)` | G | Alta pública; validación y antifraude en Go |
| 174 | `fn_create_tenant(...)` (2 args) | G | Provisión multi-tabla; caso de uso |
| 175 | `fn_create_tenant(...)` (3 args) | G | Variante con copia; consolidar |
| 176 | `fn_create_tenant_subscription_renewal_invoice(...)` | G | Emisión de factura SaaS |
| 177 | `fn_current_user_tenant_id()` | E | Deriva tenant de `auth.uid()`; lo sustituye el contexto de sesión |
| 178 | `fn_enforce_tenant_invoice_limit()` | T | Límite de plan |
| 179 | `fn_enforce_tenant_plan_limit_on_active_row()` | T | SQL dinámico; reescribir como trigger estático |
| 180 | `fn_enqueue_async_job(...)` | X | Encolado con dedupe; primitiva |
| 181 | `fn_get_my_tenant_billing_summary()` | M | Lectura de facturación |
| 182 | `fn_get_public_subscription_signup_status(uuid)` | M | Lectura pública acotada |
| 183 | `fn_get_tenant_billing_limit_usage(uuid)` | M | Lectura de consumo |
| 184 | `fn_get_tenant_billing_limit_value(uuid, text)` | M | Helper de lectura |
| 185 | `fn_get_tenant_billing_summary(uuid)` | M | Lectura agregada |
| 186 | `fn_get_tenant_payment_history(uuid, int)` | M | Lectura paginada |
| 187 | `fn_get_tenant_template_json(uuid)` | M | Lectura de plantilla |
| 188 | `fn_get_user_menus(uuid)` | G | Menús por usuario/rol |
| 189 | `fn_init_tenant_roles(uuid)` | G | Provisión de roles |
| 190 | `fn_is_admin_or_manager()` | E | Helper de RLS |
| 191 | `fn_is_super_admin()` | E | Regla «superadmin = sin perfil», no portable y riesgosa |
| 192 | `fn_list_public_subscription_plans()` | M | Catálogo público |
| 193 | `fn_log_public_subscription_signup_event(...)` | G | Bitácora de signup |
| 194 | `fn_mark_subscription_signup_payment(...)` | G | Estado de pago |
| 195 | `fn_mark_tenant_subscription_renewal_paid(...)` | G | Conciliación de renovación |
| 196 | `fn_process_tenant_subscription_expirations(int)` | X | Job de expiraciones; worker |
| 197 | `fn_provision_public_subscription_signup(...)` | G | Provisión de tenant |
| 198 | `fn_superadmin_assign_tenant_plan(...)` | G | Administración de plan |
| 199 | `fn_superadmin_create_role_for_all_tenants(...)` | G | Administración multi-tenant |
| 200 | `fn_superadmin_list_all_payments(...)` | M | Lectura de superadmin |
| 201 | `fn_superadmin_list_public_subscription_signup_events(...)` | M | Lectura |
| 202 | `fn_superadmin_list_public_subscription_signups(...)` | M | Lectura paginada |
| 203 | `fn_superadmin_list_tenant_billing_summary()` | M | Lectura agregada |
| 204 | `fn_superadmin_list_tenants()` | M | Lectura |
| 205 | `fn_superadmin_record_manual_payment(...)` | X | Dinero + estado de factura; primitiva + Go |
| 206 | `fn_superadmin_sync_menus_to_role_all_tenants(...)` | G | Administración |
| 207 | `fn_superadmin_update_subscription_status(...)` | G | Transición de estado |
| 208 | `fn_tenant_gateway_credentials_touch_updated_at()` | T | `updated_at` |
| 209 | `fn_user_assigned_locations()` | E | Helper de RLS |
| 210 | `fn_user_assigned_locations_for(uuid)` | E | Helper de RLS |
| 211 | `fn_user_is_admin_or_manager(uuid)` | E | Helper de RLS |
| 212 | `get_current_user_app_user_id()` | E | Identidad Supabase |
| 213 | `get_current_user_tenant_id()` | E | Identidad Supabase; 3 definiciones |
| 214 | `get_user_assigned_locations()` | E | Helper de RLS |
| 215 | `get_users_with_roles()` | G | Lectura administrativa |
| 216 | `has_permission(text)` | G | Autorización de aplicación |
| 217 | `is_user_admin()` | E | Helper de RLS |
| 218 | `trg_public_subscription_signups_updated_at()` | T | `updated_at` |
| 219 | `trg_touch_billing_updated_at()` | T | `updated_at` |

### 4.10 Tienda online y API pública (17 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 220 | `fn_attach_online_gateway_preference(...)` | X | Estado de pedido + preferencia; primitiva idempotente |
| 221 | `fn_confirm_online_manual_order(...)` | X | Confirma pedido y dispara venta; primitiva + Go |
| 222 | `fn_create_online_manual_order(...)` (firma A) | X | Una sola firma consolidada de las 8 definiciones |
| 223 | `fn_create_online_manual_order(...)` (firma B) | X | Absorbida |
| 224 | `fn_create_online_manual_order(...)` (firma C) | X | Absorbida |
| 225 | `fn_create_online_manual_order(...)` (firma D) | X | Absorbida |
| 226 | `fn_get_public_online_store(p_slug)` | M | Lectura pública por slug |
| 227 | `fn_get_public_order_status(uuid)` | M | Lectura por token; limitar campos |
| 228 | `fn_list_public_online_store_products(p_slug)` | M | Catálogo público; paginación en Go |
| 229 | `fn_online_order_actor_name()` | E | Helper de auditoría con `auth.uid()` |
| 230 | `fn_online_store_available_qty(...)` | M | Cálculo de disponibilidad |
| 231 | `fn_online_store_reserved_qty(...)` | M | Lectura de reservado |
| 232 | `fn_online_store_slugify(text)` | G | Utilidad de texto |
| 233 | `fn_online_store_touch_updated_at()` | T | `updated_at` |
| 234 | `fn_reject_online_manual_order(...)` | X | Rechazo + liberación de reserva |
| 235 | `fn_release_expired_online_orders(int)` | X | Job de expiración; worker |
| 236 | `fn_sync_online_gateway_payment(...)` | X | Webhook de pasarela; dedupe por pago |

### 4.11 Soporte, utilidades y otros (22 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 237 | `check_rls_enabled()` | E | Diagnóstico de plataforma |
| 238 | `fn_async_jobs_touch_updated_at()` | T | `updated_at` |
| 239 | `fn_audit_ondemand_costs()` | E | Diagnóstico |
| 240 | `fn_claim_async_jobs(...)` | X | Claim con `SKIP LOCKED`; primitiva de worker |
| 241 | `fn_complete_async_job(...)` | X | Cierre con compare-and-set; primitiva |
| 242 | `fn_delete_third_party(p_id, p_tenant_id)` | G | Borrado con validación de tenant |
| 243 | `fn_enqueue_pre_expiry_reminders(int)` | X | Encolado de recordatorios; worker |
| 244 | `fn_escape_html(text)` | G | Utilidad de plantillas |
| 245 | `fn_fail_async_job(...)` | X | Fallo con backoff; primitiva |
| 246 | `fn_fix_migration_discrepancies()` | E | Parche de datos histórico |
| 247 | `fn_format_cop(numeric)` | G | Formato de moneda |
| 248 | `fn_generate_unique_sku(...)` | X | Unicidad con índice + reintento Go |
| 249 | `fn_get_unit_by_code(...)` | M | Lectura de catálogo |
| 250 | `fn_handle_ondemand_line(...)` | X | Línea ON_DEMAND; se absorbe en la venta consolidada |
| 251 | `fn_next_invoice_consecutive(uuid)` | X | Consecutivo con lock; primitiva |
| 252 | `fn_product_media_cover_guard()` | T | Guarda de portada |
| 253 | `fn_product_media_promote_cover_after_delete()` | T | Promoción de portada |
| 254 | `fn_top_at_risk_products(...)` | M | Reporte |
| 255 | `fn_top_manufactured_products_by_margin(...)` | M | Reporte |
| 256 | `fn_update_units_timestamp()` | T | `updated_at` |
| 257 | `fn_upsert_third_party(jsonb)` | G | Upsert con tenant dentro del JSON |
| 258 | `sp_audit_rls_and_optionally_apply(boolean)` | E | SQL dinámico que puede alterar RLS; no se porta |

### 4.12 Alertas, IA, reportes y mantenimiento (8 firmas)

| # | Firma (abreviada) | Clase | Destino y razón |
|---:|---|:--:|---|
| 259 | `fn_clear_online_order_alert(uuid)` | M | Helper de alertas |
| 260 | `fn_refresh_all_alerts()` | X | Agregador de refresh; worker Go |
| 261 | `fn_upsert_online_order_alert(uuid)` | M | Upsert de alerta |
| 262 | `fn_ai_telemetry_cost_summary(...)` | M | Lectura agregada de telemetría |
| 263 | `trg_touch_chat_order_ai_cache()` | T | `updated_at` de caché |
| 264 | `fn_reports_dashboard_summary(...)` | M | Resumen de dashboard |
| 265 | `fn_touch_product_media_updated_at()` | T | `updated_at` |

