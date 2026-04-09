-- ===================================================================
-- Migration: Accounting competitive core (retentions, closing, automation)
-- Date: 2026-03-11
-- Scope:
--   1) Retentions operational layer (CO)
--   2) Monthly close + period locking
--   3) Automation rules + exception queue
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE 'Starting accounting competitive core migration';
END $$;

-- ===================================================================
-- 1) Retentions configuration
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_withholding_configs (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'PURCHASES' CHECK (applies_to IN ('SALES', 'PURCHASES', 'BOTH')),
  rate NUMERIC(9,4) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
  base_threshold NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (base_threshold >= 0),
  account_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_withholding_configs_tenant
  ON accounting_withholding_configs (tenant_id, is_active);

-- ===================================================================
-- 2) Period close (monthly)
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_period_closures (
  closure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  period_year INT NOT NULL CHECK (period_year BETWEEN 2000 AND 2200),
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED')),
  notes TEXT,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(user_id),
  reopened_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_accounting_period_closures_tenant_period
  ON accounting_period_closures (tenant_id, period_year DESC, period_month DESC);

-- ===================================================================
-- 3) Accounting automation rules + exceptions
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_posting_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  source_module TEXT NOT NULL,
  event_type TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  debit_account_code TEXT NOT NULL,
  credit_account_code TEXT NOT NULL,
  description_template TEXT,
  auto_post BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_module, event_type, rule_name)
);

CREATE INDEX IF NOT EXISTS idx_accounting_posting_rules_lookup
  ON accounting_posting_rules (tenant_id, source_module, event_type, is_active, priority);

CREATE TABLE IF NOT EXISTS accounting_automation_exceptions (
  exception_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  queue_event_id UUID REFERENCES accounting_event_queue(event_id) ON DELETE SET NULL,
  source_module TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_id UUID,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_automation_exceptions_tenant
  ON accounting_automation_exceptions (tenant_id, status, created_at DESC);

-- ===================================================================
-- 4) RLS policies
-- ===================================================================
ALTER TABLE accounting_withholding_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_period_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_posting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_automation_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_withholding_configs_select_policy ON accounting_withholding_configs;
DROP POLICY IF EXISTS accounting_withholding_configs_insert_policy ON accounting_withholding_configs;
DROP POLICY IF EXISTS accounting_withholding_configs_update_policy ON accounting_withholding_configs;

CREATE POLICY accounting_withholding_configs_select_policy ON accounting_withholding_configs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_withholding_configs.tenant_id
  )
);

CREATE POLICY accounting_withholding_configs_insert_policy ON accounting_withholding_configs
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_withholding_configs.tenant_id
  )
);

CREATE POLICY accounting_withholding_configs_update_policy ON accounting_withholding_configs
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_withholding_configs.tenant_id
  )
);

DROP POLICY IF EXISTS accounting_period_closures_select_policy ON accounting_period_closures;
DROP POLICY IF EXISTS accounting_period_closures_insert_policy ON accounting_period_closures;
DROP POLICY IF EXISTS accounting_period_closures_update_policy ON accounting_period_closures;

CREATE POLICY accounting_period_closures_select_policy ON accounting_period_closures
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_period_closures.tenant_id
  )
);

CREATE POLICY accounting_period_closures_insert_policy ON accounting_period_closures
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_period_closures.tenant_id
  )
);

CREATE POLICY accounting_period_closures_update_policy ON accounting_period_closures
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_period_closures.tenant_id
  )
);

DROP POLICY IF EXISTS accounting_posting_rules_select_policy ON accounting_posting_rules;
DROP POLICY IF EXISTS accounting_posting_rules_insert_policy ON accounting_posting_rules;
DROP POLICY IF EXISTS accounting_posting_rules_update_policy ON accounting_posting_rules;

CREATE POLICY accounting_posting_rules_select_policy ON accounting_posting_rules
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_posting_rules.tenant_id
  )
);

CREATE POLICY accounting_posting_rules_insert_policy ON accounting_posting_rules
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_posting_rules.tenant_id
  )
);

