# Propuesta de baseline PostgreSQL portable

Fecha: 2026-11-09. Estado: core/identidad inicial implementados y aplicados en DEV; las migraciones posteriores siguen como propuesta y PROD no fue tocado.

## Alcance y evidencia

Análisis exclusivamente estático de SQL y consumidores del repositorio. No se leyeron cadenas de conexión ni se consultaron DEV/PROD. Este documento no afirma qué objetos están desplegados. Las rutas y nombres de migraciones futuras son propuestas, no archivos creados.

Fuentes principales:

- [Inventario estático existente](schema-inventory.md), limitado principalmente a `shared/`; sus conteos no equivalen al esquema final.
- [Hallazgos de fase 0](PHASE-0-FINDINGS.md) y [plan principal](../../MIGRACION_BACKEND_GO_POSTGRES.md).
- [InitDB.sql](../../shared/supabase/migrations/InitDB.sql) y [full_migration.sql](../../shared/supabase/migrations/full_migration.sql): baselines históricos alternativos, no scripts acumulables.
- [Sistema de lotes](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql), [corrección de stock](../../shared/supabase/migrations/FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql) y [corrección de compras con lotes](../../web/migrations/FIX_SP_CREATE_PURCHASE_SKIP_STOCK_DELTA_WHEN_BATCH.sql).
- [Contabilidad](../../web/migrations/ADD_ACCOUNTING_CO_MODULE.sql), [núcleo contable adicional](../../web/migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql), [periodos](../../web/migrations/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql) y migraciones propias de `mobile/migrations/`.
- [Matriz de caracterización de RPCs](rpc-characterization-matrix.md), que define las pruebas previas a trasladar lógica.

La fuente de reconstrucción debe abarcar `shared/supabase/migrations/`, `web/migrations/` y `mobile/migrations/`. Deduplicar por destino físico los enlaces simbólicos; conservar procedencia y firma de cada definición. El orden alfabético y el nombre `FIX` no establecen precedencia confiable. Los parches con SQL dinámico requieren reconstruir la definición resultante, no solo buscar `CREATE FUNCTION`.

## Decisiones propuestas

| Área | Propuesta | Condición de aceptación |
|---|---|---|
| Motor | PostgreSQL 15 como mínimo técnico; probar también la versión del hosting elegido | Arranque sobre instalación estándar sin esquemas Supabase |
| Espacio de nombres | Conservar tablas de negocio en `public` inicialmente para facilitar trazabilidad | Ninguna API de acceso directo al esquema desde clientes |
| Identificadores | Conservar UUID de negocio; `gen_random_uuid()` para nuevos registros | No regenerar IDs durante importación; mapear identidad externa explícitamente |
| Extensiones | Ninguna obligatoria en el baseline inicial; auditar usos criptográficos antes de retirar `pgcrypto` | UUID no justifica por sí solo exigir `pgcrypto` en el motor objetivo |
| Tiempo y dinero | `timestamptz` para instantes, `date` para fechas civiles; `numeric` para dinero y cantidades | Precisiones y reglas de redondeo documentadas por dominio |
| Identidad | Identidad global separada de membresías por tenant | No depender de `auth.users`, `auth.uid()` ni claims de PostgREST |
| Stock | `inventory_batches` como estado operacional; ledger `inventory_moves`; `stock_balances` como vista normal agregada inicialmente | Un solo escritor por efecto; stock disponible leído de datos actuales dentro de la transacción |
| Operaciones | Casos de uso Go coordinan; constraints, locks y primitivas transaccionales permanecen en PostgreSQL | No fragmentar una operación comercial en commits independientes |
| Eventos | Outbox persistida con la operación; envío externo posterior al commit | Reintentos sin duplicar stock, dinero ni asientos |

Estas decisiones requieren revisión; no se asume paridad hasta superar las pruebas de la matriz. Las políticas de suscripción, fechas manuales, descuentos, impuestos y redondeo hoy presentes en clientes deben validarse también en el backend futuro.

## Incompatibilidades que debe cerrar el baseline

