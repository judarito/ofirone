/*
  Centraliza correos transaccionales/operativos con deduplicacion fuerte.

  Cualquier proceso puede encolar un correo con fn_enqueue_email_notification().
  La restriccion unica por (channel, dedupe_key) evita sobrecostos por reintentos,
  doble click, webhooks repetidos o ejecuciones desde web + mobile.
*/

CREATE TABLE IF NOT EXISTS notification_outbox (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  event_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  html TEXT,
  text_body TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  entity_type TEXT,
  entity_id UUID,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_outbox_channel_dedupe
  ON notification_outbox(channel, dedupe_key);

CREATE INDEX IF NOT EXISTS ix_notification_outbox_dispatch
  ON notification_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS ix_notification_outbox_tenant_created
  ON notification_outbox(tenant_id, created_at DESC);

ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_outbox_tenant_select ON notification_outbox;
CREATE POLICY notification_outbox_tenant_select
ON notification_outbox FOR SELECT
USING (
  tenant_id IS NULL
  OR tenant_id = get_current_user_tenant_id()
);

GRANT SELECT ON notification_outbox TO authenticated;
GRANT SELECT, INSERT, UPDATE ON notification_outbox TO service_role;

CREATE OR REPLACE FUNCTION fn_normalize_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(p_email, ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      THEN lower(trim(p_email))
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION fn_escape_html(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(replace(replace(replace(replace(coalesce(p_value, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

CREATE OR REPLACE FUNCTION fn_format_cop(p_value NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '$ ' || regexp_replace(to_char(coalesce(p_value, 0), 'FM999G999G999G999G990'), ',', '.', 'g')
$$;

CREATE OR REPLACE FUNCTION fn_email_base_html(
  p_title TEXT,
  p_intro TEXT,
  p_body TEXT DEFAULT '',
  p_action_url TEXT DEFAULT NULL,
  p_action_label TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '<div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#111827;">'
    || '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">'
    || '<div style="padding:24px;background:#eef6ff;">'
    || '<h1 style="margin:0;font-size:24px;color:#111827;">' || fn_escape_html(p_title) || '</h1>'
    || '<p style="margin:10px 0 0;color:#334155;line-height:1.5;">' || fn_escape_html(p_intro) || '</p>'
    || '</div><div style="padding:24px;color:#334155;line-height:1.55;">'
    || coalesce(p_body, '')
    || CASE WHEN NULLIF(trim(coalesce(p_action_url, '')), '') IS NOT NULL THEN
      '<p style="margin-top:24px;"><a href="' || fn_escape_html(p_action_url) || '" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">'
      || fn_escape_html(coalesce(NULLIF(p_action_label, ''), 'Ver detalle')) || '</a></p>'
    ELSE '' END
    || '</div></div></div>'
$$;

CREATE OR REPLACE FUNCTION fn_enqueue_email_notification(
  p_tenant_id UUID,
  p_event_type TEXT,
  p_recipient_email TEXT,
  p_subject TEXT,
  p_html TEXT DEFAULT NULL,
  p_text_body TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_dedupe_key TEXT DEFAULT NULL,
  p_recipient_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := fn_normalize_email(p_recipient_email);
  v_dedupe TEXT;
  v_id UUID;
BEGIN
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  v_dedupe := NULLIF(trim(coalesce(p_dedupe_key, '')), '');
  IF v_dedupe IS NULL THEN
    v_dedupe := concat_ws(':', coalesce(p_event_type, 'event'), coalesce(p_entity_type, 'entity'), coalesce(p_entity_id::TEXT, v_email));
  END IF;

  INSERT INTO notification_outbox (
    tenant_id, event_type, recipient_email, recipient_name, subject, html, text_body,
    payload, entity_type, entity_id, dedupe_key
  )
  VALUES (
    p_tenant_id,
    p_event_type,
    v_email,
    NULLIF(trim(coalesce(p_recipient_name, '')), ''),
    p_subject,
    p_html,
    p_text_body,
    COALESCE(p_payload, '{}'::JSONB),
    p_entity_type,
    p_entity_id,
    v_dedupe
  )
  ON CONFLICT (channel, dedupe_key) DO UPDATE
  SET updated_at = NOW()
  RETURNING notification_id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_enqueue_email_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_enqueue_email_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_normalize_email(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_normalize_email(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION trg_enqueue_online_order_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event TEXT;
  v_title TEXT;
  v_intro TEXT;
  v_subject TEXT;
  v_url TEXT;
  v_body TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.payment_mode = 'MANUAL' AND NEW.payment_status = 'PENDING' THEN
    SELECT COALESCE(NULLIF(alert_email, ''), NULL) INTO v_url
    FROM tenant_settings
    WHERE tenant_id = NEW.tenant_id
      AND email_alerts_enabled IS TRUE;

    PERFORM fn_enqueue_email_notification(
      NEW.tenant_id,
      'ONLINE_ORDER_PENDING',
      v_url,
      'Nuevo pedido online #' || NEW.order_number,
      fn_email_base_html(
        'Nuevo pedido online #' || NEW.order_number,
        'Hay un pedido manual pendiente de validar.',
        '<p><strong>Cliente:</strong> ' || fn_escape_html(coalesce(NEW.customer_name, 'Cliente')) || '</p>'
        || '<p><strong>Total:</strong> ' || fn_format_cop(NEW.total) || '</p>'
      ),
      'Nuevo pedido online #' || NEW.order_number || ' pendiente por ' || coalesce(NEW.customer_name, 'cliente') || '. Total ' || fn_format_cop(NEW.total) || '.',
      jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total),
      'ONLINE_ORDER',
      NEW.online_order_id,
      'online-order-pending:' || NEW.online_order_id::TEXT
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.payment_status, '') IS DISTINCT FROM COALESCE(NEW.payment_status, '') THEN
    IF NEW.payment_status = 'PAID' THEN
      v_event := 'ONLINE_ORDER_APPROVED';
      v_title := 'Tu compra fue confirmada';
      v_intro := 'Recibimos la confirmacion de pago y tu pedido quedo aprobado.';
      v_subject := 'Compra confirmada #' || NEW.order_number;
    ELSIF NEW.payment_status = 'FAILED' THEN
      v_event := 'ONLINE_ORDER_REJECTED';
      v_title := 'Tu compra no pudo ser confirmada';
      v_intro := 'Tu pedido fue rechazado o el pago no pudo ser confirmado.';
      v_subject := 'Compra no confirmada #' || NEW.order_number;
    ELSE
      RETURN NEW;
    END IF;

    v_body := '<p><strong>Pedido:</strong> #' || fn_escape_html(NEW.order_number::TEXT) || '</p>'
      || '<p><strong>Total:</strong> ' || fn_format_cop(NEW.total) || '</p>';

    PERFORM fn_enqueue_email_notification(
      NEW.tenant_id,
      v_event,
      NEW.customer_email,
      v_subject,
      fn_email_base_html(v_title, v_intro, v_body),
      v_title || '. Pedido #' || NEW.order_number || '. Total ' || fn_format_cop(NEW.total) || '.',
      jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total, 'payment_status', NEW.payment_status),
      'ONLINE_ORDER',
      NEW.online_order_id,
      lower(v_event) || ':' || NEW.online_order_id::TEXT
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.online_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_online_order_email_outbox ON online_orders;
    CREATE TRIGGER trg_online_order_email_outbox
    AFTER INSERT OR UPDATE OF payment_status ON online_orders
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_online_order_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_sale_customer_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
BEGIN
  SELECT COALESCE(tp.fiscal_email, tp.email, c.email), COALESCE(tp.legal_name, tp.trade_name, c.full_name)
  INTO v_email, v_name
  FROM sales s
  LEFT JOIN third_parties tp ON tp.third_party_id = s.third_party_id
  LEFT JOIN customers c ON c.customer_id = s.customer_id
  WHERE s.sale_id = NEW.sale_id;

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'SALE_COMPLETED',
    v_email,
    'Comprobante de venta #' || NEW.sale_number,
    fn_email_base_html(
      'Gracias por tu compra',
      'Tu venta fue registrada correctamente.',
      '<p><strong>Venta:</strong> #' || fn_escape_html(NEW.sale_number::TEXT) || '</p><p><strong>Total:</strong> ' || fn_format_cop(NEW.total) || '</p>'
    ),
    'Venta #' || NEW.sale_number || ' registrada por ' || fn_format_cop(NEW.total) || '.',
    jsonb_build_object('sale_number', NEW.sale_number, 'total', NEW.total),
    'SALE',
    NEW.sale_id,
    'sale-completed:' || NEW.sale_id::TEXT,
    v_name
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.sales') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_sale_customer_email_outbox ON sales;
    CREATE TRIGGER trg_sale_customer_email_outbox
    AFTER INSERT ON sales
    FOR EACH ROW
    WHEN (NEW.status = 'COMPLETED')
    EXECUTE FUNCTION trg_enqueue_sale_customer_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_sale_return_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
  v_sale_number TEXT;
BEGIN
  SELECT COALESCE(tp.fiscal_email, tp.email, c.email), COALESCE(tp.legal_name, tp.trade_name, c.full_name), s.sale_number::TEXT
  INTO v_email, v_name, v_sale_number
  FROM sale_returns r
  JOIN sales s ON s.sale_id = r.sale_id
  LEFT JOIN third_parties tp ON tp.third_party_id = s.third_party_id
  LEFT JOIN customers c ON c.customer_id = s.customer_id
  WHERE r.return_id = NEW.return_id;

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'SALE_RETURN_COMPLETED',
    v_email,
    'Devolucion registrada para venta #' || coalesce(v_sale_number, ''),
    fn_email_base_html('Devolucion registrada', 'Procesamos una devolucion sobre tu compra.', '<p><strong>Valor:</strong> ' || fn_format_cop(NEW.refund_total) || '</p>'),
    'Devolucion registrada por ' || fn_format_cop(NEW.refund_total) || '.',
    jsonb_build_object('refund_total', NEW.refund_total, 'sale_number', v_sale_number),
    'SALE_RETURN',
    NEW.return_id,
    'sale-return:' || NEW.return_id::TEXT,
    v_name
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.sale_returns') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_sale_return_email_outbox ON sale_returns;
    CREATE TRIGGER trg_sale_return_email_outbox
    AFTER INSERT ON sale_returns
    FOR EACH ROW
    WHEN (NEW.status = 'COMPLETED')
    EXECUTE FUNCTION trg_enqueue_sale_return_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_layaway_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
  v_event TEXT;
  v_subject TEXT;
BEGIN
  SELECT COALESCE(tp.email, c.email), COALESCE(tp.legal_name, tp.trade_name, c.full_name)
  INTO v_email, v_name
  FROM layaway_contracts l
  LEFT JOIN third_parties tp ON tp.third_party_id = l.customer_id
  LEFT JOIN customers c ON c.customer_id = l.customer_id
  WHERE l.layaway_id = NEW.layaway_id;

  IF TG_OP = 'INSERT' THEN
    v_event := 'LAYAWAY_CREATED';
    v_subject := 'Plan separe creado';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_event := 'LAYAWAY_' || NEW.status;
    v_subject := 'Plan separe ' || lower(NEW.status);
  ELSE
    RETURN NEW;
  END IF;

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    v_event,
    v_email,
    v_subject,
    fn_email_base_html(v_subject, 'Actualizacion de tu plan separe.', '<p><strong>Total:</strong> ' || fn_format_cop(NEW.total) || '</p><p><strong>Saldo:</strong> ' || fn_format_cop(NEW.balance) || '</p>'),
    v_subject || '. Total ' || fn_format_cop(NEW.total) || ', saldo ' || fn_format_cop(NEW.balance) || '.',
    jsonb_build_object('total', NEW.total, 'balance', NEW.balance, 'status', NEW.status),
    'LAYAWAY',
    NEW.layaway_id,
    lower(v_event) || ':' || NEW.layaway_id::TEXT,
    v_name
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_layaway_payment_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
BEGIN
  SELECT COALESCE(tp.email, c.email), COALESCE(tp.legal_name, tp.trade_name, c.full_name)
  INTO v_email, v_name
  FROM layaway_contracts l
  LEFT JOIN third_parties tp ON tp.third_party_id = l.customer_id
  LEFT JOIN customers c ON c.customer_id = l.customer_id
  WHERE l.layaway_id = NEW.layaway_id;

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'LAYAWAY_PAYMENT_RECEIVED',
    v_email,
    'Abono recibido de plan separe',
    fn_email_base_html('Abono recibido', 'Registramos tu abono al plan separe.', '<p><strong>Valor:</strong> ' || fn_format_cop(NEW.amount) || '</p>'),
    'Abono recibido por ' || fn_format_cop(NEW.amount) || '.',
    jsonb_build_object('amount', NEW.amount),
    'LAYAWAY_PAYMENT',
    NEW.layaway_payment_id,
    'layaway-payment:' || NEW.layaway_payment_id::TEXT,
    v_name
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.layaway_contracts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_layaway_email_outbox ON layaway_contracts;
    CREATE TRIGGER trg_layaway_email_outbox
    AFTER INSERT OR UPDATE OF status ON layaway_contracts
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_layaway_email();
  END IF;

  IF to_regclass('public.layaway_payments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_layaway_payment_email_outbox ON layaway_payments;
    CREATE TRIGGER trg_layaway_payment_email_outbox
    AFTER INSERT ON layaway_payments
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_layaway_payment_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_operational_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_enabled BOOLEAN;
  v_should_send BOOLEAN := TRUE;
  v_message TEXT;
BEGIN
  SELECT email_alerts_enabled, alert_email INTO v_enabled, v_email
  FROM tenant_settings
  WHERE tenant_id = NEW.tenant_id;

  IF v_enabled IS DISTINCT FROM TRUE OR fn_normalize_email(v_email) IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.alert_type = 'STOCK' THEN
    SELECT notify_low_stock INTO v_should_send FROM tenant_settings WHERE tenant_id = NEW.tenant_id;
  ELSIF NEW.alert_type = 'EXPIRATION' THEN
    SELECT notify_expiring_products INTO v_should_send FROM tenant_settings WHERE tenant_id = NEW.tenant_id;
  END IF;

  IF v_should_send IS FALSE THEN
    RETURN NEW;
  END IF;

  v_message := COALESCE(NEW.data->>'message', 'Hay una alerta operativa que requiere revision.');

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'SYSTEM_ALERT_' || NEW.alert_type,
    v_email,
    'Alerta ' || NEW.alert_type || ' - ' || NEW.alert_level,
    fn_email_base_html('Alerta ' || NEW.alert_type, v_message, '<pre style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:10px;">' || fn_escape_html(NEW.data::TEXT) || '</pre>'),
    v_message,
    NEW.data,
    'SYSTEM_ALERT',
    NEW.alert_id,
    'system-alert:' || NEW.alert_id::TEXT || ':' || NEW.alert_level
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.system_alerts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_operational_email_outbox ON system_alerts;
    CREATE TRIGGER trg_operational_email_outbox
    AFTER INSERT ON system_alerts
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_operational_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_user_created_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'USER_CREATED',
    NEW.email,
    'Tu acceso a OfirOne fue creado',
    fn_email_base_html('Bienvenido a OfirOne', 'Tu usuario fue creado. Ingresa con el correo registrado y la clave que te compartio el administrador.'),
    'Tu usuario de OfirOne fue creado.',
    jsonb_build_object('user_id', NEW.user_id, 'full_name', NEW.full_name),
    'USER',
    NEW.user_id,
    'user-created:' || NEW.user_id::TEXT,
    NEW.full_name
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_user_created_email_outbox ON users;
    CREATE TRIGGER trg_user_created_email_outbox
    AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_user_created_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_bulk_import_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
BEGIN
  IF NEW.status NOT IN ('completed', 'completed_with_errors', 'failed')
     OR (TG_OP = 'UPDATE' AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  SELECT email, full_name INTO v_email, v_name
  FROM users
  WHERE user_id = NEW.uploaded_by;

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'BULK_IMPORT_' || upper(NEW.status),
    v_email,
    'Importacion finalizada: ' || NEW.file_name,
    fn_email_base_html('Importacion finalizada', 'El proceso de importacion cambio a estado ' || NEW.status || '.', '<p><strong>Procesados:</strong> ' || coalesce(NEW.processed_count, 0) || '</p><p><strong>Errores:</strong> ' || coalesce(NEW.error_count, 0) || '</p>'),
    'Importacion ' || NEW.file_name || ' finalizada con estado ' || NEW.status || '.',
    jsonb_build_object('status', NEW.status, 'file_name', NEW.file_name, 'processed_count', NEW.processed_count, 'error_count', NEW.error_count),
    'BULK_IMPORT',
    NEW.import_id,
    'bulk-import:' || NEW.import_id::TEXT || ':' || NEW.status,
    v_name
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.bulk_imports') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_bulk_import_email_outbox ON bulk_imports;
    CREATE TRIGGER trg_bulk_import_email_outbox
    AFTER INSERT OR UPDATE OF status ON bulk_imports
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_bulk_import_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_credit_movement_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
  v_subject TEXT;
BEGIN
  SELECT COALESCE(tp.email, c.email), COALESCE(tp.legal_name, tp.trade_name, c.full_name)
  INTO v_email, v_name
  FROM customer_credit_accounts a
  LEFT JOIN third_parties tp ON tp.third_party_id = a.customer_id
  LEFT JOIN customers c ON c.customer_id = a.customer_id
  WHERE a.credit_account_id = NEW.credit_account_id;

  v_subject := CASE
    WHEN NEW.source = 'PAYMENT' OR NEW.amount < 0 THEN 'Pago recibido en cartera'
    ELSE 'Movimiento de cartera registrado'
  END;

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'CUSTOMER_CREDIT_' || upper(coalesce(NEW.source, 'MOVEMENT')),
    v_email,
    v_subject,
    fn_email_base_html(v_subject, 'Registramos un movimiento en tu cuenta de credito.', '<p><strong>Valor:</strong> ' || fn_format_cop(abs(NEW.amount)) || '</p>'),
    v_subject || ' por ' || fn_format_cop(abs(NEW.amount)) || '.',
    jsonb_build_object('source', NEW.source, 'amount', NEW.amount),
    'CUSTOMER_CREDIT_MOVEMENT',
    NEW.movement_id,
    'credit-movement:' || NEW.movement_id::TEXT,
    v_name
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.customer_credit_movements') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_credit_movement_email_outbox ON customer_credit_movements;
    CREATE TRIGGER trg_credit_movement_email_outbox
    AFTER INSERT ON customer_credit_movements
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_credit_movement_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_supplier_payable_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_enabled BOOLEAN;
  v_subject TEXT;
BEGIN
  SELECT email_alerts_enabled, alert_email INTO v_enabled, v_email
  FROM tenant_settings
  WHERE tenant_id = NEW.tenant_id;

  IF v_enabled IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'supplier_payable_payments' THEN
    v_subject := 'Pago a proveedor registrado';
    PERFORM fn_enqueue_email_notification(
      NEW.tenant_id,
      'SUPPLIER_PAYMENT_REGISTERED',
      v_email,
      v_subject,
      fn_email_base_html(v_subject, 'Se registro un pago a proveedor.', '<p><strong>Valor:</strong> ' || fn_format_cop(NEW.amount) || '</p>'),
      v_subject || ' por ' || fn_format_cop(NEW.amount) || '.',
      jsonb_build_object('amount', NEW.amount, 'payable_id', NEW.payable_id),
      'SUPPLIER_PAYABLE_PAYMENT',
      NEW.payable_payment_id,
      'supplier-payable-payment:' || NEW.payable_payment_id::TEXT
    );
  ELSE
    v_subject := 'Cuenta por pagar creada';
    PERFORM fn_enqueue_email_notification(
      NEW.tenant_id,
      'SUPPLIER_PAYABLE_CREATED',
      v_email,
      v_subject,
      fn_email_base_html(v_subject, 'Se creo una cuenta por pagar.', '<p><strong>Total:</strong> ' || fn_format_cop(NEW.total_amount) || '</p><p><strong>Vence:</strong> ' || fn_escape_html(coalesce(NEW.due_date::TEXT, 'Sin fecha')) || '</p>'),
      v_subject || ' por ' || fn_format_cop(NEW.total_amount) || '.',
      jsonb_build_object('total_amount', NEW.total_amount, 'due_date', NEW.due_date),
      'SUPPLIER_PAYABLE',
      NEW.payable_id,
      'supplier-payable-created:' || NEW.payable_id::TEXT
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.supplier_payables') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_supplier_payable_email_outbox ON supplier_payables;
    CREATE TRIGGER trg_supplier_payable_email_outbox
    AFTER INSERT ON supplier_payables
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_supplier_payable_email();
  END IF;

  IF to_regclass('public.supplier_payable_payments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_supplier_payable_payment_email_outbox ON supplier_payable_payments;
    CREATE TRIGGER trg_supplier_payable_payment_email_outbox
    AFTER INSERT ON supplier_payable_payments
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_supplier_payable_email();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION trg_enqueue_subscription_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_enabled BOOLEAN;
  v_subject TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT email_alerts_enabled, alert_email INTO v_enabled, v_email
  FROM tenant_settings
  WHERE tenant_id = NEW.tenant_id;

  IF v_enabled IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  v_subject := 'Estado de suscripcion: ' || NEW.status;

  PERFORM fn_enqueue_email_notification(
    NEW.tenant_id,
    'TENANT_SUBSCRIPTION_' || upper(NEW.status),
    v_email,
    v_subject,
    fn_email_base_html(v_subject, 'La suscripcion del tenant cambio de estado.', '<p><strong>Estado:</strong> ' || fn_escape_html(NEW.status) || '</p>'),
    v_subject || '.',
    jsonb_build_object('status', NEW.status, 'current_period_end', NEW.current_period_end),
    'TENANT_SUBSCRIPTION',
    NEW.subscription_id,
    'tenant-subscription:' || NEW.subscription_id::TEXT || ':' || NEW.status
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.tenant_subscriptions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_subscription_email_outbox ON tenant_subscriptions;
    CREATE TRIGGER trg_subscription_email_outbox
    AFTER INSERT OR UPDATE OF status ON tenant_subscriptions
    FOR EACH ROW EXECUTE FUNCTION trg_enqueue_subscription_email();
  END IF;
END
$$;
