# Tareas aisladas para LLM externo — PostgreSQL portable

## Propósito

Este documento asigna a un LLM externo exclusivamente el trabajo de analizar y preparar la portabilidad de la base de datos de Ofirone desde Supabase hacia PostgreSQL estándar.

El agente externo no debe implementar el backend Go, modificar web/mobile ni cambiar contratos HTTP. Su trabajo se organiza en slices independientes que puedan ejecutarse sin esperar el avance del backend principal.

## Asignación vigente — slices independientes

Esta sección reemplaza la espera pasiva por nuevas migraciones. El agente externo puede ejecutar migraciones en una base temporal desechable propia y debe entregar evidencia saneada.

### Slice A — Harness de migraciones

- Descubrir todas las migraciones `database/migrations/*.up.sql` y calcular SHA-256.
- Crear una base temporal aislada en DEV, aplicar todas las migraciones disponibles y eliminarla al finalizar.
- Ejecutar `up → down → up`, validando cero objetos residuales tras `down`.
- Validar ledger, nombres exactos, checksums, versiones consecutivas y `dirty=false`.
- Verificar que una segunda ejecución sea rechazada por el ledger.

### Slice B — Aislamiento multi-tenant

- Usar un rol temporal `NOBYPASSRLS` y dos tenants sintéticos.
- Sembrar solo datos sintéticos en la base temporal.
- Ejecutar N1–N20 sobre las tablas que existan realmente.
- Probar lecturas y escrituras cross-tenant, FKs compuestas y fuga mediante IDs ajenos.
- Clasificar cada caso como `PASS`, `BLOQ por tabla ausente` o `FAIL reproducible`.

### Slice C — Paginación y rendimiento

- Sembrar al menos 100 filas por listado disponible.
- Probar keyset con empates, páginas vacías, último cursor y cambios concurrentes controlados.
- Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` y reportar índices faltantes como propuestas.
- Confirmar que no existan duplicados u omisiones entre páginas.

### Slice D — Reconciliación sintética

- Construir un dataset reproducible para productos, inventario, ventas, compras, cartera y apartados.
- Verificar conteos, sumas, saldos, totales y relaciones entre encabezados y líneas.
- Guardar únicamente UUIDs sintéticos, dominios `.example.test` y agregados.

### Slice E — Auditoría de portabilidad

- Revisar todas las migraciones buscando `auth.*`, `storage.*`, `realtime`, extensiones no portables y funciones propietarias.
- Validar creación en PostgreSQL estándar 15+.
- Revisar RLS con usuario `NOBYPASSRLS` y documentar privilegios requeridos.
- Clasificar hallazgos como bloqueantes, riesgos o mejoras.

### Slice F — Contratos de validación para Go

- Preparar SQL de referencia para tenant, jobs, auditoría, productos, ventas e inventario.
- Documentar entradas, salidas, errores y permisos; no implementar handlers.
- Crear fixtures y pruebas de integración en `docs/database-portability/_data/`.
- No modificar `backend-go/`; el agente principal consumirá estos contratos.

Los slices A–E son independientes y pueden ejecutarse en paralelo. Si aparece una migración nueva, congelar la lista por checksum, terminar la corrida y reportarla para la siguiente.

## Priorización de validaciones por valor de producto

El agente externo debe ordenar su esfuerzo según el vertical slice activo, no según la cantidad de tablas existentes.

### P0 — Validar el MVP de negocio pequeño

Dar prioridad a:

- Identidad, tenant, membresía y roles mínimos.
- Productos, categorías, variantes, precios y búsqueda.
- Proveedores, compras, recepción y costos.
- Entradas de inventario generadas por compras.
- Existencias, kardex, ajustes, mínimos y alertas.
- Venta, líneas, métodos de pago y cierre básico de caja.
- Clientes, ventas contado/crédito y CXC.
- Abonos, saldos y vencimientos de CXC.
- Dashboard y reportes MVP: ventas, productos vendidos, inventario, compras y CXC.
- Aislamiento entre dos tenants en cada paso.
- Paginación de productos, compras, inventario, clientes, ventas y CXC.
- Conteos y sumas de inventario, ventas y pagos.

La evidencia P0 debe responder: “¿un negocio pequeño puede configurarse, comprar mercancía, recibir inventario, vender, cobrar una deuda y consultar sus indicadores sin Supabase?”.

### P1 — Validar operación administrativa

Después de cerrar P0, priorizar:

- Compras y proveedores.
- Cuentas por pagar y cartera.
- Plan separe y abonos.
- Auditoría de operaciones sensibles.
- `async_jobs` e idempotencia de tareas.
- Reportes operativos usados diariamente.

### P2 — Validar capacidades diferidas

Mantener en backlog o validar solo cuando exista implementación:

- Tienda online.
- Manufactura y BOMs.
- Mobile offline y sincronización.
- OCR, IA, realtime y notificaciones.
- Storage/media avanzado y optimizaciones no requeridas por P0.

Regla: no bloquear el avance de P0 por tablas o vistas P1/P2 ausentes. Reportarlas como `BLOQ-P1` o `BLOQ-P2`, no como fallo del producto mínimo.

## Slice G — Desbloqueo explícito de caja `0015`

Este slice queda asignado al LLM externo porque la propuesta completa ya está en
`docs/database-portability/_data/contracts/proposals/cash_sessions.sql` y fue
caracterizada en ADR-008.

### Objetivo

Convertir la propuesta de caja en migraciones productivas:

- `database/migrations/0015_cash_sessions.up.sql`
- `database/migrations/0015_cash_sessions.down.sql`

### Reglas

- Promover el SQL completo de la propuesta, no una versión parcial.
- Mantener el runner sin `BEGIN`/`COMMIT` dentro de los archivos.
- No alterar migraciones `0001–0014`.
- No modificar `backend-go`, web, mobile ni contratos HTTP.
- Aplicar primero en una base temporal aislada y ejecutar `up → down → up`.
- Aplicar después en DEV pública únicamente si la base está vacía o la migración es compatible; verificar antes y después.
- No tocar PROD.
- Calcular SHA-256 y registrar la migración en el ledger solo después de que la transacción termine correctamente.

### Validaciones obligatorias

- Tablas `cash_sessions`, `cash_movements` y `cash_session_counts`.
- Columna y FK compuesta `sales.cash_session_id`.
- RLS con rol `NOBYPASSRLS` para dos tenants.
- Una sola sesión abierta por tenant/sede bajo concurrencia.
- Movimientos append-only y sesión cerrada inmutable.
- Arqueo: `counted_cash`, `expected_cash` y `difference`.
- Venta/pago cash asociado a sesión abierta.
- Rechazo cross-tenant y de operaciones después del cierre.
- `up → down → up`, checksums y segunda ejecución mediante runner.

### Entrega

Actualizar únicamente la evidencia y documentación de portabilidad. Reportar:

```text
Estado: completada | parcial | bloqueada
Migraciones creadas:
Checksum 0015:
DEV aplicado: sí/no
Pruebas PASS/FAIL/BLOQ:
Bloqueos restantes:
Evidencia:
```

## Perímetro estricto

### Puede modificar

- `docs/database-portability/`
- `docs/decisions/` únicamente para ADRs relacionados con PostgreSQL.
- `shared/supabase/migrations/` solo si crea copias de análisis claramente marcadas, nunca alterando migraciones históricas.
- `tools/database/` para scripts de inspección o validación no destructivos.
- Este archivo, únicamente para actualizar estados y entregables propios.

### No puede modificar

- `backend/` o cualquier futuro `backend-go/`.
- `web/src/`.
- `mobile/src/`.
- `shared/contracts/`.
- `shared/jobs/`.
- `shared/sync/`.
- `shared/media/`.
- `docker-compose.yml`.
- Workflows de CI/CD.
- Integraciones de pagos, email, IA o storage.
- Migraciones productivas existentes.
- Código de autenticación o API.

Si necesita un cambio fuera de este perímetro, debe documentarlo como propuesta pendiente y no implementarlo.

## Objetivo de salida

Entregar un paquete de análisis que permita al agente principal construir PostgreSQL portable sin depender de:

- `auth.users` de Supabase.
- `storage.objects` de Supabase.
- `realtime` de Supabase.
- Extensiones o funciones propietarias no documentadas.
- RLS o funciones SQL cuyo comportamiento no esté documentado.

## Conexiones de base de datos

El agente externo debe trabajar con las bases de desarrollo y producción cuando estén disponibles, pero las credenciales no deben escribirse en este documento, en commits ni en mensajes de colaboración.

Variables requeridas:

```bash
DATABASE_URL_DEV=postgres://...
DATABASE_URL_PROD=postgres://...
```

Reglas de acceso:

- [ ] Usar `DATABASE_URL_DEV` para exploración, pruebas y validación de migraciones.
- [ ] Usar `DATABASE_URL_PROD` únicamente para consultas de inventario, conteos y validaciones no destructivas.
- [ ] La conexión de producción debe usar un usuario de solo lectura.
- [ ] No ejecutar `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE`, `GRANT` ni migraciones directamente contra producción.
- [ ] No imprimir las URLs completas en logs, reportes ni capturas.
- [ ] En reportes, identificar la conexión solo como `DEV` o `PROD`.
- [ ] Verificar el host y la base antes de cada operación.
- [ ] Aplicar timeout de conexión y límites de tiempo de consulta.
- [ ] Si producción no tiene usuario de solo lectura, detener el análisis de producción y reportarlo como bloqueo.

Ejemplo de carga local segura:

```bash
set -a
source .env.database.local
set +a

