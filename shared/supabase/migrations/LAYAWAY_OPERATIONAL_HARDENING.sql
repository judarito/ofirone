-- =========================================================
-- Layaway operational hardening
-- - respeta reserve_stock_on_layaway al crear contratos
-- - evita liberar reservas inexistentes al cancelar/completar
-- - expira automaticamente contratos vencidos con saldo
-- =========================================================

ALTER TABLE layaway_contracts
  ADD COLUMN IF NOT EXISTS stock_reserved_on_create boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN layaway_contracts.stock_reserved_on_create IS
'Indica si el contrato reservo inventario al momento de crearse.';

CREATE OR REPLACE FUNCTION sp_create_layaway(
  p_tenant uuid,
  p_location uuid,
  p_customer uuid,
  p_created_by uuid,
  p_items jsonb,
  p_due_date date,
  p_note text DEFAULT NULL,
  p_initial_payment jsonb DEFAULT NULL,
  p_installments jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_layaway uuid;
  v_item jsonb;
  v_variant uuid;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_discount_value numeric(14,2);
  v_discount_type text;
  v_discount_calculated numeric(14,2);
  v_tax_rate numeric;
  v_price_includes_tax boolean;
  v_line_subtotal numeric(14,2);
  v_price_after_discount numeric(14,2);
  v_tax_breakdown jsonb;
  v_base_amount numeric(14,2);
  v_tax_amount numeric(14,2);
  v_line_total numeric(14,2);
  v_available numeric(14,3);
  v_should_reserve boolean := true;
  v_pm_code text;
  v_pm_id uuid;
  v_pay_amount numeric(14,2);
  v_pay_ref text;
  v_cash_session uuid;
  v_inst jsonb;
  v_inst_due date;
  v_inst_amount numeric(14,2);
BEGIN
  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'Customer is required for layaway';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Layaway must have at least one item';
  END IF;

  SELECT COALESCE(ts.reserve_stock_on_layaway, true)
  INTO v_should_reserve
  FROM tenant_settings ts
  WHERE ts.tenant_id = p_tenant;

  v_should_reserve := COALESCE(v_should_reserve, true);

  INSERT INTO layaway_contracts(
    tenant_id,
    location_id,
    customer_id,
    created_by,
    created_at,
    status,
    currency_code,
    due_date,
    note,
    initial_deposit,
    paid_total,
    balance,
    subtotal,
    discount_total,
    tax_total,
    total,
    stock_reserved_on_create
  )
  VALUES(
    p_tenant,
    p_location,
    p_customer,
    p_created_by,
    now(),
    'ACTIVE',
    'COP',
    p_due_date,
    p_note,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    v_should_reserve
  )
  RETURNING layaway_id INTO v_layaway;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount_type := COALESCE(v_item->>'discount_type', 'AMOUNT');
    v_discount_value := COALESCE((v_item->>'discount')::numeric, 0);

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty for variant %', v_variant;
    END IF;
    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit_price for variant %', v_variant;
    END IF;
    IF v_discount_value < 0 THEN
      RAISE EXCEPTION 'Invalid discount for variant %', v_variant;
    END IF;

    SELECT pv.price_includes_tax
    INTO v_price_includes_tax
    FROM product_variants pv
    WHERE pv.tenant_id = p_tenant
      AND pv.variant_id = v_variant
      AND pv.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    SELECT (sb.on_hand - sb.reserved)
    INTO v_available
    FROM stock_balances sb
    WHERE sb.tenant_id = p_tenant
      AND sb.location_id = p_location
      AND sb.variant_id = v_variant;

    IF v_available IS NULL THEN
      RAISE EXCEPTION 'No existe registro de stock para la variante % (tenant=% location=%)',
        v_variant, p_tenant, p_location;
    END IF;

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'Stock disponible insuficiente para la variante % (disponible=%, requerido=%)',
        v_variant, v_available, v_qty;
    END IF;

    v_line_subtotal := ROUND(v_qty * v_unit_price, 2);
    v_discount_calculated := fn_calculate_discount(v_line_subtotal, v_discount_value, v_discount_type);
    v_price_after_discount := v_line_subtotal - v_discount_calculated;
    IF v_price_after_discount < 0 THEN
      v_price_after_discount := 0;
    END IF;

    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);
    v_tax_breakdown := fn_calculate_tax_breakdown(
      v_price_after_discount,
      v_tax_rate,
      v_price_includes_tax
    );

    v_base_amount := (v_tax_breakdown->>'base')::numeric;
    v_tax_amount := (v_tax_breakdown->>'tax')::numeric;
    v_line_total := (v_tax_breakdown->>'total')::numeric;

    INSERT INTO layaway_items(
      tenant_id,
      layaway_id,
      variant_id,
      quantity,
      unit_price,
      discount_type,
      discount_amount,
      tax_amount,
      line_total,
      tax_detail
    )
    VALUES(
      p_tenant,
      v_layaway,
      v_variant,
      v_qty,
      v_unit_price,
      v_discount_type,
      v_discount_value,
      v_tax_amount,
      v_line_total,
      jsonb_build_object(
        'rate', v_tax_rate,
        'price_includes_tax', v_price_includes_tax,
        'base_amount', v_base_amount
      )
    );

    IF v_should_reserve THEN
      PERFORM fn_apply_stock_reservation_delta(p_tenant, p_location, v_variant, v_qty);

      INSERT INTO stock_reservations_log(
        tenant_id,
        layaway_id,
        location_id,
        variant_id,
        quantity,
        action,
        created_at,
        created_by
      )
      VALUES(
        p_tenant,
        v_layaway,
        p_location,
        v_variant,
        v_qty,
        'RESERVE',
        now(),
        p_created_by
      );
    END IF;
  END LOOP;

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'array' AND jsonb_array_length(p_installments) > 0 THEN
    FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments)
    LOOP
      v_inst_due := (v_inst->>'due_date')::date;
      v_inst_amount := (v_inst->>'amount')::numeric;
      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid installment amount';
      END IF;

      INSERT INTO layaway_installments(tenant_id, layaway_id, due_date, amount, status)
      VALUES (p_tenant, v_layaway, v_inst_due, v_inst_amount, 'PENDING');
    END LOOP;
  END IF;

  IF p_initial_payment IS NOT NULL THEN
    v_pm_code := upper(p_initial_payment->>'payment_method_code');
    v_pay_amount := (p_initial_payment->>'amount')::numeric;
    v_pay_ref := p_initial_payment->>'reference';
    v_cash_session := NULLIF(p_initial_payment->>'cash_session_id', '')::uuid;

    IF v_pay_amount <= 0 THEN
      RAISE EXCEPTION 'Payment amount must be positive';
    END IF;

    SELECT pm.payment_method_id
    INTO v_pm_id
    FROM payment_methods pm
    WHERE pm.tenant_id = p_tenant
      AND upper(pm.code) = v_pm_code
      AND pm.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment method not found or inactive: %', v_pm_code;
    END IF;

    IF v_cash_session IS NOT NULL THEN
      PERFORM 1
      FROM cash_sessions cs
      WHERE cs.tenant_id = p_tenant
        AND cs.cash_session_id = v_cash_session
        AND cs.status = 'OPEN';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Cash session is not OPEN or not found';
      END IF;
    END IF;

    INSERT INTO layaway_payments(
      tenant_id,
      layaway_id,
      payment_method_id,
      cash_session_id,
      amount,
      reference,
      paid_at,
      paid_by
    )
    VALUES(
      p_tenant,
      v_layaway,
      v_pm_id,
      v_cash_session,
      v_pay_amount,
      v_pay_ref,
      now(),
      p_created_by
    );
  END IF;

  PERFORM fn_recalc_layaway_totals(p_tenant, v_layaway);

  RETURN v_layaway;
