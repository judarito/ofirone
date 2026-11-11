-- PostgreSQL >= 15. Supplier payables and customer credit ledgers.
-- Accounting postings are coordinated by a later accounting migration.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.supplier_payables (
    payable_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    purchase_id uuid,
    due_date date,
    original_amount numeric(19,6) NOT NULL,
    paid_amount numeric(19,6) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    note text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, payable_id),
    UNIQUE (tenant_id, purchase_id),
    FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES public.third_parties (tenant_id, third_party_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, purchase_id)
        REFERENCES public.purchases (tenant_id, purchase_id) ON DELETE RESTRICT,
    CONSTRAINT supplier_payables_original_valid CHECK (original_amount > 0),
    CONSTRAINT supplier_payables_paid_valid CHECK (paid_amount >= 0 AND paid_amount <= original_amount),
    CONSTRAINT supplier_payables_status_valid CHECK (status IN ('open', 'partially_paid', 'paid', 'cancelled'))
);
CREATE INDEX supplier_payables_page_idx ON public.supplier_payables
    (tenant_id, status, due_date NULLS LAST, payable_id);
CREATE INDEX supplier_payables_supplier_idx ON public.supplier_payables
    (tenant_id, supplier_id, status, due_date NULLS LAST, payable_id);
CREATE TRIGGER supplier_payables_updated_at BEFORE UPDATE ON public.supplier_payables
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.supplier_payable_payments (
    payable_payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    payable_id uuid NOT NULL,
    payment_method_id uuid NOT NULL,
    amount numeric(19,6) NOT NULL,
    paid_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    reference text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, payable_payment_id),
    FOREIGN KEY (tenant_id, payable_id)
        REFERENCES public.supplier_payables (tenant_id, payable_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, payment_method_id)
        REFERENCES public.payment_methods (tenant_id, payment_method_id) ON DELETE RESTRICT,
    CONSTRAINT supplier_payable_payments_amount_positive CHECK (amount > 0)
);
CREATE INDEX supplier_payable_payments_page_idx ON public.supplier_payable_payments
    (tenant_id, paid_at DESC, payable_payment_id DESC);

CREATE TABLE public.customer_credit_accounts (
    credit_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    credit_limit numeric(19,6) NOT NULL DEFAULT 0,
    current_balance numeric(19,6) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, credit_account_id),
    UNIQUE (tenant_id, customer_id),
    FOREIGN KEY (tenant_id, customer_id)
        REFERENCES public.customers (tenant_id, customer_id) ON DELETE RESTRICT,
    CONSTRAINT credit_accounts_limit_valid CHECK (credit_limit >= 0),
    CONSTRAINT credit_accounts_balance_valid CHECK (current_balance >= 0),
    CONSTRAINT credit_accounts_status_valid CHECK (status IN ('active', 'suspended', 'closed'))
);
CREATE INDEX credit_accounts_page_idx ON public.customer_credit_accounts
    (tenant_id, status, current_balance DESC, credit_account_id);
CREATE TRIGGER credit_accounts_updated_at BEFORE UPDATE ON public.customer_credit_accounts
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.customer_credit_movements (
    credit_movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    credit_account_id uuid NOT NULL,
    movement_type text NOT NULL,
    amount numeric(19,6) NOT NULL,
    source_type text,
    source_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, credit_movement_id),
    FOREIGN KEY (tenant_id, credit_account_id)
        REFERENCES public.customer_credit_accounts (tenant_id, credit_account_id) ON DELETE RESTRICT,
    CONSTRAINT credit_movements_amount_positive CHECK (amount > 0),
    CONSTRAINT credit_movements_type_valid CHECK (movement_type IN ('charge', 'payment', 'adjustment', 'writeoff'))
);
CREATE INDEX credit_movements_page_idx ON public.customer_credit_movements
    (tenant_id, credit_account_id, occurred_at DESC, credit_movement_id DESC);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['supplier_payables', 'supplier_payable_payments', 'customer_credit_accounts', 'customer_credit_movements'] LOOP
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
