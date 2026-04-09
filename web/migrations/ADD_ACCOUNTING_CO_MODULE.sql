-- ===================================================================
-- Migración: Módulo Contable Colombia (desacoplado de POS)
-- Fecha: 2026-03-11
-- Objetivo:
--   1) Añadir núcleo contable por tenant (cuentas, asientos, líneas)
--   2) Habilitar integración asíncrona por cola (eventos POS -> contabilidad)
--   3) Agregar menú/permisos para activar por rol
--   4) Mantener POS desacoplado: errores contables NO bloquean venta/compra
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📒 INICIANDO MÓDULO CONTABLE CO (DESACOPLADO)';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

-- ===================================================================
-- 0) Configuración del tenant para contabilidad opcional
-- ===================================================================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS accounting_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accounting_mode TEXT DEFAULT 'ASYNC'
    CHECK (accounting_mode IN ('OFF', 'ASYNC', 'MANUAL')),
  ADD COLUMN IF NOT EXISTS accounting_ai_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS accounting_auto_post_sales BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accounting_auto_post_purchases BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accounting_country_code TEXT DEFAULT 'CO';

COMMENT ON COLUMN tenant_settings.accounting_enabled IS 'Habilita módulo contable sin impactar POS.';
COMMENT ON COLUMN tenant_settings.accounting_mode IS 'OFF=apagado, ASYNC=cola desacoplada, MANUAL=registro manual.';
COMMENT ON COLUMN tenant_settings.accounting_ai_enabled IS 'Permite asistente IA para sugerencias contables.';
COMMENT ON COLUMN tenant_settings.accounting_auto_post_sales IS 'Encola automáticamente ventas hacia contabilidad.';
COMMENT ON COLUMN tenant_settings.accounting_auto_post_purchases IS 'Encola automáticamente compras hacia contabilidad.';
COMMENT ON COLUMN tenant_settings.accounting_country_code IS 'Normativa contable base (CO por defecto).';

UPDATE tenant_settings
SET
  accounting_enabled = COALESCE(accounting_enabled, FALSE),
  accounting_mode = COALESCE(accounting_mode, 'ASYNC'),
  accounting_ai_enabled = COALESCE(accounting_ai_enabled, TRUE),
  accounting_auto_post_sales = COALESCE(accounting_auto_post_sales, FALSE),
  accounting_auto_post_purchases = COALESCE(accounting_auto_post_purchases, FALSE),
  accounting_country_code = COALESCE(accounting_country_code, 'CO')
WHERE
  accounting_enabled IS NULL
  OR accounting_mode IS NULL
  OR accounting_ai_enabled IS NULL
  OR accounting_auto_post_sales IS NULL
  OR accounting_auto_post_purchases IS NULL
  OR accounting_country_code IS NULL;

-- ===================================================================
-- 1) Catálogo de cuentas (PUC simplificado Colombia por tenant)
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_class CHAR(1) NOT NULL CHECK (account_class IN ('1','2','3','4','5','6','7','8','9')),
  account_type TEXT NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE','COST','ORDER')),
  natural_side TEXT NOT NULL CHECK (natural_side IN ('DEBIT','CREDIT')),
  parent_account_id UUID REFERENCES accounting_accounts(account_id) ON DELETE SET NULL,
  is_postable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_tenant ON accounting_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_parent ON accounting_accounts(parent_account_id);

COMMENT ON TABLE accounting_accounts IS 'Plan de cuentas por tenant (base PUC Colombia).';

-- ===================================================================
-- 2) Asientos contables (cabecera)
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entry_number BIGINT GENERATED ALWAYS AS IDENTITY,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_module TEXT NOT NULL DEFAULT 'MANUAL', -- POS | PURCHASES | MANUAL | ADJUSTMENT
  source_event TEXT,                             -- SALE_CREATED, PURCHASE_CREATED, etc.
  source_id UUID,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'VOIDED')),
  is_adjustment BOOLEAN NOT NULL DEFAULT FALSE,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence NUMERIC(5,2),
  created_by UUID REFERENCES users(user_id),
  posted_by UUID REFERENCES users(user_id),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_entries_tenant_number
  ON accounting_entries(tenant_id, entry_number);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_tenant_status_date
  ON accounting_entries(tenant_id, status, entry_date DESC);

