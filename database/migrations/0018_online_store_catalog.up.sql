-- 0018_online_store_catalog.up.sql
-- Slice H (autorizado): N10, tienda online minima y catalogo por tenant/variante.
-- Sin BEGIN/COMMIT.
create table public.online_stores (
    store_id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    slug text not null,
    name text not null,
    status text not null default 'draft',
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (tenant_id, store_id),
    unique (tenant_id, slug),
    foreign key (tenant_id) references public.tenants (tenant_id) on delete restrict,
    constraint online_stores_slug_valid check (
        slug = btrim(slug) and length(slug) between 1 and 63
        and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
    constraint online_stores_name_nonempty check (length(btrim(name)) between 1 and 200),
    constraint online_stores_status_valid check (status in ('draft', 'active', 'archived'))
);

create index online_stores_page_idx
    on public.online_stores (tenant_id, status, slug, store_id);

create trigger online_stores_updated_at before update on public.online_stores
for each row execute function app_private.set_updated_at();

alter table public.online_stores enable row level security;
alter table public.online_stores force row level security;
create policy tenant_isolation on public.online_stores
    for all
    using (tenant_id = app_private.current_tenant_id())
    with check (tenant_id = app_private.current_tenant_id());

revoke all on public.online_stores from public;

create table public.online_store_catalog (
    store_catalog_id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    store_id uuid not null,
    variant_id uuid not null,
    is_published boolean not null default false,
    stock_mode text not null default 'all',
    stock_value numeric(19,6),
    price_override numeric(19,6),
    sort_order integer not null default 0,
    custom_title text,
    custom_description text,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (tenant_id, store_catalog_id),
    unique (tenant_id, store_id, variant_id),
    foreign key (tenant_id, store_id)
        references public.online_stores (tenant_id, store_id)
        on delete restrict,
    foreign key (tenant_id, variant_id)
        references public.product_variants (tenant_id, variant_id)
        on delete restrict,
    constraint online_store_catalog_stock_mode_valid
        check (stock_mode in ('all', 'fixed', 'percent')),
    constraint online_store_catalog_stock_value_valid
        check (stock_value is null or stock_value >= 0),
    constraint online_store_catalog_price_valid
        check (price_override is null or price_override >= 0),
    constraint online_store_catalog_sort_valid check (sort_order >= 0)
);

create index online_store_catalog_store_idx
    on public.online_store_catalog
       (tenant_id, store_id, is_published, sort_order, store_catalog_id);
create index online_store_catalog_variant_idx
    on public.online_store_catalog (tenant_id, variant_id, store_id);

create trigger online_store_catalog_updated_at before update on public.online_store_catalog
for each row execute function app_private.set_updated_at();

alter table public.online_store_catalog enable row level security;
alter table public.online_store_catalog force row level security;
create policy tenant_isolation on public.online_store_catalog
    for all
    using (tenant_id = app_private.current_tenant_id())
    with check (tenant_id = app_private.current_tenant_id());

revoke all on public.online_store_catalog from public;

comment on table public.online_store_catalog is
    'PROPUESTA N10. Catálogo por tenant/tienda; FK compuestas a online_stores y '
    'product_variants. Precio efectivo = coalesce(price_override, variant.sale_price).';


-- =============================================================================
