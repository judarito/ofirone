# Herramientas de base de datos

Scripts de **análisis y validación no destructivos** para la portabilidad de Ofirone a PostgreSQL estándar. No crean, modifican ni borran objetos ni datos. Las credenciales se leen de variables de entorno (`DATABASE_URL_DEV`, `DATABASE_URL_PROD`) o de `.env.database.local`; **ninguna herramienta imprime la URL**.

Requisitos: Python 3.11+ y, para las que conectan a una base, `pg8000` en un entorno virtual temporal (`pip install pg8000`). Los scripts estáticos no necesitan dependencias.

## Inventario

| Script | Tipo | Qué hace | Salida |
|---|---|---|---|
| [`static_schema_scan.py`](static_schema_scan.py) | Estático | Escanea sentencias DDL de `shared/supabase/migrations/` | `_data/static-scan.json` |
| [`static_schema_analysis.py`](static_schema_analysis.py) | Estático | Agrega tablas, funciones, triggers, índices, RLS | `_data/static-analysis.json` |
| [`extract_table_catalog.py`](extract_table_catalog.py) | Estático | Catálogo de tablas/columnas de los tres directorios | `_data/table-catalog.json` |
| [`extract_sql_functions.py`](extract_sql_functions.py) | Estático | Firmas y definiciones de funciones | `_data/sql-functions.json` |
| [`extract_query_sites.py`](extract_query_sites.py) | Estático | Consultas de `web/src` y `mobile/src` | `_data/query-sites.json` |
| [`supabase_dependency_scan.py`](supabase_dependency_scan.py) | Estático | Referencias a `auth.*`, `storage.*`, Realtime, cron, etc. | `_data/supabase-deps.json` |
| [`build_listings_and_rpcs.py`](build_listings_and_rpcs.py) | Estático | Construye el inventario de listados y RPCs | `_data/listings-and-rpcs.md` |
| [`db_snapshot.py`](db_snapshot.py) | Conexión (lectura) | Snapshot de catálogo; bloquea PROD si el usuario no es de solo lectura | `_data/<target>-schema.json` |
| [`validate_portable_schema.py`](validate_portable_schema.py) | Conexión (lectura) | Validaciones de esquema portable: objetos, tenant, huérfanos, índices, duplicados y dependencias | Texto o JSON |
| [`01_list_schema_objects.sql`](01_list_schema_objects.sql) | SQL (solo lectura) | Inventario de relaciones, funciones, triggers, constraints, enums y extensiones | Varias tablas |
| [`02_tables_without_tenant.sql`](02_tables_without_tenant.sql) | SQL (solo lectura) | Tablas/vistas sin `tenant_id`; `tenant_id` anulable o de tipo distinto | Clasificación |
| [`03_row_counts_by_tenant.sql`](03_row_counts_by_tenant.sql) | SQL (solo lectura) | Filas por tabla y tenant | `tenant_id` + conteos |
| [`04_orphan_foreign_keys.sql`](04_orphan_foreign_keys.sql) | SQL (solo lectura) | Huérfanos por FK y FKs `NOT VALID` | Conteos por constraint |
| [`05_missing_indexes_on_filters.sql`](05_missing_indexes_on_filters.sql) | SQL (solo lectura) | FKs y filtros sin índice líder; tablas con `seq_scan` alto | Candidatos |
| [`06_duplicate_business_keys.sql`](06_duplicate_business_keys.sql) | SQL (solo lectura) | Duplicados exactos y normalizados de claves de negocio | Claves acotadas |
| [`07_function_dependencies.sql`](07_function_dependencies.sql) | SQL (solo lectura) | Dependencias tabla/función, triggers y `SECURITY DEFINER` sin `search_path` | Varias tablas |
| [`validate_sql_basic.py`](validate_sql_basic.py) | Estático | Balance de paréntesis/literales, `READ ONLY`, escrituras y secretos en los `.sql` | Texto |
| [`check_no_secrets.py`](check_no_secrets.py) | Estático | Escáner de secretos del paquete (credenciales, URLs, JWT, roles owner) | Texto |
| [`run_readonly_sql.py`](run_readonly_sql.py) | Conexión (lectura) | Ejecuta los 7 SQL sin psql (protocolo simple pg8000); exige READ ONLY, hace rollback y bloquea PROD no read-only | Texto |
| [`validate_disposable_env.py`](validate_disposable_env.py) | Conexión (DEV, base temporal) | Crea una DB desechable, aplica baseline, siembra sintética, prueba RLS/keyset/up-down-up y la elimina; usa rol NOBYPASSRLS y rechaza PROD | Texto + evidencia |
| [`validate_business_disposable.py`](validate_business_disposable.py) | Conexión (DEV, base temporal) | Descubre todas las migraciones, siembra identidad+catálogo+productos+inventario+ventas+terceros+compras+cartera+apartados+jobs, prueba N disponibles, sumas y reconciliación línea-nivel, up-down-up y checksums/nombres contra el ledger | Texto + evidencia |
| [`validate_pagination_perf.py`](validate_pagination_perf.py) | Conexión (DEV, base temporal) | Slice C: 130 filas ×9 listados, keyset con empates, página vacía, cambio concurrente y `EXPLAIN (ANALYZE, BUFFERS)` | Texto + evidencia |
| [`validate_runtime_roles.py`](validate_runtime_roles.py) | Conexión (DEV, base temporal) | Prueba roles migrador/auth/API `NOBYPASSRLS`, mínimo privilegio y aislamiento | Texto + evidencia |
| [`validate_p0_sell_flow.py`](validate_p0_sell_flow.py) | Conexión (DEV, base temporal) | P0 end-to-end: identidad, productos, stock, clientes, venta+pago, paginación, aislamiento y brechas P0/P1/P2 | Texto + evidencia |
| [`validate_p1_lifecycle.py`](validate_p1_lifecycle.py) | Conexión (DEV, base temporal) | P1: recepción parcial/cierre de compra, abonos/cierre de apartado, aging CxP, sobrepago y conversión | Texto + evidencia |
| [`validate_cash_0015.py`](validate_cash_0015.py) | Conexión (DEV, base temporal) | Slice G: 0015 caja, RLS, sesión única, arqueo, append-only, cierre inmutable y up/down/up | Texto + evidencia |
| [`test_ledger_contract.py`](test_ledger_contract.py) | Estático | Réplica de reglas del runner: prefijo exacto, nombres/checksums, dirty, huecos y reordenamiento | Texto + evidencia |
| [`verify_migration_checksums.py`](verify_migration_checksums.py) | Estático | Verificación de checksums del ledger `schema_migrations` | Texto |

