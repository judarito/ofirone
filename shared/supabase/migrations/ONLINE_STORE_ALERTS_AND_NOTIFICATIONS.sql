/* ============================================================================
   ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql
   Genera alertas del sistema cuando entra un pedido online pendiente y las
   limpia cuando el pedido es confirmado o rechazado.
   ============================================================================ */

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'system_alerts'
  ) THEN
    ALTER TABLE system_alerts
      DROP CONSTRAINT IF EXISTS system_alerts_alert_type_check;

    ALTER TABLE system_alerts
      ADD CONSTRAINT system_alerts_alert_type_check
      CHECK (alert_type IN ('STOCK', 'LAYAWAY', 'EXPIRATION', 'PAYABLE', 'RECEIVABLE', 'ONLINE_ORDER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_system_alerts_online_order
  ON system_alerts(tenant_id, alert_type, created_at DESC)
  WHERE alert_type = 'ONLINE_ORDER';

CREATE OR REPLACE FUNCTION fn_clear_online_order_alert(
  p_online_order_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_online_order_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM system_alerts
  WHERE alert_type = 'ONLINE_ORDER'
    AND reference_id = p_online_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_upsert_online_order_alert(
  p_online_order_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_items_count INTEGER := 0;
  v_reserved_qty NUMERIC := 0;
  v_message TEXT;
BEGIN
  IF p_online_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    o.online_order_id,
    o.tenant_id,
    o.order_number,
    o.status,
    o.payment_status,
    o.payment_mode,
    o.payment_reference,
    o.customer_name,
    o.customer_phone,
    o.customer_email,
    o.total,
    o.created_at,
    o.payment_payload,
    s.store_id,
    s.slug,
    COALESCE(NULLIF(s.brand_name, ''), o.store_snapshot->>'brand_name', 'Tienda online') AS brand_name,
    l.location_id,
    l.name AS location_name
  INTO v_order
  FROM online_orders o
  JOIN online_stores s
    ON s.store_id = o.store_id
  LEFT JOIN locations l
    ON l.location_id = s.location_id
  WHERE o.online_order_id = p_online_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM fn_clear_online_order_alert(p_online_order_id);
    RETURN;
  END IF;

  IF v_order.status NOT IN ('PENDING', 'PROCESSING')
     OR v_order.payment_status <> 'PENDING' THEN
    PERFORM fn_clear_online_order_alert(p_online_order_id);
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_items_count
  FROM online_order_lines l
  WHERE l.online_order_id = v_order.online_order_id;

  SELECT COALESCE(SUM(r.reserved_qty), 0)
  INTO v_reserved_qty
  FROM online_order_reservations r
  WHERE r.online_order_id = v_order.online_order_id
    AND r.status = 'ACTIVE';

  v_message := format(
    'Nuevo pedido online #%s pendiente de confirmacion por %s.',
    v_order.order_number,
    COALESCE(NULLIF(trim(COALESCE(v_order.customer_name, '')), ''), 'cliente no identificado')
  );

  INSERT INTO system_alerts (
    tenant_id,
    alert_type,
    alert_level,
    reference_id,
    data
  )
  VALUES (
    v_order.tenant_id,
    'ONLINE_ORDER',
    'PENDING',
    v_order.online_order_id,
    jsonb_build_object(
      'message', v_message,
      'online_order_id', v_order.online_order_id,
      'order_number', v_order.order_number,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'payment_mode', v_order.payment_mode,
      'payment_reference', v_order.payment_reference,
      'customer_name', v_order.customer_name,
      'customer_phone', v_order.customer_phone,
      'customer_email', v_order.customer_email,
      'total', v_order.total,
      'created_at', v_order.created_at,
      'items_count', v_items_count,
      'reserved_qty', v_reserved_qty,
      'location_id', v_order.location_id,
      'location_name', v_order.location_name,
      'store_id', v_order.store_id,
      'store_slug', v_order.slug,
      'store_name', v_order.brand_name,
      'payment_proof_url', v_order.payment_payload->>'payment_proof_url'
    )
  )
  ON CONFLICT (tenant_id, alert_type, reference_id)
  DO UPDATE
  SET
    alert_level = EXCLUDED.alert_level,
    data = EXCLUDED.data,
    updated_at = NOW();
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
    NULLIF(trim(COALESCE(p_customer_name, '')), ''),
    NULLIF(trim(COALESCE(p_customer_email, '')), ''),
    NULLIF(trim(COALESCE(p_customer_phone, '')), ''),
    NULLIF(trim(COALESCE(p_customer_note, '')), ''),
    NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
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

    v_line_base := ROUND(v_unit_price * v_qty, 6);
    v_tax_amount := ROUND(v_line_base * (COALESCE(v_tax_rate, 0) / 100), 6);
    v_line_total := ROUND(v_line_base + v_tax_amount, 6);

    v_subtotal := v_subtotal + v_line_base;
    v_tax_total := v_tax_total + v_tax_amount;
    v_total := v_total + v_line_total;

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
    subtotal = ROUND(v_subtotal, 2),
    discount_total = ROUND(v_discount_total, 2),
    tax_total = ROUND(v_tax_total, 2),
    total = v_total_rounded,
    payment_reference = COALESCE(
      NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
      'PENDIENTE-' || v_order_number::TEXT
    )
  WHERE online_order_id = v_order_id;

  PERFORM fn_upsert_online_order_alert(v_order_id);

  RETURN jsonb_build_object(
    'online_order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'PENDING',
    'payment_status', 'PENDING',
    'payment_mode', v_payment_mode,
    'total', v_total_rounded,
    'message', 'Pedido recibido. El pago manual queda pendiente de confirmación.',
    'landing_return_url', COALESCE(NULLIF(trim(COALESCE(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, ''))
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_confirm_online_manual_order(
  p_online_order_id UUID,
  p_payment_reference TEXT DEFAULT NULL,
  p_payment_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_tenant UUID;
  v_order RECORD;
  v_sale_lines JSONB := '[]'::JSONB;
  v_line RECORD;
  v_sale_id UUID;
  v_payment_reference_resolved TEXT;
  v_sale_note TEXT;
BEGIN
  SELECT u.tenant_id
  INTO v_actor_tenant
  FROM users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_actor_tenant IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para confirmar pedidos online.';
  END IF;

  SELECT
    o.*,
    s.location_id,
    s.sold_by_user_id,
    pm.code AS payment_method_code
  INTO v_order
  FROM online_orders o
  JOIN online_stores s
    ON s.store_id = o.store_id
  LEFT JOIN payment_methods pm
    ON pm.payment_method_id = s.manual_payment_method_id
   AND pm.tenant_id = s.tenant_id
   AND pm.is_active = TRUE
  WHERE o.online_order_id = p_online_order_id
    AND o.tenant_id = v_actor_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos el pedido online solicitado.';
  END IF;

  IF v_order.payment_mode <> 'MANUAL' THEN
    RAISE EXCEPTION 'Solo los pedidos manuales se confirman desde este flujo.';
  END IF;

  IF v_order.sale_id IS NOT NULL OR v_order.status = 'COMPLETED' OR v_order.payment_status = 'PAID' THEN
    RAISE EXCEPTION 'Este pedido ya fue confirmado anteriormente.';
  END IF;

  IF v_order.status NOT IN ('PENDING', 'PROCESSING') OR v_order.payment_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Este pedido ya no está pendiente de confirmación.';
  END IF;

  IF v_order.location_id IS NULL OR v_order.sold_by_user_id IS NULL OR NULLIF(trim(COALESCE(v_order.payment_method_code, '')), '') IS NULL THEN
    RAISE EXCEPTION 'La tienda no tiene la configuración mínima para registrar la venta final.';
  END IF;

  FOR v_line IN
    SELECT *
    FROM online_order_lines
    WHERE online_order_id = v_order.online_order_id
    ORDER BY created_at ASC, online_order_line_id ASC
  LOOP
    v_sale_lines := v_sale_lines || jsonb_build_array(
      jsonb_build_object(
        'variant_id', v_line.variant_id,
        'qty', v_line.quantity,
        'unit_price', v_line.unit_price,
        'discount', 0
      )
    );
  END LOOP;

  IF jsonb_array_length(v_sale_lines) = 0 THEN
    RAISE EXCEPTION 'El pedido no tiene líneas para confirmar.';
  END IF;

  v_payment_reference_resolved := COALESCE(
    NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
    NULLIF(trim(COALESCE(v_order.payment_reference, '')), ''),
    'ONLINE-' || v_order.order_number::TEXT
  );

  v_sale_note := concat_ws(
    ' | ',
    'Venta online #' || v_order.order_number::TEXT,
    CASE WHEN NULLIF(trim(COALESCE(v_order.customer_name, '')), '') IS NOT NULL THEN 'Cliente: ' || trim(v_order.customer_name) ELSE NULL END,
    CASE WHEN NULLIF(trim(COALESCE(v_order.customer_phone, '')), '') IS NOT NULL THEN 'Tel: ' || trim(v_order.customer_phone) ELSE NULL END,
    CASE WHEN NULLIF(trim(COALESCE(v_payment_reference_resolved, '')), '') IS NOT NULL THEN 'Ref pago: ' || trim(v_payment_reference_resolved) ELSE NULL END,
    CASE WHEN NULLIF(trim(COALESCE(v_order.customer_note, '')), '') IS NOT NULL THEN 'Nota cliente: ' || trim(v_order.customer_note) ELSE NULL END,
    CASE WHEN NULLIF(trim(COALESCE(p_payment_note, '')), '') IS NOT NULL THEN 'Validación: ' || trim(p_payment_note) ELSE NULL END
  );

  v_sale_id := fn_online_store_create_sale(
    v_order.tenant_id,
    v_order.location_id,
    NULL::UUID,
    NULL::UUID,
    v_order.sold_by_user_id,
    v_sale_lines,
    jsonb_build_array(
      jsonb_build_object(
        'payment_method_code', v_order.payment_method_code,
        'amount', ROUND(v_order.total, 2),
        'reference', v_payment_reference_resolved
      )
    ),
    v_sale_note,
    NULL::UUID
  );

  UPDATE online_order_reservations
  SET
    status = 'CONSUMED',
    consumed_at = NOW(),
    released_at = NULL,
    release_reason = NULL
  WHERE online_order_id = v_order.online_order_id
    AND status = 'ACTIVE';

  UPDATE online_orders
  SET
    sale_id = v_sale_id,
    status = 'COMPLETED',
    payment_status = 'PAID',
    payment_reference = v_payment_reference_resolved,
    payment_payload = COALESCE(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'confirmed_at', NOW(),
      'confirmed_by_auth_user_id', auth.uid(),
      'confirmation_note', NULLIF(trim(COALESCE(p_payment_note, '')), '')
    )
  WHERE online_order_id = v_order.online_order_id;

  PERFORM fn_clear_online_order_alert(v_order.online_order_id);

  RETURN jsonb_build_object(
    'online_order_id', v_order.online_order_id,
    'sale_id', v_sale_id,
    'status', 'COMPLETED',
    'payment_status', 'PAID',
    'payment_reference', v_payment_reference_resolved
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_reject_online_manual_order(
  p_online_order_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_tenant UUID;
  v_order RECORD;
  v_reason TEXT;
BEGIN
  SELECT u.tenant_id
  INTO v_actor_tenant
  FROM users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_actor_tenant IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para rechazar pedidos online.';
  END IF;

  SELECT *
  INTO v_order
  FROM online_orders o
  WHERE o.online_order_id = p_online_order_id
    AND o.tenant_id = v_actor_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos el pedido online solicitado.';
  END IF;

  IF v_order.sale_id IS NOT NULL OR v_order.status = 'COMPLETED' OR v_order.payment_status = 'PAID' THEN
    RAISE EXCEPTION 'Este pedido ya fue confirmado y no puede rechazarse desde aquí.';
  END IF;

  IF v_order.status NOT IN ('PENDING', 'PROCESSING') OR v_order.payment_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Este pedido ya no está pendiente de revisión.';
  END IF;

  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');

  UPDATE online_order_reservations
  SET
    status = 'RELEASED',
    released_at = NOW(),
    release_reason = COALESCE(v_reason, 'Pago manual rechazado')
  WHERE online_order_id = v_order.online_order_id
    AND status = 'ACTIVE';

  UPDATE online_orders
  SET
    status = 'CANCELLED',
    payment_status = 'FAILED',
    payment_payload = COALESCE(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'rejected_at', NOW(),
      'rejected_by_auth_user_id', auth.uid(),
      'rejection_reason', COALESCE(v_reason, 'Pago manual rechazado')
    )
  WHERE online_order_id = v_order.online_order_id;

  PERFORM fn_clear_online_order_alert(v_order.online_order_id);

  RETURN jsonb_build_object(
    'online_order_id', v_order.online_order_id,
    'status', 'CANCELLED',
    'payment_status', 'FAILED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_confirm_online_manual_order(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_reject_online_manual_order(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_upsert_online_order_alert(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_clear_online_order_alert(UUID) TO authenticated;
