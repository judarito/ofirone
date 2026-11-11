# Matriz de caracterización de RPCs críticas

Fecha: 2026-11-08. Estado: análisis estático; ninguna prueba contra DB ejecutada.

## Cómo interpretar la matriz

Esta es una selección de operaciones críticas, no el inventario completo de todas las funciones. Una firma encontrada no prueba que esté desplegada ni que sea la versión final. «Observado» describe el archivo citado; «propuesto» expresa comportamiento objetivo que debe aprobarse. Las funciones auxiliares también deben caracterizarse aunque no tengan un consumidor HTTP directo.

Raíces usadas en las tablas: **S** = `shared/supabase/migrations/`; **W** = `web/migrations/`; **M** = `mobile/migrations/`. Los nombres de parámetros se conservan; tipos abreviados: `U` = UUID, `J` = JSONB, `N` = NUMERIC, `T` = TEXT, `I` = INTEGER, `B` = BOOLEAN, `TZ` = TIMESTAMPTZ. Consultar la fuente para valores por defecto; los principales se detallan abajo.

Destino propuesto: **SQL** conserva una primitiva transaccional PostgreSQL; **mixto** combina un caso de uso Go con SQL bajo la misma transacción; **worker** desplaza la coordinación de procesos a Go. No se propone eliminar funciones críticas por falta de llamadas directas: pueden ser invocadas por triggers u otras funciones.

## Contratos y procedencia