## Validador portable

`validate_portable_schema.py` exige PostgreSQL 15+, fija `statement_timeout`, abre la conexión en modo de solo lectura y **aborta PROD** si el usuario es superusuario o tiene `CREATE` (salvo `--allow-prod-nonreadonly`, no recomendado).

```bash
export DATABASE_URL_DEV   # valor real fuera del repo; nunca imprimirlo
python3 tools/database/validate_portable_schema.py --env DEV objects
python3 tools/database/validate_portable_schema.py --env DEV tenantless
python3 tools/database/validate_portable_schema.py --env DEV tenant-counts
python3 tools/database/validate_portable_schema.py --env DEV orphans
python3 tools/database/validate_portable_schema.py --env DEV indexes
python3 tools/database/validate_portable_schema.py --env DEV duplicates
python3 tools/database/validate_portable_schema.py --env DEV function-deps
python3 tools/database/validate_portable_schema.py --env DEV all --json
```

Comprueba:

1. Conteo de tablas, vistas, matviews, funciones, triggers, índices, constraints y extensiones.
2. Tablas sin `tenant_id`, distinguiendo catálogos globales conocidos.
3. Filas por tenant (solo UUID y conteos; nunca datos personales).
4. Foreign keys con referencias rotas (conteo, sin listar filas).
5. FKs y columnas de filtro (`tenant_id`, `status`, `created_at`, etc.) sin índice líder.
6. Duplicados en claves de negocio candidatas (`sku`, `code`, `document_number`, `email`, `slug`, `operation_id`) o indicadas con `--key`.
7. Funciones, `SECURITY DEFINER` sin `search_path`, funciones que aún usan `auth.*` y dependencias función→función.

