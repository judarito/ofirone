-- ============================================================================
-- Ofirone · Portabilidad PostgreSQL · Tarea 8
-- Archivo : 06_duplicate_business_keys.sql
-- Propósito: detectar posibles duplicados en claves de negocio: colisiones
--            exactas, diferencias de mayúsculas/espacios y claves que se
--            repiten entre tenants cuando deberían ser únicas.
--
-- Tipo            : SOLO LECTURA (transacción READ ONLY).
-- PostgreSQL mín. : 15 (usa query_to_xml + xmltable).
-- Idempotente     : sí; solo agrupa y cuenta, no fusiona ni borra.
-- Datos impresos  : `tenant_id`, la clave (parcialmente enmascarada cuando es
--                   email o documento) y el conteo. Se limita a 20 grupos por
--                   regla. No se imprimen nombres, direcciones ni teléfonos.
-- Límites         : 20 grupos por regla; tablas/columnas ausentes se omiten.
--
-- Uso sugerido:
--   psql -X -v ON_ERROR_STOP=1 -f tools/database/06_duplicate_business_keys.sql
--
-- ADVERTENCIA: la deduplicación es una operación de escritura y de negocio.
-- Exige confirmación explícita, respaldo, revisión caso a caso y una
-- transacción aparte. Este script nunca modifica datos.
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
-- Catálogo de reglas. Cada `sql` debe devolver exactamente las columnas
-- tenant_id (text), clave (text) y filas (bigint), y solo grupos duplicados.
-- `columnas` permite omitir la regla si el esquema no tiene esa columna.
-- ----------------------------------------------------------------------------
WITH claves (descripcion, tabla, columnas, sql) AS (
  VALUES
  (
    'users: email normalizado repetido dentro del tenant',
    'public.users',
    ARRAY['email', 'tenant_id'],
    $q$SELECT d.tenant_id::text AS tenant_id,
               left(d.k, 2) || '***' || right(d.k, 2) AS clave,
               d.filas
          FROM (
            SELECT tenant_id,
                   lower(btrim(email)) AS k,
                   count(*)::bigint AS filas
              FROM public.users
             WHERE email IS NOT NULL AND btrim(email) <> ''
             GROUP BY 1, 2
            HAVING count(*) > 1
          ) d
         ORDER BY d.filas DESC
         LIMIT 20$q$
  ),
  (
    'users: email normalizado presente en mas de un tenant (identidad global)',
    'public.users',
    ARRAY['email', 'tenant_id'],
    $q$SELECT '<global>' AS tenant_id,
               left(d.k, 2) || '***' || right(d.k, 2) AS clave,
               d.filas
          FROM (
            SELECT lower(btrim(email)) AS k,
                   count(DISTINCT tenant_id)::bigint AS filas
              FROM public.users
             WHERE email IS NOT NULL AND btrim(email) <> ''
             GROUP BY 1
            HAVING count(DISTINCT tenant_id) > 1
          ) d
         ORDER BY d.filas DESC
         LIMIT 20$q$
  ),
  (
    'product_variants: SKU normalizado repetido dentro del tenant',
    'public.product_variants',
    ARRAY['sku', 'tenant_id'],
    $q$SELECT tenant_id::text AS tenant_id,
               lower(btrim(sku)) AS clave,
               count(*)::bigint AS filas
          FROM public.product_variants
         WHERE sku IS NOT NULL AND btrim(sku) <> ''
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'products: nombre normalizado repetido dentro del tenant',
    'public.products',
    ARRAY['name', 'tenant_id'],
    $q$SELECT tenant_id::text AS tenant_id,
               lower(btrim(name)) AS clave,
               count(*)::bigint AS filas
          FROM public.products
         WHERE name IS NOT NULL AND btrim(name) <> ''
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'product_barcodes: codigo de barras repetido dentro del tenant',
    'public.product_barcodes',
    ARRAY['barcode', 'tenant_id'],
    $q$SELECT tenant_id::text AS tenant_id,
               lower(btrim(barcode)) AS clave,
               count(*)::bigint AS filas
          FROM public.product_barcodes
         WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'product_barcodes: codigo de barras presente en mas de un tenant',
    'public.product_barcodes',
    ARRAY['barcode', 'tenant_id'],
    $q$SELECT '<global>' AS tenant_id,
               lower(btrim(barcode)) AS clave,
               count(DISTINCT tenant_id)::bigint AS filas
          FROM public.product_barcodes
         WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
         GROUP BY 1, 2
        HAVING count(DISTINCT tenant_id) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'third_parties: documento normalizado repetido (revisar type y tenant nulo)',
    'public.third_parties',
    ARRAY['document_number', 'tenant_id'],
    $q$SELECT d.tenant_id::text AS tenant_id,
               left(d.k, 2) || '***' || right(d.k, 2) AS clave,
               d.filas
          FROM (
            SELECT COALESCE(tenant_id::text, '<sin-tenant>') AS tenant_id,
                   lower(btrim(document_number)) AS k,
                   count(*)::bigint AS filas
              FROM public.third_parties
             WHERE document_number IS NOT NULL AND btrim(document_number) <> ''
             GROUP BY 1, 2
            HAVING count(*) > 1
          ) d
         ORDER BY d.filas DESC
         LIMIT 20$q$
  ),
  (
    'taxes: codigo normalizado repetido dentro del tenant',
    'public.taxes',
    ARRAY['code', 'tenant_id'],
    $q$SELECT tenant_id::text AS tenant_id,
               lower(btrim(code)) AS clave,
               count(*)::bigint AS filas
          FROM public.taxes
         WHERE code IS NOT NULL AND btrim(code) <> ''
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'payment_methods: codigo normalizado repetido dentro del tenant',
    'public.payment_methods',
    ARRAY['code', 'tenant_id'],
    $q$SELECT tenant_id::text AS tenant_id,
               lower(btrim(code)) AS clave,
               count(*)::bigint AS filas
          FROM public.payment_methods
         WHERE code IS NOT NULL AND btrim(code) <> ''
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'sales: consecutivo repetido por tenant y sede',
    'public.sales',
    ARRAY['tenant_id', 'location_id', 'sale_number'],
    $q$SELECT tenant_id::text AS tenant_id,
               location_id::text || '|' || sale_number::text AS clave,
               count(*)::bigint AS filas
          FROM public.sales
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'inventory_batches: lote repetido por tenant, sede, variante y numero',
    'public.inventory_batches',
    ARRAY['tenant_id', 'location_id', 'variant_id', 'batch_number'],
    $q$SELECT tenant_id::text AS tenant_id,
               location_id::text || '|' || variant_id::text || '|' || batch_number AS clave,
               count(*)::bigint AS filas
          FROM public.inventory_batches
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'online_orders: numero de pedido repetido por tenant (sin UNIQUE en el esquema)',
    'public.online_orders',
    ARRAY['tenant_id', 'order_number'],
    $q$SELECT tenant_id::text AS tenant_id,
               order_number::text AS clave,
               count(*)::bigint AS filas
          FROM public.online_orders
         WHERE order_number IS NOT NULL
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  ),
  (
    'online_stores: slug repetido (UNIQUE global en el esquema)',
    'public.online_stores',
    ARRAY['slug'],
    $q$SELECT '<global>' AS tenant_id,
               lower(btrim(slug)) AS clave,
               count(*)::bigint AS filas
          FROM public.online_stores
         WHERE slug IS NOT NULL AND btrim(slug) <> ''
         GROUP BY 1, 2
        HAVING count(*) > 1
         ORDER BY 3 DESC
         LIMIT 20$q$
  )
),
existentes AS MATERIALIZED (
  SELECT c.*
  FROM claves c
  WHERE to_regclass(c.tabla) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(c.columnas) AS u(col)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = to_regclass(c.tabla)::oid
          AND a.attname = u.col
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
    )
)
SELECT e.descripcion,
       x.tenant_id,
       x.clave,
       x.filas
