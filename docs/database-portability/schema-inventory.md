# Inventario del esquema — Ofirone (análisis estático)

- **Fecha:** 2026-11-08
- **Tarea:** #1 del plan [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md)
- **Alcance:** inventario de objetos de base de datos a partir de las migraciones SQL del repositorio.
- **Estado:** completada con limitaciones (ver §2). No sustituye a un inventario contra la base desplegada.
- **Fuente canónica asumida:** [`shared/supabase/migrations/`](../../shared/supabase/migrations/) (161 archivos `.sql` + 14 `.md`).

> **Regla de lectura:** todos los conteos de este documento son **conteos de sentencias DDL en archivos**, no del estado final de una base. Las redefiniciones (`create or replace`, `drop … if exists`, parches posteriores) inflan los números. Donde no fue posible confirmar el estado real se indica **«a verificar»**.

---

## 1. Resumen ejecutivo

| Métrica | Valor | Comentario |
|---|---:|---|
| Archivos `.sql` analizados | 161 | `shared/supabase/migrations/*.sql` |
| Tablas únicas | **100** | 139 sentencias `create table` (37 tablas definidas dos veces) |
| Vistas únicas | **46** | 60 sentencias `create [or replace] view` |
| Vistas materializadas | **1** | `stock_balances`, que antes era tabla (ver §12) |
| Funciones únicas | **211** | 298 definiciones; 49 funciones redefinidas |
| Triggers únicos | **58** | 60 sentencias; 48 con tabla destino identificable |
| Secuencias | **0** | No hay `serial`, `bigserial` ni `nextval`; todo UUID con `gen_random_uuid()` |
| Índices únicos | **159** | 180 sentencias; 13 son `create unique index` |
| Restricciones FK | **≈324–338** | Referencias `references` + `add constraint` |
| Restricciones `check` | **≈270** | Incluye checks a nivel de columna |
| `unique` (tabla/columna) | **≈82** | Más 13 índices únicos |
| ENUM / DOMAIN / TYPE | **0** | Todo se modela con `text` + `check` |
| Extensiones | **2** | `pgcrypto`, `pg_cron` |
| Tablas con `tenant_id` | **82** | De 100 |
| Tablas con RLS habilitado | **74** | 27 tablas sin RLS (23 de ellas con `tenant_id`) |
| Funciones `SECURITY DEFINER` | **111** | 38 sin `set search_path` |
| Tablas con columnas sensibles | **14** | 29 columnas (PII y credenciales) |

**Hallazgos que condicionan toda la migración:**

1. **Hay dos baselines paralelos**: [`InitDB.sql`](../../shared/supabase/migrations/InitDB.sql) (33 tablas) y [`full_migration.sql`](../../shared/supabase/migrations/full_migration.sql) (34 tablas, añade `sale_counters`). El segundo es un superconjunto casi idéntico del primero. Ejecutar ambos produce colisiones.
2. **`stock_balances` cambia de naturaleza en el tiempo**: tabla en `InitDB.sql:361`, luego `drop table … cascade` + `create materialized view` en [`ADD_EXPIRATION_BATCHES_PHASE2.sql:160-165`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L160). Hay funciones y triggers escritos para la versión tabla que fallarían contra la versión matview.
3. **El directorio canónico está incompleto**: `web/migrations/` tiene 17 archivos que no están en `shared/` (módulo contable completo, 9 tablas, 34 funciones) y `mobile/migrations/` tiene 11 propios (8 tablas de notificaciones/media). El esquema realmente desplegado es mayor que el inventariado aquí.
4. **La autorización vive en RLS + `auth.uid()`**: 160 referencias a `auth.uid()` y 70 políticas que lo usan. Sin Supabase, las políticas deben convertirse en autorización de aplicación o en un contexto de sesión propio.
5. **No hay aislamiento uniforme**: 17 tablas no tienen `tenant_id` y 27 no tienen RLS; varias tablas de negocio con `tenant_id` (inventario por lotes, manufactura, créditos) quedan sin política.

---

## 2. Metodología y limitaciones

### 2.1 Método

1. Lectura estática de los 161 archivos `.sql` de `shared/supabase/migrations/`.
2. Tokenización de sentencias respetando comentarios `--`, bloques `/* */`, literales `'…'` y cuerpos `$$ … $$`.
3. Extracción por sentencia de: `create table`, `view`, `materialized view`, `function`, `trigger`, `index`, `sequence`, `extension`, `policy`, `type`, `schema`.
4. Para tablas: parseo del cuerpo entre paréntesis → columnas, `tenant_id`, FKs inline, columnas sensibles/financieras.
5. Para funciones: nombre, firma, atributos (`security definer`, `search_path`) y tablas mencionadas tras `from|join|insert into|update|delete from` (dependencia aproximada).
6. Para RLS: `alter table … enable row level security` y `create policy … on <tabla>`.

Los scripts son reproducibles y no destructivos:

```bash
python3 tools/database/static_schema_scan.py --json docs/database-portability/_data/static-scan.json
python3 tools/database/static_schema_analysis.py --json docs/database-portability/_data/static-analysis.json
```

Artefactos generados:

- [`_data/static-scan.json`](_data/static-scan.json) — objetos por tipo con `archivo:línea`.
- [`_data/static-analysis.json`](_data/static-analysis.json) — tablas, columnas, tenant, RLS, dependencias, sensibles.

### 2.2 Estado de las bases (snapshot histórico + actualización)

| Entorno | Estado | Evidencia |
|---|---|---|
| **DEV** | Conectable pero **vacía**: 0 tablas, 0 vistas, 0 funciones, 0 políticas. Solo extensión `plpgsql`. PostgreSQL 18.6. | [`_data/dev-schema.json`](_data/dev-schema.json) |
| **PROD** | **Bloqueado por política**: el usuario tiene `CREATE` (`read_only_user: false`), no es de solo lectura. No se analizó. | [`_data/prod-schema.json`](_data/prod-schema.json) |

Consecuencia: **no existe ninguna observación del esquema desplegado**. Todo el inventario es estático y no se pudo comparar DEV vs PROD, ni verificar qué migraciones están realmente aplicadas.

Actualización 2026-11-09: el snapshot anterior de DEV fue tomado antes de aplicar el
baseline portable. Posteriormente se aplicaron `0001_core`, `0002_identity` y
`0003_migration_control`; el snapshot `_data/dev-schema.json` se refrescó y registra
10 tablas públicas (incl. `schema_migrations`), 3 funciones privadas, 9 políticas RLS,
105 constraints, 33 índices, 7 triggers y 9 FKs, sin datos históricos. Sus campos
`meta.db`/`meta.user` están redactados por política de secretos. El inventario histórico
de Supabase de este documento no debe interpretarse como una lectura posterior de DEV.
PROD continúa bloqueado y no fue modificado.

### 2.3 Limitaciones explícitas

- **No es un parser SQL.** Los regex pueden perder objetos con formato atípico (nombres entre comillas con espacios, DDL generado dinámicamente dentro de bloques `DO`/`EXECUTE`).
- **DDL dinámico no contabilizado.** De 227 apariciones de `create policy`, 188 se resuelven a una tabla concreta; las ≈39 restantes usan `EXECUTE format(...)`, bloques `DO` o variantes sintácticas y no se cuentan como políticas. Lo mismo aplica a triggers creados dinámicamente (≈10 de 60).
- **Orden de ejecución desconocido.** Los archivos no tienen prefijo numérico y no hay tabla de migraciones aplicadas; el orden por nombre no es el orden real. Un `create or replace` posterior puede haber cambiado firma o semántica.
- **`search_path` no resuelto.** Los nombres sin esquema se asumen en `public`.
- **`alter table … add column` no se aplica al modelo.** Las columnas listadas son las del `create table`; columnas añadidas después **no** aparecen salvo que se hayan definido en el propio `create table`.
- **Directorios divergentes.** `web/migrations/` (167 `.sql`) y `mobile/migrations/` (161 `.sql`) son copias físicas, no symlinks, y no coinciden entre sí ni con `shared/`. Ver §12.6.
- **Vistas:** no se analizó el cuerpo de las 46 vistas (solo su definición), por lo que las dependencias vista→tabla quedan **a verificar**.