| ID / prioridad | RPC y entradas observadas | Retorno | Fuentes y variantes | Consumidor identificado / destino propuesto |
|---|---|---|---|---|
| R01 / P0 | `sp_create_sale(p_tenant U, p_location U, p_cash_session U, p_customer U, p_sold_by U, p_lines J, p_payments J, p_note T [, p_third_party U, p_sold_at TZ])` | UUID de venta | S `SpVistasFN.sql`, `UPDATE_SP_CREATE_SALE_FE.sql`, `FIX_SALE_ROUNDING.sql`; W `ADD_POS_MANUAL_SALE_DATETIME.sql`; variantes con 7/8/9/10 argumentos detectadas por wrapper de tienda | `web/src/services/sales.service.js`, `mobile/src/services/pos.service.js`; mixto |
| R02 / P0 | `sp_create_sale_idempotent(p_operation_id T, p_tenant U, p_location U, p_cash_session U, p_customer U, p_sold_by U, p_lines J, p_payments J, p_note T, p_third_party U = NULL, p_sold_at TZ = NULL)` | UUID de venta existente/nueva | M `ADD_IDEMPOTENT_MOBILE_SALES.sql`, `FIX_IDEMPOTENT_SALE_ERROR_MESSAGES.sql`, `ADD_POS_MANUAL_SALE_DATETIME_IDEMPOTENT.sql`; variante anterior sin fecha | `mobile/src/services/pos.service.js`; mixto |
| R03 / P0 | `sp_create_return_v2(p_tenant U, p_sale_id U, p_created_by U, p_lines J, p_refunds J, p_reason T = NULL)` | UUID de devolución | S `ADD_SALE_RETURNS_REFUNDS_V2.sql`; delega en `sp_create_return` | Servicios de ventas web/mobile; mixto |
| R04 / P0 | `sp_create_purchase(p_tenant U, p_location U, p_supplier_id U, p_created_by U, p_lines J, p_note T = NULL)` | UUID de compra | S `SpVistasFN.sql`, `ADD_PURCHASES_TABLE.sql`, `INTEGRATE_BATCHES_WITH_PURCHASES.sql`, `FIX_BATCH_NUMBER_BY_LOCATION.sql`; W `FIX_SP_CREATE_PURCHASE_SKIP_STOCK_DELTA_WHEN_BATCH.sql` | `mobile/src/services/purchases.service.js`; revisar también flujos de compra web y recepción; mixto |
| R05 / P0 | `sp_receive_purchase_order_partial(p_tenant U, p_purchase_order_id U, p_created_by U, p_lines J, p_note T = NULL)` | UUID de compra generada | S `ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql`; wrapper de recepción total | Servicios de compras web/mobile; mixto |
| R06 / P0 | `sp_create_purchase_return(p_tenant U, p_purchase_id U, p_created_by U, p_lines J, p_note T = NULL)` | UUID de devolución de compra | S `ADD_PURCHASE_RETURNS_CORE.sql` | `web/src/services/purchases.service.js`; mixto |
| R07 / P0 | `fn_apply_stock_delta(p_tenant U, p_location U, p_variant U, p_delta N)` | VOID | S `SpVistasFN.sql`, `full_migration.sql`, `FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql` | Funciones de compras/inventario; SQL consolidado |
| R08 / P0 | `fn_allocate_stock_fefo(p_tenant U, p_location U, p_variant U, p_qty_needed N)` | OUT `total_allocated N`, `has_sufficient_stock B`, `allocation_details J`, `warnings J` | S `ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql` | Funciones de ventas y asignación; SQL |
| R09 / P0 | `fn_consume_batch_stock(p_tenant U, p_batch_id U, p_qty_to_consume N, p_from_reserved B = FALSE)` | VOID | S `ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql` | Ventas/separados y otras funciones; SQL |
| R10 / P0 | `fn_consume_bom_components(p_tenant U, p_location U, p_bom U, p_quantity N, p_source_type T, p_source_id U, p_created_by U)` | TABLE `success B, total_cost N, components_consumed J, bom_snapshot J` | S `MANUFACTURING_PHASE3_ON_DEMAND.sql`, `FIX_PRODUCTION_COMPLETE.sql`, `FIX_CONSUME_BOM_REFERENCE_TYPE.sql` | Venta ON_DEMAND y producción; mixto |
| R11 / P0 | `fn_complete_production(p_production_order U, p_quantity_produced N, p_completed_by U, p_expiration_date DATE = NULL, p_physical_location T = NULL)` | UUID de lote | S `MANUFACTURING_PHASE456_FINAL.sql`, `FIX_PRODUCTION_COMPLETE.sql`, `FIX_MANUFACTURED_COST_PRICE_AUTO_UPDATE.sql` | Servicios de manufactura web e inventario mobile; mixto |
| R12 / P0 | `fn_accounting_post_entry(p_tenant_id U, p_entry_id U, p_posted_by U = NULL)` | JSONB con `success`, `message`; algunos errores incluyen débitos/créditos | W `ADD_ACCOUNTING_CO_MODULE.sql`, `ADD_ACCOUNTING_COMPETITIVE_CORE.sql`, `ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql` | `web/src/services/accounting.service.js`; mixto |
| R13 / P0 | `fn_accounting_process_queue(p_tenant_id U, p_limit I = 50, p_only_event_id U = NULL)` | JSONB de resultado y contadores; fijar claves al seleccionar versión | W `ADD_ACCOUNTING_QUEUE_PROCESSOR.sql`, `ADD_ACCOUNTING_COMPETITIVE_CORE.sql`, `FIX_ACCOUNTING_QUEUE_PROCESSOR_SERVICE_ROLE.sql` | Servicio contable web; worker/SQL |
| R14 / P0 | `fn_claim_async_jobs(p_queue T, p_worker_id T, p_limit I = 10, p_lock_seconds I = 300)` | SETOF `async_jobs` | S `ADD_ASYNC_JOB_QUEUE.sql` | `backend/src/workers/asyncJobsClient.js`; worker/SQL |
| R15 / P0 | `fn_complete_async_job(p_job_id U, p_worker_id T, p_result J = '{}', p_completed_with_warnings B = FALSE)` | VOID | S `ADD_ASYNC_JOB_QUEUE.sql` | Mismo cliente worker; SQL |
| R16 / P0 | `fn_fail_async_job(p_job_id U, p_worker_id T, p_error J = '{}', p_retryable B = TRUE)` | VOID | S `ADD_ASYNC_JOB_QUEUE.sql` | Mismo cliente worker; worker/SQL |

