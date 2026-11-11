-- ============================================================================
-- Ofirone · Portabilidad PostgreSQL · Tarea 8
-- Archivo : 04_orphan_foreign_keys.sql
-- Propósito: detectar registros huérfanos para cada foreign key declarada
--            (hijos que apuntan a un padre inexistente) y FKs no validadas.
--
-- Tipo            : SOLO LECTURA (transacción READ ONLY).
-- PostgreSQL mín. : 15 (usa query_to_xml + xmltable).
-- Idempotente     : sí; solo cuenta, no corrige ni borra huérfanos.
-- Datos impresos  : nombres de constraints/tablas y conteos. No imprime las
--                   filas huérfanas ni columnas de negocio.
-- Límites         : `max_huerfanos_por_fk` corta la búsqueda al superar el
--                   umbral (el conteo se reporta como ">umbral"). El script
--                   recorre todas las FKs; en bases grandes ejecutar por tabla.
--
-- Uso sugerido:
--   psql -X -v ON_ERROR_STOP=1 -f tools/database/04_orphan_foreign_keys.sql
--
-- Ajuste: edite `params.solo_tabla_hija` para limitar el análisis a una tabla.
--
-- ADVERTENCIA: este script NO repara huérfanos. Un `UPDATE`/`DELETE` de
-- reparación exige confirmación explícita, respaldo, revisión funcional y una
-- transacción aparte; nunca debe ejecutarse contra producción sin aprobación.
--
-- Validación: no hay psql ni instancia PostgreSQL disponible en el entorno de
-- análisis. Sintaxis verificada solo de forma básica; ejecución real pendiente.
-- ============================================================================

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '180s';
SET LOCAL search_path = pg_catalog, public;

-- ----------------------------------------------------------------------------
-- 1. FKs con conteo de huérfanos
--    MATCH SIMPLE (por defecto): se ignoran filas con alguna columna NULL.
--    MATCH FULL: se ignoran solo las filas totalmente NULL; una fila
--    parcialmente NULL se reporta como huérfana.
-- ----------------------------------------------------------------------------
WITH params AS (
  SELECT NULL::text    AS solo_tabla_hija,     -- ej. 'sale_lines'
         1001::bigint  AS max_huerfanos_por_fk
),
fks AS (
  SELECT con.oid                                   AS con_oid,
         con.conname,
         con.convalidated,
         con.confmatchtype,
         nch.nspname                               AS esquema_hijo,
         ch.relname                                AS tabla_hija,
         npa.nspname                               AS esquema_padre,
         pa.relname                                AS tabla_padre,
         (SELECT array_agg(quote_ident(a.attname) ORDER BY u.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.conrelid AND a.attnum = u.attnum) AS cols_hijo,
         (SELECT array_agg(quote_ident(a.attname) ORDER BY u.ord)
            FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.confrelid AND a.attnum = u.attnum) AS cols_padre,
         p.max_huerfanos_por_fk
  FROM pg_constraint con
  JOIN pg_class ch      ON ch.oid = con.conrelid
  JOIN pg_namespace nch ON nch.oid = ch.relnamespace
  JOIN pg_class pa      ON pa.oid = con.confrelid
  JOIN pg_namespace npa ON npa.oid = pa.relnamespace
  CROSS JOIN params p
  WHERE con.contype = 'f'
    AND nch.nspname NOT IN ('pg_catalog', 'information_schema')
    AND nch.nspname !~ '^pg_'
    AND npa.nspname NOT IN ('pg_catalog', 'information_schema')
    AND npa.nspname !~ '^pg_'
    AND (p.solo_tabla_hija IS NULL OR ch.relname = p.solo_tabla_hija)
),
preds AS (
  SELECT f.*,
         (SELECT string_agg(format('c.%s IS NOT NULL', col), ' AND ')
            FROM unnest(f.cols_hijo) AS u(col))                       AS pred_simple,
         (SELECT string_agg(format('c.%s IS NULL', col), ' AND ')
            FROM unnest(f.cols_hijo) AS u(col))                       AS pred_all_null,
         (SELECT string_agg(format('p.%s = c.%s', pcol, ccol), ' AND ')
            FROM unnest(f.cols_hijo, f.cols_padre) AS u(ccol, pcol))  AS join_pred
  FROM fks f
),
checks AS (
  SELECT p.*,
         format(
           'SELECT count(*)::bigint AS huerfanos
              FROM (SELECT 1
                      FROM %I.%I c
                     WHERE (%s)
                       AND NOT EXISTS (SELECT 1 FROM %I.%I p WHERE %s)
                     LIMIT %s) s',
           p.esquema_hijo,  p.tabla_hija,
           CASE WHEN p.confmatchtype = 'f'
                THEN 'NOT (' || p.pred_all_null || ')'
                ELSE p.pred_simple
           END,
           p.esquema_padre, p.tabla_padre,
           p.join_pred,
           p.max_huerfanos_por_fk
         ) AS sql
  FROM preds p
)
SELECT c.esquema_hijo,
       c.tabla_hija,
       c.conname,
       c.esquema_padre,
       c.tabla_padre,
       c.convalidated,
       CASE c.confmatchtype
         WHEN 'f' THEN 'full'
         WHEN 'p' THEN 'partial'
         ELSE 'simple'
       END                                            AS match,
       x.huerfanos
FROM checks c
CROSS JOIN LATERAL query_to_xml(c.sql, false, true, '') AS q(doc)
CROSS JOIN LATERAL xmltable(
  '/row' PASSING q.doc
  COLUMNS huerfanos bigint PATH 'huerfanos'
) AS x
ORDER BY x.huerfanos DESC, c.esquema_hijo, c.tabla_hija, c.conname
LIMIT 1000;

-- ----------------------------------------------------------------------------
-- 2. FKs declaradas pero no validadas (`NOT VALID`)
--    No implica huérfanos, pero sí que el motor no ha comprobado los datos
--    históricos. Deben validarse antes de confiar en la integridad.
-- ----------------------------------------------------------------------------
SELECT n.nspname                                      AS esquema,
       c.relname                                      AS tabla,
       con.conname                                    AS constraint,
       pg_get_constraintdef(con.oid)                  AS definicion
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype = 'f'
  AND NOT con.convalidated
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, c.relname, con.conname;

COMMIT;