-- ===================================================================
-- 3) Líneas de asiento
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_entry_lines (
  line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES accounting_entries(entry_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL DEFAULT 1,
  account_id UUID NOT NULL REFERENCES accounting_accounts(account_id),
  third_party_id UUID,
  description TEXT,
  debit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  cost_center TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_line_one_side_chk CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR
    (credit_amount > 0 AND debit_amount = 0)
  ),
  UNIQUE (entry_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_accounting_entry_lines_entry ON accounting_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_accounting_entry_lines_tenant_account ON accounting_entry_lines(tenant_id, account_id);

-- ===================================================================
-- 4) Cola de eventos de integración (desacoplada)
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_event_queue (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  source_module TEXT NOT NULL, -- POS | PURCHASES | INVENTORY | MANUAL
  event_type TEXT NOT NULL,    -- SALE_CREATED | PURCHASE_CREATED | ...
  source_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_module, event_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_event_queue_pending
  ON accounting_event_queue(tenant_id, status, available_at);

COMMENT ON TABLE accounting_event_queue IS 'Outbox contable desacoplado: nunca debe bloquear operaciones POS.';

-- ===================================================================
-- 5) Funciones núcleo contable
-- ===================================================================

-- 5.1) Seed PUC base por tenant
CREATE OR REPLACE FUNCTION fn_accounting_seed_chart_for_tenant(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  INSERT INTO accounting_accounts (
    tenant_id, code, name, account_class, account_type,
    natural_side, is_postable, is_system
  )
  SELECT p_tenant_id, x.code, x.name, x.account_class, x.account_type,
         x.natural_side, x.is_postable, TRUE
  FROM (
    VALUES
      -- Activos
      ('1105',   'Caja',                          '1', 'ASSET',    'DEBIT',  FALSE),
      ('110505', 'Caja General',                  '1', 'ASSET',    'DEBIT',  TRUE),
      ('1110',   'Bancos',                        '1', 'ASSET',    'DEBIT',  FALSE),
      ('111005', 'Bancos Moneda Nacional',        '1', 'ASSET',    'DEBIT',  TRUE),
      ('1305',   'Clientes',                      '1', 'ASSET',    'DEBIT',  FALSE),
      ('130505', 'Clientes Nacionales',           '1', 'ASSET',    'DEBIT',  TRUE),
      ('1435',   'Mercancías no fabricadas',      '1', 'ASSET',    'DEBIT',  FALSE),
      ('143505', 'Inventario para la venta',      '1', 'ASSET',    'DEBIT',  TRUE),

      -- Pasivos
      ('2205',   'Nacionales Proveedores',        '2', 'LIABILITY','CREDIT', FALSE),
      ('220505', 'Proveedores nacionales',        '2', 'LIABILITY','CREDIT', TRUE),
      ('2365',   'Retención en la fuente',        '2', 'LIABILITY','CREDIT', FALSE),
      ('236540', 'Retefuente compras',            '2', 'LIABILITY','CREDIT', TRUE),
      ('2408',   'IVA por pagar',                 '2', 'LIABILITY','CREDIT', FALSE),
      ('240805', 'IVA generado',                  '2', 'LIABILITY','CREDIT', TRUE),
      ('240810', 'IVA descontable',               '2', 'LIABILITY','DEBIT',  TRUE),

      -- Patrimonio
      ('3105',   'Capital social',                '3', 'EQUITY',   'CREDIT', TRUE),
      ('3605',   'Utilidad del ejercicio',        '3', 'EQUITY',   'CREDIT', TRUE),

      -- Ingresos
      ('4135',   'Comercio al por menor',         '4', 'INCOME',   'CREDIT', FALSE),
      ('413595', 'Ventas POS',                    '4', 'INCOME',   'CREDIT', TRUE),

      -- Costos
      ('6135',   'Costo de mercancía vendida',    '6', 'COST',     'DEBIT',  FALSE),
      ('613595', 'Costo de ventas POS',           '6', 'COST',     'DEBIT',  TRUE),

      -- Gastos
      ('5105',   'Gastos de personal',            '5', 'EXPENSE',  'DEBIT',  FALSE),
      ('510506', 'Sueldos',                       '5', 'EXPENSE',  'DEBIT',  TRUE),
      ('5135',   'Servicios',                     '5', 'EXPENSE',  'DEBIT',  FALSE),
      ('513595', 'Servicios públicos',            '5', 'EXPENSE',  'DEBIT',  TRUE),
      ('5195',   'Diversos',                      '5', 'EXPENSE',  'DEBIT',  FALSE),
      ('519595', 'Gastos varios',                 '5', 'EXPENSE',  'DEBIT',  TRUE)
  ) AS x(code, name, account_class, account_type, natural_side, is_postable)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Relación de padres por prefijo (ej: 110505 -> 1105)
  UPDATE accounting_accounts child
  SET parent_account_id = parent.account_id
  FROM accounting_accounts parent
  WHERE child.tenant_id = p_tenant_id
    AND parent.tenant_id = p_tenant_id
    AND child.parent_account_id IS NULL
    AND (
      (child.code = '110505' AND parent.code = '1105') OR
      (child.code = '111005' AND parent.code = '1110') OR
      (child.code = '130505' AND parent.code = '1305') OR
      (child.code = '143505' AND parent.code = '1435') OR
      (child.code = '220505' AND parent.code = '2205') OR
      (child.code = '236540' AND parent.code = '2365') OR
      (child.code = '240805' AND parent.code = '2408') OR
      (child.code = '240810' AND parent.code = '2408') OR
      (child.code = '413595' AND parent.code = '4135') OR
      (child.code = '613595' AND parent.code = '6135') OR
      (child.code = '510506' AND parent.code = '5105') OR
      (child.code = '513595' AND parent.code = '5135') OR
      (child.code = '519595' AND parent.code = '5195')
    );

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION fn_accounting_seed_chart_for_tenant IS
  'Crea plan de cuentas base (PUC simplificado CO) para un tenant.';

-- 5.2) Resumen para dashboard contable
CREATE OR REPLACE FUNCTION fn_accounting_summary(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending_events INTEGER := 0;
  v_draft_entries INTEGER := 0;
  v_posted_month INTEGER := 0;
  v_month_debits NUMERIC(14,2) := 0;
  v_month_credits NUMERIC(14,2) := 0;
BEGIN
  -- Protección multi-tenant para RPC SECURITY DEFINER
  IF NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = p_tenant_id
  ) THEN
    RETURN jsonb_build_object(
      'pending_events', 0,
      'draft_entries', 0,
      'posted_entries_month', 0,
      'month_debits', 0,
      'month_credits', 0,
      'is_balanced_month', TRUE
    );
  END IF;

  SELECT COUNT(*) INTO v_pending_events
  FROM accounting_event_queue
  WHERE tenant_id = p_tenant_id
    AND status IN ('PENDING', 'FAILED');

  SELECT COUNT(*) INTO v_draft_entries
  FROM accounting_entries
  WHERE tenant_id = p_tenant_id
    AND status = 'DRAFT';

  SELECT COUNT(*) INTO v_posted_month
  FROM accounting_entries
  WHERE tenant_id = p_tenant_id
    AND status = 'POSTED'
    AND date_trunc('month', entry_date) = date_trunc('month', CURRENT_DATE);

  SELECT
    COALESCE(SUM(l.debit_amount), 0),
    COALESCE(SUM(l.credit_amount), 0)
  INTO v_month_debits, v_month_credits
  FROM accounting_entry_lines l
  JOIN accounting_entries e ON e.entry_id = l.entry_id
  WHERE e.tenant_id = p_tenant_id
    AND e.status = 'POSTED'
    AND date_trunc('month', e.entry_date) = date_trunc('month', CURRENT_DATE);

  RETURN jsonb_build_object(
    'pending_events', v_pending_events,
    'draft_entries', v_draft_entries,
    'posted_entries_month', v_posted_month,
    'month_debits', COALESCE(v_month_debits, 0),
    'month_credits', COALESCE(v_month_credits, 0),
    'is_balanced_month', ROUND(COALESCE(v_month_debits, 0), 2) = ROUND(COALESCE(v_month_credits, 0), 2)
  );