En R01 los corchetes describen variantes, no una firma SQL ejecutable. No decidir precedencia por nombre de archivo. La selección final debe incluir descuentos porcentuales/fijos, impuestos incluidos, FEFO, manufactura, tercero y fecha manual que correspondan al producto.

## Efectos, atomicidad y permisos

| ID | Efectos observados o dependencias que deben seguirse | Bloqueos/idempotencia observados | Autorización y riesgo a resolver |
|---|---|---|---|
| R01 | Cabecera, líneas, pagos, numeración, movimientos, consumo de lotes, trazabilidad y rama manufacturada según variante; algunas versiones refrescan saldos | Depende de contador y auxiliares; no asumir idempotencia de la llamada regular | Validación de caja/variante por tenant en versiones revisadas; falta reconstruir permisos y triggers completos. Un parámetro tenant no autoriza |
| R02 | Registro `mobile_sale_operations` y llamada a R01; guarda estado SUCCESS o intenta guardar FAILED | `pg_advisory_xact_lock(hashtext(p_operation_id))`, consulta por `operation_id FOR UPDATE`; reusa resultado SUCCESS | La búsqueda observada no incluye tenant ni hash de payload. El error relanzado puede revertir también la escritura FAILED; no asumir auditoría durable |
| R03 | Llama devolución base, inserta `sale_return_refunds` y compara suma redondeada con total | Atomicidad de devolución y reembolsos en una llamada; locking depende de función base | Métodos de pago activos del tenant; revisar acumulado devuelto, stock/caja y sus triggers; no confundir registro de reembolso con transferencia externa |
| R04 | Compra, lotes opcionales, movimiento PURCHASE_IN y total | El parche web aplica delta solo cuando no creó lote; no se observó clave de idempotencia en esa firma | Verifica variante activa del tenant; completar validación de sede/proveedor/actor y evitar doble stock por triggers |
| R05 | Incrementa `qty_received`, llama R04 y cambia orden a PARTIAL/RECEIVED | Bloquea cabecera `FOR UPDATE`; incremento condicionado a no superar pedido | Verificar que `variant_id` y costo enviados coincidan con línea real: el cuerpo usa datos del JSON para construir la compra |
| R06 | Cabecera/líneas de devolución, consulta devoluciones previas, movimiento de salida y delta de stock | En tramo revisado no bloquea documento origen al sumar cantidades ya devueltas | Riesgo de dos devoluciones concurrentes excediendo cantidad comprada; costo enviado por cliente y lectura de saldos requieren validación |
| R07 | Versión inicial escribe saldos; corrección escribe lotes con salidas FEFO y entrada a lote genérico | La corrección recorre lotes sin `FOR UPDATE` explícito en el SELECT; UPDATE posterior no basta para validar la lectura previa | Consolidar un único modelo; no usar un agregado materializado desactualizado para autorizar consumo |
| R08 | Lee configuración de vencimiento y produce asignaciones/advertencias; no confundir asignación con consumo persistido | `FOR UPDATE SKIP LOCKED` en candidatos; orden por vencimiento y recepción | Un lote bloqueado puede parecer stock faltante. Agregar desempate `batch_id` y definir espera/reintento; no copiar política de cola sin evaluar stock |
| R09 | Reduce `on_hand`; si viene de reservado reduce también `reserved` | `SELECT ... FOR UPDATE` por tenant y lote; verifica disponibilidad | Validar cantidad estrictamente positiva, actor y operación origen; la función aislada no aporta idempotencia |
| R10 | Valida BOM, asigna/consume componentes, guarda costos/snapshot y referencias | Depende de `fn_allocate_fefo_for_component` y helpers; prevalidar disponibilidad no garantiza exclusión concurrente | Hay consultas a BOM/líneas por ID sin tenant explícito; revisar FK, permisos y referencias SALE/PRODUCTION |
| R11 | Consume BOM, inserta `production_outputs`, trigger genera lote/movimiento, recalcula costo/precio y completa orden | En versión de actualización de costos no hay `FOR UPDATE` en lectura de orden | Firma no recibe tenant; derivarlo desde orden autorizada. Doble cierre puede duplicar consumo; cero produce riesgo de división por cero |
| R12 | Verifica periodo OPEN y balance; actualiza DRAFT a POSTED | Bloqueo de cabecera `FOR UPDATE`; errores de negocio como JSON, no siempre excepción | `SECURITY DEFINER`; exige perfil por `auth.uid()`. Bloquear edición concurrente de líneas y coordinar cierre del periodo |
| R13 | Toma eventos, deduplica por origen, crea asientos/líneas y cambia estados; maneja errores por evento | `FOR UPDATE SKIP LOCKED`; búsqueda de asiento previo no sustituye UNIQUE | `SECURITY DEFINER`; bypass condicionado a `service_role` en claims. La versión revisada inserta POSTED directamente: comprobar si evita validación de periodo |
| R14 | Cambia a processing, incrementa attempts y asigna lease | CTE con `FOR UPDATE SKIP LOCKED`; orden prioridad/run_after/created_at; límite mínimo 1, sin máximo explícito | Grant a `service_role`; coordinación global de cola debe usar rol worker específico. Candidatos excluyen processing incluso con lease vencido |
| R15 | Completa job, libera lease e inserta intento | Bloquea job por ID, pero no verifica estado processing, `locked_by`, expiración ni token de lease | `p_worker_id` queda como auditoría; un worker anterior podría completar trabajo reasignado. Repetir llamada puede duplicar intentos |
| R16 | Pasa a waiting_retry/failed/dead_letter, calcula backoff, libera lease e inserta intento | Bloquea job por ID; mismo problema de ownership; backoff 30s exponencial hasta 3600s en versión revisada | No permitir degradar un job completado por un fallo tardío. Recuperación de processing abandonado requiere diseño adicional |