1. `InitDB.sql` y `full_migration.sql` describen estados iniciales alternativos. No ejecutar ambos ni reproducir todo el historial sobre una base nueva.
2. `stock_balances` empieza como tabla y cambia a vista materializada mediante `DROP ... CASCADE` en `ADD_EXPIRATION_BATCHES_PHASE2.sql`. Hay funciones históricas que escriben sobre ella y otras que refrescan su contenido. El baseline debe elegir una representación única y retirar las escrituras/refrescos incompatibles en la implementación futura.
3. La compra corregida evita llamar a `fn_apply_stock_delta` si ya creó lote. Preservar esta exclusión, incluyendo efectos indirectos de triggers.
4. Ventas tiene sobrecargas y parches dinámicos: fecha manual en [ADD_POS_MANUAL_SALE_DATETIME.sql](../../web/migrations/ADD_POS_MANUAL_SALE_DATETIME.sql) y detección de firmas en [FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION_V3.sql](../../shared/supabase/migrations/FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION_V3.sql). Consolidar una firma interna explícita.
5. Hay módulos fuera de `shared/`, especialmente contabilidad e idempotencia móvil. Su ausencia en un inventario parcial no los convierte en obsoletos.
6. [RECREATE_THIRD_PARTIES.sql](../../shared/supabase/migrations/RECREATE_THIRD_PARTIES.sql) contiene una recreación destructiva. Excluir scripts de reparación, backups y diagnósticos del baseline ejecutable.
7. [FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql](../../shared/supabase/migrations/FIX_FN_IS_SUPER_ADMIN_AUTH_USER_ID.sql) interpreta una identidad sin perfil como superadministrador. Sustituir por asignación explícita; ausencia de membresía debe denegar acceso.

## Modelo de identidad y aislamiento

Propuesta lógica; los nombres nuevos deben conciliarse antes de escribir migraciones:

- `identities`: UUID global, email normalizado cuando corresponda, estado y auditoría. Vinculaciones externas en `identity_providers` con unicidad `(issuer, subject)`.
- Conservar inicialmente `users.user_id` como identificador de membresía/perfil del tenant para mantener las FK históricas. Añadir vínculo a identidad y unicidad `(tenant_id, identity_id)`; convertir `auth_user_id` en dato de correspondencia de importación, no autoridad de autorización.
- Mantener roles, permisos y asignaciones existentes, verificando que un rol asignado pertenezca al mismo tenant que el perfil. Los privilegios globales deben tener asignación independiente y explícita.
- Sesiones y refresh tokens con expiración, revocación y hash del token; credenciales locales separadas si se implementa contraseña propia. No suponer que existen hashes exportables ni copiar secretos desde archivos locales.
- Clasificar toda tabla como global, tenant directo o tenant derivado. `permissions` puede ser global; líneas, asignaciones y eventos deben mantener aislamiento aun cuando se acceda por ID directo.

Para relaciones entre entidades de tenant, preferir FK `(tenant_id, entidad_id)` contra una clave única equivalente. Una FK únicamente por UUID no demuestra que ambas filas sean del mismo tenant. Evitar cascadas de borrado sobre documentos financieros; usar desactivación y restricciones según retención funcional.

Roles PostgreSQL propuestos: propietario/migrador separado del usuario de API, usuario de worker con permisos específicos y lector para diagnóstico. Revocar ejecución a `PUBLIC` donde corresponda; no recrear ciegamente `authenticated`, `anon` ni `service_role` como sustituto de autorización.

La autorización primaria ocurre en el caso de uso y se refuerza con filtros y constraints. Si se adopta RLS portable, usar contexto local de transacción mediante `set_config('app.tenant_id', ..., true)` y un usuario sin `BYPASSRLS`; estudiar `FORCE ROW LEVEL SECURITY` y propietarios. El contexto lo establece el backend tras validar identidad y membresía, nunca un tenant enviado sin verificar. Un GUC no es una credencial: este diseño presupone que clientes no tienen acceso SQL. Probar aislamiento al reutilizar conexiones del pool y denegar acceso sin contexto.

## Orden propuesto de migraciones

Ubicación futura sugerida: `database/migrations/`, con numeración monotónica y registro de checksum. Cada archivo debe declarar dependencias, objetos, validaciones y recuperación. La secuencia siguiente crea un esquema vacío; la carga de datos se trata por separado.