---

## 3. Conteo de objetos y evidencia

### 3.1 Totales por tipo

| Objeto | Sentencias | Nombres únicos | Evidencia de referencia |
|---|---:|---:|---|
| Tablas | 139 | 100 | `InitDB.sql:7` (`tenants`), `InitDB.sql:273` (`sales`) |
| Vistas | 60 | 46 | `SpVistasFN.sql:574` (`vw_stock_current`) |
| Vistas materializadas | 1 | 1 | `ADD_EXPIRATION_BATCHES_PHASE2.sql:165` |
| Funciones | 298 | 211 | `SpVistasFN.sql:44` (`fn_apply_stock_delta`) |
| Procedimientos | 0 | 0 | — |
| Triggers | 60 | 58 | `SpVistasFN.sql:1058` |
| Índices | 180 | 159 | `InitDB.sql:388` (`ix_sales_tenant_date`) |
| Secuencias | 0 | 0 | Sin `serial`/`nextval` en todo el corpus |
| Extensiones | 7 | 2 | `InitDB.sql:2` (`pgcrypto`), `ADD_ALERTS_CRON_SCHEDULE.sql` (`pg_cron`) |
| Políticas RLS | 223 | 212 | `FIX_RLS_ALL_TABLES.sql:19` |
| Esquemas | 0 | 0 | — |
| Tipos/ENUM/DOMAIN | 0 | 0 | — |

> La diferencia entre «sentencias» y «nombres únicos» no es ruido: indica **redefinición**. 37 tablas y 49 funciones se declaran más de una vez.

### 3.2 Distribución de funciones por prefijo

| Prefijo | Cantidad | Interpretación |
|---|---:|---|
| `fn_` | 140 | Helpers y lógica de dominio |
| `sp_` | 24 | Procedimientos transaccionales tipo «stored procedure» (ventas, compras, layaway) |
| Sin prefijo | 47 | Helpers de RLS (`is_user_admin`, `has_permission`), triggers y utilidades |
| `rpc*` | 0 | No se usa ese prefijo; las RPC son las funciones expuestas por PostgREST |

### 3.3 Tipos de datos

| Aspecto | Hallazgo | Evidencia |
|---|---|---|
| Identificadores | UUID (`gen_random_uuid()`) en todas las PK; **0 secuencias** | `InitDB.sql:8` |
| Dinero | `numeric(14,2)` — ≈277 usos; **0 `float`/`double`/`real`** | `InitDB.sql:96` |
| Cantidades | `numeric(14,3)` — ≈79 usos | `InitDB.sql:351` |
| Fechas | `timestamptz` (214 usos); **0 `timestamp` sin zona** | `InitDB.sql:13` |
| Enumeraciones | `text` + `check` (0 tipos ENUM) | `InitDB.sql:20` (`type text … -- STORE / WAREHOUSE`) |
| JSON | `jsonb` para atributos y snapshots | `InitDB.sql:95` (`attrs jsonb`) |

Esto es favorable para la portabilidad: el modelo ya evita `float` y `timestamp` sin zona.

---

## 4. Clasificación funcional de objetos

Clasificación orientativa; un objeto puede caer en dos categorías (p. ej. `tenants` es negocio y plataforma).

