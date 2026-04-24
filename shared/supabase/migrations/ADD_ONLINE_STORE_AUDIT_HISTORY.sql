/* ============================================================================
   ADD_ONLINE_STORE_AUDIT_HISTORY.sql
   Agrega columna status_history a online_orders y modifica las funciones
   fn_confirm_online_manual_order y fn_reject_online_manual_order para
   registrar auditoría de cambios.
   ============================================================================ */

-- 1. Agregar columna status_history a online_orders
ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMENT ON COLUMN online_orders.status_history IS
  'Array JSON con historial de cambios: [{status, payment_status, changed_by, changed_by_name, note, timestamp}]';

-- 2. Función helper para obtener el nombre del usuario autenticado
CREATE OR REPLACE FUNCTION fn_online_order_actor_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(u.full_name, u.email, 'Usuario desconocido')
  FROM users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- 3. Modificar fn_confirm_online_manual_order para registrar historial
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
  v_actor_name TEXT;
  v_order RECORD;
  v_sale_lines JSONB := '[]'::JSONB;
  v_line RECORD;
  v_sale_id UUID;
  v_payment_reference_resolved TEXT;
  v_sale_note TEXT;
  v_history_entry JSONB;
BEGIN
  SELECT u.tenant_id
  INTO v_actor_tenant
  FROM users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_actor_tenant IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para confirmar pedidos online.';
  END IF;

  v_actor_name := fn_online_order_actor_name();

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

  -- Registrar entrada de historial
  v_history_entry := jsonb_build_object(
    'status', 'COMPLETED',
    'payment_status', 'PAID',
    'changed_by', v_actor_name,
    'note', NULLIF(trim(coalesce(p_payment_note, '')), ''),
    'timestamp', NOW()
  );

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
    ),
    status_history = COALESCE(status_history, '[]'::JSONB) || v_history_entry
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

-- 4. Modificar fn_reject_online_manual_order para registrar historial
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
  v_actor_name TEXT;
  v_order RECORD;
  v_reason TEXT;
  v_history_entry JSONB;
BEGIN
  SELECT u.tenant_id
  INTO v_actor_tenant
  FROM users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_actor_tenant IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para rechazar pedidos online.';
  END IF;

  v_actor_name := fn_online_order_actor_name();

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

  -- Registrar entrada de historial
  v_history_entry := jsonb_build_object(
    'status', 'CANCELLED',
    'payment_status', 'FAILED',
    'changed_by', v_actor_name,
    'note', COALESCE(v_reason, 'Pago manual rechazado'),
    'timestamp', NOW()
  );

  UPDATE online_orders
  SET
    status = 'CANCELLED',
    payment_status = 'FAILED',
    payment_payload = coalesce(payment_payload, '{}'::JSONB) || jsonb_build_object(
      'rejected_at', NOW(),
      'rejected_by_auth_user_id', auth.uid(),
      'rejection_reason', COALESCE(v_reason, 'Pago manual rechazado')
    ),
    status_history = COALESCE(status_history, '[]'::JSONB) || v_history_entry
  WHERE online_order_id = v_order.online_order_id;

  RETURN jsonb_build_object(
    'online_order_id', v_order.online_order_id,
    'status', 'CANCELLED',
    'payment_status', 'FAILED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_online_order_actor_name() TO authenticated;

COMMENT ON FUNCTION fn_online_order_actor_name IS
  'Obtiene el nombre del usuario autenticado para registrar en el historial de auditoría.';