END;
$$;

-- 5.3) Balanza de comprobación
CREATE OR REPLACE FUNCTION fn_accounting_trial_balance(
  p_tenant_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  natural_side TEXT,
  debit_total NUMERIC(14,2),
  credit_total NUMERIC(14,2),
  balance NUMERIC(14,2)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    a.code AS account_code,
    a.name AS account_name,
    a.account_type,
    a.natural_side,
    ROUND(COALESCE(SUM(CASE WHEN e.entry_id IS NOT NULL THEN l.debit_amount ELSE 0 END), 0), 2) AS debit_total,
    ROUND(COALESCE(SUM(CASE WHEN e.entry_id IS NOT NULL THEN l.credit_amount ELSE 0 END), 0), 2) AS credit_total,
    ROUND(
      CASE
        WHEN a.natural_side = 'DEBIT'
          THEN COALESCE(SUM(CASE WHEN e.entry_id IS NOT NULL THEN l.debit_amount ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN e.entry_id IS NOT NULL THEN l.credit_amount ELSE 0 END), 0)
        ELSE COALESCE(SUM(CASE WHEN e.entry_id IS NOT NULL THEN l.credit_amount ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN e.entry_id IS NOT NULL THEN l.debit_amount ELSE 0 END), 0)
      END,
      2
    ) AS balance
  FROM accounting_accounts a
  LEFT JOIN accounting_entry_lines l
    ON l.account_id = a.account_id
   AND l.tenant_id = p_tenant_id
  LEFT JOIN accounting_entries e
    ON e.entry_id = l.entry_id
   AND e.tenant_id = p_tenant_id
   AND e.status = 'POSTED'
   AND (p_date_from IS NULL OR e.entry_date >= p_date_from)
   AND (p_date_to IS NULL OR e.entry_date <= p_date_to)
  WHERE a.tenant_id = p_tenant_id
    AND a.is_active = TRUE
    AND EXISTS (
      SELECT 1
      FROM users u
      WHERE u.auth_user_id = auth.uid()
        AND u.tenant_id = p_tenant_id
    )
  GROUP BY a.code, a.name, a.account_type, a.natural_side
  ORDER BY a.code;
$$;

COMMENT ON FUNCTION fn_accounting_trial_balance IS
  'Retorna balanza de comprobación por tenant y rango de fechas.';

-- 5.4) Postear asiento (valida débito = crédito)
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
BEGIN
  -- Protección multi-tenant para RPC SECURITY DEFINER
  IF NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = p_tenant_id
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No autorizado para este tenant');
  END IF;

  SELECT status INTO v_status
  FROM accounting_entries
  WHERE tenant_id = p_tenant_id
    AND entry_id = p_entry_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Asiento no encontrado');
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