psql "$DATABASE_URL_DEV" -c 'select current_database(), current_user, version();'
```

El archivo `.env.database.local` debe permanecer fuera de Git y debe estar incluido en `.gitignore`. Nunca crear un `.env` con credenciales reales dentro del repositorio.

Validación mínima antes de analizar una base:

```sql
select current_database(), current_user, current_schema();
select current_setting('server_version');
```

Si las URLs aún no fueron entregadas al agente, debe continuar con análisis estático del repositorio y marcar las tareas que requieren conexión como `bloqueadas por credenciales faltantes`.

## Tareas

### 1. Inventario del esquema actual

- [x] Enumerar todas las tablas, vistas, materialized views, funciones, triggers, secuencias, índices, constraints y enums.
- [x] Clasificar cada objeto como: negocio, autenticación, storage, realtime, auditoría, soporte o legado.
- [x] Identificar objetos duplicados, obsoletos o con nombres inconsistentes.
- [x] Registrar dependencias entre tablas y funciones.
- [x] Registrar columnas sensibles, datos personales y datos financieros.
- [x] Registrar tablas con `tenant_id`, tablas sin aislamiento explícito y tablas globales.

Entregable: `docs/database-portability/schema-inventory.md`.

### 2. Inventario de dependencias Supabase

- [x] Buscar referencias a `auth.uid()`, `auth.users`, `auth.jwt()`, `storage.*`, `realtime`, `supabase_functions` y APIs propietarias.
- [x] Identificar funciones que dependan de headers o claims Supabase.
- [x] Identificar políticas RLS que deban convertirse en autorización de aplicación.
- [x] Identificar extensiones PostgreSQL disponibles solo en ciertos proveedores.
- [x] Identificar URLs, buckets y nombres de funciones Edge usados por SQL.
- [x] Clasificar cada dependencia por dificultad de reemplazo: baja, media o alta.

Entregable: `docs/database-portability/supabase-dependencies.md`.

### 3. Diseño del modelo de identidad portable

No implementar autenticación. Solo documentar el modelo de datos necesario.

- [x] Proponer tablas para usuarios, tenants, membresías, roles, permisos, sesiones y refresh tokens.
- [x] Definir claves, constraints, índices y relaciones.
- [x] Definir qué datos deben migrarse desde `auth.users`.
- [x] Definir estrategia de hash de contraseñas sin incluir secretos reales.
- [x] Definir campos de auditoría y revocación de sesiones.
- [x] Documentar compatibilidad con un proveedor OIDC futuro.

Entregable: `docs/database-portability/identity-schema-proposal.md`.

### 4. Diseño de aislamiento multi-tenant

- [x] Revisar todas las tablas y marcar si necesitan `tenant_id` directo o derivado.
- [x] Detectar relaciones que podrían permitir acceso cruzado entre tenants.
- [x] Proponer constraints y claves compuestas donde sean necesarias.
- [x] Documentar qué controles deben quedar en PostgreSQL y cuáles en Go.
- [x] Proponer una estrategia opcional de PostgreSQL RLS portable, sin depender de Supabase.
- [x] Crear casos negativos de prueba: tenant A intentando leer o modificar datos de tenant B.

Entregable: `docs/database-portability/multitenancy-isolation.md`.

### 5. Portabilidad de RPCs y funciones SQL

- [x] Enumerar todas las funciones SQL/RPC.
- [x] Clasificarlas como:
  - mantener como función PostgreSQL;
  - trasladar a caso de uso Go;
  - dividir entre SQL transaccional y lógica Go;
  - eliminar por obsolescencia.
- [x] Documentar parámetros, retornos, efectos secundarios y permisos de cada RPC crítico.
- [x] Identificar funciones que deben conservar atomicidad.
- [x] Identificar funciones que requieren locks o `FOR UPDATE`.
- [x] Señalar funciones con riesgo de duplicación o doble aplicación.

Entregable: `docs/database-portability/rpc-migration-matrix.md`.

### 6. Paginación y consultas de listados

No crear endpoints. Analizar únicamente consultas y estructura de datos.

- [x] Enumerar todos los listados de web y mobile que consultan tablas o RPCs.
- [x] Identificar listados sin límite, con paginación incompleta o con orden no determinista.
- [x] Proponer índices para filtros, ordenamiento y cursor pagination.
- [x] Definir qué listados requieren total exacto y cuáles pueden usar `has_next`.
- [x] Detectar joins que puedan multiplicar filas o producir conteos incorrectos.
- [x] Documentar queries de referencia con `EXPLAIN` esperado.

Entregable: `docs/database-portability/pagination-query-matrix.md`.

### 7. Migración y reconciliación de datos

- [x] Diseñar orden de migración respetando dependencias.
- [x] Separar migración de estructura, datos, archivos y validación.
- [x] Definir estrategia para UUIDs y claves externas.
- [x] Definir cómo migrar usuarios, tenants, productos, inventario, ventas, compras y archivos.
- [x] Definir checksums o conteos de reconciliación por tabla y tenant.
- [x] Definir tratamiento para datos huérfanos, duplicados, soft deletes y registros históricos.
- [x] Documentar rollback o procedimiento de restauración.

Entregable: `docs/database-portability/data-migration-runbook.md`.

### 8. Scripts no destructivos

Solo crear scripts que inspeccionen o validen. No borrar, truncar ni modificar datos.

- [x] Crear script para listar objetos del esquema.
- [x] Crear script para detectar tablas sin `tenant_id`.
- [x] Crear script para contar registros por tenant.
- [x] Crear script para detectar foreign keys rotas o registros huérfanos.
- [x] Crear script para detectar índices faltantes en columnas de filtro.
- [x] Crear script para validar duplicados en claves de negocio.
- [x] Crear script para generar un reporte de dependencias de funciones SQL.

Los scripts deben:

- [x] Ser idempotentes.
- [x] Tener modo solo lectura por defecto.
- [x] Requerir una confirmación explícita para cualquier operación que no sea lectura.
- [x] No imprimir secretos ni datos personales completos.
- [x] Documentar versión mínima de PostgreSQL.

## Criterios técnicos

- PostgreSQL objetivo: documentar una versión mínima, preferiblemente PostgreSQL 15 o superior.
- Usar UUID o bigint de forma consistente; no mezclar sin justificación.
- Preferir `timestamptz` para fechas operativas.
- Usar `numeric` para valores monetarios, nunca `float`.
- Definir timezone de forma explícita.
- Evitar `SELECT *` en consultas documentadas.
- Toda clave de negocio debe tener constraint o índice único con alcance de tenant cuando aplique.
- Toda operación crítica debe poder ejecutarse dentro de una transacción.
- No asumir que el proveedor ofrece extensiones propietarias.

## Tests y validaciones requeridas

- [x] Validar que el esquema se puede crear en PostgreSQL estándar sin Supabase.
- [x] Validar migraciones desde una base vacía.
- [x] Validar migraciones sobre una copia de datos de prueba (sintética; copia real pendiente).
- [x] Validar constraints e índices.
- [x] Validar aislamiento entre dos tenants (N1–N20, runner real).
- [x] Validar conteos y sumas de inventario, ventas, compras y cartera.
- [x] Validar que las consultas paginadas no duplican ni omiten filas entre páginas.
- [x] Validar que la segunda ejecución de una migración no rompe el esquema (runner Go real, no-op).

> **Estado de validaciones (2026-11-09):** tres suites en bases temporales
> aisladas (creadas y eliminadas). (1) Identidad `0001–0003`: **28 PASS**.
> (2) Negocio `0001–0022`: **62 PASS, 0 FAIL, 0 BLOQ, 1 HALLAZGO** (N1–N8,
> N11–N15, N18–N20 de tabla; ventas 50, inventario 98, compras 100, cartera
> 100/30 y 20, apartados 100/20/80; ledger consecutivo/exacto/limpio y rechazo
> de duplicado). (3) Paginación `0012`: **24 PASS** (130 filas ×9 listados,
> empates, página vacía, cambio concurrente, EXPLAIN con índices).
> Bloqueado: N9, N10, N16, N17, `fn_claim/fn_complete`, PostgreSQL 15 real y
> datos reales. Hallazgos: idempotencia y **auditoría mutable**. Añadidos: migración sobre datos sintéticos (`0001–0011`→`0012`) PASS,
> roles propuestos PASS y contrato del ledger 9/9. Fixtures SQL validados (38 tablas,
> 2 tenants). Hallazgo: migraciones no idempotentes (`42P06`); el ledger debe
> impedir re-aplicar. **PostgreSQL 15 real bloqueado**: Docker sin permisos
> (`permission denied` sobre `/var/run/docker.sock`); **runner Go real** aplicó `0015`
> y la segunda ejecución fue no-op (`validation-go-runner-db-0015.txt`).
> Slice E: auditoría sin Supabase/extensiones (37/38 con RLS+FORCE; owner con
> BYPASSRLS = riesgo). Slice F: contratos, fixtures y roles propuestos.
> Evidencias: `validation-disposable-2026-11-09.txt`,
> `validation-business-0022-2026-11-09.txt`,
> `validation-pagination-0012-2026-11-09.txt`,
> `validation-migration-over-data-0012.txt`,
> `validation-runtime-roles-0012.txt`,
> `validation-ledger-contract-0012.txt`,
> `portability-audit-0012-2026-11-09.md`.
> **P0 (nuevo):** 18 PASS, 0 FAIL, resultado PARCIAL; brecha P0 `sales.customer_id`
> (no se puede atribuir la venta a un cliente) y BLOQ-P1 cierre de caja.
> Evidencia: `validation-p0-sell-flow-0012.txt`. Propuestas ADR-007/008 y contrato N
> validados en bases desechables (`validation-adr-007-proposal.txt`,
> `validation-adr-008-proposal.txt`, `validation-pending-n-cases-0012.txt`);
> siguen pendientes las propuestas de cliente/caja (`0014`/`0015`); `0013` (idempotencia) ya está aplicada.
> **P1 lifecycle:** 8 PASS, 0 FAIL, 1 BLOQ-P1 (conversión apartado→venta),
> 2 HALLAZGOS (transiciones de estado y sobrepago CxP); evidencia
> `validation-p1-lifecycle-0012.txt`. Las guardas y la auditoría append-only
> están validadas como propuestas ADR-009/010 (`validation-p1-guards-proposal.txt`).
> Go 1.22.12 (`go test ./...`) pasó **13 paquetes**, incluido `internal/migrations`
> (`validation-go-suite-0015.txt`). El runner real aplicó `0015` en base desechable
> y la segunda ejecución fue no-op (`validation-go-runner-db-0015.txt`).

## Formato de entrega del agente externo

Al finalizar cada tarea, entregar un reporte con:

```text
Tarea:
Estado: completada | parcial | bloqueada
Archivos creados/modificados:
Hallazgos principales:
Riesgos:
Decisiones recomendadas:
Pruebas ejecutadas:
Dependencias para otros agentes:
```

## Prohibiciones explícitas

- No comenzar una reescritura en Go.
- No modificar clientes web o mobile.
- No cambiar rutas HTTP ni respuestas de API.
- No desplegar infraestructura.
- No borrar migraciones históricas.
- No ejecutar migraciones destructivas sobre DEV pública o PROD. En una base temporal propia sí puede ejecutar `up/down` como parte de los slices A–D.
- No cambiar secretos, credenciales o configuraciones de producción.
- No asumir que un comportamiento de Supabase es parte de PostgreSQL estándar sin documentarlo.

## Segunda tanda de slices — post-0020

El paquete `0001–0020` ya está validado. Estas tareas son independientes y no
deben esperar nuevas migraciones del backend Go.

### Slice H — Seguridad de evidencias

- Redactar o hashear `meta.user` y `meta.db` en snapshots.
- Ajustar `tools/database/db_snapshot.py` para no persistir nombres internos.
- Añadir patrones al escáner de secretos y demostrar que pasa.
- No tocar backend Go, migraciones ni bases.

### Slice I — Auditoría append-only

- Diseñar y validar trigger que rechace `UPDATE`/`DELETE` sobre `audit_log`.
- Revocar esos privilegios al rol runtime.
- Validar RLS y tenant cruzado en base temporal.
- Crear migración solo si es necesaria y entregar evidencia separada.

### Slice J — Acceso seguro de autenticación

- Validar el rol `ofirone_auth` con privilegios mínimos.
- Confirmar consulta por email/tenant sin lectura cross-tenant.
- Probar revocación de sesión y refresh token consumido.
- Usar roles temporales en base aislada; eliminar al finalizar.

### Slice K — Runner Go real

- Aplicar `0001–0020` con el runner Go real en una base temporal.
- Registrar ledger y checksums.
- Reejecutar y demostrar que no repite SQL.
- Ejecutar `up → down → up`.
- Reportar diferencias frente al harness Python.

### Slice L — Reconciliación y performance P0

- Sembrar fixtures sintéticos de catálogo, inventario, clientes, ventas y caja.
- Validar conteos, sumas y reconciliación encabezado-líneas-pagos-stock.
- Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` de listados P0.
- Validar keyset de productos, variantes, clientes, inventario y ventas.