Todos los efectos comerciales de una operación deben confirmar o revertir juntos, incluida su outbox. Las llamadas a pagos, correo, IA o storage quedan fuera de esa transacción y requieren deduplicación propia. Los grants históricos de Supabase no se copian al baseline portable.

## Matriz de pruebas de caracterización pendiente

Cada caso debe capturar entrada, salida/SQLSTATE, filas antes/después, efectos de triggers y estado tras rollback. Comparar invariantes y valores monetarios, no UUID aleatorios ni texto completo de errores. Un defecto conocido se registra como observación y se acompaña de la corrección objetivo, nunca como paridad obligatoria.

| ID | Caso normal y bordes | Fallo/rollback | Concurrencia, reintento e invariantes |
|---|---|---|---|
| R01 | Venta simple y mixta; descuento fijo/porcentaje, impuesto incluido, redondeo, varios pagos; servicio/ON_DEMAND/TO_STOCK; tercero y fecha manual | Caja cerrada/otro tenant; variante inactiva; pagos insuficientes; fecha futura o anterior a apertura; error en última línea | Dos ventas por últimas unidades; numeración única; stock y pagos aplicados una vez; no quedan cabeceras ni eventos parciales |
| R02 | Repetir operación exitosa devuelve el mismo sale_id; payload con/sin fecha | Fallar venta y observar si persiste FAILED; rechazar misma clave con payload distinto en contrato objetivo | Dos llamadas simultáneas; misma clave en tenants distintos; objetivo UNIQUE `(tenant_id, operation_id)` y hash de payload, sin fuga de resultado |
| R03 | Devolución parcial/total, varios medios y sumas con redondeo | Reembolsos vacíos/no positivos o suma distinta; método de otro tenant; rollback también de función base | Dos devoluciones simultáneas sobre misma línea no exceden vendido; retry no duplica reposición ni registro de caja |
| R04 | Compra con lote/vencimiento y sin lote; varios costos/cantidades | Variante ajena/inactiva, cantidad/costo inválidos, fallo en segunda línea | Una entrada neta por línea incluso con triggers; solicitudes duplicadas con clave objetivo devuelven misma compra |
| R05 | Primera recepción parcial y recepción final; conservar saldo pendiente | Exceso de saldo, orden cancelada, línea ajena, variante/costo alterados, fallo en compra | Dos recepciones concurrentes nunca exceden pedido; retry de la misma recepción no aumenta `qty_received` dos veces |
| R06 | Devolución parcial/total según compra origen y costo autorizado | Stock insuficiente, devolución acumulada excesiva, documento ajeno; rollback de movimientos | Dos solicitudes concurrentes no superan cantidad original; saldo lote/ledger coherente y efecto financiero revisado |
| R07 | Deltas positivo, negativo y cero; lotes vencidos/genéricos | Stock insuficiente a mitad del recorrido revierte todos los lotes; variante ajena | Dos descuentos sobre mismo stock no generan negativo ni pérdida de actualización; entradas simultáneas no duplican lote genérico indebidamente |
| R08 | FEFO, empate de vencimiento/recepción, NULL, reservas y vencidos según configuración | Cantidad inválida; configuración ausente; suficientes unidades físicamente pero bloqueadas | Medir comportamiento con locks competidores; orden estable por batch_id; asignación y consumo bajo misma transacción |
| R09 | Consumo disponible y reservado exacto/parcial | Cero/negativo, lote ajeno/inexistente, consumo mayor al saldo | Dos consumos concurrentes; `0 <= reserved <= on_hand` cuando la política lo exija; retry de operación origen no consume de nuevo |
| R10 | BOM con merma, opcionales, varios lotes y snapshot de versión | Ciclo BOM, componente faltante, BOM ajeno; fallo tras consumir primer componente | BOM concurrentes comparten últimos componentes; rollback total; suma de costos y vínculos de trazabilidad consistentes |
| R11 | Cierre válido, vencimiento y actualización de costo/precio | Cantidad cero/negativa/excesiva, orden ajena/inexistente/estado inválido; error del trigger | Doble cierre simultáneo y retry generan un solo output/consumo; lote retornado existe y pertenece al tenant |
| R12 | Asiento balanceado en periodo abierto, autor correcto | Sin membresía, periodo cerrado, líneas vacías/desbalanceadas | Postear vs editar líneas o cerrar periodo; impedir posteo parcial y cambio posterior de documento inmutable |
| R13 | Eventos venta/compra, evento único, límite y mezcla de éxitos/fallos | Cuentas ausentes, origen inexistente/anulado, periodo cerrado | Dos workers; evento duplicado; reintento de fallo sin duplicar asiento; UNIQUE por origen; aislar fallo de un evento del resto |
| R14 | Cola con prioridades, run_after futuro y máximo de intentos | Cola/worker inválidos; límite negativo/excesivo; rollback no incrementa intentos definitivamente | Dos workers no reclaman mismo job; caída tras claim; recuperación lease vencido y nuevo token/version; límite máximo explícito |
| R15 | Completar normal/con advertencias con resultado vacío | Job ausente, worker incorrecto, lease vencido, estado inválido | Completar dos veces y worker antiguo tras reclaim; objetivo compare-and-set por lease, una sola transición/intento |
| R16 | Error retryable, último intento, error definitivo, backoff | Mismo conjunto de ownership/estado de R15 | Fallo tardío tras completion, retry duplicado y carrera complete/fail; no reabrir job terminal ni duplicar intento |

