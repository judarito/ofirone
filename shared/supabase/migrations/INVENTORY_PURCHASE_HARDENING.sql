-- ============================================================================
-- Hardening operativo de inventario / compras / kardex
-- - Ajustes e ingresos rapidos atomicos
-- - Kardex enriquecido con signo real
-- - Traslados validan stock disponible (on_hand - reserved)
-- ============================================================================

CREATE OR REPLACE VIEW vw_stock_calculated AS
SELECT
  im.tenant_id,
  im.location_id,
  l.name AS location_name,
  im.variant_id,
  pv.sku,
  p.product_id,
  p.name AS product_name,
  pv.variant_name,
  SUM(
    CASE
      WHEN im.move_type IN ('PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN', 'PRODUCTION_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT') THEN im.quantity
      WHEN im.move_type IN ('SALE_OUT', 'TRANSFER_OUT', 'PURCHASE_RETURN_OUT', 'PRODUCTION_OUT', 'ADJUSTMENT_OUT') THEN -im.quantity
      ELSE 0
    END
  ) AS on_hand
FROM inventory_moves im
JOIN locations l ON l.location_id = im.location_id
JOIN product_variants pv ON pv.variant_id = im.variant_id
JOIN products p ON p.product_id = pv.product_id
GROUP BY im.tenant_id, im.location_id, l.name, im.variant_id, pv.sku, p.product_id, p.name, pv.variant_name;

CREATE OR REPLACE VIEW vw_kardex AS
SELECT
  im.tenant_id,
  im.location_id,
  l.name AS location_name,
  im.variant_id,
  pv.sku,
  p.name AS product_name,
  pv.variant_name,
  im.created_at,
  im.move_type,
  im.source,
  im.source_id,
  CASE
    WHEN im.move_type IN ('PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN', 'PRODUCTION_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT') THEN im.quantity
    WHEN im.move_type IN ('SALE_OUT', 'TRANSFER_OUT', 'PURCHASE_RETURN_OUT', 'PRODUCTION_OUT', 'ADJUSTMENT_OUT') THEN -im.quantity
    ELSE 0
  END AS signed_qty,
  im.quantity AS abs_qty,
  im.unit_cost,
  im.note,
  im.created_by,
  im.inventory_move_id,
  im.to_location_id,
  tl.name AS to_location_name,
  p.product_id,
  u.full_name AS created_by_name,
  CASE
    WHEN im.move_type IN ('PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN', 'PRODUCTION_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT') THEN TRUE
    WHEN im.move_type IN ('SALE_OUT', 'TRANSFER_OUT', 'PURCHASE_RETURN_OUT', 'PRODUCTION_OUT', 'ADJUSTMENT_OUT') THEN FALSE
    ELSE NULL
  END AS is_incoming
FROM inventory_moves im
JOIN locations l ON l.location_id = im.location_id
LEFT JOIN locations tl ON tl.location_id = im.to_location_id
JOIN product_variants pv ON pv.variant_id = im.variant_id
JOIN products p ON p.product_id = pv.product_id
LEFT JOIN users u ON u.user_id = im.created_by;

GRANT SELECT ON vw_stock_calculated TO authenticated;
GRANT SELECT ON vw_kardex TO authenticated;

CREATE OR REPLACE FUNCTION trg_update_average_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_cost NUMERIC(14,2);
  v_new_price NUMERIC(14,2);
