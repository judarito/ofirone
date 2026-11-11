-- PostgreSQL >= 15. Purchases and purchase lines.
-- Inventory receipt and payable settlement are coordinated by later use cases.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.purchases (
    purchase_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    created_by_identity_id uuid,
    purchase_number bigint NOT NULL,
    status text NOT NULL DEFAULT 'received',
    purchased_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    subtotal numeric(19,6) NOT NULL DEFAULT 0,
    tax_total numeric(19,6) NOT NULL DEFAULT 0,
    discount_total numeric(19,6) NOT NULL DEFAULT 0,
    total numeric(19,6) NOT NULL DEFAULT 0,
    note text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, purchase_id),
    UNIQUE (tenant_id, location_id, purchase_number),
    FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.locations (tenant_id, location_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES public.third_parties (tenant_id, third_party_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_identity_id)
        REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    CONSTRAINT purchases_number_positive CHECK (purchase_number > 0),
    CONSTRAINT purchases_status_valid CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled', 'returned')),
    CONSTRAINT purchases_subtotal_valid CHECK (subtotal >= 0),
    CONSTRAINT purchases_tax_valid CHECK (tax_total >= 0),
    CONSTRAINT purchases_discount_valid CHECK (discount_total >= 0),
    CONSTRAINT purchases_total_valid CHECK (total >= 0),
    CONSTRAINT purchases_total_equation CHECK (total = subtotal + tax_total - discount_total)
);
CREATE INDEX purchases_page_idx ON public.purchases (tenant_id, purchased_at DESC, purchase_id DESC);
CREATE INDEX purchases_supplier_idx ON public.purchases (tenant_id, supplier_id, purchased_at DESC, purchase_id DESC);
CREATE TRIGGER purchases_updated_at BEFORE UPDATE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.purchase_lines (
    purchase_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    purchase_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    line_number integer NOT NULL,
    quantity numeric(19,6) NOT NULL,
    unit_cost numeric(19,6) NOT NULL,
    discount_total numeric(19,6) NOT NULL DEFAULT 0,
    tax_total numeric(19,6) NOT NULL DEFAULT 0,
    line_total numeric(19,6) NOT NULL,
    quantity_received numeric(19,6) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, purchase_line_id),
    UNIQUE (tenant_id, purchase_id, line_number),
    FOREIGN KEY (tenant_id, purchase_id)
        REFERENCES public.purchases (tenant_id, purchase_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, variant_id)
        REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE RESTRICT,
    CONSTRAINT purchase_lines_number_positive CHECK (line_number > 0),
    CONSTRAINT purchase_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT purchase_lines_cost_valid CHECK (unit_cost >= 0),
    CONSTRAINT purchase_lines_discount_valid CHECK (discount_total >= 0),
    CONSTRAINT purchase_lines_tax_valid CHECK (tax_total >= 0),
    CONSTRAINT purchase_lines_total_valid CHECK (line_total >= 0),
    CONSTRAINT purchase_lines_received_valid CHECK (quantity_received >= 0 AND quantity_received <= quantity)
);
CREATE INDEX purchase_lines_purchase_idx ON public.purchase_lines
    (tenant_id, purchase_id, line_number, purchase_line_id);
CREATE INDEX purchase_lines_variant_idx ON public.purchase_lines
    (tenant_id, variant_id, purchase_line_id);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['purchases', 'purchase_lines'] LOOP
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