Usar bases temporales desechables; no usar datos reales ni modificar DEV pública.

### Slice M — Documentación de cierre

- Corregir referencias a “Tarea 9” o formalizarla como cierre QA.
- Añadir `verify_migration_checksums.py` al README de herramientas.
- Actualizar estado a `0020`, separando `PASS`, `HALLAZGO` y `BLOQ-P2`.
- No modificar arquitectura Go ni frontend.

### Reglas de coordinación

- H, I, J, K, L y M pueden ejecutarse en paralelo.
- Usar archivos de evidencia con prefijo del slice: `validation-H-*`.
- No sobrescribir reportes de otro slice.
- Si hay edición concurrente, crear un archivo nuevo y reportarlo.
- Cada entrega debe incluir archivos, comandos, PASS/FAIL/BLOQ, riesgos y dependencias.

## Estado

| Tarea | Estado | Entregable | Bloqueos |
|---|---|---|---|
| Inventario de esquema | Completada (análisis estático) | [`schema-inventory.md`](docs/database-portability/schema-inventory.md); [reporte 01](docs/database-portability/reports/01-task.md) | PROD sin usuario de solo lectura; DEV sin datos históricos |
| Dependencias Supabase | Completada (análisis estático) | [`supabase-dependencies.md`](docs/database-portability/supabase-dependencies.md); [reporte 02](docs/database-portability/reports/02-task.md) | PROD sin usuario de solo lectura; DEV sin datos históricos |
| Modelo de identidad | Completada (propuesta; DDL aplicado en DEV) | [`identity-schema-proposal.md`](docs/database-portability/identity-schema-proposal.md); [reporte 03](docs/database-portability/reports/03-task.md); ADR [005](docs/decisions/ADR-005-modelo-identidad-portable.md) y [006](docs/decisions/ADR-006-credenciales-migracion-y-oidc.md) | Validación de aislamiento/rollback pendiente; PROD bloqueado |
| Multi-tenancy | Completada (análisis estático) | [`multitenancy-isolation.md`](docs/database-portability/multitenancy-isolation.md); [reporte 04](docs/database-portability/reports/04-task.md); ADR en [`ADR-003`](docs/decisions/ADR-003-aislamiento-multi-tenant.md) | PROD sin usuario de solo lectura; DEV sin datos históricos; pruebas negativas N1–N20 diseñadas, no ejecutadas |
| RPCs | Completada (análisis estático; 265 firmas) | [`rpc-migration-matrix.md`](docs/database-portability/rpc-migration-matrix.md); [reporte 05](docs/database-portability/reports/05-task.md); ADR [`ADR-004`](docs/decisions/ADR-004-rpc-sql-vs-go.md); insumos en [`_data/listings-and-rpcs.md`](docs/database-portability/_data/listings-and-rpcs.md) | PROD sin usuario de solo lectura; DEV sin datos históricos; caracterización de RPCs no ejecutada |
| Paginación SQL | Completada (análisis estático) | [`pagination-query-matrix.md`](docs/database-portability/pagination-query-matrix.md); [reporte 06](docs/database-portability/reports/06-task.md); insumos en [`_data/listings-and-rpcs.md`](docs/database-portability/_data/listings-and-rpcs.md) | PROD sin usuario de solo lectura; DEV sin datos históricos; `EXPLAIN` no ejecutado |
| Migración de datos | Completada (runbook; no ejecutado) | [`data-migration-runbook.md`](docs/database-portability/data-migration-runbook.md); [reporte 07](docs/database-portability/reports/07-task.md) | PROD sin usuario de solo lectura; DEV sin datos históricos; sin datos de prueba para reconciliar |
| Scripts de validación | Completada (herramientas; 7/7 ejecutados read-only en DEV baseline; suite aislada 28 PASS) | [`tools/database/`](tools/database/) ([7 scripts SQL](tools/database/01_list_schema_objects.sql) + validadores [portable](tools/database/validate_portable_schema.py)/[disposable](tools/database/validate_disposable_env.py), [README](tools/database/README.md)); [reporte 08](docs/database-portability/reports/08-task.md) | Negocio/PROD bloqueados: sin esquema de negocio portable, sin copia de datos, PROD sin rol read-only |
| Validaciones de ejecución | Slices A–J completados; K bloqueado; L completo; M cerrado; EXT-18 resuelto; 62 PASS, 1 hallazgo | [`business-0025`](docs/database-portability/_data/validation-business-0025-2026-11-10.txt), [`pagination-0012`](docs/database-portability/_data/validation-pagination-0012-2026-11-09.txt), [`auditoría`](docs/database-portability/_data/portability-audit-0012-2026-11-09.md), [`contratos`](docs/database-portability/_data/contracts/README.md) | K bootstrap ledger, PG15, datos reales, PROD read-only |
| Brechas P1/P2 | P1 parcial: ciclo de vida básico 8 PASS, 2 hallazgos, 1 BLOQ-P1; P2 BLOQ | [`P1-P2-GAP-ANALYSIS.md`](docs/database-portability/P1-P2-GAP-ANALYSIS.md), [`validation-p1-lifecycle-0012`](docs/database-portability/_data/validation-p1-lifecycle-0012.txt) | Conversión apartado→venta, guards ADR-009 |
| Propuestas P0/P1 | ADR-007 implementada en `0014`; ADR-008 en `0015` (DEV aplicado) | [`ADR-007`](docs/decisions/ADR-007-venta-cliente.md), [`ADR-008`](docs/decisions/ADR-008-caja-sesiones.md), [`proposals/`](docs/database-portability/_data/contracts/proposals/) | — |
| Guardas/auditoría | ADR-009 aplicada en `0022`; ADR-010 en `0021` | [`ADR-009`](docs/decisions/ADR-009-guardas-integridad-p1.md), [`ADR-010`](docs/decisions/ADR-010-auditoria-append-only.md), [`validation-I`](docs/database-portability/_data/validation-I-audit-append-only-2026-11-09.txt) | — |
| Credenciales auth | ADR-011 validado: función `find_login` por email/tenant; sin lectura de tabla | [`ADR-011`](docs/decisions/ADR-011-credenciales-auth-rls.md), [`validation-J`](docs/database-portability/_data/validation-J-auth-secure-2026-11-09.txt) | Cambio de backend para usar `find_login` |
| Reportes operativos | Contratos SQL ejecutados 8/8 (fixtures) | [`report_queries.sql`](docs/database-portability/_data/contracts/report_queries.sql), [`validation-report-queries`](docs/database-portability/_data/validation-report-queries-0012.txt) | Repetir con datos reales |
| Contratos N | N1–N20 PASS en el esquema real (`0017–0020`) | [`PENDING-N-CASES.md`](docs/database-portability/_data/contracts/PENDING-N-CASES.md), [`validation-business-0025`](docs/database-portability/_data/validation-business-0025-2026-11-10.txt) | — |
| P0 flujo de venta | PASS (21 PASS, 0 FAIL) | [`validation-p0-sell-flow-0015`](docs/database-portability/_data/validation-p0-sell-flow-0015-2026-11-09.txt) | Solo P2 en backlog |
| Slice G caja 0015 | Completado y aplicado en DEV | [`validation-cash-0015`](docs/database-portability/_data/validation-cash-0015-2026-11-09.txt), checksum `14b83b…` | — |
| Slice H | Seguridad de evidencias PASS | [`validation-H`](docs/database-portability/_data/validation-H-evidence-security-2026-11-09.txt) | — |
| Slice I | Auditoría append-only `0021` aplicada en DEV | [`validation-I`](docs/database-portability/_data/validation-I-audit-append-only-2026-11-09.txt) | — |
| Slice J | Auth con función por email/tenant; sin lectura de tabla | [`validation-J`](docs/database-portability/_data/validation-J-auth-secure-2026-11-09.txt) | Cambio de backend para usar `find_login` |
| Slice K | **BLOQ**: runner no bootstrapea ledger; 0003 choca (`42P07`) | [`validation-K`](docs/database-portability/_data/validation-K-runner-full-2026-11-09.txt) | Diseño runner/bootstrap |
| Slice L | PASS: 130 variantes y 26 PASS | [`validation-L`](docs/database-portability/_data/validation-L-reconciliation-perf-2026-11-09.txt) | — |
| Credenciales 0016 | Aplicado en DEV; RLS lectura correcta; runtime sin escritura | [`validation-identity-credentials-0016`](docs/database-portability/_data/validation-identity-credentials-0016.txt) | Definir rol/escritura de credenciales |
## Tareas paralelas asignadas — track externo

