/* ============================================================================
   ADD_ONLINE_STORE_MVP.sql
   MVP de tienda online por tenant

   Alcance:
   - Una tienda online por tenant
   - Catálogo publicable por variante
   - Stock online limitado por sede y regla de exposición
   - Branding básico (logo, header, colores)
   - Checkout manual listo para futura pasarela
   - Conversión de compra online a venta real vía sp_create_sale()
   ============================================================================ */

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage bucket público para branding de tienda
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    PERFORM storage.create_bucket('storefront', TRUE);
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
    WHEN undefined_function THEN
      RAISE NOTICE 'storage.create_bucket no disponible; crea el bucket storefront desde la consola de Supabase.';
    WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo crear storefront con storage.create_bucket: %', SQLERRM;
  END;
END $$;

INSERT INTO storage.buckets (id, name, public)
SELECT 'storefront', 'storefront', TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM storage.buckets
  WHERE id = 'storefront'
);

UPDATE storage.buckets
SET public = TRUE
WHERE id = 'storefront';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'storefront_auth_can_upload'
  ) THEN
    CREATE POLICY storefront_auth_can_upload
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'storefront'
      AND (storage.foldername(name))[1] = (
        SELECT u.tenant_id::text
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'storefront_auth_can_update'
  ) THEN
    CREATE POLICY storefront_auth_can_update
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'storefront'
      AND (storage.foldername(name))[1] = (
        SELECT u.tenant_id::text
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
    WITH CHECK (
      bucket_id = 'storefront'
      AND (storage.foldername(name))[1] = (
        SELECT u.tenant_id::text
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'storefront_auth_can_delete'
  ) THEN
    CREATE POLICY storefront_auth_can_delete
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'storefront'
      AND (storage.foldername(name))[1] = (
        SELECT u.tenant_id::text
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_online_store_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_online_store_slugify(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_value TEXT;
BEGIN
  v_value := lower(trim(coalesce(p_value, '')));
  v_value := translate(v_value, 'áéíóúäëïöüñ', 'aeiouaeioun');
  v_value := regexp_replace(v_value, '[^a-z0-9]+', '-', 'g');
  v_value := regexp_replace(v_value, '(^-+|-+$)', '', 'g');
  RETURN NULLIF(v_value, '');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tablas core
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS online_stores (
  store_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  location_id UUID NULL REFERENCES locations(location_id) ON DELETE SET NULL,
  sold_by_user_id UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
  manual_payment_method_id UUID NULL REFERENCES payment_methods(payment_method_id) ON DELETE SET NULL,
  stock_buffer_units NUMERIC(14,3) NOT NULL DEFAULT 0,
  landing_return_url TEXT NULL,
  brand_name TEXT NULL,
  brand_logo_url TEXT NULL,
  header_image_url TEXT NULL,
  primary_color TEXT NOT NULL DEFAULT '#1e63b7',
  secondary_color TEXT NOT NULL DEFAULT '#4ca53c',
  accent_color TEXT NOT NULL DEFAULT '#f59e0b',
  background_color TEXT NOT NULL DEFAULT '#f8fafc',
  surface_color TEXT NOT NULL DEFAULT '#ffffff',
  text_color TEXT NOT NULL DEFAULT '#0f172a',
  button_text TEXT NOT NULL DEFAULT 'Comprar ahora',
  checkout_message TEXT NULL,
  support_whatsapp TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT online_stores_slug_format_chk CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT online_stores_stock_buffer_chk CHECK (stock_buffer_units >= 0)
);

CREATE TABLE IF NOT EXISTS online_store_catalog (
  store_catalog_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES online_stores(store_id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE CASCADE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  stock_mode TEXT NOT NULL DEFAULT 'ALL',
  stock_value NUMERIC(14,3) NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  custom_title TEXT NULL,
  custom_description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT online_store_catalog_unique_variant UNIQUE (store_id, variant_id),
  CONSTRAINT online_store_catalog_mode_chk CHECK (stock_mode IN ('ALL', 'FIXED', 'PERCENT')),
  CONSTRAINT online_store_catalog_value_chk CHECK (
    stock_value IS NULL OR stock_value >= 0
  )
);

CREATE TABLE IF NOT EXISTS online_orders (
  online_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES online_stores(store_id) ON DELETE RESTRICT,
  sale_id UUID NULL UNIQUE REFERENCES sales(sale_id) ON DELETE SET NULL,
  order_number BIGINT GENERATED BY DEFAULT AS IDENTITY,
  status TEXT NOT NULL DEFAULT 'PENDING',
  payment_mode TEXT NOT NULL DEFAULT 'MANUAL',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  customer_name TEXT NULL,
  customer_email TEXT NULL,
  customer_phone TEXT NULL,
  customer_note TEXT NULL,
  payment_reference TEXT NULL,
  landing_return_url TEXT NULL,
  payment_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  store_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT online_orders_status_chk CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT online_orders_payment_mode_chk CHECK (payment_mode IN ('MANUAL', 'GATEWAY')),
  CONSTRAINT online_orders_payment_status_chk CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED'))
);

CREATE TABLE IF NOT EXISTS online_order_lines (
  online_order_line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  online_order_id UUID NOT NULL REFERENCES online_orders(online_order_id) ON DELETE CASCADE,
  variant_id UUID NULL REFERENCES product_variants(variant_id) ON DELETE SET NULL,
  sku TEXT NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  tax_rate NUMERIC(8,5) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT online_order_lines_qty_chk CHECK (quantity > 0),
  CONSTRAINT online_order_lines_price_chk CHECK (unit_price >= 0),
  CONSTRAINT online_order_lines_total_chk CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS online_order_reservations (
  reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  online_order_id UUID NOT NULL REFERENCES online_orders(online_order_id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES online_stores(store_id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE CASCADE,
  reserved_qty NUMERIC(14,3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ NULL,
  released_at TIMESTAMPTZ NULL,
  release_reason TEXT NULL,
  CONSTRAINT online_order_reservations_qty_chk CHECK (reserved_qty > 0),
  CONSTRAINT online_order_reservations_status_chk CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED'))
);

CREATE INDEX IF NOT EXISTS idx_online_store_catalog_store ON online_store_catalog(store_id, sort_order, is_published);
CREATE INDEX IF NOT EXISTS idx_online_store_catalog_variant ON online_store_catalog(tenant_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_store_created ON online_orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_orders_sale ON online_orders(sale_id);
CREATE INDEX IF NOT EXISTS idx_online_order_lines_order ON online_order_lines(online_order_id);
CREATE INDEX IF NOT EXISTS idx_online_order_reservations_order ON online_order_reservations(online_order_id, status);
CREATE INDEX IF NOT EXISTS idx_online_order_reservations_store_variant ON online_order_reservations(store_id, variant_id, status);

DROP TRIGGER IF EXISTS trg_online_stores_updated_at ON online_stores;
CREATE TRIGGER trg_online_stores_updated_at
BEFORE UPDATE ON online_stores
FOR EACH ROW
EXECUTE FUNCTION fn_online_store_touch_updated_at();

DROP TRIGGER IF EXISTS trg_online_store_catalog_updated_at ON online_store_catalog;
CREATE TRIGGER trg_online_store_catalog_updated_at
BEFORE UPDATE ON online_store_catalog
FOR EACH ROW
EXECUTE FUNCTION fn_online_store_touch_updated_at();

DROP TRIGGER IF EXISTS trg_online_orders_updated_at ON online_orders;
CREATE TRIGGER trg_online_orders_updated_at
BEFORE UPDATE ON online_orders
FOR EACH ROW
EXECUTE FUNCTION fn_online_store_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos base para PostgREST
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON online_stores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON online_store_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON online_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON online_order_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON online_order_reservations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE online_orders_order_number_seq TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE online_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_store_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'online_stores' AND policyname = 'online_stores_tenant_isolation'
  ) THEN
    CREATE POLICY online_stores_tenant_isolation
    ON online_stores
    FOR ALL
    TO authenticated
    USING (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
    WITH CHECK (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'online_store_catalog' AND policyname = 'online_store_catalog_tenant_isolation'
  ) THEN
    CREATE POLICY online_store_catalog_tenant_isolation
    ON online_store_catalog
    FOR ALL
    TO authenticated
    USING (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
    WITH CHECK (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'online_orders' AND policyname = 'online_orders_tenant_isolation'
  ) THEN
    CREATE POLICY online_orders_tenant_isolation
    ON online_orders
    FOR ALL
    TO authenticated
    USING (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
    WITH CHECK (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'online_order_lines' AND policyname = 'online_order_lines_tenant_isolation'
  ) THEN
    CREATE POLICY online_order_lines_tenant_isolation
    ON online_order_lines
    FOR ALL
    TO authenticated
    USING (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
    WITH CHECK (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'online_order_reservations' AND policyname = 'online_order_reservations_tenant_isolation'
  ) THEN
    CREATE POLICY online_order_reservations_tenant_isolation
    ON online_order_reservations
    FOR ALL
    TO authenticated
    USING (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
    WITH CHECK (
      tenant_id = (
        SELECT u.tenant_id
        FROM users u
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper de stock online disponible
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_online_store_reserved_qty(
  p_store_id UUID,
  p_variant_id UUID
) RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(r.reserved_qty), 0)
  FROM online_order_reservations r
  JOIN online_orders o
    ON o.online_order_id = r.online_order_id
  WHERE r.store_id = p_store_id
    AND r.variant_id = p_variant_id
    AND r.status = 'ACTIVE'
    AND o.status IN ('PENDING', 'PROCESSING')
    AND o.payment_status = 'PENDING';
$$;

CREATE OR REPLACE FUNCTION fn_online_store_available_qty(
  p_store_id UUID,
  p_variant_id UUID
) RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT
      s.tenant_id,
      s.location_id,
      COALESCE(s.stock_buffer_units, 0) AS stock_buffer_units,
      c.stock_mode,
      c.stock_value
    FROM online_stores s
    JOIN online_store_catalog c
      ON c.store_id = s.store_id
    WHERE s.store_id = p_store_id
      AND c.variant_id = p_variant_id
      AND c.is_published = TRUE
  ),
  stock AS (
    SELECT
      sc.*,
      GREATEST(
        0,
        COALESCE(sb.on_hand, 0) - COALESCE(sb.reserved, 0) - COALESCE(sc.stock_buffer_units, 0)
      ) AS operational_available
    FROM scoped sc
    LEFT JOIN stock_balances sb
      ON sb.tenant_id = sc.tenant_id
     AND sb.location_id = sc.location_id
     AND sb.variant_id = p_variant_id
  ),
  limited AS (
    SELECT COALESCE(
      GREATEST(
        0,
        LEAST(
          operational_available,
          CASE stock_mode
            WHEN 'FIXED' THEN COALESCE(stock_value, 0)
            WHEN 'PERCENT' THEN ROUND(
              operational_available * LEAST(GREATEST(COALESCE(stock_value, 0), 0), 100) / 100.0,
              3
            )
            ELSE operational_available
          END
        )
      ),
      0
    ) AS max_online_available
    FROM stock
    LIMIT 1
  )
  SELECT GREATEST(
    0,
    COALESCE((SELECT max_online_available FROM limited), 0)
    - COALESCE(fn_online_store_reserved_qty(p_store_id, p_variant_id), 0)
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC pública: datos de la tienda
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_get_public_online_store(
  p_slug TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store JSONB;
BEGIN
  SELECT jsonb_build_object(
    'store_id', s.store_id,
    'tenant_id', s.tenant_id,
    'slug', s.slug,
    'brand_name', COALESCE(NULLIF(s.brand_name, ''), NULLIF(ts.business_name, ''), t.name),
    'brand_logo_url', COALESCE(NULLIF(s.brand_logo_url, ''), NULLIF(ts.logo_url, '')),
    'header_image_url', NULLIF(s.header_image_url, ''),
    'landing_return_url', NULLIF(s.landing_return_url, ''),
    'primary_color', s.primary_color,
    'secondary_color', s.secondary_color,
    'accent_color', s.accent_color,
    'background_color', s.background_color,
    'surface_color', s.surface_color,
    'text_color', s.text_color,
    'button_text', s.button_text,
    'checkout_message', NULLIF(s.checkout_message, ''),
    'support_whatsapp', NULLIF(s.support_whatsapp, ''),
    'location_name', l.name
  )
  INTO v_store
  FROM online_stores s
  JOIN tenants t ON t.tenant_id = s.tenant_id
  LEFT JOIN tenant_settings ts ON ts.tenant_id = s.tenant_id
  LEFT JOIN locations l ON l.location_id = s.location_id
  WHERE s.slug = fn_online_store_slugify(p_slug)
    AND s.is_enabled = TRUE
    AND s.is_published = TRUE
  LIMIT 1;

  RETURN v_store;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_public_online_store(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC pública: catálogo
-- NOTA: hacer DROP primero porque la firma puede evolucionar y PostgreSQL
-- no permite cambiar RETURNS TABLE con CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC pública: checkout manual -> venta POS real
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_create_online_manual_order(
  p_slug TEXT,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_customer_note TEXT,
  p_payment_reference TEXT,
  p_landing_return_url TEXT,
  p_lines JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store RECORD;
  v_order_id UUID;
  v_order_number BIGINT;
  v_sale_id UUID;
  v_line JSONB;
  v_order_line JSONB;
  v_variant UUID;
  v_qty NUMERIC;
  v_available NUMERIC;
  v_unit_price NUMERIC;
  v_tax_rate NUMERIC;
  v_line_base NUMERIC;
  v_tax_amount NUMERIC;
  v_line_total NUMERIC;
  v_sku TEXT;
  v_product_name TEXT;
  v_variant_name TEXT;
  v_subtotal NUMERIC := 0;
  v_discount_total NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_total_rounded NUMERIC := 0;
  v_sale_lines JSONB := '[]'::JSONB;
  v_order_lines JSONB := '[]'::JSONB;
  v_payment_reference_resolved TEXT;
  v_sale_note TEXT;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'La compra online debe tener al menos un producto.';
  END IF;

  SELECT
    s.store_id,
    s.tenant_id,
    s.location_id,
    s.sold_by_user_id,
    s.landing_return_url,
    COALESCE(NULLIF(s.brand_name, ''), NULLIF(ts.business_name, ''), t.name) AS brand_name,
    pm.code AS payment_method_code
  INTO v_store
  FROM online_stores s
  JOIN tenants t ON t.tenant_id = s.tenant_id
  LEFT JOIN tenant_settings ts ON ts.tenant_id = s.tenant_id
  LEFT JOIN payment_methods pm
    ON pm.payment_method_id = s.manual_payment_method_id
   AND pm.tenant_id = s.tenant_id
   AND pm.is_active = TRUE
  LEFT JOIN users u
    ON u.user_id = s.sold_by_user_id
   AND u.tenant_id = s.tenant_id
   AND u.is_active = TRUE
  WHERE s.slug = fn_online_store_slugify(p_slug)
    AND s.is_enabled = TRUE
    AND s.is_published = TRUE
    AND s.location_id IS NOT NULL
    AND s.sold_by_user_id IS NOT NULL
    AND s.manual_payment_method_id IS NOT NULL
    AND u.user_id IS NOT NULL
    AND pm.payment_method_id IS NOT NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La tienda online no está lista para vender. Revisa sede, vendedor responsable y método de pago.';
  END IF;

  INSERT INTO online_orders(
    tenant_id,
    store_id,
    status,
    payment_mode,
    payment_status,
    customer_name,
    customer_email,
    customer_phone,
    customer_note,
    payment_reference,
    landing_return_url,
    payment_payload,
    store_snapshot
  )
  VALUES (
    v_store.tenant_id,
    v_store.store_id,
    'PROCESSING',
    'MANUAL',
    'PENDING',
    NULLIF(trim(coalesce(p_customer_name, '')), ''),
    NULLIF(trim(coalesce(p_customer_email, '')), ''),
    NULLIF(trim(coalesce(p_customer_phone, '')), ''),
    NULLIF(trim(coalesce(p_customer_note, '')), ''),
    NULLIF(trim(coalesce(p_payment_reference, '')), ''),
    COALESCE(NULLIF(trim(coalesce(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
    jsonb_build_object(
      'mode', 'MANUAL',
      'requested_reference', NULLIF(trim(coalesce(p_payment_reference, '')), '')
    ),
    jsonb_build_object(
      'brand_name', v_store.brand_name,
      'slug', fn_online_store_slugify(p_slug)
    )
  )
  RETURNING online_order_id, order_number
  INTO v_order_id, v_order_number;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant := (v_line->>'variant_id')::UUID;
    v_qty := COALESCE((v_line->>'qty')::NUMERIC, 0);

    IF v_variant IS NULL THEN
      RAISE EXCEPTION 'Cada línea online debe incluir variant_id.';
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para la variante %.', v_variant;
    END IF;

    PERFORM 1
    FROM online_store_catalog osc
    WHERE osc.store_id = v_store.store_id
      AND osc.variant_id = v_variant
      AND osc.is_published = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La variante % no está publicada en la tienda.', v_variant;
    END IF;

    SELECT
      pv.price,
      COALESCE(fn_get_tax_rate_for_variant(v_store.tenant_id, pv.variant_id), 0),
      pv.sku,
      p.name,
      pv.variant_name
    INTO
      v_unit_price,
      v_tax_rate,
      v_sku,
      v_product_name,
      v_variant_name
    FROM product_variants pv
    JOIN products p
      ON p.product_id = pv.product_id
     AND p.tenant_id = pv.tenant_id
    WHERE pv.tenant_id = v_store.tenant_id
      AND pv.variant_id = v_variant
      AND pv.is_active = TRUE
      AND p.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La variante % ya no está disponible para venta.', v_variant;
    END IF;

    v_available := fn_online_store_available_qty(v_store.store_id, v_variant);
    IF v_qty > v_available THEN
      RAISE EXCEPTION 'Stock online insuficiente para % (disponible=%, requerido=%).', v_variant, v_available, v_qty;
    END IF;

    v_line_base := ROUND(v_qty * COALESCE(v_unit_price, 0), 2);
    v_tax_amount := ROUND(v_line_base * v_tax_rate, 2);
    v_line_total := ROUND(v_line_base + v_tax_amount, 2);

    v_subtotal := v_subtotal + v_line_base;
    v_tax_total := v_tax_total + v_tax_amount;
    v_total := v_total + v_line_total;

    v_sale_lines := v_sale_lines || jsonb_build_array(
      jsonb_build_object(
        'variant_id', v_variant,
        'qty', v_qty,
        'unit_price', ROUND(COALESCE(v_unit_price, 0), 2),
        'discount', 0
      )
    );

    v_order_lines := v_order_lines || jsonb_build_array(
      jsonb_build_object(
        'variant_id', v_variant,
        'sku', COALESCE(v_sku, ''),
        'product_name', COALESCE(v_product_name, 'Producto'),
        'variant_name', COALESCE(v_variant_name, ''),
        'quantity', v_qty,
        'unit_price', ROUND(COALESCE(v_unit_price, 0), 2),
        'tax_rate', v_tax_rate,
        'tax_amount', v_tax_amount,
        'line_total', v_line_total
      )
    );
  END LOOP;

  v_total_rounded := fn_apply_rounding(v_store.tenant_id, v_total);
  v_payment_reference_resolved := COALESCE(
    NULLIF(trim(coalesce(p_payment_reference, '')), ''),
    'ONLINE-' || v_order_number::TEXT
  );

  v_sale_note := concat_ws(
    ' | ',
    'Venta online #' || v_order_number::TEXT,
    CASE WHEN NULLIF(trim(coalesce(p_customer_name, '')), '') IS NOT NULL THEN 'Cliente: ' || trim(p_customer_name) ELSE NULL END,
    CASE WHEN NULLIF(trim(coalesce(p_customer_phone, '')), '') IS NOT NULL THEN 'Tel: ' || trim(p_customer_phone) ELSE NULL END,
    CASE WHEN NULLIF(trim(coalesce(p_payment_reference, '')), '') IS NOT NULL THEN 'Ref pago: ' || trim(p_payment_reference) ELSE NULL END,
    CASE WHEN NULLIF(trim(coalesce(p_customer_note, '')), '') IS NOT NULL THEN 'Nota: ' || trim(p_customer_note) ELSE NULL END
  );

  v_sale_id := sp_create_sale(
    v_store.tenant_id,
    v_store.location_id,
    NULL::UUID,
    NULL::UUID,
    v_store.sold_by_user_id,
    v_sale_lines,
    jsonb_build_array(
      jsonb_build_object(
        'payment_method_code', v_store.payment_method_code,
        'amount', ROUND(v_total_rounded, 2),
        'reference', v_payment_reference_resolved
      )
    ),
    v_sale_note
  );

  UPDATE online_orders
  SET
    sale_id = v_sale_id,
    status = 'COMPLETED',
    payment_status = 'PAID',
    payment_reference = v_payment_reference_resolved,
    subtotal = ROUND(v_subtotal, 2),
    discount_total = ROUND(v_discount_total, 2),
    tax_total = ROUND(v_tax_total, 2),
    total = ROUND(v_total_rounded, 2),
    payment_payload = jsonb_build_object(
      'mode', 'MANUAL',
      'confirmed_reference', v_payment_reference_resolved
    )
  WHERE online_order_id = v_order_id;

  FOR v_order_line IN SELECT * FROM jsonb_array_elements(v_order_lines)
  LOOP
    INSERT INTO online_order_lines(
      tenant_id,
      online_order_id,
      variant_id,
      sku,
      product_name,
      variant_name,
      quantity,
      unit_price,
      tax_rate,
      tax_amount,
      line_total
    )
    VALUES (
      v_store.tenant_id,
      v_order_id,
      (v_order_line->>'variant_id')::UUID,
      NULLIF(v_order_line->>'sku', ''),
      COALESCE(v_order_line->>'product_name', 'Producto'),
      NULLIF(v_order_line->>'variant_name', ''),
      COALESCE((v_order_line->>'quantity')::NUMERIC, 0),
      COALESCE((v_order_line->>'unit_price')::NUMERIC, 0),
      COALESCE((v_order_line->>'tax_rate')::NUMERIC, 0),
      COALESCE((v_order_line->>'tax_amount')::NUMERIC, 0),
      COALESCE((v_order_line->>'line_total')::NUMERIC, 0)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'online_order_id', v_order_id,
    'order_number', v_order_number,
    'sale_id', v_sale_id,
    'total', ROUND(v_total_rounded, 2),
    'payment_reference', v_payment_reference_resolved,
    'landing_return_url', COALESCE(NULLIF(trim(coalesce(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, ''))
  );
EXCEPTION WHEN OTHERS THEN
  IF v_order_id IS NOT NULL THEN
    UPDATE online_orders
    SET
      status = 'FAILED',
      payment_status = 'FAILED',
      payment_payload = jsonb_build_object(
        'mode', 'MANUAL',
        'error', SQLERRM
      )
    WHERE online_order_id = v_order_id;
  END IF;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed opcional: crear tienda vacía por tenant al configurar después
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE online_stores IS 'Configuración única de tienda online por tenant.';
COMMENT ON TABLE online_store_catalog IS 'Catálogo publicable por variante para la tienda online.';
COMMENT ON TABLE online_orders IS 'Pedidos online del storefront. En MVP se convierten en ventas reales al confirmar checkout manual.';
COMMENT ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Crea un pedido online manual y lo convierte a venta real usando sp_create_sale() sin requerir caja abierta.';
