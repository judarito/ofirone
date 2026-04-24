/* ============================================================================
   ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql
   Flujo manual: pedido pendiente, reserva de stock y confirmación desde backoffice.
   ============================================================================ */

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

CREATE INDEX IF NOT EXISTS idx_online_order_reservations_order
  ON online_order_reservations(online_order_id, status);

CREATE INDEX IF NOT EXISTS idx_online_order_reservations_store_variant
  ON online_order_reservations(store_id, variant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON online_order_reservations TO authenticated;

ALTER TABLE online_order_reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'online_order_reservations'
      AND policyname = 'online_order_reservations_tenant_isolation'
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
        COALESCE(sb.on_hand, 0)
        - COALESCE(sb.reserved, 0)
        - COALESCE(sc.stock_buffer_units, 0)
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

CREATE OR REPLACE FUNCTION fn_online_store_create_sale(
  p_tenant UUID,
  p_location UUID,
  p_cash_session UUID,
  p_customer UUID,
  p_sold_by UUID,
  p_lines JSONB,
  p_payments JSONB,
  p_note TEXT,
  p_third_party UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sp_create_sale'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, uuid'
  ) THEN
    EXECUTE 'SELECT sp_create_sale($1,$2,$3,$4,$5,$6,$7,$8,$9)'
      INTO v_sale_id
      USING p_tenant, p_location, p_cash_session, p_customer, p_sold_by, p_lines, p_payments, p_note, p_third_party;
    RETURN v_sale_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sp_create_sale'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text'
  ) THEN
    EXECUTE 'SELECT sp_create_sale($1,$2,$3,$4,$5,$6,$7,$8)'
      INTO v_sale_id
      USING p_tenant, p_location, p_cash_session, p_customer, p_sold_by, p_lines, p_payments, p_note;
    RETURN v_sale_id;
  END IF;

  RAISE EXCEPTION 'No se encontró una firma compatible de sp_create_sale() para confirmar el pedido online.';
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
      'requested_reference', NULLIF(trim(coalesce(p_payment_reference, '')), ''),
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
      'stock_reserved', TRUE
    )
  WHERE online_order_id = v_order_id;

  RETURN jsonb_build_object(
    'online_order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'PENDING',
    'payment_status', 'PENDING',
    'sale_id', NULL,
    'total', ROUND(v_total_rounded, 2),
    'payment_reference', v_payment_reference_resolved,
    'landing_return_url', COALESCE(NULLIF(trim(coalesce(p_landing_return_url, '')), ''), NULLIF(v_store.landing_return_url, '')),
    'message', 'Tu pedido quedó pendiente de confirmación. Reservamos el stock mientras validamos el pago manual.'
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

  IF v_order.location_id IS NULL OR v_order.sold_by_user_id IS NULL OR NULLIF(trim(coalesce(v_order.payment_method_code, '')), '') IS NULL THEN
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
    NULLIF(trim(coalesce(p_payment_reference, '')), ''),
    NULLIF(trim(coalesce(v_order.payment_reference, '')), ''),
    'ONLINE-' || v_order.order_number::TEXT
  );

  v_sale_note := concat_ws(
    ' | ',
    'Venta online #' || v_order.order_number::TEXT,
    CASE WHEN NULLIF(trim(coalesce(v_order.customer_name, '')), '') IS NOT NULL THEN 'Cliente: ' || trim(v_order.customer_name) ELSE NULL END,
    CASE WHEN NULLIF(trim(coalesce(v_order.customer_phone, '')), '') IS NOT NULL THEN 'Tel: ' || trim(v_order.customer_phone) ELSE NULL END,
    CASE WHEN NULLIF(trim(coalesce(v_payment_reference_resolved, '')), '') IS NOT NULL THEN 'Ref pago: ' || trim(v_payment_reference_resolved) ELSE NULL END,
    CASE WHEN NULLIF(trim(coalesce(v_order.customer_note, '')), '') IS NOT NULL THEN 'Nota cliente: ' || trim(v_order.customer_note) ELSE NULL END,
    CASE WHEN NULLIF(trim(coalesce(p_payment_note, '')), '') IS NOT NULL THEN 'Validación: ' || trim(p_payment_note) ELSE NULL END
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
    payment_payload = coalesce(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'confirmed_at', NOW(),
      'confirmed_by_auth_user_id', auth.uid(),
      'confirmation_note', NULLIF(trim(coalesce(p_payment_note, '')), '')
    )
  WHERE online_order_id = v_order.online_order_id;

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

  v_reason := NULLIF(trim(coalesce(p_reason, '')), '');

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
    payment_payload = coalesce(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'rejected_at', NOW(),
      'rejected_by_auth_user_id', auth.uid(),
      'rejection_reason', COALESCE(v_reason, 'Pago manual rechazado')
    )
  WHERE online_order_id = v_order.online_order_id;

  RETURN jsonb_build_object(
    'online_order_id', v_order.online_order_id,
    'status', 'CANCELLED',
    'payment_status', 'FAILED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_confirm_online_manual_order(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_reject_online_manual_order(UUID, TEXT) TO authenticated;

COMMENT ON TABLE online_order_reservations IS 'Reservas temporales de stock para pedidos online manuales pendientes de confirmación.';
COMMENT ON FUNCTION fn_create_online_manual_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Crea un pedido online manual, guarda sus líneas y reserva stock hasta que el pago sea confirmado o rechazado.';
COMMENT ON FUNCTION fn_confirm_online_manual_order(UUID, TEXT, TEXT) IS
  'Confirma un pedido manual online desde backoffice, crea la venta en POS y consume la reserva.';
COMMENT ON FUNCTION fn_reject_online_manual_order(UUID, TEXT) IS
  'Rechaza un pedido manual online y libera la reserva de stock.';