Estas tareas son independientes del track frontend/auth Go. No modificar `web/**`,
`backend-go/internal/auth/**`, `backend-go/cmd/api/**` ni `backend-go/internal/httpapi/**`.

### EXT-01 — Auditoría de migraciones y ledger

- Alcance: revisar `database/migrations/0001–0023` y referencias documentales.
- Archivos permitidos: `docs/database-portability/**`, `TAREAS_LLM_EXTERNO_POSTGRES.md`.
- No aplicar migraciones sobre PROD.
- Verificar versiones consecutivas, nombres, checksums y referencias a `0021`, `0022` y `0023`.
- Ejecutar únicamente validaciones read-only.
- Entregable: reporte saneado en `docs/database-portability/_data/` y actualización de casillas.
- Criterio de aceptación: cero versiones duplicadas, cero referencias al antiguo `0021_auth_login_lookup`.

### EXT-02 — Cobertura de pruebas P0

- Alcance: auditar cobertura de clientes, catálogo, inventario, ventas, caja y paginación.
- Archivos permitidos: `docs/database-portability/**`, `backend-go/**/_test.go` solo si se trata de tests aislados sin cambiar producción.
- No modificar lógica de negocio ni contratos HTTP.
- Identificar casos faltantes: tenant cruzado, cursor repetido, idempotencia, errores 401/403/409 y transacciones fallidas.
- Entregable: matriz de pruebas propuesta y, si procede, tests unitarios aislados.
- Criterio de aceptación: cada caso incluye entrada, resultado esperado y archivo objetivo.

