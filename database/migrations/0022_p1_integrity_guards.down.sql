-- 0022_p1_integrity_guards.down.sql
DROP TRIGGER IF EXISTS purchases_status_guard ON public.purchases;
DROP FUNCTION IF EXISTS app_private.purchases_status_guard();
DROP TRIGGER IF EXISTS supplier_payment_sync ON public.supplier_payable_payments;
DROP TRIGGER IF EXISTS supplier_payment_guard ON public.supplier_payable_payments;
DROP FUNCTION IF EXISTS app_private.supplier_payment_sync();
DROP FUNCTION IF EXISTS app_private.supplier_payment_guard();
DROP INDEX IF EXISTS public.sales_layaway_unique_idx;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_layaway_fk;
ALTER TABLE public.sales DROP COLUMN IF EXISTS layaway_contract_id;
