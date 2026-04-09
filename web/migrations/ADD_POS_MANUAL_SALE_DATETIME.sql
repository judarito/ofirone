-- ===================================================================
-- Migración: Fecha/hora manual de venta en POS
-- Fecha: 2026-03-13
-- Descripción:
--   1. Agrega configuración tenant para habilitar fecha manual en POS
--   2. Extiende sp_create_sale con parámetro opcional p_sold_at
--   3. Propaga la fecha efectiva a sales, inventory_moves y sale_payments
-- ===================================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS pos_allow_manual_sale_datetime boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pos_max_backdate_hours integer DEFAULT 24
    CHECK (pos_max_backdate_hours >= 1 AND pos_max_backdate_hours <= 720);

COMMENT ON COLUMN tenant_settings.pos_allow_manual_sale_datetime IS
  'Permite seleccionar fecha/hora manual en POS para administradores y gerentes';
COMMENT ON COLUMN tenant_settings.pos_max_backdate_hours IS
  'Máximo de horas de retrofecha permitida al registrar ventas manuales en POS';

DO $$
DECLARE
  v_proc regprocedure;
  v_def text;
BEGIN
  SELECT p.oid::regprocedure
  INTO v_proc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'sp_create_sale'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_proc IS NULL THEN
    RAISE EXCEPTION 'No se encontró public.sp_create_sale para extender con p_sold_at';
  END IF;

  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF position('p_sold_at' IN v_def) = 0 THEN
    v_def := regexp_replace(
      v_def,
      E'\\)\\s+RETURNS\\s+uuid',
      E',\n  p_sold_at      TIMESTAMPTZ DEFAULT NULL\n) RETURNS uuid',
      'i'
    );
  END IF;

  IF position('v_effective_sold_at' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      E'  v_paid_total NUMERIC := 0;\nBEGIN',
      E'  v_paid_total NUMERIC := 0;\n  v_effective_sold_at TIMESTAMPTZ;\nBEGIN\n  v_effective_sold_at := COALESCE(p_sold_at, CURRENT_TIMESTAMP);\n\n  IF p_sold_at IS NOT NULL AND p_sold_at > CURRENT_TIMESTAMP THEN\n    RAISE EXCEPTION ''Sale datetime cannot be in the future'';\n  END IF;'
    );
  END IF;

  IF position('Sale datetime cannot be earlier than cash session open time' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      E'  -- Generar número de venta',
      E'  IF p_cash_session IS NOT NULL AND p_sold_at IS NOT NULL THEN\n    PERFORM 1\n    FROM cash_sessions cs\n    WHERE cs.tenant_id = p_tenant\n      AND cs.cash_session_id = p_cash_session\n      AND p_sold_at >= cs.opened_at;\n\n    IF NOT FOUND THEN\n      RAISE EXCEPTION ''Sale datetime cannot be earlier than cash session open time'';\n    END IF;\n  END IF;\n\n  -- Generar número de venta'
    );
  END IF;

  v_def := regexp_replace(v_def, 'NOW\\(\\)', 'v_effective_sold_at', 'g');

  EXECUTE v_def;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✅ POS manual sale datetime habilitado en tenant_settings y sp_create_sale';
END $$;
