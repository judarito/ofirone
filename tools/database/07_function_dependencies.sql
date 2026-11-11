-- ============================================================================
-- Ofirone · Portabilidad PostgreSQL · Tarea 8
-- Archivo : 07_function_dependencies.sql
-- Propósito: reportar dependencias de funciones SQL/PLpgSQL: tablas y
--            funciones que referencia el cuerpo, triggers que las invocan y
--            funciones SECURITY DEFINER sin `search_path` fijo.
--
-- Tipo            : SOLO LECTURA (transacción READ ONLY).
-- PostgreSQL mín. : 15.
-- Idempotente     : sí; solo lee `pg_proc`, `pg_trigger` y `pg_class`.
-- Datos impresos  : nombres de funciones/tablas y banderas de riesgo.
--                   No imprime el cuerpo de las funciones ni datos de negocio.
-- Límites         : 3000 filas por sección. El análisis es heurístico: usa
--                   expresiones regulares sobre `prosrc`, no un parser SQL.
--
-- Uso sugerido:
--   psql -X -v ON_ERROR_STOP=1 -f tools/database/07_function_dependencies.sql
--
-- ADVERTENCIA: este script no reescribe funciones ni cambia `search_path`.
-- Cualquier `CREATE OR REPLACE FUNCTION` es escritura y exige confirmación
-- explícita, revisión de la matriz RPC y pruebas de regresión.
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
-- 0. Resumen: funciones, SECURITY DEFINER, dependencias de Supabase y
--    funciones sin `search_path` fijo.
-- ----------------------------------------------------------------------------
WITH funcs AS (
  SELECT p.oid,
         p.prosecdef,
         p.prosrc,
         p.proconfig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
)
SELECT count(*)::bigint                                                      AS funciones,
       count(*) FILTER (WHERE prosecdef)::bigint                             AS security_definer,
       count(*) FILTER (WHERE prosecdef AND NOT EXISTS (
         SELECT 1 FROM unnest(COALESCE(proconfig, ARRAY[]::text[])) cfg
         WHERE cfg LIKE 'search_path=%'
       ))::bigint                                                            AS definer_sin_search_path,
       count(*) FILTER (WHERE prosrc ~* 'auth\.(uid|jwt|role|email)[[:space:]]*\(')::bigint AS usan_auth,
       count(*) FILTER (WHERE prosrc ~* '\m(storage|realtime|vault|net|supabase_functions)\.')::bigint AS usan_plataforma
FROM funcs;

-- ----------------------------------------------------------------------------
-- 1. Inventario de funciones con banderas de riesgo
-- ----------------------------------------------------------------------------
WITH funcs AS (
  SELECT p.oid,
         n.nspname,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS argumentos,
         pg_get_function_result(p.oid)             AS retorno,
         CASE p.provolatile
           WHEN 'i' THEN 'immutable'
           WHEN 's' THEN 'stable'
           WHEN 'v' THEN 'volatile'
         END                                       AS volatilidad,
         p.prosecdef,
         pg_get_userbyid(p.proowner)               AS propietario,
         array_to_string(p.proconfig, ', ')        AS configuracion,
         p.proconfig,
         p.prosrc,
         length(p.prosrc)                          AS longitud_codigo
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
)
SELECT nspname                                      AS esquema,
       proname                                      AS funcion,
       argumentos,
       retorno,
       volatilidad,
       prosecdef                                    AS security_definer,
       EXISTS (
         SELECT 1 FROM unnest(COALESCE(proconfig, ARRAY[]::text[])) cfg
         WHERE cfg LIKE 'search_path=%'
       )                                            AS search_path_fijo,
       propietario,
       configuracion,
       longitud_codigo,
       prosrc ~* 'auth\.(uid|jwt|role|email)[[:space:]]*\('        AS usa_auth,
       prosrc ~* '\m(storage|realtime|vault|net|supabase_functions)\.' AS usa_plataforma
FROM funcs
ORDER BY nspname, proname, argumentos;