| Categoría | Tablas | Objetos representativos |
|---|---:|---|
| **Negocio — POS y ventas** | ~16 | `sales`, `sale_lines`, `sale_payments`, `sale_returns`, `sale_return_lines`, `sale_return_refunds`, `sale_line_batches`, `sale_warnings`, `cash_registers`, `cash_sessions`, `cash_movements`, `cash_register_assignments`, `payment_methods`, `sale_counters`, `layaway_*` (4) |
| **Negocio — inventario** | ~8 | `inventory_moves`, `inventory_batches`, `stock_balances` (matview), `stock_alert_log`, `units_of_measure`, `stock_reservations_log`, `transfer_requests`, `sale_line_batches` |
| **Negocio — catálogo** | ~10 | `products`, `product_variants`, `product_barcodes`, `product_tags`, `product_tag_map`, `categories`, `price_lists`, `price_list_items`, `taxes`, `tax_rules`, `pricing_rules` |
| **Negocio — compras/proveedores** | ~7 | `purchases`, `purchase_orders`, `purchase_order_lines`, `purchase_returns`, `purchase_return_lines`, `supplier_payables`, `supplier_payable_payments` |
| **Negocio — manufactura** | ~8 | `bill_of_materials`, `bom_components`, `production_orders`, `production_order_lines`, `production_outputs`, `component_allocations`, `service_deliveries`, `bundle_compositions` |
| **Negocio — terceros/cartera** | ~5 | `third_parties`, `customers` (legado), `customer_credit_accounts`, `customer_credit_movements` |
| **Negocio — tienda online** | ~6 | `online_stores`, `online_store_catalog`, `online_orders`, `online_order_lines`, `online_order_reservations`, `public_subscription_*` |
| **Autenticación / autorización** | 9 | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `menu_items`, `menu_permissions`, `role_menus`, `role_menu_templates` |
| **Plataforma / facturación SaaS** | ~15 | `tenants`, `tenant_settings`, `billing_plans`, `billing_plan_prices`, `billing_plan_features`, `billing_plan_limits`, `tenant_subscriptions`, `tenant_subscription_periods`, `tenant_subscription_events`, `tenant_invoices`, `tenant_payments`, `tenant_payment_methods`, `tenant_gateway_credentials`, `fe_provider_config`, `invoice_resolutions` |
| **Auditoría / observabilidad** | ~5 | `audit_log`, `system_alerts`, `stock_alert_log`, `ai_telemetry_events`, `notification_outbox` |
| **Soporte / infraestructura** | ~6 | `async_jobs`, `async_job_attempts`, `bulk_imports`, `bulk_import_errors`, `chat_order_ai_cache`, `stock_balances_backup` |
| **Storage** | 0 propias | Depende de `storage.objects` (ver §12.6 y tarea #2) |
| **Realtime** | 0 propias | `system_alerts` y otras se publican por `postgres_changes` (5 archivos) |
| **Legado** | 3–4 | `customers`, `stock_balances` (tabla), `stock_balances_backup`, `online_order_reservations` (definida 2 veces) |

---

## 5. Tablas principales y evidencia

### 5.1 Núcleo multi-tenant y seguridad

| Tabla | Definición | Rol |
|---|---|---|
| `tenants` | `InitDB.sql:7` | Raíz del aislamiento; PK `tenant_id` |
| `locations` | `InitDB.sql:16` | Sedes/almacenes; `unique (tenant_id, name)` |
| `users` | `InitDB.sql:30` | Perfil de usuario; `auth_user_id uuid unique` es el puente a `auth.users` |
| `roles` | `InitDB.sql:41` | Roles por tenant |
| `permissions` | `InitDB.sql:48` | Catálogo **global** de permisos (`code text unique`) |
| `role_permissions` / `user_roles` | `InitDB.sql:54` / `:60` | Puentes N:M; heredan tenant, no lo declaran |

`users.auth_user_id` (`InitDB.sql:32`) es el único punto de unión con Supabase Auth y la clave de toda la migración de identidad. `permissions` es global y no tiene `tenant_id`: es intencional, pero implica que un catálogo de permisos se comparte entre tenants.

### 5.2 Ventas y caja

| Tabla | Definición | Notas |
|---|---|---|
| `sales` | `InitDB.sql:273` | `sale_number bigint`, `status text` con `check`; `unique (tenant_id, location_id, sale_number)` |
| `sale_lines` | `InitDB.sql:291` | `unique` por venta/línea; columnas `unit_price`, `unit_cost` |
| `sale_payments` | `InitDB.sql:305` | Pagos divididos por método |
| `sale_returns` / `sale_return_lines` | `InitDB.sql:317` / `:329` | Devoluciones |
| `sale_return_refunds` | `ADD_SALE_RETURNS_REFUNDS_V2.sql:5` | Reembolsos por método (V2) |
| `sale_line_batches` | `ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:316` | Trazabilidad lote↔línea |
| `cash_sessions` / `cash_movements` | `InitDB.sql:234` / `:249` | Apertura/cierre de caja |
| `sale_counters` | `SpVistasFN.sql:13` | Consecutivos por tenant/sede (solo en `full_migration` y `SpVistasFN`) |

### 5.3 Inventario

| Tabla | Definición | Notas |
|---|---|---|
| `inventory_moves` | `InitDB.sql:344` | Kardex; `variant_id not null`, `unit_cost` |
| `inventory_batches` | `ADD_EXPIRATION_BATCHES_PHASE2.sql:21` | Lotes con vencimiento |
| `stock_balances` | tabla `InitDB.sql:361` → **matview** `ADD_EXPIRATION_BATCHES_PHASE2.sql:165` | Ver §12.2 |
| `units_of_measure` | `CREATE_UNITS_OF_MEASURE.sql:21` | Catálogo por tenant |

### 5.4 Compras, manufactura y tienda online

| Tabla | Definición |
|---|---|
| `purchases` | `ADD_PURCHASES_TABLE.sql:7` |
| `purchase_orders` / `purchase_order_lines` | `ADD_PURCHASE_ORDERS_CORE.sql:5` / `:20` |
| `purchase_returns` / `purchase_return_lines` | `ADD_PURCHASE_RETURNS_CORE.sql:5` / `:17` |
| `supplier_payables` / `supplier_payable_payments` | `ADD_SUPPLIER_PAYABLES_CORE.sql:5` / `:23` |
| `bill_of_materials` / `bom_components` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:23` / `:62` |
| `production_orders` / `production_order_lines` / `production_outputs` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:93` / `:149` / `:179` |
| `online_stores` / `online_orders` / `online_order_lines` | `ADD_ONLINE_STORE_MVP.sql:153` / `:202` / `:230` |
| `layaway_contracts` / `layaway_items` / `layaway_installments` / `layaway_payments` | `PlanSepare.sql:90` / `:120` / `:133` / `:142` |

### 5.5 Plataforma, facturación y credenciales

| Tabla | Definición | Sensibilidad |
|---|---|---|
| `billing_plans` y satélites | `ADD_TENANT_BILLING_MONETIZATION.sql:12`, `:25`, `:41`, `:53` | Catálogo global |
| `tenant_subscriptions` | `ADD_TENANT_BILLING_MONETIZATION.sql:79` | `tenant_id` **sin FK** a `tenants` |
| `tenant_invoices`, `tenant_payments` | `ADD_TENANT_BILLING_MONETIZATION.sql:160`, `:187` | Datos financieros |
| `tenant_gateway_credentials` | `ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql:7` | `access_token`, `account_email` — **secretos** |
| `tenant_payment_methods` | `ADD_TENANT_BILLING_MONETIZATION.sql:209` | `provider_token` |
| `public_subscription_signups` | `ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:7` | PII de prospectos (email, teléfono, dirección) |

### 5.6 Auditoría y soporte

| Tabla | Definición | Notas |
|---|---|---|
| `audit_log` | `InitDB.sql:373` | `tenant_id` sin FK; `before_data`/`after_data jsonb` |
| `system_alerts` | `FIX_STOCK_ALERTS_REALTIME.sql:43` | 8 políticas; alimenta realtime |
| `ai_telemetry_events` | `ADD_AI_TELEMETRY_EVENTS.sql:7` | Tokens y costo, no PII |
| `notification_outbox` | `ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:9` | `recipient_email` |
| `async_jobs` / `async_job_attempts` | `ADD_ASYNC_JOB_QUEUE.sql:12` / `:75` | Cola con `for update skip locked` |
| `bulk_imports` / `bulk_import_errors` | `CREATE_BULK_IMPORT_TRACKING.sql:8` / `:24` | Importación masiva |

---

## 6. Vistas y vistas materializadas

- **46 vistas únicas** (60 sentencias). Predominan las vistas de reporte (`vw_*`: 36) y las vistas por rol (`v_*_by_role`: 8).
- **1 vista materializada:** `stock_balances` (`ADD_EXPIRATION_BATCHES_PHASE2.sql:165`), refrescada manualmente o por función (`refresh materialized view concurrently`).
- Las vistas **no** se analizaron por dentro en esta tarea; sus dependencias quedan **a verificar**.

| Grupo | Ejemplos | Definición |
|---|---|---|
| Stock | `vw_stock_current`, `vw_stock_available`, `vw_stock_with_batches`, `vw_kardex`, `vw_stock_calculated` | `SpVistasFN.sql`, `ADD_EXPIRATION_BATCHES_PHASE*` |
| Ventas | `vw_sales_summary`, `vw_sales_with_customer`, `vw_sales_daily_history`, `vw_sale_lines_with_discounts` | `SpVistasFN.sql`, `PURCHASE_ANALYSIS_VIEWS.sql` |
| Compras | `vw_purchases_summary` | `PURCHASE_ANALYSIS_VIEWS.sql` |
| Manufactura | `vw_manufacturing_dashboard`, `vw_production_cost_report`, `vw_component_consumption_detail` | `MANUFACTURING_PRODUCTION_COST_REPORT.sql` |
| Layaway | `vw_layaway_summary`, `vw_layaway_report`, `vw_layaway_payments` | `PlanSepare.sql` |
| Por rol | `v_sales_by_role`, `v_sale_lines_by_role`, `v_cash_movements_by_role`, `v_cash_sessions_by_role` | `CREATE_SALES_VIEWS_BY_ROLE.sql` |
| Diagnóstico | `vw_rls_audit_public` | `CREATE_RLS_CHECK_FUNCTION.sql` |

**Riesgo de portabilidad:** las vistas creadas antes de PostgreSQL 15 no aplican RLS del invocador. Hay 7 usos de `security_invoker` en el corpus; el resto de vistas se ejecutan con permisos del owner. En PostgreSQL estándar esto cambia el modelo de autorización y debe revisarse vista por vista.

---

## 7. Funciones y RPC

- **211 funciones únicas**, **298 definiciones**; 49 redefinidas.
- **111 definiciones con `security definer`**; **38 sin `set search_path`** → riesgo de *search_path hijacking* si el esquema es escribible por el rol de la aplicación.
- 70 políticas RLS invocan `auth.uid()`.

### 7.1 Funciones más redefinidas (señal de lógica inestable)

| Función | Definiciones | Última aparición textual |
|---|---:|---|
| `fn_create_online_manual_order` | 8 | `ADD_ONLINE_STORE_*` |
| `sp_create_sale` | 7 | `UPDATE_SP_CREATE_SALE_FE.sql:37` |
| `fn_generate_batch_number` | 4 | `FIX_BATCH_NUMBER_BY_LOCATION.sql` |
| `fn_online_store_create_sale` | 4 | `FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION_V3.sql` |
| `sp_create_layaway` | 4 | `UPDATE_LAYAWAY_SP_PRICE_INCLUDES_TAX.sql:8` |
| `sp_create_purchase` | 4 | `SpVistasFN.sql:1460` |
| `fn_apply_stock_delta` | 3 | `FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:21` |
| `fn_complete_production` | 3 | `MANUFACTURING_PHASE456_FINAL.sql:269` |
| `fn_consume_bom_components` | 3 | `MANUFACTURING_PHASE3_ON_DEMAND.sql:98` |
| `fn_create_tenant` | 3 | `UPDATE_CREATE_TENANT_DEFAULTS.sql:31` |

Ninguna de estas funciones puede reproducirse con fidelidad sin fijar la **versión vigente**. La «última aparición textual» no es necesariamente la versión desplegada (no hay orden de migración verificable).

### 7.2 RPC críticas y su evidencia

| Función | Definición | Dependencias detectadas |
|---|---|---|
| `sp_create_sale` | `SpVistasFN.sql:124` (+6 redefiniciones) | `sales`, `sale_lines`, `sale_payments`, `sale_line_batches`, `inventory_moves`, `product_variants`, `payment_methods`, `cash_sessions`, `fn_allocate_stock_fefo`, `fn_explode_bundle_components`, `fn_validate_bom_availability` |
| `sp_create_return_v2` | `ADD_SALE_RETURNS_REFUNDS_V2.sql:53` | `sale_returns`, `sale_return_refunds`, `payment_methods` |
| `sp_create_purchase` | `ADD_PURCHASES_TABLE.sql:34` (+3) | `inventory_moves`, `product_variants` |
| `sp_create_purchase_return` | `ADD_PURCHASE_RETURNS_CORE.sql:67` | Compras/devoluciones |
| `sp_receive_purchase_order_partial` | `ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:15` | Órdenes de compra |
| `fn_apply_stock_delta` | `SpVistasFN.sql:44` | `stock_balances` |
| `fn_allocate_stock_fefo` | `ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:22` | `inventory_batches`, `tenant_settings` |
| `fn_consume_batch_stock` | `ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:256` | Lotes |
| `fn_consume_bom_components` | `MANUFACTURING_PHASE3_ON_DEMAND.sql:98` | `bill_of_materials`, `bom_components`, `component_allocations`, `inventory_batches`, `inventory_moves`, `sale_lines` |
| `fn_complete_production` | `MANUFACTURING_PHASE456_FINAL.sql:269` | `production_orders`, `production_outputs`, `inventory_moves`, `inventory_batches` |
| `fn_claim_async_jobs` | `ADD_ASYNC_JOB_QUEUE.sql:219` | `async_jobs` |
| `fn_complete_async_job` / `fn_fail_async_job` | `ADD_ASYNC_JOB_QUEUE.sql:258` / `:312` | `async_jobs`, `async_job_attempts` |
| `is_user_admin` | `FIX_RLS_CASHIER_PRIVACY.sql:19` | `users`, `user_roles`, `roles` |
| `has_permission` | `RLS_Security.sql:16` | `users`, `roles`, `permissions` |
| `get_current_user_tenant_id` | `RLS_Security.sql:6` | `users` |

**No localizadas:** `fn_accounting_post_entry` y `fn_accounting_process_queue` (citadas en [`PHASE-0-FINDINGS.md`](PHASE-0-FINDINGS.md)) **no existen** en `shared/supabase/migrations/`. Solo aparecen variantes contables bajo `web/migrations/ADD_ACCOUNTING_*.sql`. **A verificar** contra la base desplegada y contra el módulo web.

### 7.3 Patrón transaccional

Las funciones `sp_*` combinan validación, inserción multi-tabla y actualización de stock en una sola transacción. Buena parte usa `for update` / `for update skip locked`. Esto **sí** es PostgreSQL estándar y puede conservarse; lo que no es portable es el contexto de identidad (`auth.uid()`) que consumen.

---

## 8. Triggers

- **58 triggers únicos**, 60 sentencias; 48 con tabla destino resuelta (10 creados dinámicamente).
- Familias identificadas:

| Familia | Ejemplos | Tablas |
|---|---|---|
| `updated_at` | `trg_touch_billing_updated_at`, `trg_units_updated_at`, `trg_online_stores_updated_at` | 9 tablas de billing + `units_of_measure`, `online_*` |
| Alertas materializadas | `trg_stock_balances_alert`, `trg_refresh_expiration_alerts`, `trg_refresh_customer_receivable_alerts` | `stock_balances`, `inventory_batches`, `customer_credit_accounts` |
| Encolado de emails | `trg_enqueue_*_email` (10 funciones) | `sales`, `sale_returns`, `layaway_*`, `supplier_payables` |
| Manufactura | `sync_bom_name_code`, `sync_bom_component_quantity`, `generate_production_order_number`, `trg_generate_production_inventory` | `bill_of_materials`, `bom_components`, `production_*` |
| Límites de plan | `trg_enforce_products_limit`, `trg_enforce_users_active_limit` | `products`, `users`, `locations`, `cash_registers`, `sales` |
| Storage | `dataimport_metadata_before_insert` sobre **`storage.objects`** | `SETUP_DATAIMPORT_BUCKET.sql:88` |

**Incompatibilidad relevante:** `trg_stock_balances_alert_after` se crea sobre `stock_balances` en `SpVistasFN.sql:1058` y en `FIX_STOCK_ALERTS_REALTIME.sql:122`. Si `stock_balances` ya es una vista materializada (fase 2 de vencimientos), **PostgreSQL no permite triggers sobre matviews**: esas sentencias fallan o exigen que la tabla siga existiendo. Es una contradicción de orden de migraciones, no un detalle.

---

## 9. Índices y restricciones

### 9.1 Índices

- **159 índices únicos** (180 sentencias); 13 son únicos.
- Patrón dominante: índices compuestos que empiezan por `tenant_id`, lo cual es correcto para multi-tenant.
- Ejemplos: `ix_sales_tenant_date on sales(tenant_id, sold_at desc)` (`InitDB.sql:388`), `ix_stock_balances_lookup` (`InitDB.sql:392`), `ix_inventory_moves_variant_loc_date` (`InitDB.sql:390`).

**A verificar:** no se evaluó la cobertura real (índices para FKs, para filtros de listados ni para cursor pagination). Eso corresponde a la tarea #6.

### 9.2 Restricciones

| Tipo | Cantidad aprox. | Evidencia |
|---|---:|---|
| `primary key` | 138 de 139 sentencias `create table` | `InitDB.sql:8` |
| `unique` (tabla o columna) | ≈82 + 13 índices únicos | `InitDB.sql:24` (`unique (tenant_id, name)`) |
| `foreign key` | ≈324–338 | `InitDB.sql:18` |
| `check` | ≈270 | `InitDB.sql:296` (`check (quantity > 0)`) |
| `alter table … add constraint` | 23 | Parches posteriores |

**Observación:** varias tablas de plataforma declaran `tenant_id uuid not null` **sin FK** a `tenants` (`audit_log`, `tenant_subscriptions`, `tenant_invoices`, `tenant_payments`, `tenant_subscription_periods`, `tenant_subscription_events`, `tenant_payment_methods`). La integridad referencial del tenant se apoya solo en la aplicación. Las FK se añaden dinámicamente en `ADD_TENANT_BILLING_MONETIZATION.sql` (bloques `DO`), lo que explica que el análisis estático no las vea.

---

## 10. Secuencias y tipos

- **0 secuencias.** No hay `serial`, `bigserial` ni `nextval`. Los consecutivos (`sales.sale_number`) se generan con tablas contadoras (`sale_counters`, `SpVistasFN.sql:13`) y presumiblemente con `for update`. **A verificar** el mecanismo exacto y su concurrencia.
- **0 ENUM, 0 DOMAIN, 0 tipos compuestos.** Todo estado se modela con `text` + `check`. Ventaja: no hay tipos propietarios que migrar. Desventaja: los valores válidos están dispersos en `check` y en código de aplicación, sin una única fuente de verdad.

---

## 11. Extensiones

| Extensión | Uso | Evidencia |
|---|---|---|
| `pgcrypto` | `gen_random_uuid()` y hashing | `InitDB.sql:2` |
| `pg_cron` | Programación de alertas y jobs | `ADD_ALERTS_CRON_SCHEDULE.sql:8`, `ADD_ASYNC_JOB_QUEUE.sql` |

`pgcrypto` es estándar y está disponible en PostgreSQL 15+ (aunque `gen_random_uuid()` ya es nativo desde PG13). `pg_cron` **no** es parte de PostgreSQL estándar: requiere el planificador externo (systemd timer, contenedor cron, worker Go) en el destino. No se detectaron `pg_net` ni `vault` en `shared/`; **a verificar** en `web/migrations/` (hay pipelines de cron allí).

---

## 12. Objetos duplicados, obsoletos y nombres inconsistentes

### 12.1 Doble baseline

| Archivo | Tablas | Rol |
|---|---:|---|
| `InitDB.sql` | 33 | Primer esquema completo |
| `full_migration.sql` | 34 | «Migración completa» que repite 33 tablas y añade `sale_counters` |

Las 33 tablas comunes tienen el mismo conjunto de columnas (las diferencias detectadas son comentarios y formato). **Ninguno declara `if not exists` en `InitDB.sql`**, mientras que `full_migration.sql` sí. Ejecutar ambos en secuencia falla en la primera tabla. Es el motivo principal por el que «no se debe ejecutar todo el directorio por orden de nombre» ([`PHASE-0-FINDINGS.md`](PHASE-0-FINDINGS.md)).

### 12.2 `stock_balances`: tabla → vista materializada

- `InitDB.sql:361` la crea como **tabla** con PK `(tenant_id, location_id, variant_id)`.
- `ADD_EXPIRATION_BATCHES_PHASE2.sql:160-165` hace `drop table if exists stock_balances cascade` y la recrea como **vista materializada** sobre `inventory_batches`.
- `SpVistasFN.sql:1058` y `FIX_STOCK_ALERTS_REALTIME.sql:122` le ponen **triggers** (imposible sobre matview).
- `FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:6-8` documenta el error `cannot change materialized view stock_balances`, es decir, el conflicto ya ocurrió en producción.

### 12.3 `customers` → `third_parties`

`MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql:1-6` migra `customers` a `third_parties` preservando UUID, pero `customers` sigue definida en `InitDB.sql:145` y referenciada por `sales.customer_id` (`InitDB.sql:281`). **Dos tablas para el mismo concepto**, con FKs apuntando a la antigua. Es legado activo, no residuo inerte.

### 12.4 Versiones y parches con nombre

| Patrón | Ejemplos | Problema |
|---|---|---|
| `_V2` / `_v2` | `sale_returns_refunds`, `sp_create_return_v2`, `AddTenantSettingsConfig_v2.sql` | La versión «2» convive con la 1; no hay borrado de la anterior |
| `FIX_*` | 37 archivos | Parches correctivos mezclados con DDL estructural |
| `DIAGNOSE_*`, `CHECK_*`, `VERIFY_*`, `QUICK_*`, `INVESTIGATE_*` | ≈15 archivos | Diagnósticos que **no** deberían ejecutarse en un pipeline de migración |
| `UPDATE_*` | `UPDATE_SALE_SP_*.sql`, `UPDATE_VIEWS_TO_THIRD_PARTIES.sql` | `create or replace` de funciones/vistas ya existentes |

### 12.5 Nombres inconsistentes

- **Vistas:** prefijo `vw_` (36) y `v_` (8) para el mismo tipo de objeto.
- **Funciones:** `sp_` (24), `fn_` (140) y 47 sin prefijo (`has_permission`, `is_user_admin`, `get_users_with_roles`, `change_user_password`, `create_auth_user`).
- **Tablas:** plural (`sales`, `products`) y singular (`audit_log`, `sale_counters`); dominio en español (`layaway_*` convive con `PlanSepare`), y `bill_of_materials` vs `bom_components`.
- **Tablas «backup» dentro del esquema:** `stock_balances_backup` (`ADD_EXPIRATION_BATCHES_PHASE2.sql:150`).
- **Tabla que pasó a vista materializada:** `stock_balances`; su gemela `stock_movements` aparece solo en políticas RLS, sin `create table` en `shared/` → **a verificar**.

### 12.6 Divergencia de directorios de migraciones

| Directorio | Archivos `.sql` | Respecto a `shared/` |
|---|---:|---|
| `shared/supabase/migrations/` | 161 | Canónico asumido |
| `web/migrations/` | 167 | **17 archivos extra**, 11 de `shared/` ausentes |
| `mobile/migrations/` | 161 | **11 archivos extra**, 11 de `shared/` ausentes |

- Solo en `web/`: módulo contable completo (`ADD_ACCOUNTING_CO_MODULE.sql`, `ADD_ACCOUNTING_COMPETITIVE_CORE.sql`, `ADD_ACCOUNTING_QUEUE_PROCESSOR.sql`, `ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql`, menús contables), RPCs de reportes y superadmin, pipelines de cron. **9 tablas y 34 funciones** que este inventario **no** contabiliza.
- Solo en `mobile/`: notificaciones push (`ADD_PUSH_NOTIFICATIONS_EXPO.sql`, `ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql`, `ADD_IN_APP_NOTIFICATION_CENTER.sql`), `product_media`, cache RAG. **8 tablas y 31 funciones** no contabilizadas.
- Los tres directorios son copias físicas, no enlaces: cualquier cambio en uno no se propaga.

**Consecuencia:** el universo real de objetos es del orden de **116 tablas** (100 + 9 + 8 − 1 de solapamiento: `sale_counters`). Cualquier baseline portable debe decidir primero cuál de los tres directorios es la verdad.

---

## 13. Dependencias tabla ↔ función

Las dependencias se extrajeron del texto de cada función (`from`, `join`, `insert into`, `update`, `delete from`). Es una aproximación: no detecta SQL dinámico ni `execute format(...)`.

### 13.1 Funciones con más dependencias

| Función | Tablas/funciones referenciadas |
|---|---|
| `sp_create_sale` | `sales`, `sale_lines`, `sale_payments`, `sale_line_batches`, `inventory_moves`, `product_variants`, `payment_methods`, `cash_sessions` + 4 funciones |
| `fn_consume_bom_components` | `bill_of_materials`, `bom_components`, `component_allocations`, `inventory_batches`, `inventory_moves`, `product_variants`, `products`, `sale_lines` |
| `fn_complete_production` | `production_orders`, `production_outputs`, `inventory_moves`, `inventory_batches`, `product_variants` |
| `sp_create_return_v2` | `sale_returns`, `sale_return_refunds`, `payment_methods` |

### 13.2 Cadenas críticas

```
sales ──< sale_lines ──< sale_line_batches >── inventory_batches
  │              │
  │              └── fn_allocate_stock_fefo ──> inventory_batches
  └── sale_payments ──> payment_methods

purchases ──> inventory_moves ──> stock_balances (matview)
production_orders ──> production_outputs ──> inventory_moves
inventory_batches ──(trigger)──> refresh stock_balances
```

La cadena `inventory_batches → stock_balances` es la más frágil: combina trigger, matview y refresco manual. En PostgreSQL estándar conviene reemplazarla por una vista normal o por cálculo en consulta.

---

## 14. Columnas sensibles y datos personales

Detección heurística por nombre de columna. **14 tablas, 29 columnas.** Dos falsos positivos conocidos (`ai_telemetry_events.tokens_input/output` son tokens de IA, no credenciales).

### 14.1 Credenciales y secretos (prioridad alta)

| Tabla | Columnas | Riesgo |
|---|---|---|
| `tenant_gateway_credentials` | `access_token`, `account_email`, `gateway_credential_id` | Tokens de pasarela de pago en claro (`ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql:7`) |
| `tenant_payment_methods` | `provider_token` | Token de proveedor de pago |
| `fe_provider_config` | credenciales de facturación electrónica | **A verificar** cifrado |

No se detectó uso de `pgcrypto` para cifrar estas columnas (solo para `gen_random_uuid()`). **A verificar** si el cifrado ocurre en la aplicación o si los tokens están en claro.

### 14.2 Datos personales (PII)

| Tabla | Columnas |
|---|---|
| `third_parties` | `document_type`, `document_number`, `email`, `fiscal_email`, `phone`, `address` |
| `customers` | `document`, `email`, `phone`, `address` (legado duplicado de `third_parties`) |
| `users` | `email`, `full_name` |
| `online_orders` | `customer_email`, `customer_phone` |
| `public_subscription_signups` | `admin_email`, `phone`, `address` |
| `online_stores` | `support_whatsapp` |
| `tenant_settings` | `business_address`, `business_phone` |
| `notification_outbox` | `recipient_email` |
| `invoice_resolutions` | `document_type` |

**Duplicación de PII:** `customers` y `third_parties` guardan el mismo tipo de dato con nombres distintos (`document` vs `document_number`, `phone` vs `phone`), lo que complica una política única de retención/anonimización.

### 14.3 Datos financieros

**49 tablas** contienen columnas monetarias o de saldo (`amount`, `total`, `subtotal`, `unit_price`, `unit_cost`, `balance`, `tax_total`, `discount_total`). Todas usan `numeric(p,s)`; predominan `numeric(14,2)` para dinero y `numeric(14,3)` para cantidades, con precisiones menores (`14,8`, `10,2`, `7,4`, `5,2`, `5,4`, `8,5`) para tasas, porcentajes y factores de conversión. **No hay `float`.** Esto es correcto y debe preservarse.

---

## 15. Multi-tenant: cobertura y huecos

### 15.1 Cobertura

| Situación | Tablas | Detalle |
|---|---:|---|
| Con `tenant_id` | **82** | Aislamiento directo |
| Sin `tenant_id` | **17** | Globales o derivadas |
| Con RLS habilitado | **74** | `alter table … enable row level security` |
| Sin RLS | **27** | De ellas, **23 tienen `tenant_id`** |
| Con RLS pero sin `tenant_id` | 15 | `permissions`, `menu_items`, `menu_permissions`, `role_menus`, `role_menu_templates`, `billing_plans`, `billing_plan_prices`, `billing_plan_features`, `billing_plan_limits`, `user_roles`, `role_permissions`, `bulk_import_errors`, `public_subscription_signup_events`, `async_job_attempts`, `stock_movements` |

### 15.2 Tablas sin `tenant_id` (17)

`async_job_attempts`, `billing_plan_features`, `billing_plan_limits`, `billing_plan_prices`, `billing_plans`, `bulk_import_errors`, `cities`, `departments`, `document_types`, `menu_items`, `menu_permissions`, `permissions`, `public_subscription_signup_events`, `role_menu_templates`, `role_menus`, `role_permissions`, `user_roles`.

Clasificación fina:

- **Globales legítimas (catálogo compartido):** `billing_plans`, `billing_plan_*`, `permissions`, `menu_items`, `menu_permissions`, `role_menu_templates`, `role_menus`, `cities`, `departments`, `document_types`.
- **Derivadas (heredan tenant por FK):** `user_roles`, `role_permissions`, `async_job_attempts` (por `job_id`), `bulk_import_errors` (por `import_id`), `public_subscription_signup_events` (por `signup_id`).
- **Riesgo:** las derivadas no tienen `tenant_id` **ni** una FK en cascada que impida cruces; el aislamiento depende de que el join se haga siempre bien.

### 15.3 Tablas de negocio con `tenant_id` pero sin RLS (23)

`audit_log`, `bill_of_materials`, `bom_components`, `bundle_compositions`, `categories`, `component_allocations`, `customer_credit_accounts`, `inventory_batches`, `price_list_items`, `price_lists`, `product_barcodes`, `product_tag_map`, `product_tags`, `production_order_lines`, `production_orders`, `production_outputs`, `sale_counters`, `sale_line_batches`, `sale_return_lines`, `sale_warnings`, `service_deliveries`, `stock_reservations_log`, `tenant_settings`.

Esto **no** significa que estén expuestas: si el acceso es solo vía funciones `security definer` o el rol `anon` no tiene `select`, no hay fuga. Pero el modelo de autorización es **inconsistente**: unas tablas se protegen con RLS y otras solo por permisos de rol. **A verificar** los `grant` reales, que no se analizaron en esta tarea.

### 15.4 Tablas globales de negocio

`tenants` es global por definición. `permissions` es un catálogo global. `billing_plans*` es un catálogo global. Ninguna otra tabla de negocio debería ser global, y no se detectó ninguna que lo sea por error.

---

## 16. Riesgos

| # | Riesgo | Severidad | Evidencia |
|---|---|---|---|
| R1 | **Esquema desplegado desconocido**: DEV vacía y PROD bloqueado; el inventario es solo textual | Alta | `_data/dev-schema.json`, `_data/prod-schema.json` |
| R2 | **Orden de migraciones indeterminable**: sin prefijos ni tabla de control; conviven baseline, parches y diagnósticos | Alta | §12.1, §12.4 |
| R3 | **`stock_balances` tabla vs matview** con triggers incompatibles | Alta | `ADD_EXPIRATION_BATCHES_PHASE2.sql:160-165`, `SpVistasFN.sql:1058` |
| R4 | **Autorización acoplada a Supabase**: 160 `auth.uid()`, 70 políticas, `auth.users` | Alta | §7, tarea #2 |
| R5 | **Aislamiento desigual**: 23 tablas de negocio con `tenant_id` sin RLS | Alta | §15.3 |
| R6 | **Secretos en tablas** (`access_token`, `provider_token`) sin cifrado detectado | Alta | §14.1 |
| R7 | **38 funciones `security definer` sin `search_path`** | Media-Alta | §7 |
| R8 | **Directorio canónico incompleto** (17 web-only, 11 mobile-only) | Media | §12.6 |
| R9 | **Lógica redefinida** (49 funciones, `sp_create_sale` ×7) sin versión vigente identificable | Media | §7.1 |
| R10 | **Catálogo `permissions` global** y roles por tenant: no hay `tenant_id` en permisos, lo que impide permisos específicos por tenant | Media | `InitDB.sql:48` |
| R11 | **Consecutivos sin secuencia**: `sale_counters` + `for update`; concurrencia **a verificar** | Media | `SpVistasFN.sql:13` |
| R12 | **Vistas sin `security_invoker`**: RLS no se aplica a través de ellas | Media | §6 |
| R13 | **Duplicidad de PII** `customers`/`third_parties` | Baja-Media | §12.3, §14.2 |
| R14 | **`pg_cron`** como dependencia no estándar | Media | §11 |
| R15 | **Diagnósticos en el directorio de migraciones** (≈15 archivos) que pueden ejecutarse por error | Media | §12.4 |

---

## 17. A verificar y propuestas pendientes

### 17.1 A verificar (no concluyente con análisis estático)

1. Esquema real de PROD y de DEV (requiere usuario de solo lectura).
2. Migraciones efectivamente aplicadas y **versión vigente** de las 49 funciones redefinidas.
3. Existencia real de `fn_accounting_post_entry` / `fn_accounting_process_queue` (solo en `web/`).
4. Cifrado de `tenant_gateway_credentials.access_token`, `tenant_payment_methods.provider_token`, `fe_provider_config`.
5. `grant`/`revoke` reales por tabla y rol (`anon`, `authenticated`, `service_role`).
6. Cuerpo de las 46 vistas: dependencias y si usan `security_invoker`.
7. Mecanismo exacto de consecutivos (`sale_counters`) y su comportamiento bajo concurrencia.
8. Tabla `stock_movements`: aparece en políticas RLS pero no tiene `create table` en `shared/`.
9. Triggers creados dinámicamente (10) y políticas creadas en bloques `DO` (≈35).

### 17.2 Propuestas pendientes (fuera del perímetro de este agente)

> No implementadas. Requieren decisión del agente principal.

- **P1. Un solo baseline reproducible.** Congelar el esquema vigente en `docs/database-portability/baseline/` (o en un repo de migraciones nuevo) y marcar `InitDB.sql`, `full_migration.sql` y los parches como históricos. No ejecutar el directorio completo.
- **P2. Tabla de control de migraciones** (`schema_migrations` con checksum) para que el orden sea explícito y verificable.
- **P3. Resolver `stock_balances`**: decidir si es tabla o vista, y eliminar la ambigüedad antes de portar. Recomendado: vista normal + cálculo en consulta, sin trigger.
- **P4. Mover los diagnósticos** (`DIAGNOSE_*`, `CHECK_*`, `VERIFY_*`, `QUICK_*`, `INVESTIGATE_*`) fuera de `migrations/`.
- **P5. Unificar el directorio de migraciones** en uno solo (shared) y eliminar las copias de `web/` y `mobile/`, o declararlas explícitamente subconjuntos.
- **P6. Estandarizar nombres**: `v_` vs `vw_`, `fn_` vs `sp_` vs sin prefijo. Hacerlo en el baseline nuevo, no en las migraciones históricas.
- **P7. Resolver `customers` vs `third_parties`**: completar la migración y reapuntar `sales.customer_id`.
- **P8. Añadir `set search_path = public, pg_temp`** a las 38 funciones `security definer` que no lo tienen (en el baseline nuevo).
- **P9. Cifrado de secretos** (P2) con `pgcrypto` o KMS externo, y rotación documentada.

---

## 18. Apéndice A — Inventario completo de tablas (100)

`tenant_id` = columna directa en la definición; `políticas` = `create policy` con tabla resuelta.

| Tabla | Definición | `tenant_id` | Políticas |
|---|---|:--:|---:|
| `ai_telemetry_events` | `ADD_AI_TELEMETRY_EVENTS.sql:7` | sí | 3 |
| `async_job_attempts` | `ADD_ASYNC_JOB_QUEUE.sql:75` | — | 1 |
| `async_jobs` | `ADD_ASYNC_JOB_QUEUE.sql:12` | sí | 2 |
| `audit_log` | `InitDB.sql:373` | sí | 0 |
| `bill_of_materials` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:23` | sí | 0 |
| `billing_plan_features` | `ADD_TENANT_BILLING_MONETIZATION.sql:41` | — | 0 |
| `billing_plan_limits` | `ADD_TENANT_BILLING_MONETIZATION.sql:53` | — | 0 |
| `billing_plan_prices` | `ADD_TENANT_BILLING_MONETIZATION.sql:25` | — | 0 |
| `billing_plans` | `ADD_TENANT_BILLING_MONETIZATION.sql:12` | — | 1 |
| `bom_components` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:62` | sí | 0 |
| `bulk_import_errors` | `CREATE_BULK_IMPORT_TRACKING.sql:24` | — | 2 |
| `bulk_imports` | `CREATE_BULK_IMPORT_TRACKING.sql:8` | sí | 3 |
| `bundle_compositions` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:206` | sí | 0 |
| `cash_movements` | `InitDB.sql:249` | sí | 3 |
| `cash_register_assignments` | `AsignacionCajerosCaja.sql:21` | sí | 2 |
| `cash_registers` | `InitDB.sql:225` | sí | 4 |
| `cash_sessions` | `InitDB.sql:234` | sí | 3 |
| `categories` | `InitDB.sql:69` | sí | 0 |
| `chat_order_ai_cache` | `ADD_CHAT_ORDER_AI_CACHE.sql:5` | sí | 3 |
| `cities` | `ADD_THIRD_PARTIES_LOOKUPS.sql:41` | — | 0 |
| `component_allocations` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:265` | sí | 0 |
| `customer_credit_accounts` | `InitDB.sql:158` | sí | 0 |
| `customer_credit_movements` | `InitDB.sql:168` | sí | 2 |
| `customers` | `InitDB.sql:145` | sí | 2 |
| `departments` | `ADD_THIRD_PARTIES_LOOKUPS.sql:26` | — | 0 |
| `document_types` | `ADD_THIRD_PARTIES_LOOKUPS.sql:10` | — | 0 |
| `fe_provider_config` | `ADD_ELECTRONIC_INVOICING.sql:35` | sí | 1 |
| `inventory_batches` | `ADD_EXPIRATION_BATCHES_PHASE2.sql:21` | sí | 0 |
| `inventory_moves` | `InitDB.sql:344` | sí | 3 |
| `invoice_resolutions` | `ADD_ELECTRONIC_INVOICING.sql:73` | sí | 1 |
| `layaway_contracts` | `PlanSepare.sql:90` | sí | 8 |
| `layaway_installments` | `PlanSepare.sql:133` | sí | 8 |
| `layaway_items` | `PlanSepare.sql:120` | sí | 7 |
| `layaway_payments` | `PlanSepare.sql:142` | sí | 7 |
| `locations` | `InitDB.sql:16` | sí | 1 |
| `menu_items` | `ROLES_MENUS_SYSTEM.sql:26` | — | 2 |
| `menu_permissions` | `ROLES_MENUS_SYSTEM.sql:49` | — | 2 |
| `notification_outbox` | `ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:9` | sí | 1 |
| `online_order_lines` | `ADD_ONLINE_STORE_MVP.sql:230` | sí | 0 |
| `online_order_reservations` | `ADD_ONLINE_STORE_MVP.sql:249` | sí | 1 |
| `online_orders` | `ADD_ONLINE_STORE_MVP.sql:202` | sí | 0 |
| `online_store_catalog` | `ADD_ONLINE_STORE_MVP.sql:182` | sí | 0 |
| `online_stores` | `ADD_ONLINE_STORE_MVP.sql:153` | sí | 1 |
| `payment_methods` | `InitDB.sql:264` | sí | 4 |
| `permissions` | `InitDB.sql:48` | — | 1 |
| `price_list_items` | `InitDB.sql:134` | sí | 0 |
| `price_lists` | `InitDB.sql:126` | sí | 0 |
| `pricing_rules` | `PricingRules.sql:8` | sí | 4 |
| `product_barcodes` | `InitDB.sql:103` | sí | 0 |
| `product_tag_map` | `InitDB.sql:118` | sí | 0 |
| `product_tags` | `InitDB.sql:111` | sí | 0 |
| `product_variants` | `InitDB.sql:89` | sí | 1 |
| `production_order_lines` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:149` | sí | 0 |
| `production_orders` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:93` | sí | 0 |
| `production_outputs` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:179` | sí | 0 |
| `products` | `InitDB.sql:77` | sí | 2 |
| `public_subscription_signup_events` | `ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:82` | — | 1 |
| `public_subscription_signups` | `ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:7` | sí | 1 |
| `purchase_order_lines` | `ADD_PURCHASE_ORDERS_CORE.sql:20` | sí | 4 |
| `purchase_orders` | `ADD_PURCHASE_ORDERS_CORE.sql:5` | sí | 4 |
| `purchase_return_lines` | `ADD_PURCHASE_RETURNS_CORE.sql:17` | sí | 2 |
| `purchase_returns` | `ADD_PURCHASE_RETURNS_CORE.sql:5` | sí | 3 |
| `purchases` | `ADD_PURCHASES_TABLE.sql:7` | sí | 1 |
| `role_menu_templates` | `ROLES_MENUS_SYSTEM.sql:74` | — | 2 |
| `role_menus` | `ROLES_MENUS_SYSTEM.sql:61` | — | 2 |
| `role_permissions` | `InitDB.sql:54` | — | 3 |
| `roles` | `InitDB.sql:41` | sí | 4 |
| `sale_counters` | `SpVistasFN.sql:13` | sí | 0 |
| `sale_line_batches` | `ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:316` | sí | 0 |
| `sale_lines` | `InitDB.sql:291` | sí | 6 |
| `sale_payments` | `InitDB.sql:305` | sí | 6 |
| `sale_return_lines` | `InitDB.sql:329` | sí | 0 |
| `sale_return_refunds` | `ADD_SALE_RETURNS_REFUNDS_V2.sql:5` | sí | 4 |
| `sale_returns` | `InitDB.sql:317` | sí | 3 |
| `sale_warnings` | `ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql:22` | sí | 0 |
| `sales` | `InitDB.sql:273` | sí | 5 |
| `service_deliveries` | `MANUFACTURING_PHASE1_BASE_TABLES.sql:232` | sí | 0 |
| `stock_alert_log` | `AddMinStock.sql:69` | sí | 2 |
| `stock_balances` | `InitDB.sql:361` | sí | 2 |
| `stock_balances_backup` | `ADD_EXPIRATION_BATCHES_PHASE2.sql:150` | — | 0 |
| `stock_reservations_log` | `PlanSepare.sql:154` | sí | 0 |
| `supplier_payable_payments` | `ADD_SUPPLIER_PAYABLES_CORE.sql:23` | sí | 2 |
| `supplier_payables` | `ADD_SUPPLIER_PAYABLES_CORE.sql:5` | sí | 4 |
| `system_alerts` | `FIX_STOCK_ALERTS_REALTIME.sql:43` | sí | 8 |
| `tax_rules` | `InitDB.sql:194` | sí | 2 |
| `taxes` | `InitDB.sql:183` | sí | 2 |
| `tenant_gateway_credentials` | `ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql:7` | sí | 1 |
| `tenant_invoices` | `ADD_TENANT_BILLING_MONETIZATION.sql:160` | sí | 0 |
| `tenant_payment_methods` | `ADD_TENANT_BILLING_MONETIZATION.sql:209` | sí | 0 |
| `tenant_payments` | `ADD_TENANT_BILLING_MONETIZATION.sql:187` | sí | 0 |
| `tenant_settings` | `InitDB.sql:212` | sí | 0 |
| `tenant_subscription_events` | `ADD_TENANT_BILLING_MONETIZATION.sql:138` | sí | 0 |
| `tenant_subscription_periods` | `ADD_TENANT_BILLING_MONETIZATION.sql:119` | sí | 0 |
| `tenant_subscriptions` | `ADD_TENANT_BILLING_MONETIZATION.sql:79` | sí | 0 |
| `tenants` | `InitDB.sql:7` | sí | 1 |
| `third_parties` | `ADD_THIRD_PARTIES.sql:11` | sí | 4 |
| `transfer_requests` | `ADD_TRANSFER_IN_TRANSIT_CORE.sql:5` | sí | 4 |
| `units_of_measure` | `CREATE_UNITS_OF_MEASURE.sql:21` | sí | 4 |
| `user_roles` | `InitDB.sql:60` | — | 3 |
| `users` | `InitDB.sql:30` | sí | 4 |

> Las rutas son relativas a `shared/supabase/migrations/`.

---

## 19. Apéndice B — Reproducibilidad y alcance

### 19.1 Comandos

```bash
# Inventario de objetos (sentencias + únicos + archivo:línea)
python3 tools/database/static_schema_scan.py --summary
python3 tools/database/static_schema_scan.py --json docs/database-portability/_data/static-scan.json

# Hechos derivados (tenant, RLS, sensibles, dependencias)
python3 tools/database/static_schema_analysis.py --json docs/database-portability/_data/static-analysis.json
```

### 19.2 Fuentes citadas

- [`InitDB.sql`](../../shared/supabase/migrations/InitDB.sql) — primer baseline (33 tablas).
- [`full_migration.sql`](../../shared/supabase/migrations/full_migration.sql) — baseline duplicado (34 tablas).
- [`SpVistasFN.sql`](../../shared/supabase/migrations/SpVistasFN.sql) — stock, vistas y `sp_create_sale`.
- [`RLS_Security.sql`](../../shared/supabase/migrations/RLS_Security.sql) — helpers de RLS.
- [`ADD_EXPIRATION_BATCHES_PHASE2.sql`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql) — tabla → matview.
- [`ADD_ASYNC_JOB_QUEUE.sql`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql) — cola de jobs.
- [`ADD_TENANT_BILLING_MONETIZATION.sql`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql) — facturación SaaS.
- [`PLAN_SEPARE_SETUP.md`](../../shared/supabase/migrations/PLAN_SEPARE_SETUP.md) y [`MANUFACTURING_ARCHITECTURE.md`](../../shared/supabase/migrations/MANUFACTURING_ARCHITECTURE.md) — documentación de dominio dentro del directorio de migraciones.

### 19.3 Lo que este documento **no** cubre (tareas siguientes)

| Tema | Tarea |
|---|---|
| Dependencias Supabase detalladas | #2 `supabase-dependencies.md` |
| Modelo de identidad | #3 `identity-schema-proposal.md` |
| Aislamiento multi-tenant y casos negativos | #4 `multitenancy-isolation.md` |
| Matriz de RPCs | #5 `rpc-migration-matrix.md` |
| Paginación e índices de listados | #6 `pagination-query-matrix.md` |
| Runbook de migración de datos | #7 `data-migration-runbook.md` |
| Scripts de validación contra base | #8 `tools/database/` |