### EXT-03 — Validación de portabilidad SQL

- Alcance: revisar que las migraciones no dependan de `auth.*`, PostgREST, funciones Supabase o extensiones no declaradas.
- Archivos permitidos: `docs/database-portability/**` y reportes en `_data/`.
- No cambiar migraciones sin coordinación previa.
- Entregable: reporte de dependencias residuales y severidad.
- Criterio de aceptación: cada hallazgo incluye migración, objeto, dependencia y alternativa PostgreSQL estándar.

### EXT-04 — Evidencia y documentación de ejecución

- Alcance: comprobar que las evidencias estén saneadas, reproducibles y no contengan URLs, tokens, emails reales ni secretos.
- Archivos permitidos: `docs/database-portability/_data/**` y README/QA relacionados.
- Solo lectura sobre DEV; PROD prohibido.
- Entregable: lista de evidencias válidas, obsoletas y faltantes.
- Criterio de aceptación: ningún archivo nuevo expone credenciales y todos los comandos omiten valores sensibles.

### Coordinación

- Si una tarea detecta un cambio concurrente en sus archivos permitidos, debe detenerse y reportarlo.
- No renumerar migraciones ni modificar el ledger DEV sin registrar antes el checksum y coordinar con el track principal.
- Cada tarea debe terminar con: archivos modificados, comandos ejecutados, resultado y bloqueos.

