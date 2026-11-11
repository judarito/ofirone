# Runbook de migración y reconciliación de datos

- **Fecha:** 2026-11-09
- **Tarea:** #7 de [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md)
- **Estado:** procedimiento documentado y revisable; **no ejecutado** contra DEV ni PROD.
- **Alcance:** estructura, datos, archivos y validación. No crea migraciones ni toca datos.
- **Documentos base:** [baseline-proposal.md §«Carga de datos y recuperación futuras»](baseline-proposal.md#carga-de-datos-y-recuperación-futuras), [identity-schema-proposal.md §4](identity-schema-proposal.md#4-migración-de-datos-desde-supabase-auth), [multitenancy-isolation.md](multitenancy-isolation.md) §6 y §9, [rpc-migration-matrix.md](rpc-migration-matrix.md), [pagination-query-matrix.md](pagination-query-matrix.md).

> **Regla de lectura.** Este runbook describe cómo se migraría; no afirma que exista una base origen accesible ni que el baseline esté aprobado. DEV está conectable, con el baseline `0001`/`0002` aplicado (9 tablas) pero **sin datos históricos**, y PROD está bloqueado por política (el usuario no es de solo lectura), por lo que **no hay datos reales inventariados** ([schema-inventory.md §2.2](schema-inventory.md#22-estado-de-las-bases-dato-ya-capturado-no-se-repitieron-conexiones)). Cualquier cifra de reconciliación deberá obtenerse con el procedimiento de solo lectura aquí descrito.

---

## 1. Objetivo y no objetivos

**Objetivo.** Pasar de Supabase a PostgreSQL portable conservando identificadores, relaciones, dinero, stock y archivos, con evidencia de reconciliación por tenant y un punto de retorno explícito.

**No objetivos.**

- No ejecutar migraciones en esta entrega.
- No reescribir el backend Go ni los clientes.
- No modificar migraciones históricas ni el `docker-compose.yml`.
- No decidir aquí el baseline definitivo: lo fija [ADR-002](../decisions/ADR-002-baseline-postgresql-portable.md) y [baseline-proposal.md](baseline-proposal.md).
- No prometer rollback sin pérdida después del corte ([baseline-proposal.md §«Carga de datos y recuperación futuras»](baseline-proposal.md#carga-de-datos-y-recuperación-futuras)).

## 2. Hechos, dependencias y bloqueos

| Hecho | Evidencia | Efecto en el runbook |
|---|---|---|
| El esquema histórico vive en tres directorios (`shared/`, `web/`, `mobile/`) | [schema-inventory.md §12.6](schema-inventory.md#126-divergencia-de-directorios-de-migraciones) | El origen no es un único dump; hay que fijar el universo y deduplicar por objeto |
| Hay dos baselines (`InitDB.sql`, `full_migration.sql`) | [schema-inventory.md §12.1](schema-inventory.md#121-doble-baseline) | No se importa «todo el historial»; se importa el esquema vigente acordado |
| `stock_balances` fue tabla y luego matview | [schema-inventory.md §12.2](schema-inventory.md#122-stock_balances-tabla--vista-materializada) | Los saldos se recalculan desde el ledger/lotes, no se copian de la matview |
| No hay FK compuestas con `tenant_id` | [multitenancy-isolation.md §1](multitenancy-isolation.md#1-resumen-ejecutivo) | La validación de huérfanos/cruces es obligatoria antes de añadir constraints |
| 60 nombres de función están redefinidos | [rpc-migration-matrix.md §1](rpc-migration-matrix.md#1-resumen-ejecutivo) | No se migran funciones por archivo; se elige una firma vigente por nombre |
| Identidad y credenciales están en Supabase Auth | [supabase-dependencies.md §3](supabase-dependencies.md#3-dependencias-de-identidad) | La importación de usuarios es un mapeo, no una copia de `auth.users` |
| DEV sin datos históricos (baseline aplicado); PROD sin usuario de solo lectura | [schema-inventory.md §2.2](schema-inventory.md#22-estado-de-las-bases-dato-ya-capturado-no-se-repitieron-conexiones) | No se puede ensayar con datos reales ni observar el esquema desplegado |

**Bloqueos vigentes:**

| # | Bloqueo | Evidencia | Impacto | Desbloqueo |
|---|---|---|---|---|
| B1 | PROD sin usuario de solo lectura; el usuario tiene `CREATE` | [schema-inventory.md §2.2](schema-inventory.md#22-estado-de-las-bases-dato-ya-capturado-no-se-repitieron-conexiones) | No hay conteos, esquema ni export de PROD | Rol `SELECT` + `default_transaction_read_only` provisto por el owner |
| B2 | DEV con baseline `0001`/`0002` (9 tablas) pero sin datos históricos | [DEV-STATUS-2026-11-09.md](DEV-STATUS-2026-11-09.md) | No se puede ensayar la carga con datos reales | Entorno de prueba con copia autorizada |
| B3 | DEV en PostgreSQL 18.6; objetivo 15+ | [schema-inventory.md §2.2](schema-inventory.md#22-estado-de-las-bases-dato-ya-capturado-no-se-repitieron-conexiones) | Validación no representativa | Instancia desechable PG15/16 con la colación del destino |
| B4 | Baseline incompleto: solo 0001–0002 (9 tablas de 116) | [`database/migrations/`](../../database/migrations/) | La mayoría de dominios no puede cargarse | Completar 0003–0016 y aprobar el grafo |
| B5 | Sin export de `auth.users` | Requiere privilegio de plataforma | Identidad no migrable | Export autorizado o reset masivo con invitación |
| B6 | Sin acceso de lectura a binarios de Storage | `service_role` no es de solo lectura | Fase de archivos bloqueada | Credencial S3/API read-only o copia autorizada |
| B7 | Sin lista aprobada de superadmins | Regla histórica «sin perfil = admin» | Riesgo de escalada | Lista explícita firmada por el owner |
| B8 | Sin reglas de negocio para deduplicar terceros/cartera | Datos no observados | Decisiones irreversibles | Aprobación funcional documentada |

Además: (c) no hay tabla de versiones/checksums del baseline ([database/migrations/README.md:14-19](../../database/migrations/README.md#L14-L19)); (d) falta aprobar el modelo de identidad y la consolidación de RPC. B1–B4 impiden cualquier ejecución hoy.

## 3. Principios irrenunciables

1. **Origen inmutable.** Se trabaja sobre un snapshot consistente y se conserva hasta cerrar la reconciliación. Nunca se escribe en el origen.
2. **Estructura primero, datos después.** El esquema portable se crea desde `database/migrations/` en una base desechable; la carga es un proceso separado ([database/migrations/README.md:8-19](../../database/migrations/README.md#L8-L19)).
3. **UUID preservados.** No se regeneran identificadores de negocio; se conservan y se registran correspondencias cuando el modelo cambie ([baseline-proposal.md §«Decisiones propuestas»](baseline-proposal.md#decisiones-propuestas)).
4. **Una operación, una transacción.** La importación de cada dominio se ejecuta en transacción y con `ON_ERROR_STOP`; un fallo no deja medio dominio cargado.
5. **Triggers explícitos.** Durante la carga histórica no se reejecutan efectos ya materializados (movimientos, asientos, outputs). Cualquier desactivación es local, documentada y seguida de validación completa ([baseline-proposal.md §«Carga de datos y recuperación futuras»](baseline-proposal.md#carga-de-datos-y-recuperación-futuras)).
6. **Reconciliación por tenant.** Los totales globales no demuestran nada; se compara por `(tenant_id, tabla, clave)` ([baseline-proposal.md §«Carga de datos y recuperación futuras»](baseline-proposal.md#carga-de-datos-y-recuperación-futuras)).
7. **Sin secretos en artefactos.** Ni URLs, ni contraseñas, ni tokens, ni hashes en reportes, logs o commits.
8. **Corte reversible hasta el punto de no retorno.** Antes de abrir escrituras nuevas se puede volver al origen; después, el rollback exige reconciliar lo escrito o restaurar con pérdida evaluada.

## 4. Fases del procedimiento

| Fase | Entrada | Salida | Criterio de avance |
|---:|---|---|---|
| 0. Preparación | Repo y accesos | Alcance, responsables, ventana, entorno desechable | Baseline y modelo de identidad aprobados |
| 1. Snapshot | Origen accesible en solo lectura | Dump lógico + conteos + checksums | Snapshot restaurable y verificado |
| 2. Inventario | Snapshot | Conteos por tabla/tenant, huérfanos, duplicados | Desviaciones explicadas |
| 3. Estructura | `database/migrations/` | Esquema vacío en PostgreSQL 15+ | Up, prueba, down y segundo up OK |
| 4. Referencias | Snapshot | `tenants`, geografía, unidades, impuestos, medios de pago | Catálogos completos y estables |
| 5. Identidad | Snapshot + exportación de Auth | `identities`, `tenant_memberships`, roles, sesiones vacías | Mapeo `auth.users.id` ↔ `membership_id` auditado |
| 6. Negocio | Snapshot | Catálogo, ventas, compras, inventario, cartera, contabilidad | Conteos y sumas por tenant OK |
| 7. Archivos | Buckets/manifiesto | Objetos en storage destino + metadatos propios | Tamaño/checksum por objeto OK |
| 8. Validación | BD destino | Reporte de reconciliación y pruebas negativas | Todos los checks en verde o excepción firmada |
| 9. Corte | Validación cerrada | Escrituras en destino, origen en solo lectura | Punto de no retorno documentado |
| 10. Limpieza | Corte estable | Origen archivado, credenciales rotadas | Retención y borrado aprobados |

## 5. Orden de migración respetando dependencias

El orden sigue el grafo lógico de [baseline-proposal.md §«Orden propuesto de migraciones»](baseline-proposal.md#orden-propuesto-de-migraciones), no el orden alfabético de archivos. Cada paso puede ser una transacción independiente, pero un hijo nunca se carga antes que su padre.

| # | Dominio | Tablas principales | Depende de | Baseline | Nota de carga |
|---:|---|---|---|---|---|
| 1 | Núcleo | `tenants`, helpers, timestamps | — | 0001 | `tenants` primero; el resto referencia su UUID |
| 2 | Identidad | `identities`, `tenant_memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles` | Núcleo | 0002 | Ver §7.1; sesiones y tokens **no** se importan |
| 3 | Referencias | configuración, geografía, `units_of_measure`, `locations`, `taxes`, `payment_methods`, `categories`, `price_lists` | Núcleo | 0003 | Catálogos globales vs. por tenant |
| 4 | Terceros | `third_parties` (absorbe `customers`) | Identidad, referencias | 0004 | Resolver `customers` → `third_parties` antes de ventas |
| 5 | Catálogo | `products`, `product_variants`, `product_barcodes`, `product_tags`, `product_tag_map`, `price_list_items`, `product_media` (metadatos) | Terceros, referencias | 0004 | Conservar `is_active` y JSONB |
| 6 | Caja | `cash_registers`, `cash_sessions`, `cash_movements` | Referencias, membresías | 0005 | Sesiones cerradas inmutables |
| 7 | Inventario | `inventory_batches`, `inventory_moves`, reservas, `transfer_requests`, `stock_reservations_log` | Catálogo, membresías | 0007 | **Antes de ventas**: `sale_line_batches` referencia lotes |
| 8 | Ventas | `sales`, `sale_lines`, `sale_payments`, `sale_line_batches`, `sale_returns`, líneas, `sale_return_refunds`, `sale_warnings` | Caja, inventario, terceros | 0005/0008 | Contadores se recalculan desde el máximo histórico al final del nivel |
| 9 | Compras | `purchases`, órdenes, líneas, devoluciones, `supplier_payables`, pagos | Terceros, inventario | 0006 | FK a inventario se añade después |
| 10 | Cartera y layaway | `customer_credit_accounts`, movimientos, `layaway_contracts`, cuotas, devoluciones | Ventas, caja | 0008 | Saldos se recalculan desde movimientos |
| 11 | Manufactura | BOM, componentes, órdenes, outputs, asignaciones | Inventario, ventas | 0009 | FK cruzadas se añaden al final |
| 12 | Contabilidad | cuentas, periodos, asientos, líneas, reglas, cola, `invoice_resolutions`, `fe_provider_config` | Documentos origen | 0010 | No re postear asientos ya existentes |
| 13 | Tienda y facturación | catálogo público, pedidos, planes, suscripciones, pagos, credenciales | Catálogo, ventas, tenants | 0011 | Revisar eventos de signup |
| 14 | Jobs, outbox, media | `async_jobs`, intentos, outbox, imports, errores, notificaciones, telemetría, auditoría, `mobile_sale_operations` | Todos | 0012 | Sin `storage.*`; el binario va aparte |
| 15 | Funciones, triggers y vistas | primitivas y triggers | Tablas | 0013–0014 | Crear funciones antes de triggers |
| 16 | Constraints e índices | FK compuestas, unicidades, índices de paginación | Todo | 0015 | Fuera de la carga masiva si es posible |
| 17 | Grants/RLS/seeds | roles técnicos, políticas, catálogos deterministas | Todo | 0016 | Sin usuarios privilegiados ni datos demo |

**Regla de ciclos.** Si dos tablas se referencian mutuamente, se crean sin la FK cíclica y se añade al final; no se desactiva la integridad globalmente ([baseline-proposal.md §«Orden propuesto de migraciones»](baseline-proposal.md#orden-propuesto-de-migraciones)).

**Regla de orden dentro del nivel.** Catálogos → cabeceras → líneas → hijos → eventos. Un hijo nunca se carga antes que su padre, y no se «arreglan» FK con `UPDATE` masivos posteriores. El inventario precede a las ventas porque `sale_line_batches.batch_id` referencia `inventory_batches` ([ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql:316-329](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql#L316-L329)); a su vez, los movimientos no tienen FK hacia ventas/compras, solo `source_id` lógico ([InitDB.sql:344-358](../../shared/supabase/migrations/InitDB.sql#L344-L358)).

## 6. Identificadores, claves externas y correspondencias

| Caso | Estrategia | Verificación |
|---|---|---|
| PK de negocio (UUID) | Conservar el UUID original | Conteo de nulos/duplicados = 0 |
| `public.users.user_id` | Se conserva como `tenant_memberships.membership_id` | Una fila por membresía; sin huérfanos |
| `auth.users.id` | Se conserva como `identities.identity_id` (o tabla de correspondencia) | `(issuer, subject)` único; sin colisiones |
| `users.auth_user_id` | Pasa a dato de correspondencia de importación, no autoridad | 100 % de perfiles mapeados o justificados |
| Emails | Normalizar minúsculas/trim; deduplicar globalmente | Unicidad global; conflictos revisados |
| IDs de archivos | Nueva clave de objeto + manifiesto por checksum | Cada fila de media apunta a un objeto existente |
| Secuencias/contadores | Recalcular desde `max(número)` del snapshot | Primer número nuevo > último histórico |
| Claves de idempotencia | `(tenant_id, operation_id)` + hash de payload | Sin colisiones entre tenants |

**Prohibido:** regenerar UUID «para limpiar», reutilizar `auth.users.id` como PK de negocio sin tabla de correspondencia, o mapear por email sin verificación. Ver [ADR-005](../decisions/ADR-005-modelo-identidad-portable.md) y [ADR-006](../decisions/ADR-006-credenciales-migracion-y-oidc.md).

## 7. Migración por dominio

### 7.1 Identidad y tenants

1. Crear `tenants` desde la tabla/atributo de tenant del origen; conservar UUID y slug normalizado.
2. Crear `identities` con una fila por persona; **sin** contraseñas ni tokens. El detalle de campos y reconciliación está en [identity-schema-proposal.md §4](identity-schema-proposal.md#4-migración-de-datos-desde-supabase-auth).
3. Crear `tenant_memberships` conservando `public.users.user_id` como `membership_id` ([ADR-005](../decisions/ADR-005-modelo-identidad-portable.md)).
4. Cargar roles, permisos y asignaciones; verificar que rol y membresía pertenecen al mismo tenant.
5. **No migrar** `auth.users.encrypted_password`, sesiones, refresh tokens, MFA ni OAuth ([ADR-006 §2-3](../decisions/ADR-006-credenciales-migracion-y-oidc.md)). La activación es por invitación/reset.
6. Resolver perfiles huérfanos y cuentas sin perfil; la ausencia de membresía **deniega**, nunca concede superadmin ([supabase-dependencies.md §3.5](supabase-dependencies.md#35-la-regla-superadmin-por-ausencia-de-perfil)).

### 7.2 Catálogo, ventas, compras e inventario

#### 7.2.1 Terceros y catálogo

| Paso | Tabla | Regla | Trampa |
|---:|---|---|---|
| 1 | `third_parties` | Cargar antes de ventas/compras; resolver `customers` → `third_parties` conservando UUID ([MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql:1-6](../../shared/supabase/migrations/MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql#L1-L6)) | `tenant_id` nullable ([ADD_THIRD_PARTIES.sql:11-16](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L11-L16)): decidir si es global o se asigna |
| 2 | `categories` | Orden topológico por `parent_category_id` | Autorreferencia ([InitDB.sql:69-75](../../shared/supabase/migrations/InitDB.sql#L69-L75)) |
| 3 | `products` / `product_variants` | Conservar `is_active`, `cost`, `price`, `attrs` | `UNIQUE (tenant_id, name)` y `(tenant_id, sku)` ([InitDB.sql:77-101](../../shared/supabase/migrations/InitDB.sql#L77-L101)) |
| 4 | `product_barcodes`, `product_tags`, `product_tag_map` | Conservar PK compuestas con `tenant_id` | Código de barras duplicado |
| 5 | `price_list_items` | FK simple a variante y lista | Verificar que ambos sean del mismo tenant |
| 6 | `product_media` | Solo metadatos; `storage_path` único global ([ADD_PRODUCT_MEDIA_PHOTOS.sql:30-54](../../mobile/migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql#L30-L54)) | Validar contra manifiesto (§7.4) |

No se recalculan precios ni costos. Los documentos con JSONB (`attrs`, `tax_detail`, `address`) se copian sin reescritura y se validan con `jsonb_typeof`.

#### 7.2.2 Inventario

Es el dominio más frágil: conviven `inventory_moves` (ledger), `inventory_batches` (lotes con `on_hand`/`reserved`) y `stock_balances` (tabla convertida en matview) ([schema-inventory.md §12.2](schema-inventory.md#122-stock_balances-tabla--vista-materializada)).

1. Cargar `inventory_batches` ([ADD_EXPIRATION_BATCHES_PHASE2.sql:21-55](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L21-L55)) e `inventory_moves` ([InitDB.sql:344-358](../../shared/supabase/migrations/InitDB.sql#L344-L358)) **tal como están**; no ejecutar `fn_apply_stock_delta`, `fn_allocate_stock_fefo` ni `sp_create_sale`.
2. No cargar `stock_balances` (ni tabla ni matview): se recalcula en el destino. Es vista normal, no objeto persistido ([ADR-002](../decisions/ADR-002-baseline-postgresql-portable.md)).
3. Reconciliar `inventory_batches.on_hand` contra la suma de movimientos por `(tenant_id, location_id, variant_id)` con la convención vigente: entradas (`PURCHASE_IN`, `RETURN_IN`, `ADJUSTMENT`, `TRANSFER_IN`) suman; salidas (`SALE_OUT`, `TRANSFER_OUT`) restan ([SpVistasFN.sql:604-605](../../shared/supabase/migrations/SpVistasFN.sql#L604-L605)).
4. Reconciliar `reserved` contra reservas activas (`online_order_reservations`, `stock_reservations_log`). Si no cuadra, cuarentena y decisión de negocio; no inventar holds.
5. Cargar `sale_line_batches` después de lotes y ventas; validar que la suma asignada por línea no exceda la cantidad vendida.
6. **Stock negativo:** el destino tiene `CHECK (on_hand >= 0)`; un lote negativo en origen no se puede cargar sin decisión explícita (cuarentena o ajuste documentado). Nunca `UPDATE` silencioso.
7. **Histórico sin lotes:** ventas anteriores al sistema de lotes no tienen `sale_line_batches`. No fabricar asignaciones; marcarlas como `legacy_no_batch` y excluirlas del FEFO retrospectivo.

#### 7.2.3 Ventas, pagos y devoluciones

| Paso | Tabla | Regla |
|---:|---|---|
| 1 | `sales` | Conservar `sale_id`, `sale_number`, `sold_at`, `status` y totales ([InitDB.sql:273-289](../../shared/supabase/migrations/InitDB.sql#L273-L289)) |
| 2 | `sale_lines` | Conservar `line_total`, `tax_detail`; validar suma de líneas vs cabecera |
| 3 | `sale_payments` | Suma por venta; ventas a crédito pueden no tener pago completo |
| 4 | `sale_line_batches` | Después de lotes y líneas |
| 5 | `sale_returns` / líneas / `sale_return_refunds` | Conservar `refund_total` y estado ([ADD_SALE_RETURNS_REFUNDS_V2.sql:5-20](../../shared/supabase/migrations/ADD_SALE_RETURNS_REFUNDS_V2.sql#L5-L20)) |
| 6 | `sale_counters` | **Después** de ventas: `next_sale_number = greatest(actual, max(sale_number)+1)` por `(tenant_id, location_id)` ([SpVistasFN.sql:13-40](../../shared/supabase/migrations/SpVistasFN.sql#L13-L40)) |

**Consecutivos:** nunca reiniciar ni reutilizar `sale_number`; hay `UNIQUE (tenant_id, location_id, sale_number)` ([InitDB.sql:288](../../shared/supabase/migrations/InitDB.sql#L288)). Los huecos son aceptables; los duplicados son bloqueantes.

**Fechas:** usar `sold_at` como fecha operativa aunque `created_at` difiera; cargar `timestamptz` en UTC y fijar `TimeZone=UTC` en la sesión. No reinterpretar la zona.

**Ventas anuladas/devueltas:** se cargan completas (`VOIDED`, `RETURNED`, `PARTIAL_RETURN`); los reportes filtran por estado, no la migración.

#### 7.2.4 Compras y cuentas por pagar

- `purchases` no tiene líneas propias: el detalle económico está en `inventory_moves` con `source='PURCHASE'` y `source_id = purchase_id` ([SpVistasFN.sql:1515-1522](../../shared/supabase/migrations/SpVistasFN.sql#L1515-L1522)). Reconstruirlo desde ahí; documentar que impuestos/fletes pueden no estar representados.
- Cargar `purchase_orders`/líneas ([ADD_PURCHASE_ORDERS_CORE.sql:5-33](../../shared/supabase/migrations/ADD_PURCHASE_ORDERS_CORE.sql#L5-L33)), devoluciones ([ADD_PURCHASE_RETURNS_CORE.sql:5-30](../../shared/supabase/migrations/ADD_PURCHASE_RETURNS_CORE.sql#L5-L30)) y `supplier_payables`/pagos ([ADD_SUPPLIER_PAYABLES_CORE.sql:5-35](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L5-L35)).
- Reconciliar `purchases.total` contra `sum(quantity * unit_cost)` de movimientos de compra; las diferencias se documentan (impuestos, flete, redondeo), no se fuerzan.

#### 7.2.5 Archivos (metadatos)

Los binarios no están en la base: `storage.objects` solo guarda metadatos ([supabase-dependencies.md §4.4](supabase-dependencies.md#44-hallazgos-de-storage)). En la fase de datos solo se cargan **referencias** (`product_media`, `bulk_imports.file_key`, imágenes de tienda); la existencia del objeto la valida el manifiesto (§7.4). Buckets observados:

| Bucket | Visibilidad | Riesgo |
|---|---|---|
| `storefront` | Público ([ADD_ONLINE_STORE_MVP.sql:20](../../shared/supabase/migrations/ADD_ONLINE_STORE_MVP.sql#L20)) | Comprobantes subidos por `anon` ([ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql:19-26](../../shared/supabase/migrations/ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql#L19-L26)): PII/financiero |
| `dataimport` | Privado ([SETUP_DATAIMPORT_BUCKET.sql:7](../../shared/supabase/migrations/SETUP_DATAIMPORT_BUCKET.sql#L7)) | Metadatos con `tenant_id`; trigger de relleno |
| `productmedia` | **Contradictorio** (privado en móvil, público en shared) | Fotos de producto; URLs firmadas vs públicas |

### 7.3 Contabilidad y jobs

- Cargar asientos y líneas sin disparar el posteo automático; la cola contable se carga vacía o con pendientes justificados.
- Cargar jobs/outbox solo si se conserva su estado; los `PENDING` se revisan para no reenviar efectos ya ejecutados.
- Los workers arrancan **después** del corte, con lease y tenant explícitos ([ADR-004](../decisions/ADR-004-rpc-sql-vs-go.md)).

### 7.4 Archivos y storage

1. **Manifiesto por objeto:** `bucket,key,tenant_id,size,content_type,sha256,visibility,referenced_by`. Se genera con una credencial de solo lectura de Storage (listado + descarga); la consulta SQL a `storage.objects` sola no ve binarios.
2. **Modelo destino propuesto:** `file_objects(file_id, tenant_id, namespace, object_key, original_name, mime_type, size_bytes, sha256, visibility, owner_type, owner_id, legacy_bucket, legacy_key, created_at, deleted_at)`, con `UNIQUE (namespace, object_key)`. No existe aún en 0001–0002; debe aprobarse antes de la fase F3.
3. **Copia:** descargar, calcular SHA-256 al copiar, subir al almacenamiento propio y comparar hash y tamaño. Guardar la nueva clave en las tablas de metadatos (`product_media.storage_path`, `bulk_imports.file_key`).
4. **Claves y URLs:** conservar `object_key` cuando el namespace no cambie; si cambia, prefijo determinista y mapa `legacy_key → object_key`. No traducir URLs públicas antiguas: se regeneran y se actualizan las columnas de texto que las contengan.
5. **Privacidad:** los comprobantes de pago de `storefront/public-proofs` no deben quedar públicos en el destino sin decisión explícita; clasificarlos `private` y servir con URL firmada. Un bucket público solo para catálogo público aprobado.
6. **Huérfanos:** objeto sin referencia y referencia sin objeto son hallazgos distintos; ambos se reportan. No se inventa propietario.
7. **Autorización:** queda en Go, no en RLS de `storage.objects` ([supabase-dependencies.md §4](supabase-dependencies.md#4-dependencias-de-storage)).

**Bloqueo:** `service_role` **no es de solo lectura** y no cumple la política de PROD; se necesita una credencial de listado/descarga read-only o una copia autorizada del bucket. Sin eso, esta fase no se ejecuta.

## 8. Reconciliación: conteos, sumas y checksums

### 8.1 Reglas

1. **Por tenant y por tabla.** Un total global puede cuadrar ocultando dos errores simétricos.
2. **Conteo exacto** de filas del origen vs. destino, con el mismo predicado (incluye/excluye soft delete de forma declarada).
3. **Sumas de dinero** con `numeric`, no `float`: ventas, pagos, devoluciones, compras, cartera y asientos.
4. **Sumas de inventario**: `on_hand`, `reserved`, movimientos por tipo y saldo agregado.
5. **Checksum de fila** para tablas críticas: `md5(concat_ws('|', columnas ordenadas))`, agregado por tenant. Sirve para detectar diferencias aunque los conteos coincidan.
6. **Integridad**: cero huérfanos, cero cruces de tenant, cero duplicados de clave de negocio.
7. **Toda diferencia** se registra con tabla, tenant, consulta y responsable; no se «ajusta» a mano sin evidencia.

### 8.2 Consultas de referencia (solo lectura)

**Conteo por tenant, todas las tablas.** En vez de escribir 116 consultas, generar el SQL desde el catálogo y ejecutarlo con `\gexec`:

```sql
select format(
  'select %L as tabla, tenant_id, count(*) as filas from public.%I group by tenant_id;',
  c.relname, c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and exists (
    select 1 from pg_attribute a
    where a.attrelid = c.oid and a.attname = 'tenant_id'
      and a.attnum > 0 and not a.attisdropped
  )
order by c.relname;
```

Las tablas sin `tenant_id` se cuentan aparte: globales (`permissions`, `billing_plans*`, `menu_*`, `cities`) y derivadas (`membership_roles`, `async_job_attempts`, `bulk_import_errors`, `public_subscription_signup_events`).

**Sumas financieras por tenant.** `sales` **no tiene** `paid_amount` (esa columna existe en `supplier_payables`, [ADD_SUPPLIER_PAYABLES_CORE.sql:13](../../shared/supabase/migrations/ADD_SUPPLIER_PAYABLES_CORE.sql#L13)); el pagado se obtiene de `sale_payments`. Agregar por separado para no multiplicar filas:

```sql
with v as (
  select tenant_id,
         count(*)      as ventas,
         sum(total)    as vendido,
         sum(tax_total) as impuesto,
         sum(discount_total) as descuento
  from public.sales
  where status <> 'VOIDED'
  group by tenant_id
), p as (
  select tenant_id, sum(amount) as pagado
  from public.sale_payments
  group by tenant_id
)
select coalesce(v.tenant_id, p.tenant_id) as tenant_id,
       coalesce(v.ventas, 0)   as ventas,
       coalesce(v.vendido, 0)  as vendido,
       coalesce(p.pagado, 0)   as pagado,
       coalesce(v.vendido, 0) - coalesce(p.pagado, 0) as diferencia
from v full join p using (tenant_id)
order by 1;
```

La diferencia no es automáticamente un error: una venta a crédito puede tener pago parcial. Contrastar con `customer_credit_movements` antes de declararla inconsistencia.

**Inventario: lote vs ledger.**

```sql
with ledger as (
  select tenant_id, location_id, variant_id,
         sum(case
               when move_type in ('PURCHASE_IN','RETURN_IN','ADJUSTMENT','TRANSFER_IN') then quantity
               when move_type in ('SALE_OUT','TRANSFER_OUT') then -quantity
               else 0
             end) as on_hand
  from public.inventory_moves
  group by tenant_id, location_id, variant_id
), lotes as (
  select tenant_id, location_id, variant_id, sum(on_hand) as on_hand
  from public.inventory_batches
  group by tenant_id, location_id, variant_id
)
select coalesce(l.tenant_id, b.tenant_id)     as tenant_id,
       coalesce(l.location_id, b.location_id) as location_id,
       coalesce(l.variant_id, b.variant_id)   as variant_id,
       coalesce(l.on_hand, 0) as ledger,
       coalesce(b.on_hand, 0) as lotes,
       coalesce(l.on_hand, 0) - coalesce(b.on_hand, 0) as diferencia
from ledger l full join lotes b using (tenant_id, location_id, variant_id)
where coalesce(l.on_hand, 0) <> coalesce(b.on_hand, 0)
order by 1, 2, 3;
```

**Cartera: saldo declarado vs movimientos.**

```sql
with bal as (
  select tenant_id, sum(current_balance) as saldo
  from public.customer_credit_accounts group by tenant_id
), mov as (
  select tenant_id, sum(amount) as movimiento
  from public.customer_credit_movements group by tenant_id
)
select coalesce(bal.tenant_id, mov.tenant_id) as tenant_id,
       coalesce(bal.saldo, 0) as saldo_declarado,
       coalesce(mov.movimiento, 0) as suma_movimientos,
       coalesce(bal.saldo, 0) - coalesce(mov.movimiento, 0) as diferencia
from bal full join mov using (tenant_id)
order by 1;
```

**Duplicados de clave de negocio:**

```sql
select tenant_id, sku, count(*) as veces
from public.product_variants
group by tenant_id, sku
having count(*) > 1;
```

**Checksum por tenant (ejemplo; las columnas se fijan por tabla):**

```sql
with filas as (
  select tenant_id, sale_id,
         md5(concat_ws('|',
           sale_id::text,
           sale_number::text,
           status,
           to_char(sold_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
           coalesce(customer_id::text, '-'),
           to_char(subtotal,       'FM999999999999990.00'),
           to_char(discount_total, 'FM999999999999990.00'),
           to_char(tax_total,      'FM999999999999990.00'),
           to_char(total,          'FM999999999999990.00')
         )) as row_hash
  from public.sales
)
select tenant_id,
       count(*) as filas,
       md5(string_agg(row_hash, '' order by sale_id)) as checksum
from filas
group by tenant_id;
```

Reglas del hash:

- **Columnas explícitas**, nunca `SELECT *`; el orden y la lista se versionan en el manifiesto.
- `timestamptz` siempre `at time zone 'UTC'` con formato fijo; `numeric` con `to_char` y escala fija (evita `1.5` vs `1.50`).
- `NULL` con un centinela que no pueda aparecer en los datos (`'-'`).
- Tablas grandes: particionar por mes o por tenant; `string_agg` completo puede exceder memoria.
- `md5` detecta divergencias de migración; no es una firma contra manipulación deliberada.

Estas consultas se ejecutan contra el **snapshot restaurado** y contra el destino; nunca contra PROD sin usuario de solo lectura. El validador [validate_portable_schema.py](../../tools/database/validate_portable_schema.py) cubre inventario, huérfanos, índices y duplicados, pero **no sustituye** las sumas ni los checksums.

### 8.3 Umbrales de aceptación

| Medida | Umbral | Acción si falla |
|---|---|---|
| Conteos L1 por tabla y tenant | 0 diferencias | Bloquear corte |
| Sumas monetarias | 0 diferencias sin explicación | Documentar o bloquear |
| Stock por lote vs ledger | 0 diferencias | Bloquear; investigar doble aplicación |
| Cartera | 0 diferencias | Bloquear |
| `sale_counters.next_sale_number` | `> max(sale_number)` por tenant/sede | Corregir contador antes de abrir |
| Huérfanos nuevos | 0 | Bloquear |
| Cruces de tenant | 0 | Bloquear |
| Hash de tablas críticas | 100 % del alcance | Repetir carga desde staging |
| Archivos | 100 % con tamaño y SHA-256 | Bloquear corte |

### 8.4 Matriz mínima de reconciliación

| Dominio | Conteo | Suma/derivado | Integridad |
|---|---|---|---|
| Tenants | `tenants` | — | slug único |
| Identidad | `identities`, `tenant_memberships` | membresías activas | 1 membresía por `(tenant, identity)`; rol del mismo tenant |
| Terceros | `third_parties` | — | documento único por tenant |
| Catálogo | `products`, `product_variants` | — | SKU único por tenant |
| Ventas | `sales`, líneas, pagos | total, pagado, saldo | pagos = total; sin líneas huérfanas |
| Compras | `purchases`, líneas | total, recibido | CxP = total − pagado |
| Inventario | lotes, movimientos | `on_hand`, `reserved` | saldo reconstruido = ledger; sin lotes negativos |
| Cartera | cuentas, movimientos | `current_balance` | saldo = suma de movimientos |
| Contabilidad | asientos, líneas | debe = haber | periodo abierto único por tenant |
| Jobs/outbox | jobs, intentos | pendientes/fallidos | sin jobs duplicados por tenant+operación |
| Media | metadatos | objetos, bytes | checksum y tamaño por objeto |

## 9. Huérfanos, duplicados, soft delete e históricos

| Situación | Tratamiento | Evidencia |
|---|---|---|
| FK rota en origen | Detectar antes de cargar; decidir reparar, anular o excluir | Conteo por FK con el validador `orphans` |
| Hijo con `tenant_id` distinto al padre | Bloquea la FK compuesta; reconciliar antes de añadirla | Casos N1–N20 de [multitenancy-isolation.md §9](multitenancy-isolation.md#9-casos-negativos-de-prueba-tenant-a-contra-tenant-b) |
| Duplicado de clave de negocio | Unificar o renombrar con decisión de producto; no borrar en masa | Conteo `duplicates` |
| Soft delete | Conservar la marca; definir si se migra como fila visible o histórica | Predicado explícito en cada conteo |
| Registros históricos | Cargar sin reejecutar efectos; conservar fecha y actor originales | Triggers desactivados localmente y validación posterior |
| Perfil sin cuenta / cuenta sin perfil | Resolver con invitación o membresía explícita; nunca superadmin implícito | [supabase-dependencies.md §3.5](supabase-dependencies.md#35-la-regla-superadmin-por-ausencia-de-perfil) |
| Media sin objeto / objeto sin fila | Reportar como huérfano; no inventar propietario | Manifiesto de archivos |

### 9.1 Soft delete: evidencia y regla

No se detectó ninguna columna `deleted_at` en los tres directorios de migraciones (`shared/`, `web/`, `mobile/`). La baja lógica histórica se expresa con:

| Mecanismo | Evidencia | Migración |
|---|---|---|
| `is_active = false` | `tenants` ([InitDB.sql:12](../../shared/supabase/migrations/InitDB.sql#L12)), `locations` ([InitDB.sql:22](../../shared/supabase/migrations/InitDB.sql#L22)), `users` ([InitDB.sql:36](../../shared/supabase/migrations/InitDB.sql#L36)), `products` ([InitDB.sql:83](../../shared/supabase/migrations/InitDB.sql#L83)) | Conservar como estado; **no** borrar filas |
| `status` | `sales` (`VOIDED`, `RETURNED`, `PARTIAL_RETURN`, [InitDB.sql:279](../../shared/supabase/migrations/InitDB.sql#L279)), `cash_sessions` (`OPEN`/`CLOSED`, [InitDB.sql:246](../../shared/supabase/migrations/InitDB.sql#L246)) | Conservar; los reportes filtran por estado |
| Tabla de respaldo | `stock_balances_backup` ([ADD_EXPIRATION_BATCHES_PHASE2.sql:150-158](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L150-L158)) | No cargar como operativa; archivar como evidencia |

**Regla:** una fila con `is_active = false` sigue siendo un hecho histórico y puede estar referenciada por ventas o compras. Convertirla en `DELETE` rompe FK y auditoría. Si el destino adopta `deleted_at`, se rellena solo con una fecha conocida por el negocio; **nunca** con `now()`.

### 9.2 Duplicados conocidos

| Entidad | Detección | Superviviente propuesto |
|---|---|---|
| `third_parties` por documento | `group by tenant_id, upper(btrim(document_number))` | El más antiguo por `created_at`; fusionar contactos no vacíos |
| `customers` vs `third_parties` | Mismo documento/nombre por tenant ([MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql:1-6](../../shared/supabase/migrations/MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql#L1-L6)) | `third_parties`; `customers` queda como mapa de IDs |
| `sales` por consecutivo | `group by tenant_id, location_id, sale_number` | Ninguno: es error bloqueante ([InitDB.sql:288](../../shared/supabase/migrations/InitDB.sql#L288)) |
| `product_barcodes` | `group by tenant_id, barcode` | El de variante activa; el resto a cuarentena |
| `products` por nombre | `group by tenant_id, upper(btrim(name))` | El más antiguo; renombrar el otro con sufijo documentado |
| Email de usuario entre tenants | `group by lower(email)` | Identidad única solo si ambos están verificados; si no, cuarentena |
| `permissions.code` | `group by lower(code)` | Código normalizado + mapa de literales de `has_permission` |
| `sale_line_batches` | `group by sale_line_id, batch_id` | Sumar o elegir según FEFO documentado; nunca duplicar consumo |
| `mobile_sale_operations.operation_id` | `group by operation_id` con >1 tenant | **Bloqueante**: es PK global y puede devolver la venta de otro tenant ([ADD_IDEMPOTENT_MOBILE_SALES.sql:14-22](../../mobile/migrations/ADD_IDEMPOTENT_MOBILE_SALES.sql#L14-L22)) |
| `accounting_event_queue` | Mismo `source_id`/evento | Un solo asiento; la idempotencia contable es obligatoria |

**Regla de deduplicación:** superviviente determinista, mapa en `migration.dedup_map` (propuesto en §6) y actualización de todas las FK al superviviente **antes** de cargar. No se borra nada en el origen.

### 9.3 Triggers y RLS durante la carga

**Efectos que no deben reejecutarse:**

| Efecto | Trigger/función | Consecuencia |
|---|---|---|
| Movimiento de stock | `fn_apply_stock_delta`, `trg_generate_production_inventory` | Stock duplicado |
| Email | `trg_enqueue_*_email` (10 funciones) | Correos masivos a clientes |
| Alertas | `trg_stock_balances_alert`, `trg_refresh_expiration_alerts` | Ruido y jobs innecesarios |
| Límites de plan | `trg_enforce_products_limit`, `trg_enforce_users_active_limit` | Carga rechazada a mitad |
| `updated_at` | `trg_touch_billing_updated_at`, `set_updated_at` | Fechas históricas alteradas |
| Contabilidad | posteo automático / cola | Asientos duplicados |

Evidencia de la familia de triggers en [schema-inventory.md §8](schema-inventory.md#8-triggers).

**Estrategia:**

1. Crear el esquema **sin triggers de negocio** (solo PK/UNIQUE/CHECK/FK), cargar, validar y recién entonces crearlos (nivel 15).
2. Si ya existen, desactivarlos **por tabla** dentro de la transacción de carga:
   ```sql
   begin;
   alter table public.sales disable trigger user;
   alter table public.sale_lines disable trigger user;
   -- carga
   alter table public.sales enable trigger user;
   commit;
   ```
3. **No usar `session_replication_role = replica`**: desactiva también los triggers de FK y permite cargar huérfanos en silencio.
4. Rehabilitar y verificar:
   ```sql
   select tgrelid::regclass, tgname, tgenabled
   from pg_trigger
   where not tgisinternal and tgenabled <> 'O';
   ```
   Debe devolver 0 filas.
5. Ejecutar `ANALYZE` al final; sin estadísticas, la validación de listados y paginación es engañosa.

**RLS:** el baseline usa `FORCE ROW LEVEL SECURITY` ([0001_core.up.sql:56-62](../../database/migrations/0001_core.up.sql#L56-L62)), que también aplica al propietario de la tabla. Por tanto:

- La carga masiva se hace con un **rol dedicado `BYPASSRLS`**, sin superusuario y con contraseña rotada.
- Las pruebas de aislamiento se hacen con el **rol de API** (`NOSUPERUSER NOBYPASSRLS`), nunca con el de carga.
- Alternativa más lenta pero más segura: cargar por tenant con `set_config('app.tenant_id', ..., true)`; sirve para muestras y para validar políticas.
- Nunca cargar con `service_role` ni con un rol que usen los clientes.

## 10. Corte, rollback y restauración

### 10.1 Antes del corte

- [ ] Snapshot verificado y restaurable.
- [ ] Reconciliación cerrada o excepciones firmadas.
- [ ] Pruebas negativas de tenant A/B ejecutadas en el destino.
- [ ] `up`, segundo `up`, `down` y restauración probados en base desechable.
- [ ] Roles técnicos provisionados y grants mínimos revisados ([database/migrations/README.md:33-68](../../database/migrations/README.md#L33-L68)).
- [ ] Ventana de mantenimiento y comunicación a usuarios definidas.

### 10.2 Corte

1. Declarar el origen en solo lectura; detener workers, cron y escrituras de clientes.
2. Ejecutar la carga final o aplicar el delta acumulado desde el snapshot.
3. Repetir los checks de reconciliación y las pruebas negativas.
4. Abrir escrituras en el destino y arrancar workers con tenant/lease.
5. Congelar el origen y conservarlo según retención.

### 10.3 Punto de no retorno y rollback

| Momento | Rollback posible | Procedimiento |
|---|---|---|
| Antes de abrir escrituras | Sí, sin pérdida | Volver la configuración al origen; el destino se descarta |
| Después de abrir escrituras, antes de estabilizar | Solo con reconciliación | Exportar lo escrito en destino y aplicarlo al origen, o restaurar con pérdida evaluada |
| Después de estabilizar | Restauración | Restaurar backup del origen o del destino; no es un simple cambio de URL |

Los `down` del baseline **eliminan datos** ([database/migrations/README.md:70-84](../../database/migrations/README.md#L70-L84)); no son un mecanismo de recuperación. El rollback real es backup + restauración + reconciliación.

## 11. Seguridad, credenciales y límites

> **No se implementó nada de esta sección.** Es una propuesta para el owner/agente principal; no se modificaron `.gitignore`, archivos de credenciales ni roles de base de datos.

### 11.1 Estado observado (2026-11-09)

| Elemento | Estado | Evidencia |
|---|---|---|
| `.env.database.local` | Existe en la raíz del repo, **no trackeado**, ignorado | `.gitignore:73`; `git check-ignore -v` lo confirma |
| Permisos del archivo de entorno | `-rw-rw-r--` (lectura para el grupo) | `ls -l .env.database.local` |
| `conecionesNEO.txt` | **No existe** en el árbol actual; la ruta está ignorada y no tiene historial Git | `.gitignore:72`; `git log --all -- conecionesNEO.txt` vacío |
| Cambio de `.gitignore` | **Sin commit** en el árbol de trabajo | `git status` → `M .gitignore` |
| Rotación de credenciales PROD | **Pendiente** | No hay evidencia de rotación |
| Variables en `.env.example` | No hay claves `DATABASE_URL_*` | `grep DATABASE .env.example` sin resultados |

No hay rastro de que las credenciales se hayan commiteado, pero un archivo en claro con permisos de grupo sigue siendo un riesgo local, y las credenciales de PROD se compartieron fuera del repositorio.

### 11.2 Propuesta pendiente (no implementada)

1. **Mover credenciales a `.env.database.local`** con `chmod 600`, propietario único y sin copias en notas, chats ni archivos de texto.
2. **Confirmar el ignore** y commitear solo la regla:
   - `.gitignore:72` → `/conecionesNEO.txt`
   - `.gitignore:73` → `/.env.database.local`
   - Verificar con `git check-ignore -v .env.database.local`.
3. **Eliminar `conecionesNEO.txt`** de cualquier equipo o copia donde exista; si alguna vez se commiteó en otra rama o historial, purgar con `git filter-repo` (requiere reescritura y coordinación).
4. **Rotar credenciales de PROD**: contraseña del rol, cadenas de conexión y cualquier `service_role`/JWT secret compartido. Invalidar las anteriores, actualizar solo el gestor de secretos y verificar que la credencial vieja ya no conecta.
5. **Crear un rol de solo lectura real** para PROD: `CONNECT` + `USAGE` en `public` + `SELECT` en las tablas necesarias, `default_transaction_read_only = on`, `statement_timeout`, `idle_in_transaction_session_timeout`, sin `CREATE` ni pertenencia a roles privilegiados.
6. **Separar roles**: migrador (`BYPASSRLS` temporal), API (`NOSUPERUSER NOBYPASSRLS`), worker y lector de diagnóstico; contraseñas distintas y rotación.
7. **No imprimir URLs**: en informes usar solo `DEV`, `PROD` o `TEST`; en scripts, `psql "$DATABASE_URL_TEST"` sin `echo`.
8. **Documentar variables solo como placeholders** en `.env.example` (fuera del perímetro de este agente).
9. **Registrar el origen y la fecha de rotación** de cada credencial en el gestor de secretos, no en este repositorio.

### 11.3 Reglas operativas

- Leer `DATABASE_URL_DEV` / `DATABASE_URL_PROD` del entorno o de `.env.database.local`; nunca escribir la URL en documentos, logs o commits ([TAREAS_LLM_EXTERNO_POSTGRES.md:48-79](../../TAREAS_LLM_EXTERNO_POSTGRES.md#L48-L79)).
- PROD solo con usuario de solo lectura; si no lo es, detener y reportar bloqueo.
- Verificar host/base/rol antes de cada sesión: `select current_database(), current_user, current_setting('server_version');` sin imprimir la URL.
- `PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=5000'` en sesiones de inspección; `default_transaction_read_only=on`.
- No imprimir PII (email, teléfono, documento, dirección) ni hashes; usar conteos y UUID de tenant.
- Rotar credenciales del origen y del destino al cerrar la migración.
- No copiar `service_role`, JWT secrets, claves de Vault ni contraseñas de Supabase.
- Los artefactos con PII se cifran, se guardan fuera del repo y se destruyen al cerrar la migración.

## 12. Checklist de validación ejecutable

> Ejecutable **cuando exista un entorno de prueba** (`TEST`) con copia autorizada y credenciales en `.env.database.local`. No ejecutar contra PROD. Cada ítem produce evidencia (salida, CSV o hash) archivada fuera del repositorio.

### 12.1 Pre-flight

- [ ] `TEST` es PostgreSQL ≥ 15 y su versión/colación coincide con el destino.
- [ ] `select current_database(), current_user, current_setting('server_version');` — sin imprimir la URL.
- [ ] `show default_transaction_read_only;` = `on` en la sesión de inspección.
- [ ] El rol de carga es dedicado, `BYPASSRLS`, sin superusuario y con contraseña rotada.
- [ ] El rol de API es `NOSUPERUSER NOBYPASSRLS` y no es propietario de tablas.
- [ ] El origen está congelado o se trabaja sobre un snapshot consistente.
- [ ] Existe backup del destino vacío y del snapshot de origen, con checksum.
- [ ] El manifiesto de archivos está generado y su hash registrado.

### 12.2 Estructura

- [ ] Aplicar `0001_core.up.sql` y `0002_identity.up.sql` (y siguientes cuando existan) con `ON_ERROR_STOP=1` ([README](../../database/migrations/README.md)).
- [ ] No existen esquemas de plataforma:
  ```sql
  select nspname from pg_namespace
  where nspname in ('auth','storage','realtime','supabase_functions','vault');
  ```
  Resultado esperado: 0 filas.
- [ ] No quedan funciones que referencien `auth.`/`storage.`:
  ```sql
  select p.oid::regprocedure
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_functiondef(p.oid) ~* '(auth\.(uid|jwt|users)|storage\.)';
  ```
  Resultado esperado: 0 filas.
- [ ] Toda función `SECURITY DEFINER` fija `search_path`:
  ```sql
  select p.oid::regprocedure
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  ```
  Resultado esperado: 0 filas.
- [ ] `schema_migrations` registra cada archivo con SHA-256 y sin huecos.
- [ ] La segunda ejecución del baseline **falla limpiamente** (objeto existente) y no deja efectos parciales.

### 12.3 Datos

- [ ] L1 por tabla y tenant: 0 diferencias (§8.2).
- [ ] Sumas de ventas, pagos, devoluciones, compras, cartera y contabilidad: 0 diferencias no explicadas.
- [ ] Stock por lote vs ledger: 0 diferencias.
- [ ] `sale_counters.next_sale_number > max(sale_number)` por `(tenant, location)`.
- [ ] `sum(sale_lines.line_total)` coherente con cabeceras (tolerancia de redondeo documentada).
- [ ] Cartera: `current_balance` = suma de movimientos.
- [ ] Compras: total vs movimientos de compra, con diferencias explicadas (impuestos/flete).
- [ ] Hash L3 de las tablas críticas idéntico.
- [ ] `ANALYZE` ejecutado en todas las tablas cargadas.

### 12.4 Integridad y aislamiento

- [ ] Cero huérfanos nuevos en FK declaradas.
- [ ] Cero cruces de tenant en relaciones clave:
  ```sql
  select count(*) from public.sale_lines l
  join public.sales s using (sale_id) where l.tenant_id <> s.tenant_id;

  select count(*) from public.membership_roles mr
  join public.tenant_memberships m using (membership_id)
  join public.roles r using (role_id)
  where m.tenant_id <> r.tenant_id;

  select count(*) from public.inventory_moves m
  join public.product_variants v using (variant_id) where m.tenant_id <> v.tenant_id;
  ```
- [ ] Casos negativos N1–N20 ejecutados con el rol de API ([multitenancy-isolation.md §9](multitenancy-isolation.md#9-casos-negativos-de-prueba-tenant-a-contra-tenant-b)).
- [ ] Sin contexto `app.tenant_id`, las consultas devuelven 0 filas y las escrituras fallan.
- [ ] Un `UPDATE` que intente mover una fila a otro tenant es rechazado por `WITH CHECK`.
- [ ] No quedan triggers deshabilitados (`tgenabled <> 'O'`): 0 filas.

### 12.5 Archivos

- [ ] Cada `product_media.storage_path` tiene objeto y SHA-256 coincidente.
- [ ] Cada fila de `bulk_imports.file_key` tiene objeto.
- [ ] Cada objeto del manifiesto está referenciado o clasificado como huérfano.
- [ ] Cero comprobantes de pago en bucket público sin decisión de privacidad.
- [ ] URLs públicas regeneradas; ninguna URL antigua queda en columnas de texto.
- [ ] Conteo y tamaño total por bucket/tenant coinciden con el manifiesto.

### 12.6 Lógica, paginación y jobs

- [ ] Las vistas de stock y reportes devuelven los mismos agregados que el origen.
- [ ] Paginación: recorrer todas las páginas de ventas/productos con cursor, sin duplicados ni omisiones ([pagination-query-matrix.md §10](pagination-query-matrix.md#10-patrón-keyset-portable)).
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` de los listados principales dentro del presupuesto acordado.
- [ ] Jobs/outbox: ningún email/push se envió durante la carga; estados terminales conservados.
- [ ] Contabilidad: periodos cerrados intactos; cola marcada como procesada sin repostear.

### 12.7 Rollback

- [ ] `down` en base desechable, en orden inverso, sin `CASCADE`.
- [ ] Restauración del backup del destino verificada con L1–L2.
- [ ] Repunte de la aplicación al origen probado en entorno aislado.
- [ ] Tiempo de restauración medido y documentado (RTO).
- [ ] Criterios del punto de no retorno (§10.3) firmados.

## 13. Criterios de aceptación de la Tarea 7

- [x] Orden de migración por dependencias documentado (§5).
- [x] Separación estructura / datos / archivos / validación (§4).
- [x] Estrategia de UUID y claves externas (§6).
- [x] Migración por dominio, incluidos usuarios, tenants, catálogo, inventario, ventas, compras y archivos (§7).
- [x] Checksums y conteos de reconciliación por tabla y tenant (§8).
- [x] Tratamiento de huérfanos, duplicados, soft delete e históricos (§9).
- [x] Rollback y restauración documentados, con punto de no retorno (§10).
- [x] Bloqueos actuales identificados (§2), incluidos PROD sin solo lectura, DEV sin datos históricos y baseline incompleto.
- [x] Propuesta de seguridad de credenciales redactada **sin implementarla** (§11).
- [x] Checklist de validación ejecutable preparado (§12).
- [ ] Ejecutar el procedimiento contra una copia de datos de prueba (bloqueado: DEV sin datos históricos; PROD sin solo lectura).
- [ ] Aprobar el baseline y el modelo de identidad antes de cargar.

## 14. Anexo: comandos del validador

```bash
# Solo lectura; la URL se lee del entorno y nunca se imprime.
export DATABASE_URL_DEV   # valor obtenido del gestor de secretos; no escribir la URL en el repo

python3 tools/database/validate_portable_schema.py --env DEV objects
python3 tools/database/validate_portable_schema.py --env DEV tenantless
python3 tools/database/validate_portable_schema.py --env DEV tenant-counts
python3 tools/database/validate_portable_schema.py --env DEV orphans
python3 tools/database/validate_portable_schema.py --env DEV indexes
python3 tools/database/validate_portable_schema.py --env DEV duplicates
python3 tools/database/validate_portable_schema.py --env DEV function-deps
python3 tools/database/validate_portable_schema.py --env DEV all --json
```

El script exige PostgreSQL 15+, abre la conexión en modo de solo lectura y aborta PROD si el usuario no es de solo lectura. No sustituye a los checksums de §8: los complementa con inventario, huérfanos, índices y duplicados.