## Decisiones de diseño previas a la reescritura

1. **Límite transaccional:** el caso de uso abre una transacción y pasa ese contexto a todos los repositorios. Venta, stock, pago registrado y evento no deben usar conexiones independientes. Locks se adquieren en orden documentado para reducir deadlocks; definir retries acotados para deadlock/serialización solo cuando la operación es idempotente.
2. **Idempotencia:** clave por tenant y tipo de operación, hash de solicitud, resultado estable y restricción única. No usar la clave global histórica para autorizar acceso. Diferenciar deduplicación de efecto de registro durable de errores después de un rollback.
3. **Jobs:** lease con propietario y token/version de intento; completar/fallar mediante actualización condicional. Acordar heartbeat, expiración, recuperación y límites. La garantía es entrega al menos una vez con efectos idempotentes, no exactly-once externo.
4. **Stock:** elegir política de espera frente a lotes bloqueados; `SKIP LOCKED` evita espera pero puede omitir stock utilizable. No consultar snapshots materializados para decidir disponibilidad. Preservar trazabilidad y asignación dentro de la misma transacción.
5. **Triggers:** para cada tabla, inventariar BEFORE/AFTER y funciones invocadas. Si se mueve un efecto a Go, retirar su duplicación SQL en la implementación futura y probar ambas rutas. Eliminar un trigger sin trasladar su efecto rompe paridad.
6. **Errores:** distinguir rechazo de negocio, autorización, conflicto de concurrencia y fallo transitorio. R12/R13 usan JSON de negocio donde otras RPCs lanzan excepciones; el adaptador debe normalizar sin convertir `success:false` en éxito HTTP.
7. **Privilegios:** preferir ejecución con permisos del invocador. Si se conserva `SECURITY DEFINER`, fijar `search_path` seguro, cualificar objetos y revisar ownership y grants. No inferir privilegios desde claims SQL configurables por un cliente.