## Paquete siguiente para el LLM externo — tareas independientes

Estas tareas quedan preparadas para asignación futura. No hay agentes activos en este momento.
Todas son paralelas al track frontend/auth y no deben modificar `web/**`,
`backend-go/internal/auth/**`, `backend-go/internal/httpapi/**` ni `backend-go/cmd/api/**`.

### EXT-05 — Resolver referencias documentales antiguas

- Revisar referencias que todavía describen DEV como vacía.
- Actualizar solo documentación histórica, conservando fecha y contexto.
- No modificar snapshots ni inventar datos de PROD.
- Aceptación: cada referencia indica si es histórica, vigente o pendiente.

### EXT-06 — Reconciliar migraciones 0021–0023

- Verificar nombres, checksums, `up/down` y orden consecutivo.
- Confirmar que `0021` sea auditoría, `0022` guardas P1 y `0023` auth lookup.
- No aplicar migraciones sobre PROD.
- Aceptación: reporte sin duplicados y con checksum SHA-256 saneado.

### EXT-07 — Validar runner Go en base desechable

- Ejecutar `up → down → up` con el runner real.
- Confirmar ledger, locks, `dirty=false` y no-op en segunda ejecución.
- Usar solo base temporal aislada.
- Aceptación: evidencia reproducible sin credenciales.

### EXT-08 — Tests de paginación keyset

- Cubrir empate de orden, cursor inválido, último cursor, página vacía y límite máximo.
- Revisar productos, clientes, inventario y ventas.
- Solo tests y evidencia; no cambiar handlers.
- Aceptación: cero duplicados y omisiones entre páginas.

### EXT-09 — Tests de aislamiento N1–N20

- Reejecutar N1–N20 con dos tenants y rol `NOBYPASSRLS`.
- Clasificar PASS, FAIL o BLOQ con causa exacta.
- No usar datos reales.
- Aceptación: matriz completa con evidencia saneada.

### EXT-10 — Auditoría de privilegios PostgreSQL

- Revisar grants de runtime, migrador y auth.
- Confirmar que el rol normal no tenga `BYPASSRLS`.
- Confirmar que `ofirone_auth` solo tenga permisos necesarios.
- Aceptación: matriz rol → schema → tabla → operación.

### EXT-11 — Revisión de funciones `SECURITY DEFINER`

- Detectar funciones con `SECURITY DEFINER` y verificar `search_path` fijo.
- Reportar owners, grants públicos y riesgo de escalada.
- No cambiar funciones sin aprobación.
- Aceptación: cero funciones inseguras sin ticket documentado.

### EXT-12 — Verificación de triggers de integridad

- Probar auditoría append-only, guardas de compras, pagos y apartados.
- Confirmar códigos SQLSTATE esperados.
- Usar base temporal o datos sintéticos controlados.
- Aceptación: evidencia por trigger y operación inválida.

### EXT-13 — Revisión de contratos HTTP

- Comparar handlers Go con clientes frontend existentes.
- Detectar diferencias de rutas, nombres JSON, errores y paginación.
- No modificar frontend ni handlers.
- Aceptación: tabla contrato esperado vs contrato actual.

### EXT-14 — Revisión de secretos y logs

- Ejecutar scanner sobre código, docs y evidencias.
- Confirmar que no se impriman URLs, JWT, hashes ni contraseñas.
- Revisar logs de auth y migraciones.
- Aceptación: cero secretos y lista de falsos positivos justificados.

### EXT-15 — Pruebas de concurrencia

- Probar idempotencia de ventas, locks del runner y refresh tokens concurrentes.
- Usar tests de carrera y base temporal.
- No modificar lógica de producción.
- Aceptación: resultados deterministas y errores esperados.

### EXT-16 — Matriz de cierre P0

- Revisar auth, clientes, catálogo, inventario, ventas y caja.
- Marcar cada slice como PASS, PARCIAL o BLOQ.
- Asociar test, evidencia y responsable.
- Aceptación: matriz lista para seguimiento sin casillas ambiguas.
| EXT-01 migraciones/ledger | Completada (read-only) | 23 archivos consecutivos, 0 duplicados, checksums; 0023 pendiente | [`EXT-01`](docs/database-portability/_data/EXT-01-migration-ledger-audit-2026-11-09.md) | 0023 no aplicada; wrapper BEGIN/COMMIT |
| EXT-02 cobertura P0 | Completada (matriz) | Casos faltantes: cursor repetido, 401/403/409, transacción fallida | [`EXT-02`](docs/database-portability/_data/EXT-02-P0-TEST-COVERAGE.md) | Implementar tests |
| EXT-03 portabilidad SQL | Completada | Sin Supabase/PostgREST/extensiones; 0023 requiere ajuste | [`EXT-03`](docs/database-portability/_data/EXT-03-portability-audit-2026-11-09.md) | 0023 search_path/wrapper |
| EXT-04 evidencias | Completada | Saneamiento PASS; faltan evidencias 0023/K | [`EXT-04`](docs/database-portability/_data/EXT-04-evidence-audit-2026-11-09.md) | — |

### Estado EXT-05…16

