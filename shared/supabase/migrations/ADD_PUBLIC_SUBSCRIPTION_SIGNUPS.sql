-- ============================================================
-- Alta publica SaaS: solicitudes, checkout y aprovisionamiento
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public_subscription_signups (
  signup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'PROVISIONING', 'PROVISIONED', 'FAILED', 'CANCELLED')),
  plan_id UUID NOT NULL REFERENCES billing_plans(plan_id),
  plan_price_id UUID NOT NULL REFERENCES billing_plan_prices(plan_price_id),
  plan_code TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  billing_interval TEXT NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'COP',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  setup_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  business_name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  admin_full_name TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  tenant_id UUID REFERENCES tenants(tenant_id),
  user_id UUID,
  auth_user_id UUID,
  mercado_pago_preference_id TEXT,
  mercado_pago_payment_id TEXT,
  mercado_pago_status TEXT,
  mercado_pago_status_detail TEXT,
  payment_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  provision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  paid_at TIMESTAMPTZ,
  provisioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_public_subscription_signups_status
  ON public_subscription_signups(status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_public_subscription_signups_email
  ON public_subscription_signups(lower(admin_email), created_at DESC);

CREATE INDEX IF NOT EXISTS ix_public_subscription_signups_tax_id
  ON public_subscription_signups(regexp_replace(COALESCE(tax_id, ''), '[^A-Za-z0-9]+', '', 'g'), created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_public_subscription_signups_preference
  ON public_subscription_signups(mercado_pago_preference_id)
  WHERE mercado_pago_preference_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_public_subscription_signups_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_public_subscription_signups_touch ON public_subscription_signups;
CREATE TRIGGER trg_public_subscription_signups_touch
BEFORE UPDATE ON public_subscription_signups
FOR EACH ROW EXECUTE FUNCTION trg_public_subscription_signups_updated_at();

ALTER TABLE public_subscription_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_subscription_signups_service_role_all ON public_subscription_signups;
CREATE POLICY public_subscription_signups_service_role_all
ON public_subscription_signups
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON public_subscription_signups TO service_role;

CREATE TABLE IF NOT EXISTS public_subscription_signup_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id UUID NOT NULL REFERENCES public_subscription_signups(signup_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_source TEXT NOT NULL DEFAULT 'system',
  event_status TEXT NOT NULL DEFAULT 'info'
    CHECK (event_status IN ('info', 'success', 'warning', 'error')),
  event_key TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_public_subscription_signup_events_signup
  ON public_subscription_signup_events(signup_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_public_subscription_signup_events_key
  ON public_subscription_signup_events(signup_id, event_key)
  WHERE event_key IS NOT NULL;

ALTER TABLE public_subscription_signup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_subscription_signup_events_service_role_all ON public_subscription_signup_events;
CREATE POLICY public_subscription_signup_events_service_role_all
ON public_subscription_signup_events
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON public_subscription_signup_events TO service_role;

CREATE OR REPLACE FUNCTION fn_log_public_subscription_signup_event(
  p_signup_id UUID,
  p_event_type TEXT,
  p_event_source TEXT DEFAULT 'system',
  p_event_status TEXT DEFAULT 'info',
  p_message TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_event_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public_subscription_signup_events%ROWTYPE;
BEGIN
  IF p_signup_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'signup_id requerido.');
  END IF;

  INSERT INTO public_subscription_signup_events (
    signup_id,
    event_type,
    event_source,
    event_status,
    event_key,
    message,
    payload
  ) VALUES (
    p_signup_id,
    NULLIF(trim(COALESCE(p_event_type, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_event_source, '')), ''), 'system'),
    CASE
      WHEN p_event_status IN ('info', 'success', 'warning', 'error') THEN p_event_status
      ELSE 'info'
    END,
    NULLIF(trim(COALESCE(p_event_key, '')), ''),
    NULLIF(trim(COALESCE(p_message, '')), ''),
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (signup_id, event_key) WHERE event_key IS NOT NULL
  DO UPDATE SET
    event_type = EXCLUDED.event_type,
    event_source = EXCLUDED.event_source,
    event_status = EXCLUDED.event_status,
    message = EXCLUDED.message,
    payload = public_subscription_signup_events.payload || EXCLUDED.payload
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('success', true, 'event', to_jsonb(v_event));
END;
$$;

CREATE OR REPLACE FUNCTION fn_list_public_subscription_plans()
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'plan_id', p.plan_id,
      'code', p.code,
      'name', p.name,
      'description', p.description,
      'sort_order', p.sort_order,
      'prices', COALESCE(prices.items, '[]'::jsonb),
      'features', COALESCE(features.items, '[]'::jsonb),
      'limits', COALESCE(limits.items, '[]'::jsonb)
    )
    ORDER BY p.sort_order, p.name
  ), '[]'::jsonb)
  FROM billing_plans p
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'plan_price_id', pp.plan_price_id,
      'currency_code', pp.currency_code,
      'billing_interval', pp.billing_interval,
      'amount', pp.amount,
      'setup_fee', pp.setup_fee,
      'trial_days', pp.trial_days,
      'grace_days', pp.grace_days
    ) ORDER BY pp.billing_interval) AS items
    FROM billing_plan_prices pp
    WHERE pp.plan_id = p.plan_id
      AND pp.is_active = TRUE
      AND pp.amount > 0
  ) prices ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'feature_code', pf.feature_code,
      'feature_name', pf.feature_name,
      'is_enabled', pf.is_enabled
    ) ORDER BY pf.feature_code) AS items
    FROM billing_plan_features pf
    WHERE pf.plan_id = p.plan_id
      AND pf.is_enabled = TRUE
  ) features ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'limit_code', pl.limit_code,
      'limit_name', pl.limit_name,
      'limit_value', pl.limit_value,
      'limit_unit', pl.limit_unit
    ) ORDER BY pl.limit_code) AS items
    FROM billing_plan_limits pl
    WHERE pl.plan_id = p.plan_id
  ) limits ON TRUE
  WHERE p.is_public = TRUE
    AND p.is_active = TRUE
    AND COALESCE(jsonb_array_length(prices.items), 0) > 0;
