# Portabilidad PostgreSQL — índice del paquete

- **Fecha:** 2026-11-09
- **Plan:** [TAREAS_LLM_EXTERNO_POSTGRES.md](../../TAREAS_LLM_EXTERNO_POSTGRES.md) (Tareas 1–8; este índice, los ADRs y la QA son el cierre documental de apoyo)
- **Contexto:** [MIGRACION_BACKEND_GO_POSTGRES.md](../../MIGRACION_BACKEND_GO_POSTGRES.md) — documento de contexto; **no editado** por este plan.
- **Alcance:** análisis y documentación. No se modifica backend, web, mobile, contratos, docker-compose ni migraciones históricas.

Este directorio reúne el paquete de análisis para sustituir Supabase por PostgreSQL estándar. Los entregables 1–6 son **análisis estático** del corpus de migraciones; el snapshot inicial de DEV mostró una base vacía y desde entonces se aplicó el baseline portable `0001`–`0025` (49 tablas, 2 vistas, 16 funciones, 50 políticas RLS, **sin datos históricos**). PROD está bloqueado por política (el usuario no es de solo lectura), por lo que no se analiza. Ningún entregable afirma el estado del esquema Supabase desplegado.

## Estado de las bases

| Entorno | Acceso | Estado | Consecuencia |
|---|---|---|---|
| DEV | Conectable | Baseline `0001`–`0025` aplicado: 49 tablas + 2 vistas, 16 funciones, 50 políticas RLS, 732 constraints, 198 índices, 39 triggers y 82 FKs (snapshot `_data/dev-schema.json`). PostgreSQL 18.6. **Sin datos históricos.** | No sirve como origen de datos; sí valida la estructura del baseline |
| PROD | Bloqueado | Usuario con `CREATE`, no solo lectura | No se analiza por política; no ejecutar SQL |
| Baseline portable | DEV / base desechable | `0001`–`0020` aplicados (cliente, idempotencia, caja, credenciales, N9/N10, vistas y claim); faltan guardas ADR-009/010 | Validación P2 y datos reales pendiente |

