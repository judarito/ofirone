-- ============================================================
-- Mejora liberacion de stock online: timeout configurable + ordenes manuales
-- ============================================================

-- Agregar timeout configurable en tenant_settings
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS online_order_timeout_minutes INTEGER DEFAULT 30;

COMMENT ON COLUMN tenant_settings.online_order_timeout_minutes IS
  'Minutos antes de liberar reservas de stock de una orden online no pagada (default 30).';

-- Agregar expires_at a ordenes que no lo tienen (retroactivo)
UPDATE online_orders
SET expires_at = created_at + INTERVAL '120 minutes'
WHERE expires_at IS NULL
  AND payment_status = 'PENDING'
  AND payment_mode = 'MANUAL';

UPDATE online_orders
SET expires_at = created_at + INTERVAL '30 minutes'
WHERE expires_at IS NULL
  AND payment_status = 'PENDING'
  AND payment_mode = 'GATEWAY';

-- Mejorar fn_release_expired_online_orders para:
-- 1. Gateway: usa expires_at configurado (default 30 min)
-- 2. Manual: usa expires_at (default 2 horas)
-- 3. Sin expires_at: fallback a 2 horas desde created_at
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
  v_timeout_minutes INTEGER;
  v_reason TEXT;
BEGIN
  -- Obtener timeout del tenant_settings (usamos el de cada orden)
  FOR v_order IN
    SELECT
      o.online_order_id,
      o.payment_mode,
      o.expires_at,
      o.created_at,
      COALESCE(ts.online_order_timeout_minutes, 30) AS timeout_minutes
    FROM online_orders o
    LEFT JOIN tenant_settings ts ON ts.tenant_id = o.tenant_id
    WHERE o.payment_status = 'PENDING'
      AND o.status IN ('PENDING', 'PROCESSING')
      AND (
        -- Caso 1: tiene expires_at y ya expiró
        (o.expires_at IS NOT NULL AND o.expires_at <= NOW())
        OR
        -- Caso 2: no tiene expires_at pero ya pasó el timeout configurado
        (o.expires_at IS NULL AND o.created_at + (COALESCE(ts.online_order_timeout_minutes, 30) || ' minutes')::INTERVAL <= NOW())
      )
    ORDER BY COALESCE(o.expires_at, o.created_at) ASC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    FOR UPDATE
  LOOP
    v_timeout_minutes := COALESCE(v_order.timeout_minutes, 30);

    v_reason := CASE
      WHEN v_order.payment_mode = 'GATEWAY' THEN
        'Checkout Mercado Pago vencido (' || v_timeout_minutes || ' min)'
      ELSE
        'Pago manual no confirmado (' || v_timeout_minutes || ' min)'
    END;

    -- Liberar reservas de stock
    UPDATE online_order_reservations
    SET
      status = 'RELEASED',
      released_at = NOW(),
      release_reason = v_reason
    WHERE online_order_id = v_order.online_order_id
      AND status = 'ACTIVE';

    -- Cancelar la orden
    UPDATE online_orders
    SET
      status = 'CANCELLED',
      payment_status = 'FAILED',
      expires_at = COALESCE(expires_at, NOW()),
      payment_payload = COALESCE(payment_payload, '{}'::JSONB) || jsonb_build_object(
        'expired_at', NOW(),
        'expiration_reason', v_reason,
        'timeout_minutes', v_timeout_minutes
      ),
      status_history = COALESCE(status_history, '[]'::JSONB) || jsonb_build_object(
        'status', 'CANCELLED',
        'payment_status', 'FAILED',
        'changed_by', 'Sistema (timeout cleanup)',
        'note', v_reason,
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

-- Actualizar fn_online_store_reserved_qty para que tambien ignore órdenes sin expires_at
-- que ya excedieron el timeout configurable
CREATE OR REPLACE FUNCTION fn_online_store_reserved_qty(
  p_store_id UUID,
  p_variant_id UUID
) RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(r.reserved_qty), 0)
  FROM online_order_reservations r
  JOIN online_orders o ON o.online_order_id = r.online_order_id
  LEFT JOIN tenant_settings ts ON ts.tenant_id = o.tenant_id
  WHERE r.store_id = p_store_id
    AND r.variant_id = p_variant_id
    AND r.status = 'ACTIVE'
    AND o.status IN ('PENDING', 'PROCESSING')
    AND o.payment_status = 'PENDING'
    AND (
      -- Tiene expires_at y no ha expirado
      (o.expires_at IS NOT NULL AND o.expires_at > NOW())
      OR
      -- No tiene expires_at y no ha pasado el timeout
      (o.expires_at IS NULL AND o.created_at + (COALESCE(ts.online_order_timeout_minutes, 30) || ' minutes')::INTERVAL > NOW())
    );
$$;

-- Agregar configuracion por defecto en configuracion inicial
DO $$
BEGIN
  UPDATE tenant_settings
  SET online_order_timeout_minutes = 30
  WHERE online_order_timeout_minutes IS NULL;
END $$;
