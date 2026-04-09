-- ===================================================================
-- Fix: Permitir procesamiento de cola contable desde service_role
-- Fecha: 2026-03-11
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

  v_account_cash UUID;
  v_account_sales UUID;
  v_account_inventory UUID;
  v_account_payables UUID;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'tenant_id es requerido');
  END IF;

  -- Usuario normal: requiere pertenecer al tenant
  -- service_role: permitido para workers automáticos
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

  SELECT account_id INTO v_account_cash
  FROM accounting_accounts
  WHERE tenant_id = p_tenant_id AND code = '110505' AND is_active = TRUE AND is_postable = TRUE
  LIMIT 1;

  SELECT account_id INTO v_account_sales
  FROM accounting_accounts
  WHERE tenant_id = p_tenant_id AND code = '413595' AND is_active = TRUE AND is_postable = TRUE
  LIMIT 1;

  SELECT account_id INTO v_account_inventory
  FROM accounting_accounts
  WHERE tenant_id = p_tenant_id AND code = '143505' AND is_active = TRUE AND is_postable = TRUE
  LIMIT 1;

  SELECT account_id INTO v_account_payables
  FROM accounting_accounts
  WHERE tenant_id = p_tenant_id AND code = '220505' AND is_active = TRUE AND is_postable = TRUE
  LIMIT 1;

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
        IF v_account_cash IS NULL OR v_account_sales IS NULL THEN
          RAISE EXCEPTION 'Faltan cuentas base para ventas (110505/413595)';
        END IF;

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

        IF COALESCE(v_sale.status, '') = 'VOIDED' OR COALESCE(v_sale.total, 0) <= 0 THEN
          UPDATE accounting_event_queue
          SET status = 'SKIPPED',
              processed_at = NOW(),
              last_error = 'Venta anulada o total no válido'
          WHERE event_id = v_event.event_id;

          v_skipped := v_skipped + 1;
          CONTINUE;
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
          'Asiento automático venta POS #' || COALESCE(v_sale.sale_number::TEXT, ''),
          'POSTED',
          v_sale.sold_by,
          v_sale.sold_by,
          NOW(),
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
            'Ingreso de efectivo por venta POS',
            ROUND(v_sale.total, 2),
            0
          ),
          (
            v_entry_id,
            p_tenant_id,
            2,
            v_account_sales,
            'Reconocimiento de ingreso por venta POS',
            0,
            ROUND(v_sale.total, 2)
          );

      ELSIF v_event.event_type = 'PURCHASE_CREATED' THEN
        IF v_account_inventory IS NULL OR v_account_payables IS NULL THEN
          RAISE EXCEPTION 'Faltan cuentas base para compras (143505/220505)';
        END IF;

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

        IF COALESCE(v_purchase.total, 0) <= 0 THEN
          UPDATE accounting_event_queue
          SET status = 'SKIPPED',
              processed_at = NOW(),
              last_error = 'Compra con total no válido'
          WHERE event_id = v_event.event_id;

          v_skipped := v_skipped + 1;
          CONTINUE;
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
          'Asiento automático compra #' || SUBSTRING(v_purchase.purchase_id::TEXT, 1, 8),
          'POSTED',
          v_purchase.created_by,
          v_purchase.created_by,
          NOW(),
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
            'Reconocimiento de inventario por compra',
            ROUND(v_purchase.total, 2),
            0
          ),
          (
            v_entry_id,
            p_tenant_id,
            2,
            v_account_payables,
            'Reconocimiento de obligación con proveedor',
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
