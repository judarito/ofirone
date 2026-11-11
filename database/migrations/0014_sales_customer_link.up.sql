-- Optional customer attribution for sales, tenant-safe.
ALTER TABLE public.sales ADD COLUMN customer_id uuid;
ALTER TABLE public.sales ADD CONSTRAINT sales_customer_fk
    FOREIGN KEY (tenant_id, customer_id) REFERENCES public.customers (tenant_id, customer_id)
    ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.sales VALIDATE CONSTRAINT sales_customer_fk;
CREATE INDEX sales_customer_page_idx ON public.sales (tenant_id, customer_id, sold_at DESC, sale_id DESC) WHERE customer_id IS NOT NULL;
COMMENT ON COLUMN public.sales.customer_id IS 'Cliente de la venta; NULL = venta anónima. FK compuesta por tenant.';
