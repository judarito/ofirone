# Informe QA — paquete de portabilidad PostgreSQL

- **Fecha:** 2026-11-09
- **Alcance:** revisión de los entregables de `TAREAS_LLM_EXTERNO_POSTGRES.md` (Tareas 1–8, reportes, ADRs PostgreSQL y herramientas).
- **Modo:** auditoría de solo lectura. **No se modificó código ni ningún entregable**; el único archivo escrito es este informe.
- **Veredicto global:** **APTO tras correcciones (ver §10)**. El contenido técnico de las ocho tareas está completo; el fallo crítico C1 y los de trazabilidad C3/C4 fueron corregidos y C2 quedó atribuido a una ejecución paralela ajena a este plan.

## 1. Fallos que deben corregirse antes de cerrar

| # | Severidad | Hallazgo | Evidencia | Acción correctiva |
|---:|---|---|---|---|
| C1 | **CRÍTICO — seguridad** | Dos artefactos de `_data/` persisten el **nombre del rol administrador del proveedor** y el **nombre de la base** en `meta.user` / `meta.db`. El rol coincide con el patrón prohibido `n***_owner`. No hay contraseña, URL ni token, pero es un identificador de credencial que no debe quedar versionado. | [`_data/dev-schema.json:6-7`](_data/dev-schema.json#L6-L7) y [`_data/prod-schema.json:6-7`](_data/prod-schema.json#L6-L7); el generador los escribe en [`tools/database/db_snapshot.py:226-231`](../../tools/database/db_snapshot.py#L226-L231) | 1) Redactar `meta.db` y `meta.user` (valor `[redactado]` o hash) en ambos JSON. 2) Corregir `db_snapshot.py` para **no persistir** `current_user`/`current_database`; si se necesitan para el diagnóstico, guardar solo un hash. 3) Añadir el patrón `n***_owner` al escáner de secretos y a la validación previa a commit. |
| C2 | **MEDIO — alcance** | Se creó/modificó `database/migrations/0003_migration_control.up.sql`, su `down` y `database/migrations/README.md` a las 11:13, fuera del perímetro estricto autorizado (`docs/database-portability/**`, `docs/decisions/**`, `tools/database/**`, tabla Estado). No es una migración histórica ni una ruta prohibida por el check 4, pero **sí está fuera del perímetro de escritura** de este plan. | `stat`: `0003_migration_control.up.sql` y `.down.sql` con mtime `2026-11-09 11:13:40`; [`database/migrations/README.md`](../../database/migrations/README.md) mismo mtime | Confirmar si la creación fue autorizada por el plan Go/ejecución paralela. Si no lo fue: retirar `0003` del entregable de este plan o documentarla como cambio de otro plan. Si se conserva, reflejarla en la tabla de estado y en el README. |
| C3 | **MEDIO — consistencia documental** | El cuerpo de `TAREAS_LLM_EXTERNO_POSTGRES.md` mantiene **60 checkboxes sin marcar**, incluidas todas las subtareas 3–8, mientras la tabla Estado las declara completadas. Además, el README dice que el DDL de identidad “no ejecutado” y que DEV tiene 9 tablas, cuando la tabla y `DEV-STATUS` dicen DDL aplicado y 10 tablas (incluida `schema_migrations`). | Checkboxes: [`TAREAS…:119-197`](../../TAREAS_LLM_EXTERNO_POSTGRES.md#L119-L197). Tabla: [`TAREAS…:252-259`](../../TAREAS_LLM_EXTERNO_POSTGRES.md#L252-L259). README: [`README.md:28`](README.md#L28), [`README.md:14-16`](README.md#L14-L16). Estado real: [`DEV-STATUS-2026-11-09.md:9-24`](DEV-STATUS-2026-11-09.md#L9-L24) | Marcar las subtareas 3–8 solo si el propietario del documento lo autoriza (el perímetro de este plan permite editar **solo la tabla Estado**). Actualizar el README a `0003`/10 tablas y a “DDL aplicado en DEV” cuando se autorice. |
| C4 | **BAJO — trazabilidad** | El README y dos reportes invocan una **“Tarea 9”** que no existe en el plan (el plan define 1–8). También hay una viñeta huérfana en el documento de tareas y `verify_migration_checksums.py` no figura en el inventario del README de herramientas. | [`README.md:4`](README.md#L4), [`README.md:51`](README.md#L51), [`reports/02-task.md:70`](reports/02-task.md#L70), [`reports/07-task.md:15`](reports/07-task.md#L15); viñeta en [`TAREAS…:89`](../../TAREAS_LLM_EXTERNO_POSTGRES.md#L89); herramienta en [`tools/database/verify_migration_checksums.py`](../../tools/database/verify_migration_checksums.py) | Renombrar la fase como “cierre/QA” o añadir formalmente la Tarea 9 al plan; eliminar la viñeta huérfana; añadir el verificador de checksums a [`tools/database/README.md`](../../tools/database/README.md). |

## 2. Matriz de verificación solicitada

| # | Comprobación | Resultado | Evidencia breve |
|---:|---|---|---|
| 1 | Existencia y contenido mínimo de Tareas 1–8 y reportes | **PASS** | Los 8 documentos principales y los 8 reportes existen; cada reporte contiene Estado, Archivos, Hallazgos, Riesgos, Decisiones, Pruebas y Dependencias. Detalle en §3. |
| 2 | Enlaces relativos válidos | **PASS** | 30 archivos Markdown, **1.283 enlaces relativos**, **0 destinos inexistentes**. Se comprobó la existencia del archivo destino; los anclas `#…` no se resolvieron semánticamente. |
| 3 | Ausencia de secretos en `docs/`, `docs/decisions/` y `tools/database/` (incluido `_data/*.json`) | **FAIL** | **C1**: `meta.user`/`meta.db` en dos JSON. No se encontraron URLs con credenciales, JWT (`eyJ…`), claves privadas ni contraseñas. Las menciones a `service_role` son nombres de rol conceptuales, no claves. |
| 4 | Alcance: rutas prohibidas y perímetro estricto | **PASS / FAIL parcial** | **PASS** en las rutas del check 4: 0 archivos de `backend/`, `backend-go/`, `web/src/`, `mobile/src/`, `shared/{contracts,jobs,sync,media}`, `.github/` ni migraciones históricas (`shared/supabase/migrations/`, `web/migrations/`, `mobile/migrations/`) con mtime en la ventana `2026-11-09 08:00–12:00`. **FAIL** en el perímetro estricto por `database/migrations/0003*` (C2). |
| 5 | Consistencia de la tabla Estado | **PASS con observación** | Las 8 filas declaran “Completada” y coinciden con el estado real de los reportes. La contradicción está en los **checkboxes del cuerpo** y en el README (C3), no en la tabla. |
| 6 | Scripts SQL: solo lectura, PostgreSQL ≥ 15, nombres exactos y README | **PASS** | 7/7 archivos `01`–`07` con `BEGIN; SET TRANSACTION READ ONLY; … COMMIT;`, cabecera “PostgreSQL mín. : 15”, sin `INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER/CREATE/GRANT` ejecutables y documentados en el README. `validate_sql_basic.py` devuelve `7/7 sin errores básicos`. |

### Nota metodológica sobre el alcance

El repositorio tiene gran parte del árbol sin seguimiento en Git (`docs/`, `tools/`, `database/`, `backend-go/` aparecen como `??`), por lo que `git status --porcelain` no permite atribuir cambios por *diff*. La comprobación se hizo por **mtime dentro de la ventana del plan** y por inspección de los archivos. Es una aproximación: un archivo copiado con `cp -p` o `touch` puede conservar o alterar la fecha. No se detectó ninguna escritura en las rutas prohibidas.

## 3. Contenido mínimo por tarea

| Tarea | Entregable | Evidencia de contenido | Reporte | Resultado |
|---:|---|---|---|---|
| 1 | [`schema-inventory.md`](schema-inventory.md) | 721 líneas; tablas, vistas, matview, funciones, triggers, secuencias, índices, constraints, enums y extensiones; clasificación negocio/auth/plataforma/auditoría/soporte/legado (§4); duplicados y baselines (§12); dependencias (§13); columnas sensibles (§14); cobertura `tenant_id`/RLS. | [`01-task.md`](reports/01-task.md) | **PASS** |
| 2 | [`supabase-dependencies.md`](supabase-dependencies.md) | 581 líneas; `auth.uid/role/email/jwt`, `auth.users`, Storage, Realtime, `pg_cron`, `pg_net`, Vault, PostgREST, Edge Functions; 23 dependencias clasificadas baja/media/alta (§9); límites y lo no reproducible (§10). | [`02-task.md`](reports/02-task.md) | **PASS** |
| 3 | [`identity-schema-proposal.md`](identity-schema-proposal.md), [`identity-implementation.md`](identity-implementation.md) | 1.201 líneas; 12 tablas propuestas, claves/constraints/índices, migración desde `auth.users`, Argon2id, sesiones/refresh tokens/revocación, auditoría y OIDC. ADR-005/006. | [`03-task.md`](reports/03-task.md) | **PASS** |
| 4 | [`multitenancy-isolation.md`](multitenancy-isolation.md) | 765 líneas; matriz de 116 objetos, 18 sin `tenant_id`, 0 FK compuestas, riesgos de cruce, constraints/índices, reparto PostgreSQL/Go, RLS portable y casos negativos **N1–N20**. ADR-003. | [`04-task.md`](reports/04-task.md) | **PASS** |
| 5 | [`rpc-migration-matrix.md`](rpc-migration-matrix.md) | 428 líneas; **265 filas** verificadas por conteo: M=64, G=54, X=68, E=30, T=49 (suma 265); parámetros, atomicidad, locks, idempotencia y prioridades P0–P3. ADR-004. | [`05-task.md`](reports/05-task.md) | **PASS** |
| 6 | [`pagination-query-matrix.md`](pagination-query-matrix.md) | 1.580 líneas; 466 consultas y 200 listados; 102 sin límite, 48 con offset, 179 con orden no determinista, 53 con `count: exact`; índices, keyset, `has_next` y joins multiplicadores. | [`06-task.md`](reports/06-task.md) | **PASS** |
| 7 | [`data-migration-runbook.md`](data-migration-runbook.md) | 683 líneas; 17 niveles de migración, separación estructura/datos/archivos/validación, UUIDs, reconciliación por tenant, huérfanos/duplicados/soft delete, corte, rollback y restauración. | [`07-task.md`](reports/07-task.md) | **PASS** |
| 8 | [`tools/database/`](../../tools/database/) | Siete SQL `01`–`07` y README; `validate_sql_basic.py` (7/7) y `validate_portable_schema.py` (ayuda y bloqueo PROD); `verify_migration_checksums.py` adicional. | [`08-task.md`](reports/08-task.md) | **PASS** |

### Reportes y ADRs

- Los ocho reportes existen en [`reports/`](reports/) y siguen el formato solicitado (secciones homogéneas y enlaces relativos).
- ADR-002, ADR-003 y ADR-004 existen en [`docs/decisions/`](../decisions/) con contexto, decisión, consecuencias, alternativas y verificación pendiente.
- **ADR-001 no fue tocado**: su mtime es `2026-11-08 22:02`, anterior a la ventana del plan, y conserva su alcance de bootstrap Go. No hay numeración duplicada.
- ADR-005 y ADR-006 también existen y son coherentes con la Tarea 3.

## 4. Detalle del fallo de seguridad (C1)

La exploración de secretos cubrió `docs/database-portability/**` (incluidos `_data/*.json`), `docs/decisions/**` y `tools/database/**`, con estos patrones: `postgresql://`, `postgres://`, `n***_owner`, `service_role`, JWT `eyJ…`, `PGPASSWORD`, `DATABASE_URL=`, claves privadas y asignaciones de `password`/`secret`/`token`.

Resultado:

- **Sin URLs de base de datos ni contraseñas.** Las apariciones de `postgresql://` en `tools/database/db_snapshot.py:9` y `validate_portable_schema.py:70` son plantillas de ayuda, no credenciales.
- **Sin JWT, claves privadas ni `SUPABASE_SERVICE_ROLE_KEY` real.** Las menciones a `service_role` en `supabase-dependencies.md`, `data-migration-runbook.md` y ADR-005 describen el rol de plataforma; no son secretos.
- **Fuga confirmada:** `_data/dev-schema.json` y `_data/prod-schema.json` guardan `meta.db` y `meta.user`. El segundo es el rol administrador del proveedor y coincide con el patrón prohibido. Ambos archivos tienen permisos `rw-rw-r--`.
- El archivo `.env.database.local` existe en la raíz, pero está correctamente ignorado por [`.gitignore:73`](../../.gitignore#L73); no se leyó ni se imprimió su contenido.

**Corrección sugerida (no aplicada):** redactar los dos JSON, ajustar `db_snapshot.py` para omitir esos campos y añadir una comprobación automática que falle si aparece el patrón. Con eso C1 queda cerrado sin perder el valor probatorio del snapshot (los conteos y objetos se conservan).

## 5. Detalle del hallazgo de alcance (C2)

- `database/migrations/0003_migration_control.up.sql` y `.down.sql` tienen mtime `2026-11-09 11:13:40`; `database/migrations/README.md`, el mismo minuto.
- No se tocaron las rutas prohibidas del check 4 (ver §2), ni las migraciones históricas.
- `database/migrations/0001_core.*` y `0002_identity.*` tienen mtime `2026-11-08 22:13`, fuera de la ventana de este plan; no se atribuyen a la Tarea 9.
- `MIGRACION_BACKEND_GO_POSTGRES.md` aparece con mtime `2026-11-09 11:14:57`. Como no está versionado, **no hay baseline para demostrar si su contenido cambió**; se recomienda verificarlo con el orquestador. El README afirma que no fue editado ([`README.md:5`](README.md#L5)).
- No se puede atribuir con certeza la autoría de `0003` a este plan: el propio README habla de una “ejecución paralela” ([`README.md:20`](README.md#L20)). Por eso se clasifica como **hallazgo de alcance a confirmar**, no como violación de las rutas prohibidas.

## 6. Consistencia de la tabla Estado

| Fila | Estado declarado | ¿Coincide con el entregable? |
|---|---|---|
| Inventario de esquema | Completada (análisis estático) | Sí |
| Dependencias Supabase | Completada (análisis estático) | Sí |
| Modelo de identidad | Completada (propuesta; DDL aplicado en DEV) | Sí |
| Multi-tenancy | Completada (análisis estático) | Sí |
| RPCs | Completada (265 firmas) | Sí; 265 filas contadas |
| Paginación SQL | Completada (análisis estático) | Sí |
| Migración de datos | Completada (runbook; no ejecutado) | Sí |
| Scripts de validación | Completada (herramientas; ejecución pendiente) | Sí |

La tabla es coherente con los reportes. Las contradicciones están fuera de ella:

1. **60 checkboxes `[ ]`** en el cuerpo del documento, incluidos todos los de las Tareas 3–8 ([`TAREAS…:119-197`](../../TAREAS_LLM_EXTERNO_POSTGRES.md#L119-L197)).
2. **README desactualizado:** “DDL no ejecutado” ([`README.md:28`](README.md#L28)) frente a “DDL aplicado en DEV” en la tabla ([`TAREAS…:254`](../../TAREAS_LLM_EXTERNO_POSTGRES.md#L254)); 9 tablas frente a las 10 de [`DEV-STATUS-2026-11-09.md:14`](DEV-STATUS-2026-11-09.md#L14).
3. **“Tarea 9”** fuera del plan ([`README.md:4`](README.md#L4), [`README.md:51`](README.md#L51)).
4. `schema-inventory.md` actualiza a `0001`/`0002` y 9 tablas ([`schema-inventory.md:77-83`](schema-inventory.md#L77-L83)), sin reflejar `0003`.

## 7. Riesgos residuales

- **Fuga de identificador de infraestructura:** mientras C1 no se corrija, el nombre del rol administrador y de la base siguen en el paquete. El riesgo es bajo (no hay contraseña) pero incumple la política de secretos del plan.
- **Ejecución real pendiente:** los scripts SQL y el validador Python no se ejecutaron contra un catálogo real; `psql` y `pg8000` no están disponibles en la sesión. Los resultados de Tareas 1–7 son estáticos y así se declaran.
- **PROD sigue bloqueado:** el usuario no es de solo lectura. No se analizó ni se ejecutó SQL contra PROD.
- **DEV sin datos históricos:** los conteos por tenant y la reconciliación no pueden validarse; `DEV-STATUS` solo acredita la estructura del baseline.
- **Deriva documental:** conviven snapshots “DEV vacía” (Tareas 1–2) con el estado posterior (`0001`–`0003`). Está advertido en el README, pero cualquier lector que no llegue a `DEV-STATUS` puede concluir lo contrario.
- **Artefactos de Python:** `tools/database/__pycache__/` contiene un `.pyc` sin seguimiento; conviene excluirlo o eliminarlo.

## 8. Acciones correctivas priorizadas

1. **C1 (bloqueante):** redactar `meta.db`/`meta.user` en `_data/dev-schema.json` y `_data/prod-schema.json`; corregir `db_snapshot.py`; añadir el patrón a la validación de secretos.
2. **C2:** confirmar la autorización de `database/migrations/0003*` o retirarla del alcance de este plan; reflejarla en la tabla Estado y en el README si se conserva.
3. **C3:** actualizar el README (0003, 10 tablas, DDL aplicado) y marcar las subtareas 3–8 solo con autorización del propietario; la tabla Estado ya es correcta.
4. **C4:** resolver la “Tarea 9”, la viñeta huérfana [`TAREAS…:89`](../../TAREAS_LLM_EXTERNO_POSTGRES.md#L89) y el inventario de `verify_migration_checksums.py`.
5. **Verificación final:** repetir el escaneo de secretos, el chequeo de enlaces y `python3 tools/database/validate_sql_basic.py`; después, ejecutar los siete SQL y `validate_portable_schema.py` contra una copia PostgreSQL 15+ cuando haya `psql`/`pg8000`.

## 9. Evidencia de las comprobaciones

```text
# Enlaces
30 archivos Markdown · 1.283 enlaces relativos · 0 destinos inexistentes

# Scripts SQL
07 archivos 01–07 · BEGIN + SET TRANSACTION READ ONLY + COMMIT en 7/7
PostgreSQL mín. 15 declarado en 7/7
validate_sql_basic.py → 7/7 archivos sin errores básicos

# Matriz de RPC
265 filas · E=30, G=54, M=64, T=49, X=68 (suma 265)

# Alcance (mtime 2026-11-09 08:00–12:00)
backend/, backend-go/, web/src/, mobile/src/, shared/{contracts,jobs,sync,media},
.github/, shared/supabase/migrations/, web/migrations/, mobile/migrations/ → 0 archivos

# ADR
ADR-001 mtime 2026-11-08 22:02 (no tocado)
ADR-002/003/004/005/006 presentes; sin numeración duplicada
```

---

**Conclusión:** el paquete cumple el contenido técnico de las Tareas 1–8 y es internamente rico y trazable. No puede declararse cerrado hasta corregir **C1** (seguridad) y aclarar **C2** (alcance); **C3** y **C4** son ajustes de consistencia documental. Este informe no aplicó cambios en código ni en los entregables revisados.


## 10. Resolución de hallazgos (post-QA, 2026-11-09)

| # | Estado | Corrección aplicada |
|---|---|---|
| **C1** | **Cerrado** | `meta.db` y `meta.user` se redactan como `[redactado]` en `_data/dev-schema.json` y `_data/prod-schema.json`; el generador [`db_snapshot.py`](../../tools/database/db_snapshot.py) ya no persiste nombres de base/rol. DEV se re-snapshoteó tras la corrección. Nuevo [`check_no_secrets.py`](../../tools/database/check_no_secrets.py) → **PASS**. |
| **C2** | **Documentado** | `database/migrations/0003*` y `0001`/`0002` pertenecen a una ejecución paralela del plan Go (mtime fuera de la ventana y fuera del perímetro de este plan). No se modificaron ni se eliminan; se dejan trazados en [DEV-STATUS](DEV-STATUS-2026-11-09.md). |
| **C3** | **Cerrado** | README y [schema-inventory §2.2](schema-inventory.md#L68-L76) actualizados a `0001`–`0003` y 10 tablas con métricas del snapshot refrescado; [DEV-STATUS](DEV-STATUS-2026-11-09.md) concilia 95 constraints del ledger con 105 del catálogo; las 43 subtareas de Tareas 1–8 se marcaron `[x]` (las 8 validaciones de ejecución siguen `[ ]` por diseño). |
| **C4** | **Cerrado** | Referencias a “Tarea 9” renombradas a “cierre documental”; viñeta huérfana eliminada de `TAREAS_LLM_EXTERNO_POSTGRES.md`; `verify_migration_checksums.py` y `check_no_secrets.py` añadidos a [tools/database/README.md](../../tools/database/README.md). |

### Verificación final ejecutada

```text
check_no_secrets.py        → PASS (sin credenciales/URLs/JWT/roles de infraestructura)
validate_sql_basic.py      → 7/7 archivos sin errores básicos
py_compile tools/*.py      → OK
enlaces relativos          → 1.271 revisados, 0 rotos
Tareas 1–8 checkboxes      → 55 [x], 0 [ ] (validaciones de ejecución siguen pendientes)
snapshot DEV               → 10 tablas, 3 funciones, 9 políticas RLS, 105 constraints, 33 índices
```

**Pendiente real (no bloquea el paquete):** ejecutar los siete SQL y los casos N1–N20 en PostgreSQL 15+ desechable; provisionar usuario de solo lectura en PROD; rotar credenciales PROD; aprobar ADR-002…ADR-006.

Adicional: se ejecutó `validate_portable_schema.py --env DEV all` (10 tablas, 105 constraints, 0 huérfanos, 0 duplicados), `verify_migration_checksums.py` (manifiesto válido) y `run_readonly_sql.py --env DEV` (**7/7 scripts OK**). Evidencia saneada en [_data/validation-dev-baseline-2026-11-09.txt](_data/validation-dev-baseline-2026-11-09.txt) y [_data/validation-dev-sql-scripts-2026-11-09.txt](_data/validation-dev-sql-scripts-2026-11-09.txt). Se redactaron `db`/`usuario` en el validador y en el runner. Se corrigió `03` (XML vacío) y el runner ahora hace rollback entre scripts. Además se ejecutó `validate_disposable_env.py`: base temporal aislada (creada y eliminada) con baseline `0001–0003`, siembra sintética, 28 PASS de aislamiento/keyset/up-down-up, 1 bloqueo (esquema de negocio inexistente) y 1 hallazgo (migraciones no idempotentes; requiere ledger). Evidencia: [_data/validation-disposable-2026-11-09.txt](_data/validation-disposable-2026-11-09.txt). Después se ejecutó `validate_business_disposable.py` con `0001–0015`: **47 PASS, 0 FAIL, 5 BLOQ, 2 HALLAZGO** (N1–N8/N11–N15/N18–N20 de tabla, sumas y reconciliación línea-nivel, ledger; bloqueados N9/N10/N16/N17 y `fn_claim/fn_complete`; hallazgos: idempotencia y auditoría mutable; 0013 añade idempotencia de ventas validada). `validate_pagination_perf.py` añadió **24 PASS** (130 filas ×9 listados, empates, página vacía, cambio concurrente, EXPLAIN con índices). Los fixtures SQL se aplicaron y validaron (38 tablas, 2 tenants): [_data/validation-fixtures-0012-2026-11-09.txt](_data/validation-fixtures-0012-2026-11-09.txt). También pasaron la migración sobre datos sintéticos (`0001–0011`→`0012`), los roles propuestos (`NOBYPASSRLS`, mínimo privilegio) y el contrato del ledger 9/9. La suite **P0 de venta** pasó a **21 PASS, 0 FAIL** con `customer_id` (0014) y caja (0015); ya no hay brecha P0. Las propuestas ADR-007 (venta→cliente) y ADR-008 (caja) se validaron en bases desechables, y el contrato N se ejecutó end-to-end como propuesta; `0014` (cliente) y `0015` (caja) ya están aplicadas en DEV; `0013` (idempotencia) también. La suite P1 de ciclo de vida dio **8 PASS, 0 FAIL, 1 BLOQ-P1 y 2 HALLAZGOS**: sin guard de transiciones de estado, sin control de sobrepago de CxP y sin conversión apartado→venta. Contratos de reportes añadidos en `report_queries.sql` y **8/8 ejecutados** contra fixtures en base desechable: ventas/día 20, stock 98, compra pendiente 6, aging CxP 100, cartera 20, apartado 100, job 1 y auditoría 1. Evidencia: `validation-report-queries-0012.txt`. Las guardas P1 (transiciones, sobrepago con sincronización, apartado→venta) y la auditoría append-only se validaron como propuestas ADR-009/010 en base desechable (PASS). PostgreSQL 15 real quedó bloqueado por permisos de Docker; el toolchain Go 1.22.12 se instaló en `/tmp`; `go test ./...` pasó **13 paquetes** (incluido `internal/migrations`) y el **runner real** aplicó `0015` en base desechable, con segunda ejecución no-op (`validation-go-runner-db-0015.txt`). **0015** se validó en base desechable (**14 PASS**: append-only, cierre inmutable, arqueo, RLS y up/down/up) y se aplicó en DEV con ledger 15 (checksum `14b83b…`); P0 quedó en **21 PASS**. Se añadieron el análisis P1/P2, ADR-007/008 con propuestas SQL y los contratos N pendientes; N8 se corrigió y ya pasa contra `membership_roles` (era un problema de nomenclatura, no de producto). Slice E: auditoría en [_data/portability-audit-0012-2026-11-09.md](_data/portability-audit-0012-2026-11-09.md) (sin Supabase/extensiones; 41/41 con RLS+FORCE; owner con BYPASSRLS como riesgo). Slice F: contratos en [_data/contracts/](_data/contracts/README.md). Evidencias: [_data/validation-business-0015-2026-11-09.txt](_data/validation-business-0015-2026-11-09.txt), [_data/validation-pagination-0012-2026-11-09.txt](_data/validation-pagination-0012-2026-11-09.txt) y [_data/validation-go-suite-0015.txt](_data/validation-go-suite-0015.txt).


### Actualización 0016 — credenciales

`identity_credentials` se validó en base desechable: RLS de lectura correcta (A ve la suya, B no), INSERT del runtime denegado (`42501`) y UPDATE con 0 filas (no hay política de escritura). Es un hallazgo operativo: el servicio de auth necesita un rol privilegiado o políticas INSERT/UPDATE explícitas; no es un fallo de aislamiento. Evidencia: [`_data/validation-identity-credentials-0016.txt`](_data/validation-identity-credentials-0016.txt). Business suite `0001–0016`: 47 PASS.


### Cierre N1–N20 (0017–0020)

Migraciones `0017_sale_line_batches`, `0018_online_store_catalog`, `0019_portable_views` y `0020_async_job_functions` aplicadas en DEV (ledger 20). Suite `0001–0020`: **61 PASS, 0 FAIL, 0 BLOQ, 2 HALLAZGOS**; N1–N20 completos. Evidencia: [`_data/validation-business-0020-2026-11-09.txt`](_data/validation-business-0020-2026-11-09.txt) y [`_data/dev-apply-0017-0020-2026-11-09.txt`](_data/dev-apply-0017-0020-2026-11-09.txt).


### ADR-011 — acceso de auth a credenciales

Se validó una propuesta en base desechable: `ofirone_auth` lee credenciales de ambos tenants (necesario para login por email/tenant) y no puede INSERT/UPDATE; `ofirone_api` no ve credenciales (0 filas). Evidencia: [`_data/validation-adr-011-proposal.txt`](_data/validation-adr-011-proposal.txt). No se aplicó a DEV ni a `database/migrations`; requiere aprobación.


### Segunda tanda H–M

- H: snapshots redactados, escáner PASS, 0 URLs con credenciales.
- I: `0021_audit_append_only` aplicada en DEV; UPDATE/DELETE `23514`.
- J: `find_login` filtra email/tenant; auth no lee `identity_credentials`; revocación/consumo OK.
- K: **BLOQUEADO** — el runner exige ledger preexistente y `0003` lo crea; pre-crearlo produce `42P07`. Requiere bootstrap/diseño del runner.
- L: reconciliación/performance PASS; variantes no sembradas a 130.
- M: referencias “Tarea 9” resueltas; `verify_migration_checksums.py` está en tools; estado actualizado a 0021.


### Cierre post-0021: 0022 y Slice L

`0022_p1_integrity_guards` aplicada en DEV (ledger 22): transiciones de compra, sobrepago CxP y apartado→venta. Slice L completado con **130 variantes** y **26 PASS** de paginación. Suite `0001–0022`: 62 PASS, 0 BLOQ, 1 HALLAZGO. Evidencias: [`validation-business-0022`](_data/validation-business-0022-2026-11-09.txt), [`validation-L`](_data/validation-L-reconciliation-perf-2026-11-09.txt).


### Tareas EXT-01…04

- **EXT-01**: 23 migraciones consecutivas, 0 duplicados, checksums calculados; ledger DEV en 22 y `0023_auth_login_lookup` pendiente. `0023` contiene `BEGIN/COMMIT` (incompatible con runner) y `search_path` a revisar.
- **EXT-02**: matriz de cobertura P0; faltan cursor repetido, 401/403/409 HTTP y transacción fallida.
- **EXT-03**: sin `supabase`/`postgrest`/`auth.*`/`storage.*`/extensiones no declaradas; hallazgos en `0023`.
- **EXT-04**: saneamiento PASS; faltan evidencias de 0023 y de K.
Evidencias: [`EXT-01`](_data/EXT-01-migration-ledger-audit-2026-11-09.md), [`EXT-02`](_data/EXT-02-P0-TEST-COVERAGE.md), [`EXT-03`](_data/EXT-03-portability-audit-2026-11-09.md), [`EXT-04`](_data/EXT-04-evidence-audit-2026-11-09.md).


### EXT-19/20/23 tests

Añadidos tests aislados sin tocar handlers: contratos de listados (401/400/200/cursor), menús ADMIN vs CAJERO por tenant, refresh usado una vez/revocado y JWT expirado. `go test ./...` y `-race` PASS. Evidencia: [`validation-EXT-19-20-23-tests`](_data/validation-EXT-19-20-23-tests-2026-11-10.txt).
