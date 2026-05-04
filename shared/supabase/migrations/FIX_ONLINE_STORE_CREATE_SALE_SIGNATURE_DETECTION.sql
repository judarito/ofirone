/* ============================================================================
   FIX_ONLINE_STORE_CREATE_SALE_SIGNATURE_DETECTION.sql
   Corrige la detección de firma de sp_create_sale() usada por pedidos online.

   Antes se comparaba pg_get_function_identity_arguments() contra textos como
   "uuid, uuid, ...". En PostgreSQL esa función suele incluir nombres de
   parámetros ("p_tenant uuid, ..."), así que el wrapper no reconocía firmas
   válidas y fallaba al sincronizar pagos gateway aprobados.
   ============================================================================
*/

CREATE OR REPLACE FUNCTION fn_online_store_create_sale(
  p_tenant UUID,
  p_location UUID,
  p_cash_session UUID,
  p_customer UUID,
  p_sold_by UUID,
  p_lines JSONB,
  p_payments JSONB,
  p_note TEXT,
  p_third_party UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sp_create_sale'
      AND oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, uuid'
  ) THEN
    EXECUTE 'SELECT public.sp_create_sale($1,$2,$3,$4,$5,$6,$7,$8,$9)'
      INTO v_sale_id
      USING p_tenant, p_location, p_cash_session, p_customer, p_sold_by, p_lines, p_payments, p_note, p_third_party;
    RETURN v_sale_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sp_create_sale'
      AND oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text'
  ) THEN
    EXECUTE 'SELECT public.sp_create_sale($1,$2,$3,$4,$5,$6,$7,$8)'
      INTO v_sale_id
      USING p_tenant, p_location, p_cash_session, p_customer, p_sold_by, p_lines, p_payments, p_note;
    RETURN v_sale_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sp_create_sale'
      AND oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, uuid, uuid, jsonb, jsonb'
  ) THEN
    EXECUTE 'SELECT public.sp_create_sale($1,$2,$3,$4,$5,$6,$7)'
      INTO v_sale_id
      USING p_tenant, p_location, p_cash_session, p_customer, p_sold_by, p_lines, p_payments;
    RETURN v_sale_id;
  END IF;

  RAISE EXCEPTION 'No se encontró una firma compatible de sp_create_sale() para confirmar el pedido online. Firmas disponibles: %',
    COALESCE(
      (
        SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY p.oid::TEXT)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'sp_create_sale'
      ),
      'ninguna'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_online_store_create_sale(UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_online_store_create_sale(UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) TO service_role;
