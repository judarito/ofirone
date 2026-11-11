-- ============================================================================
-- Ofirone · Portabilidad PostgreSQL · Tarea 8
-- Archivo : 02_tables_without_tenant.sql
-- Propósito: detectar tablas y vistas sin columna `tenant_id` y clasificar
--            si son globales, derivadas por FK o candidatas a fuga de datos.
--
-- Tipo            : SOLO LECTURA (transacción READ ONLY).
-- PostgreSQL mín. : 15.
-- Idempotente     : sí; solo consulta catálogo.
-- Datos impresos  : nombres de tablas/columnas y estimaciones del catálogo.
--                   No lee filas de negocio ni datos personales.
-- Límites         : excluye esquemas del sistema y particiones hijas.
--
-- Uso sugerido:
--   psql -X -v ON_ERROR_STOP=1 -f tools/database/02_tables_without_tenant.sql
--
-- ADVERTENCIA: si se adapta para añadir `tenant_id`, es una migración de
-- escritura. Requiere confirmación explícita, respaldo y ventana de mantenimiento.
--
-- Validación: no hay psql ni instancia PostgreSQL disponible en el entorno de
-- análisis. Sintaxis verificada solo de forma básica; ejecución real pendiente.
-- ============================================================================

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- ----------------------------------------------------------------------------
-- 1. Relaciones sin `tenant_id` (tablas, tablas particionadas, vistas)
--    `refs_tenant` = FKs directas hacia relaciones que sí tienen `tenant_id`.
--    Una relación "derivada" hereda el tenant por join; no lo declara.
-- ----------------------------------------------------------------------------
WITH relaciones AS (
  SELECT c.oid,
         n.nspname,
         c.relname,
         c.relkind,
         c.reltuples,
         EXISTS (
           SELECT 1
           FROM pg_attribute a
           WHERE a.attrelid = c.oid
             AND a.attname = 'tenant_id'
             AND a.attnum > 0
             AND NOT a.attisdropped
         ) AS tiene_tenant
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm')
    AND NOT c.relispartition
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
),
fk_tenant AS (
  SELECT r.oid,
         string_agg(DISTINCT format('%I.%I', pn.nspname, pc.relname), ', ') AS refs_tenant,
         count(DISTINCT con.oid)::bigint AS fk_hacia_tabla_con_tenant
  FROM relaciones r
  JOIN pg_constraint con ON con.conrelid = r.oid AND con.contype = 'f'
  JOIN pg_class pc ON pc.oid = con.confrelid
  JOIN pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE EXISTS (
    SELECT 1
    FROM pg_attribute pa
    WHERE pa.attrelid = pc.oid
      AND pa.attname = 'tenant_id'
      AND pa.attnum > 0
      AND NOT pa.attisdropped
  )
  GROUP BY r.oid
)
SELECT r.nspname                                      AS esquema,
       r.relname                                      AS objeto,
       CASE r.relkind
         WHEN 'r' THEN 'tabla'
         WHEN 'p' THEN 'tabla_particionada'
         WHEN 'v' THEN 'vista'
         WHEN 'm' THEN 'vista_materializada'
       END                                            AS tipo,
       r.reltuples::bigint                            AS filas_estimadas,
       COALESCE(f.refs_tenant, '(ninguna)')           AS fk_hacia_tabla_con_tenant,
       CASE
         WHEN f.refs_tenant IS NOT NULL
           THEN 'derivada: hereda tenant por FK'
         ELSE 'sin tenant y sin FK directa a tabla con tenant_id'
       END                                            AS clasificacion,
       CASE
         WHEN r.relkind IN ('v', 'm')
           THEN 'revisar definicion: puede derivar el tenant por join'
         WHEN f.refs_tenant IS NULL
           THEN 'candidata a catalogo global o a fuga entre tenants'
         ELSE 'verificar que todos los accesos hagan el join de aislamiento'
       END                                            AS observacion
FROM relaciones r
LEFT JOIN fk_tenant f ON f.oid = r.oid
WHERE NOT r.tiene_tenant
ORDER BY r.nspname, tipo, r.relname;

-- ----------------------------------------------------------------------------
-- 2. `tenant_id` presente pero anulable o con tipo distinto de uuid
--    Un tenant anulable permite filas compartidas o sin dueño; hay que
--    justificarlo por tabla (catálogos globales, filas de sistema, etc.).
-- ----------------------------------------------------------------------------
SELECT n.nspname                                      AS esquema,
       c.relname                                      AS tabla,
       a.attname                                      AS columna,
       format_type(a.atttypid, a.atttypmod)           AS tipo,
       a.attnotnull                                   AS not_null,
       c.reltuples::bigint                            AS filas_estimadas,
       CASE
         WHEN a.atttypid <> 'uuid'::regtype THEN 'tipo distinto de uuid'
         WHEN NOT a.attnotnull THEN 'tenant_id anulable'
         ELSE 'correcto'
       END                                            AS diagnostico
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE a.attname = 'tenant_id'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
  AND (NOT a.attnotnull OR a.atttypid <> 'uuid'::regtype)
ORDER BY n.nspname, c.relname;

-- ----------------------------------------------------------------------------
-- 3. Vistas y matviews sin `tenant_id` y sin FK (dependencias de vistas)
--    Se listan aparte porque su aislamiento depende de la definición SQL.
-- ----------------------------------------------------------------------------
SELECT n.nspname                                      AS esquema,
       c.relname                                      AS vista,
       CASE c.relkind WHEN 'v' THEN 'vista' ELSE 'vista_materializada' END AS tipo,
       EXISTS (
         SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = c.oid
           AND a.attname = 'tenant_id'
           AND a.attnum > 0
           AND NOT a.attisdropped
       )                                              AS expone_tenant_id,
       obj_description(c.oid, 'pg_class')             AS comentario
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
  AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = c.oid
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
ORDER BY n.nspname, c.relname;

COMMIT;