| Orden / nombre orientativo | Contenido | Dependencias y revisión |
|---|---|---|
| `0001_core` | Convenciones y `tenants`; helpers SQL sin dependencias de negocio | UUID, timestamps, tipos y precisiones acordados |
| `0002_identity` | Identidades, `users`/membresías, proveedores, sesiones, roles y permisos | Tenants; privilegios globales explícitos |
| `0003_reference_settings` | Configuración, geografía, unidades, sedes, impuestos, medios de pago | Separar catálogos globales y datos por tenant |
| `0004_parties_catalog` | Clientes/terceros/proveedores, categorías, productos, variantes, códigos y precios | Identidad, referencias; revisar ciclos de categorías/BOM |
| `0005_cash_sales` | Cajas, sesiones, movimientos, contadores, ventas, líneas y pagos | Sedes, terceros, productos y métodos de pago |
| `0006_purchases` | Compras, órdenes, líneas, devoluciones y cuentas por pagar | Terceros, catálogo, identidad; posponer FK hacia inventario |
| `0007_inventory` | Lotes, movimientos, reservas, transferencias, trazabilidad y vista de saldos | Productos, sedes y documentos; completar FK diferidas por dependencia estructural |
| `0008_credit_layaway_returns` | Cartera, separados, cuotas, devoluciones de venta y reembolsos | Ventas, caja, inventario y terceros |
| `0009_manufacturing` | BOM, componentes, órdenes, outputs, asignaciones y servicios | Inventario y ventas; FK de ida/vuelta se agregan una vez existan ambas tablas |
| `0010_accounting` | Cuentas, periodos, asientos, líneas, reglas y cola contable | Documentos origen y terceros; unicidad del evento contable |
| `0011_store_billing` | Tienda, catálogo público, pedidos, reservas, planes, suscripciones y pagos | Catálogo, ventas, inventario y tenants |
| `0012_async_storage_sync` | Jobs/intentos, outbox, imports/errores, metadatos de archivos, notificaciones y checkpoints | Tablas referenciadas de todos los dominios; sin `storage.*` |
| `0013_functions` | Primitivas SQL consolidadas y funciones necesarias para triggers/vistas | Todas las tablas y firmas resueltas según matriz RPC |
| `0014_triggers_views` | Triggers de negocio y auditoría, vistas/reportes y dependencias finales | Crear funciones antes del trigger; una sola aplicación de cada efecto |
| `0015_constraints_indexes` | Constraints cruzadas restantes e índices de consultas/paginación | No duplicar índices de PK/UNIQUE; validar todas las FK |
| `0016_permissions_seeds` | Grants, políticas si se adopta RLS y seeds deterministas de referencia | Roles provisionados; sin usuarios privilegiados ni datos demo implícitos |

El orden es por dependencias lógicas y debe convertirse en un grafo de FK/funciones antes de implementarlo. Una vista usada por una función anterior debe adelantarse o la función debe retrasarse. Para ciclos, crear tablas sin las FK cíclicas y añadirlas después; no deshabilitar integridad globalmente. Checks y unicidades locales deben existir desde la creación de cada tabla.

Cada función histórica debe tener una única definición seleccionada por firma y una lista de parches incorporados. No usar sustituciones de texto sobre `pg_get_functiondef` en el baseline nuevo. En una instalación vacía los índices pueden crearse normalmente; cualquier futuro índice concurrente sobre datos existentes requiere una migración fuera de la transacción del runner.

## Sustitución de dependencias de plataforma

| Dependencia observada | Reemplazo propuesto |
|---|---|
| `auth.uid()`, `auth.jwt()`, `request.jwt.claims`, `auth.users` | Identidad/membresía explícitas y contexto transaccional validado |
| `storage.buckets`, `storage.objects`, `storage.foldername()` | Metadatos propios y claves de objeto S3; autorización de archivos en backend |
| `postgres_changes` / publicaciones Realtime | Outbox con secuencia de eventos y transporte posterior; no inferir cambios solo de timestamps |
| `pg_cron`, `pg_net`, `net.http_post`, Vault | Scheduler/worker y secretos de entorno del despliegue, fuera de funciones de negocio |
| PostgREST, `NOTIFY pgrst`, grants Supabase | Repositorios PostgreSQL y roles propios; eliminar instrucciones de recarga de schema cache |
| Edge Functions / llamadas HTTP | Adaptadores de integración; no introducir HTTP en una transacción SQL comercial |

`LISTEN/NOTIFY` puede servir como aviso opcional, pero la entrega durable debe apoyarse en una tabla/outbox. No exigir extensiones de búsqueda como `pg_trgm` para arrancar; evaluar sus índices después de medir consultas.

## Paginación y acceso a datos

Todo listado futuro debe declarar filtros, orden estable, tamaño por defecto/máximo y continuación. Propuesta inicial: 50 por defecto y 200 como máximo, ajustable por caso; exportaciones y sincronización usan lotes y contratos propios, nunca consultas ilimitadas.

| Familia | Orden y estrategia sugeridos | Índice candidato |
|---|---|---|
| Catálogos administrativos | Offset acotado o cursor por `name, id`; colación y normalización definidas | `(tenant_id, name, id)` usando la PK real |
| Ventas/compras/historial | Cursor descendente por fecha operativa y PK | Ventas `(tenant_id, sold_at DESC, sale_id DESC)` |
| Lotes/FEFO | Vencimiento con NULL explícito, recepción y `batch_id` | `(tenant_id, location_id, variant_id, expiration_date, received_at, batch_id)` |
| Jobs/historial | Cursor `created_at, job_id`; claim por prioridad y disponibilidad | Separar índice de historial del índice de claim |
| Contabilidad | Fecha, número y `entry_id`; agregados separados del detalle | Validar selectividad por tenant/periodo |
| Sync/offline | Para escaneo acotado: `(updated_at, id)`; para cambios durables: secuencia/outbox | Índice por tenant y checkpoint, con tombstones |

