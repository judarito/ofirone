# Aislamiento multi-tenant — matriz, riesgos y estrategia portable

- **Fecha:** 2026-11-09
- **Tarea:** #4 de [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md)
- **Estado:** completada (análisis estático); sin ejecución contra DEV ni PROD
- **Entregable:** este documento
- **Insumos:** [`schema-inventory.md`](schema-inventory.md), [`supabase-dependencies.md`](supabase-dependencies.md), [`identity-implementation.md`](identity-implementation.md), [`_data/listings-and-rpcs.md`](_data/listings-and-rpcs.md), [`rpc-migration-matrix.md`](rpc-migration-matrix.md), [`baseline-proposal.md`](baseline-proposal.md)
- **Evidencia:** [`_data/static-analysis.json`](_data/static-analysis.json), [`_data/table-catalog.json`](_data/table-catalog.json), [`_data/supabase-deps.json`](_data/supabase-deps.json)
- **ADR relacionado:** [`ADR-003-aislamiento-multi-tenant.md`](../decisions/ADR-003-aislamiento-multi-tenant.md)
- **Fuente del esquema:** [`shared/supabase/migrations/`](../../shared/supabase/migrations/) (161 archivos `.sql`), ampliada con los archivos propios de [`web/migrations/`](../../web/migrations/) y [`mobile/migrations/`](../../mobile/migrations/)

> **Regla de lectura.** Todo conteo es de **sentencias DDL en archivos**, no del estado desplegado. DEV está conectable pero vacía (0 objetos) y PROD está bloqueado por política (el usuario no es de solo lectura), por lo que **no hay validación en base**. Donde el análisis estático no alcanza se escribe **«a verificar»**. Las rutas de evidencia son relativas a `shared/supabase/migrations/` salvo que se indique otro directorio.

---

## 1. Resumen ejecutivo

