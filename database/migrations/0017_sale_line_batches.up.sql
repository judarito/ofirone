-- 0017_sale_line_batches.up.sql
-- Slice H (autorizado): N9, trazabilidad lote-linea con FK compuestas y RLS FORCE.
-- Sin BEGIN/COMMIT: el runner envuelve la transaccion.
create table public.sale_line_batches (
    sale_line_batch_id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    sale_id uuid not null,
    sale_line_id uuid not null,
    batch_id uuid not null,
    quantity numeric(19,6) not null,
    unit_cost numeric(19,6) not null default 0,
    created_at timestamptz not null default clock_timestamp(),
    unique (tenant_id, sale_line_batch_id),
    unique (tenant_id, sale_line_id, batch_id),
    foreign key (tenant_id, sale_id)
        references public.sales (tenant_id, sale_id)
        on delete restrict,
    foreign key (tenant_id, sale_line_id)
        references public.sale_lines (tenant_id, sale_line_id)
        on delete restrict,
    foreign key (tenant_id, batch_id)
        references public.inventory_batches (tenant_id, batch_id)
        on delete restrict,
    constraint sale_line_batches_quantity_positive check (quantity > 0),
    constraint sale_line_batches_cost_valid check (unit_cost >= 0)
);

create index sale_line_batches_sale_idx
    on public.sale_line_batches (tenant_id, sale_id, sale_line_id);
create index sale_line_batches_batch_idx
    on public.sale_line_batches (tenant_id, batch_id, sale_line_id);

alter table public.sale_line_batches enable row level security;
alter table public.sale_line_batches force row level security;
create policy tenant_isolation on public.sale_line_batches
    for all
    using (tenant_id = app_private.current_tenant_id())
    with check (tenant_id = app_private.current_tenant_id());

revoke all on public.sale_line_batches from public;

comment on table public.sale_line_batches is
    'PROPUESTA N9. Trazabilidad lote↔línea de venta; FK compuestas por tenant. '
    'Pendiente: FK triple (tenant_id, sale_id, sale_line_id) previa UNIQUE en sale_lines.';


-- =============================================================================