Estos son candidatos, no índices verificados mediante `EXPLAIN`. Todos los filtros se aplican antes del límite; no filtrar componentes/BOM en memoria después de consultar una página. Totales y sumas se calculan con los mismos filtros sobre el conjunto completo. El cursor debe vincularse al tenant, filtros, orden y versión del contrato, validarse y limitarse en tamaño.

Un desempate por ID resuelve empates pero no da un snapshot ni garantiza capturar commits tardíos de sincronización. Definir explícitamente consistencia del listado, tratamiento de actualizaciones/borrados y estrategia de checkpoint; si se necesita entrega sin omisiones, preferir un protocolo de cambios durable. Con campos mutables como saldo o stock, documentar posible desplazamiento o usar snapshot para exportaciones consistentes.

## Carga de datos y recuperación futuras

1. Aprobar baseline y contratos; aplicar estructura en PostgreSQL desechable y vacío.
2. Determinar si se preservarán datos existentes. Que no haya clientes no demuestra que los datos de configuración puedan descartarse.
3. Si se importa: crear snapshot consistente de origen, conservar UUID, registrar correspondencias de identidad y cargar referencias/tenants antes de hijos siguiendo el grafo de FK.
4. Tratar triggers durante importación explícitamente: no volver a generar movimientos, outputs ni asientos al cargar registros históricos ya derivados. Cualquier desactivación debe ser local al proceso, documentada y seguida de validación completa.
5. Migrar archivos por manifiesto de objeto, tamaño y checksum; las URLs del proveedor anterior no son las claves nuevas.
6. Reconciliar por tenant: conteos, claves, FK, suma de ventas/pagos/devoluciones, stock y reservas, débitos/créditos y eventos pendientes. No comparar solo conteos globales.
7. Ejecutar paridad y flujos completos en entorno aislado; fijar punto de corte y detener escrituras/worker del origen durante la carga final si se elige ventana de mantenimiento.
8. Conservar origen y snapshot recuperable. Antes de nuevas escrituras puede revertirse la configuración; después, un rollback necesita reconciliar escrituras nuevas o restaurar con pérdida explícitamente evaluada. No prometer rollback sin pérdida mediante un simple cambio de URL.

Nada de este procedimiento se ejecutó durante este análisis.

## Entregas paralelas y puertas de aceptación

| Paquete futuro | Responsable lógico | Puede prepararse en paralelo | Requiere antes de integrar |
|---|---|---|---|
| Identidad/tenant | Especialista de identidad | Modelo, constraints y casos negativos | Acuerdo sobre membresía y roles DB |
| Catálogo/documentos | Especialista de esquema | Grafo y baseline de tablas | Tipos, UUID e identidad acordados |
| Stock/manufactura | Especialista transaccional | Caracterización y mapa de triggers | Modelo único de saldo y firma de primitivas |
| Contabilidad/jobs | Especialista de procesos | Casos de concurrencia y recuperación | Eventos, idempotencia y lease acordados |
| Integración baseline | Un único integrador | Orden/checksums y pruebas de arranque | Revisiones de todos los paquetes |

No asignar el mismo archivo de migración a varios agentes. Cada paquete entrega procedencia de objetos, decisiones y pruebas; el integrador resuelve el grafo y orden final. Estos documentos no reasignan tareas del otro LLM ni modifican su seguimiento.

- [x] Propuesta estática de baseline y secuencia lógica documentada.
- [x] RPCs prioritarias, variantes y riesgos documentados en la matriz asociada.
- [ ] Resolver firmas y grafo completo, incluyendo triggers y SQL dinámico.
- [ ] Aprobar modelo de identidad, saldos, autorización y eventos.
- [ ] Implementar baseline nuevo y comprobar arranque vacío sin Supabase.
- [ ] Ejecutar pruebas unitarias de reglas y pruebas PostgreSQL de constraints, locks y aislamiento.
- [ ] Verificar todas las colecciones y sus límites, filtros, índices y continuación.
- [ ] Ejecutar caracterización, concurrencia y reconciliación antes del corte.

La aceptación requiere que estas verificaciones produzcan evidencia reproducible; ningún checkbox pendiente queda satisfecho solo con esta propuesta.
