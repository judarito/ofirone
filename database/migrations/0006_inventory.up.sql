-- PostgreSQL >= 15. Inventory batches, ledger movements and reservations.
-- Transaction wrapper is owned by the migration runner.

CREATE TABLE public.inventory_batches (
    batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    batch_number text NOT NULL,
    quantity_on_hand numeric(19,6) NOT NULL DEFAULT 0,
    quantity_reserved numeric(19,6) NOT NULL DEFAULT 0,
    unit_cost numeric(19,6) NOT NULL DEFAULT 0,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expiration_date date,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, batch_id),
    UNIQUE (tenant_id, location_id, batch_number),
    FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.locations (tenant_id, location_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, variant_id)
        REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE RESTRICT,
    CONSTRAINT inventory_batches_number_valid CHECK (batch_number = btrim(batch_number) AND length(batch_number) BETWEEN 1 AND 150),
    CONSTRAINT inventory_batches_on_hand_valid CHECK (quantity_on_hand >= 0),
    CONSTRAINT inventory_batches_reserved_valid CHECK (quantity_reserved >= 0 AND quantity_reserved <= quantity_on_hand),
    CONSTRAINT inventory_batches_cost_valid CHECK (unit_cost >= 0)
);
CREATE INDEX inventory_batches_fefo_idx ON public.inventory_batches
    (tenant_id, location_id, variant_id, expiration_date NULLS LAST, received_at, batch_id);
CREATE INDEX inventory_batches_page_idx ON public.inventory_batches
    (tenant_id, updated_at DESC, batch_id DESC);
CREATE TRIGGER inventory_batches_updated_at BEFORE UPDATE ON public.inventory_batches
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.inventory_moves (
    movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    batch_id uuid,
    quantity_delta numeric(19,6) NOT NULL,
    movement_type text NOT NULL,
    source_type text,
    source_id uuid,
    unit_cost numeric(19,6),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.locations (tenant_id, location_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, variant_id)
        REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, batch_id)
        REFERENCES public.inventory_batches (tenant_id, batch_id) ON DELETE RESTRICT,
    CONSTRAINT inventory_moves_delta_nonzero CHECK (quantity_delta <> 0),
    CONSTRAINT inventory_moves_type_valid CHECK (
        movement_type IN ('purchase_in', 'sale_out', 'return_in', 'return_out', 'adjustment', 'transfer_in', 'transfer_out', 'production_in', 'consumption_out', 'reservation')
    ),
    CONSTRAINT inventory_moves_cost_valid CHECK (unit_cost IS NULL OR unit_cost >= 0)
);
CREATE INDEX inventory_moves_page_idx ON public.inventory_moves
    (tenant_id, occurred_at DESC, movement_id DESC);
CREATE INDEX inventory_moves_variant_idx ON public.inventory_moves
    (tenant_id, location_id, variant_id, occurred_at DESC, movement_id DESC);
CREATE INDEX inventory_moves_source_idx ON public.inventory_moves
    (tenant_id, source_type, source_id, movement_id);

CREATE TABLE public.stock_reservations (
    reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    batch_id uuid,
    quantity numeric(19,6) NOT NULL,
    status text NOT NULL DEFAULT 'active',
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, reservation_id),
    FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.locations (tenant_id, location_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, variant_id)
        REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, batch_id)
        REFERENCES public.inventory_batches (tenant_id, batch_id) ON DELETE RESTRICT,
    CONSTRAINT stock_reservations_quantity_valid CHECK (quantity > 0),
    CONSTRAINT stock_reservations_status_valid CHECK (status IN ('active', 'released', 'consumed', 'expired')),
    CONSTRAINT stock_reservations_source_valid CHECK (source_type = btrim(source_type) AND length(source_type) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX stock_reservations_active_source_idx
    ON public.stock_reservations (tenant_id, source_type, source_id, variant_id, location_id)
    WHERE status = 'active';
CREATE INDEX stock_reservations_page_idx ON public.stock_reservations
    (tenant_id, status, created_at DESC, reservation_id DESC);
CREATE TRIGGER stock_reservations_updated_at BEFORE UPDATE ON public.stock_reservations
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['inventory_batches', 'inventory_moves', 'stock_reservations'] LOOP
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