## Dependencias auxiliares y ampliación de cobertura

| Familia pendiente | Motivo para incluirla en siguiente revisión |
|---|---|
| `sp_create_return`, contadores de ventas y triggers de caja/crédito | R01/R03 delegan efectos; la atomicidad no se demuestra leyendo solo el wrapper |
| `fn_create_batch`, reserva/liberación, `fn_allocate_fefo_for_component` y refresh de saldos | R04/R07–R11 dependen del modelo único de inventario |
| Validación de BOM, creación de output y cálculo de precios | Costos y consumo ON_DEMAND/TO_STOCK atraviesan varias funciones/triggers |
| `fn_accounting_is_period_open`, cierre/reapertura, posting rules y enqueue contable | Consistencia entre cola automática y posteo manual |
| `fn_enqueue_async_job`, dedupe y cancelación | El ciclo claim/complete/fail no basta para demostrar recuperación de toda la cola |
| Confirmación de pedido online, pagos/webhooks y suscripciones | Reutilizan venta y pueden duplicar cobros, reservas o entregas si se repiten |
| Separados, cartera, traslados y conciliación de caja | Operaciones con dinero o inventario fuera de las 16 firmas priorizadas |

Para cada familia adicional registrar la firma exacta, procedencia, consumidor, efectos, privilegios y casos de prueba antes de marcar cobertura completa.

## Evidencia requerida y seguimiento

Preparación futura de fixtures: dos tenants, usuarios con/sin permisos, sedes cruzadas, variantes con impuesto/descuento, lotes con expiraciones iguales y NULL, órdenes abiertas/canceladas, periodos abiertos/cerrados y jobs en cada estado. Los importes son datos sintéticos; no usar PII ni secretos reales.

Pruebas unitarias cubren reglas puras como redondeo, validación de cantidades, backoff y hash de solicitud. Pruebas de integración PostgreSQL cubren constraints, triggers, transacciones, RLS y locks; mocks no demuestran esas propiedades. Las pruebas concurrentes necesitan al menos dos conexiones y sincronización explícita para reproducir la carrera. Ejecutarlas en una base desechable es trabajo posterior, no realizado aquí.

- [x] Firmas prioritarias y fuentes estáticas localizadas.
- [x] Riesgos y destino propuesto registrados para R01–R16.
- [x] Casos de caracterización, rollback, concurrencia y reintento definidos.
- [ ] Seleccionar definición consolidada de cada firma y rastrear auxiliares/triggers.
- [ ] Acordar invariantes objetivo y diferencias deliberadas frente a defectos históricos.
- [ ] Implementar fixtures y capturar comportamiento del esquema reconstruido en entorno aislado.
- [ ] Ejecutar paridad contra implementación portable y archivar resultados por ID.
- [ ] Revisar cobertura de familias adicionales antes de retirar RPCs antiguas.

No hay validación de esquema desplegado ni resultados de tests en este documento. La secuencia propuesta de estructura y datos está en [baseline-proposal.md](baseline-proposal.md).
