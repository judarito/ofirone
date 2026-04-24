/* ============================================================================
   ONLINE_STORE_ADDRESS_AND_STATUS.sql
   1. Agrega columna delivery_address a online_orders.
   2. Actualiza fn_create_online_manual_order para aceptar p_delivery_address.
   3. Crea fn_get_public_order_status para consulta anónima del estado del pedido.
   ============================================================================ */

-- 1. Nueva columna
ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

-- 2. Reemplazar fn_create_online_manual_order con soporte para delivery_address
--    Firma anterior: (TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
--    Firma nueva:    (TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT)
DROP FUNCTION IF EXISTS fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION fn_create_online_manual_order(
  p_slug              TEXT,
  p_customer_name     TEXT,
  p_customer_email    TEXT,
  p_customer_phone    TEXT,
  p_customer_note     TEXT,
  p_payment_reference TEXT,
  p_landing_return_url TEXT,
  p_lines             JSONB,
  p_payment_mode      TEXT    DEFAULT 'MANUAL',
  p_payment_proof_url TEXT    DEFAULT NULL,
  p_delivery_address  TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store           RECORD;
  v_order_id        UUID;
  v_order_number    BIGINT;
  v_line            JSONB;
  v_variant         UUID;
  v_qty             NUMERIC;
  v_available       NUMERIC;
  v_unit_price      NUMERIC;
  v_tax_rate        NUMERIC;
  v_line_base       NUMERIC;
  v_tax_amount      NUMERIC;
  v_line_total      NUMERIC;
  v_sku             TEXT;
  v_product_name    TEXT;
  v_variant_name    TEXT;
  v_subtotal        NUMERIC := 0;
  v_discount_total  NUMERIC := 0;
  v_tax_total       NUMERIC := 0;
  v_total           NUMERIC := 0;
  v_total_rounded   NUMERIC := 0;
  v_payment_mode    TEXT := UPPER(COALESCE(NULLIF(trim(p_payment_mode), ''), 'MANUAL'));
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
    delivery_address,
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
    NULLIF(trim(COALESCE(p_customer_name, '')), ''),
    NULLIF(trim(COALESCE(p_customer_email, '')), ''),
    NULLIF(trim(COALESCE(p_customer_phone, '')), ''),
    NULLIF(trim(COALESCE(p_customer_note, '')), ''),
    NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
    NULLIF(trim(COALESCE(p_delivery_address, '')), ''),
    jsonb_build_object(
      'mode', v_payment_mode,
      'requested_reference', NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
      'payment_proof_url', NULLIF(trim(COALESCE(p_payment_proof_url, '')), ''),
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
    v_qty     := COALESCE((v_line->>'qty')::NUMERIC, 0);

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
      COALESCE(t.rate, 0),
      pv.sku,
      p.name,
      v.name
    INTO
      v_unit_price,
      v_tax_rate,
      v_sku,
      v_product_name,
      v_variant_name
    FROM product_variants pv
    JOIN products p ON p.product_id = pv.product_id
    LEFT JOIN variants v ON v.variant_id = pv.variant_id
    LEFT JOIN taxes t ON t.tax_id = p.tax_id
    WHERE pv.variant_id = v_variant
      AND p.tenant_id = v_store.tenant_id
      AND p.is_active = TRUE
      AND pv.is_active = TRUE
    LIMIT 1;

    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'No encontramos precio activo para la variante %.', v_variant;
    END IF;

    SELECT fn_online_store_available_qty(v_store.store_id, v_variant)
    INTO v_available;

    IF COALESCE(v_available, 0) < v_qty THEN
      RAISE EXCEPTION 'Stock online insuficiente para % (%). Disponible: %, solicitado: %.',
        COALESCE(v_product_name, 'producto'),
        COALESCE(v_sku, v_variant::TEXT),
        COALESCE(v_available, 0),
        v_qty;
    END IF;

    v_line_base  := ROUND(v_unit_price * v_qty, 6);
    v_tax_amount := ROUND(v_line_base * (COALESCE(v_tax_rate, 0) / 100), 6);
    v_line_total := ROUND(v_line_base + v_tax_amount, 6);

    v_subtotal   := v_subtotal   + v_line_base;
    v_tax_total  := v_tax_total  + v_tax_amount;
    v_total      := v_total      + v_line_total;

    INSERT INTO online_order_lines(
      tenant_id,
      online_order_id,
      variant_id,
      product_name,
      variant_name,
      sku,
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
      COALESCE(v_product_name, 'Producto'),
      NULLIF(COALESCE(v_variant_name, ''), ''),
      NULLIF(COALESCE(v_sku, ''), ''),
      v_qty,
      ROUND(v_unit_price, 6),
      ROUND(COALESCE(v_tax_rate, 0), 6),
      ROUND(v_tax_amount, 6),
      ROUND(v_line_total, 6)
    );

    INSERT INTO online_order_reservations(
      tenant_id,
      online_order_id,
      store_id,
      variant_id,
      reserved_qty,
      status
    )
    VALUES (
      v_store.tenant_id,
      v_order_id,
      v_store.store_id,
      v_variant,
      v_qty,
      'ACTIVE'
    );
  END LOOP;

  v_total_rounded := ROUND(v_total, 2);

  UPDATE online_orders
  SET
    subtotal       = ROUND(v_subtotal, 2),
    discount_total = ROUND(v_discount_total, 2),
    tax_total      = ROUND(v_tax_total, 2),
    total          = v_total_rounded,
    payment_reference = COALESCE(
      NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
      'PENDIENTE-' || v_order_number::TEXT
    )
  WHERE online_order_id = v_order_id;

  PERFORM fn_upsert_online_order_alert(v_order_id);

  RETURN jsonb_build_object(
    'online_order_id',    v_order_id,
    'order_number',       v_order_number,
    'status',             'PENDING',
    'payment_status',     'PENDING',
    'payment_mode',       v_payment_mode,
    'total',              v_total_rounded,
    'message',            'Pedido recibido. El pago manual queda pendiente de confirmación.',
    'landing_return_url', COALESCE(NULLIF(trim(COALESCE(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, ''))
  );
END;
$$;

-- 3. Función pública para consultar el estado de un pedido (sin autenticación)
CREATE OR REPLACE FUNCTION fn_get_public_order_status(
  p_order_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  RECORD;
  v_lines  JSONB;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'ID de pedido requerido.');
  END IF;

  SELECT
    o.online_order_id,
    o.order_number,
    o.status,
    o.payment_status,
    o.payment_mode,
    o.total,
    o.subtotal,
    o.tax_total,
    o.customer_name,
    o.customer_note,
    o.delivery_address,
    o.created_at,
    o.payment_payload,
    COALESCE(NULLIF(s.brand_name, ''), o.store_snapshot->>'brand_name', 'Tienda online') AS store_name,
    s.slug AS store_slug
  INTO v_order
  FROM online_orders o
  JOIN online_stores s ON s.store_id = o.store_id
  WHERE o.online_order_id = p_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido no encontrado.');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_name',  l.product_name,
      'variant_name',  l.variant_name,
      'sku',           l.sku,
      'quantity',      l.quantity,
      'unit_price',    l.unit_price,
      'tax_rate',      l.tax_rate,
      'line_total',    l.line_total
    ) ORDER BY l.created_at
  )
  INTO v_lines
  FROM online_order_lines l
  WHERE l.online_order_id = p_order_id;

  RETURN jsonb_build_object(
    'online_order_id',   v_order.online_order_id,
    'order_number',      v_order.order_number,
    'status',            v_order.status,
    'payment_status',    v_order.payment_status,
    'payment_mode',      v_order.payment_mode,
    'total',             v_order.total,
    'subtotal',          v_order.subtotal,
    'tax_total',         v_order.tax_total,
    'customer_name',     v_order.customer_name,
    'customer_note',     v_order.customer_note,
    'delivery_address',  v_order.delivery_address,
    'payment_proof_url', v_order.payment_payload->>'payment_proof_url',
    'created_at',        v_order.created_at,
    'store_name',        v_order.store_name,
    'store_slug',        v_order.store_slug,
    'lines',             COALESCE(v_lines, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_get_public_order_status(UUID) TO anon, authenticated;
