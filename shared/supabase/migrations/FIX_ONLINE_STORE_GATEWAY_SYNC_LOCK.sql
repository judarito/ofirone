/* ============================================================================
   FIX_ONLINE_STORE_GATEWAY_SYNC_LOCK.sql
   Corrige el bloqueo de fn_sync_online_gateway_payment sobre LEFT JOIN.
   ============================================================================
*/

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
  FOR UPDATE OF o;

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

GRANT EXECUTE ON FUNCTION fn_sync_online_gateway_payment(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
