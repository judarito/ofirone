-- PostgreSQL >= 15. Layaway contracts, installments and payments.
-- Stock reservation effects are coordinated by later use cases.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.layaway_contracts (
    layaway_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    contract_number bigint NOT NULL,
    status text NOT NULL DEFAULT 'active',
    reserve_stock_on_create boolean NOT NULL DEFAULT true,
    stock_reserved_on_create boolean NOT NULL DEFAULT false,
    subtotal numeric(19,6) NOT NULL DEFAULT 0,
    discount_total numeric(19,6) NOT NULL DEFAULT 0,
    total numeric(19,6) NOT NULL DEFAULT 0,
    paid_total numeric(19,6) NOT NULL DEFAULT 0,
    balance_due numeric(19,6) NOT NULL DEFAULT 0,
    expires_at date,
    created_by_identity_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, layaway_id),
    UNIQUE (tenant_id, location_id, contract_number),
    FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.locations (tenant_id, location_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, customer_id)
        REFERENCES public.customers (tenant_id, customer_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_identity_id)
        REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    CONSTRAINT layaway_status_valid CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'expired')),
    CONSTRAINT layaway_number_positive CHECK (contract_number > 0),
    CONSTRAINT layaway_subtotal_valid CHECK (subtotal >= 0),
    CONSTRAINT layaway_discount_valid CHECK (discount_total >= 0 AND discount_total <= subtotal),
    CONSTRAINT layaway_total_valid CHECK (total = subtotal - discount_total AND total >= 0),
    CONSTRAINT layaway_paid_valid CHECK (paid_total >= 0 AND paid_total <= total),
    CONSTRAINT layaway_balance_valid CHECK (balance_due = total - paid_total AND balance_due >= 0)
);
CREATE INDEX layaway_page_idx ON public.layaway_contracts
    (tenant_id, status, created_at DESC, layaway_id DESC);
CREATE INDEX layaway_due_idx ON public.layaway_contracts
    (tenant_id, status, expires_at, layaway_id);
CREATE TRIGGER layaway_updated_at BEFORE UPDATE ON public.layaway_contracts
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.layaway_items (
    layaway_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    layaway_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    line_number integer NOT NULL,
    quantity numeric(19,6) NOT NULL,
    unit_price numeric(19,6) NOT NULL,
    line_total numeric(19,6) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, layaway_item_id),
    UNIQUE (tenant_id, layaway_id, line_number),
    FOREIGN KEY (tenant_id, layaway_id)
        REFERENCES public.layaway_contracts (tenant_id, layaway_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, variant_id)
        REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE RESTRICT,
    CONSTRAINT layaway_items_line_positive CHECK (line_number > 0),
    CONSTRAINT layaway_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT layaway_items_price_valid CHECK (unit_price >= 0),
    CONSTRAINT layaway_items_total_valid CHECK (line_total >= 0)
);
CREATE INDEX layaway_items_contract_idx ON public.layaway_items (tenant_id, layaway_id, line_number, layaway_item_id);

CREATE TABLE public.layaway_installments (
    installment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    layaway_id uuid NOT NULL,
    installment_number integer NOT NULL,
    due_date date NOT NULL,
    amount numeric(19,6) NOT NULL,
    paid_amount numeric(19,6) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, installment_id),
    UNIQUE (tenant_id, layaway_id, installment_number),
    FOREIGN KEY (tenant_id, layaway_id)
        REFERENCES public.layaway_contracts (tenant_id, layaway_id) ON DELETE RESTRICT,
    CONSTRAINT layaway_installment_number_positive CHECK (installment_number > 0),
    CONSTRAINT layaway_installment_amount_valid CHECK (amount > 0),
    CONSTRAINT layaway_installment_paid_valid CHECK (paid_amount >= 0 AND paid_amount <= amount),
    CONSTRAINT layaway_installment_status_valid CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue', 'cancelled'))
);
CREATE INDEX layaway_installments_due_idx ON public.layaway_installments
    (tenant_id, status, due_date, installment_id);
CREATE TRIGGER layaway_installments_updated_at BEFORE UPDATE ON public.layaway_installments
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.layaway_payments (
    layaway_payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    layaway_id uuid NOT NULL,
    installment_id uuid,
    payment_method_id uuid NOT NULL,
    amount numeric(19,6) NOT NULL,
    paid_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    reference text,
    created_by_identity_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, layaway_payment_id),
    FOREIGN KEY (tenant_id, layaway_id)
        REFERENCES public.layaway_contracts (tenant_id, layaway_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, installment_id)
        REFERENCES public.layaway_installments (tenant_id, installment_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, payment_method_id)
        REFERENCES public.payment_methods (tenant_id, payment_method_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_identity_id)
        REFERENCES public.identities (identity_id) ON DELETE RESTRICT,
    CONSTRAINT layaway_payments_amount_positive CHECK (amount > 0)
);
CREATE INDEX layaway_payments_page_idx ON public.layaway_payments
    (tenant_id, paid_at DESC, layaway_payment_id DESC);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['layaway_contracts', 'layaway_items', 'layaway_installments', 'layaway_payments'] LOOP
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
