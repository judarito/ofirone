-- PostgreSQL >= 15. Products, variants and barcodes.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.products (
    product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    category_id uuid,
    default_unit_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    product_type text NOT NULL DEFAULT 'stocked',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, product_id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, category_id)
        REFERENCES public.categories (tenant_id, category_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, default_unit_id)
        REFERENCES public.units_of_measure (tenant_id, unit_id) ON DELETE RESTRICT,
    CONSTRAINT products_code_valid CHECK (code = btrim(code) AND length(code) BETWEEN 1 AND 100),
    CONSTRAINT products_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 250),
    CONSTRAINT products_type_valid CHECK (product_type IN ('stocked', 'service', 'manufactured', 'on_demand'))
);
CREATE INDEX products_page_idx ON public.products (tenant_id, is_active DESC, name, product_id);
CREATE INDEX products_category_idx ON public.products (tenant_id, category_id, name, product_id);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.product_variants (
    variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    cost numeric(19,6) NOT NULL DEFAULT 0,
    sale_price numeric(19,6) NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, variant_id),
    UNIQUE (tenant_id, sku),
    UNIQUE (tenant_id, product_id, name),
    FOREIGN KEY (tenant_id, product_id)
        REFERENCES public.products (tenant_id, product_id) ON DELETE RESTRICT,
    CONSTRAINT variants_sku_valid CHECK (sku = btrim(sku) AND length(sku) BETWEEN 1 AND 150),
    CONSTRAINT variants_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 250),
    CONSTRAINT variants_cost_valid CHECK (cost >= 0),
    CONSTRAINT variants_sale_price_valid CHECK (sale_price >= 0)
);
CREATE INDEX variants_page_idx ON public.product_variants (tenant_id, is_active DESC, name, variant_id);
CREATE INDEX variants_product_idx ON public.product_variants (tenant_id, product_id, name, variant_id);
CREATE TRIGGER variants_updated_at BEFORE UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.product_barcodes (
    barcode_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    barcode text NOT NULL,
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, barcode),
    UNIQUE (tenant_id, barcode_id),
    FOREIGN KEY (tenant_id, variant_id)
        REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE RESTRICT,
    CONSTRAINT product_barcodes_value_valid CHECK (barcode = btrim(barcode) AND length(barcode) BETWEEN 3 AND 100)
);
CREATE INDEX product_barcodes_variant_idx ON public.product_barcodes (tenant_id, variant_id, barcode_id);
CREATE UNIQUE INDEX product_barcodes_primary_idx
    ON public.product_barcodes (tenant_id, variant_id) WHERE is_primary;

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['products', 'product_variants', 'product_barcodes'] LOOP
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