| Tarea | Estado | Evidencia | Bloqueo |
|---|---|---|---|
| EXT-05 referencias | PASS | [`EXT-05`](docs/database-portability/_data/EXT-05-doc-references-2026-11-09.md) | — |
| EXT-06 migraciones 0021–0023 | PASS estructural | [`EXT-06`](docs/database-portability/_data/EXT-06-migrations-0021-0023-2026-11-09.md) | 0023 no aplicada |
| EXT-07 runner | **BLOQ** | [`EXT-07`](docs/database-portability/_data/EXT-07-runner-2026-11-09.md) | bootstrap ledger |
| EXT-08 paginación | PASS 29 | [`EXT-08`](docs/database-portability/_data/EXT-08-pagination-2026-11-09.md) | — |
| EXT-09 N1–N20 | PASS | [`EXT-09`](docs/database-portability/_data/EXT-09-isolation-2026-11-09.md) | — |
| EXT-10 privilegios | **FAIL** | [`EXT-10`](docs/database-portability/_data/EXT-10-privileges-audit-2026-11-09.md) | `ofirone_auth` BYPASSRLS |
| EXT-11 SECURITY DEFINER | PASS con riesgo | [`EXT-11`](docs/database-portability/_data/EXT-11-security-definer-2026-11-09.md) | owner bypass |
| EXT-12 triggers | PASS | [`EXT-12`](docs/database-portability/_data/EXT-12-triggers-audit-2026-11-09.md) | — |
| EXT-13 HTTP | PARCIAL | [`EXT-13`](docs/database-portability/_data/EXT-13-http-contracts-2026-11-09.md) | rutas clientes |
| EXT-14 secretos | PASS | [`EXT-14`](docs/database-portability/_data/EXT-14-secrets-logs-2026-11-09.md) | — |
| EXT-15 concurrencia | PASS parcial | [`EXT-15`](docs/database-portability/_data/EXT-15-concurrency-2026-11-09.md) | locks runner |
| EXT-16 cierre P0 | PARCIAL | [`EXT-16`](docs/database-portability/_data/EXT-16-p0-closure-2026-11-09.md) | auth/runner/PG15 |

## Paquete paralelo siguiente — EXT-17…EXT-24

Estas tareas no deben modificar `backend-go/internal/httpapi/menus.go`,
`backend-go/internal/auth/pgstore.go`, `database/migrations/0024*` ni el
entorno DEV compartido. Cada tarea debe dejar evidencia y actualizar solo sus
archivos permitidos.

### EXT-17 — Runner desde base vacía

- Alcance: corregir el bootstrap del ledger y validar `up -> down -> up`.
- Permitido: `backend-go/internal/migrations/**`, sus tests y documentación del runner.
- Prohibido: cambiar migraciones de negocio o tocar DEV/PROD.
- Aceptación: base desechable, 24 migraciones, ledger exacto, segunda ejecución sin duplicados.

### EXT-18 — Rol runtime sin BYPASSRLS

- Alcance: diseñar y documentar el rol de runtime `NOBYPASSRLS`.
- Permitido: `database/migrations/0025_runtime_role*`, `tools/database/**`, evidencia saneada.
- Prohibido: alterar el owner de DEV o PROD.
- Aceptación: prueba reproducible donde una consulta cross-tenant sea rechazada.

### EXT-19 — Contratos HTTP de listados

- Alcance: completar contratos y tests de productos, clientes, inventario y ventas.
- Permitido: `backend-go/internal/httpapi/*_test.go`, documentación de contratos.
- Prohibido: modificar handlers productivos.
- Aceptación: tests para 200, 400, 401, cursor inválido y respuesta paginada.

### EXT-20 — Pruebas de menú por rol

- Alcance: validar aislamiento y filtrado de `GET /api/v1/me/menu`.
- Permitido: tests HTTP y fixtures desechables; no editar `menus.go`.
- Aceptación: ADMINISTRADOR y CAJERO reciben menús distintos; ningún tenant filtra datos.

### EXT-21 — Reconciliación ALMIRA

- Alcance: generar reporte read-only de conteos, códigos y relaciones migradas.
- Permitido: `tools/database/validate_roles_menus.py` y `docs/database-portability/_data/**`.
- Prohibido: escribir en Supabase; no imprimir credenciales ni datos personales.
- Aceptación: diferencias clasificadas como `PASS`, `MISSING` o `MAPPED`.

### EXT-22 — Contrato de configuración local

- Alcance: documentar variables necesarias para levantar Go + Vite localmente.
- Permitido: `.env.example`, READMEs y documentación.
- Prohibido: incluir secretos reales.
- Aceptación: una persona nueva puede iniciar ambos servicios con comandos reproducibles.

### EXT-23 — Refresh y expiración JWT

- Alcance: tests de refresh concurrente, revocación y sesión expirada.
- Permitido: `backend-go/internal/auth/*_test.go` y evidencia.
- Prohibido: cambiar el algoritmo o claves de producción.
- Aceptación: refresh usado una sola vez y sesión revocada rechazada.

### EXT-24 — Auditoría de cambios del paquete

- Alcance: revisar diffs del paquete EXT-17…23 y detectar cruces de archivos.
- Permitido: reporte en `docs/database-portability/_data/EXT-24-review.md`.
- Prohibido: editar código de otros slices.
- Aceptación: matriz de archivos, riesgos, comandos ejecutados y estado final.

### Estado EXT-17…24

| Tarea | Estado | Evidencia | Bloqueo |
|---|---|---|---|
| EXT-17 runner | **BLOQ** | [`EXT-17`](docs/database-portability/_data/EXT-17-runner-2026-11-10.md) | bootstrap ledger (0003/0024 wrappers) |
| EXT-18 rol runtime | **PASS (ledger 25)** | [`EXT-18`](docs/database-portability/_data/EXT-18-runtime-role-2026-11-10.md), [`validation-EXT-18`](docs/database-portability/_data/validation-EXT-18-auth-role-fix-2026-11-10.txt) | — |
| EXT-19 HTTP | **PASS** | [`EXT-19`](docs/database-portability/_data/EXT-19-http-tests-2026-11-10.md), [`tests`](docs/database-portability/_data/validation-EXT-19-20-23-tests-2026-11-10.txt) | ruta legacy del cliente web |
| EXT-20 menús | **PASS** | [`EXT-20`](docs/database-portability/_data/EXT-20-menu-tests-2026-11-10.md), [`tests`](docs/database-portability/_data/validation-EXT-19-20-23-tests-2026-11-10.txt) | — |
| EXT-21 ALMIRA | PARCIAL | [`EXT-21`](docs/database-portability/_data/EXT-21-almira-2026-11-10.md) | sin fuente legacy |
| EXT-22 config | PASS | [`EXT-22`](docs/database-portability/_data/EXT-22-local-config-2026-11-10.md) | — |
| EXT-23 refresh/JWT | **PASS** | [`EXT-23`](docs/database-portability/_data/EXT-23-refresh-jwt-2026-11-10.md), [`tests`](docs/database-portability/_data/validation-EXT-19-20-23-tests-2026-11-10.txt) | — |
| EXT-24 auditoría | PASS | [`EXT-24`](docs/database-portability/_data/EXT-24-review-2026-11-10.md) | — |

## Paquete paralelo MVP — EXT-25…EXT-32

Estas tareas son independientes del track activo de ventas y CXC. No tocar
`backend-go/internal/sales/**`, `backend-go/internal/receivables/**`,
`web/src/services/sales.service.js`, `web/src/services/credit.service.js`,
ni reiniciar o modificar la base DEV compartida salvo que una tarea lo indique.
Cada slice debe incluir tests, `gofmt`/lint correspondiente y evidencia saneada.

