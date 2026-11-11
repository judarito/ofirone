-- ============================================================================
-- Ofirone · Portabilidad PostgreSQL · Tarea 8
-- Archivo : 05_missing_indexes_on_filters.sql
-- Propósito: detectar columnas de foreign key y columnas usadas como filtro
--            que no tienen un índice cuyo primer campo sea esa columna.
--
-- Tipo            : SOLO LECTURA (transacción READ ONLY).
-- PostgreSQL mín. : 15.
-- Idempotente     : sí; solo consulta catálogo y estadísticas.
-- Datos impresos  : nombres de tablas/columnas/índices y contadores de uso.
--                   No imprime valores de negocio ni datos personales.
-- Límites         : salida acotada a 200/100 filas; `pg_stat_user_tables`
--                   puede estar vacío o desactualizado (no es un error).
--
-- Uso sugerido:
--   psql -X -v ON_ERROR_STOP=1 -f tools/database/05_missing_indexes_on_filters.sql
--
-- ADVERTENCIA: los índices se proponen, NO se crean. Un `CREATE INDEX` es una
-- operación de escritura: requiere confirmación explícita, ventana, medición
-- de tamaño y evaluación de `CONCURRENTLY` (fuera de transacción).
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
-- 1. FKs sin índice que empiece por la primera columna de la FK
--    Un índice sobre columnas posteriores no sirve para el join por la primera.
-- ----------------------------------------------------------------------------
WITH indices AS (
  SELECT i.indrelid,
         i.indexrelid,
         i.indisunique,
         i.indkey[0]                    AS primera_columna,
         pg_get_indexdef(i.indexrelid)  AS definicion
  FROM pg_index i
  WHERE i.indisvalid
    AND i.indpred IS NULL
    AND i.indkey[0] <> 0               -- excluye índices de expresión
),
fks AS (
  SELECT con.oid,
         con.conname,
         con.conrelid,
         con.confrelid,
         con.conkey[1]                  AS primera_columna_fk,
         array_length(con.conkey, 1)    AS numero_columnas,
         (SELECT string_agg(a.attname, ', ' ORDER BY u.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.conrelid AND a.attnum = u.attnum) AS columnas
  FROM pg_constraint con
  WHERE con.contype = 'f'
)
SELECT n.nspname                                      AS esquema,
       c.relname                                      AS tabla_hija,
       f.conname                                      AS constraint,
       f.columnas                                     AS columnas_fk,
       f.numero_columnas                              AS numero_columnas,
       c.reltuples::bigint                            AS filas_estimadas,
       st.seq_scan                                    AS seq_scans,
       st.idx_scan                                    AS idx_scans,
       'crear indice que empiece por ' || f.columnas AS accion_sugerida
FROM fks f
JOIN pg_class c ON c.oid = f.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables st ON st.relid = c.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
  AND NOT EXISTS (
    SELECT 1 FROM indices idx
    WHERE idx.indrelid = f.conrelid
      AND idx.primera_columna = f.primera_columna_fk
  )
ORDER BY n.nspname, c.relname, f.conname
LIMIT 200;

-- ----------------------------------------------------------------------------
-- 2. Columnas de filtro frecuentes sin índice líder
--    Lista basada en nombres observados en los listados y RPCs del repositorio
--    (tenant_id, estado, fechas, documentos, códigos). Es una heurística:
--    confirme con `EXPLAIN (ANALYZE, BUFFERS)` antes de crear el índice.
-- ----------------------------------------------------------------------------
WITH indices AS (
  SELECT i.indrelid,
         i.indkey[0] AS primera_columna
  FROM pg_index i
  WHERE i.indisvalid
    AND i.indpred IS NULL
    AND i.indkey[0] <> 0
),
candidatas AS (
  SELECT c.oid,
         n.nspname,
         c.relname,
         a.attnum,
         a.attname,
         c.reltuples
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
    AND a.attname IN (
      'tenant_id', 'status', 'state', 'is_active', 'created_at', 'updated_at',
      'deleted_at', 'sold_at', 'email', 'document', 'document_number', 'code',
      'sku', 'barcode', 'name', 'order_number', 'payment_status'
    )
)
SELECT ca.nspname                                     AS esquema,
       ca.relname                                     AS tabla,
       ca.attname                                     AS columna,
       ca.reltuples::bigint                           AS filas_estimadas,
       st.seq_scan                                    AS seq_scans,
       st.idx_scan                                    AS idx_scans,
       'evaluar indice btree sobre (' || ca.attname || ')' AS accion_sugerida
FROM candidatas ca
LEFT JOIN pg_stat_user_tables st ON st.relid = ca.oid
WHERE NOT EXISTS (
  SELECT 1 FROM indices idx
  WHERE idx.indrelid = ca.oid
    AND idx.primera_columna = ca.attnum
)
ORDER BY st.seq_scan DESC NULLS LAST,
         ca.reltuples DESC,
         ca.nspname,
         ca.relname,
         ca.attname
LIMIT 200;

-- ----------------------------------------------------------------------------
-- 3. Tablas con muchas lecturas secuenciales frente a lecturas por índice
--    Señal de posible índice faltante; no es concluyente por sí sola.
-- ----------------------------------------------------------------------------
SELECT schemaname                                     AS esquema,
       relname                                        AS tabla,
       seq_scan,
       COALESCE(idx_scan, 0)                          AS idx_scan,
       n_live_tup                                     AS filas_vivas_estimadas,
       pg_size_pretty(pg_total_relation_size(relid))  AS tamano_total
FROM pg_stat_user_tables
WHERE seq_scan > COALESCE(idx_scan, 0)
  AND n_live_tup > 0
ORDER BY seq_scan DESC, n_live_tup DESC
LIMIT 100;

COMMIT;
