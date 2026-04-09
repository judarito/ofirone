-- ===================================================================
-- Hardening: cerrar tablas public historicas sin RLS o sin policies
-- ===================================================================
--
-- Objetivo:
-- - Resolver hallazgos tipo `rls_disabled_in_public`.
-- - Reducir hallazgos tipo `sensitive_columns_exposed` en tablas public
--   tenant-scoped o internas.
-- - Complementar el caso visto en produccion donde el advisor reporto
--   al menos `customers`, `locations`, `product_variants`, `products`
--   y `tenants` sin RLS habilitado.
--
-- Estrategia:
-- 1) Tablas tenant-scoped de negocio: habilitar RLS y crear baseline CRUD
--    por tenant solo si hoy no tienen policies.
-- 2) Tablas internas/no expuestas para cliente: habilitar RLS sin policies
--    para dejar deny-all a clientes.
-- 3) Lookups globales: habilitar RLS y dejar solo lectura a `authenticated`.

DO $$
DECLARE
  v_table text;
  v_policy_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'bill_of_materials',
    'bom_components',
    'bundle_compositions',
    'categories',
    'component_allocations',
    'customer_credit_accounts',
    'inventory_batches',
    'price_list_items',
    'price_lists',
    'product_barcodes',
    'product_tag_map',
    'product_tags',
    'production_order_lines',
    'production_orders',
    'production_outputs',
    'sale_line_batches',
    'sale_return_lines',
    'sale_warnings',
    'service_deliveries',
    'stock_reservations_log',
    'tenant_settings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', v_table);

    SELECT COUNT(*)
      INTO v_policy_count
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = v_table;

    IF v_policy_count = 0 THEN
      EXECUTE format(
        'CREATE POLICY rls_tenant_select ON public.%I
         FOR SELECT
         USING (tenant_id = get_current_user_tenant_id())',
        v_table
      );

      EXECUTE format(
        'CREATE POLICY rls_tenant_insert ON public.%I
         FOR INSERT
         WITH CHECK (tenant_id = get_current_user_tenant_id())',
        v_table
      );

      EXECUTE format(
        'CREATE POLICY rls_tenant_update ON public.%I
         FOR UPDATE
         USING (tenant_id = get_current_user_tenant_id())
         WITH CHECK (tenant_id = get_current_user_tenant_id())',
        v_table
      );

      EXECUTE format(
        'CREATE POLICY rls_tenant_delete ON public.%I
         FOR DELETE
         USING (tenant_id = get_current_user_tenant_id())',
        v_table
      );
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'audit_log',
    'mobile_sale_operations',
    'sale_counters',
    'stock_balances_backup'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'document_types',
    'departments',
    'cities'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', v_table);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = 'rls_lookup_read_authenticated'
    ) THEN
      EXECUTE format(
        'CREATE POLICY rls_lookup_read_authenticated ON public.%I
         FOR SELECT
         TO authenticated
         USING (true)',
        v_table
      );
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