FROM existentes e
CROSS JOIN LATERAL query_to_xml(e.sql, false, true, '') AS q(doc)
CROSS JOIN LATERAL xmltable(
  '/row' PASSING q.doc
  COLUMNS tenant_id text   PATH 'tenant_id',
          clave     text   PATH 'clave',
          filas     bigint PATH 'filas'
) AS x
ORDER BY e.descripcion, x.filas DESC, x.tenant_id, x.clave;

-- ----------------------------------------------------------------------------
-- 2. Reglas omitidas porque falta la tabla o alguna columna
--    Sirve para distinguir "no hay duplicados" de "no se pudo comprobar".
-- ----------------------------------------------------------------------------
WITH claves (descripcion, tabla, columnas) AS (
  VALUES
  ('users: email', 'public.users', ARRAY['email', 'tenant_id']),
  ('users: email global', 'public.users', ARRAY['email', 'tenant_id']),
  ('product_variants: SKU', 'public.product_variants', ARRAY['sku', 'tenant_id']),
  ('products: nombre', 'public.products', ARRAY['name', 'tenant_id']),
  ('product_barcodes: barcode', 'public.product_barcodes', ARRAY['barcode', 'tenant_id']),
  ('product_barcodes: barcode global', 'public.product_barcodes', ARRAY['barcode', 'tenant_id']),
  ('third_parties: documento', 'public.third_parties', ARRAY['document_number', 'tenant_id']),
  ('taxes: codigo', 'public.taxes', ARRAY['code', 'tenant_id']),
  ('payment_methods: codigo', 'public.payment_methods', ARRAY['code', 'tenant_id']),
  ('sales: consecutivo', 'public.sales', ARRAY['tenant_id', 'location_id', 'sale_number']),
  ('inventory_batches: lote', 'public.inventory_batches', ARRAY['tenant_id', 'location_id', 'variant_id', 'batch_number']),
  ('online_orders: numero', 'public.online_orders', ARRAY['tenant_id', 'order_number']),
  ('online_stores: slug', 'public.online_stores', ARRAY['slug'])
)
SELECT c.descripcion,
       c.tabla,
       c.columnas,
       CASE
         WHEN to_regclass(c.tabla) IS NULL THEN 'tabla ausente'
         ELSE 'columna ausente: ' || (
           SELECT string_agg(u.col, ', ')
           FROM unnest(c.columnas) AS u(col)
           WHERE NOT EXISTS (
             SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = to_regclass(c.tabla)::oid
               AND a.attname = u.col
               AND a.attnum > 0
               AND NOT a.attisdropped
           )
         )
       END                                            AS motivo_omision
FROM claves c
WHERE to_regclass(c.tabla) IS NULL
   OR EXISTS (
     SELECT 1 FROM unnest(c.columnas) AS u(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = to_regclass(c.tabla)::oid
         AND a.attname = u.col
         AND a.attnum > 0
         AND NOT a.attisdropped
     )
   )
ORDER BY c.descripcion;

COMMIT;
