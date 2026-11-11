# Listados y RPCs — insumos para Tareas 5 y 6

> Fecha de trabajo: **2026-11-08**. Análisis **estático** de `web/src/services`, `web/src/views`, `mobile/src/services`, `mobile/src/screens` y de las migraciones SQL del repositorio. No se abrió ninguna conexión a base de datos ni se ejecutó SQL contra DEV/PROD.

Documento de datos para las tareas [5 (RPCs)](../rpc-characterization-matrix.md) y [6 (paginación)](../../../TAREAS_LLM_EXTERNO_POSTGRES.md). Complementa el [inventario de esquema](../schema-inventory.md) y la [propuesta de baseline](../baseline-proposal.md); no sustituye la validación en un PostgreSQL vacío. Rutas de archivo relativas a la raíz del repositorio.

**Regla de lectura:** `a verificar` significa que el análisis estático no permite confirmar el dato (DDL ausente, RPC dinámico o despliegue no inspeccionado). No se inventaron entradas: cada fila proviene de un sitio `.from()`/`.rpc()` o de un `CREATE FUNCTION` localizado.

## Resumen ejecutivo

- **Clientes:** 208 archivos JS/Vue; 466 consultas de tabla y 140 llamadas RPC. La Tabla A.3 contiene los 466 sitios y la A.2 los 140 RPC, con `archivo:línea`, filtros, orden, límite y señal de tenant.
- **Paginación:** 200 listados, 17 conteos `head`, 166 accesos puntuales y 83 consultas multirregistro. Las señales de riesgo (sin límite, offset, orden sin desempate, tenant implícito) están fila a fila y agregadas en A.4.
- **RPCs:** 363 definiciones, 265 firmas y 256 nombres. 60 nombres tienen más de una definición; 61 definiciones `SECURITY DEFINER` no fijan `search_path` y 57 dependen de `auth.uid()`/`auth.jwt()`.
- **Sin validación en base:** DEV está vacía y PROD está bloqueado por falta de usuario de solo lectura. Todo el documento es análisis estático; los puntos no confirmados se marcan `a verificar`.

