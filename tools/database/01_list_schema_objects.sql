-- ============================================================================
-- Ofirone · Portabilidad PostgreSQL · Tarea 8
-- Archivo : 01_list_schema_objects.sql
-- Propósito: listar tablas, vistas, vistas materializadas, funciones,
--            triggers, constraints, enums y extensiones del esquema.
--
-- Tipo            : SOLO LECTURA (transacción READ ONLY).
-- PostgreSQL mín. : 15.
-- Idempotente     : sí; no crea, altera ni elimina objetos ni datos.
-- Datos impresos  : nombres de objetos, propietario, tamaño y comentarios.
--                   No imprime filas de negocio ni datos personales.
-- Límites         : ninguno sobre el catálogo; excluye esquemas del sistema.
--
-- Uso sugerido:
--   psql -X -v ON_ERROR_STOP=1 -f tools/database/01_list_schema_objects.sql
--
-- ADVERTENCIA: este archivo no debe convertirse en un script de escritura.
-- Si se adapta para crear/alterar objetos, exigir confirmación explícita y
-- revisar el perímetro de la Tarea 8 (solo inspección y validación).
--
-- Validación: no hay psql ni instancia PostgreSQL disponible en el entorno de
-- análisis. La sintaxis se verificó solo de forma básica con
-- tools/database/validate_sql_basic.py; la ejecución real queda pendiente.
-- ============================================================================

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- ----------------------------------------------------------------------------
-- 0. Resumen por categoría de objeto
-- ----------------------------------------------------------------------------
SELECT 'relaciones (tablas, vistas, matviews, foráneas)' AS categoria,
       count(*)::bigint AS objetos
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
UNION ALL
SELECT 'funciones y procedimientos', count(*)::bigint
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
UNION ALL
SELECT 'triggers de usuario', count(*)::bigint
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
UNION ALL
SELECT 'constraints', count(*)::bigint
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
UNION ALL
SELECT 'tipos enum', count(*)::bigint
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE t.typtype = 'e'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
UNION ALL
SELECT 'extensiones instaladas', count(*)::bigint
FROM pg_extension
ORDER BY categoria;

-- ----------------------------------------------------------------------------
-- 1. Relaciones (tablas, tablas particionadas, vistas, matviews, foráneas)
-- ----------------------------------------------------------------------------
SELECT n.nspname                                      AS esquema,
       c.relname                                      AS objeto,
       CASE c.relkind
         WHEN 'r' THEN 'tabla'
         WHEN 'p' THEN 'tabla_particionada'
         WHEN 'v' THEN 'vista'
         WHEN 'm' THEN 'vista_materializada'
         WHEN 'f' THEN 'tabla_foranea'
         ELSE c.relkind::text
       END                                            AS tipo,
       pg_get_userbyid(c.relowner)                    AS propietario,
       CASE WHEN c.relkind IN ('r', 'p', 'm')
            THEN c.reltuples::bigint END              AS filas_estimadas,
       CASE WHEN c.relkind IN ('r', 'p', 'm')
            THEN pg_size_pretty(pg_total_relation_size(c.oid)) END AS tamano_total,
       c.relrowsecurity                              AS rls_habilitado,
       c.relforcerowsecurity                         AS rls_forzado,
       obj_description(c.oid, 'pg_class')            AS comentario
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, tipo, c.relname;

-- ----------------------------------------------------------------------------
-- 2. Funciones y procedimientos (firma, seguridad, volatilidad, search_path)
-- ----------------------------------------------------------------------------
SELECT n.nspname                                                AS esquema,
       p.proname                                                AS funcion,
       pg_get_function_identity_arguments(p.oid)                AS argumentos,
       pg_get_function_result(p.oid)                            AS retorno,
       CASE p.prokind WHEN 'p' THEN 'procedimiento' ELSE 'funcion' END AS clase,
       CASE p.provolatile
         WHEN 'i' THEN 'immutable'
         WHEN 's' THEN 'stable'
         WHEN 'v' THEN 'volatile'
       END                                                      AS volatilidad,
       p.prosecdef                                              AS security_definer,
       pg_get_userbyid(p.proowner)                              AS propietario,
       array_to_string(p.proconfig, ', ')                       AS configuracion
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, p.proname, argumentos;

-- ----------------------------------------------------------------------------
-- 3. Triggers de usuario
-- ----------------------------------------------------------------------------
SELECT n.nspname                                     AS esquema,
       c.relname                                     AS tabla,
       t.tgname                                      AS trigger,
       pg_get_triggerdef(t.oid)                      AS definicion,
       p.proname                                     AS funcion,
       t.tgenabled                                  AS habilitado
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, c.relname, t.tgname;

-- ----------------------------------------------------------------------------
-- 4. Constraints (PK, UNIQUE, FK, CHECK, EXCLUSION)
-- ----------------------------------------------------------------------------
SELECT n.nspname                                     AS esquema,
       c.relname                                     AS tabla,
       con.conname                                   AS constraint,
       CASE con.contype
         WHEN 'p' THEN 'primary key'
         WHEN 'u' THEN 'unique'
         WHEN 'f' THEN 'foreign key'
         WHEN 'c' THEN 'check'
         WHEN 'x' THEN 'exclusion'
         ELSE con.contype::text
       END                                           AS tipo,
       con.convalidated                              AS validada,
       pg_get_constraintdef(con.oid)                 AS definicion
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, c.relname, tipo, con.conname;

-- ----------------------------------------------------------------------------
-- 5. Tipos enum y sus valores
-- ----------------------------------------------------------------------------
SELECT n.nspname                                     AS esquema,
       t.typname                                     AS enum,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS valores
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typtype = 'e'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
GROUP BY n.nspname, t.typname
ORDER BY n.nspname, t.typname;

-- ----------------------------------------------------------------------------
-- 6. Extensiones instaladas (para detectar dependencias de proveedor)
-- ----------------------------------------------------------------------------
SELECT e.extname                                     AS extension,
       e.extversion                                  AS version,
       n.nspname                                     AS esquema,
       e.extrelocatable                              AS reubicable
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

COMMIT;