BEGIN
  IF NEW.move_type IN ('PURCHASE_IN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT') AND NEW.unit_cost > 0 THEN
    v_new_cost := fn_update_average_cost(
      NEW.tenant_id,
      NEW.location_id,
      NEW.variant_id,
      NEW.quantity,
      NEW.unit_cost
    );

    v_new_price := fn_calculate_sale_price(NEW.tenant_id, NEW.variant_id, v_new_cost);

    UPDATE product_variants
       SET price = v_new_price
     WHERE tenant_id = NEW.tenant_id
       AND variant_id = NEW.variant_id
       AND pricing_method = 'MARKUP';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sp_create_inventory_adjustment(
  p_tenant UUID,
  p_location UUID,
  p_variant UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC DEFAULT 0,
  p_is_increase BOOLEAN DEFAULT TRUE,
  p_created_by UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_move_id UUID;
  v_move_type TEXT;
  v_delta NUMERIC(14,3);
  v_on_hand NUMERIC(14,3) := 0;
  v_reserved NUMERIC(14,3) := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Unit cost must be greater than or equal to 0';
  END IF;

  PERFORM 1
  FROM product_variants pv
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found/active: %', p_variant;
  END IF;

  IF COALESCE(p_is_increase, TRUE) = FALSE THEN
    SELECT COALESCE(on_hand, 0), COALESCE(reserved, 0)
    INTO v_on_hand, v_reserved
    FROM stock_balances
    WHERE tenant_id = p_tenant
      AND location_id = p_location
      AND variant_id = p_variant;

    IF GREATEST(v_on_hand - v_reserved, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient available stock. Available: %, reserved: %, requested: %',
        GREATEST(v_on_hand - v_reserved, 0), v_reserved, p_quantity;
    END IF;
  END IF;

  v_move_type := CASE WHEN COALESCE(p_is_increase, TRUE) THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END;
  v_delta := CASE WHEN COALESCE(p_is_increase, TRUE) THEN p_quantity ELSE -p_quantity END;

  INSERT INTO inventory_moves (
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
  ) VALUES (
    p_tenant,
    v_move_type,
    p_location,
    p_variant,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    'MANUAL',
    NULL,
    p_note,
    NOW(),
    p_created_by
  )
  RETURNING inventory_move_id INTO v_move_id;

  PERFORM fn_apply_stock_delta(p_tenant, p_location, p_variant, v_delta);

  RETURN v_move_id;
END;
$$;

CREATE OR REPLACE FUNCTION sp_create_manual_purchase_ingress(
  p_tenant UUID,
  p_location UUID,
  p_variant UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC DEFAULT 0,
  p_created_by UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_move_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Unit cost must be greater than or equal to 0';
  END IF;

  PERFORM 1
  FROM product_variants pv
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found/active: %', p_variant;
  END IF;

  INSERT INTO inventory_moves (
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
  ) VALUES (
    p_tenant,
    'PURCHASE_IN',
    p_location,
    p_variant,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    'MANUAL_PURCHASE',
    NULL,
    p_note,
    NOW(),
    p_created_by
  )
  RETURNING inventory_move_id INTO v_move_id;

  PERFORM fn_apply_stock_delta(p_tenant, p_location, p_variant, p_quantity);

  RETURN v_move_id;
END;
$$;

CREATE OR REPLACE FUNCTION sp_create_transfer_request(
  p_tenant UUID,
  p_from_location UUID,
  p_to_location UUID,
  p_variant UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_transfer_id UUID;
  v_on_hand NUMERIC(14,3) := 0;
  v_reserved NUMERIC(14,3) := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  IF p_from_location = p_to_location THEN
    RAISE EXCEPTION 'Source and destination locations must be different';
  END IF;

  SELECT COALESCE(on_hand, 0), COALESCE(reserved, 0)
  INTO v_on_hand, v_reserved
  FROM stock_balances
  WHERE tenant_id = p_tenant
    AND location_id = p_from_location
    AND variant_id = p_variant;

  IF GREATEST(v_on_hand - v_reserved, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient available stock at source. Available: %, reserved: %, requested: %',
      GREATEST(v_on_hand - v_reserved, 0), v_reserved, p_quantity;
  END IF;

  INSERT INTO transfer_requests (
    tenant_id,
    from_location_id,
    to_location_id,
    variant_id,
    quantity,
    unit_cost,
    note,
    created_by
  ) VALUES (
    p_tenant,
    p_from_location,
    p_to_location,
    p_variant,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    p_note,
    p_created_by
  )
  RETURNING transfer_id INTO v_transfer_id;

  INSERT INTO inventory_moves (
    tenant_id,
    move_type,
    location_id,
    to_location_id,
    variant_id,
    quantity,
    unit_cost,
    source,
    source_id,
    note,
    created_at,
    created_by
  ) VALUES (
    p_tenant,
    'TRANSFER_OUT',
    p_from_location,
    p_to_location,
    p_variant,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    'TRANSFER_REQUEST',
    v_transfer_id,
    COALESCE(p_note, 'Traslado en transito'),
    NOW(),
    p_created_by
  );

  PERFORM fn_apply_stock_delta(p_tenant, p_from_location, p_variant, -p_quantity);

  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_create_inventory_adjustment(UUID, UUID, UUID, NUMERIC, NUMERIC, BOOLEAN, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sp_create_manual_purchase_ingress(UUID, UUID, UUID, NUMERIC, NUMERIC, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sp_create_transfer_request(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
