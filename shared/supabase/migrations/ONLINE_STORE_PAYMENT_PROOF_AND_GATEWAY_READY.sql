/* ============================================================================
   ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql
   Adjunta comprobantes manuales y deja listo el camino para pasarela.
   ============================================================================ */

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
      AND policyname = 'storefront_anon_can_upload_payment_proofs'
  ) THEN
    CREATE POLICY storefront_anon_can_upload_payment_proofs
    ON storage.objects
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
      bucket_id = 'storefront'
      AND (storage.foldername(name))[1] = 'public-proofs'
    );
  END IF;
END $$;

ALTER TABLE online_stores
  ADD COLUMN IF NOT EXISTS allow_manual_payment BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_gateway_payment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gateway_status TEXT NOT NULL DEFAULT 'COMING_SOON';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'online_stores_gateway_status_chk'
  ) THEN
    ALTER TABLE online_stores
      ADD CONSTRAINT online_stores_gateway_status_chk
      CHECK (gateway_status IN ('DISABLED', 'COMING_SOON', 'ENABLED'));
  END IF;
END $$;

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
    'location_name', l.name,
    'allow_manual_payment', s.allow_manual_payment,
    'allow_gateway_payment', s.allow_gateway_payment,
    'gateway_status', s.gateway_status
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

CREATE OR REPLACE FUNCTION fn_create_online_manual_order(
  p_slug TEXT,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_customer_note TEXT,
  p_payment_reference TEXT,
  p_landing_return_url TEXT,
  p_lines JSONB,
  p_payment_mode TEXT DEFAULT 'MANUAL',
  p_payment_proof_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store RECORD;
  v_order_id UUID;
  v_order_number BIGINT;
  v_line JSONB;
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
  v_payment_reference_resolved TEXT;
  v_payment_mode TEXT := UPPER(COALESCE(NULLIF(trim(p_payment_mode), ''), 'MANUAL'));
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
    s.allow_manual_payment,
    s.allow_gateway_payment,
    s.gateway_status,
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

  IF v_payment_mode = 'GATEWAY' THEN
    RAISE EXCEPTION 'La pasarela de pago todavía no está disponible en esta tienda.';
  END IF;

  IF v_payment_mode <> 'MANUAL' THEN
    RAISE EXCEPTION 'Método de pago no soportado para esta tienda.';
  END IF;

  IF NOT COALESCE(v_store.allow_manual_payment, TRUE) THEN
    RAISE EXCEPTION 'Esta tienda no tiene habilitado el pago manual.';
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
    store_snapshot,
    subtotal,
    discount_total,
    tax_total,
    total
  )
  VALUES (
    v_store.tenant_id,
    v_store.store_id,
    'PENDING',
    v_payment_mode,
    'PENDING',
    NULLIF(trim(coalesce(p_customer_name, '')), ''),
    NULLIF(trim(coalesce(p_customer_email, '')), ''),
    NULLIF(trim(coalesce(p_customer_phone, '')), ''),
    NULLIF(trim(coalesce(p_customer_note, '')), ''),
    NULLIF(trim(coalesce(p_payment_reference, '')), ''),
    COALESCE(NULLIF(trim(coalesce(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
    jsonb_build_object(
      'mode', v_payment_mode,
      'requested_reference', NULLIF(trim(coalesce(p_payment_reference, '')), ''),
      'payment_proof_url', NULLIF(trim(coalesce(p_payment_proof_url, '')), ''),
      'awaiting_confirmation', TRUE
    ),
    jsonb_build_object(
      'brand_name', v_store.brand_name,
      'slug', fn_online_store_slugify(p_slug)
    ),
    0,
    0,
    0,
    0
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
      v_variant,
      NULLIF(v_sku, ''),
      COALESCE(v_product_name, 'Producto'),
      NULLIF(v_variant_name, ''),
      v_qty,
      ROUND(COALESCE(v_unit_price, 0), 2),
      v_tax_rate,
      v_tax_amount,
      v_line_total
    );

    INSERT INTO online_order_reservations(
      tenant_id,
      online_order_id,
      store_id,
      location_id,
      variant_id,
      reserved_qty,
      status
    )
    VALUES (
      v_store.tenant_id,
      v_order_id,
      v_store.store_id,
      v_store.location_id,
      v_variant,
      v_qty,
      'ACTIVE'
    );
  END LOOP;

  v_total_rounded := fn_apply_rounding(v_store.tenant_id, v_total);
  v_payment_reference_resolved := COALESCE(
    NULLIF(trim(coalesce(p_payment_reference, '')), ''),
    'ONLINE-' || v_order_number::TEXT
  );

  UPDATE online_orders
  SET
    payment_reference = v_payment_reference_resolved,
    subtotal = ROUND(v_subtotal, 2),
    discount_total = ROUND(v_discount_total, 2),
    tax_total = ROUND(v_tax_total, 2),
    total = ROUND(v_total_rounded, 2),
    payment_payload = coalesce(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'generated_reference', v_payment_reference_resolved,
      'stock_reserved', TRUE,
      'payment_proof_url', NULLIF(trim(coalesce(p_payment_proof_url, '')), '')
    )
  WHERE online_order_id = v_order_id;

  RETURN jsonb_build_object(
    'online_order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'PENDING',
    'payment_status', 'PENDING',
    'sale_id', NULL,
    'payment_mode', v_payment_mode,
    'total', ROUND(v_total_rounded, 2),
    'payment_reference', v_payment_reference_resolved,
    'payment_proof_url', NULLIF(trim(coalesce(p_payment_proof_url, '')), ''),
    'landing_return_url', COALESCE(NULLIF(trim(coalesce(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
    'message', 'Tu pedido quedó pendiente de confirmación. Reservamos el stock mientras validamos el pago manual.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;