### EXT-25 — Contrato completo de productos

- Alcance: documentar y probar el payload MVP de producto, categoría, unidad y variante.
- Permitido: `backend-go/internal/catalog/**`, tests y documentación de contrato.
- Prohibido: modificar ventas, compras, CXC o migraciones existentes.
- Aceptación: contrato JSON `snake_case`, tenant impuesto por JWT, errores 400/401/422 y tests HTTP.

### EXT-26 — Escritura de variantes desde HTTP

- Alcance: completar `POST /api/v1/variants` con UUID automático, validación de SKU y producto del mismo tenant.
- Permitido: `backend-go/internal/catalog/**`, `backend-go/internal/httpapi/*variant*test.go`.
- Prohibido: tocar el frontend o crear datos en DEV.
- Aceptación: creación válida, SKU duplicado rechazado, cross-tenant rechazado y rollback sin residuos.

### EXT-27 — Ajustes de inventario

- Alcance: contrato y tests de `POST /api/v1/inventory/movements` para entradas, salidas y ajustes.
- Permitido: `backend-go/internal/inventory/**`, tests HTTP y documentación.
- Prohibido: modificar compras/ventas.
- Aceptación: delta positivo/negativo, stock insuficiente rechazado, idempotencia y aislamiento tenant.

### EXT-28 — Stock general paginado

- Alcance: endpoint de stock general que no exija simultáneamente `location_id` y `variant_id`.
- Permitido: `backend-go/internal/httpapi/inventory.go`, store de inventario, tests.
- Prohibido: cambiar el contrato existente de ventas.
- Aceptación: filtros opcionales, keyset sin duplicados/omisiones y respuesta estable para frontend.

### EXT-29 — Adaptador frontend de productos

- Alcance: conectar creación/edición de productos y variantes al backend Go detrás de `VITE_USE_BACKEND_CATALOG`.
- Permitido: `web/src/services/products.service.js`, clientes backend y tests del servicio.
- Prohibido: tocar POS, compras, ventas o CXC.
- Aceptación: fallback legacy apagado, payload snake_case, errores visibles y tests unitarios.

### EXT-30 — Adaptador frontend de inventario

- Alcance: conectar ajustes y listado de stock al backend Go detrás de `VITE_USE_BACKEND_INVENTORY`.
- Permitido: `web/src/services/inventory.service.js`, clientes backend y tests.
- Prohibido: modificar ventas o compras.
- Aceptación: listado paginado, ajuste positivo/negativo, bloqueo de stock insuficiente y fallback controlado.

### EXT-31 — E2E productos/inventario aislado

- Alcance: prueba reproducible en base desechable con producto, variante, ajuste y lectura de stock.
- Permitido: `tools/database/**`, `docs/database-portability/_data/**`.
- Prohibido: datos reales, PROD o DEV pública.
- Aceptación: evidencia saneada con create → adjust → list → invalid adjustment.

### EXT-32 — Revisión de cierre MVP

- Alcance: auditar EXT-25…31, verificar cruces y actualizar matriz de estado.
- Permitido: `docs/database-portability/_data/EXT-32-review.md`.
- Prohibido: editar código de otros slices.
- Aceptación: matriz de archivos, tests ejecutados, bloqueos y recomendación de cierre.

### Estado EXT-25…32

| Tarea | Estado | Evidencia | Bloqueo |
|---|---|---|---|
| EXT-25 contrato productos | PARCIAL | tests base de productos/listados | faltan categoría/unidad y contrato completo |
| EXT-26 variantes HTTP | PARCIAL | handler existente | falta UUID automático y cross-tenant explícito |
| EXT-27 ajustes inventario | PARCIAL | tests de movimiento existentes | falta idempotencia/concurrencia HTTP |
| EXT-28 stock general | **PASS** | [`validation-EXT-28`](docs/database-portability/_data/validation-EXT-28-stock-2026-11-10.txt) | — |
| EXT-29 frontend productos | PARCIAL | flags/adaptador parcial | falta CRUD backend de productos |
| EXT-30 frontend inventario | PARCIAL | `listBackendStockBalances` conectado | falta E2E |
| EXT-31 E2E aislado | PENDIENTE | — | depende de EXT-25…30 |
| EXT-32 revisión | PENDIENTE | — | depende de EXT-25…31 |

## Paquete de cierre transversal — EXT-33…EXT-40

### EXT-33 — Clientes CRUD Go

- Completar `GET/POST/PATCH/DELETE /api/v1/customers` y adaptador frontend.
- Validar tenant, documento único, desactivación segura y paginación.

### EXT-34 — Productos CRUD Go

- Completar create/update/deactivate de producto y variantes con el modelo MVP.
- No tocar ventas, compras ni CXC.

### EXT-35 — Inventario operacional

- Completar ajustes, transferencias, alertas y movimientos paginados.
- Probar stock insuficiente, idempotencia y concurrencia.

### EXT-36 — Compras completas

- Completar detalle, devolución, cuentas por pagar y pagos a proveedores.
- Mantener las operaciones transaccionales y los lotes.

### EXT-37 — Ventas completas

- Completar detalle, anulación, devoluciones y pagos desde frontend Go.
- Probar reversión de inventario e idempotencia.

### EXT-38 — CXC completo

- Completar cargos por venta, movimientos, cuenta individual y resumen.
- Validar saldo, límite y abonos concurrentes.

### EXT-39 — Dashboard y reportes MVP

- Implementar consultas Go para ventas, compras, inventario y CXC.
- Todos los listados deben tener límites y filtros por tenant.

### EXT-40 — E2E final del MVP

- Ejecutar flujo aislado: cliente → producto → compra → inventario → venta → CXC → reporte.
- Entregar evidencia saneada y matriz de operaciones cerradas.

## Paquete maestros de configuración — EXT-41…EXT-46

### EXT-41 — Ubicaciones

- CRUD Go/frontend, tenant aislado y paginación.

### EXT-42 — Métodos de pago

- CRUD Go/frontend; tipos `cash`, `card`, `transfer`, `credit`, `other`.

### EXT-43 — Monedas y configuración regional

- Catálogo de monedas y configuración de moneda por tenant; validar ISO-4217.

### EXT-44 — Unidades y categorías

- CRUD Go/frontend, jerarquía de categorías y decimales de unidad.

### EXT-45 — Impuestos

- CRUD Go/frontend, tasa inclusiva/exclusiva y validación 0–100.

### EXT-46 — Integración de maestros

- Reemplazar lecturas Supabase en productos, ventas, compras e inventario.
- Prueba E2E: maestro → producto → compra → venta.
