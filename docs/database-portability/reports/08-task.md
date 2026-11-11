# Reporte Tarea 8 — Scripts no destructivos

**Fecha:** 2026-11-09
**Herramientas:** [tools/database/](../../../tools/database/)
**Estado:** completada (herramientas preparadas; ejecución semántica en entorno pendiente)

## Tarea

Crear scripts que solo inspeccionen o validen: objetos del esquema, tablas sin `tenant_id`, conteos por tenant, FKs rotas/huérfanos, índices faltantes, duplicados de clave de negocio y dependencias de funciones. Idempotentes, de solo lectura por defecto, con confirmación para cualquier escritura, sin secretos ni PII y con versión mínima documentada.

## Estado

Completada como **entrega de herramientas**. Los siete scripts SQL se validaron estáticamente (`7/7 sin errores básicos`) y el validador Python se compiló y ejecutó en modo ayuda. La semántica contra un catálogo real y los planes de ejecución siguen pendientes: en este entorno no hay `psql`, y aunque DEV ya tiene aplicado el baseline `0001`/`0002`, no se ejecutaron estos scripts contra ella ([DEV-STATUS-2026-11-09.md](../DEV-STATUS-2026-11-09.md)).

## Archivos creados/modificados

| Archivo | Tipo | Propósito |
|---|---|---|
| [`01_list_schema_objects.sql`](../../../tools/database/01_list_schema_objects.sql) | SQL solo lectura | Tablas, vistas, matviews, funciones, triggers, constraints, enums y extensiones |
| [`02_tables_without_tenant.sql`](../../../tools/database/02_tables_without_tenant.sql) | SQL solo lectura | Tablas/vistas sin `tenant_id`; `tenant_id` anulable o de tipo distinto; clasificación global/derivada |
| [`03_row_counts_by_tenant.sql`](../../../tools/database/03_row_counts_by_tenant.sql) | SQL solo lectura | Conteo exacto por tabla y tenant (`query_to_xml` + `xmltable`) |
| [`04_orphan_foreign_keys.sql`](../../../tools/database/04_orphan_foreign_keys.sql) | SQL solo lectura | Huérfanos por FK y FKs `NOT VALID` |
| [`05_missing_indexes_on_filters.sql`](../../../tools/database/05_missing_indexes_on_filters.sql) | SQL solo lectura | FKs, filtros sin índice líder y tablas con `seq_scan` alto |
| [`06_duplicate_business_keys.sql`](../../../tools/database/06_duplicate_business_keys.sql) | SQL solo lectura | Duplicados exactos/normalizados y colisiones entre tenants |
| [`07_function_dependencies.sql`](../../../tools/database/07_function_dependencies.sql) | SQL solo lectura | Dependencias tabla/función, triggers y `SECURITY DEFINER` sin `search_path` |
| [`validate_sql_basic.py`](../../../tools/database/validate_sql_basic.py) | Estático | Verifica `BEGIN`/`COMMIT`, `READ ONLY`, balance de literales, ausencia de escrituras y secretos |
| [`validate_portable_schema.py`](../../../tools/database/validate_portable_schema.py) | Conexión (lectura) | Variante Python/pg8000 de las mismas comprobaciones, con bloqueo de PROD |
| [`tools/database/README.md`](../../../tools/database/README.md) | Documentación | Inventario, uso, parámetros, privacidad y estado de validación |

> **Nota de reanudación.** Los siete `0N_*.sql` y `validate_sql_basic.py` se produjeron en la ejecución paralela de la Tarea 8; se conservan y documentan aquí. `validate_portable_schema.py` se añadió como complemento para quien prefiera Python/`pg8000`; **no sustituye** a los scripts SQL.

## Hallazgos principales

| Requisito | Implementación SQL | Implementación Python |
|---|---|---|
| Listar objetos del esquema | `01` | `objects` |
| Detectar tablas sin `tenant_id` | `02` | `tenantless` |
| Contar registros por tenant | `03` | `tenant-counts` |
| Detectar FK rotas/huérfanos | `04` | `orphans` |
| Detectar índices faltantes | `05` | `indexes` |
| Validar duplicados de clave de negocio | `06` | `duplicates` |
| Reporte de dependencias de funciones | `07` | `function-deps` |

