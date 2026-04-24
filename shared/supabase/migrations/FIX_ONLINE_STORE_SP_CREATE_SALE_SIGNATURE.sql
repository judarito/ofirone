/* ============================================================================
   FIX_ONLINE_STORE_SP_CREATE_SALE_SIGNATURE.sql
   Corrige llamada ambigua a sp_create_sale() desde checkout online manual.
   ============================================================================ */

CREATE OR REPLACE FUNCTION fn_create_online_manual_order(
  p_slug TEXT,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_customer_note TEXT,
  p_payment_reference TEXT,
  p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store RECORD;
  v_item JSONB;
  v_variant RECORD;
  v_order_lines JSONB := '[]'::JSONB;
  v_sale_lines JSONB := '[]'::JSONB;
  v_order_line JSONB;
  v_requested_qty NUMERIC;
  v_available_qty NUMERIC;
  v_tax_rate NUMERIC;
  v_price NUMERIC;
  v_base NUMERIC;
  v_tax NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_discount_total NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_total_rounded NUMERIC := 0;
  v_order_id UUID;
  v_order_number BIGINT;
  v_sale_id UUID;
  v_sale_note TEXT;
  v_payment_reference_resolved TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El carrito está vacío.';
  END IF;

  SELECT
    s.store_id,
    s.tenant_id,
    s.slug,
    s.location_id,
    s.sold_by_user_id,
    s.manual_payment_method_id,
    pm.code AS payment_method_code,
    s.is_enabled,
    s.is_published
  INTO v_store
  FROM online_stores s
  LEFT JOIN payment_methods pm
    ON pm.payment_method_id = s.manual_payment_method_id
  WHERE s.slug = fn_online_store_slugify(p_slug);

  IF NOT FOUND OR NOT v_store.is_enabled OR NOT v_store.is_published THEN
    RAISE EXCEPTION 'La tienda no está disponible.';
  END IF;

  IF v_store.location_id IS NULL THEN
    RAISE EXCEPTION 'La tienda no tiene una sede configurada.';
  END IF;

  IF v_store.sold_by_user_id IS NULL THEN
    RAISE EXCEPTION 'La tienda no tiene un vendedor responsable configurado.';
  END IF;

  IF v_store.manual_payment_method_id IS NULL OR NULLIF(trim(coalesce(v_store.payment_method_code, '')), '') IS NULL THEN
    RAISE EXCEPTION 'La tienda no tiene un método de pago manual configurado.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF NULLIF(v_item->>'variant_id', '') IS NULL THEN
      RAISE EXCEPTION 'Hay un producto inválido en el carrito.';
    END IF;

    v_requested_qty := COALESCE((v_item->>'qty')::NUMERIC, 0);
    IF v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'La cantidad solicitada no es válida.';
    END IF;

    SELECT
      pv.variant_id,
      pv.sku,
      pv.variant_name,
      p.name AS product_name,
      COALESCE(pv.price, 0) AS price
    INTO v_variant
    FROM online_store_catalog osc
    JOIN product_variants pv
      ON pv.variant_id = osc.variant_id
     AND pv.tenant_id = osc.tenant_id
     AND pv.is_active = TRUE
    JOIN products p
      ON p.product_id = pv.product_id
     AND p.tenant_id = osc.tenant_id
     AND p.is_active = TRUE
    WHERE osc.store_id = v_store.store_id
      AND osc.variant_id = (v_item->>'variant_id')::UUID
      AND osc.is_published = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos ya no está disponible en la tienda.';
    END IF;

    v_available_qty := fn_online_store_available_qty(v_store.store_id, v_variant.variant_id);
    IF v_available_qty < v_requested_qty THEN
      RAISE EXCEPTION 'Stock online insuficiente para %. Disponible: %, solicitado: %',
        COALESCE(v_variant.product_name, v_variant.sku, 'producto'),
        v_available_qty,
        v_requested_qty;
    END IF;

    v_tax_rate := COALESCE(fn_get_tax_rate_for_variant(v_store.tenant_id, v_variant.variant_id), 0);
    v_price := ROUND(COALESCE(v_variant.price, 0), 2);
    v_base := ROUND(v_requested_qty * v_price, 2);
    v_tax := ROUND(v_base * v_tax_rate, 2);
    v_line_total := ROUND(v_base + v_tax, 2);

    v_subtotal := v_subtotal + v_base;
    v_tax_total := v_tax_total + v_tax;
    v_total := v_total + v_line_total;

    v_order_lines := v_order_lines || jsonb_build_object(
      'variant_id', v_variant.variant_id,
      'sku', v_variant.sku,
      'product_name', v_variant.product_name,
      'variant_name', v_variant.variant_name,
      'qty', v_requested_qty,
      'unit_price', v_price,
      'tax_rate', v_tax_rate,
      'tax_amount', v_tax,
      'line_total', v_line_total
    );

    v_sale_lines := v_sale_lines || jsonb_build_object(
      'variant_id', v_variant.variant_id,
      'qty', v_requested_qty,
      'unit_price', v_price,
      'discount', 0
    );
  END LOOP;

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
    subtotal,
    discount_total,
    tax_total,
    total,
    store_snapshot,
    payment_payload
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
    (
      SELECT landing_return_url
      FROM online_stores
      WHERE store_id = v_store.store_id
    ),
    ROUND(v_subtotal, 2),
    ROUND(v_discount_total, 2),
    ROUND(v_tax_total, 2),
    ROUND(v_total, 2),
    jsonb_build_object(
      'slug', v_store.slug,
      'location_id', v_store.location_id,
      'sold_by_user_id', v_store.sold_by_user_id
    ),
    jsonb_build_object(
      'mode', 'MANUAL',
      'submitted_reference', NULLIF(trim(coalesce(p_payment_reference, '')), '')
    )
  )
  RETURNING online_order_id, order_number
  INTO v_order_id, v_order_number;

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
      (v_order_line->>'qty')::NUMERIC,
      (v_order_line->>'unit_price')::NUMERIC,
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
    'status', 'COMPLETED'
  );
EXCEPTION
  WHEN OTHERS THEN
    IF v_order_id IS NOT NULL THEN
      UPDATE online_orders
      SET
        status = 'FAILED',
        payment_status = 'FAILED',
        payment_payload = coalesce(payment_payload, '{}'::JSONB) || jsonb_build_object(
          'error', SQLERRM
        )
      WHERE online_order_id = v_order_id;
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

COMMENT ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Corrige la llamada a sp_create_sale() para checkout manual online usando la firma vigente de 8 parámetros.';
