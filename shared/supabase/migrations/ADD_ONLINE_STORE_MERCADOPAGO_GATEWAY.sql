/* ============================================================================
   ADD_ONLINE_STORE_MERCADOPAGO_GATEWAY.sql
   Habilita Checkout Pro con Mercado Pago para la tienda online.
   ============================================================================
*/

ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE INDEX IF NOT EXISTS idx_online_orders_pending_expiration
  ON online_orders(expires_at)
  WHERE payment_status = 'PENDING' AND status IN ('PENDING', 'PROCESSING');

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
    AND o.payment_status = 'PENDING'
    AND (o.expires_at IS NULL OR o.expires_at > NOW());
$$;

CREATE OR REPLACE FUNCTION fn_release_expired_online_orders(
  p_limit INTEGER DEFAULT 100
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_released INTEGER := 0;
BEGIN
  FOR v_order IN
    SELECT o.online_order_id
    FROM online_orders o
    WHERE o.payment_mode = 'GATEWAY'
      AND o.payment_status = 'PENDING'
      AND o.status IN ('PENDING', 'PROCESSING')
      AND o.expires_at IS NOT NULL
      AND o.expires_at <= NOW()
    ORDER BY o.expires_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    FOR UPDATE
  LOOP
    UPDATE online_order_reservations
    SET
      status = 'RELEASED',
      released_at = NOW(),
      release_reason = 'Checkout Mercado Pago vencido'
    WHERE online_order_id = v_order.online_order_id
      AND status = 'ACTIVE';

    UPDATE online_orders
    SET
      status = 'CANCELLED',
      payment_status = 'FAILED',
      payment_payload = COALESCE(payment_payload, '{}'::JSONB) || jsonb_build_object(
        'expired_at', NOW(),
        'expiration_reason', 'Checkout Mercado Pago vencido'
      ),
      status_history = COALESCE(status_history, '[]'::JSONB) || jsonb_build_object(
        'status', 'CANCELLED',
        'payment_status', 'FAILED',
        'changed_by', 'Sistema',
        'note', 'Checkout Mercado Pago vencido',
        'timestamp', NOW()
      )
    WHERE online_order_id = v_order.online_order_id
      AND payment_status = 'PENDING'
      AND status IN ('PENDING', 'PROCESSING');

    v_released := v_released + 1;
  END LOOP;

  RETURN v_released;
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
  p_payment_proof_url TEXT DEFAULT NULL,
  p_delivery_address TEXT DEFAULT NULL
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
  v_expires_at TIMESTAMPTZ := NULL;
  v_gateway_enabled BOOLEAN := FALSE;
BEGIN
  PERFORM fn_release_expired_online_orders(50);

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

  IF v_payment_mode NOT IN ('MANUAL', 'GATEWAY') THEN
    RAISE EXCEPTION 'Método de pago no soportado para esta tienda.';
  END IF;

  IF v_payment_mode = 'MANUAL' AND NOT COALESCE(v_store.allow_manual_payment, TRUE) THEN
    RAISE EXCEPTION 'Esta tienda no tiene habilitado el pago manual.';
  END IF;

  v_gateway_enabled := COALESCE(v_store.allow_gateway_payment, FALSE) AND COALESCE(v_store.gateway_status, 'COMING_SOON') = 'ENABLED';

  IF v_payment_mode = 'GATEWAY' AND NOT v_gateway_enabled THEN
    RAISE EXCEPTION 'La pasarela de pago todavía no está disponible en esta tienda.';
  END IF;

  IF v_payment_mode = 'GATEWAY' THEN
    v_expires_at := NOW() + INTERVAL '30 minutes';
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
    delivery_address,
    payment_reference,
    landing_return_url,
    payment_payload,
    store_snapshot,
    subtotal,
    discount_total,
    tax_total,
    total,
    expires_at,
    status_history
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
    NULLIF(trim(COALESCE(p_delivery_address, '')), ''),
    NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
    jsonb_build_object(
      'mode', v_payment_mode,
      'requested_reference', NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
      'payment_proof_url', NULLIF(trim(COALESCE(p_payment_proof_url, '')), ''),
      'awaiting_confirmation', v_payment_mode = 'MANUAL',
      'awaiting_gateway', v_payment_mode = 'GATEWAY'
    ),
    jsonb_build_object(
      'brand_name', v_store.brand_name,
      'slug', fn_online_store_slugify(p_slug)
    ),
    0,
    0,
    0,
    0,
    v_expires_at,
    jsonb_build_array(
      jsonb_build_object(
        'status', 'PENDING',
        'payment_status', 'PENDING',
        'changed_by', 'Cliente',
        'note', CASE WHEN v_payment_mode = 'GATEWAY' THEN 'Pedido creado para Checkout Pro de Mercado Pago' ELSE 'Pedido creado pendiente de validación manual' END,
        'timestamp', NOW()
      )
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
    NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
    'ONLINE-' || v_order_number::TEXT
  );

  UPDATE online_orders
  SET
    payment_reference = v_payment_reference_resolved,
    subtotal = ROUND(v_subtotal, 2),
    discount_total = ROUND(v_discount_total, 2),
    tax_total = ROUND(v_tax_total, 2),
    total = ROUND(v_total_rounded, 2),
    payment_payload = COALESCE(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'generated_reference', v_payment_reference_resolved,
      'stock_reserved', TRUE,
      'payment_proof_url', NULLIF(trim(COALESCE(p_payment_proof_url, '')), ''),
      'expires_at', v_expires_at
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
    'payment_proof_url', NULLIF(trim(COALESCE(p_payment_proof_url, '')), ''),
    'landing_return_url', COALESCE(NULLIF(trim(COALESCE(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
    'expires_at', v_expires_at,
    'message', CASE
      WHEN v_payment_mode = 'GATEWAY'
        THEN 'Tu pedido quedó listo para pagar con Mercado Pago. Te redirigiremos al checkout.'
      ELSE 'Tu pedido quedó pendiente de confirmación. Reservamos el stock mientras validamos el pago manual.'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_attach_online_gateway_preference(
  p_online_order_id UUID,
  p_preference_id TEXT,
  p_init_point TEXT,
  p_sandbox_init_point TEXT DEFAULT NULL,
  p_external_reference TEXT DEFAULT NULL,
  p_preference_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF p_online_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido online requerido para adjuntar la preferencia.';
  END IF;

  SELECT *
  INTO v_order
  FROM online_orders
  WHERE online_order_id = p_online_order_id
    AND payment_mode = 'GATEWAY'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos el pedido gateway que intentas procesar.';
  END IF;

  IF v_order.sale_id IS NOT NULL OR v_order.payment_status = 'PAID' THEN
    RETURN jsonb_build_object(
      'online_order_id', v_order.online_order_id,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'already_paid', TRUE
    );
  END IF;

  UPDATE online_orders
  SET
    status = CASE WHEN status = 'PENDING' THEN 'PROCESSING' ELSE status END,
    expires_at = COALESCE(p_preference_expires_at, expires_at),
    payment_payload = COALESCE(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'preference_id', NULLIF(trim(COALESCE(p_preference_id, '')), ''),
      'init_point', NULLIF(trim(COALESCE(p_init_point, '')), ''),
      'sandbox_init_point', NULLIF(trim(COALESCE(p_sandbox_init_point, '')), ''),
      'external_reference', COALESCE(NULLIF(trim(COALESCE(p_external_reference, '')), ''), online_order_id::TEXT),
      'preference_attached_at', NOW()
    ),
    status_history = CASE
      WHEN status = 'PENDING'
        THEN COALESCE(status_history, '[]'::JSONB) || jsonb_build_object(
          'status', 'PROCESSING',
          'payment_status', 'PENDING',
          'changed_by', 'Sistema',
          'note', 'Preferencia de Mercado Pago creada',
          'timestamp', NOW()
        )
      ELSE COALESCE(status_history, '[]'::JSONB)
    END
  WHERE online_order_id = p_online_order_id;

  RETURN jsonb_build_object(
    'online_order_id', p_online_order_id,
    'status', 'PROCESSING',
    'payment_status', 'PENDING',
    'payment_url', COALESCE(NULLIF(trim(COALESCE(p_init_point, '')), ''), NULLIF(trim(COALESCE(p_sandbox_init_point, '')), '')),
    'preference_id', NULLIF(trim(COALESCE(p_preference_id, '')), ''),
    'external_reference', COALESCE(NULLIF(trim(COALESCE(p_external_reference, '')), ''), p_online_order_id::TEXT),
    'expires_at', p_preference_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_sync_online_gateway_payment(
  p_online_order_id UUID,
  p_payment_id TEXT,
  p_gateway_status TEXT,
  p_payment_status_detail TEXT DEFAULT NULL,
  p_gateway_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_status TEXT := LOWER(COALESCE(NULLIF(trim(p_gateway_status), ''), 'pending'));
  v_sale_lines JSONB := '[]'::JSONB;
  v_line RECORD;
  v_sale_id UUID;
  v_payment_reference TEXT;
  v_sale_note TEXT;
BEGIN
  IF p_online_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido online requerido.';
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
    AND o.payment_mode = 'GATEWAY'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos el pedido gateway solicitado.';
  END IF;

  IF v_status IN ('pending', 'in_process', 'authorized') THEN
    IF v_order.sale_id IS NULL AND v_order.payment_status <> 'PAID' THEN
      UPDATE online_orders
      SET
        status = 'PROCESSING',
        payment_status = 'PENDING',
        payment_payload = COALESCE(payment_payload, '{}'::JSONB)
          || COALESCE(p_gateway_payload, '{}'::JSONB)
          || jsonb_build_object(
            'mercado_pago_payment_id', NULLIF(trim(COALESCE(p_payment_id, '')), ''),
            'mercado_pago_status', v_status,
            'mercado_pago_status_detail', NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''),
            'mercado_pago_last_sync_at', NOW()
          )
      WHERE online_order_id = p_online_order_id;
    END IF;

    RETURN jsonb_build_object(
      'online_order_id', p_online_order_id,
      'status', 'PROCESSING',
      'payment_status', 'PENDING'
    );
  END IF;

  IF v_status = 'approved' THEN
    IF v_order.sale_id IS NOT NULL OR v_order.payment_status = 'PAID' THEN
      UPDATE online_orders
      SET
        payment_payload = COALESCE(payment_payload, '{}'::JSONB)
          || COALESCE(p_gateway_payload, '{}'::JSONB)
          || jsonb_build_object(
            'mercado_pago_payment_id', NULLIF(trim(COALESCE(p_payment_id, '')), ''),
            'mercado_pago_status', v_status,
            'mercado_pago_status_detail', NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''),
            'mercado_pago_last_sync_at', NOW()
          )
      WHERE online_order_id = p_online_order_id;

      RETURN jsonb_build_object(
        'online_order_id', p_online_order_id,
        'sale_id', v_order.sale_id,
        'status', COALESCE(v_order.status, 'COMPLETED'),
        'payment_status', 'PAID',
        'already_paid', TRUE
      );
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

    v_payment_reference := COALESCE(
      NULLIF(trim(COALESCE(p_payment_id, '')), ''),
      NULLIF(trim(COALESCE(v_order.payment_reference, '')), ''),
      'MP-' || v_order.order_number::TEXT
    );

    v_sale_note := concat_ws(
      ' | ',
      'Venta online Mercado Pago #' || v_order.order_number::TEXT,
      CASE WHEN NULLIF(trim(COALESCE(v_order.customer_name, '')), '') IS NOT NULL THEN 'Cliente: ' || trim(v_order.customer_name) ELSE NULL END,
      CASE WHEN NULLIF(trim(COALESCE(v_order.customer_phone, '')), '') IS NOT NULL THEN 'Tel: ' || trim(v_order.customer_phone) ELSE NULL END,
      CASE WHEN NULLIF(trim(COALESCE(v_payment_reference, '')), '') IS NOT NULL THEN 'Pago MP: ' || trim(v_payment_reference) ELSE NULL END,
      CASE WHEN NULLIF(trim(COALESCE(p_payment_status_detail, '')), '') IS NOT NULL THEN 'Estado MP: ' || trim(p_payment_status_detail) ELSE NULL END,
      CASE WHEN NULLIF(trim(COALESCE(v_order.customer_note, '')), '') IS NOT NULL THEN 'Nota cliente: ' || trim(v_order.customer_note) ELSE NULL END
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
          'reference', v_payment_reference
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
      payment_reference = v_payment_reference,
      expires_at = NULL,
      payment_payload = COALESCE(payment_payload, '{}'::JSONB)
        || COALESCE(p_gateway_payload, '{}'::JSONB)
        || jsonb_build_object(
          'mercado_pago_payment_id', NULLIF(trim(COALESCE(p_payment_id, '')), ''),
          'mercado_pago_status', v_status,
          'mercado_pago_status_detail', NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''),
          'mercado_pago_last_sync_at', NOW(),
          'confirmed_at', NOW(),
          'confirmed_by', 'mercado_pago_webhook'
        ),
      status_history = COALESCE(status_history, '[]'::JSONB) || jsonb_build_object(
        'status', 'COMPLETED',
        'payment_status', 'PAID',
        'changed_by', 'Mercado Pago',
        'note', COALESCE(NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''), 'Pago aprobado por webhook'),
        'timestamp', NOW()
      )
    WHERE online_order_id = v_order.online_order_id;

    RETURN jsonb_build_object(
      'online_order_id', v_order.online_order_id,
      'sale_id', v_sale_id,
      'status', 'COMPLETED',
      'payment_status', 'PAID',
      'payment_reference', v_payment_reference
    );
  END IF;

  IF v_status = 'refunded' THEN
    UPDATE online_orders
    SET
      payment_status = 'REFUNDED',
      payment_payload = COALESCE(payment_payload, '{}'::JSONB)
        || COALESCE(p_gateway_payload, '{}'::JSONB)
        || jsonb_build_object(
          'mercado_pago_payment_id', NULLIF(trim(COALESCE(p_payment_id, '')), ''),
          'mercado_pago_status', v_status,
          'mercado_pago_status_detail', NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''),
          'mercado_pago_last_sync_at', NOW()
        ),
      status_history = COALESCE(status_history, '[]'::JSONB) || jsonb_build_object(
        'status', COALESCE(v_order.status, 'COMPLETED'),
        'payment_status', 'REFUNDED',
        'changed_by', 'Mercado Pago',
        'note', COALESCE(NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''), 'Pago reembolsado'),
        'timestamp', NOW()
      )
    WHERE online_order_id = v_order.online_order_id;

    RETURN jsonb_build_object(
      'online_order_id', v_order.online_order_id,
      'sale_id', v_order.sale_id,
      'status', COALESCE(v_order.status, 'COMPLETED'),
      'payment_status', 'REFUNDED'
    );
  END IF;

  IF v_order.sale_id IS NOT NULL OR v_order.payment_status = 'PAID' THEN
    UPDATE online_orders
    SET
      payment_payload = COALESCE(payment_payload, '{}'::JSONB)
        || COALESCE(p_gateway_payload, '{}'::JSONB)
        || jsonb_build_object(
          'mercado_pago_payment_id', NULLIF(trim(COALESCE(p_payment_id, '')), ''),
          'mercado_pago_status', v_status,
          'mercado_pago_status_detail', NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''),
          'mercado_pago_last_sync_at', NOW()
        )
    WHERE online_order_id = p_online_order_id;

    RETURN jsonb_build_object(
      'online_order_id', p_online_order_id,
      'sale_id', v_order.sale_id,
      'status', v_order.status,
      'payment_status', v_order.payment_status
    );
  END IF;

  UPDATE online_order_reservations
  SET
    status = 'RELEASED',
    released_at = NOW(),
    release_reason = COALESCE(NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''), 'Pago Mercado Pago no aprobado')
  WHERE online_order_id = v_order.online_order_id
    AND status = 'ACTIVE';

  UPDATE online_orders
  SET
    status = 'CANCELLED',
    payment_status = 'FAILED',
    expires_at = NULL,
    payment_payload = COALESCE(payment_payload, '{}'::JSONB)
      || COALESCE(p_gateway_payload, '{}'::JSONB)
      || jsonb_build_object(
        'mercado_pago_payment_id', NULLIF(trim(COALESCE(p_payment_id, '')), ''),
        'mercado_pago_status', v_status,
        'mercado_pago_status_detail', NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''),
        'mercado_pago_last_sync_at', NOW(),
        'rejection_reason', COALESCE(NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''), 'Pago Mercado Pago no aprobado')
      ),
    status_history = COALESCE(status_history, '[]'::JSONB) || jsonb_build_object(
      'status', 'CANCELLED',
      'payment_status', 'FAILED',
      'changed_by', 'Mercado Pago',
      'note', COALESCE(NULLIF(trim(COALESCE(p_payment_status_detail, '')), ''), 'Pago Mercado Pago no aprobado'),
      'timestamp', NOW()
    )
  WHERE online_order_id = v_order.online_order_id;

  RETURN jsonb_build_object(
    'online_order_id', v_order.online_order_id,
    'status', 'CANCELLED',
    'payment_status', 'FAILED'
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_get_public_order_status(
  p_order_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_lines JSONB;
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
    o.payment_reference,
    o.expires_at,
    o.created_at,
    o.payment_payload,
    COALESCE(NULLIF(s.brand_name, ''), o.store_snapshot->>'brand_name', 'Tienda online') AS store_name,
    s.slug AS store_slug
  INTO v_order
  FROM online_orders o
  JOIN online_stores s
    ON s.store_id = o.store_id
  WHERE o.online_order_id = p_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido no encontrado.');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_name', l.product_name,
      'variant_name', l.variant_name,
      'sku', l.sku,
      'quantity', l.quantity,
      'unit_price', l.unit_price,
      'tax_rate', l.tax_rate,
      'line_total', l.line_total
    ) ORDER BY l.created_at
  )
  INTO v_lines
  FROM online_order_lines l
  WHERE l.online_order_id = p_order_id;

  RETURN jsonb_build_object(
    'online_order_id', v_order.online_order_id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'payment_mode', v_order.payment_mode,
    'total', v_order.total,
    'subtotal', v_order.subtotal,
    'tax_total', v_order.tax_total,
    'customer_name', v_order.customer_name,
    'customer_note', v_order.customer_note,
    'delivery_address', v_order.delivery_address,
    'payment_reference', v_order.payment_reference,
    'payment_proof_url', v_order.payment_payload->>'payment_proof_url',
    'payment_link', COALESCE(v_order.payment_payload->>'init_point', v_order.payment_payload->>'sandbox_init_point'),
    'payment_status_detail', v_order.payment_payload->>'mercado_pago_status_detail',
    'mercado_pago_status', v_order.payment_payload->>'mercado_pago_status',
    'expires_at', v_order.expires_at,
    'created_at', v_order.created_at,
    'store_name', v_order.store_name,
    'store_slug', v_order.store_slug,
    'lines', COALESCE(v_lines, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_get_public_order_status(UUID) TO anon, authenticated;
COMMENT ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) IS
  'Crea un pedido online y reserva stock. Soporta MANUAL y GATEWAY para Checkout Pro de Mercado Pago.';