1. **Solo lectura real:** cada `.sql` abre `BEGIN; SET TRANSACTION READ ONLY;` y cierra con `COMMIT;`; cualquier escritura accidental falla en el servidor. No se usan `CREATE TEMP TABLE`, `DO` ni `CALL`.
2. **Sin extensiones:** todo vive en `pg_catalog`; el conteo dinámico usa `query_to_xml` + `xmltable`.
3. **Límites:** `statement_timeout` (60–180 s), `lock_timeout` (5 s), `idle_in_transaction_session_timeout` y `LIMIT` en las secciones de detalle; `03` y `04` permiten acotar por tabla y por umbral.
4. **Sin secretos:** `validate_sql_basic.py` falla si encuentra `postgres://`, `DATABASE_URL=`, `password=` o `PGPASSWORD`.
5. **Privacidad:** `03` imprime solo `tenant_id` y conteos; `06` enmascara email/documento (`2 + *** + 2`), acota a 20 grupos por regla y nunca imprime nombres, direcciones ni teléfonos; `07` no imprime cuerpos de funciones.
6. **Versión mínima:** PostgreSQL 15, documentada en el encabezado de cada script y verificada por `validate_portable_schema.py`.
7. **Idempotencia:** repetir un script produce el mismo reporte si los datos no cambian; no hay escrituras ni cursores persistentes.
8. **Heurísticas declaradas:** `05` usa `pg_stat_user_tables` (vacío en base nueva); `06` normaliza con `lower(btrim(...))`; `07` usa regex sobre `prosrc` y no detecta SQL construido con `format()`.

## Riesgos

- `03`, `04` y `06` pueden ser costosos en tablas grandes; ejecutar por tabla o con timeout y contra una copia.
- `05` marca columnas de filtro sin índice líder; puede haber falsos positivos por índices compuestos que no empiezan por esa columna.
- `06` puede revelar claves de negocio (email, documento); guardar la salida en un archivo protegido y no publicarla.
- `07` no resuelve SQL dinámico; una función «sin dependencias» puede invocar tablas vía `EXECUTE`.
- DEV tiene el baseline aplicado, pero **no datos históricos**; los conteos por tenant estarán vacíos y no validan el esquema real.
- PROD sigue bloqueado: no ejecutar hasta tener usuario de solo lectura.

## Decisiones recomendadas

- Mantener los siete `.sql` como entrega canónica de la Tarea 8; usar `validate_portable_schema.py` solo cuando se prefiera un flujo Python o se quiera el bloqueo automático de PROD.
- Ejecutar primero `01` y `02`, luego `03`/`04` por tabla y finalmente `05`/`06`/`07` con revisión manual.
- Tratar los resultados como **candidatos**: confirmar con `pg_index`, `EXPLAIN` y revisión de dominio antes de crear índices o constraints.
- Añadir los checksums del [runbook](../data-migration-runbook.md) §8 como paso separado; estos scripts no calculan checksums de fila.

## Pruebas ejecutadas

- `python3 tools/database/validate_sql_basic.py` → `7/7 archivos sin errores básicos`.
- `python3 -m py_compile tools/database/validate_portable_schema.py` → OK.
- `python3 tools/database/validate_portable_schema.py --help` → OK (import de `pg8000` diferido).
- Ejecución sin `DATABASE_URL_DEV` → mensaje controlado, sin exponer credenciales.
- **No ejecutado:** `psql` no está disponible; los siete scripts no se ejecutaron contra DEV ni PROD. No hay `EXPLAIN` ni medición de tiempos.

## Dependencias para otros agentes

- Infraestructura: `psql` 15+ y un rol de solo lectura para DEV; PROD solo si se provisiona ese rol.
- [Tarea 7](../data-migration-runbook.md): usar `03`/`04`/`06` como insumo de reconciliación, junto con los checksums.
- Backend Go: `07` debe mostrar cero funciones con `auth.*` antes de retirar las históricas.
