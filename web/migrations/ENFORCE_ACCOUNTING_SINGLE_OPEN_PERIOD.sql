-- ===================================================================
-- Migration: Enforce single OPEN accounting period per tenant
-- Date: 2026-03-11
-- Goal:
--   - A period is operable only when explicitly OPEN.
--   - Only one OPEN period is allowed per tenant.
--   - Keep backward compatibility with fn_accounting_reopen_period.
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE 'Enforcing accounting single-open-period policy';
END $$;

-- 1) Data fix: if a tenant has multiple OPEN periods, keep the newest OPEN and close the others.
WITH ranked_open AS (
  SELECT
    c.closure_id,
    c.tenant_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.tenant_id
      ORDER BY c.period_year DESC, c.period_month DESC, c.updated_at DESC, c.created_at DESC
    ) AS rn
  FROM accounting_period_closures c
  WHERE c.status = 'OPEN'
)
UPDATE accounting_period_closures c
SET
  status = 'CLOSED',
  closed_at = COALESCE(c.closed_at, NOW()),
  reopened_at = NULL,
  reopened_by = NULL,
  notes = CASE
    WHEN c.notes IS NULL OR c.notes = '' THEN 'Auto-cierre migracion single-open-period'
    ELSE c.notes || ' | Auto-cierre migracion single-open-period'
  END,
  updated_at = NOW()
FROM ranked_open r
WHERE c.closure_id = r.closure_id
  AND r.rn > 1;

-- 2) Hard rule: one OPEN period per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_period_one_open_per_tenant
  ON accounting_period_closures (tenant_id)
  WHERE status = 'OPEN';

-- 3) Seed one initial OPEN period only for tenants without any period rows.
INSERT INTO accounting_period_closures (
  tenant_id,
  period_year,
  period_month,
  status,
  notes,
  created_at,
  updated_at
)
SELECT
  t.tenant_id,
  EXTRACT(YEAR FROM CURRENT_DATE)::INT,
  EXTRACT(MONTH FROM CURRENT_DATE)::INT,
  'OPEN',
  'Apertura inicial automatica',
  NOW(),
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM accounting_period_closures c
  WHERE c.tenant_id = t.tenant_id
)
ON CONFLICT (tenant_id, period_year, period_month) DO NOTHING;

-- 4) Explicit open/closed helpers.
CREATE OR REPLACE FUNCTION fn_accounting_is_period_open(
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
      AND c.status = 'OPEN'
  );
$$;

-- Backward compatibility: closed means NOT OPEN.
CREATE OR REPLACE FUNCTION fn_accounting_is_period_closed(
  p_tenant_id UUID,
  p_entry_date DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT NOT fn_accounting_is_period_open(p_tenant_id, p_entry_date);
$$;

-- 5) Open period RPC (one at a time).
CREATE OR REPLACE FUNCTION fn_accounting_open_period(
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
  v_existing_open RECORD;
  v_target RECORD;
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

  SELECT *
  INTO v_existing_open
  FROM accounting_period_closures c
  WHERE c.tenant_id = p_tenant_id
    AND c.status = 'OPEN'
  LIMIT 1;

  IF v_existing_open.closure_id IS NOT NULL
     AND (v_existing_open.period_year <> p_year OR v_existing_open.period_month <> p_month) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Ya existe un periodo abierto. Cierrelo antes de abrir otro.',
      'open_period_year', v_existing_open.period_year,
      'open_period_month', v_existing_open.period_month
    );
  END IF;

  SELECT *
  INTO v_target
  FROM accounting_period_closures c
  WHERE c.tenant_id = p_tenant_id
    AND c.period_year = p_year
    AND c.period_month = p_month
  LIMIT 1;

  IF v_target.closure_id IS NOT NULL AND v_target.status = 'OPEN' THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'message', 'El periodo ya esta abierto',
      'period_year', p_year,
      'period_month', p_month
    );
  END IF;

  INSERT INTO accounting_period_closures (
    tenant_id,
    period_year,
    period_month,
    status,
    notes,
    reopened_at,
    reopened_by,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_year,
    p_month,
    'OPEN',
    p_notes,
    NOW(),
    v_user_id,
    NOW()
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
    'message', 'Periodo abierto correctamente',
    'period_year', p_year,
    'period_month', p_month
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accounting_open_period(UUID, INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_accounting_open_period(UUID, INT, INT, TEXT) TO service_role;

-- Keep compatibility for clients still calling reopen.
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
BEGIN
  RETURN fn_accounting_open_period(p_tenant_id, p_year, p_month, p_notes);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accounting_reopen_period(UUID, INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_accounting_reopen_period(UUID, INT, INT, TEXT) TO service_role;

-- 6) Close period RPC now requires the target period to be OPEN.
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
  v_target_status TEXT;
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

  SELECT c.status
  INTO v_target_status
  FROM accounting_period_closures c
  WHERE c.tenant_id = p_tenant_id
    AND c.period_year = p_year
    AND c.period_month = p_month
  LIMIT 1;

  IF v_target_status IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'El periodo no existe. Debe abrirlo primero.'
    );
  END IF;

  IF v_target_status <> 'OPEN' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Solo se puede cerrar un periodo que este OPEN.'
    );
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

  UPDATE accounting_period_closures
  SET
    status = 'CLOSED',
    notes = COALESCE(p_notes, notes),
    closed_at = NOW(),
    closed_by = v_user_id,
    reopened_at = NULL,
    reopened_by = NULL,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND period_year = p_year
    AND period_month = p_month;

  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Periodo cerrado correctamente',
    'period_year', p_year,
    'period_month', p_month
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accounting_close_period(UUID, INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_accounting_close_period(UUID, INT, INT, TEXT) TO service_role;

-- 7) Enforce explicit OPEN period in manual posting too.
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

  IF NOT fn_accounting_is_period_open(p_tenant_id, v_entry_date) THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No se puede postear: el periodo no esta OPEN');
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

GRANT EXECUTE ON FUNCTION fn_accounting_post_entry(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_accounting_post_entry(UUID, UUID, UUID) TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'Single-open-period policy applied';
END $$;
