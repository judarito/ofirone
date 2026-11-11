-- ============================================================================
-- Ofirone · Portabilidad PostgreSQL · Tarea 8
-- Archivo : 03_row_counts_by_tenant.sql
-- Propósito: contar filas por tenant en cada tabla que declare `tenant_id`,
--            para reconciliación y para detectar tablas vacías o desbalanceadas.
--
-- Tipo            : SOLO LECTURA (transacción READ ONLY).
-- PostgreSQL mín. : 15 (usa query_to_xml + xmltable; ambos en pg_catalog).
-- Idempotente     : sí; cada ejecución produce el mismo conteo si los datos
--                   no cambian y no escribe nada.
-- Datos impresos  : `tenant_id` (identificador opaco, no dato personal) y
--                   conteos. No imprime filas, nombres, emails ni importes.
-- Límites         : `max_tenants_por_tabla` acota la salida por tabla;
--                   `statement_timeout` acota el tiempo total.
--
-- Uso sugerido:
--   psql -X -v ON_ERROR_STOP=1 -f tools/database/03_row_counts_by_tenant.sql
--
-- Ajuste: edite el CTE `params` para analizar un solo esquema o tabla. En una
-- base grande conviene ejecutar por tabla y no de una vez.
--
-- ADVERTENCIA: si se adapta para escribir resultados en una tabla, es una
-- operación de escritura. Requiere confirmación explícita y una tabla destino
-- fuera del esquema de negocio.
--
-- Validación: no hay psql ni instancia PostgreSQL disponible en el entorno de
-- análisis. Sintaxis verificada solo de forma básica; ejecución real pendiente.
-- ============================================================================

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;

-- ----------------------------------------------------------------------------
-- 1. Conteo por (tabla, tenant)
--    Solo tablas base/particionadas con columna `tenant_id`. Se excluyen las
--    particiones hijas para no contar dos veces (la tabla padre ya las cubre).
-- ----------------------------------------------------------------------------
WITH params AS (
  SELECT NULL::text   AS solo_esquema,   -- ej. 'public'
         NULL::text   AS solo_tabla,     -- ej. 'sales'
         500::bigint  AS max_tenants_por_tabla
),
tablas AS (
  SELECT c.oid,
         n.nspname AS esquema,
         c.relname AS tabla,
         p.max_tenants_por_tabla
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN params p
  WHERE c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
    AND (p.solo_esquema IS NULL OR n.nspname = p.solo_esquema)
    AND (p.solo_tabla IS NULL OR c.relname = p.solo_tabla)
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid
        AND a.attname = 'tenant_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    )
)
SELECT t.esquema,
       t.tabla,
       x.tenant_id,
       x.filas,
       count(*) OVER (PARTITION BY t.esquema, t.tabla)      AS tenants_listados,
       sum(x.filas) OVER (PARTITION BY t.esquema, t.tabla)  AS filas_listadas
FROM tablas t
CROSS JOIN LATERAL query_to_xml(
  format(
    'SELECT tenant_id::text AS tenant_id, count(*)::bigint AS filas
       FROM %I.%I
      GROUP BY tenant_id
      ORDER BY 2 DESC
      LIMIT %s',
    t.esquema, t.tabla, t.max_tenants_por_tabla
  ),
  false,  -- no incluir declaración XML
  true,   -- escapar contenido
  ''
) AS q(doc)
CROSS JOIN LATERAL xmltable(
  '/row' PASSING CAST(COALESCE(NULLIF(q.doc::text, ''), '<x/>') AS xml)
  COLUMNS tenant_id text   PATH 'tenant_id',
          filas     bigint PATH 'filas'
) AS x
ORDER BY t.esquema, t.tabla, x.filas DESC, x.tenant_id;

-- ----------------------------------------------------------------------------
-- 2. Cobertura: tablas con `tenant_id` frente a tablas sin él
--    No ejecuta conteos; sirve para interpretar el resultado anterior.
-- ----------------------------------------------------------------------------
WITH relaciones AS (
  SELECT c.oid,
         n.nspname,
         c.relname,
         EXISTS (
           SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = c.oid
             AND a.attname = 'tenant_id'
             AND a.attnum > 0
             AND NOT a.attisdropped
         ) AS tiene_tenant
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
)
SELECT count(*) FILTER (WHERE tiene_tenant)::bigint     AS tablas_con_tenant,
       count(*) FILTER (WHERE NOT tiene_tenant)::bigint AS tablas_sin_tenant,
       count(*)::bigint                                 AS tablas_totales
FROM relaciones;

COMMIT;