-- 5.5) Encolar evento contable (fail-safe)
CREATE OR REPLACE FUNCTION fn_accounting_enqueue_event(
  p_tenant_id UUID,
  p_source_module TEXT,
  p_event_type TEXT,
  p_source_id UUID,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_enabled BOOLEAN := FALSE;
  v_mode TEXT := 'OFF';
  v_auto_sales BOOLEAN := FALSE;
  v_auto_purchases BOOLEAN := FALSE;
  v_event_id UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_source_id IS NULL OR COALESCE(p_event_type, '') = '' THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(accounting_enabled, FALSE),
    COALESCE(accounting_mode, 'OFF'),
    COALESCE(accounting_auto_post_sales, FALSE),
    COALESCE(accounting_auto_post_purchases, FALSE)
  INTO v_enabled, v_mode, v_auto_sales, v_auto_purchases
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id;

  IF COALESCE(v_enabled, FALSE) = FALSE OR COALESCE(v_mode, 'OFF') = 'OFF' THEN
    RETURN NULL;
  END IF;

  IF p_event_type = 'SALE_CREATED' AND COALESCE(v_auto_sales, FALSE) = FALSE THEN
    RETURN NULL;
  END IF;

  IF p_event_type = 'PURCHASE_CREATED' AND COALESCE(v_auto_purchases, FALSE) = FALSE THEN
    RETURN NULL;
  END IF;

  INSERT INTO accounting_event_queue (
    tenant_id,
    source_module,
    event_type,
    source_id,
    payload,
    status,
    attempts,
    last_error,
    available_at,
    processed_at
  )
  VALUES (
    p_tenant_id,
    UPPER(COALESCE(p_source_module, 'UNKNOWN')),
    UPPER(p_event_type),
    p_source_id,
    COALESCE(p_payload, '{}'::jsonb),
    'PENDING',
    0,
    NULL,
    NOW(),
    NULL
  )
  ON CONFLICT (tenant_id, source_module, event_type, source_id)
  DO UPDATE SET
    payload = EXCLUDED.payload,
    status = 'PENDING',
    attempts = 0,
    last_error = NULL,
    available_at = NOW(),
    processed_at = NULL
  RETURNING event_id INTO v_event_id;

  RETURN v_event_id;

EXCEPTION WHEN OTHERS THEN
  -- Importante: no frenar operación transaccional origen (POS/Compras)
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_accounting_enqueue_event IS
  'Fail-safe: encola eventos contables sin romper operación origen.';

-- ===================================================================
-- 6) Triggers desacoplados (best-effort) para POS / Compras
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_accounting_trg_sales_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM fn_accounting_enqueue_event(
      NEW.tenant_id,
      'POS',
      'SALE_CREATED',
      NEW.sale_id,
      jsonb_build_object(
        'sale_id', NEW.sale_id,
        'sold_at', NEW.sold_at,
        'total', NEW.total,
        'status', NEW.status
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- no-op para mantener desacople
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_accounting_trg_purchases_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM fn_accounting_enqueue_event(
      NEW.tenant_id,
      'PURCHASES',
      'PURCHASE_CREATED',
      NEW.purchase_id,
      jsonb_build_object(
        'purchase_id', NEW.purchase_id,
        'created_at', NEW.created_at,
        'total', NEW.total
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- no-op para mantener desacople
    NULL;
  END;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sales'
  ) THEN
    DROP TRIGGER IF EXISTS trg_accounting_sales_enqueue ON sales;
    CREATE TRIGGER trg_accounting_sales_enqueue
    AFTER INSERT ON sales
    FOR EACH ROW
    EXECUTE FUNCTION fn_accounting_trg_sales_enqueue();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'purchases'
  ) THEN
    DROP TRIGGER IF EXISTS trg_accounting_purchases_enqueue ON purchases;
    CREATE TRIGGER trg_accounting_purchases_enqueue
    AFTER INSERT ON purchases
    FOR EACH ROW
    EXECUTE FUNCTION fn_accounting_trg_purchases_enqueue();
  END IF;
END $$;

-- ===================================================================
-- 7) Seed de cuentas para tenants existentes y nuevos
-- ===================================================================
DO $$
DECLARE
  v_tenant RECORD;
BEGIN
  FOR v_tenant IN SELECT tenant_id FROM tenants LOOP
    PERFORM fn_accounting_seed_chart_for_tenant(v_tenant.tenant_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION fn_accounting_trg_seed_chart_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM fn_accounting_seed_chart_for_tenant(NEW.tenant_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_seed_chart_new_tenant ON tenants;
CREATE TRIGGER trg_accounting_seed_chart_new_tenant
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION fn_accounting_trg_seed_chart_new_tenant();

-- ===================================================================
-- 8) RLS básico por tenant en tablas contables
-- ===================================================================
ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_event_queue ENABLE ROW LEVEL SECURITY;

-- accounting_accounts
DROP POLICY IF EXISTS accounting_accounts_select_policy ON accounting_accounts;
DROP POLICY IF EXISTS accounting_accounts_insert_policy ON accounting_accounts;
DROP POLICY IF EXISTS accounting_accounts_update_policy ON accounting_accounts;

CREATE POLICY accounting_accounts_select_policy ON accounting_accounts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_accounts.tenant_id
  )
);

