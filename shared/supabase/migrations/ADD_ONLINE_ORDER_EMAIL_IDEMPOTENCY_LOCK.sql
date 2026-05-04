/*
  Evita correos duplicados para pedidos online.

  El webhook de Mercado Pago puede ejecutarse mas de una vez y el frontend
  tambien puede revalidar el pago. Estas funciones hacen un "claim" atomico
  antes de enviar el correo para que solo una invocacion llegue a Resend.
*/

CREATE OR REPLACE FUNCTION fn_claim_online_order_email_notification(
  p_online_order_id UUID,
  p_notification_key TEXT
)
RETURNS TABLE(
  claimed BOOLEAN,
  notification JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing JSONB;
  v_claim JSONB;
BEGIN
  IF p_online_order_id IS NULL OR NULLIF(BTRIM(p_notification_key), '') IS NULL THEN
    RAISE EXCEPTION 'Pedido y tipo de notificacion requeridos.';
  END IF;

  SELECT COALESCE(payment_payload #> ARRAY['email_notifications', p_notification_key], 'null'::JSONB)
  INTO v_existing
  FROM online_orders
  WHERE online_order_id = p_online_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos el pedido online.';
  END IF;

  IF v_existing IS NOT NULL AND v_existing <> 'null'::JSONB THEN
    IF COALESCE(v_existing->>'status', '') = 'sending'
      AND COALESCE((v_existing->>'claimed_at')::TIMESTAMPTZ, NOW()) < NOW() - INTERVAL '10 minutes'
    THEN
      -- Si una ejecucion murio despues del claim, permitimos reintento pasado el margen.
      NULL;
    ELSE
      RETURN QUERY SELECT FALSE, v_existing;
      RETURN;
    END IF;
  END IF;

  v_claim := jsonb_build_object(
    'status', 'sending',
    'claimed_at', NOW()
  );

  UPDATE online_orders
  SET payment_payload = jsonb_set(
    COALESCE(payment_payload, '{}'::JSONB),
    ARRAY['email_notifications', p_notification_key],
    v_claim,
    TRUE
  )
  WHERE online_order_id = p_online_order_id;

  RETURN QUERY SELECT TRUE, v_claim;
END;
$$;

CREATE OR REPLACE FUNCTION fn_complete_online_order_email_notification(
  p_online_order_id UUID,
  p_notification_key TEXT,
  p_notification JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification JSONB;
BEGIN
  IF p_online_order_id IS NULL OR NULLIF(BTRIM(p_notification_key), '') IS NULL THEN
    RAISE EXCEPTION 'Pedido y tipo de notificacion requeridos.';
  END IF;

  v_notification := COALESCE(p_notification, '{}'::JSONB)
    || jsonb_build_object('status', 'sent');

  UPDATE online_orders
  SET payment_payload = jsonb_set(
    COALESCE(payment_payload, '{}'::JSONB),
    ARRAY['email_notifications', p_notification_key],
    v_notification,
    TRUE
  )
  WHERE online_order_id = p_online_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos el pedido online.';
  END IF;

  RETURN v_notification;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_claim_online_order_email_notification(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_claim_online_order_email_notification(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_complete_online_order_email_notification(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_complete_online_order_email_notification(UUID, TEXT, JSONB) TO service_role;