END;
$$;

CREATE OR REPLACE FUNCTION sp_complete_layaway_to_sale(
  p_tenant uuid,
  p_layaway uuid,
  p_sold_by uuid,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_balance numeric(14,2);
  v_location uuid;
  v_customer uuid;
  v_stock_reserved_on_create boolean := true;
  v_sale_id uuid;
  v_sale_number bigint;
  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_tax numeric(14,2);
  v_total numeric(14,2);
  v_item record;
  v_pm_layaway uuid;
BEGIN
  SELECT
    status,
    balance,
    location_id,
    customer_id,
    subtotal,
    discount_total,
    tax_total,
    total,
    stock_reserved_on_create
  INTO
    v_status,
    v_balance,
    v_location,
    v_customer,
    v_subtotal,
    v_discount,
    v_tax,
    v_total,
    v_stock_reserved_on_create
  FROM layaway_contracts
  WHERE tenant_id = p_tenant
    AND layaway_id = p_layaway
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layaway contract not found';
  END IF;

  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Layaway contract must be ACTIVE to complete (status=%)', v_status;
  END IF;

  IF ROUND(v_balance, 2) <> 0 THEN
    RAISE EXCEPTION 'Layaway balance must be 0 to complete (balance=%)', v_balance;
  END IF;

  SELECT payment_method_id
  INTO v_pm_layaway
  FROM payment_methods
  WHERE tenant_id = p_tenant
    AND code = 'LAYAWAY'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment method LAYAWAY missing for tenant';
  END IF;

  v_sale_number := fn_next_sale_number(p_tenant, v_location);

  INSERT INTO sales(
    tenant_id,
    location_id,
    cash_session_id,
    sale_number,
    status,
    sold_at,
    customer_id,
    sold_by,
    subtotal,
    discount_total,
    tax_total,
    total,
    note
  )
  VALUES (
    p_tenant,
    v_location,
    null,
    v_sale_number,
    'COMPLETED',
    now(),
    v_customer,
    p_sold_by,
    ROUND(v_subtotal, 2),
    ROUND(v_discount, 2),
    ROUND(v_tax, 2),
    ROUND(v_total, 2),
    COALESCE(p_note, '') || ' | FACTURA GENERADA DESDE PLAN SEPARE'
  )
  RETURNING sale_id INTO v_sale_id;

  FOR v_item IN
    SELECT li.variant_id, li.quantity, li.unit_price, li.discount_amount, li.tax_amount, li.line_total, li.tax_detail
    FROM layaway_items li
    WHERE li.tenant_id = p_tenant
      AND li.layaway_id = p_layaway
  LOOP
    INSERT INTO sale_lines(
      tenant_id,
      sale_id,
      variant_id,
      quantity,
      unit_price,
      unit_cost,
      discount_amount,
      tax_amount,
      line_total,
      tax_detail
    )
    VALUES (
      p_tenant,
      v_sale_id,
      v_item.variant_id,
      v_item.quantity,
      v_item.unit_price,
      0,
      v_item.discount_amount,
      v_item.tax_amount,
      v_item.line_total,
      v_item.tax_detail
    );

    IF COALESCE(v_stock_reserved_on_create, true) THEN
      PERFORM fn_apply_stock_reservation_delta(p_tenant, v_location, v_item.variant_id, -v_item.quantity);

      INSERT INTO stock_reservations_log(
        tenant_id,
        layaway_id,
        location_id,
        variant_id,
        quantity,
        action,
        created_at,
        created_by
      )
      VALUES(
        p_tenant,
        p_layaway,
        v_location,
        v_item.variant_id,
        v_item.quantity,
        'RELEASE',
        now(),
        p_sold_by
      );
    END IF;

    INSERT INTO inventory_moves(
      tenant_id,
      move_type,
      location_id,
      variant_id,
      quantity,
      unit_cost,
      source,
      source_id,
      note,
      created_at,
      created_by
    )
    VALUES(
      p_tenant,
      'SALE_OUT',
      v_location,
      v_item.variant_id,
      v_item.quantity,
      0,
      'SALE',
      v_sale_id,
      'Salida por factura de Plan Separe',
      now(),
      p_sold_by
    );

    PERFORM fn_apply_stock_delta(p_tenant, v_location, v_item.variant_id, -v_item.quantity);
  END LOOP;

  INSERT INTO sale_payments(
    tenant_id,
    sale_id,
    payment_method_id,
    cash_session_id,
    amount,
    reference,
    paid_at
  )
  VALUES(
    p_tenant,
    v_sale_id,
    v_pm_layaway,
    null,
    ROUND(v_total, 2),
    CONCAT('LAYAWAY:', p_layaway::text),
    now()
  );

  UPDATE layaway_contracts
  SET status = 'COMPLETED',
      sale_id = v_sale_id
  WHERE tenant_id = p_tenant
    AND layaway_id = p_layaway;

  RETURN v_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION sp_cancel_layaway(
  p_tenant uuid,
  p_layaway uuid,
  p_cancelled_by uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_location uuid;
  v_item record;
  v_stock_reserved_on_create boolean := true;
BEGIN
  IF p_status NOT IN ('CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Invalid status for cancel: %', p_status;
  END IF;

  SELECT status, location_id, stock_reserved_on_create
  INTO v_status, v_location, v_stock_reserved_on_create
  FROM layaway_contracts
  WHERE tenant_id = p_tenant
    AND layaway_id = p_layaway
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layaway contract not found';
  END IF;

  IF v_status IN ('COMPLETED') THEN
    RAISE EXCEPTION 'Cannot cancel a COMPLETED layaway';
  END IF;

  IF v_status IN ('CANCELLED', 'EXPIRED') THEN
    RETURN;
  END IF;

  IF COALESCE(v_stock_reserved_on_create, true) THEN
    FOR v_item IN
      SELECT variant_id, quantity
      FROM layaway_items
      WHERE tenant_id = p_tenant
        AND layaway_id = p_layaway
    LOOP
      PERFORM fn_apply_stock_reservation_delta(p_tenant, v_location, v_item.variant_id, -v_item.quantity);

      INSERT INTO stock_reservations_log(
        tenant_id,
        layaway_id,
        location_id,
        variant_id,
        quantity,
        action,
        created_at,
        created_by
      )
      VALUES(
        p_tenant,
        p_layaway,
        v_location,
        v_item.variant_id,
        v_item.quantity,
        'RELEASE',
        now(),
        p_cancelled_by
      );
    END LOOP;
  END IF;

  UPDATE layaway_contracts
  SET status = p_status,
      note = trim(both from coalesce(note, '') || ' | ' || coalesce(p_note, ''))
  WHERE tenant_id = p_tenant
    AND layaway_id = p_layaway;
END;
$$;

CREATE OR REPLACE FUNCTION fn_expire_due_layaways(
  p_tenant uuid DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_contract record;
  v_expired_count integer := 0;
BEGIN
  FOR v_contract IN
    SELECT tenant_id, layaway_id, created_by
    FROM layaway_contracts
    WHERE status = 'ACTIVE'
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
      AND COALESCE(balance, 0) > 0
      AND (p_tenant IS NULL OR tenant_id = p_tenant)
    ORDER BY due_date ASC
  LOOP
    PERFORM sp_cancel_layaway(
      v_contract.tenant_id,
      v_contract.layaway_id,
      COALESCE(p_actor, v_contract.created_by),
      'EXPIRED',
      'Expirado automaticamente por vencimiento'
    );
    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$;
