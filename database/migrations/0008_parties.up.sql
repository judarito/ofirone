-- PostgreSQL >= 15. Tenant parties and customers.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.third_parties (
    third_party_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    legal_name text NOT NULL,
    document_type text,
    document_number text,
    email text,
    phone text,
    address text,
    is_supplier boolean NOT NULL DEFAULT false,
    is_customer boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, third_party_id),
    UNIQUE (tenant_id, document_type, document_number),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE RESTRICT,
    CONSTRAINT third_parties_name_nonempty CHECK (length(btrim(legal_name)) BETWEEN 1 AND 250),
    CONSTRAINT third_parties_document_pair CHECK ((document_type IS NULL) = (document_number IS NULL)),
    CONSTRAINT third_parties_document_valid CHECK (document_number IS NULL OR length(btrim(document_number)) BETWEEN 1 AND 100),
    CONSTRAINT third_parties_role_valid CHECK (is_supplier OR is_customer)
);
CREATE INDEX third_parties_page_idx ON public.third_parties (tenant_id, is_active DESC, legal_name, third_party_id);
CREATE INDEX third_parties_document_idx ON public.third_parties (tenant_id, document_number, third_party_id);
CREATE TRIGGER third_parties_updated_at BEFORE UPDATE ON public.third_parties
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.customers (
    customer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    third_party_id uuid NOT NULL,
    credit_enabled boolean NOT NULL DEFAULT false,
    credit_limit numeric(19,6) NOT NULL DEFAULT 0,
    notes text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, customer_id),
    UNIQUE (tenant_id, third_party_id),
    FOREIGN KEY (tenant_id, third_party_id)
        REFERENCES public.third_parties (tenant_id, third_party_id) ON DELETE RESTRICT,
    CONSTRAINT customers_credit_limit_valid CHECK (credit_limit >= 0)
);
CREATE INDEX customers_page_idx ON public.customers (tenant_id, created_at DESC, customer_id DESC);
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['third_parties', 'customers'] LOOP
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