$$;

CREATE OR REPLACE FUNCTION fn_create_public_subscription_signup(
  p_plan_price_id UUID,
  p_business_name TEXT,
  p_admin_full_name TEXT,
  p_admin_email TEXT,
  p_phone TEXT DEFAULT NULL,
  p_legal_name TEXT DEFAULT NULL,
  p_tax_id TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price RECORD;
  v_signup public_subscription_signups%ROWTYPE;
  v_email TEXT;
  v_tax_id TEXT;
BEGIN
  v_email := lower(trim(COALESCE(p_admin_email, '')));
  v_tax_id := upper(regexp_replace(trim(COALESCE(p_tax_id, '')), '[^A-Za-z0-9]+', '', 'g'));

  IF p_plan_price_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_REQUIRED', 'message', 'Selecciona un plan.');
  END IF;
  IF NULLIF(trim(COALESCE(p_business_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BUSINESS_REQUIRED', 'message', 'El nombre del negocio es requerido.');
  END IF;
  IF NULLIF(trim(COALESCE(p_admin_full_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ADMIN_REQUIRED', 'message', 'El nombre del responsable es requerido.');
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_INVALID', 'message', 'El email no es valido.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users u
    WHERE lower(trim(u.email)) = v_email
      AND COALESCE(u.is_active, TRUE) = TRUE
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'EMAIL_ALREADY_USED',
      'message', 'Este email ya esta asociado a una cuenta de OfirOne. Usa otro email administrador o inicia sesion con la cuenta existente.'
    );
  END IF;

  IF v_tax_id <> '' AND EXISTS (
    SELECT 1
    FROM tenants t
    WHERE upper(regexp_replace(COALESCE(t.tax_id, ''), '[^A-Za-z0-9]+', '', 'g')) = v_tax_id
      AND COALESCE(t.is_active, TRUE) = TRUE
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TAX_ID_ALREADY_USED',
      'message', 'Este NIT o identificacion ya esta asociado a una empresa en OfirOne.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public_subscription_signups s
    WHERE lower(trim(s.admin_email)) = v_email
      AND s.status IN ('PENDING_PAYMENT', 'PAID', 'PROVISIONING', 'PROVISIONED')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'EMAIL_SIGNUP_EXISTS',
      'message', 'Ya existe una solicitud de suscripcion activa para este email. Revisa el estado de esa solicitud antes de crear otra.'
    );
  END IF;

  IF v_tax_id <> '' AND EXISTS (
    SELECT 1
    FROM public_subscription_signups s
    WHERE upper(regexp_replace(COALESCE(s.tax_id, ''), '[^A-Za-z0-9]+', '', 'g')) = v_tax_id
      AND s.status IN ('PENDING_PAYMENT', 'PAID', 'PROVISIONING', 'PROVISIONED')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TAX_ID_SIGNUP_EXISTS',
      'message', 'Ya existe una solicitud de suscripcion activa para este NIT o identificacion.'
    );
  END IF;

  SELECT
    pp.plan_price_id,
    pp.plan_id,
    pp.currency_code,
    pp.billing_interval,
    pp.amount,
    pp.setup_fee,
    bp.code AS plan_code,
    bp.name AS plan_name
  INTO v_price
  FROM billing_plan_prices pp
  JOIN billing_plans bp ON bp.plan_id = pp.plan_id
  WHERE pp.plan_price_id = p_plan_price_id
    AND pp.is_active = TRUE
    AND bp.is_public = TRUE
    AND bp.is_active = TRUE
    AND pp.amount > 0
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_NOT_AVAILABLE', 'message', 'El plan seleccionado no esta disponible.');
  END IF;

  INSERT INTO public_subscription_signups (
    plan_id,
    plan_price_id,
    plan_code,
    plan_name,
    billing_interval,
    currency_code,
    amount,
    setup_fee,
    total,
    business_name,
    legal_name,
    tax_id,
    admin_full_name,
    admin_email,
    phone,
    address
  ) VALUES (
    v_price.plan_id,
    v_price.plan_price_id,
    v_price.plan_code,
    v_price.plan_name,
    v_price.billing_interval,
    v_price.currency_code,
    v_price.amount,
    v_price.setup_fee,
    v_price.amount + v_price.setup_fee,
    trim(p_business_name),
    NULLIF(trim(COALESCE(p_legal_name, '')), ''),
    NULLIF(trim(COALESCE(p_tax_id, '')), ''),
    trim(p_admin_full_name),
    v_email,
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    NULLIF(trim(COALESCE(p_address, '')), '')
  )
  RETURNING * INTO v_signup;

  RETURN jsonb_build_object(
    'success', true,
    'signup', to_jsonb(v_signup)
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_attach_subscription_signup_preference(
  p_signup_id UUID,
  p_preference_id TEXT,
  p_payment_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signup_id UUID;
BEGIN
  UPDATE public_subscription_signups
  SET
    mercado_pago_preference_id = NULLIF(trim(COALESCE(p_preference_id, '')), ''),
    payment_payload = COALESCE(payment_payload, '{}'::jsonb) || COALESCE(p_payment_payload, '{}'::jsonb),
    status = CASE WHEN status = 'PENDING_PAYMENT' THEN status ELSE 'PENDING_PAYMENT' END
  WHERE signup_id = p_signup_id
    AND status IN ('PENDING_PAYMENT', 'FAILED')
  RETURNING signup_id INTO v_signup_id;

  IF v_signup_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'No se pudo asociar la preferencia a la solicitud.');
  END IF;

  RETURN jsonb_build_object('success', true, 'signup_id', v_signup_id);
END;
$$;

CREATE OR REPLACE FUNCTION fn_get_public_subscription_signup_status(
  p_signup_id UUID
) RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'signup_id', s.signup_id,
      'status', s.status,
      'plan_name', s.plan_name,
      'plan_code', s.plan_code,
      'billing_interval', s.billing_interval,
      'currency_code', s.currency_code,
      'total', s.total,
      'business_name', s.business_name,
      'admin_email', s.admin_email,
      'tenant_id', s.tenant_id,
      'paid_at', s.paid_at,
      'provisioned_at', s.provisioned_at,
      'error_message', s.error_message,
      'payment_url', COALESCE(s.payment_payload->>'init_point', s.payment_payload->>'sandbox_init_point', s.payment_payload->>'payment_url'),
      'created_at', s.created_at
    )
    FROM public_subscription_signups s
    WHERE s.signup_id = p_signup_id
  ), jsonb_build_object('error', 'Solicitud no encontrada.'));
$$;

CREATE OR REPLACE FUNCTION fn_mark_subscription_signup_payment(
  p_signup_id UUID,
  p_payment_id TEXT,
  p_gateway_status TEXT,
  p_status_detail TEXT DEFAULT NULL,
  p_payment_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT := lower(trim(COALESCE(p_gateway_status, 'pending')));
  v_next_status TEXT;
  v_signup public_subscription_signups%ROWTYPE;
BEGIN
  v_next_status := CASE
    WHEN v_status = 'approved' THEN 'PAID'
    WHEN v_status IN ('rejected', 'cancelled', 'refunded', 'charged_back') THEN 'FAILED'
    ELSE 'PENDING_PAYMENT'
  END;

  UPDATE public_subscription_signups
  SET
    status = CASE
      WHEN status = 'PROVISIONED' THEN status
      ELSE v_next_status
    END,
    mercado_pago_payment_id = NULLIF(trim(COALESCE(p_payment_id, '')), ''),
    mercado_pago_status = NULLIF(trim(COALESCE(p_gateway_status, '')), ''),
    mercado_pago_status_detail = NULLIF(trim(COALESCE(p_status_detail, '')), ''),
    payment_payload = COALESCE(payment_payload, '{}'::jsonb) || COALESCE(p_payment_payload, '{}'::jsonb),
    paid_at = CASE WHEN v_next_status = 'PAID' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
    error_message = CASE WHEN v_next_status = 'FAILED' THEN COALESCE(p_status_detail, p_gateway_status) ELSE NULL END
  WHERE signup_id = p_signup_id
  RETURNING * INTO v_signup;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Solicitud no encontrada.');
  END IF;

  RETURN jsonb_build_object('success', true, 'signup', to_jsonb(v_signup));
END;
$$;

CREATE OR REPLACE FUNCTION fn_provision_public_subscription_signup(
  p_signup_id UUID,
  p_auth_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signup public_subscription_signups%ROWTYPE;
  v_result JSONB;
  v_tenant_id UUID;
  v_user_id UUID;
  v_subscription_id UUID;
  v_period_start TIMESTAMPTZ := NOW();
  v_period_end TIMESTAMPTZ;
BEGIN
  SELECT *
  INTO v_signup
  FROM public_subscription_signups
  WHERE signup_id = p_signup_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Solicitud no encontrada.');
  END IF;

  IF v_signup.status = 'PROVISIONED' THEN
    RETURN jsonb_build_object('success', true, 'already_provisioned', true, 'tenant_id', v_signup.tenant_id, 'user_id', v_signup.user_id);
  END IF;

  IF v_signup.status <> 'PAID' THEN
    RETURN jsonb_build_object('success', false, 'message', 'La solicitud no esta pagada.');
  END IF;

  UPDATE public_subscription_signups
  SET status = 'PROVISIONING', error_message = NULL
  WHERE signup_id = p_signup_id;

  v_result := fn_create_tenant(
    jsonb_build_object(
      'name', v_signup.business_name,
      'legal_name', COALESCE(v_signup.legal_name, v_signup.business_name),
      'tax_id', v_signup.tax_id,
      'email', v_signup.admin_email,
      'phone', v_signup.phone,
      'address', v_signup.address,
      'invoice_prefix', COALESCE(NULLIF(upper(substr(regexp_replace(v_signup.business_name, '[^A-Za-z0-9]+', '', 'g'), 1, 4)), ''), 'FAC'),
      'invoice_start_number', 1,
      'is_active', true
    ),
    jsonb_build_object(
      'user_id', p_auth_user_id,
      'email', v_signup.admin_email,
      'full_name', v_signup.admin_full_name
    )
  );

  IF COALESCE((v_result->>'success')::BOOLEAN, FALSE) IS DISTINCT FROM TRUE THEN
    UPDATE public_subscription_signups
    SET status = 'FAILED',
        error_message = COALESCE(v_result->>'message', v_result->>'error', 'No se pudo crear el tenant.'),
        provision_payload = v_result
    WHERE signup_id = p_signup_id;
    RETURN jsonb_build_object('success', false, 'message', COALESCE(v_result->>'message', 'No se pudo crear el tenant.'), 'result', v_result);
  END IF;

  v_tenant_id := (v_result->>'tenant_id')::UUID;
  v_user_id := (v_result->>'user_id')::UUID;

  v_period_end := CASE v_signup.billing_interval
    WHEN 'annual' THEN v_period_start + INTERVAL '1 year'
    WHEN 'semiannual' THEN v_period_start + INTERVAL '6 months'
    WHEN 'quarterly' THEN v_period_start + INTERVAL '3 months'
    ELSE v_period_start + INTERVAL '1 month'
  END;

  INSERT INTO tenant_subscriptions (
    tenant_id,
    plan_id,
    plan_price_id,
    status,
    start_at,
    current_period_start,
    current_period_end,
    renewal_mode,
    payment_provider,
    provider_customer_id,
    provider_subscription_id,
    metadata
  ) VALUES (
    v_tenant_id,
    v_signup.plan_id,
    v_signup.plan_price_id,
    'active',
    v_period_start,
    v_period_start,
    v_period_end,
    'manual',
    'MERCADO_PAGO',
    v_signup.admin_email,
    v_signup.mercado_pago_payment_id,
    jsonb_build_object('signup_id', v_signup.signup_id, 'source', 'public_signup')
  )
  RETURNING subscription_id INTO v_subscription_id;

  INSERT INTO tenant_subscription_periods (
    subscription_id,
    tenant_id,
    period_number,
    period_start,
    period_end,
    status
  ) VALUES (
    v_subscription_id,
    v_tenant_id,
    1,
    v_period_start,
    v_period_end,
    'paid'
  );

  INSERT INTO tenant_subscription_events (
    subscription_id,
    tenant_id,
    event_type,
    event_source,
    payload
  ) VALUES (
    v_subscription_id,
    v_tenant_id,
    'public_signup_provisioned',
    'payment_webhook',
    jsonb_build_object('signup_id', v_signup.signup_id, 'payment_id', v_signup.mercado_pago_payment_id)
  );

  UPDATE public_subscription_signups
  SET
    status = 'PROVISIONED',
    tenant_id = v_tenant_id,
    user_id = v_user_id,
    auth_user_id = p_auth_user_id,
    provisioned_at = NOW(),
    provision_payload = v_result,
    error_message = NULL
  WHERE signup_id = p_signup_id;

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', v_tenant_id,
    'user_id', v_user_id,
    'auth_user_id', p_auth_user_id,
    'subscription_id', v_subscription_id,
    'period_end', v_period_end
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public_subscription_signups
  SET status = 'FAILED',
      error_message = SQLERRM
  WHERE signup_id = p_signup_id;
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_list_public_subscription_plans() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_create_public_subscription_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_attach_subscription_signup_preference(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_public_subscription_signup_status(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_mark_subscription_signup_payment(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fn_provision_public_subscription_signup(UUID, UUID) TO service_role;

DROP FUNCTION IF EXISTS fn_superadmin_list_public_subscription_signups(INTEGER);

CREATE OR REPLACE FUNCTION fn_superadmin_list_public_subscription_signups(
  p_limit INTEGER DEFAULT 100
) RETURNS TABLE (
  signup_id UUID,
  status TEXT,
  plan_name TEXT,
  plan_code TEXT,
  billing_interval TEXT,
  currency_code TEXT,
  total NUMERIC,
  business_name TEXT,
  legal_name TEXT,
  tax_id TEXT,
  admin_full_name TEXT,
  admin_email TEXT,
  phone TEXT,
  tenant_id UUID,
  user_id UUID,
  auth_user_id UUID,
  mercado_pago_preference_id TEXT,
  mercado_pago_payment_id TEXT,
  mercado_pago_status TEXT,
  mercado_pago_status_detail TEXT,
  payment_url TEXT,
  paid_at TIMESTAMPTZ,
  provisioned_at TIMESTAMPTZ,
  error_message TEXT,
  events_count BIGINT,
  last_event_type TEXT,
  last_event_status TEXT,
  last_event_message TEXT,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT fn_is_super_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  RETURN QUERY
  SELECT
    s.signup_id,
    s.status,
    s.plan_name,
    s.plan_code,
    s.billing_interval,
    s.currency_code::TEXT,
    s.total,
    s.business_name,
    s.legal_name,
    s.tax_id,
    s.admin_full_name,
    s.admin_email,
    s.phone,
    s.tenant_id,
    s.user_id,
    s.auth_user_id,
    s.mercado_pago_preference_id,
    s.mercado_pago_payment_id,
    s.mercado_pago_status,
    s.mercado_pago_status_detail,
    COALESCE(s.payment_payload->>'init_point', s.payment_payload->>'sandbox_init_point', s.payment_payload->>'payment_url') AS payment_url,
    s.paid_at,
    s.provisioned_at,
    s.error_message,
    COALESCE(events.events_count, 0) AS events_count,
    last_event.event_type AS last_event_type,
    last_event.event_status AS last_event_status,
    last_event.message AS last_event_message,
    last_event.created_at AS last_event_at,
    s.created_at,
    s.updated_at
  FROM public_subscription_signups s
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS events_count
    FROM public_subscription_signup_events e
    WHERE e.signup_id = s.signup_id
  ) events ON TRUE
  LEFT JOIN LATERAL (
    SELECT e.event_type, e.event_status, e.message, e.created_at
    FROM public_subscription_signup_events e
    WHERE e.signup_id = s.signup_id
    ORDER BY e.created_at DESC
    LIMIT 1
  ) last_event ON TRUE
  ORDER BY s.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$$;

DROP FUNCTION IF EXISTS fn_superadmin_list_public_subscription_signup_events(UUID);

CREATE OR REPLACE FUNCTION fn_superadmin_list_public_subscription_signup_events(
  p_signup_id UUID
) RETURNS TABLE (
  event_id UUID,
  signup_id UUID,
  event_type TEXT,
  event_source TEXT,
  event_status TEXT,
  event_key TEXT,
  message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT fn_is_super_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  RETURN QUERY
  SELECT
    e.event_id,
    e.signup_id,
    e.event_type,
    e.event_source,
    e.event_status,
    e.event_key,
    e.message,
    e.payload,
    e.created_at
  FROM public_subscription_signup_events e
  WHERE e.signup_id = p_signup_id
  ORDER BY e.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_superadmin_list_public_subscription_signups(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_superadmin_list_public_subscription_signup_events(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_log_public_subscription_signup_event(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
