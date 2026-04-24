/* ============================================================================
   ONLINE_ORDER_MOBILE_NOTIFICATIONS.sql
   Amplía fn_upsert_online_order_alert para que, además de escribir en
   system_alerts, emita también a la tabla notifications (canal mobile/push).
   Si la emisión falla por cualquier motivo no rompe la alerta operativa.
   ============================================================================ */

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

  -- ── Alerta operativa (system_alerts) — fuente canónica web + mobile ──────
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

  -- ── Notificación in-app / push (tabla notifications) — canal mobile ───────
  -- Usa dedupe de 30 min para no spamear si el pedido se actualiza varias veces.
  -- El bloque EXCEPTION garantiza que un fallo aquí no aborta la alerta.
  BEGIN
    PERFORM fn_emit_notification_event(
      p_tenant              := v_order.tenant_id,
      p_event_type          := 'ONLINE_ORDER_PENDING',
      p_severity            := 'WARNING',
      p_title               := 'Pedido online #' || v_order.order_number::TEXT,
      p_message             := v_message,
      p_payload             := jsonb_build_object(
        'online_order_id',  v_order.online_order_id,
        'order_number',     v_order.order_number,
        'customer_name',    v_order.customer_name,
        'customer_phone',   v_order.customer_phone,
        'total',            v_order.total,
        'store_name',       v_order.brand_name,
        'location_id',      v_order.location_id,
        'payment_proof_url', v_order.payment_payload->>'payment_proof_url'
      ),
      p_dedupe_key          := 'online-order:' || p_online_order_id::TEXT,
      p_target_user_id      := NULL,
      p_target_role         := NULL,
      p_location_id         := v_order.location_id,
      p_cash_register_id    := NULL,
      p_action_url          := '/sales?tab=online',
      p_entity_type         := 'ONLINE_ORDER',
      p_entity_id           := p_online_order_id::TEXT,
      p_dedupe_window_minutes := 30
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

END;
$$;

GRANT EXECUTE ON FUNCTION fn_upsert_online_order_alert(UUID) TO authenticated;
