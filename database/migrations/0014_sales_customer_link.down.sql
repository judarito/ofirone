DROP INDEX IF EXISTS public.sales_customer_page_idx;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_customer_fk;
ALTER TABLE public.sales DROP COLUMN IF EXISTS customer_id;