CREATE POLICY accounting_accounts_insert_policy ON accounting_accounts
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_accounts.tenant_id
  )
);

CREATE POLICY accounting_accounts_update_policy ON accounting_accounts
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_accounts.tenant_id
  )
);

-- accounting_entries
DROP POLICY IF EXISTS accounting_entries_select_policy ON accounting_entries;
DROP POLICY IF EXISTS accounting_entries_insert_policy ON accounting_entries;
DROP POLICY IF EXISTS accounting_entries_update_policy ON accounting_entries;

CREATE POLICY accounting_entries_select_policy ON accounting_entries
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_entries.tenant_id
  )
);

CREATE POLICY accounting_entries_insert_policy ON accounting_entries
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_entries.tenant_id
  )
);

CREATE POLICY accounting_entries_update_policy ON accounting_entries
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_entries.tenant_id
  )
);

-- accounting_entry_lines
DROP POLICY IF EXISTS accounting_entry_lines_select_policy ON accounting_entry_lines;
DROP POLICY IF EXISTS accounting_entry_lines_insert_policy ON accounting_entry_lines;
DROP POLICY IF EXISTS accounting_entry_lines_update_policy ON accounting_entry_lines;

CREATE POLICY accounting_entry_lines_select_policy ON accounting_entry_lines
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_entry_lines.tenant_id
  )
);