-- ----------------------------------------------------------------------------
-- 2. Dependencias: tablas referenciadas y funciones invocadas
--    Heurística sobre `prosrc`; los nombres deben existir en el catálogo.
--    Un falso negativo es posible si el SQL se construye dinámicamente.
-- ----------------------------------------------------------------------------
WITH funcs AS (
  SELECT p.oid,
         n.nspname,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS argumentos,
         p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
),
rel_deps AS (
  SELECT DISTINCT
         f.nspname,
         f.proname,
         f.argumentos,
         'tabla'::text AS tipo_dependencia,
         r.m[2]        AS dependencia
  FROM funcs f
  CROSS JOIN LATERAL regexp_matches(
    f.prosrc,
    '(from|join|update|into|delete[[:space:]]+from)[[:space:]]+"?([a-zA-Z_][a-zA-Z0-9_]*)"?',
    'gi'
  ) AS r(m)
  WHERE EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = r.m[2]
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
  )
),
fn_names AS (
  SELECT DISTINCT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind = 'f'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
),
fn_deps AS (
  SELECT DISTINCT
         f.nspname,
         f.proname,
         f.argumentos,
         'funcion'::text AS tipo_dependencia,
         r.m[1]          AS dependencia
  FROM funcs f
  CROSS JOIN LATERAL regexp_matches(
    f.prosrc,
    '\m([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*\(',
    'g'
  ) AS r(m)
  JOIN fn_names fn ON lower(fn.proname) = lower(r.m[1])
  WHERE lower(fn.proname) <> lower(f.proname)
)
SELECT * FROM (
  SELECT * FROM rel_deps
  UNION ALL
  SELECT * FROM fn_deps
) d
ORDER BY tipo_dependencia, nspname, proname, dependencia
LIMIT 3000;

-- ----------------------------------------------------------------------------
-- 3. Triggers de usuario y función que ejecutan
-- ----------------------------------------------------------------------------
SELECT n.nspname                                     AS esquema_tabla,
       c.relname                                     AS tabla,
       t.tgname                                      AS trigger,
       p.proname                                     AS funcion,
       t.tgenabled                                   AS habilitado,
       pg_get_triggerdef(t.oid)                      AS definicion
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, c.relname, t.tgname
LIMIT 3000;

-- ----------------------------------------------------------------------------
-- 4. Funciones SECURITY DEFINER sin `search_path` fijo
--    Riesgo de secuestro de búsqueda si un esquema no confiable precede a
--    `public` en el `search_path` del rol que ejecuta.
-- ----------------------------------------------------------------------------
WITH funcs AS (
  SELECT n.nspname,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS argumentos,
         pg_get_userbyid(p.proowner)               AS propietario,
         p.proconfig,
         p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND p.prosecdef
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
)
SELECT nspname                                      AS esquema,
       proname                                      AS funcion,
       argumentos,
       propietario,
       array_to_string(proconfig, ', ')             AS configuracion,
       'fijar search_path = pg_catalog, public'     AS accion_sugerida
FROM funcs
WHERE NOT EXISTS (
  SELECT 1 FROM unnest(COALESCE(proconfig, ARRAY[]::text[])) cfg
  WHERE cfg LIKE 'search_path=%'
)
ORDER BY nspname, proname, argumentos;

-- ----------------------------------------------------------------------------
-- 5. Funciones que referencian identidad o plataforma Supabase
--    Son candidatas a desaparecer o a reescribirse en el baseline portable.
-- ----------------------------------------------------------------------------
WITH funcs AS (
  SELECT n.nspname,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS argumentos,
         p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_'
)
SELECT nspname                                      AS esquema,
       proname                                      AS funcion,
       argumentos,
       CASE
         WHEN prosrc ~* 'auth\.(uid|jwt|role|email)[[:space:]]*\(' THEN 'auth.*'
         ELSE 'plataforma (storage/realtime/vault/net/supabase_functions)'
       END                                          AS dependencia,
       'revisar en rpc-migration-matrix.md'         AS accion_sugerida
FROM funcs
WHERE prosrc ~* 'auth\.(uid|jwt|role|email)[[:space:]]*\('
   OR prosrc ~* '\m(storage|realtime|vault|net|supabase_functions)\.'
ORDER BY nspname, proname, argumentos;

COMMIT;