CREATE POLICY accounting_posting_rules_update_policy ON accounting_posting_rules
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_posting_rules.tenant_id
  )
);

DROP POLICY IF EXISTS accounting_automation_exceptions_select_policy ON accounting_automation_exceptions;
DROP POLICY IF EXISTS accounting_automation_exceptions_insert_policy ON accounting_automation_exceptions;
DROP POLICY IF EXISTS accounting_automation_exceptions_update_policy ON accounting_automation_exceptions;

CREATE POLICY accounting_automation_exceptions_select_policy ON accounting_automation_exceptions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_automation_exceptions.tenant_id
  )
);

CREATE POLICY accounting_automation_exceptions_insert_policy ON accounting_automation_exceptions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_automation_exceptions.tenant_id
  )
);

CREATE POLICY accounting_automation_exceptions_update_policy ON accounting_automation_exceptions
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_automation_exceptions.tenant_id
  )
);

-- ===================================================================
-- 5) Seed defaults by tenant
-- ===================================================================
INSERT INTO accounting_withholding_configs (
  tenant_id,
  code,
  name,
  applies_to,
  rate,
  base_threshold,
  account_code,
  is_active
)
SELECT
  t.tenant_id,
  x.code,
  x.name,
  x.applies_to,
  x.rate,
  x.base_threshold,
  x.account_code,
  TRUE
FROM tenants t
CROSS JOIN (
  VALUES
    ('RETEFUENTE_PURCHASES', 'ReteFuente compras', 'PURCHASES', 2.5000::NUMERIC, 0::NUMERIC, '236540'),
    ('RETEIVA_PURCHASES', 'ReteIVA compras', 'PURCHASES', 15.0000::NUMERIC, 0::NUMERIC, '236540'),
    ('RETEICA_SALES', 'ReteICA ventas', 'SALES', 0.9660::NUMERIC, 0::NUMERIC, '236540')
) AS x(code, name, applies_to, rate, base_threshold, account_code)
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO accounting_posting_rules (
  tenant_id,
  source_module,
  event_type,
  rule_name,
  debit_account_code,
  credit_account_code,
  description_template,
  auto_post,
  priority,
  is_active
)
SELECT
  t.tenant_id,
  x.source_module,
  x.event_type,
  x.rule_name,
  x.debit_account_code,
  x.credit_account_code,
  x.description_template,
  TRUE,
  100,
  TRUE
FROM tenants t
CROSS JOIN (
  VALUES
    ('POS', 'SALE_CREATED', 'Regla base venta POS', '110505', '413595', 'Asiento automatico venta POS #{{sale_number}}'),
    ('PURCHASES', 'PURCHASE_CREATED', 'Regla base compra', '143505', '220505', 'Asiento automatico compra {{source_id}}')
) AS x(source_module, event_type, rule_name, debit_account_code, credit_account_code, description_template)
ON CONFLICT (tenant_id, source_module, event_type, rule_name) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_accounting_seed_competitive_defaults_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO accounting_withholding_configs (
    tenant_id, code, name, applies_to, rate, base_threshold, account_code, is_active
  )
  VALUES
    (NEW.tenant_id, 'RETEFUENTE_PURCHASES', 'ReteFuente compras', 'PURCHASES', 2.5000, 0, '236540', TRUE),
    (NEW.tenant_id, 'RETEIVA_PURCHASES', 'ReteIVA compras', 'PURCHASES', 15.0000, 0, '236540', TRUE),
    (NEW.tenant_id, 'RETEICA_SALES', 'ReteICA ventas', 'SALES', 0.9660, 0, '236540', TRUE)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO accounting_posting_rules (
    tenant_id, source_module, event_type, rule_name,
    debit_account_code, credit_account_code, description_template,
    auto_post, priority, is_active
  )
  VALUES
    (NEW.tenant_id, 'POS', 'SALE_CREATED', 'Regla base venta POS', '110505', '413595', 'Asiento automatico venta POS #{{sale_number}}', TRUE, 100, TRUE),
    (NEW.tenant_id, 'PURCHASES', 'PURCHASE_CREATED', 'Regla base compra', '143505', '220505', 'Asiento automatico compra {{source_id}}', TRUE, 100, TRUE)
  ON CONFLICT (tenant_id, source_module, event_type, rule_name) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_seed_competitive_defaults_new_tenant ON tenants;
