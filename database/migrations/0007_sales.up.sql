-- PostgreSQL >= 15. Sales document, lines and payments.
-- Inventory and accounting effects are coordinated by later use cases.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.sales (
    sale_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    created_by_identity_id uuid,
    sale_number bigint NOT NULL,
    status text NOT NULL DEFAULT 'completed',
    sold_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    subtotal numeric(19,6) NOT NULL DEFAULT 0,
    tax_total numeric(19,6) NOT NULL DEFAULT 0,
    discount_total numeric(19,6) NOT NULL DEFAULT 0,
    total numeric(19,6) NOT NULL DEFAULT 0,
    note text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, sale_id),
    UNIQUE (tenant_id, location_id, sale_number),
    FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.locations (tenant_id, location_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_identity_id)
        REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    CONSTRAINT sales_number_positive CHECK (sale_number > 0),
    CONSTRAINT sales_status_valid CHECK (status IN ('draft', 'completed', 'voided', 'returned', 'partially_returned')),
    CONSTRAINT sales_subtotal_valid CHECK (subtotal >= 0),
    CONSTRAINT sales_tax_valid CHECK (tax_total >= 0),
    CONSTRAINT sales_discount_valid CHECK (discount_total >= 0),
    CONSTRAINT sales_total_valid CHECK (total >= 0),
    CONSTRAINT sales_total_equation CHECK (total = subtotal + tax_total - discount_total)
);
CREATE INDEX sales_page_idx ON public.sales (tenant_id, sold_at DESC, sale_id DESC);
CREATE INDEX sales_location_page_idx ON public.sales (tenant_id, location_id, sold_at DESC, sale_id DESC);
CREATE TRIGGER sales_updated_at BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.sale_lines (
    sale_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    line_number integer NOT NULL,
    quantity numeric(19,6) NOT NULL,
    unit_price numeric(19,6) NOT NULL,
    discount_total numeric(19,6) NOT NULL DEFAULT 0,
    tax_total numeric(19,6) NOT NULL DEFAULT 0,
    line_total numeric(19,6) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, sale_line_id),
    UNIQUE (tenant_id, sale_id, line_number),
    FOREIGN KEY (tenant_id, sale_id)
        REFERENCES public.sales (tenant_id, sale_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, variant_id)
        REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE RESTRICT,
    CONSTRAINT sale_lines_number_positive CHECK (line_number > 0),
    CONSTRAINT sale_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT sale_lines_price_valid CHECK (unit_price >= 0),
    CONSTRAINT sale_lines_discount_valid CHECK (discount_total >= 0),
    CONSTRAINT sale_lines_tax_valid CHECK (tax_total >= 0),
    CONSTRAINT sale_lines_total_valid CHECK (line_total >= 0)
);
CREATE INDEX sale_lines_sale_idx ON public.sale_lines (tenant_id, sale_id, line_number, sale_line_id);
CREATE INDEX sale_lines_variant_idx ON public.sale_lines (tenant_id, variant_id, sale_line_id);

CREATE TABLE public.sale_payments (
    payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    payment_method_id uuid NOT NULL,
    amount numeric(19,6) NOT NULL,
    reference text,
    paid_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, payment_id),
    FOREIGN KEY (tenant_id, sale_id)
        REFERENCES public.sales (tenant_id, sale_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, payment_method_id)
        REFERENCES public.payment_methods (tenant_id, payment_method_id) ON DELETE RESTRICT,
    CONSTRAINT sale_payments_amount_positive CHECK (amount > 0)
);
CREATE INDEX sale_payments_sale_idx ON public.sale_payments (tenant_id, sale_id, paid_at, payment_id);
CREATE INDEX sale_payments_page_idx ON public.sale_payments (tenant_id, paid_at DESC, payment_id DESC);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['sales', 'sale_lines', 'sale_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (tenant_id = app_private.current_tenant_id()) WITH CHECK (tenant_id = app_private.current_tenant_id())',
            table_name
        );
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', table_name);
    END LOOP;
END;
$$;
