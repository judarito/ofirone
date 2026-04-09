/* ============================================================================
   FIX: sp_create_purchase con lotes

   Problema:
   sp_create_purchase crea lote con fn_create_batch(...) y después vuelve a
   llamar fn_apply_stock_delta(...). En entornos con sistema de lotes, eso puede
   intentar crear lote genérico sin vencimiento y fallar para variantes que
   requieren expiration_date.

   Solución:
   Si la línea ya fue manejada por fn_create_batch, NO aplicar fn_apply_stock_delta
   en esa misma línea.
   ============================================================================ */

CREATE OR REPLACE FUNCTION sp_create_purchase(
  p_tenant      UUID,
  p_location    UUID,
  p_supplier_id UUID,
  p_created_by  UUID,
  p_lines       JSONB,
  p_note        TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase_id UUID;
  v_total       NUMERIC(14,2) := 0;
  v_line        JSONB;
  v_variant     UUID;
  v_qty         NUMERIC(14,3);
  v_unit_cost   NUMERIC(14,2);
  v_line_total  NUMERIC(14,2);
  v_batch_handled BOOLEAN;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase must have at least one line';
  END IF;

  -- Crear cabecera de compra
  INSERT INTO purchases (tenant_id, location_id, supplier_id, note, created_by)
  VALUES (p_tenant, p_location, p_supplier_id, p_note, p_created_by)
  RETURNING purchase_id INTO v_purchase_id;

  -- Procesar líneas
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_batch_handled := FALSE;
    v_variant   := (v_line->>'variant_id')::UUID;
    v_qty       := (v_line->>'qty')::NUMERIC;
    v_unit_cost := (v_line->>'unit_cost')::NUMERIC;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty for variant %', v_variant;
    END IF;
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit_cost for variant %', v_variant;
    END IF;

    -- Validar variante activa
    PERFORM 1
      FROM product_variants pv
     WHERE pv.tenant_id = p_tenant
       AND pv.variant_id = v_variant
       AND pv.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    v_line_total := ROUND(v_qty * v_unit_cost, 2);

    -- Lote / vencimiento (opcional)
    IF NULLIF(v_line->>'batch_number', '') IS NOT NULL
       OR NULLIF(v_line->>'expiration_date', '') IS NOT NULL
    THEN
      PERFORM fn_create_batch(
        p_tenant,
        v_variant,
        p_location,
        NULLIF(v_line->>'batch_number', ''),
        CASE
          WHEN NULLIF(v_line->>'expiration_date', '') IS NULL THEN NULL
          ELSE (v_line->>'expiration_date')::DATE
        END,
        v_qty,
        v_purchase_id,
        NULLIF(v_line->>'physical_location', '')
      );
      v_batch_handled := TRUE;
    END IF;

    -- Movimiento de inventario
    INSERT INTO inventory_moves(
      tenant_id, move_type, location_id, variant_id, quantity, unit_cost,
      source, source_id, note, created_at, created_by
    ) VALUES (
      p_tenant, 'PURCHASE_IN', p_location, v_variant, v_qty, v_unit_cost,
      'PURCHASE', v_purchase_id, p_note, NOW(), p_created_by
    );

    -- Solo aplicar delta directo si NO se manejó por lotes.
    IF NOT v_batch_handled THEN
      PERFORM fn_apply_stock_delta(p_tenant, p_location, v_variant, v_qty);
    END IF;

    v_total := v_total + v_line_total;
  END LOOP;

  -- Actualizar total en cabecera
  UPDATE purchases SET total = v_total WHERE purchase_id = v_purchase_id;

  RETURN v_purchase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_create_purchase(UUID, UUID, UUID, UUID, JSONB, TEXT) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✓ sp_create_purchase corregido: skip fn_apply_stock_delta cuando la línea usa fn_create_batch';
END;
$$;