**Mapa:** [Parte A](#parte-a--listados-y-consultas-de-webmobile) · [A.2 RPCs](#a2-rpcs-invocadas-desde-webmobile) · [A.3 consultas](#a3-consultas-de-tabla) · [A.4 señales](#a4-señales-agregadas-por-entidad) · [Parte B](#parte-b--rpcs-y-funciones-definidas-en-migraciones) · [B.2 prioritarias](#b2-funciones-prioritarias) · [B.4 redefiniciones](#b4-redefiniciones-y-sobrecargas).

## Parte A — Listados y consultas de web/mobile

### A.1 Cobertura y método

| Métrica | Valor |
|---|---:|
| Archivos JS/Vue revisados | 208 |
| Sitios `.from()` localizados | 545 |
| — consultas de tabla | 466 |
| — mutaciones excluidas | 74 |
| — tablas dinámicas no resueltas | 7 |
| Sitios `.rpc()` localizados | 140 |
| RPCs distintas invocadas | 95 (2 dinámicas) |
| Consultas: listados | 200 |
| Consultas: conteos `head` | 17 |
| Consultas: accesos puntuales | 166 |
| Consultas: multirregistro sin orden ni límite | 83 |

Dos sitios son a la vez mutación y tabla dinámica, por lo que los grupos no suman exactamente el total. El inventario completo, con los mismos campos que las tablas, está en [`query-sites.json`](query-sites.json). Los RPC dinámicos (`supabase.service.js` y el fallback de `mobile/src/services/sales.service.js`) no permiten enumerar el nombre de la función sin ejecutar el cliente; quedan como `a verificar`.

**Hallazgos que afectan a la Tarea 6:**

1. **102 listados y 78 consultas multirregistro no declaran límite**, y **104 no declaran orden**. En varios casos son reportes o vistas que devuelven el conjunto completo del tenant; deben acotarse con cursor o límite máximo antes de exponerlos en Go.
2. **48 listados usan paginación por offset** (`.range(offset, offset+n)` o `.range(from, to)`). El offset es sensible a inserciones y a orden no determinista; la Tarea 6 debe migrarlos a cursor/keyset.
3. **179 listados/consultas ordenan sin clave de desempate** (no incluyen `*_id`). Un `ORDER BY sold_at DESC` o `name` sin `id` puede duplicar u omitir filas entre páginas.
4. **11 listados/consultas no filtran `tenant_id` de forma explícita** y **8 lo hacen solo por una FK** (`sale_id`, `cash_session_id`, etc.). Con RLS de Supabase eso podía bastar; en PostgreSQL portable la autorización debe ser explícita en la consulta o en el repositorio. Excepción: catálogos globales como `units_of_measure`, `menu_items` o `cities` pueden ser `N/A` por diseño; revisar caso a caso.
5. **17 conteos usan `head: true`** y **53 listados piden `count: "exact"`**. El total exacto con joins/filtros es costoso; la Tarea 6 debe decidir cuándo usar `has_next` en lugar de `COUNT(*)`.
6. Las mismas entidades se consultan desde web y mobile con filtros y límites distintos (p. ej. `product_variants`, `sales`, `cash_sessions`). La duplicación es una fuente de divergencia de contrato.

### A.2 RPCs invocadas desde web/mobile

Ordenadas por dominio y nombre. `Tenant` se deduce de la firma SQL (`p_tenant`/`p_tenant_id`) y, si no existe, de `auth.uid()`/contexto. `Definición` remite a la Parte B; `(+n)` indica definiciones adicionales de la misma firma.

| # | Sitio (archivo:línea) | RPC | Payload (claves) | Tenant | Definición | Nota |
|---:|---|---|---|---|---|---|
| 1 | `web/src/services/aiTelemetry.service.js:329` | `fn_ai_telemetry_cost_summary` | p_tenant_id, p_window_days | Sí (p_tenant) | ADD_AI_TELEMETRY_COST_SUMMARY_FN.sql:8 | IA/telemetría |
| 2 | `web/src/services/alerts.service.js:191` | `fn_refresh_all_alerts` | — | N/A (global) | ADD_CUSTOMER_RECEIVABLE_ALERTS_REALTIME.sql:100; ADD_EXPIRATION_ALERTS_REALTIME.sql:181; +1 | alertas · Recalcula todas las alertas; operación global de mantenimiento. · 3 defs |
| 3 | `web/src/services/alerts.service.js:176` | `fn_refresh_customer_receivable_alerts` | — | Sí (p_tenant) | ADD_CUSTOMER_RECEIVABLE_ALERTS_REALTIME.sql:16 | cartera/crédito · Recalcula alertas de cartera. p_tenant DEFAULT NULL: la llamada sin payload ref… · llamada sin payload (a verificar) |
| 4 | `mobile/src/services/credit.service.js:98` | `fn_update_credit_balance` | p_credit_account_id, p_delta | Indirecto (cuenta) | ADD_CREDIT_SALES.sql:7 | cartera/crédito · SECURITY DEFINER; ajusta saldo por credit_account_id sin tenant → riesgo. |
| 5 | `web/src/services/credit.service.js:60` | `fn_update_credit_balance` | p_credit_account_id, p_delta | Indirecto (cuenta) | ADD_CREDIT_SALES.sql:7 | cartera/crédito · SECURITY DEFINER; ajusta saldo por credit_account_id sin tenant → riesgo. |
| 6 | `web/src/services/credit.service.js:88` | `fn_update_credit_balance` | p_credit_account_id, p_delta | Indirecto (cuenta) | ADD_CREDIT_SALES.sql:7 | cartera/crédito · SECURITY DEFINER; ajusta saldo por credit_account_id sin tenant → riesgo. |
| 7 | `mobile/src/services/purchases.service.js:377` | `fn_get_purchase_suggestions` | p_tenant_id, p_min_priority, p_limit | Sí (p_tenant) | PURCHASE_ANALYSIS_VIEWS.sql:114; SpVistasFN.sql:1658 | compras/proveedores · Sugerencia de reposición por prioridad y límite. · 2 defs |
| 8 | `web/src/services/purchases.service.js:82` | `fn_get_purchase_suggestions` | p_tenant_id, p_min_priority, p_limit | Sí (p_tenant) | PURCHASE_ANALYSIS_VIEWS.sql:114; SpVistasFN.sql:1658 | compras/proveedores · Sugerencia de reposición por prioridad y límite. · 2 defs |
| 9 | `web/src/services/alerts.service.js:161` | `fn_refresh_supplier_payable_alerts` | — | N/A (global) | ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql:16 | compras/proveedores · Recalcula alertas de CxP; operación global de mantenimiento. |
| 10 | `mobile/src/services/inventoryOperations.service.js:128` | `sp_create_manual_purchase_ingress` | p_tenant, p_location, p_variant, p_quantity, p_unit_cost, p_created_by, p_note | Sí (p_tenant) | INVENTORY_PURCHASE_HARDENING.sql:190 | compras/proveedores · Ingreso manual de compra (variante mobile); aplica stock/lote. |
| 11 | `web/src/services/inventory.service.js:345` | `sp_create_manual_purchase_ingress` | p_tenant, p_location, p_variant, p_quantity, p_unit_cost, p_created_by, p_note | Sí (p_tenant) | INVENTORY_PURCHASE_HARDENING.sql:190 | compras/proveedores · Ingreso manual de compra (variante mobile); aplica stock/lote. |
| 12 | `mobile/src/services/purchases.service.js:177` | `sp_create_purchase` | p_tenant, p_location, p_supplier_id, p_created_by, p_lines, p_note | Sí (p_tenant) | ADD_PURCHASES_TABLE.sql:34; FIX_BATCH_NUMBER_BY_LOCATION.sql:115; +3 | compras/proveedores · Compra atómica + lotes/movimiento de entrada. 5 variantes; ver R04. · 5 defs |
| 13 | `web/src/views/Purchases.vue:3259` | `sp_create_purchase` | p_tenant, p_location, p_supplier_id, p_created_by, p_lines, p_note | Sí (p_tenant) | ADD_PURCHASES_TABLE.sql:34; FIX_BATCH_NUMBER_BY_LOCATION.sql:115; +3 | compras/proveedores · Compra atómica + lotes/movimiento de entrada. 5 variantes; ver R04. · 5 defs |
| 14 | `mobile/src/services/purchases.service.js:335` | `sp_create_purchase_order` | p_tenant, p_location, p_supplier_id, p_created_by, p_lines, p_note | Sí (p_tenant) | ADD_PURCHASE_ORDERS_CORE.sql:70 | compras/proveedores · Orden de compra con líneas; no mueve stock. |
| 15 | `web/src/services/purchases.service.js:422` | `sp_create_purchase_order` | p_tenant, p_location, p_supplier_id, p_created_by, p_lines, p_note | Sí (p_tenant) | ADD_PURCHASE_ORDERS_CORE.sql:70 | compras/proveedores · Orden de compra con líneas; no mueve stock. |
| 16 | `web/src/services/purchases.service.js:726` | `sp_create_purchase_return` | p_tenant, p_purchase_id, p_created_by, p_lines, p_note | Sí (p_tenant) | ADD_PURCHASE_RETURNS_CORE.sql:67 | compras/proveedores · Devolución a proveedor con salida de stock. Ver R06. |
| 17 | `mobile/src/services/purchases.service.js:715` | `sp_create_supplier_payable` | p_tenant, p_purchase_id, p_created_by, p_due_date, p_invoice_number, p_note | Sí (p_tenant) | ADD_SUPPLIER_PAYABLES_CORE.sql:70 | compras/proveedores · CxP desde compra; evita duplicado por compra. |
| 18 | `web/src/services/purchases.service.js:808` | `sp_create_supplier_payable` | p_tenant, p_purchase_id, p_created_by, p_due_date, p_invoice_number, p_note | Sí (p_tenant) | ADD_SUPPLIER_PAYABLES_CORE.sql:70 | compras/proveedores · CxP desde compra; evita duplicado por compra. |
| 19 | `mobile/src/services/purchases.service.js:517` | `sp_receive_purchase_order` | p_tenant, p_purchase_order_id, p_created_by, p_note | Sí (p_tenant) | ADD_PURCHASE_ORDERS_CORE.sql:154; ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:124 | compras/proveedores · Recepción total de orden; genera compra. Ver R05. · 2 defs |
| 20 | `web/src/services/purchases.service.js:659` | `sp_receive_purchase_order` | p_tenant, p_purchase_order_id, p_created_by, p_note | Sí (p_tenant) | ADD_PURCHASE_ORDERS_CORE.sql:154; ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:124 | compras/proveedores · Recepción total de orden; genera compra. Ver R05. · 2 defs |
| 21 | `mobile/src/services/purchases.service.js:539` | `sp_receive_purchase_order_partial` | p_tenant, p_purchase_order_id, p_created_by, p_lines, p_note | Sí (p_tenant) | ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:15 | compras/proveedores · Recepción parcial con lock de cabecera. Ver R05. |
| 22 | `web/src/services/purchases.service.js:692` | `sp_receive_purchase_order_partial` | p_tenant, p_purchase_order_id, p_created_by, p_lines, p_note | Sí (p_tenant) | ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:15 | compras/proveedores · Recepción parcial con lock de cabecera. Ver R05. |
| 23 | `mobile/src/services/purchases.service.js:740` | `sp_register_supplier_payment` | p_tenant, p_payable_id, p_amount, p_created_by, p_payment_method, p_note | Sí (p_tenant) | ADD_SUPPLIER_PAYABLES_CORE.sql:146 | compras/proveedores · Pago de CxP con lock; actualiza pagado/saldo/estado. |
| 24 | `web/src/services/purchases.service.js:838` | `sp_register_supplier_payment` | p_tenant, p_payable_id, p_amount, p_created_by, p_payment_method, p_note | Sí (p_tenant) | ADD_SUPPLIER_PAYABLES_CORE.sql:146 | compras/proveedores · Pago de CxP con lock; actualiza pagado/saldo/estado. |
| 25 | `web/src/services/accounting.service.js:938` | `fn_accounting_close_period` | p_tenant_id, p_year, p_month, p_notes | Sí (p_tenant) | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:486; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:234 | contabilidad · Cierra periodo contable; validar bloqueo de asientos del rango. · 2 defs |
| 26 | `web/src/services/accounting.service.js:894` | `fn_accounting_get_withholding_summary` | p_tenant_id, p_date_from, p_date_to | Sí (p_tenant) | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:360 | contabilidad · Resumen de retenciones; lectura. |
| 27 | `web/src/services/accounting.service.js:961` | `fn_accounting_open_period` | p_tenant_id, p_year, p_month, p_notes | Sí (p_tenant) | web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:105 | contabilidad · Abre periodo contable; validar unicidad por tenant. |
| 28 | `web/src/services/accounting.service.js:1225` | `fn_accounting_post_entry` | p_tenant_id, p_entry_id, p_posted_by | Sí (p_tenant) | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:628; web/ADD_ACCOUNTING_CO_MODULE.sql:378; +1 | contabilidad · SECURITY DEFINER; valida usuario/tenant/periodo y postea DRAFT. Ver R12. · 3 defs |
| 29 | `web/src/services/accounting.service.js:800` | `fn_accounting_process_queue` | p_tenant_id, p_limit, p_only_event_id | Sí (p_tenant) | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:705; web/ADD_ACCOUNTING_QUEUE_PROCESSOR.sql:20; +1 | contabilidad · SECURITY DEFINER; worker de cola contable con dedupe. Ver R13. · 3 defs |
| 30 | `web/src/services/accounting.service.js:971` | `fn_accounting_reopen_period` | p_tenant_id, p_year, p_month, p_notes | Sí (p_tenant) | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:569; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:215 | contabilidad · Reabre periodo; validar autorización y asientos ya posteados. · 2 defs |
| 31 | `web/src/services/accounting.service.js:133` | `fn_accounting_summary` | p_tenant_id | Sí (p_tenant) | web/ADD_ACCOUNTING_CO_MODULE.sql:250 | contabilidad · Resumen contable por rango; lectura. |
| 32 | `web/src/services/accounting.service.js:751` | `fn_accounting_trial_balance` | p_tenant_id, p_date_from, p_date_to | Sí (p_tenant) | web/ADD_ACCOUNTING_CO_MODULE.sql:317 | contabilidad · Balance de comprobación; lectura agregada. |
| 33 | `web/src/services/tenantBilling.service.js:369` | `fn_change_subscription_plan` | p_subscription_id, p_new_plan_price_id, p_apply_from | Deriva auth/contexto | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:6 | identidad/tenancy |
| 34 | `web/src/services/tenantBilling.service.js:690` | `fn_change_subscription_plan_prorated` | p_subscription_id, p_new_plan_price_id | Deriva auth/contexto | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:639 | identidad/tenancy |
| 35 | `web/src/services/tenants.service.js:94` | `fn_create_tenant` | p_tenant_data, name, legal_name, tax_id, email, phone, address, invoice_prefix, invoice_start_number, is_active, p_admin_data, user_id, full_name | N/A (superadmin/auth) | CreateTenantSP.sql:17; SECURE_TENANT_MANAGEMENT.sql:38; +1 | identidad/tenancy · Alta de tenant y provisión inicial; operación de superadmin. · 3 defs |
| 36 | `mobile/src/services/tenantBilling.service.js:129` | `fn_get_my_tenant_billing_summary` | — | Deriva auth/contexto | ADD_TENANT_BILLING_MONETIZATION.sql:1113 | identidad/tenancy |
| 37 | `web/src/services/subscriptionSignup.service.js:54` | `fn_get_public_subscription_signup_status` | p_signup_id | N/A (público) | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:410 | identidad/tenancy |
| 38 | `mobile/src/services/tenantBilling.service.js:185` | `fn_get_tenant_billing_limit_usage` | p_tenant_id | Sí (p_tenant) | ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql:21 | identidad/tenancy |
| 39 | `web/src/services/tenantBilling.service.js:578` | `fn_get_tenant_billing_limit_usage` | p_tenant_id | Sí (p_tenant) | ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql:21 | identidad/tenancy |
| 40 | `web/src/services/tenantBilling.service.js:105` | `fn_get_tenant_billing_summary` | p_tenant_id | Sí (p_tenant) | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:138 | identidad/tenancy |
| 41 | `web/src/services/tenantBilling.service.js:385` | `fn_get_tenant_payment_history` | p_tenant_id, p_limit | Sí (p_tenant) | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:280 | identidad/tenancy |
| 42 | `web/src/services/tenants.service.js:18` | `fn_get_tenant_template_json` | p_tenant_id | Sí (p_tenant) | CreateTenantSP.sql:377 | identidad/tenancy |
| 43 | `mobile/src/services/menu.service.js:33` | `fn_get_user_menus` | p_auth_user_id | Por usuario (parámetro) | ROLES_MENUS_SYSTEM.sql:480 | identidad/tenancy · Menús por usuario/rol; lectura dependiente de auth. |
| 44 | `web/src/services/roles.service.js:213` | `fn_get_user_menus` | p_auth_user_id | Por usuario (parámetro) | ROLES_MENUS_SYSTEM.sql:480 | identidad/tenancy · Menús por usuario/rol; lectura dependiente de auth. |
| 45 | `web/src/services/subscriptionSignup.service.js:20` | `fn_list_public_subscription_plans` | — | N/A (público) | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:166 | identidad/tenancy · RPC público de planes; lectura. |
| 46 | `web/src/services/tenantBilling.service.js:331` | `fn_superadmin_assign_tenant_plan` | p_tenant_id, p_plan_price_id, p_status, p_start_at, p_trial_end_at, p_current_period_end, p_renewal_mode, p_note | N/A (superadmin/auth) | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:230 | identidad/tenancy |
| 47 | `mobile/src/services/rolesMenus.service.js:253` | `fn_superadmin_create_role_for_all_tenants` | p_role_name, p_permission_ids, p_menu_codes | N/A (superadmin/auth) | ROLES_MENUS_SYSTEM.sql:327 | identidad/tenancy |
| 48 | `web/src/services/superAdminRoles.service.js:263` | `fn_superadmin_create_role_for_all_tenants` | p_role_name, p_permission_ids, p_menu_codes | N/A (superadmin/auth) | ROLES_MENUS_SYSTEM.sql:327 | identidad/tenancy |
| 49 | `web/src/services/tenantBilling.service.js:708` | `fn_superadmin_list_all_payments` | p_limit, p_status, p_tenant_search | N/A (superadmin/auth) | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:774 | identidad/tenancy |
| 50 | `web/src/services/tenantBilling.service.js:559` | `fn_superadmin_list_public_subscription_signup_events` | p_signup_id | N/A (superadmin/auth) | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:755 | identidad/tenancy |
| 51 | `web/src/services/tenantBilling.service.js:453` | `fn_superadmin_list_public_subscription_signups` | p_limit | N/A (superadmin/auth) | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:658 | identidad/tenancy |
| 52 | `web/src/services/tenantBilling.service.js:132` | `fn_superadmin_list_tenant_billing_summary` | — | N/A (superadmin/auth) | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:166 | identidad/tenancy |
| 53 | `web/src/services/tenants.service.js:139` | `fn_superadmin_list_tenants` | — | N/A (superadmin/auth) | web/ADD_SUPERADMIN_TENANTS_LIST_RPC.sql:6 | identidad/tenancy |
| 54 | `web/src/services/tenantBilling.service.js:399` | `fn_superadmin_record_manual_payment` | p_invoice_id, p_amount, p_currency_code, p_provider, p_provider_reference, p_note | N/A (superadmin/auth) | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:152 | identidad/tenancy |
| 55 | `mobile/src/services/rolesMenus.service.js:273` | `fn_superadmin_sync_menus_to_role_all_tenants` | p_role_name, p_menu_codes | N/A (superadmin/auth) | ROLES_MENUS_SYSTEM.sql:404 | identidad/tenancy |
| 56 | `web/src/services/superAdminRoles.service.js:284` | `fn_superadmin_sync_menus_to_role_all_tenants` | p_role_name, p_menu_codes | N/A (superadmin/auth) | ROLES_MENUS_SYSTEM.sql:404 | identidad/tenancy |
| 57 | `web/src/services/tenantBilling.service.js:352` | `fn_superadmin_update_subscription_status` | p_subscription_id, p_status, p_grace_end_at, p_note | N/A (superadmin/auth) | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:418 | identidad/tenancy |
| 58 | `mobile/src/services/productPhotoImport.service.js:256` | `fn_apply_stock_delta` | p_tenant, p_location, p_variant, p_delta | Sí (p_tenant) | FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:21; SpVistasFN.sql:44; +1 | inventario/producción · Delta de stock; convive con el modelo de lotes. Ver R07. · 3 defs |
| 59 | `web/src/services/inventory.service.js:413` | `fn_apply_stock_delta` | p_tenant, p_location, p_variant, p_delta | Sí (p_tenant) | FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:21; SpVistasFN.sql:44; +1 | inventario/producción · Delta de stock; convive con el modelo de lotes. Ver R07. · 3 defs |
| 60 | `web/src/services/productPhotoImport.service.js:260` | `fn_apply_stock_delta` | p_tenant, p_location, p_variant, p_delta | Sí (p_tenant) | FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:21; SpVistasFN.sql:44; +1 | inventario/producción · Delta de stock; convive con el modelo de lotes. Ver R07. · 3 defs |
| 61 | `mobile/src/services/inventoryCatalog.service.js:684` | `fn_complete_production` | p_production_order, p_quantity_produced, p_completed_by, p_expiration_date, p_physical_location | Deriva de entidad | FIX_MANUFACTURED_COST_PRICE_AUTO_UPDATE.sql:31; FIX_PRODUCTION_COMPLETE.sql:248; +1 | inventario/producción · Cierra orden, consume BOM y genera lote/output. Ver R11. · 3 defs |
| 62 | `web/src/services/manufacturing.service.js:608` | `fn_complete_production` | p_production_order, p_quantity_produced, p_completed_by, p_expiration_date, p_physical_location | Deriva de entidad | FIX_MANUFACTURED_COST_PRICE_AUTO_UPDATE.sql:31; FIX_PRODUCTION_COMPLETE.sql:248; +1 | inventario/producción · Cierra orden, consume BOM y genera lote/output. Ver R11. · 3 defs |
| 63 | `mobile/src/services/inventoryCatalog.service.js:653` | `fn_create_production_order` | p_tenant, p_location, p_bom, p_quantity, p_created_by, p_scheduled_start, p_notes | Sí (p_tenant) | MANUFACTURING_PHASE456_FINAL.sql:128 | inventario/producción · Crea orden de producción con tenant/sede; valida BOM y cantidades. |
| 64 | `web/src/services/manufacturing.service.js:562` | `fn_create_production_order` | p_tenant, p_location, p_bom, p_quantity, p_created_by, p_scheduled_start, p_notes | Sí (p_tenant) | MANUFACTURING_PHASE456_FINAL.sql:128 | inventario/producción · Crea orden de producción con tenant/sede; valida BOM y cantidades. |
| 65 | `web/src/services/batches.service.js:254` | `fn_expiration_report` | p_tenant, p_location, p_days_ahead | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql:338 | inventario/producción |
| 66 | `mobile/src/services/batches.service.js:318` | `fn_generate_batch_number` | p_tenant, p_variant, p_location, p_prefix | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE2.sql:283; FIX_BATCH_NUMBER_BY_LOCATION.sql:22; +2 | inventario/producción · Numeración de lote por ubicación; requiere secuencia/unique portable. · 4 defs |
| 67 | `mobile/src/services/purchases.service.js:851` | `fn_generate_batch_number` | p_tenant, p_variant, p_location, p_prefix | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE2.sql:283; FIX_BATCH_NUMBER_BY_LOCATION.sql:22; +2 | inventario/producción · Numeración de lote por ubicación; requiere secuencia/unique portable. · 4 defs |
| 68 | `web/src/services/batches.service.js:160` | `fn_generate_batch_number` | p_tenant, p_variant, p_prefix | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE2.sql:283; FIX_BATCH_NUMBER_BY_LOCATION.sql:22; +2 | inventario/producción · Numeración de lote por ubicación; requiere secuencia/unique portable. · 4 defs |
| 69 | `web/src/services/alerts.service.js:146` | `fn_refresh_expiration_alerts` | — | N/A (global) | ADD_EXPIRATION_ALERTS_REALTIME.sql:38 | inventario/producción · Recalcula alertas de vencimiento; operación global de mantenimiento. |
| 70 | `mobile/src/services/inventoryOperations.service.js:5` | `fn_refresh_stock_alerts` | — | N/A (global) | FIX_STOCK_ALERTS_REALTIME.sql:154; SpVistasFN.sql:907 | inventario/producción · Recalcula alertas de stock mínimo. · 2 defs |
| 71 | `web/src/services/alerts.service.js:116` | `fn_refresh_stock_alerts` | — | N/A (global) | FIX_STOCK_ALERTS_REALTIME.sql:154; SpVistasFN.sql:907 | inventario/producción · Recalcula alertas de stock mínimo. · 2 defs |
| 72 | `web/src/services/inventory.service.js:224` | `fn_refresh_stock_alerts` | — | N/A (global) | FIX_STOCK_ALERTS_REALTIME.sql:154; SpVistasFN.sql:907 | inventario/producción · Recalcula alertas de stock mínimo. · 2 defs |
| 73 | `web/src/services/batches.service.js:340` | `fn_refresh_stock_balances` | p_concurrent | N/A (global) | ADD_EXPIRATION_BATCHES_PHASE2.sql:192 | inventario/producción · Recalcula el snapshot de saldos; mantenimiento, no usar para decidir stock. |
| 74 | `mobile/src/services/inventoryCatalog.service.js:671` | `fn_start_production` | p_production_order, p_started_by | Deriva de entidad | MANUFACTURING_PHASE456_FINAL.sql:219 | inventario/producción · Inicia orden de producción; validar estado y tenant. |
| 75 | `web/src/services/manufacturing.service.js:585` | `fn_start_production` | p_production_order, p_started_by | Deriva de entidad | MANUFACTURING_PHASE456_FINAL.sql:219 | inventario/producción · Inicia orden de producción; validar estado y tenant. |
| 76 | `web/src/services/inventory.service.js:430` | `fn_update_min_stock` | p_tenant, p_variant, p_min_stock | Sí (p_tenant) | AddMinStock.sql:92 | inventario/producción |
| 77 | `mobile/src/services/inventoryOperations.service.js:36` | `sp_create_inventory_adjustment` | p_tenant, p_location, p_variant, p_quantity, p_unit_cost, p_is_increase, p_created_by, p_note | Sí (p_tenant) | INVENTORY_PURCHASE_HARDENING.sql:103 | inventario/producción · Ajuste de inventario con movimiento; usado por mobile. |
| 78 | `web/src/services/inventory.service.js:236` | `sp_create_inventory_adjustment` | p_tenant, p_location, p_variant, p_quantity, p_unit_cost, p_is_increase, p_created_by, p_note | Sí (p_tenant) | INVENTORY_PURCHASE_HARDENING.sql:103 | inventario/producción · Ajuste de inventario con movimiento; usado por mobile. |
| 79 | `mobile/src/services/inventoryOperations.service.js:84` | `sp_create_transfer_request` | p_tenant, p_from_location, p_to_location, p_variant, p_quantity, p_unit_cost, p_created_by, p_note | Sí (p_tenant) | ADD_TRANSFER_IN_TRANSIT_CORE.sql:44; INVENTORY_PURCHASE_HARDENING.sql:255 | inventario/producción · Solicitud de traslado entre sedes; no mueve stock hasta recepción. · 2 defs |
| 80 | `web/src/services/inventory.service.js:260` | `sp_create_transfer_request` | p_tenant, p_from_location, p_to_location, p_variant, p_quantity, p_unit_cost, p_created_by, p_note | Sí (p_tenant) | ADD_TRANSFER_IN_TRANSIT_CORE.sql:44; INVENTORY_PURCHASE_HARDENING.sql:255 | inventario/producción · Solicitud de traslado entre sedes; no mueve stock hasta recepción. · 2 defs |
| 81 | `mobile/src/services/inventoryOperations.service.js:215` | `sp_receive_transfer_request` | p_tenant, p_transfer_id, p_received_by, p_note | Sí (p_tenant) | ADD_TRANSFER_IN_TRANSIT_CORE.sql:134 | inventario/producción · Recepción de traslado; aplica entrada/salida y diferencias. |
| 82 | `web/src/services/inventory.service.js:326` | `sp_receive_transfer_request` | p_tenant, p_transfer_id, p_received_by, p_note | Sí (p_tenant) | ADD_TRANSFER_IN_TRANSIT_CORE.sql:134 | inventario/producción · Recepción de traslado; aplica entrada/salida y diferencias. |
| 83 | `mobile/src/services/layaway.service.js:6` | `fn_expire_due_layaways` | p_tenant | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:605 | layaway/separados · Job de contratos vencidos; invoca sp_cancel_layaway. |
| 84 | `web/src/services/layaway.service.js:7` | `fn_expire_due_layaways` | p_tenant | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:605 | layaway/separados · Job de contratos vencidos; invoca sp_cancel_layaway. |
| 85 | `web/src/services/alerts.service.js:131` | `fn_refresh_layaway_alerts` | — | N/A (global) | SpVistasFN.sql:950; UPDATE_VIEWS_TO_THIRD_PARTIES.sql:226 | layaway/separados · Recalcula alertas de separados; operación global de mantenimiento. · 2 defs |
| 86 | `mobile/src/services/layaway.service.js:148` | `sp_add_layaway_payment` | p_tenant, p_layaway, p_payment_method_code, p_amount, p_paid_by, p_cash_session, p_reference | Sí (p_tenant) | PlanSepare.sql:401 | layaway/separados · Pago con lock de contrato ACTIVE; actualiza saldo/estado. |
| 87 | `web/src/services/layaway.service.js:159` | `sp_add_layaway_payment` | p_tenant, p_layaway, p_payment_method_code, p_amount, p_paid_by, p_cash_session, p_reference | Sí (p_tenant) | PlanSepare.sql:401 | layaway/separados · Pago con lock de contrato ACTIVE; actualiza saldo/estado. |
| 88 | `mobile/src/services/layaway.service.js:185` | `sp_cancel_layaway` | p_tenant, p_layaway, p_cancelled_by, p_status, p_note | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:526; PlanSepare.sql:609 | layaway/separados · Cancela/expira contrato y libera reserva; lock de cabecera. · 2 defs |
| 89 | `web/src/services/layaway.service.js:208` | `sp_cancel_layaway` | p_tenant, p_layaway, p_cancelled_by, p_status, p_note | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:526; PlanSepare.sql:609 | layaway/separados · Cancela/expira contrato y libera reserva; lock de cabecera. · 2 defs |
| 90 | `mobile/src/services/layaway.service.js:169` | `sp_complete_layaway_to_sale` | p_tenant, p_layaway, p_sold_by, p_note | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:305; PlanSepare.sql:479 | layaway/separados · Convierte separado en venta; consume stock y registra pagos. · 2 defs |
| 91 | `web/src/services/layaway.service.js:186` | `sp_complete_layaway_to_sale` | p_tenant, p_layaway, p_sold_by, p_note | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:305; PlanSepare.sql:479 | layaway/separados · Convierte separado en venta; consume stock y registra pagos. · 2 defs |
| 92 | `mobile/src/services/layaway.service.js:125` | `sp_create_layaway` | p_tenant, p_location, p_customer, p_created_by, p_items, p_due_date, p_note, p_initial_payment, p_installments | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:14; PlanSepare.sql:227; +2 | layaway/separados · Contrato, items, pago inicial y reserva de stock; 4 variantes. · 4 defs |
| 93 | `web/src/services/layaway.service.js:130` | `sp_create_layaway` | p_tenant, p_location, p_customer, p_created_by, p_items, p_due_date, p_note, p_initial_payment, p_installments | Sí (p_tenant) | LAYAWAY_OPERATIONAL_HARDENING.sql:14; PlanSepare.sql:227; +2 | layaway/separados · Contrato, items, pago inicial y reserva de stock; 4 variantes. · 4 defs |
| 94 | `mobile/src/services/notifications.service.js:95` | `fn_emit_notification_event` | p_tenant, p_event_type, p_severity, p_title, p_message, p_payload, p_dedupe_key, p_target_user_id, p_target_role, p_location_id, p_cash_register_id, p_action_url, p_entity_type, p_entity_id, p_dedupe_window_minutes | Sí (p_tenant) | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:168 | notificaciones/outbox · SECURITY DEFINER; inserta evento y notificación in-app con dedupe. |
| 95 | `mobile/src/services/notifications.service.js:7` | `fn_list_my_notifications` | p_limit, p_offset, p_only_unread | Deriva auth/contexto | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:345 | notificaciones/outbox · SECURITY DEFINER; lista del usuario con limit/offset acotados. |
| 96 | `mobile/src/services/notifications.service.js:48` | `fn_mark_all_notifications_read` | — | Deriva auth/contexto | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:410 | notificaciones/outbox · SECURITY DEFINER; marca todas las del usuario. |
| 97 | `mobile/src/services/notifications.service.js:36` | `fn_mark_notification_read` | p_notification_id | Deriva auth/contexto | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:388 | notificaciones/outbox · SECURITY DEFINER; marca una notificación del usuario. |
| 98 | `mobile/src/services/notifications.service.js:59` | `fn_set_my_notification_pref` | p_event_type, p_enabled, p_min_severity, p_mute_until | Deriva auth/contexto | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:431 | notificaciones/outbox · SECURITY DEFINER; preferencias de notificación del usuario. |
| 99 | `mobile/src/services/pushNotifications.service.js:178` | `fn_upsert_my_push_device` | p_push_token, p_push_provider, p_platform, p_device_name, p_app_version, p_device_uid, p_expo_push_token | Deriva auth/contexto | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:83; mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:174; +2 | notificaciones/outbox · SECURITY DEFINER; registra token push del usuario. · 4 defs |
| 100 | `web/src/services/reports.service.js:1057` | `fn_reports_dashboard_summary` | p_tenant_id, p_location_id | Sí (p_tenant) | web/ADD_REPORTS_DASHBOARD_SUMMARY_RPC.sql:1 | reportes |
| 101 | `mobile/src/services/thirdParties.service.js:61` | `fn_delete_third_party` | p_id, p_tenant_id | Sí (p_tenant) | FIX_THIRD_PARTIES_RPC.sql:106 | soporte/otros |
| 102 | `web/src/services/thirdParties.service.js:62` | `fn_delete_third_party` | p_id, p_tenant_id | Sí (p_tenant) | FIX_THIRD_PARTIES_RPC.sql:106 | soporte/otros |
| 103 | `web/src/services/products.service.js:641` | `fn_get_unit_by_code` | p_tenant_id, p_code | Sí (p_tenant) | CREATE_UNITS_OF_MEASURE.sql:304 | soporte/otros |
| 104 | `mobile/src/services/batches.service.js:413` | `fn_top_at_risk_products` | p_tenant, p_location, p_limit | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql:387 | soporte/otros |
| 105 | `web/src/services/batches.service.js:274` | `fn_top_at_risk_products` | p_tenant, p_location, p_limit | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql:387 | soporte/otros |
| 106 | `web/src/services/reports.service.js:442` | `fn_top_manufactured_products_by_margin` | p_tenant_id, p_limit | Sí (p_tenant) | MANUFACTURING_PRODUCTION_COST_REPORT.sql:297 | soporte/otros |
| 107 | `mobile/src/services/thirdParties.service.js:38` | `fn_upsert_third_party` | p_data | No / a verificar | ADD_FE_COMPLEMENTARY.sql:102; FIX_THIRD_PARTIES_RPC.sql:9 | soporte/otros · Upsert de tercero desde JSON; el tenant viaja dentro de p_data (a verificar). · 2 defs |
| 108 | `mobile/src/services/thirdParties.service.js:51` | `fn_upsert_third_party` | p_data | No / a verificar | ADD_FE_COMPLEMENTARY.sql:102; FIX_THIRD_PARTIES_RPC.sql:9 | soporte/otros · Upsert de tercero desde JSON; el tenant viaja dentro de p_data (a verificar). · 2 defs |
| 109 | `web/src/services/thirdParties.service.js:47` | `fn_upsert_third_party` | p_data | No / a verificar | ADD_FE_COMPLEMENTARY.sql:102; FIX_THIRD_PARTIES_RPC.sql:9 | soporte/otros · Upsert de tercero desde JSON; el tenant viaja dentro de p_data (a verificar). · 2 defs |
| 110 | `web/src/services/thirdParties.service.js:56` | `fn_upsert_third_party` | p_data | No / a verificar | ADD_FE_COMPLEMENTARY.sql:102; FIX_THIRD_PARTIES_RPC.sql:9 | soporte/otros · Upsert de tercero desde JSON; el tenant viaja dentro de p_data (a verificar). · 2 defs |
| 111 | `mobile/src/services/onlineOrders.service.js:103` | `fn_confirm_online_manual_order` | p_online_order_id, p_payment_reference, p_payment_note | Deriva auth/contexto | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:30; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:446; +1 | tienda online/público · Confirma pedido online; validar autorización y pago. · 3 defs |
| 112 | `web/src/services/onlineStore.service.js:811` | `fn_confirm_online_manual_order` | p_online_order_id, p_payment_reference, p_payment_note | Deriva auth/contexto | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:30; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:446; +1 | tienda online/público · Confirma pedido online; validar autorización y pago. · 3 defs |
| 113 | `web/src/services/onlineStore.service.js:569` | `fn_create_online_manual_order` | p_slug, p_customer_name, p_customer_email, p_customer_phone, p_customer_note, p_payment_reference, p_landing_return_url, p_lines, lines, p_payment_mode, p_payment_proof_url, p_delivery_address | Deriva de tienda (slug) | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:93; ADD_ONLINE_STORE_MVP.sql:650; +6 | tienda online/público · Pedido online manual; tenant desde el slug; 8 definiciones a consolidar. · 8 defs |
| 114 | `web/src/services/onlineStore.service.js:539` | `fn_get_public_online_store` | p_slug | N/A (público) | ADD_ONLINE_STORE_MVP.sql:525; ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:48 | tienda online/público · RPC público de tienda; sin tenant de sesión. · 2 defs |
| 115 | `web/src/services/onlineStore.service.js:858` | `fn_get_public_order_status` | p_order_id | N/A (público) | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:770; ONLINE_STORE_ADDRESS_AND_STATUS.sql:304 | tienda online/público · RPC público por token; limitar datos expuestos. · 2 defs |
| 116 | `web/src/views/PublicOrderStatus.vue:403` | `fn_get_public_order_status` | p_order_id | N/A (público) | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:770; ONLINE_STORE_ADDRESS_AND_STATUS.sql:304 | tienda online/público · RPC público por token; limitar datos expuestos. · 2 defs |
| 117 | `web/src/services/onlineStore.service.js:551` | `fn_list_public_online_store_products` | p_slug | N/A (público) | ADD_ONLINE_STORE_MVP.sql:577; ADD_ONLINE_STORE_PUBLIC_CATEGORIES.sql:8; +1 | tienda online/público · RPC público de catálogo; paginación y filtros a revisar. · 3 defs |
| 118 | `mobile/src/services/onlineOrders.service.js:119` | `fn_reject_online_manual_order` | p_online_order_id, p_reason | Deriva auth/contexto | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:196; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:599; +1 | tienda online/público · Rechaza pedido online; validar autorización y motivo. · 3 defs |
| 119 | `web/src/services/onlineStore.service.js:827` | `fn_reject_online_manual_order` | p_online_order_id, p_reason | Deriva auth/contexto | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:196; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:599; +1 | tienda online/público · Rechaza pedido online; validar autorización y motivo. · 3 defs |
| 120 | `web/src/services/pricingRules.service.js:167` | `fn_calculate_price` | p_tenant, p_variant, p_cost, p_location | Sí (p_tenant) | PricingRules.sql:203 | ventas/caja · Cálculo de precio; candidato a dominio Go puro. |
| 121 | `web/src/services/pricingRules.service.js:148` | `fn_get_pricing_policy` | p_tenant, p_variant, p_location | Sí (p_tenant) | PricingRules.sql:85 | ventas/caja · Política de precios por tenant; lectura. |
| 122 | `web/src/services/sales.service.js:273` | `fn_get_sales_forecast_data` | p_tenant_id, p_location_id, p_days_back | Sí (p_tenant) | SpVistasFN.sql:1852 | ventas/caja |
| 123 | `mobile/src/services/pos.service.js:570` | `fn_get_tax_info_for_variant` | p_tenant, p_variant | Sí (p_tenant) | FIX_TAX_INFO_DISPLAY.sql:12 | ventas/caja · Información fiscal por variante; auxiliar de ventas. |
| 124 | `mobile/src/services/sales.service.js:290` | `fn_get_tax_info_for_variant` | p_tenant, p_variant | Sí (p_tenant) | FIX_TAX_INFO_DISPLAY.sql:12 | ventas/caja · Información fiscal por variante; auxiliar de ventas. |
| 125 | `web/src/services/taxes.service.js:178` | `fn_get_tax_info_for_variant` | p_tenant, p_variant | Sí (p_tenant) | FIX_TAX_INFO_DISPLAY.sql:12 | ventas/caja · Información fiscal por variante; auxiliar de ventas. |
| 126 | `web/src/services/taxes.service.js:158` | `fn_get_tax_rate_for_variant` | p_tenant, p_variant | Sí (p_tenant) | FIX_TAX_FUNCTION_PERMISSIONS.sql:11; SpVistasFN.sql:65; +1 | ventas/caja · Tasa de impuesto por variante; auxiliar de ventas. · 3 defs |
| 127 | `web/src/services/cashAssignment.service.js:7` | `fn_pos_home_context` | p_tenant, p_user | Sí (p_tenant) | AsignacionCajerosCaja.sql:236; EJECUTAR_MIGRACION_CAJAS.sql:202; +1 | ventas/caja · Contexto agregado del POS (caja, alertas); lectura multi-tabla. · 3 defs |
| 128 | `mobile/src/services/cashMenu.service.js:508` | `sp_assign_cash_register_to_user` | p_tenant, p_cash_register, p_user, p_assigned_by, p_is_active, p_note | Sí (p_tenant) | AsignacionCajerosCaja.sql:115; EJECUTAR_MIGRACION_CAJAS.sql:102; +1 | ventas/caja · Asigna caja a usuario; administración de sedes. · 3 defs |
| 129 | `web/src/services/cashAssignment.service.js:49` | `sp_assign_cash_register_to_user` | p_tenant, p_cash_register, p_user, p_assigned_by, p_is_active, p_note | Sí (p_tenant) | AsignacionCajerosCaja.sql:115; EJECUTAR_MIGRACION_CAJAS.sql:102; +1 | ventas/caja · Asigna caja a usuario; administración de sedes. · 3 defs |
| 130 | `web/src/services/cashAssignment.service.js:87` | `sp_close_cash_session_secure` | p_tenant, p_cash_session, p_closed_by, p_counted_amount | Sí (p_tenant) | AsignacionCajerosCaja.sql:201; EJECUTAR_MIGRACION_CAJAS.sql:174; +1 | ventas/caja · Cierre de caja con validación de permisos y descuadre. · 3 defs |
| 131 | `mobile/src/services/sales.service.js:548` | `sp_create_return` | p_tenant, p_sale_id, p_created_by, p_lines, p_reason | Sí (p_tenant) | SpVistasFN.sql:344 | ventas/caja · Devolución base: repone stock e inserta reembolsos. Ver R03. |
| 132 | `web/src/services/sales.service.js:204` | `sp_create_return` | p_tenant, p_sale_id, p_created_by, p_lines, p_reason | Sí (p_tenant) | SpVistasFN.sql:344 | ventas/caja · Devolución base: repone stock e inserta reembolsos. Ver R03. |
| 133 | `mobile/src/services/sales.service.js:535` | `sp_create_return_v2` | p_tenant, p_sale_id, p_created_by, p_lines, p_refunds, p_reason | Sí (p_tenant) | ADD_SALE_RETURNS_REFUNDS_V2.sql:53 | ventas/caja · Valida reembolsos contra el total y delega en sp_create_return. Ver R03. |
| 134 | `web/src/services/sales.service.js:222` | `sp_create_return_v2` | p_tenant, p_sale_id, p_created_by, p_lines, p_refunds, p_reason | Sí (p_tenant) | ADD_SALE_RETURNS_REFUNDS_V2.sql:53 | ventas/caja · Valida reembolsos contra el total y delega en sp_create_return. Ver R03. |
| 135 | `mobile/src/services/pos.service.js:717` | `sp_create_sale` | — | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql:43; FIX_SALE_ROUNDING.sql:85; +5 | ventas/caja · Venta atómica: cabecera, líneas, pagos, numeración y stock/lotes. 7 variantes; … · payload variable · 7 defs |
| 136 | `web/src/services/sales.service.js:88` | `sp_create_sale` | — | Sí (p_tenant) | ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql:43; FIX_SALE_ROUNDING.sql:85; +5 | ventas/caja · Venta atómica: cabecera, líneas, pagos, numeración y stock/lotes. 7 variantes; … · payload variable · 7 defs |
| 137 | `mobile/src/services/pos.service.js:699` | `sp_create_sale_idempotent` | — | Sí (p_tenant) | mobile/ADD_IDEMPOTENT_MOBILE_SALES.sql:27; mobile/ADD_POS_MANUAL_SALE_DATETIME_IDEMPOTENT.sql:14; +1 | ventas/caja · Idempotencia por operation_id (advisory lock + mobile_sale_operations). Ver R02. · payload variable · 3 defs |
| 138 | `web/src/services/cashAssignment.service.js:69` | `sp_open_cash_session` | p_tenant, p_cash_register, p_opened_by, p_opening_amount | Sí (p_tenant) | AsignacionCajerosCaja.sql:152; EJECUTAR_MIGRACION_CAJAS.sql:131; +1 | ventas/caja · Apertura de caja con validación de usuario/asignación. · 3 defs |
| 139 | `mobile/src/services/sales.service.js:473` | `?candidate.name` | — | a verificar | — | resolución dinámica; no verificable estáticamente |
| 140 | `web/src/services/supabase.service.js:284` | `?functionName` | — | a verificar | — | resolución dinámica; no verificable estáticamente |

### A.3 Consultas de tabla

Los 466 sitios `.from()` que no son mutaciones. `Tipo`: `listado` (orden, límite, rango, vista o `count`), `conteo` (`head: true`), `detalle` (`.limit(1)` o `.single()/.maybeSingle()`) o `consulta` (multirregistro sin orden ni límite). `Señales` son heurísticas estáticas, no planes de ejecución.

| # | Sitio (archivo:línea) | Tipo | Entidad | Filtros | Orden | Límite | Tenant | Señales |
|---:|---|---|---|---|---|---|---|---|
| 1 | `web/src/services/accounting.service.js:667` | detalle | accounting_accounts | tenant_id eq tenantId; account_id eq accountId | — | — | Sí | puntual |
| 2 | `web/src/services/accounting.service.js:816` | listado | accounting_accounts | tenant_id eq tenantId; is_active eq true; is_postable eq true (cond.) | code | — | Sí | sin límite; orden sin desempate |
| 3 | `web/src/services/accounting.service.js:1270` | listado | accounting_accounts | tenant_id eq tenantId; is_active eq true (cond.) | code | — | Sí | sin límite; orden sin desempate |
| 4 | `web/src/services/accounting.service.js:1308` | detalle | accounting_accounts | tenant_id eq tenantId; account_id eq account.account_id | — | 1 | Sí | puntual |
| 5 | `web/src/services/accounting.service.js:1320` | detalle | accounting_accounts | — | — | 1 | No | puntual |
| 6 | `web/src/services/accounting.service.js:1335` | detalle | accounting_accounts | tenant_id eq tenantId; account_id eq accountId | — | 1 | Sí | puntual |
| 7 | `web/src/services/accounting.service.js:1063` | listado | accounting_automation_exceptions | tenant_id eq tenantId; status eq options.status (cond.) | created_at desc | options.limit \|\| 100 | Sí | orden sin desempate |
| 8 | `web/src/services/accounting.service.js:1089` | detalle | accounting_automation_exceptions | tenant_id eq tenantId; exception_id eq exceptionId | — | 1 | Sí | puntual |
| 9 | `web/src/services/accounting.service.js:1544` | conteo | accounting_automation_exceptions | tenant_id eq tenantId; status eq 'OPEN' | — | — | Sí | conteo head |
| 10 | `web/src/services/accounting.service.js:184` | consulta | accounting_entries | tenant_id eq tenantId; entry_date gte period.date_from; entry_date lte period.date_to | — | — | Sí | multirregistro; sin límite; sin orden |
| 11 | `web/src/services/accounting.service.js:585` | consulta | accounting_entries | tenant_id eq tenantId; entry_date gte filters.date_from (cond.); entry_date lte filters.date_to (cond.); status eq filters.status (cond.); source_module eq filters.… | — | — | Sí | multirregistro; sin límite; sin orden |
| 12 | `web/src/services/accounting.service.js:767` | listado | accounting_entries | tenant_id eq tenantId | entry_date desc, created_at desc | limit | Sí | orden sin desempate |
| 13 | `web/src/services/accounting.service.js:1171` | detalle | accounting_entries | — | — | 1 | No | puntual |
| 14 | `web/src/services/accounting.service.js:1244` | detalle | accounting_entries | tenant_id eq tenantId; entry_id eq entryId; status eq 'DRAFT' | — | 1 | Sí | puntual |
| 15 | `web/src/services/accounting.service.js:1533` | consulta | accounting_entries | tenant_id eq tenantId; entry_date gte fromDate; entry_date lte toDate | — | — | Sí | multirregistro; sin límite; sin orden |
| 16 | `web/src/services/accounting.service.js:213` | conteo | accounting_event_queue | tenant_id eq tenantId; status in ['PENDING', 'FAILED'] | — | — | Sí | conteo head |
| 17 | `web/src/services/accounting.service.js:784` | listado | accounting_event_queue | tenant_id eq tenantId | created_at desc | limit | Sí | orden sin desempate |
| 18 | `web/src/services/accounting.service.js:1539` | conteo | accounting_event_queue | tenant_id eq tenantId; status in ['PENDING', 'FAILED'] | — | — | Sí | conteo head |
| 19 | `web/src/services/accounting.service.js:913` | listado | accounting_period_closures | tenant_id eq tenantId; period_year eq Number(options.year) (cond.); source_module eq filters.source_module (cond.) | period_year desc, period_month desc | options.limit \|\| 48 | Sí | orden sin desempate |
| 20 | `web/src/services/accounting.service.js:998` | listado | accounting_posting_rules | tenant_id eq tenantId; source_module eq filters.source_module (cond.); event_type eq filters.event_type (cond.); status eq options.status (cond.) | priority, created_at | — | Sí | sin límite; orden sin desempate |
| 21 | `web/src/services/accounting.service.js:1043` | detalle | accounting_posting_rules | — | — | 1 | No | puntual |
| 22 | `web/src/services/accounting.service.js:842` | listado | accounting_withholding_configs | tenant_id eq tenantId | code | — | Sí | sin límite; orden sin desempate |
| 23 | `web/src/services/accounting.service.js:873` | detalle | accounting_withholding_configs | period_year eq Number(options.year) (cond.) | — | 1 | No | puntual |
| 24 | `mobile/src/services/aiTelemetry.service.js:248` | listado | ai_telemetry_events | tenant_id eq tenantId | occurred_at desc | Math.max(1, Math.mi… | Sí | orden sin desempate |
| 25 | `web/src/services/aiTelemetry.service.js:181` | listado | ai_telemetry_events | tenant_id eq tenantId | occurred_at desc | Math.max(1, Math.mi… | Sí | orden sin desempate |
| 26 | `mobile/src/services/inventoryCatalog.service.js:514` | listado | bill_of_materials | tenant_id eq tenantId; or `bom_name.ilike.%${search.tri… (cond.) | created_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 27 | `mobile/src/services/inventoryCatalog.service.js:561` | detalle | bill_of_materials | tenant_id eq tenantId; bom_id eq bomId | — | — | Sí | puntual |
| 28 | `mobile/src/services/inventoryCatalog.service.js:717` | listado | bill_of_materials | tenant_id eq tenantId; is_active eq true | bom_name | — | Sí | sin límite; orden sin desempate |
| 29 | `web/src/services/manufacturing.service.js:62` | listado | bill_of_materials | tenant_id eq tenantId; or `bom_name.ilike.%${search}%,n… (cond.) | created_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 30 | `web/src/services/manufacturing.service.js:97` | detalle | bill_of_materials | tenant_id eq tenantId; bom_id eq bomId | — | — | Sí | puntual |
| 31 | `web/src/services/manufacturing.service.js:157` | detalle | bill_of_materials | — | — | — | No | puntual |
| 32 | `web/src/services/tenantBilling.service.js:161` | listado | billing_plans | — | sort_order, name | — | N/A | sin límite; orden sin desempate |
| 33 | `web/src/services/tenantBilling.service.js:213` | detalle | billing_plans | — | — | — | N/A | puntual |
| 34 | `mobile/src/services/inventoryCatalog.service.js:599` | consulta | bom_components | tenant_id eq tenantId; bom_id eq bomId | — | — | Sí | multirregistro; sin límite; sin orden |
| 35 | `web/src/services/manufacturing.service.js:349` | consulta | bom_components | tenant_id eq tenantId; bom_id eq bomId | — | — | Sí | multirregistro; sin límite; sin orden |
| 36 | `web/src/services/manufacturing.service.js:395` | consulta | bom_components | tenant_id eq tenantId; bom_id eq bomId | — | — | Sí | multirregistro; sin límite; sin orden |
| 37 | `web/src/services/unitsOfMeasure.service.js:250` | conteo | bom_components | unit_id eq unitId | — | — | No | conteo head |
| 38 | `mobile/src/services/bulkImports.service.js:30` | listado | bulk_import_errors | import_id eq importId | row_number | — | N/A | sin límite; orden sin desempate |
| 39 | `web/src/services/bulkImportClient.service.js:145` | listado | bulk_import_errors | import_id eq importId | row_number | — | N/A | sin límite; orden sin desempate |
| 40 | `mobile/src/services/bulkImports.service.js:9` | listado | bulk_imports | tenant_id eq tenantId; import_type eq importType (cond.) | created_at desc | limit | Sí | orden sin desempate |
| 41 | `web/src/services/bulkImportClient.service.js:86` | detalle | bulk_imports | — | — | — | No | puntual |
| 42 | `web/src/services/bulkImportClient.service.js:130` | listado | bulk_imports | tenant_id eq tenantId; import_type eq importType (cond.) | created_at desc | MAX_HISTORY | Sí | orden sin desempate |
| 43 | `web/src/services/manufacturing.service.js:661` | listado | bundle_compositions | tenant_id eq tenantId; bundle_variant_id eq variantId | component_order | — | Sí | sin límite; orden sin desempate |
| 44 | `web/src/services/manufacturing.service.js:688` | consulta | bundle_compositions | — | — | — | No | multirregistro; sin límite; sin orden; sin tenant explícito |
| 45 | `mobile/src/services/cashMenu.service.js:305` | consulta | cash_movements | tenant_id eq tenantId; cash_session_id eq sessionId | — | — | Sí | multirregistro; sin límite; sin orden |
| 46 | `mobile/src/services/cashMenu.service.js:384` | listado | cash_movements | tenant_id eq tenantId; cash_session_id eq sessionId | created_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 47 | `mobile/src/services/cashMenu.service.js:420` | detalle | cash_movements | — | — | — | No | puntual |
| 48 | `mobile/src/services/reports.service.js:489` | consulta | cash_movements | tenant_id eq tenantId; created_at gte range.fromIso; created_at lte range.toIso | — | — | Sí | multirregistro; sin límite; sin orden |
| 49 | `web/src/services/cash.service.js:175` | consulta | cash_movements | tenant_id eq tenantId; cash_session_id eq sessionId | — | — | Sí | multirregistro; sin límite; sin orden |
| 50 | `web/src/services/cash.service.js:272` | listado | cash_movements | tenant_id eq tenantId; cash_session_id eq sessionId | created_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 51 | `web/src/services/reports.service.js:237` | listado | cash_movements | tenant_id eq tenantId; created_at gte fromDate; created_at lte toDate; type eq type (cond.); location_id eq locationId (cond.) | created_at desc | — | Sí | sin límite; orden sin desempate |
| 52 | `web/src/services/reports.service.js:920` | consulta | cash_movements | tenant_id eq tenantId; type eq 'EXPENSE'; created_at gte fromDate; created_at lte toDate | — | — | Sí | multirregistro; sin límite; sin orden |
| 53 | `web/src/services/reports.service.js:929` | consulta | cash_movements | tenant_id eq tenantId; type eq 'INCOME'; created_at gte fromDate; created_at lte toDate | — | — | Sí | multirregistro; sin límite; sin orden |
| 54 | `web/src/services/reports.service.js:1016` | consulta | cash_movements | tenant_id eq tenantId; created_at gte fromDate; created_at lte toDate | — | — | Sí | multirregistro; sin límite; sin orden |
| 55 | `web/src/views/CashSessions.vue:472` | consulta | cash_movements | tenant_id eq tenantId.value; cash_session_id eq item.cash_session_id | — | — | Sí | multirregistro; sin límite; sin orden |
| 56 | `mobile/src/services/cashMenu.service.js:451` | listado | cash_register_assignments | tenant_id eq tenantId; user_id eq userId (cond.); is_active eq isActive (cond.); or `name.ilike.%${search.trim()}… (cond.) | assigned_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 57 | `web/src/services/cashAssignment.service.js:109` | listado | cash_register_assignments | tenant_id eq tenantId; user_id eq filters.userId (cond.); cash_register_id eq filters.cashRegisterId (cond.); cash_register.location_id eq filters.locationId (cond.… | — | — | Sí | sin orden; count exacto |
| 58 | `mobile/src/services/cashMenu.service.js:52` | listado | cash_registers | tenant_id eq tenantId; name ilike `%${search.trim()}%` (cond.) | name | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 59 | `mobile/src/services/cashMenu.service.js:76` | listado | cash_registers | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 60 | `mobile/src/services/cashMenu.service.js:98` | detalle | cash_registers | — | — | — | No | puntual |
| 61 | `mobile/src/services/cashMenu.service.js:113` | detalle | cash_registers | cash_register_id eq registerId; tenant_id eq tenantId | — | — | Sí | puntual |
| 62 | `web/src/services/cash.service.js:20` | listado | cash_registers | tenant_id eq tenantId; name ilike `%${search}%` (cond.); location_id eq locationId (cond.) | name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 63 | `web/src/services/cash.service.js:39` | listado | cash_registers | tenant_id eq tenantId; is_active eq true; location_id eq locationId (cond.); status eq status (cond.) | name | — | Sí | sin límite; orden sin desempate |
| 64 | `mobile/src/services/cashMenu.service.js:152` | listado | cash_sessions | tenant_id eq tenantId; status eq status (cond.) | opened_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 65 | `mobile/src/services/cashMenu.service.js:209` | detalle | cash_sessions | — | — | — | No | puntual |
| 66 | `mobile/src/services/cashMenu.service.js:245` | detalle | cash_sessions | cash_session_id eq sessionId; tenant_id eq tenantId | — | — | Sí | puntual |
| 67 | `mobile/src/services/cashMenu.service.js:270` | detalle | cash_sessions | tenant_id eq tenantId; cash_session_id eq sessionId | — | — | Sí | puntual |
| 68 | `mobile/src/services/pos.service.js:173` | detalle | cash_sessions | tenant_id eq tenantId; opened_by eq userId; status eq 'OPEN' | opened_at desc | 1 | Sí | puntual |
| 69 | `mobile/src/services/reports.service.js:369` | consulta | cash_sessions | tenant_id eq tenantId; opened_at gte range.fromIso; opened_at lte range.toIso | — | — | Sí | multirregistro; sin límite; sin orden |
| 70 | `web/src/services/accounting.service.js:1627` | consulta | cash_sessions | tenant_id eq tenantId; status eq 'CLOSED'; opened_at gte fromDateTime; opened_at lte toDateTime | — | — | Sí | multirregistro; sin límite; sin orden |
| 71 | `web/src/services/cash.service.js:117` | listado | cash_sessions | tenant_id eq tenantId; status eq status (cond.) | opened_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 72 | `web/src/services/cash.service.js:141` | detalle | cash_sessions | tenant_id eq tenantId; cash_register_id eq cashRegisterId; status eq 'OPEN' | — | — | Sí | puntual |
| 73 | `web/src/services/cash.service.js:183` | detalle | cash_sessions | cash_session_id eq sessionId | — | — | Indirecto (FK) | puntual |
| 74 | `web/src/services/cash.service.js:252` | listado | cash_sessions | tenant_id eq tenantId; status eq 'OPEN'; opened_at lt cutoff | opened_at | — | Sí | sin límite; orden sin desempate |
| 75 | `web/src/services/reports.service.js:802` | listado | cash_sessions | tenant_id eq tenantId; opened_at gte fromDate; opened_at lte toDate | opened_at desc | — | Sí | sin límite; orden sin desempate |
| 76 | `mobile/src/services/categories.service.js:8` | listado | categories | tenant_id eq tenantId; name ilike `%${search.trim()}%` (cond.) | name | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 77 | `mobile/src/services/categories.service.js:29` | listado | categories | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 78 | `mobile/src/services/categories.service.js:44` | detalle | categories | — | — | — | No | puntual |
| 79 | `mobile/src/services/categories.service.js:58` | detalle | categories | category_id eq categoryId; tenant_id eq tenantId | — | — | Sí | puntual |
| 80 | `mobile/src/services/pricingRules.service.js:167` | listado | categories | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 81 | `mobile/src/services/productPhotoImport.service.js:42` | detalle | categories | tenant_id eq tenantId; name ilike name | — | 1 | Sí | puntual |
| 82 | `mobile/src/services/productPhotoImport.service.js:52` | detalle | categories | — | — | — | No | puntual |
| 83 | `mobile/src/services/productsCatalog.service.js:357` | listado | categories | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 84 | `mobile/src/services/taxRules.service.js:153` | listado | categories | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 85 | `web/src/services/categories.service.js:21` | listado | categories | tenant_id eq tenantId; name ilike `%${normalizedSearch}%` (cond.) | name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 86 | `web/src/services/categories.service.js:56` | listado | categories | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 87 | `web/src/services/categories.service.js:88` | detalle | categories | tenant_id eq tenantId; name ilike normalized | — | 1 | Sí | puntual |
| 88 | `web/src/services/productPhotoImport.service.js:46` | detalle | categories | tenant_id eq tenantId; name ilike name | — | 1 | Sí | puntual |
| 89 | `web/src/services/productPhotoImport.service.js:56` | detalle | categories | — | — | — | No | puntual |
| 90 | `web/src/services/adapters/supabaseLookups.repository.js:23` | consulta | cities | department_id eq departmentId (cond.) | — | — | N/A | multirregistro; sin límite; sin orden |
| 91 | `mobile/src/services/credit.service.js:10` | consulta | customer_credit_accounts | tenant_id eq tenantId; is_active eq true | — | — | Sí | multirregistro; sin límite; sin orden |
| 92 | `mobile/src/services/credit.service.js:41` | listado | customer_credit_accounts | tenant_id eq tenantId | current_balance desc | — | Sí | sin límite; orden sin desempate |
| 93 | `web/src/services/credit.service.js:8` | detalle | customer_credit_accounts | tenant_id eq tenantId; customer_id eq customerId | — | — | Sí | puntual |
| 94 | `web/src/services/credit.service.js:30` | detalle | customer_credit_accounts | — | — | — | No | puntual |
| 95 | `web/src/services/credit.service.js:104` | listado | customer_credit_accounts | tenant_id eq tenantId; is_active eq true; current_balance gt 0 | current_balance desc | — | Sí | sin límite; orden sin desempate |
| 96 | `web/src/services/credit.service.js:124` | listado | customer_credit_accounts | tenant_id eq tenantId | current_balance desc | — | Sí | sin límite; orden sin desempate |
| 97 | `web/src/services/credit.service.js:159` | consulta | customer_credit_accounts | tenant_id eq tenantId; is_active eq true | — | — | Sí | multirregistro; sin límite; sin orden |
| 98 | `mobile/src/services/aiInsights.service.js:872` | listado | customer_credit_movements | credit_account_id in accountIds | created_at desc | 8000 | Indirecto (FK) | orden sin desempate; límite alto; tenant indirecto |
| 99 | `mobile/src/services/credit.service.js:68` | listado | customer_credit_movements | tenant_id eq tenantId; credit_account_id eq creditAccountId | created_at desc | 200 | Sí | orden sin desempate |
| 100 | `web/src/services/credit.service.js:142` | listado | customer_credit_movements | tenant_id eq tenantId; credit_account_id eq creditAccountId | created_at desc | 200 | Sí | orden sin desempate |
| 101 | `mobile/src/services/pos.service.js:504` | listado | customers | tenant_id eq tenantId; OR `full_name.ilike.%${q}%,document.ilike.%$… | full_name | limit | Sí | orden sin desempate |
| 102 | `mobile/src/services/pos.service.js:530` | listado | customers | tenant_id eq tenantId | full_name | limit | Sí | orden sin desempate |
| 103 | `mobile/src/services/setup.service.js:293` | conteo | customers | tenant_id eq tenantId | — | — | Sí | conteo head |
| 104 | `web/src/views/About.vue:315` | conteo | customers | tenant_id eq tenantId.value | — | — | Sí | conteo head |
| 105 | `web/src/services/adapters/supabaseLookups.repository.js:15` | listado | departments | — | name | — | N/A | sin límite; orden sin desempate |
| 106 | `web/src/services/adapters/supabaseLookups.repository.js:6` | listado | document_types | — | label | — | N/A | sin límite; orden sin desempate |
| 107 | `mobile/src/services/electronicInvoicing.service.js:48` | detalle | fe_provider_config | tenant_id eq tenantId | — | — | Sí | puntual |
| 108 | `mobile/src/services/electronicInvoicing.service.js:70` | detalle | fe_provider_config | — | — | — | No | puntual |
| 109 | `web/src/services/accounting.service.js:190` | detalle | fe_provider_config | tenant_id eq tenantId | — | — | Sí | puntual |
| 110 | `web/src/services/electronicInvoicing.service.js:25` | detalle | fe_provider_config | tenant_id eq tenantId | — | — | Sí | puntual |
| 111 | `web/src/services/electronicInvoicing.service.js:57` | detalle | fe_provider_config | — | — | — | No | puntual |
| 112 | `mobile/src/services/batches.service.js:164` | listado | inventory_batches | tenant_id eq tenantId; location_id eq locationId (cond.); NOT(expiration_date is null) (cond.); expiration_date is null (cond.); batch_number ilike `%${trimmedSearc… | expiration_date, received_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 113 | `mobile/src/services/batches.service.js:274` | detalle | inventory_batches | — | — | — | No | puntual |
| 114 | `mobile/src/services/batches.service.js:295` | detalle | inventory_batches | batch_id eq batchId | — | — | Indirecto (FK) | puntual |
| 115 | `mobile/src/services/inventoryCatalog.service.js:262` | listado | inventory_batches | tenant_id eq tenantId; location_id eq locationId (cond.) | expiration_date, received_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 116 | `mobile/src/services/reports.service.js:432` | listado | inventory_batches | tenant_id eq tenantId; on_hand gt 0; NOT(expiration_date is null); expiration_date lte (() => { const cutoff = new Date(); cutof… | expiration_date | — | Sí | sin límite; orden sin desempate |
| 117 | `web/src/services/batches.service.js:26` | listado | inventory_batches | tenant_id eq tenantId; location_id eq filters.location_id (cond.); variant_id eq filters.variant_id (cond.); batch_number ilike `%${filters.batch_number}%` (cond.);… | expiration_date, received_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 118 | `web/src/services/batches.service.js:78` | detalle | inventory_batches | — | — | — | No | puntual |
| 119 | `web/src/services/batches.service.js:113` | detalle | inventory_batches | batch_id eq batchId | — | — | Indirecto (FK) | puntual |
| 120 | `web/src/services/batches.service.js:140` | detalle | inventory_batches | batch_id eq batchId | — | — | Indirecto (FK) | puntual |
| 121 | `web/src/services/reports.service.js:630` | listado | inventory_batches | tenant_id eq tenantId; on_hand gt 0; expiration_date lte cutoffStr; location_id eq locationId (cond.) | expiration_date | — | Sí | sin límite; orden sin desempate |
| 122 | `mobile/src/services/inventoryCatalog.service.js:358` | listado | inventory_moves | tenant_id eq tenantId; move_type eq 'PURCHASE_IN'; source_id in purchaseIds | created_at | — | Sí | sin límite; orden sin desempate |
| 123 | `mobile/src/services/purchases.service.js:572` | listado | inventory_moves | tenant_id eq tenantId; move_type eq 'PURCHASE_IN'; source_id eq purchaseId | created_at | — | Sí | sin límite; orden sin desempate |
| 124 | `mobile/src/services/reports.service.js:423` | consulta | inventory_moves | tenant_id eq tenantId; created_at gte noMovementCutoff.toISOString() | — | — | Sí | multirregistro; sin límite; sin orden |
| 125 | `web/src/services/purchases.service.js:241` | listado | inventory_moves | tenant_id eq tenantId; move_type eq 'PURCHASE_IN'; source_id in purchaseIds | created_at | — | Sí | sin límite; orden sin desempate |
| 126 | `web/src/services/purchases.service.js:309` | listado | inventory_moves | tenant_id eq tenantId; move_type eq 'PURCHASE_IN'; source_id eq purchaseId | created_at | — | Sí | sin límite; orden sin desempate |
| 127 | `web/src/services/reports.service.js:590` | consulta | inventory_moves | tenant_id eq tenantId; created_at gte cutoff | — | — | Sí | multirregistro; sin límite; sin orden |
| 128 | `mobile/src/services/electronicInvoicing.service.js:86` | detalle | invoice_resolutions | tenant_id eq tenantId; document_type eq documentType; is_active eq true | resolution_date desc | 1 | Sí | puntual |
| 129 | `mobile/src/services/electronicInvoicing.service.js:114` | detalle | invoice_resolutions | tenant_id eq tenantId; resolution_id eq record.resolution_id | — | — | Sí | puntual |
| 130 | `mobile/src/services/electronicInvoicing.service.js:135` | detalle | invoice_resolutions | — | — | — | No | puntual |
| 131 | `web/src/services/accounting.service.js:195` | detalle | invoice_resolutions | tenant_id eq tenantId; document_type eq 'FE'; is_active eq true | resolution_date desc | 1 | Sí | puntual |
| 132 | `web/src/services/electronicInvoicing.service.js:77` | listado | invoice_resolutions | tenant_id eq tenantId | is_active desc, resolution_date desc | — | Sí | sin límite; orden sin desempate |
| 133 | `web/src/services/electronicInvoicing.service.js:94` | detalle | invoice_resolutions | tenant_id eq tenantId; document_type eq documentType; is_active eq true | resolution_date desc | 1 | Sí | puntual |
| 134 | `web/src/services/electronicInvoicing.service.js:132` | detalle | invoice_resolutions | resolution_id eq payload.resolution_id; tenant_id eq tenantId | — | — | Sí | puntual |
| 135 | `web/src/services/electronicInvoicing.service.js:143` | detalle | invoice_resolutions | — | — | — | No | puntual |
| 136 | `mobile/src/services/layaway.service.js:52` | detalle | layaway_contracts | tenant_id eq tenantId; layaway_id eq layawayId | — | — | Sí | puntual |
| 137 | `web/src/services/layaway.service.js:57` | detalle | layaway_contracts | tenant_id eq tenantId; layaway_id eq layawayId | — | — | Sí | puntual |
| 138 | `web/src/services/layaway.service.js:253` | listado | layaway_contracts | tenant_id eq tenantId; status eq 'ACTIVE'; NOT(due_date is null) | due_date | — | Sí | sin límite; orden sin desempate |
| 139 | `mobile/src/services/layaway.service.js:97` | listado | layaway_installments | tenant_id eq tenantId; layaway_id eq layawayId | due_date | — | Sí | sin límite; orden sin desempate |
| 140 | `web/src/services/layaway.service.js:101` | listado | layaway_installments | tenant_id eq tenantId; layaway_id eq layawayId | due_date | — | Sí | sin límite; orden sin desempate |
| 141 | `mobile/src/services/layaway.service.js:69` | consulta | layaway_items | tenant_id eq tenantId; layaway_id eq layawayId | — | — | Sí | multirregistro; sin límite; sin orden |
| 142 | `web/src/services/layaway.service.js:73` | consulta | layaway_items | tenant_id eq tenantId; layaway_id eq layawayId | — | — | Sí | multirregistro; sin límite; sin orden |
| 143 | `mobile/src/services/cashMenu.service.js:300` | consulta | layaway_payments | tenant_id eq tenantId; cash_session_id eq sessionId | — | — | Sí | multirregistro; sin límite; sin orden |
| 144 | `web/src/views/CashSessions.vue:462` | consulta | layaway_payments | tenant_id eq tenantId.value; cash_session_id eq item.cash_session_id | — | — | Sí | multirregistro; sin límite; sin orden |
| 145 | `mobile/src/services/cashMenu.service.js:20` | listado | locations | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 146 | `mobile/src/services/inventoryCatalog.service.js:21` | listado | locations | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 147 | `mobile/src/services/pricingRules.service.js:151` | listado | locations | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 148 | `mobile/src/services/productPhotoImport.service.js:87` | detalle | locations | tenant_id eq tenantId; is_active eq true; name ilike value | — | 1 | Sí | puntual |
| 149 | `mobile/src/services/reports.service.js:301` | listado | locations | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 150 | `mobile/src/services/setup.service.js:294` | conteo | locations | tenant_id eq tenantId | — | — | Sí | conteo head |
| 151 | `mobile/src/services/setup.service.js:319` | listado | locations | tenant_id eq tenantId; or `name.ilike.%${text}%,address… (cond.); or `name.ilike.%${text}%,code.il… (cond.) | name | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 152 | `mobile/src/services/setup.service.js:341` | detalle | locations | — | — | — | No | puntual |
| 153 | `mobile/src/services/setup.service.js:362` | detalle | locations | tenant_id eq tenantId; location_id eq locationId | — | — | Sí | puntual |
| 154 | `web/src/services/inventory.service.js:383` | detalle | locations | tenant_id eq tenant_id; name ilike locationValue; is_active eq true | — | 1 | Sí | puntual |
| 155 | `web/src/services/locations.service.js:24` | listado | locations | tenant_id eq tenantId; or `name.ilike.%${normalizedSear… (cond.) | name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 156 | `web/src/services/locations.service.js:152` | listado | locations | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 157 | `web/src/services/pricingRules.service.js:188` | listado | locations | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 158 | `web/src/services/productPhotoImport.service.js:91` | detalle | locations | tenant_id eq tenantId; is_active eq true; name ilike value | — | 1 | Sí | puntual |
| 159 | `web/src/views/About.vue:322` | conteo | locations | tenant_id eq tenantId.value | — | — | Sí | conteo head |
| 160 | `web/src/views/Purchases.vue:2748` | listado | locations | tenant_id eq tenantId.value; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 161 | `mobile/src/services/rolesMenus.service.js:102` | listado | menu_items | is_active eq true (cond.) | sort_order, code | — | N/A | sin límite; orden sin desempate |
| 162 | `web/src/services/superAdminRoles.service.js:26` | listado | menu_items | is_active eq true | sort_order, code | — | N/A | sin límite; orden sin desempate |
| 163 | `web/src/services/superAdminRoles.service.js:46` | listado | menu_items | is_active eq true | sort_order | — | N/A | sin límite; orden sin desempate |
| 164 | `web/src/services/superAdminRoles.service.js:86` | detalle | menu_items | — | — | — | N/A | puntual |
| 165 | `web/src/services/superAdminRoles.service.js:114` | detalle | menu_items | menu_item_id eq menuItemId | — | — | N/A | puntual |
| 166 | `web/src/services/superAdminRoles.service.js:163` | consulta | menu_permissions | menu_item_id eq menuItemId | — | — | N/A | multirregistro; sin límite; sin orden |
| 167 | `mobile/src/services/notifications.service.js:22` | conteo | notifications | is_read eq false | — | — | No | conteo head |
| 168 | `mobile/src/services/onlineOrders.service.js:54` | listado | online_order_lines | online_order_id in orderIds | created_at | — | Indirecto (FK) | sin límite; orden sin desempate; tenant indirecto |
| 169 | `web/src/services/onlineStore.service.js:730` | listado | online_order_lines | online_order_id in orderIds | created_at | — | Indirecto (FK) | sin límite; orden sin desempate; tenant indirecto |
| 170 | `mobile/src/services/onlineOrders.service.js:61` | listado | online_order_reservations | online_order_id in orderIds | created_at | — | Indirecto (FK) | sin límite; orden sin desempate; tenant indirecto |
| 171 | `web/src/services/onlineStore.service.js:746` | listado | online_order_reservations | online_order_id in orderIds | created_at | — | Indirecto (FK) | sin límite; orden sin desempate; tenant indirecto |
| 172 | `mobile/src/services/onlineOrders.service.js:40` | listado | online_orders | tenant_id eq tenantId; payment_mode eq 'MANUAL' | created_at desc | limit | Sí | orden sin desempate |
| 173 | `web/src/services/onlineStore.service.js:684` | listado | online_orders | tenant_id eq tenantId; store_id eq storeId (cond.); payment_mode eq String(options.paymentMode).t… (cond.) | created_at desc | options.limit \|\| 50 | Sí | orden sin desempate |
| 174 | `web/src/services/onlineStore.service.js:367` | listado | online_store_catalog | tenant_id eq tenantId; store_id eq storeId | sort_order | — | Sí | sin límite; orden sin desempate |
| 175 | `web/src/services/onlineStore.service.js:264` | detalle | online_stores | tenant_id eq tenantId | — | — | Sí | puntual |
| 176 | `web/src/services/onlineStore.service.js:346` | detalle | online_stores | — | — | — | No | puntual |
| 177 | `mobile/src/services/cashMenu.service.js:528` | listado | payment_methods | tenant_id eq tenantId; or `name.ilike.%${search.trim()}… (cond.) | sort_order, name | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 178 | `mobile/src/services/cashMenu.service.js:550` | detalle | payment_methods | — | — | — | No | puntual |
| 179 | `mobile/src/services/cashMenu.service.js:573` | detalle | payment_methods | payment_method_id eq paymentMethodId; tenant_id eq tenantId | — | — | Sí | puntual |
| 180 | `mobile/src/services/pos.service.js:138` | listado | payment_methods | tenant_id eq tenantId; is_active eq true; NOT(code in '(LAYAWAY)') | sort_order, name | — | Sí | sin límite; orden sin desempate |
| 181 | `web/src/services/paymentMethods.service.js:30` | listado | payment_methods | tenant_id eq tenantId; or `name.ilike.%${normalizedSear… (cond.); is_active eq true (cond.); NOT(code in `(${options.exclude…) (cond.) | sort_order, name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 182 | `web/src/services/paymentMethods.service.js:164` | consulta | payment_methods | tenant_id eq tenantId; code eq code.toUpperCase(); payment_method_id neq excludeId (cond.) | — | — | Sí | multirregistro; sin límite; sin orden |
| 183 | `mobile/src/services/rolesMenus.service.js:88` | listado | permissions | — | code | — | N/A | sin límite; orden sin desempate |
| 184 | `web/src/services/roles.service.js:83` | listado | permissions | — | code | — | N/A | sin límite; orden sin desempate |
| 185 | `web/src/services/superAdminRoles.service.js:307` | listado | permissions | — | code | — | N/A | sin límite; orden sin desempate |
| 186 | `mobile/src/services/pos.service.js:750` | listado | pricing_rules | tenant_id eq tenantId; is_active eq true | priority desc | — | Sí | sin límite; orden sin desempate |
| 187 | `mobile/src/services/pricingRules.service.js:52` | listado | pricing_rules | tenant_id eq tenantId; scope eq String(scope).toUpperCase() (cond.); location_id eq locationId (cond.); is_active eq normalizedStatus (cond.) | priority desc, created_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 188 | `mobile/src/services/pricingRules.service.js:82` | detalle | pricing_rules | — | — | — | No | puntual |
| 189 | `mobile/src/services/pricingRules.service.js:110` | detalle | pricing_rules | tenant_id eq tenantId; pricing_rule_id eq pricingRuleId | — | — | Sí | puntual |
| 190 | `web/src/services/pricingRules.service.js:14` | listado | pricing_rules | tenant_id eq tenantId; scope eq filters.scope (cond.); is_active eq filters.is_active (cond.); location_id eq filters.location_id (cond.); category_id eq filters.ca… | priority desc, created_at desc | — | Sí | orden sin desempate; count exacto |
| 191 | `web/src/services/pricingRules.service.js:55` | detalle | pricing_rules | tenant_id eq tenantId; pricing_rule_id eq pricingRuleId | — | — | Sí | puntual |
| 192 | `mobile/src/services/pos.service.js:626` | detalle | product_barcodes | tenant_id eq tenantId; barcode eq query | — | — | Sí | puntual |
| 193 | `web/src/services/products.service.js:384` | detalle | product_barcodes | tenant_id eq tenantId; barcode eq barcode | — | 1 | Sí | puntual |
| 194 | `mobile/src/services/productMedia.service.js:223` | listado | product_media | tenant_id eq tenantId; product_id eq productId | is_cover desc, sort_order, created_at | — | Sí | sin límite; orden sin desempate |
| 195 | `mobile/src/services/productMedia.service.js:321` | detalle | product_media | — | — | — | No | puntual |
| 196 | `mobile/src/services/productMedia.service.js:368` | detalle | product_media | tenant_id eq tenantId; media_id eq inserted.media_id | — | — | Sí | puntual |
| 197 | `mobile/src/services/productMedia.service.js:415` | detalle | product_media | tenant_id eq tenantId; media_id eq inserted.media_id | — | — | Sí | puntual |
| 198 | `mobile/src/services/productMedia.service.js:451` | detalle | product_media | tenant_id eq tenantId; media_id eq inserted.media_id | — | — | Sí | puntual |
| 199 | `mobile/src/services/productMedia.service.js:518` | detalle | product_media | tenant_id eq tenantId; product_id eq productId; media_id eq mediaId | — | — | Sí | puntual |
| 200 | `mobile/src/services/productMedia.service.js:562` | detalle | product_media | tenant_id eq tenantId; media_id eq mediaId | — | — | Sí | puntual |
| 201 | `mobile/src/services/productsCatalog.service.js:34` | listado | product_media | tenant_id eq tenantId; product_id in productIds | is_cover desc, sort_order, created_at | — | Sí | sin límite; orden sin desempate |
| 202 | `mobile/src/services/productsCatalog.service.js:158` | listado | product_media | tenant_id eq tenantId; product_id in pendingProductIds | is_cover desc, sort_order, created_at | — | Sí | sin límite; orden sin desempate |
| 203 | `web/src/services/productMedia.service.js:159` | listado | product_media | tenant_id eq tenantId; product_id in productIds | is_cover desc, sort_order, created_at | — | Sí | sin límite; orden sin desempate |
| 204 | `web/src/services/productMedia.service.js:222` | listado | product_media | tenant_id eq tenantId; product_id eq productId | is_cover desc, sort_order, created_at | — | Sí | sin límite; orden sin desempate |
| 205 | `web/src/services/productMedia.service.js:299` | detalle | product_media | — | — | — | No | puntual |
| 206 | `web/src/services/productMedia.service.js:358` | detalle | product_media | tenant_id eq tenantId; media_id eq inserted.media_id | — | — | Sí | puntual |
| 207 | `web/src/services/productMedia.service.js:401` | detalle | product_media | tenant_id eq tenantId; media_id eq inserted.media_id | — | — | Sí | puntual |
| 208 | `web/src/services/productMedia.service.js:437` | detalle | product_media | tenant_id eq tenantId; media_id eq inserted.media_id | — | — | Sí | puntual |
| 209 | `web/src/services/productMedia.service.js:496` | detalle | product_media | tenant_id eq tenantId; product_id eq productId; media_id eq mediaId | — | — | Sí | puntual |
| 210 | `web/src/services/productMedia.service.js:540` | detalle | product_media | tenant_id eq tenantId; media_id eq mediaId | — | — | Sí | puntual |
| 211 | `mobile/src/services/pos.service.js:214` | consulta | product_variants | tenant_id eq tenantId; is_active eq true; OR 'is_component.is.null,is_component.eq.fal…; OR `sku.ilike.%${search}%,variant_name.ilike… | — | limit | Sí | multirregistro; sin orden |
| 212 | `mobile/src/services/pos.service.js:230` | consulta | product_variants | tenant_id eq tenantId; is_active eq true; OR 'is_component.is.null,is_component.eq.fal…; product.name ilike `%${search}%` | — | limit | Sí | multirregistro; sin orden |
| 213 | `mobile/src/services/pos.service.js:306` | listado | product_variants | tenant_id eq tenantId; is_active eq true; OR 'is_component.is.null,is_component.eq.fal… | variant_name | limit | Sí | orden sin desempate |
| 214 | `mobile/src/services/pos.service.js:635` | detalle | product_variants | tenant_id eq tenantId; variant_id eq barcodeHit.variant_id; is_active eq true | — | — | Sí | puntual |
| 215 | `mobile/src/services/pricingRules.service.js:204` | listado | product_variants | tenant_id eq tenantId; is_active eq true; or `sku.ilike.%${search.trim()}%… (cond.) | sku | limit | Sí | orden sin desempate |
| 216 | `mobile/src/services/productPhotoImport.service.js:182` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId; variant_name ilike variantName | — | 1 | Sí | puntual |
| 217 | `mobile/src/services/productPhotoImport.service.js:192` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId | — | 1 | Sí | puntual |
| 218 | `mobile/src/services/productPhotoImport.service.js:223` | detalle | product_variants | — | — | — | No | puntual |
| 219 | `mobile/src/services/productsCatalog.service.js:278` | detalle | product_variants | — | — | — | No | puntual |
| 220 | `mobile/src/services/productsCatalog.service.js:293` | detalle | product_variants | variant_id eq variantId; tenant_id eq tenantId | — | — | Sí | puntual |
| 221 | `mobile/src/services/purchases.service.js:108` | listado | product_variants | tenant_id eq tenantId; is_active eq true | sku | limit | Sí | orden sin desempate |
| 222 | `mobile/src/services/purchases.service.js:124` | listado | product_variants | tenant_id eq tenantId; is_active eq true; OR `sku.ilike.%${normalizedSearch}%,variant_… | sku | limit | Sí | orden sin desempate |
| 223 | `mobile/src/services/purchases.service.js:135` | listado | product_variants | tenant_id eq tenantId; is_active eq true; product.name ilike `%${normalizedSearch}%` | sku | limit | Sí | orden sin desempate |
| 224 | `mobile/src/services/purchases.service.js:264` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId; variant_name ilike safeVariantName | — | 1 | Sí | puntual |
| 225 | `mobile/src/services/purchases.service.js:290` | detalle | product_variants | — | — | — | No | puntual |
| 226 | `mobile/src/services/sales.service.js:64` | consulta | product_variants | tenant_id eq tenantId; variant_id in variantIds | — | — | Sí | multirregistro; sin límite; sin orden |
| 227 | `mobile/src/services/sales.service.js:351` | consulta | product_variants | tenant_id eq tenantId; variant_id in variantIds | — | — | Sí | multirregistro; sin límite; sin orden |
| 228 | `mobile/src/services/taxRules.service.js:190` | listado | product_variants | tenant_id eq tenantId; is_active eq true; or `sku.ilike.%${search.trim()}%… (cond.) | sku | limit | Sí | orden sin desempate |
| 229 | `mobile/src/services/units.service.js:107` | conteo | product_variants | unit_id eq unitId | — | — | No | conteo head |
| 230 | `web/src/services/manufacturing.service.js:303` | detalle | product_variants | tenant_id eq tenantId; active_bom_id eq bomId | — | 1 | Sí | puntual |
| 231 | `web/src/services/productPhotoImport.service.js:186` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId; variant_name ilike variantName | — | 1 | Sí | puntual |
| 232 | `web/src/services/productPhotoImport.service.js:196` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId | — | 1 | Sí | puntual |
| 233 | `web/src/services/productPhotoImport.service.js:227` | detalle | product_variants | — | — | — | No | puntual |
| 234 | `web/src/services/products.service.js:408` | detalle | product_variants | tenant_id eq tenantId; sku eq barcode | — | 1 | Sí | puntual |
| 235 | `web/src/services/products.service.js:448` | consulta | product_variants | tenant_id eq tenantId; is_active eq true; OR 'is_component.is.null,is_component.eq.fal…; OR `sku.ilike.%${normalizedSearch}%,variant_… | — | limit | Sí | multirregistro; sin orden |
| 236 | `web/src/services/products.service.js:463` | consulta | product_variants | tenant_id eq tenantId; is_active eq true; OR 'is_component.is.null,is_component.eq.fal…; product.name ilike `%${normalizedSearch}%` | — | limit | Sí | multirregistro; sin orden |
| 237 | `web/src/services/products.service.js:529` | listado | product_variants | tenant_id eq tenantId; is_active eq true | sku | limit | Sí | orden sin desempate |
| 238 | `web/src/services/products.service.js:693` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId; variant_name ilike variantName | — | 1 | Sí | puntual |
| 239 | `web/src/services/products.service.js:707` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId | — | 1 | Sí | puntual |
| 240 | `web/src/services/purchases.service.js:517` | detalle | product_variants | tenant_id eq tenantId; product_id eq productId; variant_name ilike safeVariantName | — | 1 | Sí | puntual |
| 241 | `web/src/services/purchases.service.js:543` | detalle | product_variants | — | — | — | No | puntual |
| 242 | `web/src/services/unitsOfMeasure.service.js:243` | conteo | product_variants | unit_id eq unitId | — | — | No | conteo head |
| 243 | `web/src/views/Purchases.vue:2329` | consulta | product_variants | tenant_id eq tenantId.value; variant_id in uniqueVariantIds | — | — | Sí | multirregistro; sin límite; sin orden |
| 244 | `web/src/views/Purchases.vue:3056` | listado | product_variants | tenant_id eq tenantId.value; is_active eq true | sku | 50 | Sí | orden sin desempate |
| 245 | `web/src/views/Purchases.vue:3103` | listado | product_variants | tenant_id eq tenantId.value; is_active eq true | sku | 30 | Sí | orden sin desempate |
| 246 | `web/src/views/Purchases.vue:3469` | listado | product_variants | tenant_id eq tenantId.value; is_active eq true | sku | 500 | Sí | orden sin desempate |
| 247 | `web/src/views/TaxRules.vue:453` | listado | product_variants | tenant_id eq tenantId.value; is_active eq true | — | 50 | Sí | sin orden |
| 248 | `mobile/src/services/inventoryCatalog.service.js:63` | detalle | production_orders | tenant_id eq tenantId; production_order_id eq orderId | — | — | Sí | puntual |
| 249 | `mobile/src/services/inventoryCatalog.service.js:446` | listado | production_orders | tenant_id eq tenantId; status in ['PENDING', 'DRAFT'] (cond.); status eq status (cond.); location_id eq locationId (cond.); or `bom_name.ilike.%${search.tri… (cond.) | created_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 250 | `mobile/src/services/inventoryCatalog.service.js:701` | detalle | production_orders | production_order_id eq orderId; tenant_id eq tenantId | — | — | Sí | puntual |
| 251 | `mobile/src/services/reports.service.js:511` | consulta | production_orders | tenant_id eq tenantId; created_at gte range.fromIso; created_at lte range.toIso | — | — | Sí | multirregistro; sin límite; sin orden |
| 252 | `web/src/services/manufacturing.service.js:27` | detalle | production_orders | tenant_id eq tenantId; production_order_id eq orderId | — | — | Sí | puntual |
| 253 | `web/src/services/manufacturing.service.js:473` | listado | production_orders | tenant_id eq tenantId; status in ['PENDING', 'DRAFT'] (cond.); status eq filters.status (cond.); location_id eq filters.location_id (cond.) | created_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 254 | `web/src/services/manufacturing.service.js:522` | detalle | production_orders | tenant_id eq tenantId; production_order_id eq orderId | — | — | Sí | puntual |
| 255 | `web/src/services/manufacturing.service.js:623` | detalle | production_orders | production_order_id eq orderId; tenant_id eq tenantId | — | — | Sí | puntual |
| 256 | `mobile/src/services/pricingRules.service.js:182` | listado | products | tenant_id eq tenantId; is_active eq true; name ilike `%${search.trim()}%` (cond.); or `sku.ilike.%${search.trim()}%… (cond.) | name | limit | Sí | orden sin desempate |
| 257 | `mobile/src/services/productPhotoImport.service.js:133` | detalle | products | tenant_id eq tenantId; name ilike productName | — | 1 | Sí | puntual |
| 258 | `mobile/src/services/productPhotoImport.service.js:165` | detalle | products | — | — | — | No | puntual |
| 259 | `mobile/src/services/productsCatalog.service.js:220` | listado | products | tenant_id eq tenantId; is_component eq isComponent (cond.); or `name.ilike.%${search.trim()}… (cond.) | name | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 260 | `mobile/src/services/productsCatalog.service.js:246` | detalle | products | — | — | — | No | puntual |
| 261 | `mobile/src/services/productsCatalog.service.js:261` | detalle | products | product_id eq productId; tenant_id eq tenantId | — | — | Sí | puntual |
| 262 | `mobile/src/services/productsCatalog.service.js:325` | detalle | products | product_id eq productId; tenant_id eq tenantId | — | — | Sí | puntual |
| 263 | `mobile/src/services/purchases.service.js:225` | detalle | products | tenant_id eq tenantId; name ilike safeProductName | — | 1 | Sí | puntual |
| 264 | `mobile/src/services/purchases.service.js:238` | detalle | products | — | — | — | No | puntual |
| 265 | `mobile/src/services/setup.service.js:291` | conteo | products | tenant_id eq tenantId | — | — | Sí | conteo head |
| 266 | `mobile/src/services/taxRules.service.js:168` | listado | products | tenant_id eq tenantId; is_active eq true; name ilike `%${search.trim()}%` (cond.); or `sku.ilike.%${search.trim()}%… (cond.) | name | limit | Sí | orden sin desempate |
| 267 | `mobile/src/services/units.service.js:103` | conteo | products | unit_id eq unitId | — | — | No | conteo head |
| 268 | `web/src/services/manufacturing.service.js:292` | detalle | products | tenant_id eq tenantId; active_bom_id eq bomId | — | 1 | Sí | puntual |
| 269 | `web/src/services/productPhotoImport.service.js:137` | detalle | products | tenant_id eq tenantId; name ilike productName | — | 1 | Sí | puntual |
| 270 | `web/src/services/productPhotoImport.service.js:169` | detalle | products | — | — | — | No | puntual |
| 271 | `web/src/services/products.service.js:93` | listado | products | tenant_id eq tenantId; or `name.ilike.%${search}%,descr… (cond.); is_component eq filters.is_component (cond.); is_active eq filters.is_active (cond.); inventory_be… | name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 272 | `web/src/services/products.service.js:137` | listado | products | tenant_id eq tenantId; is_component eq filters.is_component (cond.); is_active eq filters.is_active (cond.); inventory_behavior eq filters.inventory_behavior (cond.) | name | range from, from + pageSize - 1 | Sí | orden sin desempate; offset |
| 273 | `web/src/services/products.service.js:186` | detalle | products | tenant_id eq tenantId; product_id eq productId | — | — | Sí | puntual |
| 274 | `web/src/services/products.service.js:650` | detalle | products | tenant_id eq tenantId; name ilike productName | — | 1 | Sí | puntual |
| 275 | `web/src/services/purchases.service.js:478` | detalle | products | tenant_id eq tenantId; name ilike safeProductName | — | 1 | Sí | puntual |
| 276 | `web/src/services/purchases.service.js:491` | detalle | products | — | — | — | No | puntual |
| 277 | `web/src/services/unitsOfMeasure.service.js:237` | conteo | products | unit_id eq unitId | — | — | No | conteo head |
| 278 | `web/src/views/About.vue:301` | conteo | products | tenant_id eq tenantId.value | — | — | Sí | conteo head |
| 279 | `web/src/views/TaxRules.vue:428` | listado | products | tenant_id eq tenantId.value; is_active eq true | — | 50 | Sí | sin orden |
| 280 | `mobile/src/services/purchases.service.js:447` | listado | purchase_orders | tenant_id eq tenantId; status in ['DRAFT', 'PARTIAL'] | created_at desc | 100 | Sí | orden sin desempate |
| 281 | `web/src/services/purchases.service.js:586` | listado | purchase_orders | tenant_id eq tenantId; status in ['DRAFT', 'PARTIAL'] | created_at desc | 100 | Sí | orden sin desempate |
| 282 | `mobile/src/services/purchases.service.js:599` | consulta | purchase_return_lines | tenant_id eq tenantId; purchase_id eq purchaseId | — | — | Sí | multirregistro; sin límite; sin orden |
| 283 | `web/src/services/purchases.service.js:336` | consulta | purchase_return_lines | tenant_id eq tenantId; purchase_id eq purchaseId | — | — | Sí | multirregistro; sin límite; sin orden |
| 284 | `web/src/services/purchases.service.js:349` | listado | purchase_returns | tenant_id eq tenantId; purchase_id eq purchaseId | created_at desc | — | Sí | sin límite; orden sin desempate |
| 285 | `mobile/src/services/inventoryCatalog.service.js:326` | listado | purchases | tenant_id eq tenantId; location_id eq locationId (cond.) | created_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 286 | `mobile/src/services/purchases.service.js:557` | detalle | purchases | tenant_id eq tenantId; purchase_id eq purchaseId | — | — | Sí | puntual |
| 287 | `web/src/services/accounting.service.js:178` | consulta | purchases | tenant_id eq tenantId; created_at gte fromDateTime; created_at lte toDateTime | — | — | Sí | multirregistro; sin límite; sin orden |
| 288 | `web/src/services/accounting.service.js:1445` | consulta | purchases | tenant_id eq tenantId; created_at gte fromDateTime; created_at lte toDateTime | — | — | Sí | multirregistro; sin límite; sin orden |
| 289 | `web/src/services/purchases.service.js:207` | listado | purchases | tenant_id eq tenantId; location_id eq filters.location_id (cond.); created_at gte filters.from_date (cond.); created_at lte filters.to_date (cond.) | created_at desc | — | Sí | orden sin desempate; count exacto |
| 290 | `web/src/services/purchases.service.js:297` | detalle | purchases | tenant_id eq tenantId; purchase_id eq purchaseId | — | — | Sí | puntual |
| 291 | `web/src/services/superAdminRoles.service.js:216` | consulta | role_menu_templates | role_name eq roleName | — | — | N/A | multirregistro; sin límite; sin orden |
| 292 | `web/src/services/superAdminRoles.service.js:233` | listado | role_menu_templates | — | role_name | — | N/A | sin límite; orden sin desempate |
| 293 | `web/src/services/superAdminRoles.service.js:382` | consulta | role_menu_templates | — | — | — | N/A | multirregistro; sin límite; sin orden |
| 294 | `mobile/src/services/rolesMenus.service.js:180` | consulta | role_menus | role_id eq roleId | — | — | N/A | multirregistro; sin límite; sin orden |
| 295 | `web/src/services/roles.service.js:184` | consulta | role_menus | role_id eq roleId | — | — | N/A | multirregistro; sin límite; sin orden |
| 296 | `web/src/services/superAdminRoles.service.js:337` | consulta | role_menus | role_id eq roleId | — | — | N/A | multirregistro; sin límite; sin orden |
| 297 | `mobile/src/services/rolesMenus.service.js:122` | consulta | role_permissions | role.tenant_id eq tenantId; role_id eq roleId | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 298 | `web/src/services/roles.service.js:99` | consulta | role_permissions | role.tenant_id eq tenantId; role_id eq roleId | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 299 | `mobile/src/services/rolesMenus.service.js:16` | listado | roles | tenant_id eq tenantId; name ilike `%${search.trim()}%` (cond.); is_active eq true (cond.) | name | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 300 | `mobile/src/services/rolesMenus.service.js:38` | detalle | roles | — | — | — | No | puntual |
| 301 | `mobile/src/services/rolesMenus.service.js:56` | detalle | roles | tenant_id eq tenantId; role_id eq roleId | — | — | Sí | puntual |
| 302 | `mobile/src/services/rolesMenus.service.js:141` | detalle | roles | role_id eq roleId | — | — | Indirecto (FK) | puntual |
| 303 | `mobile/src/services/rolesMenus.service.js:215` | detalle | roles | role_id eq roleId | — | — | Indirecto (FK) | puntual |
| 304 | `mobile/src/services/users.service.js:64` | listado | roles | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 305 | `mobile/src/services/users.service.js:121` | consulta | roles | tenant_id eq tenantId; role_id in roleIds | — | — | Sí | multirregistro; sin límite; sin orden |
| 306 | `web/src/services/roles.service.js:20` | listado | roles | tenant_id eq tenantId; name ilike `%${search}%` (cond.) | name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 307 | `web/src/services/roles.service.js:120` | detalle | roles | role_id eq roleId | — | — | Indirecto (FK) | puntual |
| 308 | `web/src/services/roles.service.js:269` | consulta | roles | tenant_id eq tenantId; role_id in roleIds | — | — | Sí | multirregistro; sin límite; sin orden |
| 309 | `web/src/services/users.service.js:202` | consulta | roles | tenant_id eq tenantId; role_id in roleIds | — | — | Sí | multirregistro; sin límite; sin orden |
| 310 | `web/src/services/users.service.js:293` | listado | roles | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 311 | `web/src/services/reports.service.js:709` | consulta | sale_line_components | sale_line.sale.tenant_id eq tenantId; sale_line.sale.sold_at gte fromDate; sale_line.sale.sold_at lte toDate; location_id eq locationId (cond.) | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 312 | `mobile/src/services/aiInsights.service.js:144` | listado | sale_lines | sale.tenant_id eq tenantId; sale.status in COMPLETED_SALE_STATUSES; sale.sold_at gte fromIso; sale.sold_at lte toIso | — | 6000 | Sí (join) | sin orden; límite alto |
| 313 | `mobile/src/services/reports.service.js:132` | consulta | sale_lines | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN']; sale.sold_at gte monthStart; sale.sold_at lte monthEnd; sale.location_id eq locationId (… | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 314 | `mobile/src/services/reports.service.js:463` | consulta | sale_lines | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sale.sold_at gte range.fromIso; sale.sold_at lte range.toIso | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 315 | `web/src/services/reports.service.js:123` | consulta | sale_lines | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sale.sold_at gte fromDate; sale.sold_at lte toDate | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 316 | `web/src/services/reports.service.js:461` | consulta | sale_lines | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sale.sold_at gte fromDate; sale.sold_at lte toDate | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 317 | `web/src/services/reports.service.js:908` | consulta | sale_lines | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sale.sold_at gte fromDate; sale.sold_at lte toDate | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 318 | `web/src/services/reports.service.js:1130` | consulta | sale_lines | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN']; sale.sold_at gte monthStart; sale.sold_at lte monthEnd; sale.location_id eq locationId (… | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 319 | `mobile/src/services/cashMenu.service.js:289` | consulta | sale_payments | sale.tenant_id eq tenantId; sale.cash_session_id eq sessionId | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 320 | `mobile/src/services/reports.service.js:151` | consulta | sale_payments | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN']; sale.sold_at gte monthStart; sale.sold_at lte monthEnd; sale.location_id eq locationId (… | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 321 | `mobile/src/services/reports.service.js:353` | consulta | sale_payments | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sale.sold_at gte range.fromIso; sale.sold_at lte range.toIso | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 322 | `web/src/services/cash.service.js:198` | consulta | sale_payments | tenant_id eq tenantId; cash_session_id eq sessionId | — | — | Sí | multirregistro; sin límite; sin orden |
| 323 | `web/src/services/reports.service.js:204` | consulta | sale_payments | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sale.sold_at gte fromDate; sale.sold_at lte toDate | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 324 | `web/src/services/reports.service.js:1142` | consulta | sale_payments | sale.tenant_id eq tenantId; sale.status in ['COMPLETED', 'PARTIAL_RETURN']; sale.sold_at gte monthStart; sale.sold_at lte monthEnd; sale.location_id eq locationId (… | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 325 | `web/src/views/CashSessions.vue:451` | consulta | sale_payments | sale.tenant_id eq tenantId.value; sale.cash_session_id eq item.cash_session_id | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 326 | `mobile/src/services/sales.service.js:570` | consulta | sale_return_lines | return.status eq 'COMPLETED'; sale_line_id in saleLineIds | — | — | Indirecto (FK) | multirregistro; sin límite; sin orden; tenant indirecto |
| 327 | `web/src/views/Sales.vue:1422` | consulta | sale_return_lines | return.status eq 'COMPLETED'; sale_line_id in r.data.sale_lines.map(l => l.sale_line_id) | — | — | Indirecto (FK) | multirregistro; sin límite; sin orden; tenant indirecto |
| 328 | `web/src/views/Sales.vue:1475` | consulta | sale_return_lines | return.status eq 'COMPLETED'; sale_line_id in saleLineIds | — | — | Indirecto (FK) | multirregistro; sin límite; sin orden; tenant indirecto |
| 329 | `web/src/services/sales.service.js:246` | listado | sale_returns | tenant_id eq tenantId | created_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 330 | `mobile/src/services/aiInsights.service.js:130` | listado | sales | tenant_id eq tenantId; status in COMPLETED_SALE_STATUSES; sold_at gte fromIso; sold_at lte toIso | — | 4000 | Sí | sin orden; límite alto |
| 331 | `mobile/src/services/cashMenu.service.js:276` | consulta | sales | tenant_id eq tenantId; cash_session_id eq sessionId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED… | — | — | Sí | multirregistro; sin límite; sin orden |
| 332 | `mobile/src/services/reports.service.js:102` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN']; sold_at gte from; sold_at lte to; location_id eq locationId (cond.); sale.location_id eq locationI… | — | — | Sí | multirregistro; sin límite; sin orden |
| 333 | `mobile/src/services/reports.service.js:330` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte range.fromIso; sold_at lte range.toIso | — | — | Sí | multirregistro; sin límite; sin orden |
| 334 | `mobile/src/services/sales.service.js:120` | listado | sales | tenant_id eq tenantId; status eq filters.status (cond.); location_id eq filters.location_id (cond.); sold_at gte filters.from_date (cond.); sold_at lte filters.to_d… | sold_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 335 | `mobile/src/services/sales.service.js:394` | detalle | sales | tenant_id eq tenantId; sale_id eq saleId | — | — | Sí | puntual |
| 336 | `mobile/src/services/sales.service.js:491` | detalle | sales | tenant_id eq tenantId; sale_id eq saleId | — | — | Sí | puntual |
| 337 | `mobile/src/services/sales.service.js:514` | detalle | sales | tenant_id eq tenantId; sale_id eq saleId | — | — | Sí | puntual |
| 338 | `mobile/src/services/setup.service.js:292` | conteo | sales | tenant_id eq tenantId | — | — | Sí | conteo head |
| 339 | `web/src/services/accounting.service.js:161` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDateTime; sold_at lte toDateTime | — | — | Sí | multirregistro; sin límite; sin orden |
| 340 | `web/src/services/accounting.service.js:1438` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDateTime; sold_at lte toDateTime | — | — | Sí | multirregistro; sin límite; sin orden |
| 341 | `web/src/services/electronicInvoicing.service.js:384` | detalle | sales | sale_id eq saleId; tenant_id eq tenantId | — | — | Sí | puntual |
| 342 | `web/src/services/reports.service.js:28` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDate; sold_at lte toDate; location_id eq locationId (cond.) | — | — | Sí | multirregistro; sin límite; sin orden |
| 343 | `web/src/services/reports.service.js:79` | listado | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDate; sold_at lte toDate; location_id eq locationId (cond.) | sold_at | — | Sí | sin límite; orden sin desempate |
| 344 | `web/src/services/reports.service.js:176` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDate; sold_at lte toDate | — | — | Sí | multirregistro; sin límite; sin orden |
| 345 | `web/src/services/reports.service.js:759` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDate; sold_at lte toDate; location_id eq locationId (cond.) | — | — | Sí | multirregistro; sin límite; sin orden |
| 346 | `web/src/services/reports.service.js:829` | consulta | sales | tenant_id eq tenantId; cash_session_id in sessionIds; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED… | — | — | Sí | multirregistro; sin límite; sin orden |
| 347 | `web/src/services/reports.service.js:897` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDate; sold_at lte toDate; location_id eq locationId (cond.) | — | — | Sí | multirregistro; sin límite; sin orden |
| 348 | `web/src/services/reports.service.js:1004` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED…; sold_at gte fromDate; sold_at lte toDate; location_id eq locationId (cond.) | — | — | Sí | multirregistro; sin límite; sin orden |
| 349 | `web/src/services/reports.service.js:1110` | consulta | sales | tenant_id eq tenantId; status in ['COMPLETED', 'PARTIAL_RETURN']; sold_at gte from; sold_at lte to; location_id eq locationId (cond.); sale.location_id eq locationI… | — | — | Sí | multirregistro; sin límite; sin orden |
| 350 | `web/src/services/sales.service.js:123` | listado | sales | tenant_id eq tenantId; status eq filters.status (cond.); location_id eq filters.location_id (cond.); sold_at gte filters.from_date (cond.); sold_at lte filters.to_d… | sold_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 351 | `web/src/services/sales.service.js:153` | detalle | sales | tenant_id eq tenantId; sale_id eq saleId | — | — | Sí | puntual |
| 352 | `web/src/views/About.vue:308` | conteo | sales | tenant_id eq tenantId.value | — | — | Sí | conteo head |
| 353 | `web/src/views/CashSessions.vue:443` | consulta | sales | tenant_id eq tenantId.value; cash_session_id eq item.cash_session_id; status in ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED… | — | — | Sí | multirregistro; sin límite; sin orden |
| 354 | `web/src/services/inventory.service.js:484` | listado | stock_alert_log | tenant_id eq tenantId; location_id eq filters.location_id (cond.); alert_level eq filters.alert_level (cond.) | created_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 355 | `mobile/src/services/inventoryCatalog.service.js:122` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq locationId (cond.); move_type in ['ADJUSTMENT', 'ADJUSTMENT_IN… (cond.); move_type eq moveType (cond.) | updated_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 356 | `mobile/src/services/inventoryCatalog.service.js:613` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq locationId; variant_id in variantIds | — | — | Sí | sin límite; sin orden |
| 357 | `mobile/src/services/pos.service.js:270` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq locationId; variant_id in variantIds | — | — | Sí | sin límite; sin orden |
| 358 | `mobile/src/services/pos.service.js:330` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq locationId; variant_id in ids | — | — | Sí | sin límite; sin orden |
| 359 | `mobile/src/services/reports.service.js:391` | listado | stock_balances (matview) | tenant_id eq tenantId | — | — | Sí | sin límite; sin orden |
| 360 | `mobile/src/services/sales.service.js:345` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq locationId; variant_id in variantIds | — | — | Sí | sin límite; sin orden |
| 361 | `web/src/services/inventory.service.js:58` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq filters.location_id (cond.); variant_id eq filters.variant_id (cond.); on_hand lte filters.low_stock (cond.) | updated_at desc | — | Sí | sin límite; orden sin desempate |
| 362 | `web/src/services/inventory.service.js:133` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq filters.location_id (cond.); variant_id eq filters.variant_id (cond.); on_hand lte filters.low_stock (cond.); move_type in ['A… | updated_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 363 | `web/src/services/manufacturing.service.js:411` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq locationId; variant_id in variantIds | — | — | Sí | sin límite; sin orden |
| 364 | `web/src/services/products.service.js:487` | listado | stock_balances (matview) | tenant_id eq tenantId; location_id eq locationId; variant_id in variantIds | — | — | Sí | sin límite; sin orden |
| 365 | `web/src/services/reports.service.js:508` | listado | stock_balances (matview) | tenant_id eq tenantId; on_hand gt 0; location_id eq locationId (cond.) | — | — | Sí | sin límite; sin orden |
| 366 | `web/src/services/reports.service.js:574` | listado | stock_balances (matview) | tenant_id eq tenantId; on_hand gt 0; location_id eq locationId (cond.) | — | — | Sí | sin límite; sin orden |
| 367 | `web/src/services/reports.service.js:677` | listado | stock_balances (matview) | tenant_id eq tenantId; on_hand gt 0 | — | — | Sí | sin límite; sin orden |
| 368 | `mobile/src/services/purchases.service.js:657` | detalle | supplier_payables | tenant_id eq tenantId; purchase_id eq purchaseId | — | — | Sí | puntual |
| 369 | `mobile/src/services/purchases.service.js:774` | listado | supplier_payables | tenant_id eq tenantId; status in ['OPEN', 'PARTIAL'] (cond.); status eq status (cond.); NOT(due_date is null) (cond.) | — | — | Sí | sin orden; count exacto |
| 370 | `web/src/services/purchases.service.js:757` | detalle | supplier_payables | tenant_id eq tenantId; purchase_id eq purchaseId | — | — | Sí | puntual |
| 371 | `web/src/services/purchases.service.js:885` | listado | supplier_payables | tenant_id eq tenantId; status in ['OPEN', 'PARTIAL'] (cond.); status eq status (cond.); NOT(due_date is null) (cond.) | — | — | Sí | sin orden; count exacto |
| 372 | `mobile/src/services/alerts.service.js:9` | listado | system_alerts | tenant_id eq tenantId; alert_type eq 'ONLINE_ORDER' | created_at desc | limit | Sí | orden sin desempate |
| 373 | `web/src/services/alerts.service.js:18` | listado | system_alerts | tenant_id eq tenantId | created_at desc | limit | Sí | orden sin desempate |
| 374 | `web/src/services/alerts.service.js:53` | listado | system_alerts | tenant_id eq tenantId; alert_type eq alertType | created_at desc | limit | Sí | orden sin desempate |
| 375 | `mobile/src/services/taxRules.service.js:45` | listado | tax_rules | tenant_id eq tenantId; scope eq String(scope).toUpperCase() (cond.); tax_id eq taxId (cond.); is_active eq normalizedStatus (cond.) | scope, priority desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 376 | `mobile/src/services/taxRules.service.js:75` | detalle | tax_rules | — | — | — | No | puntual |
| 377 | `mobile/src/services/taxRules.service.js:100` | detalle | tax_rules | tenant_id eq tenantId; tax_rule_id eq taxRuleId | — | — | Sí | puntual |
| 378 | `web/src/services/taxRules.service.js:14` | listado | tax_rules | tenant_id eq tenantId; scope eq filters.scope (cond.); tax_id eq filters.tax_id (cond.); is_active eq filters.is_active (cond.) | scope, priority desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 379 | `web/src/services/taxes.service.js:102` | listado | tax_rules | tenant_id eq tenantId; tax_id eq taxId | priority desc | — | Sí | sin límite; orden sin desempate |
| 380 | `mobile/src/services/setup.service.js:398` | listado | taxes | tenant_id eq tenantId; or `name.ilike.%${text}%,code.il… (cond.) | name | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 381 | `mobile/src/services/setup.service.js:420` | detalle | taxes | — | — | — | No | puntual |
| 382 | `mobile/src/services/setup.service.js:441` | detalle | taxes | tenant_id eq tenantId; tax_id eq taxId | — | — | Sí | puntual |
| 383 | `mobile/src/services/taxRules.service.js:138` | listado | taxes | tenant_id eq tenantId | name | — | Sí | sin límite; orden sin desempate |
| 384 | `web/src/services/taxes.service.js:18` | listado | taxes | tenant_id eq tenantId; or `name.ilike.%${search}%,code.… (cond.) | name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 385 | `web/src/services/taxes.service.js:39` | listado | taxes | tenant_id eq tenantId; is_active eq true | name | — | Sí | sin límite; orden sin desempate |
| 386 | `mobile/src/services/setup.service.js:121` | detalle | tenant_settings | tenant_id eq tenantId | — | — | Sí | puntual |
| 387 | `mobile/src/services/setup.service.js:228` | detalle | tenant_settings | — | — | — | No | puntual |
| 388 | `mobile/src/services/tenantSettings.service.js:78` | detalle | tenant_settings | tenant_id eq tenantId | — | — | Sí | puntual |
| 389 | `web/src/services/accounting.service.js:84` | detalle | tenant_settings | tenant_id eq tenantId | — | 1 | Sí | puntual |
| 390 | `web/src/services/accounting.service.js:108` | detalle | tenant_settings | — | — | — | No | puntual |
| 391 | `web/src/services/tenantSettings.service.js:90` | detalle | tenant_settings | tenant_id eq tenantId | — | — | Sí | puntual |
| 392 | `web/src/services/tenantSettings.service.js:149` | consulta | tenant_settings | — | — | — | No | multirregistro; sin límite; sin orden; sin tenant explícito |
| 393 | `web/src/services/tenantBilling.service.js:291` | listado | tenant_subscriptions | tenant_id eq tenantId | created_at desc | — | Sí | sin límite; orden sin desempate |
| 394 | `mobile/src/services/setup.service.js:122` | detalle | tenants | tenant_id eq tenantId | — | — | Sí | puntual |
| 395 | `mobile/src/services/setup.service.js:250` | detalle | tenants | tenant_id eq tenantId | — | — | Sí | puntual |
| 396 | `web/src/services/electronicInvoicing.service.js:414` | detalle | tenants | tenant_id eq tenantId | — | — | Sí | puntual |
| 397 | `web/src/services/tenantSettings.service.js:119` | detalle | tenants | tenant_id eq tenantId | — | — | Sí | puntual |
| 398 | `web/src/services/tenants.service.js:153` | listado | tenants | — | created_at desc | — | No | sin límite; orden sin desempate; sin tenant explícito |
| 399 | `web/src/services/tenants.service.js:172` | detalle | tenants | tenant_id eq tenantId | — | — | Sí | puntual |
| 400 | `web/src/services/tenants.service.js:192` | detalle | tenants | tenant_id eq tenantId | — | — | Sí | puntual |
| 401 | `web/src/views/LayawayDetail.vue:432` | detalle | tenants | tenant_id eq tenantId.value | — | — | Sí | puntual |
| 402 | `web/src/views/LayawayDetail.vue:445` | detalle | tenants | tenant_id eq tenantId.value | — | — | Sí | puntual |
| 403 | `web/src/views/Sales.vue:1462` | detalle | tenants | tenant_id eq tenantId.value | — | — | Sí | puntual |
| 404 | `mobile/src/services/thirdParties.service.js:9` | listado | third_parties | type in [type, 'both'] (cond.) | legal_name | range offset, offset + limit - 1 | No | orden sin desempate; offset; sin tenant explícito; count exacto |
| 405 | `mobile/src/services/thirdParties.service.js:19` | listado | third_parties | OR `legal_name.ilike.${q},trade_name.ilike.$… | legal_name | range offset, offset + limit - 1 | No | orden sin desempate; offset; sin tenant explícito; count exacto |
| 406 | `web/src/services/bulkImport.service.js:178` | detalle | third_parties | tenant_id eq tenantId; document_number eq payload.document_number | — | 1 | Sí | puntual |
| 407 | `web/src/services/customers.service.js:54` | listado | third_parties | tenant_id eq tenantId | legal_name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 408 | `web/src/services/customers.service.js:63` | listado | third_parties | tenant_id eq tenantId; OR `legal_name.ilike.${q},document_number.il… | legal_name | range from, to | Sí | orden sin desempate; offset; count exacto |
| 409 | `web/src/services/customers.service.js:84` | consulta | third_parties | tenant_id eq tenantId; is_active eq true; OR `legal_name.ilike.${q},document_number.il… | — | limit | Sí | multirregistro; sin orden |
| 410 | `web/src/services/customers.service.js:129` | detalle | third_parties | tenant_id eq tenantId; document_number eq payload.document_number \|\| '' | created_at desc | 1 | Sí | puntual |
| 411 | `web/src/services/customers.service.js:169` | detalle | third_parties | tenant_id eq tenantId; third_party_id eq customerId | — | — | Sí | puntual |
| 412 | `web/src/services/thirdParties.service.js:9` | listado | third_parties | type in [type, 'both'] (cond.) | legal_name | range offset, offset + limit - 1 | No | orden sin desempate; offset; sin tenant explícito |
| 413 | `web/src/services/thirdParties.service.js:17` | listado | third_parties | OR `legal_name.ilike.${q},document_number.il… | legal_name | range offset, offset + limit - 1 | No | orden sin desempate; offset; sin tenant explícito |
| 414 | `web/src/services/thirdParties.service.js:36` | detalle | third_parties | third_party_id eq id | — | — | No | puntual |
| 415 | `mobile/src/services/inventoryOperations.service.js:158` | listado | transfer_requests | tenant_id eq tenantId; status eq 'IN_TRANSIT'; to_location_id eq toLocationId (cond.) | created_at desc | 200 | Sí | orden sin desempate |
| 416 | `web/src/services/inventory.service.js:285` | listado | transfer_requests | tenant_id eq tenantId; status eq 'IN_TRANSIT'; to_location_id eq toLocationId (cond.) | created_at desc | 200 | Sí | orden sin desempate |
| 417 | `mobile/src/services/productPhotoImport.service.js:70` | detalle | units_of_measure | is_active eq true; OR `tenant_id.is.null,tenant_id.eq.${tenantI…; code ilike code | is_system desc | 1 | No | puntual |
| 418 | `mobile/src/services/units.service.js:9` | listado | units_of_measure | or `tenant_id.is.null,tenant_id.… (cond.); or `code.ilike.${q},name.ilike.$… (cond.) | is_system desc, name | range offset, offset + limit - 1 | No | orden sin desempate; offset; sin tenant explícito; count exacto |
| 419 | `mobile/src/services/units.service.js:35` | listado | units_of_measure | is_active eq true; or `tenant_id.is.null,tenant_id.… (cond.) | is_system desc, name | — | No | sin límite; orden sin desempate; sin tenant explícito |
| 420 | `mobile/src/services/units.service.js:63` | detalle | units_of_measure | — | — | — | No | puntual |
| 421 | `mobile/src/services/units.service.js:84` | detalle | units_of_measure | unit_id eq unitId; tenant_id eq tenantId; is_system eq false | — | — | Sí | puntual |
| 422 | `web/src/services/productPhotoImport.service.js:74` | detalle | units_of_measure | is_active eq true; OR `tenant_id.is.null,tenant_id.eq.${tenantI…; code ilike code | is_system desc | 1 | No | puntual |
| 423 | `web/src/services/unitsOfMeasure.service.js:29` | listado | units_of_measure | or `tenant_id.is.null,tenant_id.… (cond.); or `code.ilike.%${normalizedSear… (cond.) | is_system desc, name | range from, to | No | orden sin desempate; offset; sin tenant explícito; count exacto |
| 424 | `web/src/services/unitsOfMeasure.service.js:82` | detalle | units_of_measure | unit_id eq unitId | — | — | No | puntual |
| 425 | `web/src/services/unitsOfMeasure.service.js:123` | detalle | units_of_measure | — | — | — | No | puntual |
| 426 | `web/src/services/unitsOfMeasure.service.js:163` | detalle | units_of_measure | unit_id eq unitId; tenant_id eq tenantId; is_system eq false | — | — | Sí | puntual |
| 427 | `web/src/services/unitsOfMeasure.service.js:291` | listado | units_of_measure | is_active eq true; or `tenant_id.is.null,tenant_id.… (cond.) | is_system desc, name | — | No | sin límite; orden sin desempate; sin tenant explícito |
| 428 | `web/src/services/unitsOfMeasure.service.js:337` | detalle | units_of_measure | code ilike code.trim(); is_active eq true; or `tenant_id.is.null,tenant_id.… (cond.) | — | 1 | No | puntual |
| 429 | `web/src/services/roles.service.js:158` | consulta | user_roles | roles.tenant_id eq tenantId; user_id eq userId | — | — | Sí (join) | multirregistro; sin límite; sin orden |
| 430 | `mobile/src/services/cashMenu.service.js:35` | listado | users | tenant_id eq tenantId; is_active eq true | full_name | — | Sí | sin límite; orden sin desempate |
| 431 | `mobile/src/services/reports.service.js:414` | consulta | users | tenant_id eq tenantId | — | — | Sí | multirregistro; sin límite; sin orden |
| 432 | `mobile/src/services/users.service.js:37` | listado | users | tenant_id eq tenantId; or `full_name.ilike.%${text}%,em… (cond.) | created_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 433 | `web/src/services/accounting.service.js:1114` | detalle | users | auth_user_id eq authUserId | — | — | No | puntual |
| 434 | `web/src/services/roles.service.js:256` | detalle | users | user_id eq userId | — | — | Indirecto (FK) | puntual |
| 435 | `web/src/services/users.service.js:20` | listado | users | tenant_id eq tenantId; or `full_name.ilike.%${search}%,… (cond.) | created_at desc | range from, to | Sí | orden sin desempate; offset; count exacto |
| 436 | `web/src/services/users.service.js:69` | listado | users | tenant_id eq tenantId | created_at desc | — | Sí | sin límite; orden sin desempate |
| 437 | `web/src/services/users.service.js:110` | detalle | users | tenant_id eq tenantId; user_id eq userId | — | — | Sí | puntual |
| 438 | `mobile/src/services/batches.service.js:445` | listado | vw_batch_traceability (vista) | tenant_id eq tenantId; batch_id eq batchId | sold_at desc | — | Sí | sin límite; orden sin desempate |
| 439 | `web/src/services/batches.service.js:313` | listado | vw_batch_traceability (vista) | tenant_id eq tenantId; batch_id eq batchId (cond.); sale_id eq saleId (cond.) | sold_at desc | — | Sí | sin límite; orden sin desempate |
| 440 | `web/src/services/manufacturing.service.js:750` | listado | vw_component_expiration_risk | tenant_id eq tenantId | days_to_expiry | — | Sí | sin límite; orden sin desempate |
| 441 | `mobile/src/services/batches.service.js:382` | listado | vw_expiration_dashboard (vista) | tenant_id eq tenantId | total_value_at_risk desc | — | Sí | sin límite; orden sin desempate |
| 442 | `web/src/services/batches.service.js:212` | listado | vw_expiration_dashboard (vista) | tenant_id eq tenantId | total_value_at_risk desc | — | Sí | sin límite; orden sin desempate |
| 443 | `mobile/src/services/batches.service.js:351` | listado | vw_expiring_products (vista) | tenant_id eq tenantId; location_id eq locationId (cond.); alert_level eq alertLevel (cond.) | days_to_expiry | — | Sí | sin límite; orden sin desempate |
| 444 | `web/src/services/batches.service.js:188` | listado | vw_expiring_products (vista) | tenant_id eq tenantId; location_id eq filters.location_id (cond.); alert_level eq filters.alert_level (cond.); variant_id eq variantId (cond.) | days_to_expiry | — | Sí | sin límite; orden sin desempate |
| 445 | `mobile/src/services/purchases.service.js:358` | listado | vw_inventory_rotation_analysis (vista) | tenant_id eq tenantId | days_of_stock_remaining | 100 | Sí | orden sin desempate |
| 446 | `web/src/services/ai-pricing-advisor.service.js:62` | listado | vw_inventory_rotation_analysis (vista) | tenant_id eq tenantId | sold_last_30d desc | cfg.maxItems | Sí | orden sin desempate |
| 447 | `web/src/services/purchases.service.js:110` | listado | vw_inventory_rotation_analysis (vista) | tenant_id eq tenantId | days_of_stock_remaining | 100 | Sí | orden sin desempate |
| 448 | `mobile/src/services/inventoryCatalog.service.js:185` | listado | vw_kardex (vista) | tenant_id eq tenantId; location_id eq locationId (cond.); move_type in ['ADJUSTMENT', 'ADJUSTMENT_IN… (cond.); move_type eq moveType (cond.) | created_at desc | range offset, offset + limit - 1 | Sí | orden sin desempate; offset; count exacto |
| 449 | `web/src/services/inventory.service.js:168` | listado | vw_kardex (vista) | tenant_id eq tenantId; location_id eq filters.location_id (cond.); variant_id eq filters.variant_id (cond.); move_type in ['ADJUSTMENT', 'ADJUSTMENT_IN… (cond.); mo… | created_at desc | — | Sí | orden sin desempate; count exacto |
| 450 | `mobile/src/services/layaway.service.js:88` | listado | vw_layaway_payments (vista) | tenant_id eq tenantId; layaway_id eq layawayId | paid_at desc | — | Sí | sin límite; orden sin desempate |
| 451 | `web/src/services/layaway.service.js:91` | listado | vw_layaway_payments (vista) | tenant_id eq tenantId; layaway_id eq layawayId | paid_at desc | — | Sí | sin límite; orden sin desempate |
| 452 | `web/src/services/reports.service.js:374` | listado | vw_layaway_payments_report (vista) | tenant_id eq tenantId; paid_at gte fromDate; paid_at lte toDate; location_id eq locationId (cond.); fecha_fin_real gte fromDate (cond.); status eq status (cond.) | paid_at desc | — | Sí | sin límite; orden sin desempate |
| 453 | `mobile/src/services/reports.service.js:532` | listado | vw_layaway_report (vista) | tenant_id eq tenantId; created_at gte range.fromIso; created_at lte range.toIso; location_id eq locationId (cond.) | — | — | Sí | sin límite; sin orden |
| 454 | `web/src/services/reports.service.js:331` | listado | vw_layaway_report (vista) | tenant_id eq tenantId; created_at gte fromDate; created_at lte toDate; location_id eq locationId (cond.); fecha_fin_real gte fromDate (cond.); status eq status (con… | — | — | Sí | sin límite; sin orden |
| 455 | `mobile/src/services/layaway.service.js:27` | listado | vw_layaway_summary (vista) | tenant_id eq tenantId; status eq status (cond.) | created_at desc | — | Sí | orden sin desempate; count exacto |
| 456 | `web/src/services/layaway.service.js:25` | listado | vw_layaway_summary (vista) | tenant_id eq tenantId; status eq status (cond.) | created_at desc | — | Sí | orden sin desempate; count exacto |
| 457 | `web/src/services/manufacturing.service.js:719` | detalle | vw_manufacturing_dashboard (vista) | tenant_id eq tenantId | — | — | Sí | puntual |
| 458 | `web/src/services/manufacturing.service.js:734` | listado | vw_ondemand_margin_analysis (vista) | tenant_id eq tenantId | sale_date desc | limit | Sí | orden sin desempate |
| 459 | `web/src/services/reports.service.js:396` | listado | vw_production_cost_report (vista) | tenant_id eq tenantId; fecha_fin_real gte fromDate (cond.); location_id eq locationId (cond.); status eq status (cond.) | — | — | Sí | sin límite; sin orden |
| 460 | `web/src/services/reports.service.js:425` | listado | vw_production_cost_summary_by_product (vista) | tenant_id eq tenantId | total_ordenes desc | — | Sí | sin límite; orden sin desempate |
| 461 | `web/src/services/batches.service.js:294` | listado | vw_products_expiration_config (vista) | tenant_id eq tenantId | product_name | — | Sí | sin límite; orden sin desempate |
| 462 | `web/src/services/inventory.service.js:451` | listado | vw_stock_alerts (vista) | tenant_id eq tenantId; alert_level in ['OUT_OF_STOCK', 'LOW_STOCK', 'NO_AVAILAB…; location_id eq filters.location_id (cond.); alert_level eq filters.alert_level (co… | alert_level, on_hand | — | Sí | sin límite; orden sin desempate |
| 463 | `mobile/src/services/layaway.service.js:207` | detalle | vw_stock_available (vista) | tenant_id eq tenantId; location_id eq locationId; variant_id eq variantId | — | — | Sí | puntual |
| 464 | `web/src/services/layaway.service.js:231` | detalle | vw_stock_available (vista) | tenant_id eq tenantId; location_id eq locationId; variant_id eq variantId | — | — | Sí | puntual |
| 465 | `web/src/services/batches.service.js:231` | listado | vw_stock_for_cashier (vista) | tenant_id eq tenantId; location_id eq locationId; variant_id eq variantId (cond.); batch_id eq batchId (cond.); sale_id eq saleId (cond.) | — | — | Sí | sin límite; sin orden |
| 466 | `web/src/services/cashAssignment.service.js:31` | listado | vw_user_cash_registers (vista) | tenant_id eq tenantId; user_id eq userId; is_active eq true | cash_register_name | — | Sí | sin límite; orden sin desempate |

### A.4 Señales agregadas por entidad

Entidades ordenadas por señal de riesgo (tenant + límite + desempate + offset). Solo se muestran las 30 primeras; el resto puede recalcularse desde [`query-sites.json`](query-sites.json).

| Entidad | Total | Listados | Detalles | Consultas | Sin límite | Sin orden | Sin desempate | Offset | Sin tenant | Indirecto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| units_of_measure | 12 | 4 | 8 | 0 | 2 | 0 | 4 | 2 | 10 | 0 |
| product_variants | 37 | 11 | 17 | 7 | 3 | 8 | 10 | 0 | 7 | 0 |
| sales | 24 | 4 | 5 | 13 | 14 | 14 | 3 | 2 | 0 | 0 |
| products | 24 | 6 | 14 | 0 | 0 | 1 | 5 | 3 | 7 | 0 |
| categories | 14 | 7 | 7 | 0 | 5 | 0 | 7 | 2 | 3 | 0 |
| locations | 16 | 9 | 5 | 0 | 7 | 0 | 9 | 2 | 1 | 0 |
| stock_balances (matview) | 13 | 13 | 0 | 0 | 11 | 10 | 3 | 2 | 0 | 0 |
| third_parties | 11 | 6 | 4 | 1 | 0 | 1 | 6 | 6 | 5 | 0 |
| cash_movements | 11 | 3 | 1 | 7 | 8 | 7 | 3 | 2 | 1 | 0 |
| roles | 12 | 4 | 5 | 3 | 5 | 3 | 4 | 2 | 1 | 3 |
| inventory_batches | 10 | 5 | 5 | 0 | 2 | 0 | 5 | 3 | 2 | 3 |
| product_media | 17 | 5 | 12 | 0 | 5 | 0 | 5 | 0 | 2 | 0 |
| cash_sessions | 12 | 4 | 6 | 2 | 4 | 2 | 4 | 2 | 1 | 1 |
| customer_credit_accounts | 7 | 3 | 2 | 2 | 5 | 2 | 3 | 0 | 1 | 0 |
| inventory_moves | 6 | 4 | 0 | 2 | 6 | 2 | 4 | 0 | 0 | 0 |
| users | 8 | 4 | 3 | 1 | 3 | 1 | 4 | 2 | 1 | 1 |
| sale_payments | 7 | 0 | 0 | 7 | 7 | 7 | 0 | 0 | 0 | 0 |
| cash_registers | 6 | 4 | 2 | 0 | 2 | 0 | 4 | 2 | 1 | 0 |
| taxes | 6 | 4 | 2 | 0 | 2 | 0 | 4 | 2 | 1 | 0 |
| payment_methods | 6 | 3 | 2 | 1 | 2 | 1 | 3 | 2 | 1 | 0 |
| sale_lines | 7 | 1 | 0 | 6 | 6 | 7 | 0 | 0 | 0 | 0 |
| tenant_settings | 7 | 0 | 6 | 1 | 1 | 1 | 0 | 0 | 3 | 0 |
| accounting_entries | 6 | 1 | 2 | 3 | 3 | 3 | 1 | 0 | 1 | 0 |
| bill_of_materials | 6 | 3 | 3 | 0 | 1 | 0 | 3 | 2 | 1 | 0 |
| tax_rules | 5 | 3 | 2 | 0 | 1 | 0 | 3 | 2 | 1 | 0 |
| accounting_accounts | 6 | 2 | 4 | 0 | 2 | 0 | 2 | 0 | 1 | 0 |
| bom_components | 4 | 0 | 0 | 3 | 3 | 3 | 0 | 0 | 1 | 0 |
| invoice_resolutions | 8 | 1 | 7 | 0 | 1 | 0 | 1 | 0 | 2 | 0 |
| menu_items | 5 | 3 | 2 | 0 | 3 | 0 | 3 | 0 | 0 | 0 |
| permissions | 3 | 3 | 0 | 0 | 3 | 0 | 3 | 0 | 0 | 0 |

### A.5 Índices candidatos (a validar con `EXPLAIN`)

Derivados de filtros y órdenes observados, no de un plan real. No crear índices en esta tarea: la Tarea 6 debe medirlos sobre datos sintéticos y decidir el orden de columnas. `tenant_id` va primero cuando la tabla lo tiene.

| Entidad | Filtros/orden observados | Índice candidato | Evidencia |
|---|---|---|---|
| `sales` | tenant_id; status; sold_at; sale_id | `(tenant_id, sold_at DESC, sale_id DESC) y (tenant_id, status, sold_at DESC)` | Accountings/reportes y getSales |
| `sale_lines` | sale_id; tenant_id | `(tenant_id, sale_id) y (sale_id)` | Detalle de venta y reportes |
| `sale_payments` | sale_id; tenant_id; cash_session_id | `(tenant_id, sale_id) y (tenant_id, cash_session_id)` | Caja y reportes |
| `product_variants` | tenant_id; is_active; sku; product_id; variant_name | `(tenant_id, is_active, sku) y (tenant_id, product_id, variant_name)` | POS/búsqueda y catálogo |
| `products` | tenant_id; is_active; name; unit_id | `(tenant_id, is_active, name)` | Catálogo y conteos |
| `inventory_batches` | tenant_id; location_id; variant_id; expiration_date | `(tenant_id, location_id, variant_id, expiration_date) y (tenant_id, expiration_date)` | FEFO/vencimientos |
| `inventory_moves` | tenant_id; location_id; move_type; source_id; created_at | `(tenant_id, location_id, created_at DESC) y (tenant_id, source_id)` | Kardex y trazabilidad |
| `stock_balances` | tenant_id; location_id; variant_id; updated_at | `(tenant_id, location_id, variant_id)` | Saldo materializado |
| `cash_sessions` | tenant_id; status; cash_register_id; opened_at | `(tenant_id, status, opened_at DESC) y (tenant_id, cash_register_id, status)` | Caja |
| `cash_movements` | tenant_id; cash_session_id; created_at | `(tenant_id, cash_session_id, created_at DESC)` | Arqueo |
| `layaway_contracts` | tenant_id; status; due_date; customer_id | `(tenant_id, status, due_date) y (tenant_id, customer_id)` | Separados/vencimientos |
| `layaway_payments` | tenant_id; layaway_id; cash_session_id | `(tenant_id, layaway_id, paid_at DESC)` | Pagos de separado |
| `customer_credit_movements` | credit_account_id; created_at | `(credit_account_id, created_at DESC)` | Cartera |
| `customer_credit_accounts` | tenant_id; customer_id; current_balance | `(tenant_id, customer_id) único y (tenant_id, current_balance)` | Cartera |
| `supplier_payables` | tenant_id; status; due_date; supplier_id | `(tenant_id, status, due_date) y (tenant_id, supplier_id)` | CxP |
| `accounting_entries` | tenant_id; entry_date; status; entry_number | `(tenant_id, entry_date DESC, entry_number DESC) y (tenant_id, status, entry_date)` | Libro/periodos |
| `accounting_event_queue` | tenant_id; status; created_at | `(tenant_id, status, created_at)` | Cola contable |
| `bulk_imports` | tenant_id; created_at | `(tenant_id, created_at DESC)` | Historial de importaciones |
| `bulk_import_errors` | import_id; row_number | `(import_id, row_number)` | Errores de importación |
| `notifications` | tenant_id; user_id; is_read; created_at | `(tenant_id, user_id, created_at DESC) y parcial de no leídas` | Centro de notificaciones |
| `system_alerts` | tenant_id; alert_type; created_at | `(tenant_id, alert_type, created_at DESC)` | Alertas |
| `product_media` | tenant_id; product_id; is_cover; sort_order | `(tenant_id, product_id, sort_order)` | Galería |
| `invoice_resolutions` | tenant_id; document_type; is_active; resolution_date | `(tenant_id, document_type, is_active, resolution_date DESC)` | Facturación |
| `third_parties` | tenant_id; legal_name; document_number | `(tenant_id, legal_name) y (tenant_id, document_number)` | Terceros |
| `taxes` | tenant_id; is_active; name | `(tenant_id, is_active, name)` | Impuestos |
| `units_of_measure` | tenant_id; is_active; name | `(tenant_id, is_active, name)` | Unidades |
| `locations` | tenant_id; is_active; name | `(tenant_id, is_active, name)` | Sedes |
| `users` | tenant_id; is_active; full_name | `(tenant_id, is_active, full_name)` | Usuarios |
| `categories` | tenant_id; name | `(tenant_id, name)` | Categorías |
| `roles` | tenant_id; name | `(tenant_id, name)` | Roles |

### A.6 Alcance excluido y límites de la Parte A

- **Mutaciones:** los 74 sitios `.insert/.update/.delete/.upsert` no se listan; no son listados ni consultas de lectura. Su análisis corresponde a la Tarea 5 (efectos y atomicidad).
- **Clientes HTTP:** `backendDomainClient`, `backendCustomersClient`, `bulkImportClient` y similares delegan en el backend y no construyen `.from()`/`.rpc()`; quedan fuera de este inventario.
- **SQLite offline:** las consultas de `mobile/src/storage/sqlite/` no son PostgreSQL directo y no se incluyeron; su paridad es un riesgo aparte para la Tarea 6.
- **RLS:** el análisis es del texto del cliente. Una consulta marcada `No` puede estar protegida por una política RLS en Supabase; en PostgreSQL portable esa protección desaparece y debe hacerse explícita.
- **PostgREST:** los filtros sobre recursos embebidos (`sale.tenant_id`) y los `!inner` no se evalúan semánticamente; se marcan como `Sí (join)` para revisión.
- **Dinamismo:** 7 sitios usan una tabla no resoluble y 2 RPC usan un nombre calculado; no se puede afirmar su entidad ni su firma sin ejecutar el cliente.

## Parte B — RPCs y funciones definidas en migraciones

### B.1 Cobertura y método

Fuentes: `shared/supabase/migrations/*.sql` (canónica) más los archivos propios de `web/migrations/` (17) y `mobile/migrations/` (11) que no son symlinks. Se deduplicaron las copias symlink por ruta real. Total: **189 archivos SQL**.

| Métrica | Valor |
|---|---:|
| Archivos SQL únicos | 189 |
| Sentencias `CREATE [OR REPLACE] FUNCTION` | 363 |
| Firmas únicas (nombre + parámetros) | 265 |
| Nombres de función únicos | 256 |
| Definiciones `SECURITY DEFINER` | 160 |
| `SECURITY DEFINER` sin `search_path` | 61 |
| Funciones que usan `auth.uid()`/`auth.jwt()` | 57 |
| Funciones trigger (`RETURNS trigger`) | 57 |
| Nombres con más de una definición | 60 |

| Dominio | Definiciones | Nombres únicos |
|---|---:|---:|
| inventario/producción | 74 | 57 |
| identidad/tenancy | 64 | 54 |
| ventas/caja | 58 | 30 |
| notificaciones/outbox | 37 | 29 |
| tienda online/público | 35 | 14 |
| contabilidad | 25 | 18 |
| soporte/otros | 23 | 22 |
| compras/proveedores | 18 | 12 |
| layaway/separados | 14 | 8 |
| alertas | 6 | 3 |
| cartera/crédito | 3 | 3 |
| IA/telemetría | 2 | 2 |
| importación masiva | 2 | 2 |
| mantenimiento | 1 | 1 |
| reportes | 1 | 1 |

**Advertencias de lectura:**

1. Los conteos son de **sentencias en archivos**, no del estado desplegado. Una función puede estar redefinida varias veces y el orden de aplicación no es necesariamente el alfabético. La definición consolidada es **a verificar** contra el baseline que se elija ([`baseline-proposal.md`](../baseline-proposal.md)).
2. `sp_create_sale`, `sp_create_purchase`, `sp_create_layaway`, `fn_create_online_manual_order` y `fn_accounting_post_entry` tienen múltiples variantes. No se debe asumir cuál está desplegada sin consultar la base.
3. `sale_line_components` y `vw_component_expiration_risk` se referencian en el código pero **no se localizó su `CREATE`** en las migraciones: **a verificar**.
4. Los privilegios (`GRANT`/`REVOKE`) no se inventariaron aquí; solo se marca `SECURITY DEFINER`. La Tarea 5 debe revisar ownership y grants.

### B.2 Funciones prioritarias

Ventas, compras, cartera, layaway, importación masiva, inventario/producción, contabilidad y notificaciones/outbox. Una fila por firma; las redefiniciones de la misma firma se agrupan y sus ubicaciones completas están en la sección B.4.

#### ventas/caja (32 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 1 | `fn_apply_rounding(p_tenant UUID, p_amount NUMERIC)` | FIX_SALE_ROUNDING.sql:16 | No | Redondeo monetario; replicar exactamente en Go. |
| 2 | `fn_calculate_discount(p_subtotal numeric, p_discount_value numeric, p_discount_type text)` | ADD_DISCOUNT_TYPE.sql:40 | No | Auxiliar; 5 referencias SQL. |
| 3 | `fn_calculate_price(p_tenant uuid, p_variant uuid, p_cost numeric, p_location uuid)` | PricingRules.sql:203 | No | Cálculo de precio; candidato a dominio Go puro. |
| 4 | `fn_calculate_sale_price(p_tenant uuid, p_variant uuid, p_cost numeric(14,2))` | SpVistasFN.sql:1369 | No | Auxiliar; 2 referencias SQL. |
| 5 | `fn_calculate_tax_breakdown(p_price_after_discount numeric, p_tax_rate numeric, p_price_includes_tax boolean)` | ADD_PRICE_INCLUDES_TAX.sql:30 | No | Desglose de impuestos; candidato a dominio Go puro. |
| 6 | `fn_get_open_cash_session_for_user(p_tenant uuid, p_user uuid)` | AsignacionCajerosCaja.sql:73; EJECUTAR_MIGRACION_CAJAS.sql:64; SpVistasFN.sql:1151 | No | Sesión de caja abierta del usuario; depende de auth.uid(). |
| 7 | `fn_get_pricing_policy(p_tenant uuid, p_variant uuid, p_location uuid)` | PricingRules.sql:85 | No | Política de precios por tenant; lectura. |
| 8 | `fn_get_sale_warnings(p_tenant UUID, p_sale_id UUID)` | ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql:365 | No | Lectura de advertencias de stock/precio para el POS. |
| 9 | `fn_get_sales_forecast_data(p_tenant_id uuid, p_location_id uuid, p_days_back integer)` | SpVistasFN.sql:1852 | No | RPC cliente (1 sitios). |
| 10 | `fn_get_tax_info_for_variant(p_tenant uuid, p_variant uuid)` | FIX_TAX_INFO_DISPLAY.sql:12 | Sí (sin search_path) | Información fiscal por variante; auxiliar de ventas. |
| 11 | `fn_get_tax_rate_for_variant(p_tenant uuid, p_variant uuid)` | FIX_TAX_FUNCTION_PERMISSIONS.sql:11; SpVistasFN.sql:65; full_migration.sql:450 | Mixto | Tasa de impuesto por variante; auxiliar de ventas. |
| 12 | `fn_next_sale_number(p_tenant uuid, p_location uuid)` | SpVistasFN.sql:20; full_migration.sql:409; web/FIX_SALE_COUNTERS_RLS.sql:17 | Mixto | Consecutivo de venta por tenant/sede; requiere lock o UNIQUE portable. |
| 13 | `fn_online_store_create_sale(p_tenant UUID, p_location UUID, p_cash_session UUID, p_customer UUID, p_sold_by UUID, p_lines JSONB, p_payments JSONB, p_…` | FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION.sql:12; FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION_V2.sql:8; FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION_V3.sql:8; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:147 | No | Venta desde tienda online; revisar autorización pública y stock. [SQL dinámico]. |
| 14 | `fn_pos_home_context(p_tenant uuid, p_user uuid)` | AsignacionCajerosCaja.sql:236; EJECUTAR_MIGRACION_CAJAS.sql:202; SpVistasFN.sql:1279 | No | Contexto agregado del POS (caja, alertas); lectura multi-tabla. |
| 15 | `fn_user_can_use_cash_register(p_tenant uuid, p_user uuid, p_cash_register uuid)` | AsignacionCajerosCaja.sql:55; EJECUTAR_MIGRACION_CAJAS.sql:47; SpVistasFN.sql:1133 | No | Autorización de uso de caja; mover a contexto de aplicación. |
| 16 | `fn_user_is_cashier(p_user_id uuid)` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:49 | Sí (sin search_path) | Auxiliar; 1 referencias SQL. |
| 17 | `get_cash_movements_by_role(p_from_date timestamptz, p_to_date timestamptz, p_location_id uuid, p_type text)` | CREATE_ROLE_FILTER_FUNCTIONS.sql:230 | Sí (sin search_path) | Sin consumidor estático; a verificar. [usa auth.uid()/jwt]. |
| 18 | `get_sale_lines_by_role(p_from_date timestamptz, p_to_date timestamptz)` | CREATE_ROLE_FILTER_FUNCTIONS.sql:100 | Sí (sin search_path) | Variante legacy por rol; depende de auth/RLS, revisar eliminación. [usa auth.uid()/jwt]. |
| 19 | `get_sale_payments_by_role(p_from_date timestamptz, p_to_date timestamptz)` | CREATE_ROLE_FILTER_FUNCTIONS.sql:170 | Sí (sin search_path) | Variante legacy por rol; depende de auth/RLS, revisar eliminación. [usa auth.uid()/jwt]. |
| 20 | `get_sales_by_role(p_from_date timestamptz, p_to_date timestamptz, p_location_id uuid)` | CREATE_ROLE_FILTER_FUNCTIONS.sql:14 | Sí (sin search_path) | Variante legacy por rol; depende de auth/RLS, revisar eliminación. [usa auth.uid()/jwt]. |
| 21 | `is_user_cashier()` | FIX_RLS_CASHIER_PRIVACY.sql:35; FIX_RLS_CASHIER_RESTRICTIONS.sql:49 | Sí (sin search_path) | Auxiliar; 6 referencias SQL. [usa auth.uid()/jwt]. |
| 22 | `sp_assign_cash_register_to_user(p_tenant uuid, p_cash_register uuid, p_user uuid, p_assigned_by uuid, p_is_active boolean, p_note text)` | AsignacionCajerosCaja.sql:115; EJECUTAR_MIGRACION_CAJAS.sql:102; SpVistasFN.sql:1185 | No | Asigna caja a usuario; administración de sedes. |
| 23 | `sp_close_cash_session(p_tenant uuid, p_cash_session uuid, p_closed_by uuid, p_counted_amount numeric(14,2))` | SpVistasFN.sql:493 | No | Cierre de caja (variante previa); seleccionar una sola definición. |
| 24 | `sp_close_cash_session_secure(p_tenant uuid, p_cash_session uuid, p_closed_by uuid, p_counted_amount numeric(14,2))` | AsignacionCajerosCaja.sql:201; EJECUTAR_MIGRACION_CAJAS.sql:174; SpVistasFN.sql:1253 | No | Cierre de caja con validación de permisos y descuadre. |
| 25 | `sp_create_return(p_tenant uuid, p_sale_id uuid, p_created_by uuid, p_lines jsonb, p_reason text)` | SpVistasFN.sql:344 | No | Devolución base: repone stock e inserta reembolsos. Ver R03. |
| 26 | `sp_create_return_v2(p_tenant UUID, p_sale_id UUID, p_created_by UUID, p_lines JSONB, p_refunds JSONB, p_reason TEXT)` | ADD_SALE_RETURNS_REFUNDS_V2.sql:53 | No | Valida reembolsos contra el total y delega en sp_create_return. Ver R03. |
| 27 | `sp_create_sale(p_tenant UUID, p_location UUID, p_cash_session UUID, p_customer UUID, p_sold_by UUID, p_lines JSONB, p_payments JSONB, p_note TEXT)` | ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql:43; FIX_SALE_ROUNDING.sql:85; MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql:26; SpVistasFN.sql:124; +2 | No | Venta atómica: cabecera, líneas, pagos, numeración y stock/lotes. 7 variantes; ver R01. |
| 28 | `sp_create_sale(p_tenant UUID, p_location UUID, p_cash_session UUID, p_customer UUID, p_sold_by UUID, p_lines JSONB, p_payments JSONB, p_note TEXT, … …` | UPDATE_SP_CREATE_SALE_FE.sql:37 | No | Venta atómica: cabecera, líneas, pagos, numeración y stock/lotes. 7 variantes; ver R01. |
| 29 | `sp_create_sale_idempotent(p_operation_id TEXT, p_tenant UUID, p_location UUID, p_cash_session UUID, p_customer UUID, p_sold_by UUID, p_lines JSONB, p…` | mobile/ADD_IDEMPOTENT_MOBILE_SALES.sql:27; mobile/FIX_IDEMPOTENT_SALE_ERROR_MESSAGES.sql:14 | Sí (sin search_path) | Idempotencia por operation_id (advisory lock + mobile_sale_operations). Ver R02. |
| 30 | `sp_create_sale_idempotent(p_operation_id TEXT, p_tenant UUID, p_location UUID, p_cash_session UUID, p_customer UUID, p_sold_by UUID, p_lines JSONB, p…` | mobile/ADD_POS_MANUAL_SALE_DATETIME_IDEMPOTENT.sql:14 | Sí (sin search_path) | Idempotencia por operation_id (advisory lock + mobile_sale_operations). Ver R02. |
| 31 | `sp_open_cash_session(p_tenant uuid, p_cash_register uuid, p_opened_by uuid, p_opening_amount numeric(14,2))` | AsignacionCajerosCaja.sql:152; EJECUTAR_MIGRACION_CAJAS.sql:131; SpVistasFN.sql:1212 | No | Apertura de caja con validación de usuario/asignación. |
| 32 | `trg_pricing_rules_updated_at()` | PricingRules.sql:56 | No | Trigger de tabla. |

#### compras/proveedores (12 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 33 | `fn_get_purchase_suggestions(p_tenant_id UUID, p_min_priority INTEGER, p_limit INTEGER)` | PURCHASE_ANALYSIS_VIEWS.sql:114; SpVistasFN.sql:1658 | No | Sugerencia de reposición por prioridad y límite. |
| 34 | `fn_refresh_supplier_payable_alerts()` | ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql:16 | No | Recalcula alertas de CxP; operación global de mantenimiento. |
| 35 | `sp_create_manual_purchase_ingress(p_tenant UUID, p_location UUID, p_variant UUID, p_quantity NUMERIC, p_unit_cost NUMERIC, p_created_by UUID, p_note …` | INVENTORY_PURCHASE_HARDENING.sql:190 | No | Ingreso manual de compra (variante mobile); aplica stock/lote. |
| 36 | `sp_create_purchase(p_tenant UUID, p_location UUID, p_supplier_id UUID, p_created_by UUID, p_lines JSONB, p_note TEXT)` | ADD_PURCHASES_TABLE.sql:34; FIX_BATCH_NUMBER_BY_LOCATION.sql:115; INTEGRATE_BATCHES_WITH_PURCHASES.sql:15; SpVistasFN.sql:1460; +1 | No | Compra atómica + lotes/movimiento de entrada. 5 variantes; ver R04. |
| 37 | `sp_create_purchase_order(p_tenant UUID, p_location UUID, p_supplier_id UUID, p_created_by UUID, p_lines JSONB, p_note TEXT)` | ADD_PURCHASE_ORDERS_CORE.sql:70 | No | Orden de compra con líneas; no mueve stock. |
| 38 | `sp_create_purchase_return(p_tenant UUID, p_purchase_id UUID, p_created_by UUID, p_lines JSONB, p_note TEXT)` | ADD_PURCHASE_RETURNS_CORE.sql:67 | No | Devolución a proveedor con salida de stock. Ver R06. |
| 39 | `sp_create_supplier_payable(p_tenant UUID, p_purchase_id UUID, p_created_by UUID, p_due_date DATE, p_invoice_number TEXT, p_note TEXT)` | ADD_SUPPLIER_PAYABLES_CORE.sql:70 | No | CxP desde compra; evita duplicado por compra. |
| 40 | `sp_get_supplier_payables_dashboard(p_tenant UUID, p_status TEXT, p_due_in_days INTEGER)` | ADD_SUPPLIER_PAYABLES_DASHBOARD_RPC.sql:5 | No | Lectura de cartera de proveedores por estado/vencimiento. |
| 41 | `sp_receive_purchase_order(p_tenant UUID, p_purchase_order_id UUID, p_created_by UUID, p_note TEXT)` | ADD_PURCHASE_ORDERS_CORE.sql:154; ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:124 | No | Recepción total de orden; genera compra. Ver R05. |
| 42 | `sp_receive_purchase_order_partial(p_tenant UUID, p_purchase_order_id UUID, p_created_by UUID, p_lines JSONB, p_note TEXT)` | ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:15 | No | Recepción parcial con lock de cabecera. Ver R05. |
| 43 | `sp_register_supplier_payment(p_tenant UUID, p_payable_id UUID, p_amount NUMERIC, p_created_by UUID, p_payment_method TEXT, p_note TEXT)` | ADD_SUPPLIER_PAYABLES_CORE.sql:146 | No | Pago de CxP con lock; actualiza pagado/saldo/estado. |
| 44 | `trg_refresh_supplier_payable_alerts()` | ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql:74 | No | Trigger de tabla. |

#### cartera/crédito (3 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 45 | `fn_refresh_customer_receivable_alerts(p_tenant UUID)` | ADD_CUSTOMER_RECEIVABLE_ALERTS_REALTIME.sql:16 | No | Recalcula alertas de cartera. p_tenant DEFAULT NULL: la llamada sin payload refresca todos los tenants (a verificar). |
| 46 | `fn_update_credit_balance(p_credit_account_id UUID, p_delta NUMERIC)` | ADD_CREDIT_SALES.sql:7 | Sí (sin search_path) | SECURITY DEFINER; ajusta saldo por credit_account_id sin tenant → riesgo. |
| 47 | `trg_refresh_customer_receivable_alerts()` | ADD_CUSTOMER_RECEIVABLE_ALERTS_REALTIME.sql:69 | No | Trigger que refresca alertas de cartera. |

#### layaway/separados (8 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 48 | `fn_expire_due_layaways(p_tenant uuid, p_actor uuid)` | LAYAWAY_OPERATIONAL_HARDENING.sql:605 | No | Job de contratos vencidos; invoca sp_cancel_layaway. |
| 49 | `fn_recalc_layaway_totals(p_tenant uuid, p_layaway uuid)` | PlanSepare.sql:172 | No | Recalcula subtotal/impuesto/total del contrato. |
| 50 | `fn_refresh_layaway_alerts()` | SpVistasFN.sql:950; UPDATE_VIEWS_TO_THIRD_PARTIES.sql:226 | No | Recalcula alertas de separados; operación global de mantenimiento. |
| 51 | `sp_add_layaway_payment(p_tenant uuid, p_layaway uuid, p_payment_method_code text, p_amount numeric(14,2), p_paid_by uuid, p_cash_session uuid, p_refe…` | PlanSepare.sql:401 | No | Pago con lock de contrato ACTIVE; actualiza saldo/estado. |
| 52 | `sp_cancel_layaway(p_tenant uuid, p_layaway uuid, p_cancelled_by uuid, p_status text, p_note text)` | LAYAWAY_OPERATIONAL_HARDENING.sql:526; PlanSepare.sql:609 | No | Cancela/expira contrato y libera reserva; lock de cabecera. |
| 53 | `sp_complete_layaway_to_sale(p_tenant uuid, p_layaway uuid, p_sold_by uuid, p_note text)` | LAYAWAY_OPERATIONAL_HARDENING.sql:305; PlanSepare.sql:479 | No | Convierte separado en venta; consume stock y registra pagos. |
| 54 | `sp_create_layaway(p_tenant uuid, p_location uuid, p_customer uuid, p_created_by uuid, p_items jsonb, p_due_date date, p_note text, p_initial_payment …` | LAYAWAY_OPERATIONAL_HARDENING.sql:14; PlanSepare.sql:227; UPDATE_LAYAWAY_SP_DISCOUNT_TYPE.sql:7; UPDATE_LAYAWAY_SP_PRICE_INCLUDES_TAX.sql:8 | No | Contrato, items, pago inicial y reserva de stock; 4 variantes. |
| 55 | `trg_layaway_contracts_alert()` | SpVistasFN.sql:1083 | No | Trigger de tabla. |

#### importación masiva (2 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 56 | `fn_set_dataimport_tenant_metadata()` | SETUP_DATAIMPORT_BUCKET.sql:68 | No | Metadata del bucket dataimport; depende de storage/Supabase. |
| 57 | `trg_enqueue_bulk_import_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:553 | Sí | Trigger de outbox para importación masiva. |

#### inventario/producción (58 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 58 | `fn_allocate_fefo_for_component(p_tenant UUID, p_location UUID, p_variant UUID, p_quantity NUMERIC)` | MANUFACTURING_PHASE3_ON_DEMAND.sql:25 | No | Auxiliar; 3 referencias SQL. |
| 59 | `fn_allocate_stock_fefo(p_tenant UUID, p_location UUID, p_variant UUID, p_qty_needed NUMERIC, OUT total_allocated NUMERIC, OUT has_sufficient_stock BO…` | ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:22 | No | Asigna lotes FEFO sin persistir el consumo. Ver R08. |
| 60 | `fn_apply_stock_delta(p_tenant UUID, p_location UUID, p_variant UUID, p_delta NUMERIC)` | FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:21; SpVistasFN.sql:44; full_migration.sql:431 | No | Delta de stock; convive con el modelo de lotes. Ver R07. |
| 61 | `fn_apply_stock_reservation_delta(p_tenant UUID, p_location UUID, p_variant UUID, p_delta NUMERIC)` | FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:137; PlanSepare.sql:43 | No | Ajusta la cantidad reservada del saldo. |
| 62 | `fn_calculate_bom_cost(p_tenant UUID, p_bom UUID, p_quantity NUMERIC)` | MANUFACTURING_PHASE2_SERVICE_BOM.sql:20 | No | Auxiliar; 2 referencias SQL. |
| 63 | `fn_complete_production(p_production_order UUID, p_quantity_produced NUMERIC, p_completed_by UUID, p_expiration_date DATE, p_physical_location TEXT)` | FIX_MANUFACTURED_COST_PRICE_AUTO_UPDATE.sql:31; FIX_PRODUCTION_COMPLETE.sql:248; MANUFACTURING_PHASE456_FINAL.sql:269 | No | Cierra orden, consume BOM y genera lote/output. Ver R11. |
| 64 | `fn_consume_batch_stock(p_tenant UUID, p_batch_id UUID, p_qty_to_consume NUMERIC, p_from_reserved BOOLEAN)` | ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:256 | No | Consume un lote con lock; descuenta on_hand/reserved. Ver R09. |
| 65 | `fn_consume_bom_components(p_tenant UUID, p_location UUID, p_bom UUID, p_quantity NUMERIC, p_source_type TEXT, p_source_id UUID, p_created_by UUID)` | FIX_CONSUME_BOM_REFERENCE_TYPE.sql:22; FIX_PRODUCTION_COMPLETE.sql:41; MANUFACTURING_PHASE3_ON_DEMAND.sql:98 | No | Consume componentes de BOM y calcula costos. Ver R10. |
| 66 | `fn_create_batch(p_tenant UUID, p_variant UUID, p_location UUID, p_batch_number TEXT, p_expiration_date DATE, p_quantity NUMERIC, p_source_id UUID, p_…` | web/FIX_MISSING_FN_CREATE_BATCH_COMPAT.sql:13 | No | Crea lote de inventario; usada por compras y manufactura. |
| 67 | `fn_create_default_variant(p_tenant_id UUID, p_product_id UUID, p_product_name TEXT, p_base_cost NUMERIC, p_base_price NUMERIC, p_unit_id UUID, p_trac…` | AUTO_CREATE_DEFAULT_VARIANT.sql:75 | No | Auxiliar; 1 referencias SQL. Escribe: product_variants. |
| 68 | `fn_create_production_order(p_tenant UUID, p_location UUID, p_bom UUID, p_quantity NUMERIC, p_created_by UUID, p_scheduled_start TIMESTAMPTZ, p_notes …` | MANUFACTURING_PHASE456_FINAL.sql:128 | No | Crea orden de producción con tenant/sede; valida BOM y cantidades. |
| 69 | `fn_detect_bom_circular_reference(p_bom UUID)` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:220 | No | Auxiliar; 1 referencias SQL. |
| 70 | `fn_expiration_report(p_tenant UUID, p_location UUID, p_days_ahead INT)` | ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql:338 | No | RPC cliente (1 sitios). |
| 71 | `fn_explode_bundle(p_tenant UUID, p_bundle_variant UUID, p_quantity NUMERIC)` | MANUFACTURING_PHASE456_FINAL.sql:34 | No | Auxiliar; 1 referencias SQL. |
| 72 | `fn_generate_batch_number(p_tenant UUID, p_variant UUID, p_location UUID, p_prefix TEXT)` | FIX_BATCH_NUMBER_BY_LOCATION.sql:22 | No | Numeración de lote por ubicación; requiere secuencia/unique portable. |
| 73 | `fn_generate_batch_number(p_tenant UUID, p_variant UUID, p_prefix TEXT)` | ADD_EXPIRATION_BATCHES_PHASE2.sql:283; FIX_BATCH_NUMBER_INTEGER_OVERFLOW.sql:10; FIX_INTEGER_OVERFLOW_COMPLETE.sql:43 | No | Numeración de lote por ubicación; requiere secuencia/unique portable. |
| 74 | `fn_generate_production_inventory()` | FIX_PRODUCTION_INVENTORY.sql:40 | No | Trigger de tabla. |
| 75 | `fn_get_active_bom(p_tenant UUID, p_variant UUID)` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:166 | No | Auxiliar; 5 referencias SQL. |
| 76 | `fn_get_bom_explosion(p_tenant UUID, p_bom UUID, p_quantity NUMERIC, p_current_depth INTEGER, p_max_depth INTEGER)` | MANUFACTURING_PHASE2_SERVICE_BOM.sql:235 | No | Auxiliar; 1 referencias SQL. |
| 77 | `fn_get_default_variant(p_tenant_id UUID, p_product_id UUID)` | AUTO_CREATE_DEFAULT_VARIANT.sql:246 | No | Sin consumidor estático; a verificar. |
| 78 | `fn_get_effective_inventory_behavior(p_tenant UUID, p_variant UUID)` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:24 | No | Resuelve comportamiento de inventario configurado por tenant. |
| 79 | `fn_get_effective_is_component(p_tenant UUID, p_variant UUID)` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:132 | No | Auxiliar; 1 referencias SQL. |
| 80 | `fn_get_effective_production_type(p_tenant UUID, p_variant UUID)` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:60 | No | Auxiliar; 5 referencias SQL. |
| 81 | `fn_get_expiration_config(p_tenant UUID, p_config_key TEXT)` | ADD_EXPIRATION_BATCHES_PHASE1.sql:128 | No | Sin consumidor estático; a verificar. |
| 82 | `fn_get_variant_manufacturing_info(p_tenant UUID, p_variant UUID)` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:414 | No | Sin consumidor estático; a verificar. |
| 83 | `fn_log_stock_alert(p_tenant uuid, p_location uuid, p_variant uuid)` | AddMinStock.sql:117 | Sí (sin search_path) | Sin consumidor estático; a verificar. Escribe: stock_alert_log. |
| 84 | `fn_next_production_order_number(p_tenant UUID, p_location UUID)` | MANUFACTURING_PHASE1_BASE_TABLES.sql:298 | No | Auxiliar; 1 referencias SQL. |
| 85 | `fn_refresh_expiration_alerts()` | ADD_EXPIRATION_ALERTS_REALTIME.sql:38 | No | Recalcula alertas de vencimiento; operación global de mantenimiento. |
| 86 | `fn_refresh_stock_alerts()` | FIX_STOCK_ALERTS_REALTIME.sql:154; SpVistasFN.sql:907 | Mixto | Recalcula alertas de stock mínimo. |
| 87 | `fn_refresh_stock_balances(p_concurrent BOOLEAN)` | ADD_EXPIRATION_BATCHES_PHASE2.sql:192 | No | Recalcula el snapshot de saldos; mantenimiento, no usar para decidir stock. |
| 88 | `fn_release_batch_reservation(p_tenant UUID, p_batch_id UUID, p_qty_to_release NUMERIC)` | ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:228 | No | Sin consumidor estático; a verificar. Escribe: inventory_batches. |
| 89 | `fn_reserve_batch_stock(p_tenant UUID, p_batch_id UUID, p_qty_to_reserve NUMERIC)` | ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:185 | No | Sin consumidor estático; a verificar. Escribe: inventory_batches. |
| 90 | `fn_start_production(p_production_order UUID, p_started_by UUID)` | MANUFACTURING_PHASE456_FINAL.sql:219 | No | Inicia orden de producción; validar estado y tenant. |
| 91 | `fn_update_average_cost(p_tenant uuid, p_location uuid, p_variant uuid, p_qty_incoming numeric(14,3), p_unit_cost_incoming numeric(14,2))` | SpVistasFN.sql:1320 | No | Costo promedio ponderado por entrada; trigger de inventario. |
| 92 | `fn_update_min_stock(p_tenant uuid, p_variant uuid, p_min_stock numeric)` | AddMinStock.sql:92 | Sí (sin search_path) | RPC cliente (1 sitios). Escribe: product_variants. |
| 93 | `fn_validate_bom_availability(p_tenant UUID, p_location UUID, p_bom UUID, p_quantity NUMERIC)` | MANUFACTURING_PHASE2_SERVICE_BOM.sql:134 | No | Auxiliar; 6 referencias SQL. |
| 94 | `fn_validate_bom_depth(p_tenant UUID, p_bom UUID, p_max_depth INTEGER)` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:279 | No | Auxiliar; 1 referencias SQL. |
| 95 | `fn_validate_bundle_availability(p_tenant UUID, p_location UUID, p_bundle_variant UUID, p_quantity NUMERIC)` | MANUFACTURING_PHASE456_FINAL.sql:69 | No | Sin consumidor estático; a verificar. |
| 96 | `fn_variant_requires_expiration(p_tenant UUID, p_variant UUID)` | ADD_EXPIRATION_BATCHES_PHASE1.sql:37; FIX_TRACK_EXPIRY_FUNCTION.sql:13; MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:94 | No | Regla de vencimiento por variante; auxiliar de ventas/compras. |
| 97 | `generate_production_order_number()` | FIX_PRODUCTION_ORDER_NUMBER.sql:41 | No | Trigger de tabla. |
| 98 | `sp_create_inventory_adjustment(p_tenant UUID, p_location UUID, p_variant UUID, p_quantity NUMERIC, p_unit_cost NUMERIC, p_is_increase BOOLEAN, p_crea…` | INVENTORY_PURCHASE_HARDENING.sql:103 | No | Ajuste de inventario con movimiento; usado por mobile. |
| 99 | `sp_create_transfer_request(p_tenant UUID, p_from_location UUID, p_to_location UUID, p_variant UUID, p_quantity NUMERIC, p_unit_cost NUMERIC, p_create…` | ADD_TRANSFER_IN_TRANSIT_CORE.sql:44; INVENTORY_PURCHASE_HARDENING.sql:255 | No | Solicitud de traslado entre sedes; no mueve stock hasta recepción. |
| 100 | `sp_receive_transfer_request(p_tenant UUID, p_transfer_id UUID, p_received_by UUID, p_note TEXT)` | ADD_TRANSFER_IN_TRANSIT_CORE.sql:134 | No | Recepción de traslado; aplica entrada/salida y diferencias. |
| 101 | `sync_bom_component_quantity()` | FIX_BOM_NAME_COLUMN.sql:84 | No | Trigger de tabla. |
| 102 | `sync_bom_name_code()` | FIX_BOM_NAME_COLUMN.sql:37 | No | Trigger de tabla. |
| 103 | `sync_production_line_quantity()` | FIX_BOM_NAME_COLUMN.sql:180 | No | Trigger de tabla. |
| 104 | `sync_production_order_audit_dates()` | FIX_BOM_NAME_COLUMN.sql:231 | No | Trigger de tabla. |
| 105 | `sync_production_order_dates()` | FIX_BOM_NAME_COLUMN.sql:132 | No | Trigger de tabla. |
| 106 | `trg_auto_create_default_variant_fn()` | AUTO_CREATE_DEFAULT_VARIANT.sql:146 | No | Trigger de tabla. |
| 107 | `trg_product_variants_alert()` | FIX_STOCK_ALERTS_REALTIME.sql:128; SpVistasFN.sql:1064 | Mixto | Trigger de tabla. |
| 108 | `trg_refresh_expiration_alerts()` | ADD_EXPIRATION_ALERTS_REALTIME.sql:97 | No | Trigger de tabla. |
| 109 | `trg_refresh_stock_after_batch_change()` | ADD_EXPIRATION_BATCHES_PHASE2.sql:214 | No | Trigger de tabla. |
| 110 | `trg_stock_balances_alert()` | FIX_STOCK_ALERTS_REALTIME.sql:62; SpVistasFN.sql:1011 | Mixto | Trigger de tabla. |
| 111 | `trg_update_average_cost()` | INVENTORY_PURCHASE_HARDENING.sql:73; SpVistasFN.sql:1419 | No | Trigger de tabla. |
| 112 | `trg_update_batch_timestamp()` | ADD_EXPIRATION_BATCHES_PHASE2.sql:130 | No | Trigger de tabla. |
| 113 | `trg_validate_batch_expiration()` | ADD_EXPIRATION_BATCHES_PHASE2.sql:94 | No | Trigger de tabla. |
| 114 | `trg_validate_bom_on_save()` | MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:350 | No | Trigger de tabla. |
| 115 | `trg_validate_expiration_config()` | ADD_EXPIRATION_BATCHES_PHASE1.sql:153 | No | Trigger de tabla. |

#### contabilidad (18 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 116 | `fn_accounting_close_period(p_tenant_id UUID, p_year INT, p_month INT, p_notes TEXT)` | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:486; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:234 | Sí (sin search_path) | Cierra periodo contable; validar bloqueo de asientos del rango. [usa auth.uid()/jwt]. |
| 117 | `fn_accounting_enqueue_event(p_tenant_id UUID, p_source_module TEXT, p_event_type TEXT, p_source_id UUID, p_payload JSONB)` | web/ADD_ACCOUNTING_CO_MODULE.sql:448 | Sí (sin search_path) | Encola evento contable; base del outbox. |
| 118 | `fn_accounting_get_withholding_summary(p_tenant_id UUID, p_date_from DATE, p_date_to DATE)` | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:360 | Sí (sin search_path) | Resumen de retenciones; lectura. [usa auth.uid()/jwt]. |
| 119 | `fn_accounting_is_period_closed(p_tenant_id UUID, p_entry_date DATE)` | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:342; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:93 | No | Predicado de periodo cerrado; auxiliar de posteo. |
| 120 | `fn_accounting_is_period_open(p_tenant_id UUID, p_entry_date DATE)` | web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:74 | No | Predicado de periodo abierto; auxiliar de posteo. |
| 121 | `fn_accounting_open_period(p_tenant_id UUID, p_year INT, p_month INT, p_notes TEXT)` | web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:105 | Sí (sin search_path) | Abre periodo contable; validar unicidad por tenant. [usa auth.uid()/jwt]. |
| 122 | `fn_accounting_post_entry(p_tenant_id UUID, p_entry_id UUID, p_posted_by UUID)` | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:628; web/ADD_ACCOUNTING_CO_MODULE.sql:378; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:337 | Sí (sin search_path) | SECURITY DEFINER; valida usuario/tenant/periodo y postea DRAFT. Ver R12. [usa auth.uid()/jwt]. |
| 123 | `fn_accounting_process_queue(p_tenant_id UUID, p_limit INT, p_only_event_id UUID)` | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:705; web/ADD_ACCOUNTING_QUEUE_PROCESSOR.sql:20; web/FIX_ACCOUNTING_QUEUE_PROCESSOR_SERVICE_ROLE.sql:6 | Sí (sin search_path) | SECURITY DEFINER; worker de cola contable con dedupe. Ver R13. [usa auth.uid()/jwt]. |
| 124 | `fn_accounting_process_queue_all_tenants(p_limit INT)` | web/ADD_SUPABASE_CRON_PIPELINES.sql:28 | Sí | Worker multi-tenant; revisar autorización y límites. [usa auth.uid()/jwt]. |
| 125 | `fn_accounting_reopen_period(p_tenant_id UUID, p_year INT, p_month INT, p_notes TEXT)` | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:569; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:215 | Sí (sin search_path) | Reabre periodo; validar autorización y asientos ya posteados. [usa auth.uid()/jwt]. |
| 126 | `fn_accounting_seed_chart_for_tenant(p_tenant_id UUID)` | web/ADD_ACCOUNTING_CO_MODULE.sql:160 | Sí (sin search_path) | Provisión de catálogo contable para un tenant. |
| 127 | `fn_accounting_seed_competitive_defaults_new_tenant()` | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:305 | No | Provisión inicial de configuración contable. |
| 128 | `fn_accounting_summary(p_tenant_id UUID)` | web/ADD_ACCOUNTING_CO_MODULE.sql:250 | Sí (sin search_path) | Resumen contable por rango; lectura. [usa auth.uid()/jwt]. |
| 129 | `fn_accounting_trg_purchases_enqueue()` | web/ADD_ACCOUNTING_CO_MODULE.sql:566 | No | Trigger: encola asiento contable de compra. |
| 130 | `fn_accounting_trg_sales_enqueue()` | web/ADD_ACCOUNTING_CO_MODULE.sql:539 | No | Trigger: encola asiento de venta. |
| 131 | `fn_accounting_trg_seed_chart_new_tenant()` | web/ADD_ACCOUNTING_CO_MODULE.sql:629 | No | Trigger de tabla. |
| 132 | `fn_accounting_trial_balance(p_tenant_id UUID, p_date_from DATE, p_date_to DATE)` | web/ADD_ACCOUNTING_CO_MODULE.sql:317 | Sí (sin search_path) | Balance de comprobación; lectura agregada. [usa auth.uid()/jwt]. |
| 133 | `fn_billing_period_end(p_period_start timestamptz, p_billing_interval text)` | ADD_TENANT_BILLING_RENEWALS.sql:7 | No | Auxiliar; 1 referencias SQL. |

#### notificaciones/outbox (31 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 134 | `fn_claim_online_order_email_notification(p_online_order_id UUID, p_notification_key TEXT)` | ADD_ONLINE_ORDER_EMAIL_IDEMPOTENCY_LOCK.sql:9 | Sí | Sin consumidor estático; a verificar. Escribe: online_orders. |
| 135 | `fn_complete_online_order_email_notification(p_online_order_id UUID, p_notification_key TEXT, p_notification JSONB)` | ADD_ONLINE_ORDER_EMAIL_IDEMPOTENCY_LOCK.sql:69 | Sí | Sin consumidor estático; a verificar. Escribe: online_orders. |
| 136 | `fn_deactivate_my_push_device(p_expo_push_token text)` | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:234; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:254 | Sí | SECURITY DEFINER; desactiva token push del usuario. |
| 137 | `fn_deactivate_my_push_device(p_push_token text, p_push_provider text)` | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:198; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:219 | Sí | SECURITY DEFINER; desactiva token push del usuario. |
| 138 | `fn_email_base_html(p_title TEXT, p_intro TEXT, p_body TEXT, p_action_url TEXT, p_action_label TEXT)` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:87 | No | Auxiliar; 11 referencias SQL. |
| 139 | `fn_emit_notification_event(p_tenant uuid, p_event_type text, p_severity text, p_title text, p_message text, p_payload jsonb, p_dedupe_key text, p_tar…` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:168 | Sí | SECURITY DEFINER; inserta evento y notificación in-app con dedupe. |
| 140 | `fn_enqueue_email_notification(p_tenant_id UUID, p_event_type TEXT, p_recipient_email TEXT, p_subject TEXT, p_html TEXT, p_text_body TEXT, p_payload J…` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:112 | Sí | SECURITY DEFINER; outbox de email con dedupe por clave. |
| 141 | `fn_enqueue_push_for_notification()` | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:245; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:265 | Sí | Trigger/worker que encola push a partir de notificación. |
| 142 | `fn_enqueue_subscription_status_emails(p_subscription_id uuid, p_tenant_id uuid, p_old_status text, p_new_status text, p_admin_email text)` | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:339 | Sí | Encola correos de cambio de suscripción. |
| 143 | `fn_list_my_notifications(p_limit integer, p_offset integer, p_only_unread boolean)` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:345 | Sí | SECURITY DEFINER; lista del usuario con limit/offset acotados. |
| 144 | `fn_mark_all_notifications_read()` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:410 | Sí | SECURITY DEFINER; marca todas las del usuario. |
| 145 | `fn_mark_notification_read(p_notification_id uuid)` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:388 | Sí | SECURITY DEFINER; marca una notificación del usuario. |
| 146 | `fn_normalize_email(p_email TEXT)` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:59 | No | Auxiliar; 4 referencias SQL. |
| 147 | `fn_notification_severity_rank(p_severity text)` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:22 | No | Auxiliar; 1 referencias SQL. |
| 148 | `fn_notify_from_system_alerts()` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:545 | Sí | SECURITY DEFINER; traduce alertas a notificaciones. |
| 149 | `fn_push_dispatcher_cron(p_limit INT)` | mobile/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql:28; web/ADD_SUPABASE_CRON_PIPELINES.sql:124 | Sí | SECURITY DEFINER; usa pg_cron/net/vault; no portable directo. [pg_cron, net/http, vault]. |
| 150 | `fn_set_my_notification_pref(p_event_type text, p_enabled boolean, p_min_severity text, p_mute_until timestamptz)` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:431 | Sí | SECURITY DEFINER; preferencias de notificación del usuario. |
| 151 | `fn_upsert_my_push_device(p_expo_push_token text, p_platform text, p_device_name text, p_app_version text, p_device_uid text)` | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:174; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:195 | Sí | SECURITY DEFINER; registra token push del usuario. |
| 152 | `fn_upsert_my_push_device(p_push_token text, p_push_provider text, p_platform text, p_device_name text, p_app_version text, p_device_uid text, p_expo_…` | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:83; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:104 | Sí | SECURITY DEFINER; registra token push del usuario. |
| 153 | `trg_enqueue_credit_movement_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:600 | Sí | Trigger de outbox para movimientos de crédito. |
| 154 | `trg_enqueue_layaway_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:361 | Sí | Trigger de outbox para separado. |
| 155 | `trg_enqueue_layaway_payment_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:407 | Sí | Trigger de outbox para pago de separado. |
| 156 | `trg_enqueue_online_order_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:174 | Sí | Trigger de outbox para pedido online. |
| 157 | `trg_enqueue_operational_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:459 | Sí | Trigger de outbox operativo. |
| 158 | `trg_enqueue_sale_customer_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:261 | Sí | Trigger de outbox para venta. |
| 159 | `trg_enqueue_sale_return_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:312 | Sí | Trigger de outbox para devolución. |
| 160 | `trg_enqueue_subscription_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:722 | Sí | Trigger de outbox de suscripción. |
| 161 | `trg_enqueue_supplier_payable_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:651 | Sí | Trigger de outbox para CxP. |
| 162 | `trg_enqueue_user_created_email()` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:518 | Sí | Trigger de outbox de alta de usuario. |
| 163 | `trg_touch_user_notification_prefs()` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:151 | No | Trigger de tabla. |
| 164 | `trg_touch_user_push_devices()` | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:36 | No | Trigger de tabla. |

### B.3 Funciones auxiliares, identidad y otras

Misma estructura, para completar el inventario de `CREATE FUNCTION`. Las funciones de identidad/autorización son especialmente relevantes para la Tarea 4 aunque no sean RPC de negocio.

#### identidad/tenancy (55 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 165 | `change_user_password(p_auth_user_id uuid, p_new_password text)` | UserFunctions.sql:100 | Sí (sin search_path) | Cambio de contraseña; revisar algoritmo de hash y no depender de auth de Supabase. [usa auth.uid()/jwt]. |
| 166 | `create_auth_user(p_email text, p_password text, p_full_name text, p_role_ids uuid[], p_is_active boolean)` | FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:5; UserFunctions.sql:6 | Sí (sin search_path) | Alta de usuario en auth; migrar hash/credenciales fuera de SQL y revisar privilegios. [usa auth.uid()/jwt]. |
| 167 | `fn_alert_location_access(p_data JSONB)` | ADD_CORE_RLS_HARDENING_V2.sql:18 | No | Sin consumidor estático; a verificar. |
| 168 | `fn_apply_role_menu_templates(p_tenant_id UUID)` | ROLES_MENUS_SYSTEM.sql:634 | Sí (sin search_path) | Auxiliar; 1 referencias SQL. Escribe: role_menus. |
| 169 | `fn_attach_subscription_signup_preference(p_signup_id UUID, p_preference_id TEXT, p_payment_payload JSONB)` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:381 | Sí | Sin consumidor estático; a verificar. Escribe: public_subscription_signups. |
| 170 | `fn_can_access_location(p_location_id uuid)` | ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql:38 | Sí (sin search_path) | Autorización por sede; mover a contexto de aplicación. |
| 171 | `fn_change_subscription_plan(p_subscription_id uuid, p_new_plan_price_id uuid, p_apply_from text)` | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:6 | Sí | RPC cliente (1 sitios). Escribe: tenant_subscription_events, tenant_subscriptions. [usa auth.uid()/jwt]. |
| 172 | `fn_change_subscription_plan_prorated(p_subscription_id uuid, p_new_plan_price_id uuid)` | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:639 | Sí | RPC cliente (1 sitios). Escribe: tenant_invoices, tenant_subscription_events, tenant_subscriptions. [usa auth.uid()/jwt]. |
| 173 | `fn_create_public_subscription_signup(p_plan_price_id UUID, p_business_name TEXT, p_admin_full_name TEXT, p_admin_email TEXT, p_phone TEXT, p_legal_na…` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:226 | Sí | Sin consumidor estático; a verificar. Escribe: public_subscription_signups. |
| 174 | `fn_create_tenant(p_tenant_data JSONB, p_admin_data JSONB)` | UPDATE_CREATE_TENANT_DEFAULTS.sql:31 | Sí (sin search_path) | Alta de tenant y provisión inicial; operación de superadmin. |
| 175 | `fn_create_tenant(p_tenant_data jsonb, p_admin_data jsonb, p_copy_from_tenant_id uuid)` | CreateTenantSP.sql:17; SECURE_TENANT_MANAGEMENT.sql:38 | Sí (sin search_path) | Alta de tenant y provisión inicial; operación de superadmin. |
| 176 | `fn_create_tenant_subscription_renewal_invoice(p_subscription_id uuid, p_due_at timestamptz)` | ADD_TENANT_BILLING_RENEWALS.sql:22 | Sí | Sin consumidor estático; a verificar. Escribe: tenant_invoices, tenant_subscription_events, tenant_subscription_periods. [usa auth.uid()/jwt]. |
| 177 | `fn_current_user_tenant_id()` | mobile/ADD_PRODUCT_MEDIA_PHOTOS.sql:19; SETUP_DATAIMPORT_BUCKET.sql:16 | No | Resuelve tenant desde auth.uid(); reemplazar por contexto de sesión. [usa auth.uid()/jwt]. |
| 178 | `fn_enforce_tenant_invoice_limit()` | ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql:155 | No | Trigger de tabla. |
| 179 | `fn_enforce_tenant_plan_limit_on_active_row()` | ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql:85 | No | Trigger de tabla. [SQL dinámico]. |
| 180 | `fn_enqueue_async_job(p_tenant_id UUID, p_queue TEXT, p_job_type TEXT, p_payload JSONB, p_dedupe_key TEXT, p_priority INTEGER, p_run_after TIMESTAMPTZ…` | ADD_ASYNC_JOB_QUEUE.sql:141 | No | Encola job asíncrono; revisar dedupe. [usa auth.uid()/jwt]. |
| 181 | `fn_get_my_tenant_billing_summary()` | ADD_TENANT_BILLING_MONETIZATION.sql:1113 | Sí | RPC cliente (1 sitios). |
| 182 | `fn_get_public_subscription_signup_status(p_signup_id UUID)` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:410 | Sí | RPC cliente (1 sitios). |
| 183 | `fn_get_tenant_billing_limit_usage(p_tenant_id uuid)` | ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql:21 | Sí | RPC cliente (2 sitios). |
| 184 | `fn_get_tenant_billing_limit_value(p_tenant_id uuid, p_limit_code text)` | ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql:5 | Sí | Auxiliar; 2 referencias SQL. |
| 185 | `fn_get_tenant_billing_summary(p_tenant_id uuid)` | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:138 | Sí | RPC cliente (1 sitios). |
| 186 | `fn_get_tenant_payment_history(p_tenant_id uuid, p_limit integer)` | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:280 | Sí | RPC cliente (1 sitios). [usa auth.uid()/jwt]. |
| 187 | `fn_get_tenant_template_json(p_tenant_id uuid)` | CreateTenantSP.sql:377 | Sí (sin search_path) | RPC cliente (1 sitios). |
| 188 | `fn_get_user_menus(p_auth_user_id UUID)` | ROLES_MENUS_SYSTEM.sql:480 | Sí (sin search_path) | Menús por usuario/rol; lectura dependiente de auth. |
| 189 | `fn_init_tenant_roles(p_tenant_id uuid)` | InitPermissions.sql:73 | No | Sin consumidor estático; a verificar. Escribe: role_permissions, roles. |
| 190 | `fn_is_admin_or_manager()` | ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql:6 | Sí (sin search_path) | Auxiliar; 1 referencias SQL. [usa auth.uid()/jwt]. |
| 191 | `fn_is_super_admin()` | FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:2; SECURE_TENANT_MANAGEMENT.sql:9 | Sí (sin search_path) | Autorización de superadmin basada en claims/roles. [usa auth.uid()/jwt]. |
| 192 | `fn_list_public_subscription_plans()` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:166 | Sí | RPC público de planes; lectura. |
| 193 | `fn_log_public_subscription_signup_event(p_signup_id UUID, p_event_type TEXT, p_event_source TEXT, p_event_status TEXT, p_message TEXT, p_payload JSON…` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:113 | Sí | Sin consumidor estático; a verificar. Escribe: public_subscription_signup_events. |
| 194 | `fn_mark_subscription_signup_payment(p_signup_id UUID, p_payment_id TEXT, p_gateway_status TEXT, p_status_detail TEXT, p_payment_payload JSONB)` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:440 | Sí | Sin consumidor estático; a verificar. Escribe: public_subscription_signups. |
| 195 | `fn_mark_tenant_subscription_renewal_paid(p_invoice_id uuid, p_provider_payment_id text, p_provider_status text, p_payment_payload jsonb)` | ADD_TENANT_BILLING_RENEWALS.sql:181 | Sí | Sin consumidor estático; a verificar. Escribe: tenant_invoices, tenant_payments, tenant_subscription_events. |
| 196 | `fn_process_tenant_subscription_expirations(p_limit integer)` | ADD_TENANT_BILLING_RENEWALS.sql:311; ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:433 | Sí | Sin consumidor estático; a verificar. Escribe: tenant_subscription_events, tenant_subscriptions. [usa auth.uid()/jwt]. |
| 197 | `fn_provision_public_subscription_signup(p_signup_id UUID, p_auth_user_id UUID)` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:485 | Sí | Sin consumidor estático; a verificar. Escribe: public_subscription_signups, tenant_subscription_events, tenant_subscription_periods. |
| 198 | `fn_superadmin_assign_tenant_plan(p_tenant_id uuid, p_plan_price_id uuid, p_status text, p_start_at timestamptz, p_trial_end_at timestamptz, p_current…` | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:230 | Sí | RPC cliente (1 sitios). Escribe: tenant_subscription_events, tenant_subscription_periods, tenant_subscriptions. |
| 199 | `fn_superadmin_create_role_for_all_tenants(p_role_name TEXT, p_permission_ids UUID[], p_menu_codes TEXT[])` | ROLES_MENUS_SYSTEM.sql:327 | Sí (sin search_path) | RPC cliente (2 sitios). Escribe: role_menus, role_permissions, roles. |
| 200 | `fn_superadmin_list_all_payments(p_limit integer, p_status text, p_tenant_search text)` | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:774 | Sí | RPC cliente (1 sitios). [usa auth.uid()/jwt]. |
| 201 | `fn_superadmin_list_public_subscription_signup_events(p_signup_id UUID)` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:755 | Sí | RPC cliente (1 sitios). |
| 202 | `fn_superadmin_list_public_subscription_signups(p_limit INTEGER)` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:658 | Sí | RPC cliente (1 sitios). |
| 203 | `fn_superadmin_list_tenant_billing_summary()` | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:166 | Sí | RPC cliente (1 sitios). |
| 204 | `fn_superadmin_list_tenants()` | web/ADD_SUPERADMIN_TENANTS_LIST_RPC.sql:6 | Sí | RPC cliente (1 sitios). [usa auth.uid()/jwt]. |
| 205 | `fn_superadmin_record_manual_payment(p_invoice_id uuid, p_amount numeric, p_currency_code text, p_provider text, p_provider_reference text, p_note tex…` | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:152 | Sí | RPC cliente (1 sitios). Escribe: tenant_invoices, tenant_payments, tenant_subscription_events. [usa auth.uid()/jwt]. |
| 206 | `fn_superadmin_sync_menus_to_role_all_tenants(p_role_name TEXT, p_menu_codes TEXT[])` | ROLES_MENUS_SYSTEM.sql:404 | Sí (sin search_path) | RPC cliente (2 sitios). Escribe: role_menu_templates, role_menus. |
| 207 | `fn_superadmin_update_subscription_status(p_subscription_id uuid, p_status text, p_grace_end_at timestamptz, p_note text)` | web/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql:418 | Sí | RPC cliente (1 sitios). Escribe: tenant_subscription_events, tenant_subscriptions. |
| 208 | `fn_tenant_gateway_credentials_touch_updated_at()` | ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql:28 | No | Trigger de tabla. |
| 209 | `fn_user_assigned_locations()` | ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql:22 | Sí (sin search_path) | Auxiliar; 1 referencias SQL. [usa auth.uid()/jwt]. |
| 210 | `fn_user_assigned_locations_for(p_user_id uuid)` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:64 | Sí (sin search_path) | Auxiliar; 1 referencias SQL. |
| 211 | `fn_user_is_admin_or_manager(p_user_id uuid)` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:34 | Sí (sin search_path) | Auxiliar; 1 referencias SQL. |
| 212 | `get_current_user_app_user_id()` | mobile/ADD_IN_APP_NOTIFICATION_CENTER.sql:10 | Sí (sin search_path) | Resuelve usuario de aplicación desde auth.uid(). [usa auth.uid()/jwt]. |
| 213 | `get_current_user_tenant_id()` | ADD_TENANT_BILLING_MONETIZATION.sql:486; FIX_RLS_CASHIER_PRIVACY.sql:51; RLS_Security.sql:6 | Sí (sin search_path) | Resuelve tenant desde auth.uid(); reemplazar por contexto de sesión. [usa auth.uid()/jwt, SQL dinámico]. |
| 214 | `get_user_assigned_locations()` | FIX_RLS_CASHIER_RESTRICTIONS.sql:12 | Sí (sin search_path) | Sin consumidor estático; a verificar. [usa auth.uid()/jwt]. |
| 215 | `get_users_with_roles()` | UserFunctions.sql:138 | Sí (sin search_path) | Sin consumidor estático; a verificar. [usa auth.uid()/jwt]. |
| 216 | `has_permission(permission_code text)` | ADD_TENANT_BILLING_MONETIZATION.sql:560; RLS_Security.sql:16 | Sí (sin search_path) | Autorización en SQL por permisos; mover a Go o a contexto firmado. [usa auth.uid()/jwt]. |
| 217 | `is_user_admin()` | FIX_RLS_CASHIER_PRIVACY.sql:19; FIX_RLS_CASHIER_RESTRICTIONS.sql:30 | Sí (sin search_path) | Auxiliar; 4 referencias SQL. [usa auth.uid()/jwt]. |
| 218 | `trg_public_subscription_signups_updated_at()` | ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql:56 | No | Trigger de tabla. |
| 219 | `trg_touch_billing_updated_at()` | ADD_TENANT_BILLING_MONETIZATION.sql:418 | No | Trigger de tabla. |

#### tienda online/público (17 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 220 | `fn_attach_online_gateway_preference(p_online_order_id UUID, p_preference_id TEXT, p_init_point TEXT, p_sandbox_init_point TEXT, p_external_reference …` | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:412 | Sí | Sin consumidor estático; a verificar. Escribe: online_orders. |
| 221 | `fn_confirm_online_manual_order(p_online_order_id UUID, p_payment_reference TEXT, p_payment_note TEXT)` | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:30; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:446; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:460 | Sí | Confirma pedido online; validar autorización y pago. [usa auth.uid()/jwt]. |
| 222 | `fn_create_online_manual_order(p_slug TEXT, p_customer_name TEXT, p_customer_email TEXT, p_customer_phone TEXT, p_customer_note TEXT, p_payment_refere…` | FIX_ONLINE_STORE_SP_CREATE_SALE_SIGNATURE.sql:6 | Sí | Pedido online manual; tenant desde el slug; 8 definiciones a consolidar. |
| 223 | `fn_create_online_manual_order(p_slug TEXT, p_customer_name TEXT, p_customer_email TEXT, p_customer_phone TEXT, p_customer_note TEXT, p_payment_refere…` | ADD_ONLINE_STORE_MVP.sql:650; FIX_ONLINE_STORE_CHECKOUT_STOCK_LOCK.sql:7; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:196 | Sí | Pedido online manual; tenant desde el slug; 8 definiciones a consolidar. |
| 224 | `fn_create_online_manual_order(p_slug TEXT, p_customer_name TEXT, p_customer_email TEXT, p_customer_phone TEXT, p_customer_note TEXT, p_payment_refere…` | ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:163; ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:94 | Sí | Pedido online manual; tenant desde el slug; 8 definiciones a consolidar. |
| 225 | `fn_create_online_manual_order(p_slug TEXT, p_customer_name TEXT, p_customer_email TEXT, p_customer_phone TEXT, p_customer_note TEXT, p_payment_refere…` | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:93; ONLINE_STORE_ADDRESS_AND_STATUS.sql:17 | Sí | Pedido online manual; tenant desde el slug; 8 definiciones a consolidar. |
| 226 | `fn_get_public_online_store(p_slug TEXT)` | ADD_ONLINE_STORE_MVP.sql:525; ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:48 | Sí | RPC público de tienda; sin tenant de sesión. |
| 227 | `fn_get_public_order_status(p_order_id UUID)` | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:770; ONLINE_STORE_ADDRESS_AND_STATUS.sql:304 | Sí | RPC público por token; limitar datos expuestos. |
| 228 | `fn_list_public_online_store_products(p_slug TEXT)` | ADD_ONLINE_STORE_MVP.sql:577; ADD_ONLINE_STORE_PUBLIC_CATEGORIES.sql:8; ADD_ONLINE_STORE_PUBLIC_IMAGES.sql:13 | Sí | RPC público de catálogo; paginación y filtros a revisar. |
| 229 | `fn_online_order_actor_name()` | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:16 | Sí | Auxiliar; 2 referencias SQL. [usa auth.uid()/jwt]. |
| 230 | `fn_online_store_available_qty(p_store_id UUID, p_variant_id UUID)` | ADD_ONLINE_STORE_MVP.sql:460; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:83 | No | Disponibilidad online; no confundir con stock físico. |
| 231 | `fn_online_store_reserved_qty(p_store_id UUID, p_variant_id UUID)` | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:17; ADD_ONLINE_STORE_MVP.sql:442; FIX_ONLINE_STOCK_TIMEOUT_CLEANUP.sql:114; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:65 | No | Cantidad reservada de tienda online; lectura. |
| 232 | `fn_online_store_slugify(p_value TEXT)` | ADD_ONLINE_STORE_MVP.sql:134 | No | Auxiliar; 13 referencias SQL. |
| 233 | `fn_online_store_touch_updated_at()` | ADD_ONLINE_STORE_MVP.sql:124 | No | Trigger de tabla. |
| 234 | `fn_reject_online_manual_order(p_online_order_id UUID, p_reason TEXT)` | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:196; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:599; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:611 | Sí | Rechaza pedido online; validar autorización y motivo. [usa auth.uid()/jwt]. |
| 235 | `fn_release_expired_online_orders(p_limit INTEGER)` | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:36; FIX_ONLINE_STOCK_TIMEOUT_CLEANUP.sql:29 | Sí | Auxiliar; 1 referencias SQL. Escribe: loop, online_order_reservations, online_orders. |
| 236 | `fn_sync_online_gateway_payment(p_online_order_id UUID, p_payment_id TEXT, p_gateway_status TEXT, p_payment_status_detail TEXT, p_gateway_payload JSON…` | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:487; FIX_ONLINE_STORE_GATEWAY_SYNC_LOCK.sql:7 | Sí | Sin consumidor estático; a verificar. Escribe: of, online_order_reservations, online_orders. |

#### soporte/otros (22 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 237 | `check_rls_enabled()` | CREATE_RLS_CHECK_FUNCTION.sql:7 | Sí (sin search_path) | Sin consumidor estático; a verificar. |
| 238 | `fn_async_jobs_touch_updated_at()` | ADD_ASYNC_JOB_QUEUE.sql:125 | No | Trigger de tabla. |
| 239 | `fn_audit_ondemand_costs()` | MANUFACTURING_PHASE456_FINAL.sql:391 | No | Sin consumidor estático; a verificar. |
| 240 | `fn_claim_async_jobs(p_queue TEXT, p_worker_id TEXT, p_limit INTEGER, p_lock_seconds INTEGER)` | ADD_ASYNC_JOB_QUEUE.sql:219 | No | Claim con FOR UPDATE SKIP LOCKED. Ver R14. |
| 241 | `fn_complete_async_job(p_job_id UUID, p_worker_id TEXT, p_result JSONB, p_completed_with_warnings BOOLEAN)` | ADD_ASYNC_JOB_QUEUE.sql:258 | No | Completa job; no valida ownership/lease en la versión revisada. Ver R15. |
| 242 | `fn_delete_third_party(p_id UUID, p_tenant_id UUID)` | FIX_THIRD_PARTIES_RPC.sql:106 | Sí | RPC cliente (2 sitios). Escribe: third_parties. |
| 243 | `fn_enqueue_pre_expiry_reminders(p_limit integer)` | ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:536 | Sí | Sin consumidor estático; a verificar. |
| 244 | `fn_escape_html(p_value TEXT)` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:71 | No | Utilidad de escape; no es lógica de negocio. |
| 245 | `fn_fail_async_job(p_job_id UUID, p_worker_id TEXT, p_error JSONB, p_retryable BOOLEAN)` | ADD_ASYNC_JOB_QUEUE.sql:312 | No | Fallo con backoff y transición de estado. Ver R16. |
| 246 | `fn_fix_migration_discrepancies()` | ADD_EXPIRATION_BATCHES_PHASE2_MIGRATE.sql:177 | No | Sin consumidor estático; a verificar. |
| 247 | `fn_format_cop(p_value NUMERIC)` | ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql:79 | No | Formato de moneda COP; no usar en persistencia. |
| 248 | `fn_generate_unique_sku(p_tenant_id UUID, p_product_name TEXT)` | AUTO_CREATE_DEFAULT_VARIANT.sql:18 | No | Auxiliar; 1 referencias SQL. |
| 249 | `fn_get_unit_by_code(p_tenant_id UUID, p_code VARCHAR)` | CREATE_UNITS_OF_MEASURE.sql:304 | No | RPC cliente (1 sitios). |
| 250 | `fn_handle_ondemand_line(p_tenant UUID, p_location UUID, p_sale_id UUID, p_line_id UUID, p_variant UUID, p_quantity NUMERIC, p_created_by UUID)` | MANUFACTURING_PHASE3_ON_DEMAND.sql:289 | No | Sin consumidor estático; a verificar. Escribe: sale_lines. |
| 251 | `fn_next_invoice_consecutive(p_resolution_id UUID)` | ADD_ELECTRONIC_INVOICING.sql:162 | Sí (sin search_path) | Sin consumidor estático; a verificar. Escribe: invoice_resolutions. |
| 252 | `fn_product_media_cover_guard()` | mobile/ADD_PRODUCT_MEDIA_PHOTOS.sql:82 | No | Trigger de tabla. |
| 253 | `fn_product_media_promote_cover_after_delete()` | mobile/ADD_PRODUCT_MEDIA_PHOTOS.sql:120 | No | Trigger de tabla. |
| 254 | `fn_top_at_risk_products(p_tenant UUID, p_location UUID, p_limit INT)` | ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql:387 | No | RPC cliente (2 sitios). |
| 255 | `fn_top_manufactured_products_by_margin(p_tenant_id UUID, p_limit INT)` | MANUFACTURING_PRODUCTION_COST_REPORT.sql:297 | No | RPC cliente (1 sitios). |
| 256 | `fn_update_units_timestamp()` | CREATE_UNITS_OF_MEASURE.sql:340 | No | Trigger de tabla. |
| 257 | `fn_upsert_third_party(p_data JSONB)` | ADD_FE_COMPLEMENTARY.sql:102; FIX_THIRD_PARTIES_RPC.sql:9 | Sí | Upsert de tercero desde JSON; el tenant viaja dentro de p_data (a verificar). |
| 258 | `sp_audit_rls_and_optionally_apply(p_apply boolean)` | ADD_RLS_GLOBAL_AUDIT_AND_AUTOFIX.sql:46 | No | Sin consumidor estático; a verificar. Escribe: using. [SQL dinámico]. |

#### alertas (3 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 259 | `fn_clear_online_order_alert(p_online_order_id UUID)` | ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:28 | Sí | Auxiliar; 4 referencias SQL. Escribe: system_alerts. |
| 260 | `fn_refresh_all_alerts()` | ADD_CUSTOMER_RECEIVABLE_ALERTS_REALTIME.sql:100; ADD_EXPIRATION_ALERTS_REALTIME.sql:181; ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql:116 | No | Recalcula todas las alertas; operación global de mantenimiento. |
| 261 | `fn_upsert_online_order_alert(p_online_order_id UUID)` | ONLINE_ORDER_MOBILE_NOTIFICATIONS.sql:8; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:46 | Sí | Auxiliar; 2 referencias SQL. Escribe: system_alerts. |

#### IA/telemetría (2 firmas)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 262 | `fn_ai_telemetry_cost_summary(p_tenant_id UUID, p_window_days INTEGER)` | ADD_AI_TELEMETRY_COST_SUMMARY_FN.sql:8 | No | RPC cliente (1 sitios). |
| 263 | `trg_touch_chat_order_ai_cache()` | ADD_CHAT_ORDER_AI_CACHE.sql:26 | No | Trigger de tabla. |

#### reportes (1 firma)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 264 | `fn_reports_dashboard_summary(p_tenant_id UUID, p_location_id UUID)` | web/ADD_REPORTS_DASHBOARD_SUMMARY_RPC.sql:1 | Sí | RPC cliente (1 sitios). [usa auth.uid()/jwt]. |

#### mantenimiento (1 firma)

| # | Función (firma corta) | Definiciones | SD | Uso / nota |
|---:|---|---|---|---|
| 265 | `fn_touch_product_media_updated_at()` | mobile/ADD_PRODUCT_MEDIA_PHOTOS.sql:66 | No | Trigger de tabla. |

### B.4 Redefiniciones y sobrecargas

**60 nombres** acumulan más de una definición. La tabla lista todas las ubicaciones para que la Tarea 5 elija una versión consolidada; no se debe ejecutar el directorio completo por orden alfabético.

| Función | # defs | Firmas | Ubicaciones (archivo:línea) |
|---|---:|---:|---|
| `fn_create_online_manual_order` | 8 | 4 | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:93; ADD_ONLINE_STORE_MVP.sql:650; FIX_ONLINE_STORE_CHECKOUT_STOCK_LOCK.sql:7; FIX_ONLINE_STORE_SP_CREATE_SALE_SIGNATURE.sql:6; ONLINE_STORE_ADDRESS_AND_STATUS.sql:17; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:163; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:196; ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:94 |
| `sp_create_sale` | 7 | 2 | ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql:43; FIX_SALE_ROUNDING.sql:85; MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql:26; SpVistasFN.sql:124; UPDATE_SALE_SP_DISCOUNT_TYPE.sql:7; UPDATE_SALE_SP_PRICE_INCLUDES_TAX.sql:8; UPDATE_SP_CREATE_SALE_FE.sql:37 |
| `sp_create_purchase` | 5 | 1 | ADD_PURCHASES_TABLE.sql:34; FIX_BATCH_NUMBER_BY_LOCATION.sql:115; INTEGRATE_BATCHES_WITH_PURCHASES.sql:15; SpVistasFN.sql:1460; web/FIX_SP_CREATE_PURCHASE_SKIP_STOCK_DELTA_WHEN_BATCH.sql:15 |
| `fn_deactivate_my_push_device` | 4 | 2 | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:198; mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:234; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:219; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:254 |
| `fn_generate_batch_number` | 4 | 2 | ADD_EXPIRATION_BATCHES_PHASE2.sql:283; FIX_BATCH_NUMBER_BY_LOCATION.sql:22; FIX_BATCH_NUMBER_INTEGER_OVERFLOW.sql:10; FIX_INTEGER_OVERFLOW_COMPLETE.sql:43 |
| `fn_online_store_create_sale` | 4 | 1 | FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION.sql:12; FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION_V2.sql:8; FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION_V3.sql:8; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:147 |
| `fn_online_store_reserved_qty` | 4 | 1 | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:17; ADD_ONLINE_STORE_MVP.sql:442; FIX_ONLINE_STOCK_TIMEOUT_CLEANUP.sql:114; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:65 |
| `fn_upsert_my_push_device` | 4 | 2 | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:83; mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:174; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:104; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:195 |
| `sp_create_layaway` | 4 | 1 | LAYAWAY_OPERATIONAL_HARDENING.sql:14; PlanSepare.sql:227; UPDATE_LAYAWAY_SP_DISCOUNT_TYPE.sql:7; UPDATE_LAYAWAY_SP_PRICE_INCLUDES_TAX.sql:8 |
| `fn_accounting_post_entry` | 3 | 1 | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:628; web/ADD_ACCOUNTING_CO_MODULE.sql:378; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:337 |
| `fn_accounting_process_queue` | 3 | 1 | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:705; web/ADD_ACCOUNTING_QUEUE_PROCESSOR.sql:20; web/FIX_ACCOUNTING_QUEUE_PROCESSOR_SERVICE_ROLE.sql:6 |
| `fn_apply_stock_delta` | 3 | 1 | FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:21; SpVistasFN.sql:44; full_migration.sql:431 |
| `fn_complete_production` | 3 | 1 | FIX_MANUFACTURED_COST_PRICE_AUTO_UPDATE.sql:31; FIX_PRODUCTION_COMPLETE.sql:248; MANUFACTURING_PHASE456_FINAL.sql:269 |
| `fn_confirm_online_manual_order` | 3 | 1 | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:30; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:446; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:460 |
| `fn_consume_bom_components` | 3 | 1 | FIX_CONSUME_BOM_REFERENCE_TYPE.sql:22; FIX_PRODUCTION_COMPLETE.sql:41; MANUFACTURING_PHASE3_ON_DEMAND.sql:98 |
| `fn_create_tenant` | 3 | 2 | CreateTenantSP.sql:17; SECURE_TENANT_MANAGEMENT.sql:38; UPDATE_CREATE_TENANT_DEFAULTS.sql:31 |
| `fn_get_open_cash_session_for_user` | 3 | 1 | AsignacionCajerosCaja.sql:73; EJECUTAR_MIGRACION_CAJAS.sql:64; SpVistasFN.sql:1151 |
| `fn_get_tax_rate_for_variant` | 3 | 1 | FIX_TAX_FUNCTION_PERMISSIONS.sql:11; SpVistasFN.sql:65; full_migration.sql:450 |
| `fn_list_public_online_store_products` | 3 | 1 | ADD_ONLINE_STORE_MVP.sql:577; ADD_ONLINE_STORE_PUBLIC_CATEGORIES.sql:8; ADD_ONLINE_STORE_PUBLIC_IMAGES.sql:13 |
| `fn_next_sale_number` | 3 | 1 | SpVistasFN.sql:20; full_migration.sql:409; web/FIX_SALE_COUNTERS_RLS.sql:17 |
| `fn_pos_home_context` | 3 | 1 | AsignacionCajerosCaja.sql:236; EJECUTAR_MIGRACION_CAJAS.sql:202; SpVistasFN.sql:1279 |
| `fn_refresh_all_alerts` | 3 | 1 | ADD_CUSTOMER_RECEIVABLE_ALERTS_REALTIME.sql:100; ADD_EXPIRATION_ALERTS_REALTIME.sql:181; ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql:116 |
| `fn_reject_online_manual_order` | 3 | 1 | ADD_ONLINE_STORE_AUDIT_HISTORY.sql:196; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:599; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:611 |
| `fn_user_can_use_cash_register` | 3 | 1 | AsignacionCajerosCaja.sql:55; EJECUTAR_MIGRACION_CAJAS.sql:47; SpVistasFN.sql:1133 |
| `fn_variant_requires_expiration` | 3 | 1 | ADD_EXPIRATION_BATCHES_PHASE1.sql:37; FIX_TRACK_EXPIRY_FUNCTION.sql:13; MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql:94 |
| `get_current_user_tenant_id` | 3 | 1 | ADD_TENANT_BILLING_MONETIZATION.sql:486; FIX_RLS_CASHIER_PRIVACY.sql:51; RLS_Security.sql:6 |
| `sp_assign_cash_register_to_user` | 3 | 1 | AsignacionCajerosCaja.sql:115; EJECUTAR_MIGRACION_CAJAS.sql:102; SpVistasFN.sql:1185 |
| `sp_close_cash_session_secure` | 3 | 1 | AsignacionCajerosCaja.sql:201; EJECUTAR_MIGRACION_CAJAS.sql:174; SpVistasFN.sql:1253 |
| `sp_create_sale_idempotent` | 3 | 2 | mobile/ADD_IDEMPOTENT_MOBILE_SALES.sql:27; mobile/ADD_POS_MANUAL_SALE_DATETIME_IDEMPOTENT.sql:14; mobile/FIX_IDEMPOTENT_SALE_ERROR_MESSAGES.sql:14 |
| `sp_open_cash_session` | 3 | 1 | AsignacionCajerosCaja.sql:152; EJECUTAR_MIGRACION_CAJAS.sql:131; SpVistasFN.sql:1212 |
| `create_auth_user` | 2 | 1 | FIX_CREATE_AUTH_USER_RPC_SCHEMA_CACHE.sql:5; UserFunctions.sql:6 |
| `fn_accounting_close_period` | 2 | 1 | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:486; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:234 |
| `fn_accounting_is_period_closed` | 2 | 1 | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:342; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:93 |
| `fn_accounting_reopen_period` | 2 | 1 | web/ADD_ACCOUNTING_COMPETITIVE_CORE.sql:569; web/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql:215 |
| `fn_apply_stock_reservation_delta` | 2 | 1 | FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql:137; PlanSepare.sql:43 |
| `fn_current_user_tenant_id` | 2 | 1 | mobile/ADD_PRODUCT_MEDIA_PHOTOS.sql:19; SETUP_DATAIMPORT_BUCKET.sql:16 |
| `fn_enqueue_push_for_notification` | 2 | 1 | mobile/ADD_PUSH_NOTIFICATIONS_EXPO.sql:245; mobile/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql:265 |
| `fn_get_public_online_store` | 2 | 1 | ADD_ONLINE_STORE_MVP.sql:525; ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:48 |
| `fn_get_public_order_status` | 2 | 1 | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:770; ONLINE_STORE_ADDRESS_AND_STATUS.sql:304 |
| `fn_get_purchase_suggestions` | 2 | 1 | PURCHASE_ANALYSIS_VIEWS.sql:114; SpVistasFN.sql:1658 |
| `fn_is_super_admin` | 2 | 1 | FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql:2; SECURE_TENANT_MANAGEMENT.sql:9 |
| `fn_online_store_available_qty` | 2 | 1 | ADD_ONLINE_STORE_MVP.sql:460; ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql:83 |
| `fn_process_tenant_subscription_expirations` | 2 | 1 | ADD_TENANT_BILLING_RENEWALS.sql:311; ADD_TENANT_BILLING_UPGRADE_EMAILS_MANUAL_PAYMENTS.sql:433 |
| `fn_push_dispatcher_cron` | 2 | 1 | mobile/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql:28; web/ADD_SUPABASE_CRON_PIPELINES.sql:124 |
| `fn_refresh_layaway_alerts` | 2 | 1 | SpVistasFN.sql:950; UPDATE_VIEWS_TO_THIRD_PARTIES.sql:226 |
| `fn_refresh_stock_alerts` | 2 | 1 | FIX_STOCK_ALERTS_REALTIME.sql:154; SpVistasFN.sql:907 |
| `fn_release_expired_online_orders` | 2 | 1 | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:36; FIX_ONLINE_STOCK_TIMEOUT_CLEANUP.sql:29 |
| `fn_sync_online_gateway_payment` | 2 | 1 | ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql:487; FIX_ONLINE_STORE_GATEWAY_SYNC_LOCK.sql:7 |
| `fn_upsert_online_order_alert` | 2 | 1 | ONLINE_ORDER_MOBILE_NOTIFICATIONS.sql:8; ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql:46 |
| `fn_upsert_third_party` | 2 | 1 | ADD_FE_COMPLEMENTARY.sql:102; FIX_THIRD_PARTIES_RPC.sql:9 |
| `has_permission` | 2 | 1 | ADD_TENANT_BILLING_MONETIZATION.sql:560; RLS_Security.sql:16 |
| `is_user_admin` | 2 | 1 | FIX_RLS_CASHIER_PRIVACY.sql:19; FIX_RLS_CASHIER_RESTRICTIONS.sql:30 |
| `is_user_cashier` | 2 | 1 | FIX_RLS_CASHIER_PRIVACY.sql:35; FIX_RLS_CASHIER_RESTRICTIONS.sql:49 |
| `sp_cancel_layaway` | 2 | 1 | LAYAWAY_OPERATIONAL_HARDENING.sql:526; PlanSepare.sql:609 |
| `sp_complete_layaway_to_sale` | 2 | 1 | LAYAWAY_OPERATIONAL_HARDENING.sql:305; PlanSepare.sql:479 |
| `sp_create_transfer_request` | 2 | 1 | ADD_TRANSFER_IN_TRANSIT_CORE.sql:44; INVENTORY_PURCHASE_HARDENING.sql:255 |
| `sp_receive_purchase_order` | 2 | 1 | ADD_PURCHASE_ORDERS_CORE.sql:154; ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql:124 |
| `trg_product_variants_alert` | 2 | 1 | FIX_STOCK_ALERTS_REALTIME.sql:128; SpVistasFN.sql:1064 |
| `trg_stock_balances_alert` | 2 | 1 | FIX_STOCK_ALERTS_REALTIME.sql:62; SpVistasFN.sql:1011 |
| `trg_update_average_cost` | 2 | 1 | INVENTORY_PURCHASE_HARDENING.sql:73; SpVistasFN.sql:1419 |

### B.5 Riesgos de portabilidad detectados en funciones

| Riesgo | Conteo | Funciones representativas | Acción recomendada |
|---|---:|---|---|
| Definiciones `SECURITY DEFINER` sin `search_path` | 61 | `fn_update_credit_balance`, `fn_accounting_close_period`, `fn_accounting_enqueue_event`, `fn_accounting_get_withholding_summary`, `fn_accounting_open_period`, `fn_accounting_post_entry` | Fijar `search_path` seguro y cualificar objetos; revisar ownership. |
| Definiciones con `auth.uid()`/`auth.jwt()` | 57 | `fn_accounting_close_period`, `fn_accounting_get_withholding_summary`, `fn_accounting_open_period`, `fn_accounting_post_entry`, `fn_accounting_process_queue`, `fn_accounting_process_queue_all_tenants` | Reemplazar por contexto de sesión/tenant de la aplicación. |
| Definiciones trigger | 57 | `trg_touch_chat_order_ai_cache`, `trg_refresh_customer_receivable_alerts`, `trg_refresh_supplier_payable_alerts`, `fn_accounting_seed_competitive_defaults_new_tenant`, `fn_accounting_trg_purchases_enqueue`, `fn_accounting_trg_sales_enqueue` | Recrear triggers y probar doble efecto si parte del efecto pasa a Go. |
| Definiciones públicas/tienda online | 22 | `fn_create_public_subscription_signup`, `fn_get_public_subscription_signup_status`, `fn_list_public_subscription_plans`, `fn_get_public_online_store`, `fn_get_public_order_status`, `fn_list_public_online_store_products` | Revisar autorización, tokens y datos expuestos. |
| Definiciones con `pg_cron`/`net`/`vault`/SQL dinámico | 9 | `fn_enforce_tenant_plan_limit_on_active_row`, `get_current_user_tenant_id`, `fn_push_dispatcher_cron`, `sp_audit_rls_and_optionally_apply`, `fn_online_store_create_sale` | Externalizar a Go/worker; no asumir extensiones del proveedor. |

**Dependencias Supabase observadas:** `auth.uid()`/`auth.jwt()` en funciones de autorización y contabilidad; `pg_cron`/`net.http`/`vault` en dispatchers; `storage` en metadata de importación. Ninguna se puede considerar parte de PostgreSQL estándar. El detalle por archivo está en [`supabase-dependencies.md`](../supabase-dependencies.md).

### B.6 Limitaciones

- Análisis estático: no se ejecutó ninguna función ni se verificó el plan de ejecución. Las firmas y los cuerpos provienen de los archivos; la versión desplegada es **a verificar**.
- La extracción de parámetros y retornos es heurística; los comentarios SQL y los defaults se limpian, pero una firma con tipos compuestos o `OUT` puede quedar truncada. La fuente citada manda.
- No se inventariaron `GRANT`/`REVOKE`, ownership, triggers por tabla ni políticas RLS; eso corresponde a las tareas 2 y 4.
- `sale_line_components` y `vw_component_expiration_risk` no tienen DDL localizado. `stock_balances` cambia de tabla a materialized view en el historial: **a verificar**.

## Anexos

### Datos y scripts reproducibles

- [`query-sites.json`](query-sites.json): sitios `.from()`/`.rpc()` con filtros, orden, límite y fragmento de la cadena.
- [`sql-functions.json`](sql-functions.json): definiciones, firma, retorno, `SECURITY DEFINER`, flags de dependencia y cuerpo recortado.
- [`table-catalog.json`](table-catalog.json): tablas/vistas, definiciones y `tenant_id`.
- `tools/database/extract_query_sites.py`, `tools/database/extract_sql_functions.py` y `tools/database/extract_table_catalog.py`: extractores de solo lectura; `tools/database/build_listings_and_rpcs.py` regenera este documento.

### Pendientes para las Tareas 5 y 6

1. Elegir una definición consolidada por firma y resolver las 60 redefiniciones.
2. Convertir los listados con offset y sin desempate a cursor/keyset y definir `has_next` vs total exacto.
3. Validar los índices candidatos con `EXPLAIN (ANALYZE, BUFFERS)` sobre datos sintéticos de dos tenants.
4. Reemplazar `auth.uid()`/`auth.jwt()` y los dispatchers `pg_cron`/`net`/`vault` por contexto de aplicación y workers Go.
5. Verificar en PostgreSQL vacío que las consultas no dependen de RLS para aislar tenant.