CREATE POLICY accounting_entry_lines_insert_policy ON accounting_entry_lines
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_entry_lines.tenant_id
  )
);

CREATE POLICY accounting_entry_lines_update_policy ON accounting_entry_lines
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_entry_lines.tenant_id
  )
);

-- accounting_event_queue
DROP POLICY IF EXISTS accounting_event_queue_select_policy ON accounting_event_queue;
DROP POLICY IF EXISTS accounting_event_queue_insert_policy ON accounting_event_queue;
DROP POLICY IF EXISTS accounting_event_queue_update_policy ON accounting_event_queue;

CREATE POLICY accounting_event_queue_select_policy ON accounting_event_queue
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_event_queue.tenant_id
  )
);

CREATE POLICY accounting_event_queue_insert_policy ON accounting_event_queue
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_event_queue.tenant_id
  )
);

CREATE POLICY accounting_event_queue_update_policy ON accounting_event_queue
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = accounting_event_queue.tenant_id
  )
);

-- ===================================================================
-- 9) Permisos + menú por rol (habilitable)
-- ===================================================================
INSERT INTO permissions (code, description)
VALUES
  ('ACCOUNTING.VIEW', 'Ver módulo contable'),
  ('ACCOUNTING.ENTRY.CREATE', 'Crear asientos contables'),
  ('ACCOUNTING.ENTRY.POST', 'Postear asientos contables'),
  ('ACCOUNTING.CATALOG.MANAGE', 'Gestionar plan de cuentas contable'),
  ('ACCOUNTING.AI.ASSIST', 'Usar asistente IA contable'),
  ('ACCOUNTING.INTEGRATION.MANAGE', 'Gestionar integración contable POS')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order, is_active)
VALUES
  ('CONTABILIDAD', 'Contabilidad', 'mdi-scale-balance', NULL, NULL, 58, TRUE),
  ('CONTABILIDAD.PANEL', 'Centro Contable', 'mdi-calculator-variant-outline', '/accounting', 'CONTABILIDAD', 581, TRUE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  route = EXCLUDED.route,
  parent_code = EXCLUDED.parent_code,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

INSERT INTO menu_permissions (menu_item_id, permission_id)
SELECT mi.menu_item_id, p.permission_id
FROM menu_items mi
JOIN permissions p ON p.code = 'ACCOUNTING.VIEW'
WHERE mi.code = 'CONTABILIDAD.PANEL'
ON CONFLICT DO NOTHING;

-- Plantillas: por defecto visible para ADMINISTRADOR y GERENTE
INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'ADMINISTRADOR', mi.menu_item_id
FROM menu_items mi
WHERE mi.code = 'CONTABILIDAD.PANEL'
ON CONFLICT DO NOTHING;

INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'GERENTE', mi.menu_item_id
FROM menu_items mi
WHERE mi.code = 'CONTABILIDAD.PANEL'
ON CONFLICT DO NOTHING;

-- Aplicar a roles existentes
INSERT INTO role_menus (role_id, menu_item_id)
SELECT r.role_id, mi.menu_item_id
FROM roles r
JOIN menu_items mi ON mi.code = 'CONTABILIDAD.PANEL'
WHERE r.name IN ('ADMINISTRADOR', 'GERENTE')
ON CONFLICT DO NOTHING;

-- ===================================================================
-- 10) Mensaje final
-- ===================================================================
DO $$
DECLARE
  v_accounts INT;
  v_entries INT;
  v_events INT;
BEGIN
  SELECT COUNT(*) INTO v_accounts FROM accounting_accounts;
  SELECT COUNT(*) INTO v_entries FROM accounting_entries;
  SELECT COUNT(*) INTO v_events FROM accounting_event_queue;

  RAISE NOTICE '✅ Módulo contable CO instalado';
  RAISE NOTICE '  - accounting_accounts: %', v_accounts;
  RAISE NOTICE '  - accounting_entries: %', v_entries;
  RAISE NOTICE '  - accounting_event_queue: %', v_events;
  RAISE NOTICE '  - Menú: CONTABILIDAD.PANEL (/accounting)';
  RAISE NOTICE '  - Integración POS desacoplada por cola (no bloqueante)';
END $$;
