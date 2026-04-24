/* ============================================================================
   ADD_ONLINE_STORE_PUBLIC_IMAGES.sql
   Expone portada pública de producto para la tienda online.
   Requiere bucket productmedia público o accesible por URL pública.
   ============================================================================ */

UPDATE storage.buckets
SET public = TRUE
WHERE id = 'productmedia';

DROP FUNCTION IF EXISTS fn_list_public_online_store_products(TEXT);

CREATE FUNCTION fn_list_public_online_store_products(
  p_slug TEXT
) RETURNS TABLE (
  variant_id UUID,
  sku TEXT,
  product_name TEXT,
  variant_name TEXT,
  category_name TEXT,
  image_path TEXT,
  display_name TEXT,
  display_description TEXT,
  price NUMERIC,
  tax_rate NUMERIC,
  final_price NUMERIC,
  available NUMERIC,
  sort_order INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cover_media AS (
    SELECT DISTINCT ON (pm.product_id)
      pm.product_id,
      pm.storage_path
    FROM product_media pm
    ORDER BY pm.product_id, pm.is_cover DESC, pm.sort_order ASC, pm.created_at ASC
  )
  SELECT
    pv.variant_id,
    pv.sku,
    p.name AS product_name,
    pv.variant_name,
    cat.name AS category_name,
    cm.storage_path AS image_path,
    COALESCE(NULLIF(osc.custom_title, ''), p.name) AS display_name,
    COALESCE(NULLIF(osc.custom_description, ''), p.description) AS display_description,
    ROUND(COALESCE(pv.price, 0), 2) AS price,
    COALESCE(fn_get_tax_rate_for_variant(s.tenant_id, pv.variant_id), 0) AS tax_rate,
    ROUND(
      COALESCE(pv.price, 0) * (1 + COALESCE(fn_get_tax_rate_for_variant(s.tenant_id, pv.variant_id), 0)),
      2
    ) AS final_price,
    fn_online_store_available_qty(s.store_id, pv.variant_id) AS available,
    osc.sort_order
  FROM online_stores s
  JOIN online_store_catalog osc
    ON osc.store_id = s.store_id
   AND osc.is_published = TRUE
  JOIN product_variants pv
    ON pv.variant_id = osc.variant_id
   AND pv.tenant_id = s.tenant_id
   AND pv.is_active = TRUE
  JOIN products p
    ON p.product_id = pv.product_id
   AND p.tenant_id = s.tenant_id
   AND p.is_active = TRUE
  LEFT JOIN categories cat
    ON cat.category_id = p.category_id
   AND cat.tenant_id = p.tenant_id
  LEFT JOIN cover_media cm
    ON cm.product_id = p.product_id
  WHERE s.slug = fn_online_store_slugify(p_slug)
    AND s.is_enabled = TRUE
    AND s.is_published = TRUE
  ORDER BY osc.sort_order ASC, cat.name ASC NULLS LAST, p.name ASC, pv.variant_name ASC;
$$;

GRANT EXECUTE ON FUNCTION fn_list_public_online_store_products(TEXT) TO anon, authenticated;

