-- PostgreSQL >= 15. Reference data and tenant locations.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.locations (
    location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, location_id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    CONSTRAINT locations_code_valid CHECK (code = btrim(code) AND length(code) BETWEEN 1 AND 50),
    CONSTRAINT locations_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 200)
);
CREATE INDEX locations_page_idx ON public.locations (tenant_id, is_active DESC, name, location_id);
CREATE TRIGGER locations_updated_at BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.units_of_measure (
    unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    decimal_places integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, unit_id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    CONSTRAINT units_code_valid CHECK (code = btrim(code) AND length(code) BETWEEN 1 AND 30),
    CONSTRAINT units_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT units_decimal_places_valid CHECK (decimal_places BETWEEN 0 AND 6)
);
CREATE INDEX units_page_idx ON public.units_of_measure (tenant_id, is_active DESC, name, unit_id);
CREATE TRIGGER units_updated_at BEFORE UPDATE ON public.units_of_measure
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.categories (
    category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    parent_category_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, category_id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, parent_category_id)
        REFERENCES public.categories (tenant_id, category_id) ON DELETE RESTRICT,
    CONSTRAINT categories_code_valid CHECK (code = btrim(code) AND length(code) BETWEEN 1 AND 100),
    CONSTRAINT categories_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT categories_not_self_parent CHECK (parent_category_id IS NULL OR parent_category_id <> category_id)
);
CREATE INDEX categories_page_idx ON public.categories (tenant_id, is_active DESC, name, category_id);
CREATE INDEX categories_parent_idx ON public.categories (tenant_id, parent_category_id, name, category_id);
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.taxes (
    tax_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    rate numeric(9,6) NOT NULL,
    is_inclusive boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, tax_id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    CONSTRAINT taxes_code_valid CHECK (code = btrim(code) AND length(code) BETWEEN 1 AND 50),
    CONSTRAINT taxes_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT taxes_rate_valid CHECK (rate >= 0 AND rate <= 100)
);
CREATE INDEX taxes_page_idx ON public.taxes (tenant_id, is_active DESC, name, tax_id);
CREATE TRIGGER taxes_updated_at BEFORE UPDATE ON public.taxes
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.payment_methods (
    payment_method_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    method_type text NOT NULL DEFAULT 'other',
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, payment_method_id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    CONSTRAINT payment_methods_code_valid CHECK (code = btrim(code) AND length(code) BETWEEN 1 AND 50),
    CONSTRAINT payment_methods_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT payment_methods_type_valid CHECK (method_type IN ('cash', 'card', 'transfer', 'credit', 'other'))
);
CREATE INDEX payment_methods_page_idx ON public.payment_methods
    (tenant_id, is_active DESC, sort_order, name, payment_method_id);
CREATE TRIGGER payment_methods_updated_at BEFORE UPDATE ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['locations', 'units_of_measure', 'categories', 'taxes', 'payment_methods'] LOOP
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