CREATE TRIGGER trg_accounting_seed_competitive_defaults_new_tenant
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION fn_accounting_seed_competitive_defaults_new_tenant();

-- ===================================================================
-- 6) Helpers + RPCs for retentions and close
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_accounting_is_period_closed(
  p_tenant_id UUID,
  p_entry_date DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM accounting_period_closures c
    WHERE c.tenant_id = p_tenant_id
      AND c.period_year = EXTRACT(YEAR FROM p_entry_date)::INT
      AND c.period_month = EXTRACT(MONTH FROM p_entry_date)::INT
      AND c.status = 'CLOSED'
  );
$$;

CREATE OR REPLACE FUNCTION fn_accounting_get_withholding_summary(
  p_tenant_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := COALESCE(
    NULLIF(auth.jwt() ->> 'role', ''),
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(
      CASE
        WHEN COALESCE(current_setting('request.jwt.claims', true), '') <> ''
          THEN (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
        ELSE NULL
      END,
      ''
    ),
    ''
  );
  v_sales_total NUMERIC(14,2) := 0;
  v_purchases_total NUMERIC(14,2) := 0;
  v_items JSONB := '[]'::jsonb;
  v_estimated_total NUMERIC(14,2) := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'tenant_id es requerido');
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_uid IS NULL OR NOT EXISTS (
      SELECT 1 FROM users u WHERE u.auth_user_id = v_uid AND u.tenant_id = p_tenant_id
    ) THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'No autorizado para este tenant');
    END IF;
  END IF;

  SELECT COALESCE(SUM(s.total), 0)
  INTO v_sales_total
  FROM sales s
  WHERE s.tenant_id = p_tenant_id
    AND s.status IN ('COMPLETED', 'PARTIAL_RETURN', 'RETURNED')
    AND (p_date_from IS NULL OR s.sold_at::DATE >= p_date_from)
    AND (p_date_to IS NULL OR s.sold_at::DATE <= p_date_to);

  SELECT COALESCE(SUM(p.total), 0)
  INTO v_purchases_total
  FROM purchases p
  WHERE p.tenant_id = p_tenant_id
    AND (p_date_from IS NULL OR p.created_at::DATE >= p_date_from)
    AND (p_date_to IS NULL OR p.created_at::DATE <= p_date_to);

  WITH cfg AS (
    SELECT *
    FROM accounting_withholding_configs c
    WHERE c.tenant_id = p_tenant_id
      AND c.is_active = TRUE
    ORDER BY c.code
  ), calc AS (
    SELECT
      c.code,
      c.name,
      c.applies_to,
      c.rate,
      c.base_threshold,
      c.account_code,
      CASE
        WHEN c.applies_to = 'SALES' THEN v_sales_total
        WHEN c.applies_to = 'PURCHASES' THEN v_purchases_total
        ELSE (v_sales_total + v_purchases_total)
      END AS base_amount
    FROM cfg c
  ), final_calc AS (
    SELECT
      code,
      name,
      applies_to,
      rate,
      base_threshold,
      account_code,
      ROUND(base_amount, 2) AS base_amount,
      ROUND(GREATEST(base_amount - base_threshold, 0), 2) AS taxable_base,
      ROUND((GREATEST(base_amount - base_threshold, 0) * rate) / 100.0, 2) AS estimated_withholding
    FROM calc
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'code', code,
          'name', name,
          'applies_to', applies_to,
          'rate', rate,
          'base_threshold', base_threshold,
          'account_code', account_code,
          'base_amount', base_amount,
          'taxable_base', taxable_base,
          'estimated_withholding', estimated_withholding
        )
      ),
      '[]'::jsonb
    ),
    COALESCE(SUM(estimated_withholding), 0)
  INTO v_items, v_estimated_total
  FROM final_calc;

  RETURN jsonb_build_object(
    'success', TRUE,
    'period', jsonb_build_object('date_from', p_date_from, 'date_to', p_date_to),
    'kpis', jsonb_build_object(
      'sales_total', ROUND(v_sales_total, 2),
      'purchases_total', ROUND(v_purchases_total, 2),
      'estimated_total', ROUND(v_estimated_total, 2)
    ),
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accounting_get_withholding_summary(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_accounting_get_withholding_summary(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION fn_accounting_close_period(
  p_tenant_id UUID,
  p_year INT,
  p_month INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_id UUID;
  v_date_from DATE;
  v_date_to DATE;
  v_drafts INT := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'tenant_id es requerido');
  END IF;

  IF p_month < 1 OR p_month > 12 THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Mes invalido');
  END IF;

  SELECT u.user_id
  INTO v_user_id
  FROM users u
  WHERE u.auth_user_id = v_uid
    AND u.tenant_id = p_tenant_id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No autorizado para este tenant');
  END IF;

  v_date_from := make_date(p_year, p_month, 1);
  v_date_to := (v_date_from + INTERVAL '1 month - 1 day')::DATE;

  SELECT COUNT(*)
  INTO v_drafts
  FROM accounting_entries e
  WHERE e.tenant_id = p_tenant_id
    AND e.entry_date BETWEEN v_date_from AND v_date_to
    AND e.status = 'DRAFT';

  IF v_drafts > 0 THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'No se puede cerrar: existen asientos en DRAFT en el periodo.',
      'draft_entries', v_drafts
    );
  END IF;

  INSERT INTO accounting_period_closures (
    tenant_id, period_year, period_month, status, notes,
    closed_at, closed_by, reopened_at, reopened_by, updated_at
  )
  VALUES (
    p_tenant_id, p_year, p_month, 'CLOSED', p_notes,
    NOW(), v_user_id, NULL, NULL, NOW()
  )
  ON CONFLICT (tenant_id, period_year, period_month)
  DO UPDATE SET
    status = 'CLOSED',
    notes = COALESCE(EXCLUDED.notes, accounting_period_closures.notes),
    closed_at = NOW(),
    closed_by = EXCLUDED.closed_by,
    reopened_at = NULL,
    reopened_by = NULL,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Periodo cerrado correctamente',
    'period_year', p_year,
    'period_month', p_month
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accounting_close_period(UUID, INT, INT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION fn_accounting_reopen_period(
  p_tenant_id UUID,
  p_year INT,
  p_month INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_id UUID;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'tenant_id es requerido');
  END IF;

  SELECT u.user_id
  INTO v_user_id
  FROM users u
  WHERE u.auth_user_id = v_uid
    AND u.tenant_id = p_tenant_id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No autorizado para este tenant');
  END IF;

  INSERT INTO accounting_period_closures (
    tenant_id, period_year, period_month, status, notes,
    reopened_at, reopened_by, updated_at
  )
  VALUES (
    p_tenant_id, p_year, p_month, 'OPEN', p_notes,
    NOW(), v_user_id, NOW()
  )
  ON CONFLICT (tenant_id, period_year, period_month)
  DO UPDATE SET
    status = 'OPEN',
    notes = COALESCE(EXCLUDED.notes, accounting_period_closures.notes),
    reopened_at = NOW(),
    reopened_by = EXCLUDED.reopened_by,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Periodo reabierto correctamente',
    'period_year', p_year,
    'period_month', p_month
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accounting_reopen_period(UUID, INT, INT, TEXT) TO authenticated;

-- ===================================================================
-- 7) Enforce period close in post_entry
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_accounting_post_entry(
  p_tenant_id UUID,
  p_entry_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_debits NUMERIC(14,2);
  v_credits NUMERIC(14,2);
  v_entry_date DATE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = p_tenant_id
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No autorizado para este tenant');
  END IF;

  SELECT status, entry_date
  INTO v_status, v_entry_date
  FROM accounting_entries
  WHERE tenant_id = p_tenant_id
    AND entry_id = p_entry_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Asiento no encontrado');
  END IF;

  IF fn_accounting_is_period_closed(p_tenant_id, v_entry_date) THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No se puede postear: el periodo contable esta cerrado');
  END IF;

  IF v_status <> 'DRAFT' THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Solo se pueden postear asientos en borrador');
  END IF;

  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
  INTO v_debits, v_credits
  FROM accounting_entry_lines
  WHERE tenant_id = p_tenant_id
    AND entry_id = p_entry_id;

  IF v_debits <= 0 OR v_credits <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'El asiento no tiene movimiento suficiente');
  END IF;

  IF ROUND(v_debits, 2) <> ROUND(v_credits, 2) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Asiento desbalanceado',
      'debits', v_debits,
      'credits', v_credits
    );
  END IF;

  UPDATE accounting_entries
  SET
    status = 'POSTED',
    posted_at = NOW(),
    posted_by = COALESCE(p_posted_by, posted_by)
  WHERE tenant_id = p_tenant_id
    AND entry_id = p_entry_id;

  RETURN jsonb_build_object('success', TRUE, 'message', 'Asiento posteado');
END;
$$;

-- ===================================================================
-- 8) Upgrade queue processor to use posting rules + exception registry
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_accounting_process_queue(
  p_tenant_id UUID,
  p_limit INT DEFAULT 50,
  p_only_event_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := COALESCE(
    NULLIF(auth.jwt() ->> 'role', ''),
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(
      CASE
        WHEN COALESCE(current_setting('request.jwt.claims', true), '') <> ''
          THEN (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
        ELSE NULL
      END,
      ''
    ),
    ''
  );
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  v_taken INT := 0;
  v_processed INT := 0;
  v_failed INT := 0;
  v_skipped INT := 0;

  v_event RECORD;
  v_sale RECORD;
  v_purchase RECORD;
  v_entry_id UUID;

  v_rule RECORD;
  v_debit_code TEXT;
  v_credit_code TEXT;
  v_description TEXT;

  v_account_cash UUID;
  v_account_sales UUID;
  v_account_inventory UUID;
  v_account_payables UUID;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'tenant_id es requerido');
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'Usuario no autenticado');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM users u
      WHERE u.auth_user_id = v_uid
        AND u.tenant_id = p_tenant_id
    ) THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'No autorizado para este tenant');
    END IF;
  END IF;

  FOR v_event IN
    SELECT *
    FROM accounting_event_queue q
    WHERE q.tenant_id = p_tenant_id
      AND (p_only_event_id IS NULL OR q.event_id = p_only_event_id)
      AND q.status IN ('PENDING', 'FAILED')
      AND q.available_at <= NOW()
    ORDER BY q.created_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_taken := v_taken + 1;

    UPDATE accounting_event_queue
    SET status = 'PROCESSING',
        attempts = attempts + 1,
        last_error = NULL
    WHERE event_id = v_event.event_id;

    BEGIN
      SELECT e.entry_id INTO v_entry_id
      FROM accounting_entries e
      WHERE e.tenant_id = p_tenant_id
        AND e.source_module = v_event.source_module
        AND e.source_event = v_event.event_type
        AND e.source_id = v_event.source_id
      LIMIT 1;

      IF v_entry_id IS NOT NULL THEN
        UPDATE accounting_event_queue
        SET status = 'PROCESSED',
            processed_at = NOW(),
            last_error = NULL
        WHERE event_id = v_event.event_id;

        v_processed := v_processed + 1;
        CONTINUE;
      END IF;

      IF v_event.event_type = 'SALE_CREATED' THEN
        SELECT s.sale_id, s.sale_number, s.sold_at::date AS entry_date, s.total, s.status, s.sold_by
        INTO v_sale
        FROM sales s
        WHERE s.tenant_id = p_tenant_id
          AND s.sale_id = v_event.source_id
        LIMIT 1;

        IF v_sale.sale_id IS NULL THEN
          UPDATE accounting_event_queue
          SET status = 'SKIPPED',
              processed_at = NOW(),
              last_error = 'Venta no encontrada'
          WHERE event_id = v_event.event_id;

          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        IF fn_accounting_is_period_closed(p_tenant_id, v_sale.entry_date) THEN
          RAISE EXCEPTION 'Periodo cerrado para la fecha de la venta';
        END IF;

        IF COALESCE(v_sale.status, '') = 'VOIDED' OR COALESCE(v_sale.total, 0) <= 0 THEN
          UPDATE accounting_event_queue
          SET status = 'SKIPPED',
              processed_at = NOW(),
              last_error = 'Venta anulada o total no valido'
          WHERE event_id = v_event.event_id;

          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        v_rule := NULL;
        SELECT *
        INTO v_rule
        FROM accounting_posting_rules r
        WHERE r.tenant_id = p_tenant_id
          AND r.source_module = 'POS'
          AND r.event_type = 'SALE_CREATED'
          AND r.is_active = TRUE
        ORDER BY r.priority ASC, r.created_at ASC
        LIMIT 1;

        v_debit_code := COALESCE(v_rule.debit_account_code, '110505');
        v_credit_code := COALESCE(v_rule.credit_account_code, '413595');
        v_description := COALESCE(v_rule.description_template, 'Asiento automatico venta POS #{{sale_number}}');
        v_description := REPLACE(v_description, '{{sale_number}}', COALESCE(v_sale.sale_number::TEXT, ''));
        v_description := REPLACE(v_description, '{{source_id}}', COALESCE(v_sale.sale_id::TEXT, ''));

        SELECT account_id INTO v_account_cash
        FROM accounting_accounts
        WHERE tenant_id = p_tenant_id
          AND code = v_debit_code
          AND is_active = TRUE
          AND is_postable = TRUE
        LIMIT 1;

        SELECT account_id INTO v_account_sales
        FROM accounting_accounts
        WHERE tenant_id = p_tenant_id
          AND code = v_credit_code
          AND is_active = TRUE
          AND is_postable = TRUE
        LIMIT 1;

        IF v_account_cash IS NULL OR v_account_sales IS NULL THEN
          RAISE EXCEPTION 'Regla de venta invalida. Revise cuentas % / %', v_debit_code, v_credit_code;
        END IF;

        INSERT INTO accounting_entries (
          tenant_id,
          entry_date,
          source_module,
          source_event,
          source_id,
          description,
          status,
          created_by,
          posted_by,
          posted_at,
          ai_generated
        )
        VALUES (
          p_tenant_id,
          v_sale.entry_date,
          'POS',
          'SALE_CREATED',
          v_sale.sale_id,
          v_description,
          CASE WHEN COALESCE(v_rule.auto_post, TRUE) THEN 'POSTED' ELSE 'DRAFT' END,
          v_sale.sold_by,
          CASE WHEN COALESCE(v_rule.auto_post, TRUE) THEN v_sale.sold_by ELSE NULL END,
          CASE WHEN COALESCE(v_rule.auto_post, TRUE) THEN NOW() ELSE NULL END,
          FALSE
        )
        RETURNING entry_id INTO v_entry_id;

        INSERT INTO accounting_entry_lines (
          entry_id, tenant_id, line_number, account_id, description, debit_amount, credit_amount
        ) VALUES
          (
            v_entry_id,
            p_tenant_id,
            1,
            v_account_cash,
            'Debito automatico por venta',
            ROUND(v_sale.total, 2),
            0
          ),
          (
            v_entry_id,
            p_tenant_id,
            2,
            v_account_sales,
            'Credito automatico por venta',
            0,
            ROUND(v_sale.total, 2)
          );

      ELSIF v_event.event_type = 'PURCHASE_CREATED' THEN
        SELECT p.purchase_id, p.created_at::date AS entry_date, p.total, p.created_by
        INTO v_purchase
        FROM purchases p
        WHERE p.tenant_id = p_tenant_id
          AND p.purchase_id = v_event.source_id
        LIMIT 1;

        IF v_purchase.purchase_id IS NULL THEN
          UPDATE accounting_event_queue
          SET status = 'SKIPPED',
              processed_at = NOW(),
              last_error = 'Compra no encontrada'
          WHERE event_id = v_event.event_id;

          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        IF fn_accounting_is_period_closed(p_tenant_id, v_purchase.entry_date) THEN
          RAISE EXCEPTION 'Periodo cerrado para la fecha de la compra';
        END IF;

        IF COALESCE(v_purchase.total, 0) <= 0 THEN
          UPDATE accounting_event_queue
          SET status = 'SKIPPED',
              processed_at = NOW(),
              last_error = 'Compra con total no valido'
          WHERE event_id = v_event.event_id;

          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        v_rule := NULL;
        SELECT *
        INTO v_rule
        FROM accounting_posting_rules r
        WHERE r.tenant_id = p_tenant_id
          AND r.source_module = 'PURCHASES'
          AND r.event_type = 'PURCHASE_CREATED'
          AND r.is_active = TRUE
        ORDER BY r.priority ASC, r.created_at ASC
        LIMIT 1;

        v_debit_code := COALESCE(v_rule.debit_account_code, '143505');
        v_credit_code := COALESCE(v_rule.credit_account_code, '220505');
        v_description := COALESCE(v_rule.description_template, 'Asiento automatico compra {{source_id}}');
        v_description := REPLACE(v_description, '{{source_id}}', COALESCE(v_purchase.purchase_id::TEXT, ''));

        SELECT account_id INTO v_account_inventory
        FROM accounting_accounts
        WHERE tenant_id = p_tenant_id
          AND code = v_debit_code
          AND is_active = TRUE
          AND is_postable = TRUE
        LIMIT 1;

        SELECT account_id INTO v_account_payables
        FROM accounting_accounts
        WHERE tenant_id = p_tenant_id
          AND code = v_credit_code
          AND is_active = TRUE
          AND is_postable = TRUE
        LIMIT 1;

        IF v_account_inventory IS NULL OR v_account_payables IS NULL THEN
          RAISE EXCEPTION 'Regla de compra invalida. Revise cuentas % / %', v_debit_code, v_credit_code;
        END IF;

        INSERT INTO accounting_entries (
          tenant_id,
          entry_date,
          source_module,
          source_event,
          source_id,
          description,
          status,
          created_by,
          posted_by,
          posted_at,
          ai_generated
        )
        VALUES (
          p_tenant_id,
          v_purchase.entry_date,
          'PURCHASES',
          'PURCHASE_CREATED',
          v_purchase.purchase_id,
          v_description,
          CASE WHEN COALESCE(v_rule.auto_post, TRUE) THEN 'POSTED' ELSE 'DRAFT' END,
          v_purchase.created_by,
          CASE WHEN COALESCE(v_rule.auto_post, TRUE) THEN v_purchase.created_by ELSE NULL END,
          CASE WHEN COALESCE(v_rule.auto_post, TRUE) THEN NOW() ELSE NULL END,
          FALSE
        )
        RETURNING entry_id INTO v_entry_id;

        INSERT INTO accounting_entry_lines (
          entry_id, tenant_id, line_number, account_id, description, debit_amount, credit_amount
        ) VALUES
          (
            v_entry_id,
            p_tenant_id,
            1,
            v_account_inventory,
            'Debito automatico por compra',
            ROUND(v_purchase.total, 2),
            0
          ),
          (
            v_entry_id,
            p_tenant_id,
            2,
            v_account_payables,
            'Credito automatico por compra',
            0,
            ROUND(v_purchase.total, 2)
          );

      ELSE
        UPDATE accounting_event_queue
        SET status = 'SKIPPED',
            processed_at = NOW(),
            last_error = 'Evento no soportado: ' || COALESCE(v_event.event_type, '-')
        WHERE event_id = v_event.event_id;

        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      UPDATE accounting_event_queue
      SET status = 'PROCESSED',
          processed_at = NOW(),
          last_error = NULL
      WHERE event_id = v_event.event_id;

      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      UPDATE accounting_event_queue
      SET status = 'FAILED',
          processed_at = NULL,
          last_error = LEFT(SQLERRM, 500),
          available_at = NOW() + (INTERVAL '1 minute' * LEAST(COALESCE(attempts, 1), 10))
      WHERE event_id = v_event.event_id;

      INSERT INTO accounting_automation_exceptions (
        tenant_id,
        queue_event_id,
        source_module,
        event_type,
        source_id,
        reason,
        payload,
        status
      )
      VALUES (
        p_tenant_id,
        v_event.event_id,
        COALESCE(v_event.source_module, 'UNKNOWN'),
        COALESCE(v_event.event_type, 'UNKNOWN'),
        v_event.source_id,
        LEFT(SQLERRM, 500),
        COALESCE(v_event.payload, '{}'::jsonb),
        'OPEN'
      );

      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'tenant_id', p_tenant_id,
    'taken', v_taken,
    'processed', v_processed,
    'failed', v_failed,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accounting_process_queue(UUID, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_accounting_process_queue(UUID, INT, UUID) TO service_role;

-- ===================================================================
-- 9) Permissions and role-based menus
-- ===================================================================
INSERT INTO permissions (code, description)
VALUES
  ('ACCOUNTING.WITHHOLDINGS.MANAGE', 'Gestionar retenciones contables'),
  ('ACCOUNTING.CLOSE.MANAGE', 'Gestionar cierres contables'),
  ('ACCOUNTING.AUTOMATION.MANAGE', 'Gestionar reglas de automatizacion contable')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order, is_active)