Los checks 6 y 7 son heurísticos: reportan candidatos, no sustituyen la revisión de [rpc-migration-matrix.md](../../docs/database-portability/rpc-migration-matrix.md) ni la reconciliación del [runbook](../../docs/database-portability/data-migration-runbook.md).

## Scripts SQL de inspección

Los siete archivos `0N_*.sql` son la variante ejecutable directamente con `psql` (o cualquier cliente SQL) de las mismas comprobaciones. No requieren Python ni `pg8000`, no crean objetos y no dependen de funciones auxiliares: el conteo dinámico usa `query_to_xml` + `xmltable`.

### Requisitos y garantías

| Requisito | Detalle |
|---|---|
| Motor | **PostgreSQL 15 o superior** |
| Cliente | `psql` 15+ o un cliente que envíe el archivo como un solo script |
| Rol | solo lectura; no requiere superusuario |
| Extensiones | ninguna; todo vive en `pg_catalog` |
| Aislamiento | cada archivo abre `BEGIN; SET TRANSACTION READ ONLY;` y cierra con `COMMIT;` |
| Límites | `statement_timeout` (60–180 s), `lock_timeout` (5 s), `idle_in_transaction_session_timeout` y `LIMIT` en las secciones de detalle |

Patrón común:

```sql
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;
-- SELECT ...
COMMIT;
```

`SET TRANSACTION READ ONLY` hace que cualquier escritura accidental falle en el servidor. No se usan `CREATE TEMP TABLE`, `DO` ni `CALL`: crear objetos, aunque sean temporales, dejaría de ser solo lectura.

### Uso

```bash
psql -X -v ON_ERROR_STOP=1 -f tools/database/01_list_schema_objects.sql
```

La conexión debe venir de variables de entorno o de `.pgpass`; **no escriba la URL en la línea de comandos ni en un archivo versionado**. Para toda la batería:

```bash
for f in tools/database/0*.sql; do
  echo "== $f =="
  psql -X -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Validación estática previa (no requiere base):

```bash
python3 tools/database/validate_sql_basic.py
```

### Parámetros editables

| Script | Parámetro | Defecto | Uso |
|---|---|---|---|
| `03` | `params.solo_esquema` | `NULL` | Limitar a `public` u otro esquema |
| `03` | `params.solo_tabla` | `NULL` | Analizar una sola tabla |
| `03` | `params.max_tenants_por_tabla` | `500` | Acotar la salida por tabla |
| `04` | `params.solo_tabla_hija` | `NULL` | Analizar las FKs de una tabla |
| `04` | `params.max_huerfanos_por_fk` | `1001` | Cortar la búsqueda al superar el umbral |
| `06` | CTE `claves` | catálogo del script | Añadir o quitar reglas de negocio |

### Interpretación

- **`01`**: compare el catálogo real con [schema-inventory.md](../../docs/database-portability/schema-inventory.md). Revise objetos fuera de `public`, matviews que no admiten RLS (caso `stock_balances`, [`ADD_EXPIRATION_BATCHES_PHASE2.sql:162-165`](../../shared/supabase/migrations/ADD_EXPIRATION_BATCHES_PHASE2.sql#L162-L165)), funciones `SECURITY DEFINER` y extensiones como `pg_cron`.
- **`02`**: distingue tablas **derivadas** (sin `tenant_id` pero con FK a una tabla que sí lo tiene) de catálogos globales y de riesgos reales. `third_parties` declara `tenant_id` anulable ([`ADD_THIRD_PARTIES.sql:13`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L13)); `units_of_measure` mezcla filas globales y de tenant. Una tabla derivada exige que todos los joins respeten el aislamiento ([multitenancy-isolation.md](../../docs/database-portability/multitenancy-isolation.md)).
- **`03`**: en DEV (hoy con baseline `0001`/`0002`, pero sin datos de negocio) no devolverá filas de tablas históricas; es el resultado esperado. Los conteos son exactos (`count(*)`), no `reltuples`, y por eso pueden tardar. Un `tenant_id NULL` aparece como una fila más.
- **`04`**: `huerfanos = 0` indica FK íntegra en el momento de la lectura. Un valor `>= max_huerfanos_por_fk` significa «al menos ese número». Una FK `NOT VALID` no garantiza integridad histórica aunque el conteo sea cero. No repare huérfanos sin revisar el caso; hay claves de negocio sin `UNIQUE` que las respalde, como `third_parties (tenant_id, document_number)` ([`ADD_THIRD_PARTIES.sql:281`](../../shared/supabase/migrations/ADD_THIRD_PARTIES.sql#L281)).
- **`05`**: los índices se **proponen**, no se crean. `seq_scan`/`idx_scan` salen de `pg_stat_user_tables` y estarán vacíos en una base recién creada. Confirme con `EXPLAIN (ANALYZE, BUFFERS)` y con [pagination-query-matrix.md §9](../../docs/database-portability/pagination-query-matrix.md).
- **`06`**: normaliza con `lower(btrim(...))` y compara además claves entre tenants (email, barcode). Un «duplicado» puede ser legítimo si el negocio distingue mayúsculas. Las claves de correo y documento se imprimen **parcialmente enmascaradas** (`2 caracteres + *** + 2 caracteres`) y la salida se acota a 20 grupos por regla. La segunda sección lista las reglas **omitidas** por tabla o columna ausente, para no confundir «sin duplicados» con «no comprobado».
- **`07`**: `usa_auth` y `usa_plataforma` marcan funciones que deben desaparecer o reescribirse ([supabase-dependencies.md](../../docs/database-portability/supabase-dependencies.md), [rpc-migration-matrix.md](../../docs/database-portability/rpc-migration-matrix.md)). Las dependencias se extraen con expresiones regulares sobre `prosrc`: es una heurística, no un parser; no detecta SQL construido con `format()`. La sección 4 lista `SECURITY DEFINER` sin `search_path` fijo.

### Privacidad y coste

| Control | Implementación |
|---|---|
| Solo lectura | `SET TRANSACTION READ ONLY` en cada archivo |
| Sin secretos | no se leen ni imprimen URLs, tokens ni contraseñas; el validador falla si detecta `postgres://`, `DATABASE_URL=` o `password=` |
| Sin PII masiva | `03` imprime solo `tenant_id` y conteos; `06` enmascara email/documento y acota a 20 grupos por regla |
| Sin filas de negocio | no hay `SELECT *` de tablas; las consultas dinámicas agregan o cuentan |
| Límites | `statement_timeout`, `lock_timeout` y `LIMIT` en las secciones de detalle |

`03` y `06` pueden ser costosos y `06` puede revelar claves de negocio. Ejecute contra una copia de prueba o con un rol restringido y guarde la salida en un archivo protegido.

### Estado de validación

| Comprobación | Resultado |
|---|---|
| `psql` / servidor PostgreSQL local | **No disponible** en este entorno |
| Docker para un PostgreSQL efímero | **Bloqueado** (`permission denied` en el socket) |
| Balance de paréntesis, literales y `dollar-quotes`; `READ ONLY`; ausencia de escrituras y secretos | Verificado con [`validate_sql_basic.py`](validate_sql_basic.py) |
| Semántica contra el catálogo real, `EXPLAIN` y tiempos | **Pendiente**; requiere PostgreSQL 15+ |

Resultado actual: `7/7 archivos sin errores básicos. La semántica y la ejecución real siguen pendientes.`

### Si se adapta a escritura

Cualquier variante que cree índices, añada `tenant_id`, repare huérfanos o deduplique **no** forma parte de la Tarea 8. En ese caso: documente la motivación en un ADR de [`docs/decisions/`](../../docs/decisions/), exija confirmación explícita y ventana, tome respaldo verificable, pruebe en una copia, mida el antes/después con `03`–`05` y no ejecute contra PROD mientras el usuario no sea de solo lectura.

## Reglas de uso

- Ejecutar solo contra DEV o contra una copia restaurada; PROD únicamente con usuario de solo lectura.
- No pegar URLs ni credenciales en la terminal compartida, reportes o commits.
- Los scripts que conectan no son idempotentes en sentido estricto, pero **no tienen efectos**: repetir una ejecución produce el mismo reporte.
- No usar `psql -f` con archivos de este directorio contra PROD.
