/* ============================================================================
   FIX_ONLINE_STORE_CHECKOUT_STOCK_LOCK.sql
   Corrige bloqueo inválido sobre stock_balances en checkout online.
   stock_balances es vista materializada en este proyecto y no admite FOR UPDATE.
   ============================================================================ */

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

COMMENT ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Checkout manual online sin bloqueo FOR UPDATE sobre stock_balances; la validación final queda a cargo de sp_create_sale().';