VALUES
  ('CONTABILIDAD.RETENCIONES', 'Retenciones', 'mdi-percent-outline', '/accounting/retenciones', 'CONTABILIDAD', 591, TRUE),
  ('CONTABILIDAD.CIERRE', 'Cierre Contable', 'mdi-lock-check-outline', '/accounting/cierre', 'CONTABILIDAD', 592, TRUE),
  ('CONTABILIDAD.AUTOMATIZACION', 'Automatizacion', 'mdi-cogs', '/accounting/automatizacion', 'CONTABILIDAD', 593, TRUE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  route = EXCLUDED.route,
  parent_code = EXCLUDED.parent_code,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

WITH permission_map AS (
  SELECT *
  FROM (VALUES
    ('CONTABILIDAD.RETENCIONES', 'ACCOUNTING.WITHHOLDINGS.MANAGE'),
    ('CONTABILIDAD.CIERRE', 'ACCOUNTING.CLOSE.MANAGE'),
    ('CONTABILIDAD.AUTOMATIZACION', 'ACCOUNTING.AUTOMATION.MANAGE')
  ) AS t(menu_code, permission_code)
)
INSERT INTO menu_permissions (menu_item_id, permission_id)
SELECT mi.menu_item_id, p.permission_id
FROM permission_map pm
JOIN menu_items mi ON mi.code = pm.menu_code
JOIN permissions p ON p.code = pm.permission_code
ON CONFLICT DO NOTHING;

INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT roles.role_name, mi.menu_item_id
FROM (VALUES ('ADMINISTRADOR'), ('GERENTE'), ('CONTADOR')) AS roles(role_name)
JOIN menu_items mi ON mi.code IN (
  'CONTABILIDAD.RETENCIONES',
  'CONTABILIDAD.CIERRE',
  'CONTABILIDAD.AUTOMATIZACION'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_menus (role_id, menu_item_id)
SELECT r.role_id, mi.menu_item_id
FROM roles r
JOIN menu_items mi ON mi.code IN (
  'CONTABILIDAD.RETENCIONES',
  'CONTABILIDAD.CIERRE',
  'CONTABILIDAD.AUTOMATIZACION'
)
WHERE r.name IN ('ADMINISTRADOR', 'GERENTE', 'CONTADOR')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'Accounting competitive core installed';
END $$;