| Métrica | Valor | Fuente |
|---|---:|---|
| Tablas únicas en los tres directorios (sin matview) | **115** | [`_data/table-catalog.json`](_data/table-catalog.json) |
| Objetos con ámbito de tabla (115 tablas + `stock_balances`) | **116** | Apéndice A |
| Tablas canónicas en `shared/` | **100** | [`schema-inventory.md` §18](schema-inventory.md#18-apéndice-a--inventario-completo-de-tablas-100) |
| Objetos con `tenant_id` (incluye `tenants`, extras y matview) | **98** | §4 y apéndice A |
| Objetos sin `tenant_id` | **18** | 5 derivadas + 12 catálogos globales + 1 respaldo |
| Tablas puente sin `tenant_id` | **2** | `user_roles`, `role_permissions` |
| Tablas con `tenant_id` pero sin RLS (canónico) | **23** | [`schema-inventory.md` §15.3](schema-inventory.md#153-tablas-de-negocio-con-tenant_id-pero-sin-rls-23) |
| Tablas con RLS habilitado (canónico) | **74 de 100** | [`schema-inventory.md` §15.1](schema-inventory.md#151-cobertura) |
| **FK compuestas que incluyan `tenant_id`** | **0 detectadas** | §5.1 |
| Declaraciones `UNIQUE` que empiezan por `tenant_id` | **≥ 53** | §6.3 |
| Vistas materializadas sensibles | **1** (`stock_balances`) | §5.4 |
| SQLSTATE esperados en pruebas negativas | `42501`, `23503`, `23502`, `23505`, `23514` | §9 |

**Hallazgos que condicionan el aislamiento:**

1. **`tenant_id` es omnipresente pero no relacional.** 82 de las 100 tablas canónicas lo declaran, pero **ninguna FK histórica es compuesta** `(tenant_id, id)`: todas referencian solo el UUID del padre. La base garantiza que la fila exista, no que sea del mismo tenant.
2. **Las tablas puente no tienen tenant y su RLS de escritura no lo exige.** `user_roles` e `role_permissions` se protegen con `has_permission(...)` en `INSERT`/`DELETE`, sin comprobar que el rol y el usuario pertenezcan al mismo tenant ([`RLS_Security.sql:92-100`](../../shared/supabase/migrations/RLS_Security.sql#L92-L100), [`:182-190`](../../shared/supabase/migrations/RLS_Security.sql#L182-L190)).
3. **Hay columnas de tenant anulables o sin FK.** `third_parties.tenant_id` es `NULL`-able ([`ADD_THIRD_PARTIES.sql:13`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L13)); `audit_log.tenant_id` no tiene FK ([`InitDB.sql:375`](../../shared/supabase/migrations/InitDB.sql#L375)); seis tablas de facturación declaran `tenant_id` sin FK en el `CREATE` y la añaden dinámicamente ([`ADD_TENANT_BILLING_MONETIZATION.sql:276-279`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L276-L279)).
4. **Las funciones críticas confían en `p_tenant`.** `sp_create_sale` valida variante, caja y método de pago por tenant, pero **no valida** que `p_location`, `p_customer` ni `p_sold_by` pertenezcan a `p_tenant` ([`SpVistasFN.sql:178`](../../shared/supabase/migrations/SpVistasFN.sql#L178), [`:189-201`](../../shared/supabase/migrations/SpVistasFN.sql#L189-L201), [`:220-221`](../../shared/supabase/migrations/SpVistasFN.sql#L220-L221), [`:301`](../../shared/supabase/migrations/SpVistasFN.sql#L301)).
5. **`stock_balances` es una vista materializada** ([`ADD_EXPIRATION_BATCHES_PHASE2.sql:165`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L165)): no admite políticas RLS. Cualquier rol con `SELECT` sobre ella ve todos los tenants.
6. **27 tablas canónicas no tienen RLS** y 23 de ellas sí tienen `tenant_id`; el aislamiento depende de `GRANT` y de que la aplicación filtre. Los `GRANT` reales no se verificaron ([`schema-inventory.md` §15.3](schema-inventory.md#153-tablas-de-negocio-con-tenant_id-pero-sin-rls-23)).
7. **La autorización histórica está acoplada a `auth.uid()`**: 207 de 223 políticas dependen de identidad Supabase, directa o indirectamente ([`supabase-dependencies.md` §7.1](supabase-dependencies.md#71-conteo)). Sin Supabase, RLS no funciona tal cual.
8. **Los workers son globales por diseño.** `fn_claim_async_jobs` reclama jobs de todos los tenants sin filtro ([`ADD_ASYNC_JOB_QUEUE.sql:219-249`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L219-L249)); `fn_complete_async_job` y `fn_fail_async_job` no validan `locked_by` ni el lease ([`:258-287`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L258-L287), [`:312-356`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L312-L356)). Es un privilegio de worker, no de tenant.

**Decisión recomendada:** el aislamiento primario debe ser **de aplicación** (tenant resuelto desde identidad/membresía y validado antes de cada operación) y reforzarse en PostgreSQL con `tenant_id NOT NULL`, **FK compuestas**, unicidad con alcance de tenant y, opcionalmente, RLS portable con `app.tenant_id`. RLS no sustituye la autorización de Go ni corrige datos ya cruzados.

---

## 2. Metodología y límites

### 2.1 Qué se hizo

1. Lectura estática de las definiciones de tablas de los tres directorios y de las políticas RLS de `shared/`, `web/` y `mobile/`.
2. Extracción de columnas `tenant_id`, FKs inline, `UNIQUE`, PK y políticas por tabla desde [`_data/static-analysis.json`](_data/static-analysis.json) y [`_data/table-catalog.json`](_data/table-catalog.json).
3. Búsqueda específica de FK compuestas (`foreign key (tenant_id, …)`) y de `UNIQUE` con prefijo `tenant_id`.
4. Revisión puntual de funciones críticas (`sp_create_sale`, `sp_create_purchase`, `sp_create_layaway`, `fn_allocate_stock_fefo`, `fn_claim_async_jobs`) y de los helpers de RLS.
5. Comparación con el baseline de identidad ya implementado en [`database/migrations/`](../../database/migrations/), que sí usa FK compuestas y contexto `app.tenant_id`.

### 2.2 Límites explícitos

- **No es un parser SQL.** El DDL dinámico (`EXECUTE format(...)`), las columnas añadidas con `ALTER TABLE` y las políticas creadas en bloques `DO` pueden quedar fuera del conteo.
- **No hay observación del esquema desplegado.** No se consultaron `pg_constraint`, `pg_policies`, `pg_class` ni `pg_proc`; DEV está vacía y PROD bloqueado.
- **No se verificaron `GRANT`/`REVOKE`.** Una tabla sin RLS no está necesariamente expuesta, pero tampoco protegida por política.
- **No se analizaron los cuerpos de las 46 vistas** (solo su definición); las dependencias vista→tabla y el uso de `security_invoker` quedan **a verificar**.
- **No hay datos.** No se pueden contar filas huérfanas ni asociaciones cruzadas ya existentes; las pruebas de §9 están **diseñadas, no ejecutadas**.
- **El universo es 115 tablas + 1 vista materializada = 116 objetos**, no 100: incluye 16 tablas que solo existen en `web/migrations/` o `mobile/migrations/` (módulo contable, notificaciones, media, idempotencia móvil). Se marcan como «Extra» en el apéndice A.

---

## 3. Modelo de tenancy observado

### 3.1 Raíz y pertenencia

| Elemento | Situación actual | Evidencia |
|---|---|---|
| Raíz | `tenants(tenant_id uuid pk)`; el resto cuelga de ella por `tenant_id` | [`InitDB.sql:7-14`](../../shared/supabase/migrations/InitDB.sql#L7-L14) |
| Usuario | `users` tiene `tenant_id` **directo** y `auth_user_id` único; un usuario pertenece a un solo tenant | [`InitDB.sql:30-39`](../../shared/supabase/migrations/InitDB.sql#L30-L39) |
| Roles | `roles` es local al tenant (`unique (tenant_id, name)`) | [`InitDB.sql:41-46`](../../shared/supabase/migrations/InitDB.sql#L41-L46) |
| Permisos | `permissions` es un catálogo **global** (`code unique`), sin `tenant_id` | [`InitDB.sql:48-52`](../../shared/supabase/migrations/InitDB.sql#L48-L52) |
| Asignaciones | `role_permissions` y `user_roles` son puentes sin `tenant_id` | [`InitDB.sql:54-64`](../../shared/supabase/migrations/InitDB.sql#L54-L64) |
| Membresías múltiples | **No existen** en el esquema histórico; el baseline nuevo introduce `identities` + `tenant_memberships` | [`identity-implementation.md:10-18`](identity-implementation.md#L10-L18), [`0002_identity.up.sql:4-34`](../../database/migrations/0002_identity.up.sql#L4-L34) |

**Consecuencia:** el modelo histórico es «un usuario = un tenant». Para que una persona opere en dos tenants hacen falta dos filas `users` (y dos cuentas de Auth), lo que duplica identidad y PII. El baseline nuevo separa identidad global de membresía por tenant y permite varias membresías; esa es la dirección recomendada por [`ADR-003`](../decisions/ADR-003-aislamiento-multi-tenant.md).

### 3.2 Clases de ámbito

| Clase | Regla | Ejemplos | Nº (canónico) |
|---|---|---|---:|
| **Raíz** | La PK **es** el tenant | `tenants` | 1 |
| **Directo** | Normalmente declara `tenant_id NOT NULL` y FK a `tenants`; el acceso se filtra por esa columna. Incluye `stock_balances` (matview) y `units_of_measure` (nullable) | `sales`, `products`, `inventory_batches` | 81 |
| **Directo opcional** | `tenant_id` nullable por diseño (catálogo de sistema) | `units_of_measure` | — |
| **Derivado** | No declara tenant; lo hereda por FK de un padre con tenant | `user_roles`, `role_permissions`, `async_job_attempts`, `bulk_import_errors`, `public_subscription_signup_events` | 5 |
| **Global** | Catálogo compartido por todos los tenants; lectura común | `permissions`, `billing_plans*`, `menu_items`, `cities` | 12 |
| **Legado / sin ámbito** | Copia de respaldo sin `tenant_id`; no debe formar parte del baseline | `stock_balances_backup` | 1 |
| **Total canónico** | 1 + 81 + 5 + 12 + 1 | — | **100** |

### 3.3 Cobertura por dominio

| Dominio | Tablas representativas | Ámbito | Hueco principal |
|---|---|---|---|
| Ventas y caja | `sales`, `sale_lines`, `sale_payments`, `sale_returns`, `cash_sessions`, `cash_movements` | Directo | FK de una columna; `sale_line_batches.sale_line_id` sin FK |
| Inventario | `inventory_moves`, `inventory_batches`, `stock_balances`, `stock_reservations_log` | Directo / matview | `stock_balances` sin RLS; `inventory_moves` con FKs simples |
| Catálogo | `products`, `product_variants`, `product_barcodes`, `price_list_items`, `product_tag_map` | Directo | `price_list_items` y `product_tag_map` tienen PK con tenant pero FK simples |
| Compras | `purchases`, `purchase_orders`, `purchase_order_lines`, `supplier_payables` | Directo | `purchase_orders` sin número único; FK a `third_parties`/`purchases` simple |
| Manufactura | `bill_of_materials`, `bom_components`, `production_orders`, `component_allocations` | Directo | `bom_components.component_variant_id` y `production_order_lines.batch_id` sin tenant |
| Terceros / cartera | `third_parties`, `customers`, `customer_credit_accounts`, `customer_credit_movements` | Directo | `third_parties.tenant_id` nullable; PII duplicada |
| Tienda online | `online_stores`, `online_store_catalog`, `online_orders`, `online_order_lines` | Directo | `online_store_catalog` único por `(store_id, variant_id)`, sin tenant |
| Facturación SaaS | `tenant_subscriptions`, `tenant_invoices`, `tenant_payments`, `tenant_payment_methods` | Directo | `tenant_id` sin FK en el `CREATE`; hijos con FK simple |
| Identidad / RBAC | `users`, `roles`, `permissions`, `user_roles`, `role_permissions` | Directo / global / derivado | Puentes sin tenant; RLS de escritura solo por permiso |
| Soporte / jobs | `async_jobs`, `async_job_attempts`, `bulk_imports`, `bulk_import_errors`, `audit_log` | Directo / derivado | Attempts y errores sin tenant; `audit_log` sin FK |
| Contabilidad (extra web) | `accounting_entries`, `accounting_entry_lines`, `accounting_event_queue` | Directo | Fuera de `shared/`; no inventariado en la tarea #1 |
| Notificaciones (extra móvil) | `notifications`, `notification_events`, `user_push_devices` | Directo | Fuera de `shared/`; RLS a verificar |

---

## 4. Matriz de tablas

La matriz completa de los **116 objetos** (115 tablas + la vista materializada `stock_balances`) está en el [apéndice A](#apéndice-a--matriz-completa-de-116-objetos). Columnas: tabla, ámbito, definición con `archivo:línea` y observación.

**Casos especiales que requieren decisión explícita:**

| Tabla | Ámbito | Evidencia | Problema |
|---|---|---|---|
| `tenants` | Raíz | [`InitDB.sql:7`](../../shared/supabase/migrations/InitDB.sql#L7) | `tenant_id` es PK; no hay columna separada de tenant |
| `third_parties` | Directo | [`ADD_THIRD_PARTIES.sql:13`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L13) | `tenant_id` **nullable**; `ON CONFLICT (tenant_id, document_number)` sin `UNIQUE` que lo respalde ([`:281`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L281)) |
| `units_of_measure` | Directo opcional | [`CREATE_UNITS_OF_MEASURE.sql:21-41`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L21-L41) | Filas globales (`tenant_id IS NULL`, `is_system = true`) junto a filas de tenant |
| `audit_log` | Directo | [`InitDB.sql:375`](../../shared/supabase/migrations/InitDB.sql#L375) | `tenant_id` sin FK; actor `user_id` sin FK |
| `tenant_subscriptions` y satélites | Directo | [`ADD_TENANT_BILLING_MONETIZATION.sql:79-111`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L79-L111) | `tenant_id` sin FK en el `CREATE`; FK añadida dinámicamente ([`:276-279`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L276-L279)) |
| `stock_balances` | Directo (matview) | [`ADD_EXPIRATION_BATCHES_PHASE2.sql:160-165`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L160-L165) | Vista materializada: **no admite RLS**; el `DROP TABLE` previo eliminó PK y políticas |
| `sale_line_batches` | Directo | [`ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:316-329`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql#L316-L329) | `sale_line_id` sin FK; `sale_id` y `batch_id` con FK simple; sin `UNIQUE` de asignación |
| `online_store_catalog` | Directo | [`ADD_ONLINE_STORE_MVP.sql:182-195`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L182-L195) | `UNIQUE (store_id, variant_id)` sin `tenant_id`; variante de otro tenant permitida por FK |
| `online_orders` | Directo | [`ADD_ONLINE_STORE_MVP.sql:202-228`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L202-L228) | `sale_id` único **global**; sin `UNIQUE (tenant_id, order_number)` |
| `user_roles` | Derivado | [`InitDB.sql:60-64`](../../shared/supabase/migrations/InitDB.sql#L60-L64) | Sin tenant; RLS de `INSERT` solo exige permiso |
| `role_permissions` | Derivado | [`InitDB.sql:54-58`](../../shared/supabase/migrations/InitDB.sql#L54-L58) | Sin tenant; rol y permiso pueden ser de ámbitos distintos |
| `async_job_attempts` | Derivado | [`ADD_ASYNC_JOB_QUEUE.sql:75-93`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L75-L93) | Sin tenant; RLS por `EXISTS` sobre `async_jobs` |
| `bulk_import_errors` | Derivado | [`CREATE_BULK_IMPORT_TRACKING.sql:24-32`](../../shared/supabase/migrations/CREATE_BULK_IMPORT_TRACKING.sql#L24-L32) | Sin tenant; RLS por `EXISTS` sobre `bulk_imports` |
| `public_subscription_signup_events` | Derivado | [`ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:82`](../../shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql#L82) | Sin tenant; RLS por `EXISTS` sobre el signup |
| `stock_balances_backup` | Legado | [`ADD_EXPIRATION_BATCHES_PHASE2.sql:150`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L150) | Sin `tenant_id`; copia de respaldo, no baseline |

---

## 5. Riesgos de acceso cruzado en las relaciones actuales

### 5.1 FK de una sola columna (riesgo estructural)

Todas las FK observadas referencian una sola columna. Ejemplos representativos:

| Tabla hija | Columna | Padre | Evidencia | Qué **no** impide |
|---|---|---|---|---|
| `sales` | `location_id` | `locations(location_id)` | [`InitDB.sql:276`](../../shared/supabase/migrations/InitDB.sql#L276) | Venta del tenant A en sede del tenant B |
| `sales` | `customer_id` | `customers(customer_id)` | [`InitDB.sql:281`](../../shared/supabase/migrations/InitDB.sql#L281) | Venta A con cliente B |
| `sales` | `sold_by` | `users(user_id)` | [`InitDB.sql:282`](../../shared/supabase/migrations/InitDB.sql#L282) | Venta A atribuida a usuario B |
| `sale_lines` | `sale_id` | `sales(sale_id)` | [`InitDB.sql:294`](../../shared/supabase/migrations/InitDB.sql#L294) | Línea A colgada de venta B |
| `sale_lines` | `variant_id` | `product_variants(variant_id)` | [`InitDB.sql:295`](../../shared/supabase/migrations/InitDB.sql#L295) | Línea A con variante B |
| `sale_payments` | `payment_method_id` | `payment_methods(payment_method_id)` | [`InitDB.sql:309`](../../shared/supabase/migrations/InitDB.sql#L309) | Pago A con método B |
| `sale_returns` | `sale_id` | `sales(sale_id)` | [`InitDB.sql:320`](../../shared/supabase/migrations/InitDB.sql#L320) | Devolución A sobre venta B |
| `inventory_moves` | `location_id` | `locations(location_id)` | [`InitDB.sql:348`](../../shared/supabase/migrations/InitDB.sql#L348) | Movimiento A en sede B |
| `customer_credit_accounts` | `customer_id` | `customers(customer_id)` | [`InitDB.sql:161`](../../shared/supabase/migrations/InitDB.sql#L161) | Cuenta de crédito A para cliente B |
| `bom_components` | `component_variant_id` | `product_variants(variant_id)` | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:67`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L67) | BOM A con componente B |
| `production_order_lines` | `batch_id` | `inventory_batches(batch_id)` | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:162`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L162) | Orden A consume lote B |
| `online_store_catalog` | `variant_id` | `product_variants(variant_id)` | [`ADD_ONLINE_STORE_MVP.sql:186`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L186) | Tienda A publica variante B |
| `online_orders` | `sale_id` | `sales(sale_id)` | [`ADD_ONLINE_STORE_MVP.sql:206`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L206) | Pedido A enlazado a venta B |
| `layaway_items` | `layaway_id` | `layaway_contracts(layaway_id)` | [`PlanSepare.sql:123`](../../shared/supabase/migrations/PlanSepare.sql#L123) | Artículo A en contrato B |
| `layaway_contracts` | `customer_id` | `customers(customer_id)` | [`PlanSepare.sql:94`](../../shared/supabase/migrations/PlanSepare.sql#L94) | Separado A con cliente B |
| `purchase_orders` | `supplier_id` | `third_parties(third_party_id)` | [`ADD_PURCHASE_ORDERS_CORE.sql:8`](../../shared/supabase/migrations/ADD_PURCHASE_ORDERS_CORE.sql#L8) | Orden A a proveedor B |
| `supplier_payables` | `purchase_id` | `purchases(purchase_id)` | [`ADD_SUPPLIER_PAYABLES_CORE.sql:10`](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L10) | CxP A sobre compra B |

**Por qué importa:** una FK de una columna solo garantiza integridad referencial global. Si un caso de uso acepta un UUID del cliente (o de un JSON) y no lo valida contra el tenant del contexto, la base **acepta** la asociación cruzada. La defensa no puede ser solo «el frontend no envía eso».

**Ejemplo concreto en una función:** `sp_create_sale` recibe `p_location`, `p_customer` y `p_sold_by` y los inserta sin comprobar su tenant ([`SpVistasFN.sql:189-201`](../../shared/supabase/migrations/SpVistasFN.sql#L189-L201)). Sí valida la sesión de caja ([`:178`](../../shared/supabase/migrations/SpVistasFN.sql#L178)), la variante ([`:220-221`](../../shared/supabase/migrations/SpVistasFN.sql#L220-L221)) y el método de pago ([`:301`](../../shared/supabase/migrations/SpVistasFN.sql#L301)); la asimetría es el riesgo.

### 5.2 Tablas puente sin tenant

`user_roles` y `role_permissions` no declaran `tenant_id` ([`InitDB.sql:54-64`](../../shared/supabase/migrations/InitDB.sql#L54-L64)). Su lectura se filtra por `EXISTS` contra `roles` o `users`, pero la escritura no:

- `user_roles_insert_policy` solo exige `has_permission('SECURITY.USERS.MANAGE')` ([`RLS_Security.sql:92-95`](../../shared/supabase/migrations/RLS_Security.sql#L92-L95)).
- `user_roles_delete_policy` solo exige el mismo permiso ([`:97-100`](../../shared/supabase/migrations/RLS_Security.sql#L97-L100)).
- `role_permissions_insert_policy` y `_delete_policy` tienen el mismo patrón ([`:182-190`](../../shared/supabase/migrations/RLS_Security.sql#L182-L190)).

**Escenario:** un administrador del tenant A, con `SECURITY.USERS.MANAGE`, inserta `(user_id de A, role_id de B)`. La PK `(user_id, role_id)` lo permite; no hay FK compuesta ni `WITH CHECK` de tenant. El usuario de A obtiene un rol de B. El `SELECT` posterior puede no verlo, pero la fila existe y un `SECURITY DEFINER` o un worker que consulte `user_roles` sin el mismo filtro sí lo aplicará.

`role_permissions` es menos grave porque `permissions` es global; el riesgo es asignar permisos a un rol de otro tenant si se conoce su UUID y se tiene el privilegio.

### 5.3 Tenant anulable, sin FK o desacoplado

| Caso | Evidencia | Riesgo |
|---|---|---|
| `third_parties.tenant_id` nullable | [`ADD_THIRD_PARTIES.sql:13`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L13) | Tercero «global» visible o reutilizable por cualquier tenant; RLS compara `u.tenant_id = third_parties.tenant_id` y un `NULL` no coincide, pero la fila sigue existiendo |
| `audit_log.tenant_id` sin FK | [`InitDB.sql:375`](../../shared/supabase/migrations/InitDB.sql#L375) | Auditoría atribuible a un tenant inexistente o arbitrario |
| Facturación: `tenant_id` y `subscription_id` independientes | [`ADD_TENANT_BILLING_MONETIZATION.sql:160-178`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L160-L178) | `tenant_invoices` puede tener `tenant_id = A` y `subscription_id` de B: las dos FK no se validan entre sí |
| `tenant_subscriptions.tenant_id` sin FK inicial | [`ADD_TENANT_BILLING_MONETIZATION.sql:81`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L81) | Durante la ventana entre `CREATE` y `ALTER`, la integridad depende de la aplicación; la FK se añade condicionalmente ([`:276-279`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L276-L279)) |
| `tenant_settings` PK = `tenant_id` | [`InitDB.sql:213`](../../shared/supabase/migrations/InitDB.sql#L213) | Correcto, pero una fila por tenant; no hay `settings` globales |
| `units_of_measure` nullable | [`CREATE_UNITS_OF_MEASURE.sql:23`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L23) | Las unidades de sistema son globales por diseño; el `CHECK` exige `tenant_id IS NULL AND is_system = TRUE` ([`:43-48`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L43-L48)) |

### 5.4 RLS incompleta o no portable

1. **Cobertura desigual.** 27 tablas canónicas no tienen RLS; 23 de ellas tienen `tenant_id` y son de negocio (`audit_log`, `bill_of_materials`, `bom_components`, `categories`, `component_allocations`, `customer_credit_accounts`, `inventory_batches`, `price_list_items`, `price_lists`, `product_barcodes`, `product_tag_map`, `product_tags`, `production_order_lines`, `production_orders`, `production_outputs`, `sale_counters`, `sale_line_batches`, `sale_return_lines`, `sale_warnings`, `service_deliveries`, `stock_reservations_log`, `tenant_settings`, `bundle_compositions`) ([`schema-inventory.md` §15.3](schema-inventory.md#153-tablas-de-negocio-con-tenant_id-pero-sin-rls-23)).
2. **La RLS depende de Supabase.** `get_current_user_tenant_id()` resuelve `users.auth_user_id = auth.uid()` ([`RLS_Security.sql:6-14`](../../shared/supabase/migrations/RLS_Security.sql#L6-L14)); `has_permission` hace lo mismo ([`:16-27`](../../shared/supabase/migrations/RLS_Security.sql#L16-L27)). En PostgreSQL limpio, `auth.uid()` no existe.
3. **Políticas de escritura incompletas.** Varias políticas `INSERT`/`UPDATE` exigen permiso pero no reproducen la condición de tenant; los puentes son el caso extremo (§5.2).
4. **Vistas sin `security_invoker`.** Las vistas se ejecutan con permisos del owner; la RLS del invocador no se aplica salvo que se declare `security_invoker = true` (PG15+) o se controlen los `GRANT`. Solo hay 7 usos de `security_invoker` en el corpus ([`schema-inventory.md` §6](schema-inventory.md#6-vistas-y-vistas-materializadas)).
5. **Vista materializada.** `stock_balances` no puede tener RLS; si se le concede `SELECT`, el filtro por tenant queda en manos de la consulta ([`ADD_EXPIRATION_BATCHES_PHASE2.sql:165`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L165)).
6. **Sin contexto se deniega, pero mal configurado se abre.** El patrón `current_setting('app.current_tenant', true)` devuelve `NULL` si falta; `NULL` no coincide y deniega. Pero si se usa `SET` de sesión (no `SET LOCAL`), el valor sobrevive en la conexión del pool y el siguiente request puede heredar el tenant anterior.

### 5.5 Funciones que confían en el parámetro de tenant

| Función | Validaciones de tenant observadas | Validaciones ausentes | Evidencia |
|---|---|---|---|
| `sp_create_sale` | Caja, variante, método de pago | `p_location`, `p_customer`, `p_sold_by` | [`SpVistasFN.sql:178`](../../shared/supabase/migrations/SpVistasFN.sql#L178), [`:220-221`](../../shared/supabase/migrations/SpVistasFN.sql#L220-L221), [`:301`](../../shared/supabase/migrations/SpVistasFN.sql#L301) |
| `sp_create_purchase` | Variante por tenant | `p_location`, `p_supplier_id`, `p_created_by` | [`ADD_PURCHASES_TABLE.sql:34-79`](../../shared/supabase/migrations/ADD_PURCHASES_TABLE.sql#L34-L79) |
| `sp_create_layaway` | Artículos y totales por tenant | `customer_id`, `location_id`, `created_by` | [`PlanSepare.sql:227-273`](../../shared/supabase/migrations/PlanSepare.sql#L227-L273) |
| `fn_claim_async_jobs` | **Ninguna** por tenant: es un worker global | El worker decide qué tenant procesar | [`ADD_ASYNC_JOB_QUEUE.sql:219-249`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L219-L249) |
| `fn_complete_async_job` / `fn_fail_async_job` | Solo `job_id` | `locked_by`, lease, tenant | [`ADD_ASYNC_JOB_QUEUE.sql:258-287`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L258-L287), [`:312-356`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L312-L356) |
| `fn_allocate_stock_fefo` | `tenant_id`, `location_id`, `variant_id` en el cursor FEFO | — (correcto) | [`ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:70-89`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql#L70-L89) |

**Consecuencia:** el parámetro `p_tenant` es una **afirmación del llamador**, no una prueba. Si Go lo deriva del token y además valida cada UUID contra ese tenant, el riesgo se reduce; si lo deriva de un parámetro de la petición, el aislamiento se pierde antes de llegar a SQL.

### 5.6 Matriz de riesgos

| ID | Riesgo | Severidad | Impacto | Control principal |
|---|---|:--:|---|---|
| R1 | FK de una columna permite asociaciones A↔B | **Alta** | Fuga o corrupción silenciosa de datos entre tenants | FK compuestas + validación Go |
| R2 | Puentes `user_roles`/`role_permissions` sin tenant | **Alta** | Escalada de privilegios entre tenants | `tenant_id` + FK compuestas + RLS |
| R3 | `third_parties.tenant_id` nullable | Media | Terceros globales; PII compartida | `NOT NULL` + unicidad por tenant |
| R4 | 23 tablas de negocio sin RLS | **Alta** | Acceso directo si el rol tiene `SELECT` | Grants mínimos + RLS opcional |
| R5 | `stock_balances` matview sin RLS | **Alta** | Inventario de todos los tenants | Vista normal o filtro obligatorio; no grant amplio |
| R6 | Funciones confían en `p_tenant` | **Alta** | Asociaciones cruzadas vía RPC | Validar cada ID en Go + FK compuestas |
| R7 | Worker global sin lease/tenant | Media-Alta | Cerrar o reintentar jobs de otro tenant | Claim por tenant o lease + `locked_by` |
| R8 | `auth.uid()` en políticas | **Alta** (portabilidad) | RLS no funciona fuera de Supabase | Contexto `app.tenant_id` (§8) |
| R9 | Vistas sin `security_invoker` | Media | RLS evadida a través de vistas | `security_invoker` + grants |
| R10 | `SET` de sesión en lugar de `SET LOCAL` | Media | Fuga entre requests del pool | `set_config(..., true)` y pruebas de pool |
| R11 | Datos ya cruzados en PROD | **Alta** (desconocida) | Migrar la fuga | Consultas de huérfanos antes de migrar |

---

## 6. Constraints, claves compuestas e índices con alcance de tenant

### 6.1 Reglas propuestas

1. **Toda tabla de negocio con tenant debe declarar `tenant_id uuid NOT NULL REFERENCES tenants(tenant_id)`.** Excepciones explícitas: catálogos globales y unidades de sistema.
2. **Toda tabla padre con ámbito de tenant debe exponer una clave candidata `(tenant_id, <pk>)`.** La PK puede seguir siendo el UUID; se añade `UNIQUE (tenant_id, <pk>)` para que sea referenciable.
3. **Toda FK entre entidades de tenant debe ser compuesta:** `FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, parent_id)`. La FK de una columna se conserva solo si el padre es global.
4. **Toda clave de negocio única debe incluir `tenant_id`:** `UNIQUE (tenant_id, sku)`, `(tenant_id, document_number)`, `(tenant_id, order_number)`, etc.
5. **Las tablas derivadas deben recibir `tenant_id`** (recomendado) o, como mínimo, una FK compuesta al padre y una política RLS con `EXISTS`. Añadirlo simplifica RLS, índices y reconciliación; el coste es denormalización controlada por FK.
6. **`tenant_id` no debe poder cambiar.** Se logra con `REVOKE UPDATE (tenant_id)` o un trigger que lo impida; `WITH CHECK` de RLS también lo bloquea.
7. **Los índices de acceso deben empezar por `tenant_id`** y continuar con el filtro/orden real. Los índices globales por UUID suelto no sirven para listados multi-tenant.

### 6.2 Patrón SQL

```sql
-- 1) Clave candidata del padre (la PK sigue siendo sale_id)
ALTER TABLE sales
  ADD CONSTRAINT uq_sales_tenant_sale UNIQUE (tenant_id, sale_id);

-- 2) FK compuesta del hijo: no puede apuntar a una venta de otro tenant
ALTER TABLE sale_lines
  ADD CONSTRAINT fk_sale_lines_sale_tenant
  FOREIGN KEY (tenant_id, sale_id)
  REFERENCES sales (tenant_id, sale_id)
  ON DELETE CASCADE;

-- 3) Unicidad de negocio con alcance de tenant
ALTER TABLE third_parties
  ALTER COLUMN tenant_id SET NOT NULL,
  ADD CONSTRAINT uq_third_parties_tenant_document
  UNIQUE (tenant_id, document_number);

-- 4) Índice para listados y RLS
CREATE INDEX ix_sale_lines_tenant_sale
  ON sale_lines (tenant_id, sale_id, sale_line_id);
```

Para una tabla puente:

```sql
ALTER TABLE user_roles ADD COLUMN tenant_id uuid;
UPDATE user_roles ur
   SET tenant_id = u.tenant_id
  FROM users u
 WHERE u.user_id = ur.user_id;
ALTER TABLE user_roles ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE user_roles
  ADD CONSTRAINT fk_user_roles_user_tenant
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, user_id),
  ADD CONSTRAINT fk_user_roles_role_tenant
    FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, role_id);
```

> El `UPDATE` de backfill requiere que `users` y `roles` tengan `UNIQUE (tenant_id, user_id)` / `(tenant_id, role_id)`. En el baseline nuevo ya existen claves equivalentes ([`0002_identity.up.sql:27-29`](../../database/migrations/0002_identity.up.sql#L27-L29), [`:43-44`](../../database/migrations/0002_identity.up.sql#L43-L44), [`:62-80`](../../database/migrations/0002_identity.up.sql#L62-L80)).

### 6.3 Constraints faltantes priorizados

| # | Tabla | Constraint faltante | Evidencia | Prioridad |
|---:|---|---|---|:--:|
| 1 | `user_roles` | `tenant_id` + FK compuestas a `users` y `roles` | [`InitDB.sql:60-64`](../../shared/supabase/migrations/InitDB.sql#L60-L64) | P0 |
| 2 | `role_permissions` | `tenant_id` + FK compuesta a `roles` | [`InitDB.sql:54-58`](../../shared/supabase/migrations/InitDB.sql#L54-L58) | P0 |
| 3 | `sales` / `sale_lines` / `sale_payments` | `UNIQUE (tenant_id, sale_id)` y FK compuestas | [`InitDB.sql:273-314`](../../shared/supabase/migrations/InitDB.sql#L273-L314) | P0 |
| 4 | `sale_line_batches` | FK `(tenant_id, sale_line_id)`; `UNIQUE (tenant_id, sale_line_id, batch_id)` | [`ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:316-329`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql#L316-L329) | P0 |
| 5 | `third_parties` | `tenant_id NOT NULL`; `UNIQUE (tenant_id, document_number)` | [`ADD_THIRD_PARTIES.sql:13`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L13), [`:62`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L62), [`:281`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L281) | P0 |
| 6 | `online_store_catalog` | `UNIQUE (tenant_id, store_id, variant_id)` y FK compuesta a variante | [`ADD_ONLINE_STORE_MVP.sql:182-195`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L182-L195) | P1 |
| 7 | `online_orders` | `UNIQUE (tenant_id, order_number)`; `sale_id` compuesto con tenant | [`ADD_ONLINE_STORE_MVP.sql:202-228`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L202-L228) | P1 |
| 8 | `bom_components` / `production_order_lines` / `component_allocations` | FK compuestas a variante/lote | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:67`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L67), [`:162`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L162), [`:276`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L276) | P1 |
| 9 | `tenant_invoices`, `tenant_payments`, `tenant_subscription_periods` | `tenant_id` con FK; FK compuesta al padre | [`ADD_TENANT_BILLING_MONETIZATION.sql:119-204`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L119-L204) | P1 |
| 10 | `audit_log` | FK `tenant_id` a `tenants` | [`InitDB.sql:375`](../../shared/supabase/migrations/InitDB.sql#L375) | P2 |
| 11 | `async_job_attempts` / `bulk_import_errors` / `public_subscription_signup_events` | `tenant_id` o FK compuesta al padre | [`ADD_ASYNC_JOB_QUEUE.sql:75`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L75), [`CREATE_BULK_IMPORT_TRACKING.sql:24`](../../shared/supabase/migrations/CREATE_BULK_IMPORT_TRACKING.sql#L24), [`ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:82`](../../shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql#L82) | P2 |
| 12 | `stock_balances` | No aplica a matview; decidir vista normal | [`ADD_EXPIRATION_BATCHES_PHASE2.sql:160-165`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L160-L165) | P1 |

**Nota sobre `ON CONFLICT`:** `ADD_THIRD_PARTIES.sql:281` usa `ON CONFLICT (tenant_id, document_number)`, pero solo existe un índice **no único** en `(tenant_id, document_number)` ([`:62`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L62)). PostgreSQL exige un índice único o una restricción para inferir el conflicto; ese `INSERT` puede fallar al ejecutarse. **A verificar** en el estado desplegado.

### 6.4 Índices recomendados

| Consulta | Índice candidato | Motivo |
|---|---|---|
| Listado de ventas por fecha | `(tenant_id, sold_at DESC, sale_id DESC)` | Filtro y cursor; ya existe `ix_sales_tenant_date` sin desempate ([`InitDB.sql:388`](../../shared/supabase/migrations/InitDB.sql#L388)) |
| Stock por variante/sede | `(tenant_id, location_id, variant_id)` | Ya existe ([`InitDB.sql:392`](../../shared/supabase/migrations/InitDB.sql#L392)); conservar |
| Kardex | `(tenant_id, variant_id, location_id, created_at DESC)` | Ya existe ([`InitDB.sql:391`](../../shared/supabase/migrations/InitDB.sql#L391)) |
| Lotes FEFO | `(tenant_id, location_id, variant_id, expiration_date NULLS LAST, received_at)` | Ya existe parcial ([`ADD_EXPIRATION_BATCHES_PHASE2.sql:72-75`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L72-L75)) |
| CxP por estado | `(tenant_id, status, due_date)` | Falta índice específico; existe por `created_at` ([`ADD_SUPPLIER_PAYABLES_CORE.sql:34`](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L34)) |
| Jobs por tenant | `(tenant_id, queue, status, run_after)` | El claim es global; si se hace por tenant, este índice es obligatorio |
| Puentes RBAC | `(tenant_id, user_id)` / `(tenant_id, role_id)` | Sin `tenant_id` no se puede indexar por tenant |

**Regla:** un índice único global del tipo `UNIQUE (document_number)` impide que dos tenants tengan el mismo documento. Eso puede ser deseable para un catálogo global, pero **no** para datos de negocio. Revisar cada `UNIQUE` de una columna y decidir si debe incorporar `tenant_id`.

---

## 7. Controles que quedan en PostgreSQL y cuáles en Go

| Control | Responsable | Justificación | Evidencia / nota |
|---|---|---|---|
| Tipo, `NOT NULL`, `CHECK`, precisión monetaria | **PostgreSQL** | Invariantes locales baratas y no eludibles por la API | `numeric(14,2)` en [`InitDB.sql:286`](../../shared/supabase/migrations/InitDB.sql#L286) |
| Integridad referencial y FK compuestas | **PostgreSQL** | La base impide asociaciones cruzadas aunque el código falle | §6 |
| Unicidad de claves de negocio con tenant | **PostgreSQL** | Concurrencia y duplicados | §6.3 |
| Inmutabilidad de `tenant_id` | **PostgreSQL** | `REVOKE UPDATE` o trigger | Propuesta |
| RLS portable (defensa en profundidad) | **PostgreSQL** | Limita daño si un repositorio olvida el filtro | §8 |
| Transacciones, locks, `FOR UPDATE`, contadores | **PostgreSQL** | Atomicidad real; no se puede simular en Go | [`SpVistasFN.sql:13-35`](../../shared/supabase/migrations/SpVistasFN.sql#L13-L35) |
| `SECURITY DEFINER` y `search_path` | **PostgreSQL** | Primitivas estrechas; sin `auth.*` | 38 funciones sin `search_path` ([`schema-inventory.md` §7](schema-inventory.md#7-funciones-y-rpc)) |
| Resolver identidad y tenant | **Go** | El tenant sale de la sesión/membresía autenticada, no de un parámetro | [`MIGRACION_BACKEND_GO_POSTGRES.md:157-164`](../../MIGRACION_BACKEND_GO_POSTGRES.md#L157-L164) |
| Establecer contexto de transacción | **Go** | `set_config('app.tenant_id', …, true)` después de validar | §8 |
| RBAC y permisos de operación | **Go** | RLS no implementa RBAC; `has_permission` no debe ser la única puerta | [`identity-implementation.md:49-54`](identity-implementation.md#L49-L54) |
| Validar que cada ID del payload pertenece al tenant | **Go** | La FK compuesta es la red de seguridad, no la primera validación | §5.5 |
| Decidir si un usuario es superadmin | **Go** | Prohibido «superadmin por ausencia de perfil» | [`supabase-dependencies.md` §3.5](supabase-dependencies.md#35-la-regla-superadmin-por-ausencia-de-perfil) |
| Autorización de archivos/storage | **Go** | No hay RLS de `storage.objects` en PostgreSQL | [`supabase-dependencies.md` §4](supabase-dependencies.md#4-dependencias-de-storage) |
| Enrutar workers por tenant | **Go** | El worker elige tenant y abre transacción con contexto | §8.7 |
| Reset del contexto en el pool | **Go** | `SET LOCAL`/`set_config(..., true)` y pruebas de reutilización | §9, caso N15 |
| Mapear errores `42501`/`23503` a 403/409 | **Go** | No filtrar detalles internos al cliente | Propuesta |
| Reconciliación y conteos por tenant | **Go** | Requiere leer varias tablas y comparar | Tarea #7 |

**Principio:** PostgreSQL garantiza **invariantes**; Go garantiza **autorización y contexto**. Ninguno de los dos sustituye al otro. Una FK compuesta sin validación en Go produce errores 500 en lugar de 403; una validación en Go sin FK compuesta deja la puerta abierta a escrituras fuera de la API (workers, SQL manual, migraciones).

---

## 8. Estrategia opcional de RLS portable (sin `auth.uid()`)

> **Estado:** propuesta. No se implementó ni se ejecutó. El baseline de identidad ya usa este patrón en [`database/migrations/`](../../database/migrations/) y puede servir de referencia.

### 8.1 Principios

1. **Contexto de transacción, no de sesión.** El backend abre transacción, valida identidad/membresía y ejecuta `SELECT set_config('app.tenant_id', $1, true)`. El tercer argumento `true` hace el valor local a la transacción; al terminar, desaparece.
2. **Sin contexto se deniega.** `current_setting('app.tenant_id', true)` devuelve `NULL`; `NULL` no coincide con ninguna fila. Un UUID malformado debe fallar (fail closed), no convertirse en `NULL` silencioso.
3. **El GUC no es una credencial.** Un cliente con acceso SQL arbitrario puede ejecutar `set_config`. El diseño presupone que los clientes **no** tienen acceso SQL y que solo el backend trusted establece el contexto ([`database/migrations/README.md:55-61`](../../database/migrations/README.md#L55-L61)).
4. **RLS es defensa en profundidad.** No reemplaza RBAC, validación de payload ni filtros de repositorio.
5. **Un solo nombre de variable.** El repo tiene dos precedentes incompatibles: `app.current_tenant` ([`full_migration.sql:507-509`](../../shared/supabase/migrations/full_migration.sql#L507-L509)) y `app.current_tenant_id` ([`CREATE_UNITS_OF_MEASURE.sql:258-263`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L258-L263)). El baseline nuevo usa `app.tenant_id` ([`0001_core.up.sql:9-12`](../../database/migrations/0001_core.up.sql#L9-L12)). **Recomendación: `app.tenant_id`.**

### 8.2 Roles

| Rol | Atributos | Uso |
|---|---|---|
| `ofirone_owner` | `NOLOGIN`, propietario del esquema | Migraciones; no se usa en runtime |
| `ofirone_migrator` | `LOGIN`, DDL acotado | Aplicar migraciones; nunca atiende API |
| `ofirone_app` | `LOGIN`, `NOBYPASSRLS`, `NOINHERIT` | Pool de la API; sujeto a RLS |
| `ofirone_worker` | `LOGIN`, `NOBYPASSRLS` | Workers; recorre tenants con contexto o usa funciones específicas |
| `ofirone_auth` | `LOGIN`, `BYPASSRLS`, grants mínimos | Servicio de autenticación antes de tener tenant; **no** para rutas comerciales |

`BYPASSRLS` no debe ser el atajo para «service role». Si se usa, debe ser un rol separado, con credenciales separadas y solo para el lookup previo al contexto (login, refresh, selección de membresía).

### 8.3 Función de contexto

```sql
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_private.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION app_private.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.current_tenant_id() TO ofirone_app, ofirone_worker;
```

- `nullif(..., '')` evita que un contexto vacío se convierta en error de cast.
- `::uuid` hace que un valor malformado **falle** en lugar de devolver `NULL` (fail closed).
- `STABLE` permite al planner optimizarlo dentro de la transacción.
- `SET search_path = pg_catalog` evita *search_path hijacking*.

### 8.4 Política tipo

```sql
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sales
  FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
```

- `FOR ALL` cubre `SELECT`, `INSERT`, `UPDATE` y `DELETE`.
- `USING` filtra filas visibles/actualizables; `WITH CHECK` impide insertar o **mover** una fila a otro tenant.
- `FORCE ROW LEVEL SECURITY` aplica también al propietario de la tabla. Sin `FORCE`, el owner (o un rol con privilegios de owner) puede saltarse RLS.
- Para catálogos globales: `CREATE POLICY read_all ON permissions FOR SELECT USING (true);` y sin políticas de escritura.
- Para tablas derivadas sin `tenant_id`, la política usa `EXISTS` contra el padre; es correcta pero más cara. Añadir `tenant_id` suele ser mejor para índices y claridad.

### 8.5 Uso desde Go

Secuencia por request:

```text
1. Validar token/sesión y resolver identity_id.
2. Resolver membresía activa y tenant_id; verificar que el tenant esté activo.
3. Abrir transacción (pgx.Tx).
4. Ejecutar: SELECT set_config('app.tenant_id', $1, true)  -- $1 = tenant_id validado
5. Ejecutar el caso de uso (consultas y primitivas SQL).
6. COMMIT (o ROLLBACK). El contexto local desaparece.
```

Notas de implementación:

- No usar `SET app.tenant_id = '...'` concatenando strings; usar `set_config` con parámetro.
- No establecer el contexto una vez al inicio de la conexión: el pool reutiliza conexiones y el tenant se filtraría entre requests.
- No derivar `tenant_id` de un header, query param o body; solo de la membresía validada.
- Si el caso de uso es de plataforma (superadmin), usar un permiso explícito y un rol/contexto separado, no «sin tenant».
- En `database/sql`, el equivalente es `ExecContext("select set_config('app.tenant_id', $1, true)", tenantID)` dentro de `Tx`.

### 8.6 Vistas, matviews y `SECURITY DEFINER`

1. **Vistas:** en PG15+, declarar `CREATE VIEW ... WITH (security_invoker = true)` para que la RLS del invocador se aplique. Sin eso, la vista se ejecuta con permisos del owner y puede saltarse RLS ([`schema-inventory.md` §6](schema-inventory.md#6-vistas-y-vistas-materializadas)).
2. **Matviews:** no admiten RLS. `stock_balances` no debe recibir `GRANT SELECT` amplio; la alternativa es una vista normal o una función que filtre por `app_private.current_tenant_id()`. Si se conserva la matview, el `SELECT` debe ir por una vista `security_invoker` sobre una tabla/vista filtrada, no directamente.
3. **`SECURITY DEFINER`:** solo para primitivas estrechas, con `SET search_path = pg_catalog, public`, owner explícito, `REVOKE ALL FROM PUBLIC` y `GRANT EXECUTE` mínimo. Un `SECURITY DEFINER` que lee `app_private.current_tenant_id()` sigue el contexto del llamador; uno que lo ignora puede cruzar tenants.

### 8.7 Workers

Dos patrones válidos:

| Patrón | Cómo | Cuándo |
|---|---|---|
| **Por tenant** | El worker obtiene la lista de tenants y, por cada uno, abre transacción, `set_config('app.tenant_id', t, true)` y procesa solo ese tenant | Preferido para jobs de negocio y RLS activa |
| **Global con rol dedicado** | `fn_claim_async_jobs` corre con `ofirone_worker`; el claim es global, pero el procesamiento se hace por tenant y el cierre valida `locked_by` | Colas globales; requiere lease y auditoría |

`fn_claim_async_jobs` ya usa `FOR UPDATE SKIP LOCKED` ([`ADD_ASYNC_JOB_QUEUE.sql:219-249`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L219-L249)), lo cual es correcto para concurrencia. Lo que falta es que `fn_complete_async_job` y `fn_fail_async_job` validen `locked_by`, el lease y el tenant ([`:258-287`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L258-L287), [`:312-356`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L312-L356)).

### 8.8 Límites y errores comunes

| Error | Efecto | Prevención |
|---|---|---|
| `SET` en vez de `SET LOCAL` | El tenant sobrevive en la conexión del pool | `set_config(..., true)`; test de reutilización |
| Contexto vacío `''` sin `nullif` | `''::uuid` falla o se interpreta mal | `nullif(current_setting(...), '')::uuid` |
| Política solo `USING` sin `WITH CHECK` | `UPDATE` puede mover filas a otro tenant | Añadir `WITH CHECK` |
| Sin `FORCE ROW LEVEL SECURITY` | El owner evade RLS | `FORCE` + owner `NOLOGIN` |
| `GRANT` amplio a `PUBLIC` | RLS no protege si el rol puede leer la tabla base o la matview | `REVOKE ALL FROM PUBLIC`; grants por rol |
| Vista sin `security_invoker` | RLS evadida | `WITH (security_invoker = true)` |
| Confiar en RLS para RBAC | Un miembro del tenant A ve todo su tenant, aunque no tenga permiso de módulo | RBAC en Go; RLS solo perímetro |
| Contexto establecido antes de validar membresía | Tenant spoofing | Resolver membresía primero; luego `set_config` |
| `SECURITY DEFINER` sin `search_path` | Hijacking | `SET search_path` fijo |

### 8.9 Precedentes en el repositorio

| Precedente | Evidencia | Comentario |
|---|---|---|
| GUC `app.current_tenant` en políticas | [`full_migration.sql:507-509`](../../shared/supabase/migrations/full_migration.sql#L507-L509) | Primer intento; nombre distinto al recomendado |
| GUC `app.current_tenant_id` en `units_of_measure` | [`CREATE_UNITS_OF_MEASURE.sql:258-263`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L258-L263) | Único uso consistente en `shared/` |
| `app.tenant_id` + `app_private.current_tenant_id()` | [`0001_core.up.sql:9-12`](../../database/migrations/0001_core.up.sql#L9-L12) | Baseline nuevo; patrón recomendado |
| RLS con `FORCE` y `WITH CHECK` | [`0002_identity.up.sql:137-145`](../../database/migrations/0002_identity.up.sql#L137-L145) | Aplica a membresías, roles, asignaciones, sesiones y tokens |
| Pruebas negativas A/B | [`tests/identity.sql:44-97`](../../database/migrations/tests/identity.sql#L44-L97) | Sirve de plantilla para §9 |

---

## 9. Casos negativos de prueba: tenant A contra tenant B

> **Estado:** diseñados, no ejecutados. Deben correr en una base PostgreSQL desechable (15+) con el esquema y las constraints propuestas. No ejecutar en PROD. El precedente ejecutable es [`database/migrations/tests/identity.sql`](../../database/migrations/tests/identity.sql).

### 9.1 Matriz de casos

| # | Precondición | Acción | Resultado esperado | Capa | SQLSTATE |
|---:|---|---|---|---|---|
| N1 | Sin `app.tenant_id` | `SELECT * FROM sales` | 0 filas | RLS | — |
| N2 | Sin contexto | `INSERT INTO sales (tenant_id, …) VALUES (A, …)` | Rechazo | RLS `WITH CHECK` | `42501` |
| N3 | Contexto A | `SELECT * FROM sales WHERE tenant_id = B` | 0 filas | RLS `USING` | — |
| N4 | Contexto A | `SELECT * FROM sales WHERE sale_id = <venta B>` | 0 filas | RLS | — |
| N5 | Contexto A | `UPDATE sales SET tenant_id = B WHERE sale_id = <venta A>` | Rechazo | RLS `WITH CHECK` | `42501` |
| N6 | Contexto A | `INSERT INTO sale_lines (tenant_id=A, sale_id=<venta B>)` | Rechazo | FK compuesta | `23503` |
| N7 | Contexto A | `INSERT INTO sales (tenant_id=A, location_id=<sede B>)` | Rechazo | FK compuesta | `23503` |
| N8 | Contexto A | `INSERT INTO user_roles (tenant_id=A, user_id=<A>, role_id=<rol B>)` | Rechazo | FK compuesta | `23503` |
| N9 | Contexto A | `INSERT INTO sale_line_batches (tenant_id=A, batch_id=<lote B>)` | Rechazo | FK compuesta | `23503` |
| N10 | Contexto A | `INSERT INTO online_store_catalog (tenant_id=A, variant_id=<variante B>)` | Rechazo | FK compuesta | `23503` |
| N11 | Contexto A | `INSERT INTO third_parties (tenant_id=NULL, …)` | Rechazo | `NOT NULL` | `23502` |
| N12 | Contexto A | `INSERT INTO product_variants (tenant_id=A, product_id=<prod A>, sku='X')` dos veces | Rechazo en la segunda | `UNIQUE (tenant_id, sku)` | `23505` |
| N13 | Contexto A y B | Mismo `sku='X'` en A y en B | Ambas aceptadas | Unicidad por tenant | — |
| N14 | Contexto B | `SELECT * FROM sales` | Solo ventas de B; ninguna de A | RLS | — |
| N15 | Contexto A, commit; reutilizar conexión sin contexto | `SELECT * FROM sales` | 0 filas (no hereda A) | `SET LOCAL` + pool | — |
| N16 | Contexto A | `SELECT * FROM stock_balances` | Fuga esperada hoy; el caso debe marcar incidencia y pasar solo tras proteger la matview | Matview | — |
| N17 | Contexto A | `SELECT * FROM vw_sales_summary` | Solo A si la vista es `security_invoker`; si no, fuga | Vista | — |
| N18 | Worker con contexto A | `fn_claim_async_jobs('queue', 'w1')` | Solo jobs de A (si el claim se adapta por tenant) | Función/worker | — |
| N19 | Worker A intenta cerrar job de B | `fn_complete_async_job(<job B>, 'w1')` | Rechazo | Lease/`locked_by`/tenant | `42501` o excepción |
| N20 | Contexto A | `INSERT INTO audit_log (tenant_id=B, …)` | Rechazo | FK a `tenants` + RLS | `23503`/`42501` |

### 9.2 Esqueleto SQL reproducible

El siguiente esqueleto sigue el patrón de [`tests/identity.sql:44-97`](../../database/migrations/tests/identity.sql#L44-L97). Los UUID son ficticios; los nombres de tablas y columnas deben ajustarse al baseline aprobado.

```sql
BEGIN;

-- Fixtures: dos tenants, dos usuarios, dos roles, una venta por tenant.
INSERT INTO tenants (tenant_id, name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A'),
  ('00000000-0000-0000-0000-00000000000b', 'B');

INSERT INTO users (user_id, tenant_id, email, full_name) VALUES
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'a@example.test', 'A'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'b@example.test', 'B');

INSERT INTO roles (role_id, tenant_id, name) VALUES
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'admin');

-- Contexto A
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000a', true);

DO $$
BEGIN
  -- N1/N3: no se ve B
  IF EXISTS (SELECT 1 FROM sales WHERE tenant_id = '00000000-0000-0000-0000-00000000000b') THEN
    RAISE EXCEPTION 'Fuga: A ve ventas de B';
  END IF;

  -- N5: no se puede mover una fila a B
  BEGIN
    UPDATE sales SET tenant_id = '00000000-0000-0000-0000-00000000000b'
     WHERE sale_id = '<venta A>';
    RAISE EXCEPTION 'Aceptado mover venta A a B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- N8: no se puede asignar un rol de B a un usuario de A
  BEGIN
    INSERT INTO user_roles (tenant_id, user_id, role_id)
    VALUES ('00000000-0000-0000-0000-00000000000a',
            '10000000-0000-0000-0000-00000000000a',
            '30000000-0000-0000-0000-00000000000b');
    RAISE EXCEPTION 'Aceptada asignación de rol de B a usuario de A';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- N14: contexto B no ve A
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-00000000000b', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE tenant_id = '00000000-0000-0000-0000-00000000000a') THEN
    RAISE EXCEPTION 'Fuga: B ve ventas de A';
  END IF;
END $$;

ROLLBACK;
```

**Criterio de aceptación:** todos los casos N1–N20 pasan; ningún `SELECT` devuelve filas de otro tenant; ninguna escritura cruza el perímetro; el test se ejecuta dos veces (segundo `up`/segundo test) sin residuos.

---

## 10. Limitaciones, decisiones pendientes y criterios de cierre

### 10.1 Limitaciones

1. **DEV vacía.** PostgreSQL 18.6, 0 tablas, 0 políticas; no se pudo validar ninguna constraint ni política ([`schema-inventory.md` §2.2](schema-inventory.md#22-estado-de-las-bases-dato-ya-capturado-no-se-repitieron-conexiones)).
2. **PROD bloqueado.** El usuario tiene `CREATE` y no es de solo lectura; por política no se analizó. No se sabe si hay datos cruzados, políticas distintas o `profiles`.
3. **Análisis estático.** No se ejecutó SQL, no se consultaron catálogos del motor, no se verificaron grants ni el orden de migraciones.
4. **Vistas y funciones.** No se analizaron los cuerpos de las 46 vistas; las dependencias de `auth.uid()` en vistas quedan a verificar.
5. **DDL dinámico.** Las FK de facturación y las políticas creadas con `EXECUTE format` pueden no reflejarse exactamente en los conteos.
6. **Datos históricos.** No se pueden cuantificar asociaciones cruzadas ya existentes; hace falta una fase de auditoría de huérfanos y de integridad por tenant antes de migrar (tarea #7).

### 10.2 Decisiones pendientes

| # | Decisión | Opciones | Recomendación |
|---:|---|---|---|
| D1 | ¿Añadir `tenant_id` a las 5 tablas derivadas o mantener `EXISTS`? | Añadir vs derivar | Añadir en `user_roles`, `role_permissions`, `async_job_attempts`, `bulk_import_errors`, `public_subscription_signup_events`; FK compuesta al padre |
| D2 | ¿RLS obligatoria o defensa en profundidad? | Obligatoria vs opcional | Opcional pero recomendada; activarla en tablas de negocio y RBAC |
| D3 | ¿Nombre del GUC? | `app.current_tenant`, `app.current_tenant_id`, `app.tenant_id` | `app.tenant_id` |
| D4 | ¿`stock_balances` vista normal o matview? | Vista vs matview | Vista normal; si se mide y se necesita matview, restringir grants y no exponerla |
| D5 | ¿Rol de worker global o por tenant? | `BYPASSRLS` vs contexto por tenant | Worker por tenant con contexto; `BYPASSRLS` solo para auth |
| D6 | ¿`third_parties` global o por tenant? | Nullable vs `NOT NULL` | `NOT NULL`; si se necesitan terceros globales, tabla separada |
| D7 | ¿Superadmin explícito? | Permiso `platform.superadmin` vs ausencia de perfil | Permiso explícito; la ausencia de perfil **deniega** |
| D8 | ¿Compatibilidad con múltiples membresías? | `users.tenant_id` vs `tenant_memberships` | `tenant_memberships` del baseline nuevo |

### 10.3 Criterios de cierre de la tarea #4

- [x] Matriz de los 116 objetos con ámbito directo/derivado/global/legado y evidencia.
- [x] Riesgos de acceso cruzado documentados con `archivo:línea`.
- [x] Constraints y claves compuestas propuestas, con SQL de ejemplo.
- [x] Controles PostgreSQL vs Go delimitados.
- [x] Estrategia RLS portable con `set_config`/`SET LOCAL app.tenant_id`, sin `auth.uid()`.
- [x] Casos negativos A/B diseñados (N1–N20).
- [ ] Ejecutar los casos negativos en PostgreSQL desechable (bloqueado por DEV vacía/PROD bloqueado).
- [ ] Auditar datos cruzados existentes (requiere acceso de lectura a PROD; bloqueado).
- [ ] Aprobar [`ADR-003`](../decisions/ADR-003-aislamiento-multi-tenant.md) e incorporar las constraints al baseline.

---

## Apéndice A — Matriz completa de 116 objetos

`Directo` = declara `tenant_id` (incluye la matview `stock_balances`); `Derivado` = lo hereda por FK; `Global` = catálogo compartido; `Raíz` = `tenants`; `Legado` = respaldo sin tenant. La columna «Definición» enlaza la primera definición encontrada (prioriza `shared/`).

| Tabla | Ámbito | Definición (evidencia) | Observación |
|---|---|---|---|
| `accounting_accounts` | Directo | [`ADD_ACCOUNTING_CO_MODULE.sql:57`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L57) | Extra `web/` (fuera de `shared/`). |
| `accounting_automation_exceptions` | Directo | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:81`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L81) | Extra `web/` (fuera de `shared/`). |
| `accounting_entries` | Directo | [`ADD_ACCOUNTING_CO_MODULE.sql:81`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L81) | Extra `web/` (fuera de `shared/`). |
| `accounting_entry_lines` | Directo | [`ADD_ACCOUNTING_CO_MODULE.sql:108`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L108) | Extra `web/` (fuera de `shared/`). |
| `accounting_event_queue` | Directo | [`ADD_ACCOUNTING_CO_MODULE.sql:134`](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql#L134) | Extra `web/` (fuera de `shared/`). |
| `accounting_period_closures` | Directo | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:39`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L39) | Extra `web/` (fuera de `shared/`). |
| `accounting_posting_rules` | Directo | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:61`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L61) | Extra `web/` (fuera de `shared/`). |
| `accounting_withholding_configs` | Directo | [`ADD_ACCOUNTING_COMPETITIVE_CORE.sql:18`](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql#L18) | Extra `web/` (fuera de `shared/`). |
| `ai_telemetry_events` | Directo | [`ADD_AI_TELEMETRY_EVENTS.sql:7`](../../shared/supabase/migrations/ADD_AI_TELEMETRY_EVENTS.sql#L7) |  |
| `async_job_attempts` | Derivado | [`ADD_ASYNC_JOB_QUEUE.sql:75`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L75) | `job_id` → `async_jobs`; sin `tenant_id`. |
| `async_jobs` | Directo | [`ADD_ASYNC_JOB_QUEUE.sql:12`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L12) | Cola reclamada por workers; el claim no filtra tenant. |
| `audit_log` | Directo | [`InitDB.sql:373`](../../shared/supabase/migrations/InitDB.sql#L373) | `tenant_id` **sin FK** a `tenants`. |
| `bill_of_materials` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:23`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L23) |  |
| `billing_plan_features` | Global | [`ADD_TENANT_BILLING_MONETIZATION.sql:41`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L41) |  |
| `billing_plan_limits` | Global | [`ADD_TENANT_BILLING_MONETIZATION.sql:53`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L53) |  |
| `billing_plan_prices` | Global | [`ADD_TENANT_BILLING_MONETIZATION.sql:25`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L25) |  |
| `billing_plans` | Global | [`ADD_TENANT_BILLING_MONETIZATION.sql:12`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L12) |  |
| `bom_components` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:62`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L62) |  |
| `bulk_import_errors` | Derivado | [`CREATE_BULK_IMPORT_TRACKING.sql:24`](../../shared/supabase/migrations/CREATE_BULK_IMPORT_TRACKING.sql#L24) | `import_id` → `bulk_imports`; sin `tenant_id`. |
| `bulk_imports` | Directo | [`CREATE_BULK_IMPORT_TRACKING.sql:8`](../../shared/supabase/migrations/CREATE_BULK_IMPORT_TRACKING.sql#L8) |  |
| `bundle_compositions` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:206`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L206) |  |
| `cash_movements` | Directo | [`InitDB.sql:249`](../../shared/supabase/migrations/InitDB.sql#L249) |  |
| `cash_register_assignments` | Directo | [`EJECUTAR_MIGRACION_CAJAS.sql:16`](../../shared/supabase/migrations/EJECUTAR_MIGRACION_CAJAS.sql#L16) |  |
| `cash_registers` | Directo | [`InitDB.sql:225`](../../shared/supabase/migrations/InitDB.sql#L225) |  |
| `cash_sessions` | Directo | [`InitDB.sql:234`](../../shared/supabase/migrations/InitDB.sql#L234) |  |
| `categories` | Directo | [`InitDB.sql:69`](../../shared/supabase/migrations/InitDB.sql#L69) |  |
| `chat_order_ai_cache` | Directo | [`ADD_CHAT_ORDER_AI_CACHE.sql:5`](../../shared/supabase/migrations/ADD_CHAT_ORDER_AI_CACHE.sql#L5) |  |
| `cities` | Global | [`ADD_THIRD_PARTIES_LOOKUPS.sql:41`](../../shared/supabase/migrations/ADD_THIRD_PARTIES_LOOKUPS.sql#L41) |  |
| `component_allocations` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:265`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L265) |  |
| `customer_credit_accounts` | Directo | [`InitDB.sql:158`](../../shared/supabase/migrations/InitDB.sql#L158) |  |
| `customer_credit_movements` | Directo | [`InitDB.sql:168`](../../shared/supabase/migrations/InitDB.sql#L168) |  |
| `customers` | Directo | [`InitDB.sql:145`](../../shared/supabase/migrations/InitDB.sql#L145) |  |
| `departments` | Global | [`ADD_THIRD_PARTIES_LOOKUPS.sql:26`](../../shared/supabase/migrations/ADD_THIRD_PARTIES_LOOKUPS.sql#L26) |  |
| `document_types` | Global | [`ADD_THIRD_PARTIES_LOOKUPS.sql:10`](../../shared/supabase/migrations/ADD_THIRD_PARTIES_LOOKUPS.sql#L10) |  |
| `fe_provider_config` | Directo | [`ADD_ELECTRONIC_INVOICING.sql:35`](../../shared/supabase/migrations/ADD_ELECTRONIC_INVOICING.sql#L35) |  |
| `inventory_batches` | Directo | [`ADD_EXPIRATION_BATCHES_PHASE2.sql:21`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L21) |  |
| `inventory_moves` | Directo | [`InitDB.sql:344`](../../shared/supabase/migrations/InitDB.sql#L344) |  |
| `invoice_resolutions` | Directo | [`ADD_ELECTRONIC_INVOICING.sql:73`](../../shared/supabase/migrations/ADD_ELECTRONIC_INVOICING.sql#L73) |  |
| `layaway_contracts` | Directo | [`PlanSepare.sql:90`](../../shared/supabase/migrations/PlanSepare.sql#L90) | `UNIQUE (tenant_id, layaway_id)` redundante con la PK. |
| `layaway_installments` | Directo | [`PlanSepare.sql:133`](../../shared/supabase/migrations/PlanSepare.sql#L133) |  |
| `layaway_items` | Directo | [`PlanSepare.sql:120`](../../shared/supabase/migrations/PlanSepare.sql#L120) |  |
| `layaway_payments` | Directo | [`PlanSepare.sql:142`](../../shared/supabase/migrations/PlanSepare.sql#L142) |  |
| `locations` | Directo | [`InitDB.sql:16`](../../shared/supabase/migrations/InitDB.sql#L16) |  |
| `menu_items` | Global | [`ROLES_MENUS_SYSTEM.sql:26`](../../shared/supabase/migrations/ROLES_MENUS_SYSTEM.sql#L26) |  |
| `menu_permissions` | Global | [`ROLES_MENUS_SYSTEM.sql:49`](../../shared/supabase/migrations/ROLES_MENUS_SYSTEM.sql#L49) |  |
| `mobile_sale_operations` | Directo | [`ADD_IDEMPOTENT_MOBILE_SALES.sql:14`](../../mobile/migrations/ADD_IDEMPOTENT_MOBILE_SALES.sql#L14) | Extra `mobile/` (fuera de `shared/`). |
| `notification_events` | Directo | [`ADD_IN_APP_NOTIFICATION_CENTER.sql:78`](../../mobile/migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql#L78) | Extra `mobile/` (fuera de `shared/`). |
| `notification_outbox` | Directo | [`ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:9`](../../shared/supabase/migrations/ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql#L9) |  |
| `notification_push_queue` | Directo | [`ADD_PUSH_NOTIFICATIONS_EXPO.sql:52`](../../mobile/migrations/ADD_PUSH_NOTIFICATIONS_EXPO.sql#L52) | Extra `mobile/` (fuera de `shared/`). |
| `notifications` | Directo | [`ADD_IN_APP_NOTIFICATION_CENTER.sql:126`](../../mobile/migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql#L126) | Extra `mobile/` (fuera de `shared/`). |
| `online_order_lines` | Directo | [`ADD_ONLINE_STORE_MVP.sql:230`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L230) |  |
| `online_order_reservations` | Directo | [`ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:6`](../../shared/supabase/migrations/ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql#L6) |  |
| `online_orders` | Directo | [`ADD_ONLINE_STORE_MVP.sql:202`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L202) | `sale_id` único global; sin `UNIQUE (tenant_id, order_number)`. |
| `online_store_catalog` | Directo | [`ADD_ONLINE_STORE_MVP.sql:182`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L182) | `UNIQUE (store_id, variant_id)` sin `tenant_id`. |
| `online_stores` | Directo | [`ADD_ONLINE_STORE_MVP.sql:153`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L153) |  |
| `ops_ai_query_cache` | Directo | [`ADD_OPS_RAG_AGENT_CACHE.sql:1`](../../mobile/migrations/ADD_OPS_RAG_AGENT_CACHE.sql#L1) | Extra `mobile/` (fuera de `shared/`). |
| `payment_methods` | Directo | [`InitDB.sql:264`](../../shared/supabase/migrations/InitDB.sql#L264) |  |
| `permissions` | Global | [`InitDB.sql:48`](../../shared/supabase/migrations/InitDB.sql#L48) |  |
| `price_list_items` | Directo | [`InitDB.sql:134`](../../shared/supabase/migrations/InitDB.sql#L134) |  |
| `price_lists` | Directo | [`InitDB.sql:126`](../../shared/supabase/migrations/InitDB.sql#L126) |  |
| `pricing_rules` | Directo | [`PricingRules.sql:8`](../../shared/supabase/migrations/PricingRules.sql#L8) |  |
| `product_barcodes` | Directo | [`InitDB.sql:103`](../../shared/supabase/migrations/InitDB.sql#L103) |  |
| `product_media` | Directo | [`ADD_PRODUCT_MEDIA_PHOTOS.sql:30`](../../mobile/migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql#L30) | Extra `mobile/` (fuera de `shared/`). |
| `product_tag_map` | Directo | [`InitDB.sql:118`](../../shared/supabase/migrations/InitDB.sql#L118) |  |
| `product_tags` | Directo | [`InitDB.sql:111`](../../shared/supabase/migrations/InitDB.sql#L111) |  |
| `product_variants` | Directo | [`InitDB.sql:89`](../../shared/supabase/migrations/InitDB.sql#L89) |  |
| `production_order_lines` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:149`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L149) |  |
| `production_orders` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:93`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L93) |  |
| `production_outputs` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:179`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L179) |  |
| `products` | Directo | [`InitDB.sql:77`](../../shared/supabase/migrations/InitDB.sql#L77) |  |
| `public_subscription_signup_events` | Derivado | [`ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:82`](../../shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql#L82) | `signup_id` → `public_subscription_signups`; sin `tenant_id`. |
| `public_subscription_signups` | Directo | [`ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:7`](../../shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql#L7) |  |
| `purchase_order_lines` | Directo | [`ADD_PURCHASE_ORDERS_CORE.sql:20`](../../shared/supabase/migrations/ADD_PURCHASE_ORDERS_CORE.sql#L20) |  |
| `purchase_orders` | Directo | [`ADD_PURCHASE_ORDERS_CORE.sql:5`](../../shared/supabase/migrations/ADD_PURCHASE_ORDERS_CORE.sql#L5) |  |
| `purchase_return_lines` | Directo | [`ADD_PURCHASE_RETURNS_CORE.sql:17`](../../shared/supabase/migrations/ADD_PURCHASE_RETURNS_CORE.sql#L17) |  |
| `purchase_returns` | Directo | [`ADD_PURCHASE_RETURNS_CORE.sql:5`](../../shared/supabase/migrations/ADD_PURCHASE_RETURNS_CORE.sql#L5) |  |
| `purchases` | Directo | [`ADD_PURCHASES_TABLE.sql:7`](../../shared/supabase/migrations/ADD_PURCHASES_TABLE.sql#L7) |  |
| `role_menu_templates` | Global | [`ROLES_MENUS_SYSTEM.sql:74`](../../shared/supabase/migrations/ROLES_MENUS_SYSTEM.sql#L74) |  |
| `role_menus` | Global | [`ROLES_MENUS_SYSTEM.sql:61`](../../shared/supabase/migrations/ROLES_MENUS_SYSTEM.sql#L61) |  |
| `role_permissions` | Derivado | [`InitDB.sql:54`](../../shared/supabase/migrations/InitDB.sql#L54) | `role_id` → `roles`; sin `tenant_id`. |
| `roles` | Directo | [`InitDB.sql:41`](../../shared/supabase/migrations/InitDB.sql#L41) |  |
| `sale_counters` | Directo | [`SpVistasFN.sql:13`](../../shared/supabase/migrations/SpVistasFN.sql#L13) |  |
| `sale_line_batches` | Directo | [`ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:316`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql#L316) | `sale_line_id` sin FK; `batch_id` y `sale_id` con FK de una columna. |
| `sale_lines` | Directo | [`InitDB.sql:291`](../../shared/supabase/migrations/InitDB.sql#L291) |  |
| `sale_payments` | Directo | [`InitDB.sql:305`](../../shared/supabase/migrations/InitDB.sql#L305) |  |
| `sale_return_lines` | Directo | [`InitDB.sql:329`](../../shared/supabase/migrations/InitDB.sql#L329) |  |
| `sale_return_refunds` | Directo | [`ADD_SALE_RETURNS_REFUNDS_V2.sql:5`](../../shared/supabase/migrations/ADD_SALE_RETURNS_REFUNDS_V2.sql#L5) |  |
| `sale_returns` | Directo | [`InitDB.sql:317`](../../shared/supabase/migrations/InitDB.sql#L317) |  |
| `sale_warnings` | Directo | [`ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql:22`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql#L22) |  |
| `sales` | Directo | [`InitDB.sql:273`](../../shared/supabase/migrations/InitDB.sql#L273) |  |
| `service_deliveries` | Directo | [`MANUFACTURING_PHASE1_BASE_TABLES.sql:232`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql#L232) |  |
| `stock_alert_log` | Directo | [`AddMinStock.sql:69`](../../shared/supabase/migrations/AddMinStock.sql#L69) |  |
| `stock_balances` | Directo | [`ADD_EXPIRATION_BATCHES_PHASE2.sql:165`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L165) | Vista materializada: no admite políticas RLS. |
| `stock_balances_backup` | Legado | [`ADD_EXPIRATION_BATCHES_PHASE2.sql:150`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L150) | Copia de respaldo sin `tenant_id`; no debe formar parte del baseline. |
| `stock_reservations_log` | Directo | [`PlanSepare.sql:154`](../../shared/supabase/migrations/PlanSepare.sql#L154) |  |
| `supplier_payable_payments` | Directo | [`ADD_SUPPLIER_PAYABLES_CORE.sql:23`](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L23) |  |
| `supplier_payables` | Directo | [`ADD_SUPPLIER_PAYABLES_CORE.sql:5`](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L5) |  |
| `system_alerts` | Directo | [`FIX_STOCK_ALERTS_REALTIME.sql:43`](../../shared/supabase/migrations/FIX_STOCK_ALERTS_REALTIME.sql#L43) |  |
| `tax_rules` | Directo | [`InitDB.sql:194`](../../shared/supabase/migrations/InitDB.sql#L194) |  |
| `taxes` | Directo | [`InitDB.sql:183`](../../shared/supabase/migrations/InitDB.sql#L183) |  |
| `tenant_gateway_credentials` | Directo | [`ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql:7`](../../shared/supabase/migrations/ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql#L7) |  |
| `tenant_invoices` | Directo | [`ADD_TENANT_BILLING_MONETIZATION.sql:160`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L160) | `tenant_id` sin FK en el `CREATE`; FK dinámica. |
| `tenant_payment_methods` | Directo | [`ADD_TENANT_BILLING_MONETIZATION.sql:209`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L209) | `tenant_id` sin FK en el `CREATE`; FK dinámica. |
| `tenant_payments` | Directo | [`ADD_TENANT_BILLING_MONETIZATION.sql:187`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L187) | `tenant_id` sin FK en el `CREATE`; FK dinámica. |
| `tenant_settings` | Directo | [`InitDB.sql:212`](../../shared/supabase/migrations/InitDB.sql#L212) |  |
| `tenant_subscription_events` | Directo | [`ADD_TENANT_BILLING_MONETIZATION.sql:138`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L138) | `tenant_id` sin FK en el `CREATE`; FK dinámica. |
| `tenant_subscription_periods` | Directo | [`ADD_TENANT_BILLING_MONETIZATION.sql:119`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L119) | `tenant_id` sin FK en el `CREATE`; FK dinámica. |
| `tenant_subscriptions` | Directo | [`ADD_TENANT_BILLING_MONETIZATION.sql:79`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql#L79) | `tenant_id` sin FK en el `CREATE`; FK dinámica en la misma migración. |
| `tenants` | Raíz | [`InitDB.sql:7`](../../shared/supabase/migrations/InitDB.sql#L7) | Raíz del aislamiento; `tenant_id` es la PK. |
| `third_parties` | Directo | [`ADD_THIRD_PARTIES.sql:11`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L11) | `tenant_id` **nullable**; sin `UNIQUE (tenant_id, document_number)`. |
| `transfer_requests` | Directo | [`ADD_TRANSFER_IN_TRANSIT_CORE.sql:5`](../../shared/supabase/migrations/ADD_TRANSFER_IN_TRANSIT_CORE.sql#L5) |  |
| `units_of_measure` | Directo | [`CREATE_UNITS_OF_MEASURE.sql:21`](../../shared/supabase/migrations/CREATE_UNITS_OF_MEASURE.sql#L21) | `tenant_id` nullable para unidades de sistema (`is_system = true`). |
| `user_notification_prefs` | Directo | [`ADD_IN_APP_NOTIFICATION_CENTER.sql:110`](../../mobile/migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql#L110) | Extra `mobile/` (fuera de `shared/`). |
| `user_push_devices` | Directo | [`ADD_PUSH_NOTIFICATIONS_EXPO.sql:9`](../../mobile/migrations/ADD_PUSH_NOTIFICATIONS_EXPO.sql#L9) | Extra `mobile/` (fuera de `shared/`). |
| `user_roles` | Derivado | [`InitDB.sql:60`](../../shared/supabase/migrations/InitDB.sql#L60) | `user_id` → `users`, `role_id` → `roles`; sin `tenant_id`. |
| `users` | Directo | [`InitDB.sql:30`](../../shared/supabase/migrations/InitDB.sql#L30) |  |

---

## Apéndice B — Reproducibilidad

```bash
# Inventario y hechos derivados (no conecta a ninguna base)
python3 tools/database/static_schema_scan.py --json docs/database-portability/_data/static-scan.json
python3 tools/database/static_schema_analysis.py --json docs/database-portability/_data/static-analysis.json

# Catálogo de tablas/columnas y dependencias Supabase
python3 tools/database/build_listings_and_rpcs.py
python3 tools/database/supabase_dependency_scan.py --include-extras \
  --json docs/database-portability/_data/supabase-deps.json
```

Los scripts existentes no leen `.env`, no imprimen credenciales y no ejecutan DDL. La validación de constraints y RLS de §9 requiere una base desechable y **no** forma parte de estos comandos.

### Fuentes citadas

- [`InitDB.sql`](../../shared/supabase/migrations/InitDB.sql) — baseline, `users`, `sales`, `stock_balances`.
- [`RLS_Security.sql`](../../shared/supabase/migrations/RLS_Security.sql) — helpers y políticas.
- [`ADD_THIRD_PARTIES.sql`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql) — `tenant_id` nullable.
- [`ADD_TENANT_BILLING_MONETIZATION.sql`](../../shared/supabase/migrations/ADD_TENANT_BILLING_MONETIZATION.sql) — facturación y FK dinámicas.
- [`ADD_EXPIRATION_BATCHES_PHASE2.sql`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql) y [`PHASE3_FEFO.sql`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql) — lotes y `sale_line_batches`.
- [`MANUFACTURING_PHASE1_BASE_TABLES.sql`](../../shared/supabase/migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql) — BOM y producción.
- [`ADD_ONLINE_STORE_MVP.sql`](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql) — tienda online.
- [`ADD_ASYNC_JOB_QUEUE.sql`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql) — workers y lease.
- [`database/migrations/0001_core.up.sql`](../../database/migrations/0001_core.up.sql) y [`0002_identity.up.sql`](../../database/migrations/0002_identity.up.sql) — baseline con contexto y FK compuestas.
- [`database/migrations/tests/identity.sql`](../../database/migrations/tests/identity.sql) — prueba negativa A/B de referencia.
