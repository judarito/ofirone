/* ============================================================================
   FIX COMPATIBILIDAD: fn_create_batch faltante

   Problema:
   En algunos entornos, sp_create_purchase invoca fn_create_batch(...) pero la
   función no existe (desfase de migraciones), causando error al guardar compras.

   Solución:
   Crear una versión compatible de fn_create_batch con la firma esperada por
   sp_create_purchase(UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID, TEXT).
   ============================================================================ */

CREATE OR REPLACE FUNCTION fn_create_batch(
  p_tenant UUID,
  p_variant UUID,
  p_location UUID,
  p_batch_number TEXT,
  p_expiration_date DATE,
  p_quantity NUMERIC,
  p_source_id UUID,
  p_physical_location TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_id UUID;
  v_batch_number TEXT;
  v_unit_cost NUMERIC(14,2) := 0;
  v_created_by UUID := NULL;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida para lote: %', p_quantity;
  END IF;

  -- Si la tabla de lotes no existe, no bloquear la compra.
  IF to_regclass('public.inventory_batches') IS NULL THEN
    RETURN NULL;
  END IF;

  -- Costo de referencia de la variante (best-effort).
  BEGIN
    SELECT COALESCE(pv.cost, 0)
      INTO v_unit_cost
      FROM product_variants pv
     WHERE pv.tenant_id = p_tenant
       AND pv.variant_id = p_variant;
  EXCEPTION WHEN OTHERS THEN
    v_unit_cost := 0;
  END;

  -- En algunos flujos p_source_id no es user_id (ej: purchase_id).
  -- Solo usarlo como created_by si realmente existe en users.
  SELECT u.user_id
    INTO v_created_by
    FROM users u
   WHERE u.user_id = p_source_id
   LIMIT 1;

  v_batch_number := NULLIF(BTRIM(p_batch_number), '');

  IF v_batch_number IS NULL THEN
    -- Intentar firma nueva (tenant, variant, location)
    BEGIN
      v_batch_number := fn_generate_batch_number(p_tenant, p_variant, p_location);
    EXCEPTION WHEN undefined_function THEN
      -- Fallback a firma antigua (tenant, variant)
      BEGIN
        v_batch_number := fn_generate_batch_number(p_tenant, p_variant);
      EXCEPTION WHEN undefined_function THEN
        -- Último fallback sin depender de funciones externas
        v_batch_number := format(
          'BATCH-%s-%s',
          to_char(NOW(), 'YYMMDDHH24MISSMS'),
          substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
        );
      END;
    END;
  END IF;

  INSERT INTO inventory_batches (
    tenant_id,
    location_id,
    variant_id,
    batch_number,
    expiration_date,
    on_hand,
    reserved,
    unit_cost,
    physical_location,
    is_active,
    received_at,
    created_by,
    updated_at,
    notes
  )
  VALUES (
    p_tenant,
    p_location,
    p_variant,
    v_batch_number,
    p_expiration_date,
    p_quantity,
    0,
    COALESCE(v_unit_cost, 0),
    NULLIF(BTRIM(p_physical_location), ''),
    TRUE,
    NOW(),
    v_created_by,
    NOW(),
    'Creado por compat fn_create_batch'
  )
  ON CONFLICT (tenant_id, location_id, variant_id, batch_number)
  DO UPDATE SET
    on_hand = inventory_batches.on_hand + EXCLUDED.on_hand,
    expiration_date = COALESCE(EXCLUDED.expiration_date, inventory_batches.expiration_date),
    unit_cost = CASE
      WHEN EXCLUDED.unit_cost > 0 THEN EXCLUDED.unit_cost
      ELSE inventory_batches.unit_cost
    END,
    physical_location = COALESCE(EXCLUDED.physical_location, inventory_batches.physical_location),
    is_active = TRUE,
    updated_at = NOW()
  RETURNING batch_id INTO v_batch_id;

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_batch(UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION fn_create_batch(UUID, UUID, UUID, TEXT, DATE, NUMERIC, UUID, TEXT) IS
  'Función de compatibilidad para entornos donde sp_create_purchase aún llama fn_create_batch.';

DO $$
BEGIN
  RAISE NOTICE '✓ fn_create_batch (compat) creada/actualizada';
END;
$$;