Ver [DEV-STATUS-2026-11-09.md](DEV-STATUS-2026-11-09.md), [schema-inventory.md §2.2](schema-inventory.md#L68-L76) y [database/migrations/README.md](../../database/migrations/README.md).

> **Cambio de premisa durante la reanudación.** Los entregables 1–6 se produjeron cuando DEV estaba vacía y así lo declaran sus secciones de estado. Durante el cierre documental, una ejecución paralela aplicó `0001`–`0003` en DEV y dejó constancia en [DEV-STATUS-2026-11-09.md](DEV-STATUS-2026-11-09.md); el snapshot `_data/dev-schema.json` se refrescó después (identificadores de infraestructura redactados). Los análisis históricos siguen siendo válidos como inventario del esquema Supabase; lo que cambió es que DEV ya no es una base vacía, aunque sigue **sin datos de negocio**.

## Entregables por tarea

| # | Tarea | Documento | Estado | Bloqueos |
|---:|---|---|---|---|
| 1 | Inventario del esquema | [schema-inventory.md](schema-inventory.md) | Completada (estático) | PROD/DEV; esquema desplegado no observado |
| 2 | Dependencias Supabase | [supabase-dependencies.md](supabase-dependencies.md) | Completada (estático) | PROD/DEV; RLS real no inventariada |
| 3 | Identidad portable | [identity-schema-proposal.md](identity-schema-proposal.md), [identity-implementation.md](identity-implementation.md) | Completada (propuesta; DDL del baseline aplicado en DEV) | Validación de aislamiento/rollback pendiente |
| 4 | Aislamiento multi-tenant | [multitenancy-isolation.md](multitenancy-isolation.md) | Completada (estático) | N1–N20 diseñados, no ejecutados |
| 5 | RPCs y funciones | [rpc-migration-matrix.md](rpc-migration-matrix.md), [rpc-characterization-matrix.md](rpc-characterization-matrix.md) | Completada (estático; 265 firmas) | Caracterización no ejecutada |
| 6 | Paginación y listados | [pagination-query-matrix.md](pagination-query-matrix.md) | Completada (estático) | `EXPLAIN` no ejecutado |
| 7 | Migración y reconciliación | [data-migration-runbook.md](data-migration-runbook.md) | Completada (runbook; no ejecutado) | PROD; DEV sin datos históricos |
| 8 | Scripts no destructivos | [tools/database/](../../tools/database/) | Completada (herramientas) | Ejecución SQL/semántica pendiente |
| Cierre | ADRs, índice, reportes y estado | este README, [reports/](reports/), [QA-REPORT.md](QA-REPORT.md) | Completada | Aprobación de ADRs pendiente |

Documentos de soporte: [baseline-proposal.md](baseline-proposal.md) (fuente única y orden lógico), [PHASE-0-FINDINGS.md](PHASE-0-FINDINGS.md) (hallazgos iniciales) y [`_data/`](_data/) (artefactos reproducibles: JSON y `listings-and-rpcs.md`).

## ADRs

| ADR | Decisión | Estado | Usado por |
|---|---|---|---|
| [ADR-001](../../docs/decisions/ADR-001-go-bootstrap.md) | Bootstrap del backend Go | Ajeno a este plan; **no se toca** | Plan Go |
| [ADR-002](../decisions/ADR-002-baseline-postgresql-portable.md) | Motor PostgreSQL 15+, baseline portable y fuente única | Propuesto | Tareas 1, 3, 7 |
| [ADR-003](../decisions/ADR-003-aislamiento-multi-tenant.md) | `tenant_id`, FK compuestas y RLS portable como defensa en profundidad | Propuesto | Tareas 4, 7 |
| [ADR-004](../decisions/ADR-004-rpc-sql-vs-go.md) | Primitivas transaccionales en SQL y lógica/autorización en Go | Propuesto | Tareas 5, 7 |
| [ADR-005](../decisions/ADR-005-modelo-identidad-portable.md) | Cuenta global (`identities`) y membresía por tenant | Propuesto | Tareas 3, 7 |
| [ADR-006](../decisions/ADR-006-credenciales-migracion-y-oidc.md) | Argon2id, migración de credenciales, refresh tokens y OIDC | Propuesto | Tareas 3, 7 |

### Nota de reconciliación de ADRs

El cierre documental solicitaba crear `ADR-002-postgresql-portable-target.md`, `ADR-003-identidad-fuera-de-supabase.md` y `ADR-004-rls-vs-autorizacion-aplicacion.md`. Al reanudar, `docs/decisions/` **ya contenía** ADR-002…ADR-006 producidos por las fases anteriores y referenciados por los entregables y por la tabla de estado del plan. Crear esos tres archivos habría duplicado los números 002/003/004 y roto las referencias cruzadas (por ejemplo, ADR-003 identifica el aislamiento multi-tenant en [multitenancy-isolation.md](multitenancy-isolation.md) y en la tabla de estado).

Por integridad del registro de decisiones, **no se crearon ADRs duplicados**. Los tres temas solicitados quedan cubiertos así:

| Tema solicitado | ADR vigente |
|---|---|
| Objetivo PostgreSQL portable | [ADR-002](../decisions/ADR-002-baseline-postgresql-portable.md) |
| Identidad fuera de Supabase | [ADR-005](../decisions/ADR-005-modelo-identidad-portable.md) y [ADR-006](../decisions/ADR-006-credenciales-migracion-y-oidc.md) |
| RLS vs. autorización de aplicación | [ADR-003](../decisions/ADR-003-aislamiento-multi-tenant.md) (§7 y §8) |

Si el orquestador prefiere los nombres exactos solicitados, la acción correcta es **renumerar y actualizar todas las referencias en una tarea aparte**, no añadir ADR-002/003/004 paralelos.

## Reportes

| Reporte | Tarea | Estado |
|---|---|---|
| [01-task.md](reports/01-task.md) | Inventario del esquema | Completada (estático) |
| [02-task.md](reports/02-task.md) | Dependencias Supabase | Completada (estático) |
| [03-task.md](reports/03-task.md) | Identidad portable | Completada (propuesta) |
| [04-task.md](reports/04-task.md) | Multi-tenancy | Completada (estático) |
| [05-task.md](reports/05-task.md) | RPCs | Completada (estático) |
| [06-task.md](reports/06-task.md) | Paginación | Completada (estático) |
| [07-task.md](reports/07-task.md) | Migración y reconciliación | Completada (runbook) |
| [08-task.md](reports/08-task.md) | Scripts no destructivos | Completada (herramientas) |

## Herramientas

| Herramienta | Uso |
|---|---|
| [`db_snapshot.py`](../../tools/database/db_snapshot.py) | Snapshot de catálogo (rol/base redactados); bloquea PROD si el usuario no es de solo lectura |
| [`validate_portable_schema.py`](../../tools/database/validate_portable_schema.py) | Objetos, tablas sin tenant, conteos, huérfanos, índices, duplicados y dependencias |
| [`validate_sql_basic.py`](../../tools/database/validate_sql_basic.py) | Validación estática de los siete SQL (READ ONLY, escrituras, secretos, balance) |
| [`verify_migration_checksums.py`](../../tools/database/verify_migration_checksums.py) | Verificación de checksums del ledger de migraciones |
| [`check_no_secrets.py`](../../tools/database/check_no_secrets.py) | Escáner de secretos sobre este paquete (falla si encuentra credenciales/URLs/roles) |
| `static_schema_scan.py`, `static_schema_analysis.py` | Inventario estático |
| `extract_table_catalog.py`, `extract_sql_functions.py`, `extract_query_sites.py` | Catálogo, funciones y consultas |
| `supabase_dependency_scan.py` | Dependencias de plataforma |
| `build_listings_and_rpcs.py` | Inventario de listados y RPCs |

Ver [tools/database/README.md](../../tools/database/README.md). Ninguna herramienta imprime URLs ni credenciales.

## Cómo leer el paquete

1. **Contexto y decisión:** [ADR-002](../decisions/ADR-002-baseline-postgresql-portable.md) → [baseline-proposal.md](baseline-proposal.md).
2. **Qué existe hoy:** [schema-inventory.md](schema-inventory.md) → [supabase-dependencies.md](supabase-dependencies.md).
3. **Qué reemplaza a qué:** [ADR-003](../decisions/ADR-003-aislamiento-multi-tenant.md)/[ADR-005](../decisions/ADR-005-modelo-identidad-portable.md)/[ADR-006](../decisions/ADR-006-credenciales-migracion-y-oidc.md) → [identity-schema-proposal.md](identity-schema-proposal.md) → [multitenancy-isolation.md](multitenancy-isolation.md) → [rpc-migration-matrix.md](rpc-migration-matrix.md).
4. **Cómo se consulta:** [pagination-query-matrix.md](pagination-query-matrix.md).
5. **Cómo se migra y valida:** [data-migration-runbook.md](data-migration-runbook.md) → [tools/database/](../../tools/database/).

## Validaciones ejecutadas (baseline DEV, 2026-11-09)

Con la DEV actual (baseline `0001`–`0003`, **sin datos históricos**) se ejecutaron, en modo solo lectura:

- `validate_portable_schema.py --env DEV all` → **PASS**: 10 tablas, 3 funciones, 105 constraints, 33 índices, 9 FKs, 0 huérfanos, 0 duplicados de claves (`identities.email`, `permissions.code`, `roles.code`, `tenants.slug`), 0 funciones con `auth.*` ni `SECURITY DEFINER` sin `search_path`.
- `verify_migration_checksums.py --directory database/migrations` → **PASS**: manifiesto `0001`–`0003` ordenado con checksums SHA-256 válidos.
- `check_no_secrets.py` → **PASS**.
- `run_readonly_sql.py --env DEV` → **7/7 scripts OK** (01–07) sin `psql`, en transacción read-only; evidencia en [_data/validation-dev-sql-scripts-2026-11-09.txt](_data/validation-dev-sql-scripts-2026-11-09.txt). Durante la ejecución se corrigieron tres defectos reales: `03` fallaba con tablas vacías (XML), la conexión quedaba abortada entre archivos y el detector bloqueaba comentarios. `psql` no está instalado; este runner usa pg8000 y exige `SET TRANSACTION READ ONLY`.
- `validate_disposable_env.py` (nuevo) → **base temporal aislada**, `up 0001–0003`, siembra sintética, RLS/aislamiento, keyset, `up→down→up` y limpieza (DB + rol): **28 PASS, 1 BLOQ, 1 HALLAZGO**. Evidencia: [_data/validation-disposable-2026-11-09.txt](_data/validation-disposable-2026-11-09.txt). Hallazgo clave: el owner de Neon tiene `BYPASSRLS`; las pruebas RLS exigen un rol `NOBYPASSRLS` (el script lo crea y elimina). HALLAZGO: las migraciones **no son idempotentes** (`0001` re-ejecutada falla con `42P06`); el ledger `schema_migrations` debe impedir re-aplicarlas. BLOQ: no hay tablas de negocio portables (productos/inventario/ventas/compras/cartera).
- `validate_business_disposable.py` (nuevo) → base temporal con **0001–0025** (checksums pinneados): **62 PASS, 0 FAIL, 0 BLOQ, 1 HALLAZGO**. Cubre N1–N20, sumas de ventas/inventario/compras/cartera/apartados, **reconciliación línea-nivel**, jobs/auditoría, `up→down→up`, ledger consecutivo/exacto/`dirty=false` + rechazo de duplicado, **idempotencia de ventas 0013** y **auditoría append-only**. HALLAZGO: segunda ejecución directa no idempotente (`42P06`); el ledger/runner la evita. Evidencia: [_data/validation-business-0025-2026-11-10.txt](_data/validation-business-0025-2026-11-10.txt).
- `validate_pagination_perf.py` (nuevo, Slice C) → **130 filas por listado en 9 listados** (productos, ventas, compras, movimientos, clientes, terceros, apartados, jobs, auditoría), keyset con empates, página vacía, último cursor, cambio concurrente y `EXPLAIN (ANALYZE, BUFFERS)` usando índices: **24 PASS**. Evidencia: [_data/validation-pagination-0012-2026-11-09.txt](_data/validation-pagination-0012-2026-11-09.txt).
- `validate_runtime_roles.py` (nuevo) → roles propuestos en base desechable: **PASS** (API/auth `NOBYPASSRLS`, API no lee ledger/identities, no crea tablas ni cruza tenant; AUTH solo su identidad). Evidencia: [_data/validation-runtime-roles-0012.txt](_data/validation-runtime-roles-0012.txt).
- `test_ledger_contract.py` (nuevo) → reglas del runner: **9/9 PASS** (ledger vacío/exacto/prefijo, rechazo de versión extra, nombre/checksum distintos, `dirty`, hueco y reordenamiento). Evidencia: [_data/validation-ledger-contract-0012.txt](_data/validation-ledger-contract-0012.txt).
- Migración **sobre datos sintéticos** (`0001–0011` + datos → `0012`): **PASS**, sin pérdida de filas y con las 2 tablas nuevas. Evidencia: [_data/validation-migration-over-data-0012.txt](_data/validation-migration-over-data-0012.txt).
- `validate_p0_sell_flow.py` (nuevo, prioridad P0) → flujo de venta end-to-end con rol `NOBYPASSRLS`: **18 PASS, 0 FAIL**, resultado **PARCIAL**. PASS: identidad/tenant/membresía, 30 productos y búsqueda, stock 100, 20 clientes, venta 20 + pago 20, stock 99, paginación y aislamiento A/B. **Brecha P0:** `sales` no tiene `customer_id` (no se puede atribuir la venta a un cliente). **BLOQ-P1:** no hay tablas de caja/cierre. **BLOQ-P2:** tienda online, manufactura, offline, IA/realtime, notificaciones. Evidencia: [_data/validation-p0-sell-flow-0012.txt](_data/validation-p0-sell-flow-0012.txt).
- **Propuesta ADR-007 validada** en base desechable: DDL `sales.customer_id` + FK compuesta + índice parcial; venta atribuida, venta anónima permitida, cross-tenant `23503` y `down` limpio: **PASS**. Evidencia: [_data/validation-adr-007-proposal.txt](_data/validation-adr-007-proposal.txt).
- **Propuesta ADR-008 validada**: DDL de caja, sesión única por sede (`23505`), cierre con arqueo, cierre inmutable (`23514`), venta cross-tenant rechazada y `down` limpio: **PASS**. Evidencia: [_data/validation-adr-008-proposal.txt](_data/validation-adr-008-proposal.txt).
- **Contrato N ejecutado end-to-end** en base desechable (DDL propuesto + aserciones + `ROLLBACK`): **PASS**; los objetos de propuesta desaparecen al hacer rollback. Evidencia: [_data/validation-pending-n-cases-0012.txt](_data/validation-pending-n-cases-0012.txt). En el esquema real N9/N10/N16/N17/N18/N19 siguen **BLOQ** hasta que el track Go cree los objetos.
- `validate_p1_lifecycle.py` (nuevo, P1) → **8 PASS, 0 FAIL, 1 BLOQ-P1, 2 HALLAZGO**: recepción parcial/cierre de compra, abonos/cierre de apartado y aging de CxP OK; **HALLAZGO** transiciones de estado sin guard (`received→draft` aceptada) y **HALLAZGO** pago de CxP que excede el saldo (sin control); **BLOQ-P1** falta conversión apartado→venta. Evidencia: [_data/validation-p1-lifecycle-0012.txt](_data/validation-p1-lifecycle-0012.txt).
- **Propuestas P1 validadas** en base desechable: ADR-009 (guardas de transición, control de sobrepago con sincronización `paid_amount/status`, apartado→venta) y ADR-010 (auditoría append-only): **PASS**. Evidencia: [_data/validation-p1-guards-proposal.txt](_data/validation-p1-guards-proposal.txt). Siguen siendo propuestas: no están en `database/migrations`.
- [report_queries.sql](_data/contracts/report_queries.sql): contratos de reportes (ventas/día, stock, compras pendientes, aging CxP, cartera, apartados por vencer, jobs, auditoría). **8/8 ejecutados** contra fixtures en base desechable con valores esperados: **PASS**. Evidencia: [_data/validation-report-queries-0012.txt](_data/validation-report-queries-0012.txt).
- **Go 1.22.12** (toolchain en `/tmp`, repo sin modificar): `go test ./...` → **13 paquetes PASS** y **runner real** contra base desechable: aplicó `0015`, ledger 15 limpio y segunda ejecución no-op.
- **ADR-011 validado**: `ofirone_auth` lee credenciales para login (2 tenants), sin INSERT/UPDATE; API no ve credenciales (0 filas). Evidencia: [_data/validation-adr-011-proposal.txt](_data/validation-adr-011-proposal.txt). Evidencias: [_data/validation-go-suite-0015.txt](_data/validation-go-suite-0015.txt) y [_data/validation-go-runner-db-0015.txt](_data/validation-go-runner-db-0015.txt).
- **Slice H**: snapshots con `db/user=[redactado]`, escáner de secretos PASS y 0 URLs con credenciales — `validation-H-evidence-security-2026-11-09.txt`.
- **Slice I**: `0021_audit_append_only` aplicada en DEV (ledger 21); UPDATE/DELETE rechazados (`23514`) — `validation-I-audit-append-only-2026-11-09.txt`.
- **Slice J**: función `find_login(email,tenant)` validada: auth no lee la tabla, solo su tenant; revocación/consumo idempotente — `validation-J-auth-secure-2026-11-09.txt`.
- **Slice K**: **BLOQUEADO**. El runner exige ledger preexistente; si se pre-crea, `0003` choca (`42P07`). No se puede aplicar `0001–0020` desde vacío sin bootstrap del runner — `validation-K-runner-full-2026-11-09.txt`.
- **Slice L**: reconciliación/performance PASS, **130 variantes** y 26 PASS de paginación — `validation-L-reconciliation-perf-2026-11-09.txt`.
- **ADR-009 aplicado**: `0022_p1_integrity_guards` en DEV (transiciones, sobrepago, apartado→venta); ledger 22.
- **EXT-01…04**: auditoría de 23 migraciones/ledger (0023 pendiente), matriz P0, portabilidad SQL sin Supabase y saneamiento de evidencias. Enlaces: [EXT-01](_data/EXT-01-migration-ledger-audit-2026-11-09.md), [EXT-02](_data/EXT-02-P0-TEST-COVERAGE.md), [EXT-03](_data/EXT-03-portability-audit-2026-11-09.md), [EXT-04](_data/EXT-04-evidence-audit-2026-11-09.md).
- Evidencia saneada: [_data/validation-dev-baseline-2026-11-09.txt](_data/validation-dev-baseline-2026-11-09.txt).

Hallazgo accionable del baseline: **18 columnas de filtro** (`created_at`/`updated_at`/`status` de `tenants`, `identities`, `tenant_memberships`, `roles`, `permissions`, `sessions`, `refresh_tokens`) sin índice líder. Revisar antes de cargar datos.

**No ejecutado aún:** **Slice K** (runner desde vacío, bloqueado por bootstrap del ledger), **PostgreSQL 15 real** (Docker `permission denied`), datos reales y `EXPLAIN` con volúmenes de producción. ADR-009 ya está aplicado (`0022`). Aplicados en DEV: `0013` (idempotencia), `0014` (cliente) y `0015` (caja). Verificados: identidad (28 PASS), negocio 0001–0025 (62 PASS), paginación (29 PASS), roles (PASS), ledger (25/25), migración sobre datos (PASS), fixtures (PASS), P0 (21 PASS), caja (14 PASS) y reportes (8/8).

### Priorización P0/P1/P2 (plan vigente)

| Prioridad | Estado | Nota |
|---|---|---|
| **P0 — vender** | **PASS (21 PASS, 0 FAIL)** | Productos, stock, venta, pago, cliente (`0014`), caja (`0015`) y aislamiento OK; solo P2 en backlog |
| **P1 — administración** | **Parcial** | Caja real aplicada (`0015`) y ciclo de vida básico (8 PASS); faltan guardas de transición/sobrepago, conversión apartado→venta y claim/complete |
| **P2 — diferido** | **BLOQ-P2** | Tienda online, manufactura/BOM, offline, IA/realtime, notificaciones y storage avanzado |

Documentos de cierre:
- [P1-P2-GAP-ANALYSIS.md](P1-P2-GAP-ANALYSIS.md) — matriz de brechas y plan de validación.
- [ADR-007](../decisions/ADR-007-venta-cliente.md) (venta→cliente, implementada en `0014`) y [ADR-008](../decisions/ADR-008-caja-sesiones.md) (caja, implementada en `0015`); ADR-009/010 siguen como propuestas en [`_data/contracts/proposals/`](_data/contracts/proposals/).
- [PENDING-N-CASES.md](_data/contracts/PENDING-N-CASES.md) — contratos N8–N19 para cuando existan las migraciones; N8 ya se valida contra `membership_roles`.

### Estado de slices (plan vigente)

| Slice | Estado | Evidencia |
|---|---|---|
| A. Harness de migraciones | **Completado** | `validation-business-0020` + runner Go real (`validation-go-runner-db-0015`): aplica 0015 y segunda ejecución no-op |
| B. Aislamiento multi-tenant | **Completado** | N1–N20 PASS en el esquema real (`validation-business-0020`) |
| C. Paginación y rendimiento | **Completado** | `validation-pagination-0012`: 130 filas ×9 listados, keyset, empates, cambio concurrente, EXPLAIN |
| D. Reconciliación sintética | **Completado** | `validation-business-0020`: conteos/sumas + línea-nivel (ventas/compras/pagos/cartera/inventario/apartados) |
| E. Auditoría de portabilidad | **Completado** | [_data/portability-audit-0012-2026-11-09.md](_data/portability-audit-0012-2026-11-09.md) + roles probados (`validation-runtime-roles-0012.txt`) |
| G. Caja `0015` | **Completado (DEV aplicado)** | `validation-cash-0015`: 14 PASS; checksum `14b83b…`; ledger 15 |
| I. N9/N10/N16/N17 + claim `0017–0020` | **Completado (DEV aplicado)** | N1–N20 PASS; ledger 20; evidencia `validation-business-0020` |
| H. Credenciales `0016` | **Completado (DEV aplicado)** | [validation-identity-credentials-0016](_data/validation-identity-credentials-0016.txt): RLS correcta; sin política de escritura para runtime |
| F. Contratos para Go | **Completado** | [_data/contracts/README.md](_data/contracts/README.md), [reference_queries.sql](_data/contracts/reference_queries.sql), [fixtures.sql](_data/contracts/fixtures.sql), [roles](_data/contracts/runtime-roles-proposal.sql) y [contrato del ledger](_data/validation-ledger-contract-0012.txt) |

## Pendientes y bloqueos

- [ ] Aprobar ADR-002…ADR-006 (o renumerar si el orquestador lo exige).
- [ ] Aplicar `0001`/`0002` en PostgreSQL 15+ desechable; probar `up`, `down`, segundo `up` y `tests/identity.sql`.
- [ ] Ejecutar las pruebas negativas N1–N20 y la caracterización de RPCs P0.
- [ ] Obtener usuario de solo lectura en PROD o mantener el bloqueo documentado.
- [ ] Ejecutar los siete `tools/database/0N_*.sql` con `psql` 15+ contra DEV o una copia; `validate_sql_basic.py` solo prueba la estructura.
- [ ] Ejecutar `validate_portable_schema.py` en DEV/copia con `pg8000` y datos sintéticos.
- [ ] Ejecutar la reconciliación del runbook contra una copia de datos de prueba.
- [ ] Resolver el grafo completo de firmas y el registro de checksums del baseline.

> **Regla de honestidad documental:** ningún checkbox pendiente se considera cumplido por la existencia de este índice o de un reporte. La evidencia debe ser un comando reproducible y su salida.
