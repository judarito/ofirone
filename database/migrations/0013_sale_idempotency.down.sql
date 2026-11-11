DROP INDEX IF EXISTS public.sales_tenant_idempotency_idx;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_idempotency_key_valid;
ALTER TABLE public.sales DROP COLUMN IF EXISTS idempotency_key;
