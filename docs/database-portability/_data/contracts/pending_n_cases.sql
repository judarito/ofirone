-- =============================================================================
-- pending_n_cases.sql — Casos N9, N10, N16, N17, N18 y N19
-- Ofirone · PostgreSQL portable · 2026-11-09
-- =============================================================================
--
-- ESTO NO ES UNA MIGRACIÓN.
--
-- Es SQL de referencia / propuesta para los objetos que aún no existen en el
-- baseline `database/migrations/0001–0012`:
--
--   N9  public.sale_line_batches
--   N10 public.online_store_catalog (+ prerrequisito mínimo public.online_stores)
--   N16 public.stock_balances (vista segura; alternativa matview documentada)
--   N17 public.vw_sales_summary (security_invoker = true)
--   N18 public.fn_claim_async_jobs(...)
--   N19 public.fn_complete_async_job(...)
--
-- N8 quedó RESUELTO/PASS contra `public.membership_roles` en la suite de
-- aislamiento (SQLSTATE 23503 al insertar un rol de otro tenant). No se crea
-- `user_roles`: duplicaría `membership_roles`. Ver la nota histórica de §1.
--
-- Estado actual: N9, N10, N16, N17, N18 y N19 en BLOQ (objeto ausente;
-- SQLSTATE 42P01 si se intenta usar antes de aplicar la propuesta).
-- N20 (`audit_log`) ya existe y no se repite aquí.
--
-- PERÍMETRO: este archivo vive en `docs/database-portability/_data/contracts/`.
-- No se aplica en DEV ni PROD. No es una migración y no debe copiarse a
-- `database/migrations/` sin revisión del agente principal.
--
-- MODO DE USO (solo base desechable PostgreSQL 15+):
--   1. Crear una base temporal aislada y aplicar las migraciones 0001–0012.
--   2. Ejecutar este archivo como owner privilegiado de la base temporal
--      (con BYPASSRLS y CREATEROLE, solo para sembrar fixtures de dos tenants).
--   3. Las pruebas crean un rol `NOBYPASSRLS` y se ejecutan dentro de una
--      transacción que termina en ROLLBACK; el DDL propuesto sí queda creado,
--      por eso la base debe destruirse al final.
--   4. Si una migración futura ya creó uno de estos objetos, comentar su bloque
--      DDL y conservar únicamente las pruebas.
--
-- Convención de contexto (la misma del baseline):
--   select set_config('app.tenant_id', :tenant_id, true);
--   select set_config('app.identity_id', :identity_id, true);
-- `app_private.current_tenant_id()` devuelve NULL si no hay contexto.
--
-- UUID sintéticos, dominios .example.test, sin datos reales.
-- =============================================================================


-- =============================================================================
-- 0. PREFLIGHT (opcional, solo lectura)
-- =============================================================================
-- Ejecutar antes de la propuesta para confirmar el estado BLOQ. No modifica nada.
--
-- select current_database(), current_user, current_setting('server_version');
-- select o.name,
--        to_regclass('public.' || o.name) is not null as exists,
--        case when to_regclass('public.' || o.name) is null then 'BLOQ' else 'OK' end as estado
-- from (values
--     ('sale_line_batches'),
--     ('online_stores'),
--     ('online_store_catalog'),
--     ('stock_balances'),
--     ('vw_sales_summary')
-- ) as o(name);
--
-- N8 no aparece porque está resuelto con `membership_roles` (ver §1).


-- =============================================================================
-- 1. N8 — RESUELTO con membership_roles (NO crear user_roles)
-- =============================================================================
--
-- La suite de aislamiento ya validó N8 contra `public.membership_roles`:
--
--   insert into public.membership_roles (tenant_id, membership_id, role_id)
--   values (tenant A, membership A, role B)  -- rechazado con SQLSTATE 23503
--
-- `user_roles` no existe en 0001–0012 y NO debe crearse: duplicaría
-- `membership_roles` y permitiría asignaciones inconsistentes entre ambas
-- tablas. Esta sección se conserva únicamente como nota histórica; no hay DDL
-- ni prueba N8 en este archivo. Ver la evidencia de la suite 0012 en
-- `../validation-business-0012-2026-11-09.txt`.


-- =============================================================================
-- 2. PROPUESTA DDL — N9: sale_line_batches
-- =============================================================================
--
-- MODELO: trazabilidad de qué lote(s) consumió cada línea de venta.
--
--   sale_line_batches
--       ├─ FK (tenant_id, sale_id)      → sales (tenant_id, sale_id)
--       ├─ FK (tenant_id, sale_line_id) → sale_lines (tenant_id, sale_line_id)
--       └─ FK (tenant_id, batch_id)     → inventory_batches (tenant_id, batch_id)
--
-- Las tres FK incluyen `tenant_id`; un lote del tenant B no puede asociarse a
-- una línea del tenant A (caso N9). `quantity` y `unit_cost` son numéricos
-- (nunca float). La tabla es inmutable: no lleva `updated_at`.
--
-- LÍMITE CONOCIDO: las FK garantizan que venta, línea y lote son del mismo
-- tenant, pero no que `sale_id` sea exactamente la venta de `sale_line_id`.
-- Para cerrar esa brecha hace falta una UNIQUE adicional en `sale_lines`
-- (tenant_id, sale_id, sale_line_id) y una FK triple. Se deja como propuesta
-- explícita, no se aplica aquí porque modifica una tabla existente:
--
--   -- PROPUESTA FUTURA (requiere migración del track principal):
--   -- alter table public.sale_lines
--   --     add constraint sale_lines_tenant_sale_line_key
--   --     unique (tenant_id, sale_id, sale_line_id);
--   -- foreign key (tenant_id, sale_id, sale_line_id)
--   --     references public.sale_lines (tenant_id, sale_id, sale_line_id)
--
-- PRECONDICIÓN: migraciones 0001–0012; `sales`, `sale_lines` e
-- `inventory_batches` con sus UNIQUE (tenant_id, <id>) ya existentes.
--
-- SQL DE PRUEBA: ver sección 8, bloque N9.
-- RESULTADO ESPERADO: PASS tras aplicar esta DDL. Hoy: BLOQ (42P01).
-- SQLSTATE: 23503 para lote/línea/venta de otro tenant; 42501 si RLS rechaza
--           primero una fila con `tenant_id` ajeno al contexto.

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
-- 3. PROPUESTA DDL — N10: online_store_catalog
-- =============================================================================
--
-- PRERREQUISITO MÍNIMO: el baseline 0001–0012 no tiene `online_stores`. Para
-- que `online_store_catalog` tenga FK compuesta real se propone esta versión
-- mínima de la tienda. Si la migración futura define `online_stores` con otras
-- columnas, conservar las claves y ajustar solo el resto.
--
-- MODELO:
--   online_stores (tenant_id, store_id, slug, name, status)
--   online_store_catalog
--       ├─ FK (tenant_id, store_id)   → online_stores (tenant_id, store_id)
--       └─ FK (tenant_id, variant_id) → product_variants (tenant_id, variant_id)
--
-- El catálogo es por tenant y por tienda. `price_override` es nullable: el
-- precio efectivo se calcula como
--   coalesce(c.price_override, v.sale_price)
-- y nunca se materializa como float. `stock_mode`/`stock_value` describen la
-- publicación; el stock real se consulta en `stock_balances`/inventario.
--
-- PRECONDICIÓN: `product_variants` y `tenants`; `online_stores` propuesta.
-- SQL DE PRUEBA: ver sección 8, bloque N10.
-- RESULTADO ESPERADO: PASS tras aplicar esta DDL. Hoy: BLOQ (42P01).
-- SQLSTATE: 23503 para variante/tienda de otro tenant; 42501 si RLS rechaza
--           primero una fila con `tenant_id` ajeno al contexto.

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
-- 4. PROPUESTA DDL — N16: stock_balances
-- =============================================================================
--
-- QUÉ PASA CON UNA MATVIEW NORMAL (explicación obligatoria):
--
--   * Una materialized view es una relación física que guarda el resultado de
--     su consulta. No admite RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
--     falla sobre una matview, y `CREATE POLICY` tampoco aplica.
--   * El `SELECT` directo sobre la matview solo comprueba el privilegio
--     `SELECT` del rol; no aplica las políticas RLS de `inventory_batches`.
--   * El refresco se ejecuta con los privilegios del owner de la matview. Si el
--     owner tiene BYPASSRLS (o es owner de las tablas base con RLS no FORCE),
--     la matview almacena filas de todos los tenants.
--   * Por tanto, `grant select on stock_balances to api` filtra por tenant
--     únicamente si la consulta del llamador añade un `WHERE tenant_id = ...`.
--     Un `SELECT * FROM stock_balances` sin filtro devuelve todos los tenants.
--     Eso es exactamente la fuga que N16 debe detectar.
--   * Una vista normal sin `security_invoker` tiene el mismo problema: se
--     ejecuta con los privilegios del owner y puede saltarse la RLS.
--
-- ALTERNATIVA SEGURA PROPUESTA: no exponer una matview. Crear
-- `public.stock_balances` como VISTA normal con `security_invoker = true`
-- sobre `inventory_batches`, y añadir además el predicado explícito
-- `tenant_id = app_private.current_tenant_id()` como defensa en profundidad.
-- Así se aplican la RLS del invocador y el filtro de tenant, y no hay una
-- relación materializada que pueda quedar accesible por error.
--
--   create view public.stock_balances
--   with (security_invoker = true, security_barrier = true) as ...
--
-- `security_barrier` evita que predicados del llamador se evalúen antes del
-- filtro de la vista; es opcional y puede medirse. `security_invoker` requiere
-- PostgreSQL 15+.
--
-- ALTERNATIVA CON MATVIEW (menos preferida): mantener la matview en
-- `app_private` (nunca en `public`), revocar todo privilegio directo y exponer
-- una vista o función con filtro explícito de tenant. Si se usa una vista
-- normal (security definer), el filtro es la única barrera; por eso debe ser
-- obligatorio y probarse con N16. No otorgar `SELECT` sobre la matview al rol
-- de runtime. Ver el bloque comentado al final de esta sección.
--
-- PRECONDICIÓN: `inventory_batches` con RLS FORCE y filas de A y B.
-- SQL DE PRUEBA: ver sección 8, bloque N16.
-- RESULTADO ESPERADO: PASS con la vista segura (solo A; 0 filas de B; 0 sin
--   contexto). BLOQ hoy (42P01) y FAIL/BLOQ si se expone una matview sin filtro.
-- SQLSTATE: sin error para la consulta filtrada (0 filas); 42501 si se deniega
--   el acceso directo a la matview; 42P01 si el objeto no existe.

create view public.stock_balances
with (security_invoker = true, security_barrier = true)
as
select
    b.tenant_id,
    b.location_id,
    b.variant_id,
    -- Se conservan los nombres legacy `on_hand`/`reserved`; las columnas base
    -- del baseline son `quantity_on_hand`/`quantity_reserved`.
    sum(b.quantity_on_hand) as on_hand,
    sum(b.quantity_reserved) as reserved,
    max(b.updated_at) as updated_at
from public.inventory_batches b
where b.is_active
  and b.tenant_id = app_private.current_tenant_id()
group by b.tenant_id, b.location_id, b.variant_id;

comment on view public.stock_balances is
    'PROPUESTA N16. Vista security_invoker sobre inventory_batches; no es matview. '
    'Expone on_hand/reserved (nombres legacy) desde quantity_on_hand/quantity_reserved. '
    'Filtra por app_private.current_tenant_id() y por la RLS del invocador. '
    'Nunca otorgar SELECT directo a una matview equivalente.';

-- -----------------------------------------------------------------------------
-- ALTERNATIVA CON MATVIEW — comentada, NO ejecutar junto con la vista anterior.
-- -----------------------------------------------------------------------------
-- begin;
-- create materialized view app_private.stock_balances_mv as
-- select b.tenant_id, b.location_id, b.variant_id,
--        sum(b.quantity_on_hand) as on_hand,
--        sum(b.quantity_reserved) as reserved,
--        max(b.updated_at) as updated_at
-- from public.inventory_batches b
-- where b.is_active
-- group by b.tenant_id, b.location_id, b.variant_id;
--
-- create unique index stock_balances_mv_key
--     on app_private.stock_balances_mv (tenant_id, location_id, variant_id);
--
-- revoke all on app_private.stock_balances_mv from public;
--
-- -- Vista con filtro explícito; por defecto corre con privilegios del owner.
-- -- El filtro de tenant es obligatorio: sin él, la vista devuelve filas de
-- -- todos los tenants, porque la matview no aplica RLS.
-- create view public.stock_balances as
-- select m.*
-- from app_private.stock_balances_mv m
-- where m.tenant_id = app_private.current_tenant_id();
--
-- revoke all on public.stock_balances from public;
-- grant select on public.stock_balances to <runtime_role>;
-- -- NO otorgar select sobre app_private.stock_balances_mv.
-- commit;


-- =============================================================================
-- 5. PROPUESTA DDL — N17: vw_sales_summary
-- =============================================================================
--
-- Vista de resumen de ventas con `security_invoker = true` (PostgreSQL 15+).
-- Sin esa opción la vista se ejecuta con los privilegios del owner y puede
-- saltarse la RLS de `sales`/`locations`, devolviendo ventas de todos los
-- tenants. El join es compuesto por `tenant_id` para que una sede de otro
-- tenant no pueda asociarse aunque una de las dos RLS fallara.
--
-- Se añade el predicado explícito `s.tenant_id = current_tenant_id()` como
-- defensa en profundidad. La columna `customer_id`/`customer_name` NO se
-- incluye porque el baseline 0001–0012 no tiene `sales.customer_id` (brecha P0
-- documentada en el README de contratos). Cuando exista, ampliar la vista.
--
-- PRECONDICIÓN: `sales`, `locations` con RLS FORCE y ventas de A y B.
-- SQL DE PRUEBA: ver sección 8, bloque N17.
-- RESULTADO ESPERADO: PASS (solo A; 0 filas de B; 0 sin contexto).
--   Hoy: BLOQ (42P01). Si la vista no tiene security_invoker: FAIL (fuga).
-- SQLSTATE: sin error (0 filas); 42501 si falta privilegio; 42P01 si no existe.

create view public.vw_sales_summary
with (security_invoker = true)
as
select
    s.tenant_id,
    s.location_id,
    l.name as location_name,
    s.sale_id,
    s.sale_number,
    s.status,
    s.sold_at,
    s.created_by_identity_id,
    s.subtotal,
    s.discount_total,
    s.tax_total,
    s.total
from public.sales s
join public.locations l
  on l.tenant_id = s.tenant_id
 and l.location_id = s.location_id
where s.tenant_id = app_private.current_tenant_id();

comment on view public.vw_sales_summary is
    'PROPUESTA N17. Vista security_invoker. No incluye cliente porque '
    'sales.customer_id aún no existe en 0001–0012.';


-- =============================================================================
-- 6. PROPUESTA — N18/N19: funciones de claim/complete de async_jobs
-- =============================================================================
--
-- El baseline 0001–0012 ya tiene `public.async_jobs`, pero NO tiene
-- `fn_claim_async_jobs` ni `fn_complete_async_job`. Estas funciones son una
-- propuesta; no son migración.
--
-- ADAPTACIÓN AL BASELINE ACTUAL:
--   * No existen `queue`, `run_after`, `lock_expires_at`, `result` ni
--     `async_job_attempts` en 0001–0012. Se usan `job_type`, `available_at`,
--     `status`, `attempts`, `locked_at` y `locked_by`.
--   * El lease se calcula con `locked_at + p_lease_seconds`; no se persiste una
--     columna nueva. Un job `running` con `locked_at` más antiguo que el lease
--     puede reclamarse de nuevo (recuperación de worker caído).
--   * La firma legacy `fn_complete_async_job(uuid, text, jsonb, boolean)` no se
--     adopta: no hay columna `result`. Si el producto necesita persistir el
--     resultado, una migración futura debe añadir `async_jobs.result jsonb` y
--     ampliar la firma. Mientras tanto, el resultado operativo debe ir a
--     `audit_log` o a la capa Go.
--   * La idempotencia de creación ya la garantiza
--     UNIQUE (tenant_id, job_type, idempotency_key).
--
-- SEGURIDAD:
--   * SECURITY DEFINER con `SET search_path = pg_catalog, public, app_private`.
--   * El owner debe ser un rol NOLOGIN dedicado; no debe ser superusuario. Si
--     el owner tiene BYPASSRLS, el predicado explícito `tenant_id =
--     current_tenant_id()` sigue siendo obligatorio.
--   * `REVOKE ALL ... FROM PUBLIC` y `GRANT EXECUTE` mínimo al rol worker
--     (el grant al rol real queda comentado porque ese rol aún no existe).
--   * Sin `app.tenant_id` las funciones fallan con SQLSTATE 42501; no hay modo
--     "global sin tenant" en esta propuesta.
--
-- N18 — PRECONDICIÓN: contexto A; jobs de A y B en `queued`; worker 'w1'.
-- SQL DE PRUEBA: sección 8, bloque N18.
-- RESULTADO ESPERADO: PASS (solo jobs de A; B sigue `queued`; sin contexto
--   42501). Hoy: BLOQ (42P01).
-- SQLSTATE: 42501 sin contexto/tenant ausente; 22023 argumentos inválidos.
--
-- N19 — PRECONDICIÓN: job B de otro tenant; job A reclamado por 'w1'.
-- SQL DE PRUEBA: sección 8, bloque N19.
-- RESULTADO ESPERADO: PASS (job B rechazado; job A completado; repetir
--   complete del mismo worker es idempotente). Hoy: BLOQ (42P01).
-- SQLSTATE: 42501 para job de otro tenant, worker distinto o lease vencido.

create or replace function public.fn_claim_async_jobs(
    p_job_type text,
    p_worker_id text,
    p_limit integer default 10,
    p_lease_seconds integer default 300
)
returns setof public.async_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
    v_tenant uuid := app_private.current_tenant_id();
    v_limit integer := greatest(least(coalesce(p_limit, 10), 100), 1);
    v_lease integer := greatest(coalesce(p_lease_seconds, 300), 30);
begin
    if v_tenant is null then
        raise exception 'app.tenant_id is required to claim jobs'
            using errcode = '42501';
    end if;

    if p_worker_id is null or btrim(p_worker_id) = '' then
        raise exception 'worker_id is required'
            using errcode = '22023';
    end if;

    if p_job_type is not null and btrim(p_job_type) = '' then
        raise exception 'job_type must be null or non-empty'
            using errcode = '22023';
    end if;

    return query
    with candidates as (
        select j.job_id
        from public.async_jobs j
        where j.tenant_id = v_tenant
          and (p_job_type is null or j.job_type = p_job_type)
          and j.attempts < j.max_attempts
          and (
                (j.status = 'queued' and j.available_at <= clock_timestamp())
                or
                (j.status = 'running'
                 and j.locked_at is not null
                 and j.locked_at < clock_timestamp() - make_interval(secs => v_lease))
              )
        order by j.priority asc, j.available_at asc, j.created_at asc, j.job_id asc
        limit v_limit
        for update skip locked
    )
    update public.async_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           locked_at = clock_timestamp(),
           locked_by = p_worker_id,
           updated_at = clock_timestamp()
      from candidates c
     where j.job_id = c.job_id
       and j.tenant_id = v_tenant
    returning j.*;
end;
$$;

comment on function public.fn_claim_async_jobs(text, text, integer, integer) is
    'PROPUESTA N18. Claim por tenant con FOR UPDATE SKIP LOCKED y lease en '
    'locked_at. Falla 42501 sin app.tenant_id. No reclamar jobs de otro tenant.';

create or replace function public.fn_complete_async_job(
    p_job_id uuid,
    p_worker_id text,
    p_lease_seconds integer default 300
)
returns public.async_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
    v_tenant uuid := app_private.current_tenant_id();
    v_job public.async_jobs%rowtype;
    v_lease integer := greatest(coalesce(p_lease_seconds, 300), 30);
begin
    if v_tenant is null then
        raise exception 'app.tenant_id is required to complete jobs'
            using errcode = '42501';
    end if;

    if p_worker_id is null or btrim(p_worker_id) = '' then
        raise exception 'worker_id is required'
            using errcode = '22023';
    end if;

    select *
      into v_job
      from public.async_jobs j
     where j.job_id = p_job_id
       and j.tenant_id = v_tenant
     for update;

    if not found then
        raise exception 'job % is not visible for the current tenant', p_job_id
            using errcode = '42501';
    end if;

    -- Idempotencia: repetir complete con el mismo worker devuelve el job ya
    -- terminado sin volver a escribirlo ni fallar.
    if v_job.status = 'succeeded' and v_job.locked_by = p_worker_id then
        return v_job;
    end if;

    if v_job.status <> 'running'
       or v_job.locked_by is distinct from p_worker_id
       or v_job.locked_at is null
       or v_job.locked_at < clock_timestamp() - make_interval(secs => v_lease) then
        raise exception 'job % is not leased by worker % or the lease expired',
            p_job_id, p_worker_id
            using errcode = '42501';
    end if;

    update public.async_jobs
       set status = 'succeeded',
           completed_at = clock_timestamp(),
           last_error = null,
           locked_at = clock_timestamp(),
           locked_by = p_worker_id,
           updated_at = clock_timestamp()
     where job_id = p_job_id
       and tenant_id = v_tenant
    returning * into v_job;

    return v_job;
end;
$$;

comment on function public.fn_complete_async_job(uuid, text, integer) is
    'PROPUESTA N19. Complete solo si tenant, worker y lease coinciden; '
    'idempotente para el mismo worker. Falla 42501 en caso contrario. '
    'No persiste p_result: 0001–0012 no tiene async_jobs.result.';

-- FIRMA LEGACY PARA CUANDO EXISTA `async_jobs.result` (no ejecutar ahora):
--   fn_complete_async_job(
--       p_job_id uuid,
--       p_worker_id text,
--       p_result jsonb default '{}'::jsonb,
--       p_lease_seconds integer default 300
--   ) returns public.async_jobs
--   ... set result = coalesce(p_result, '{}'::jsonb) ...
-- Mientras no exista la columna, el resultado operativo va a `audit_log` o a Go.

revoke all on function public.fn_claim_async_jobs(text, text, integer, integer) from public;
revoke all on function public.fn_complete_async_job(uuid, text, integer) from public;

-- Endurecimiento pendiente: crear el rol worker NOLOGIN y asignar owner/grants.
-- alter function public.fn_claim_async_jobs(text, text, integer, integer) owner to ofirone_worker;
-- alter function public.fn_complete_async_job(uuid, text, integer) owner to ofirone_worker;
-- grant execute on function public.fn_claim_async_jobs(text, text, integer, integer) to ofirone_worker;
-- grant execute on function public.fn_complete_async_job(uuid, text, integer) to ofirone_worker;


-- =============================================================================
-- 7. FIN DEL DDL PROPUESTO
-- =============================================================================
-- A partir de aquí comienzan las PRUEBAS. Requieren que la DDL anterior se haya
-- aplicado en la base desechable. Todo el bloque de pruebas termina en ROLLBACK.
--
-- Si se ejecuta el archivo completo, el DDL queda creado (no hay transacción
-- global alrededor de las secciones 1–6). Destruir la base desechable al final.


-- =============================================================================
-- 8. PRUEBAS N9, N10, N16, N17, N18, N19
-- =============================================================================
--
-- Sembrado con owner privilegiado (BYPASSRLS) y pruebas con rol NOBYPASSRLS.
-- IDs sintéticos:
--   A = 00000000-0000-0000-0000-0000000000a1
--   B = 00000000-0000-0000-0000-0000000000b2
--
begin;

-- -----------------------------------------------------------------------------
-- Fixtures: dos tenants completos (identidad, membresía, rol, sede, catálogo,
-- producto, variante, lote, venta, línea, tienda y job).
-- -----------------------------------------------------------------------------
insert into public.tenants (tenant_id, slug, name) values
    ('00000000-0000-0000-0000-0000000000a1', 'pending-a', 'Pending A'),
    ('00000000-0000-0000-0000-0000000000b2', 'pending-b', 'Pending B');

insert into public.identities (identity_id, email, display_name) values
    ('10000000-0000-0000-0000-0000000000a1', 'pending-a@example.test', 'Pending A'),
    ('10000000-0000-0000-0000-0000000000b2', 'pending-b@example.test', 'Pending B');

insert into public.tenant_memberships (membership_id, tenant_id, identity_id) values
    ('20000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1',
     '10000000-0000-0000-0000-0000000000a1'),
    ('20000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2',
     '10000000-0000-0000-0000-0000000000b2');

insert into public.roles (role_id, tenant_id, code, name) values
    ('30000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1', 'owner', 'Owner A'),
    ('30000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2', 'owner', 'Owner B');

insert into public.locations (location_id, tenant_id, code, name) values
    ('60000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1', 'MAIN-A', 'Sede A'),
    ('60000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2', 'MAIN-B', 'Sede B');

insert into public.units_of_measure (unit_id, tenant_id, code, name) values
    ('61000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1', 'UND-A', 'Unidad A'),
    ('61000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2', 'UND-B', 'Unidad B');

insert into public.categories (category_id, tenant_id, code, name) values
    ('62000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1', 'GEN-A', 'General A'),
    ('62000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2', 'GEN-B', 'General B');

insert into public.products (product_id, tenant_id, category_id, default_unit_id, code, name) values
    ('70000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1',
     '62000000-0000-0000-0000-0000000000a1',
     '61000000-0000-0000-0000-0000000000a1', 'P-A', 'Producto A'),
    ('70000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2',
     '62000000-0000-0000-0000-0000000000b2',
     '61000000-0000-0000-0000-0000000000b2', 'P-B', 'Producto B');

insert into public.product_variants
    (variant_id, tenant_id, product_id, sku, name, cost, sale_price) values
    ('71000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1',
     '70000000-0000-0000-0000-0000000000a1',
     'SKU-A', 'Variante A', 5, 20),
    ('71000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2',
     '70000000-0000-0000-0000-0000000000b2',
     'SKU-B', 'Variante B', 8, 30);

insert into public.inventory_batches
    (batch_id, tenant_id, location_id, variant_id, batch_number,
     quantity_on_hand, quantity_reserved, unit_cost) values
    ('72000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1',
     '60000000-0000-0000-0000-0000000000a1',
     '71000000-0000-0000-0000-0000000000a1', 'L-A', 90, 0, 5),
    ('72000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2',
     '60000000-0000-0000-0000-0000000000b2',
     '71000000-0000-0000-0000-0000000000b2', 'L-B', 40, 0, 8);

insert into public.sales
    (sale_id, tenant_id, location_id, sale_number, subtotal, total) values
    ('73000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1',
     '60000000-0000-0000-0000-0000000000a1', 1, 20, 20),
    ('73000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2',
     '60000000-0000-0000-0000-0000000000b2', 1, 30, 30);

insert into public.sale_lines
    (sale_line_id, tenant_id, sale_id, variant_id, line_number,
     quantity, unit_price, line_total) values
    ('74000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1',
     '73000000-0000-0000-0000-0000000000a1',
     '71000000-0000-0000-0000-0000000000a1', 1, 1, 20, 20),
    ('74000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2',
     '73000000-0000-0000-0000-0000000000b2',
     '71000000-0000-0000-0000-0000000000b2', 1, 1, 30, 30);

insert into public.online_stores (store_id, tenant_id, slug, name, status) values
    ('75000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1', 'tienda-a', 'Tienda A', 'active'),
    ('75000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2', 'tienda-b', 'Tienda B', 'active');

insert into public.async_jobs (job_id, tenant_id, job_type, idempotency_key) values
    ('86000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a1', 'fixture', 'pending-a-1'),
    ('86000000-0000-0000-0000-0000000000b2',
     '00000000-0000-0000-0000-0000000000b2', 'fixture', 'pending-b-1');

-- Rol de pruebas sin BYPASSRLS: es el que sufre la RLS como el runtime real.
create role ofirone_pending_n_actor
    nologin nosuperuser nobypassrls nocreatedb nocreaterole;

-- El usuario que ejecuta el harness necesita membresía para SET ROLE.
grant ofirone_pending_n_actor to current_user;

grant usage on schema public, app_private to ofirone_pending_n_actor;
grant execute on function app_private.current_tenant_id(),
                         app_private.current_identity_id()
    to ofirone_pending_n_actor;

-- Permisos mínimos para los objetos nuevos y para las vistas security_invoker.
grant select, insert on public.sale_line_batches,
                         public.online_store_catalog
    to ofirone_pending_n_actor;
grant select on public.stock_balances,
                public.vw_sales_summary,
                public.async_jobs
    to ofirone_pending_n_actor;
-- Las vistas security_invoker comprueban permisos sobre las tablas base.
grant select on public.inventory_batches, public.sales, public.locations
    to ofirone_pending_n_actor;
grant execute on function public.fn_claim_async_jobs(text, text, integer, integer),
                         public.fn_complete_async_job(uuid, text, integer)
    to ofirone_pending_n_actor;

set local role ofirone_pending_n_actor;
select set_config('app.tenant_id', '', true),
       set_config('app.identity_id', '', true);


-- -----------------------------------------------------------------------------
-- N16 sin contexto (se ejecuta antes de fijar A)
-- PRECONDICIÓN: rol NOBYPASSRLS, sin app.tenant_id.
-- SQL DE PRUEBA: select count(*) from public.stock_balances;
-- RESULTADO ESPERADO: PASS si 0 filas. BLOQ si el objeto no existe (42P01).
-- SQLSTATE: — (0 filas); 42P01 si falta el objeto.
-- -----------------------------------------------------------------------------
do $$
declare
    v_count bigint;
begin
    select count(*) into v_count from public.stock_balances;
    if v_count <> 0 then
        raise exception 'N16 FAIL: stock_balances devolvió % filas sin contexto', v_count;
    end if;

    select count(*) into v_count from public.vw_sales_summary;
    if v_count <> 0 then
        raise exception 'N17 FAIL: vw_sales_summary devolvió % filas sin contexto', v_count;
    end if;

    raise notice 'N16/N17 PASS sin contexto: 0 filas';
end $$;


-- Contexto A para el resto de las pruebas.
select set_config('app.tenant_id',
                  '00000000-0000-0000-0000-0000000000a1', true);
select set_config('app.identity_id',
                  '10000000-0000-0000-0000-0000000000a1', true);


-- -----------------------------------------------------------------------------
-- N8 — RESUELTO: no se repite aquí.
-- La suite de aislamiento validó el rechazo con `membership_roles` y SQLSTATE
-- 23503. No crear `user_roles` (duplicidad). Ver §1 y la evidencia 0012.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- N9 — sale_line_batches
-- PRECONDICIÓN: contexto A; venta/línea A; lote A y lote B.
-- SQL DE PRUEBA:
--   insert into sale_line_batches (tenant_id, sale_id, sale_line_id, batch_id, ...)
--   values (A, saleA, lineA, batchB, ...);
-- RESULTADO ESPERADO: PASS si la FK compuesta rechaza el lote B.
--   BLOQ si `sale_line_batches` no existe (42P01).
-- SQLSTATE: 23503 (lote de otro tenant); 42501 si RLS rechaza antes.
-- -----------------------------------------------------------------------------
do $$
begin
    -- Fila válida: lote A con línea/venta A.
    insert into public.sale_line_batches
        (tenant_id, sale_id, sale_line_id, batch_id, quantity, unit_cost)
    values
        ('00000000-0000-0000-0000-0000000000a1',
         '73000000-0000-0000-0000-0000000000a1',
         '74000000-0000-0000-0000-0000000000a1',
         '72000000-0000-0000-0000-0000000000a1', 1, 5);

    -- N9: lote del tenant B con tenant A → FK compuesta.
    begin
        insert into public.sale_line_batches
            (tenant_id, sale_id, sale_line_id, batch_id, quantity, unit_cost)
        values
            ('00000000-0000-0000-0000-0000000000a1',
             '73000000-0000-0000-0000-0000000000a1',
             '74000000-0000-0000-0000-0000000000a1',
             '72000000-0000-0000-0000-0000000000b2', 1, 8);
        raise exception 'N9 FAIL: aceptó un lote del tenant B en una línea del tenant A';
    exception
        when foreign_key_violation then null;
    end;

    -- N9b: fila con tenant B bajo contexto A → RLS/FK.
    begin
        insert into public.sale_line_batches
            (tenant_id, sale_id, sale_line_id, batch_id, quantity, unit_cost)
        values
            ('00000000-0000-0000-0000-0000000000b2',
             '73000000-0000-0000-0000-0000000000a1',
             '74000000-0000-0000-0000-0000000000a1',
             '72000000-0000-0000-0000-0000000000a1', 1, 5);
        raise exception 'N9b FAIL: aceptó una fila con tenant B bajo contexto A';
    exception
        when insufficient_privilege or foreign_key_violation then null;
    end;

    raise notice 'N9 PASS: sale_line_batches rechazó cruces de tenant (23503/42501)';
end $$;


-- -----------------------------------------------------------------------------
-- N10 — online_store_catalog
-- PRECONDICIÓN: contexto A; tienda A; variante A y variante B.
-- SQL DE PRUEBA:
--   insert into online_store_catalog (tenant_id, store_id, variant_id, ...)
--   values (A, storeA, variantB, ...);
-- RESULTADO ESPERADO: PASS si la FK compuesta rechaza la variante B.
--   BLOQ si `online_store_catalog` no existe (42P01).
-- SQLSTATE: 23503 (variante/tienda de otro tenant); 42501 si RLS rechaza antes.
-- -----------------------------------------------------------------------------
do $$
begin
    -- Fila válida: tienda A + variante A.
    insert into public.online_store_catalog
        (tenant_id, store_id, variant_id, is_published, stock_mode, stock_value,
         price_override, sort_order)
    values
        ('00000000-0000-0000-0000-0000000000a1',
         '75000000-0000-0000-0000-0000000000a1',
         '71000000-0000-0000-0000-0000000000a1',
         true, 'all', null, 19.99, 10);

    -- N10: variante B en catálogo A → FK compuesta.
    begin
        insert into public.online_store_catalog
            (tenant_id, store_id, variant_id, is_published)
        values
            ('00000000-0000-0000-0000-0000000000a1',
             '75000000-0000-0000-0000-0000000000a1',
             '71000000-0000-0000-0000-0000000000b2',
             true);
        raise exception 'N10 FAIL: aceptó una variante del tenant B en el catálogo A';
    exception
        when foreign_key_violation then null;
    end;

    -- N10b: tienda B bajo contexto A.
    begin
        insert into public.online_store_catalog
            (tenant_id, store_id, variant_id, is_published)
        values
            ('00000000-0000-0000-0000-0000000000b2',
             '75000000-0000-0000-0000-0000000000b2',
             '71000000-0000-0000-0000-0000000000a1',
             true);
        raise exception 'N10b FAIL: aceptó una tienda del tenant B bajo contexto A';
    exception
        when insufficient_privilege or foreign_key_violation then null;
    end;

    raise notice 'N10 PASS: online_store_catalog rechazó cruces de tenant (23503/42501)';
end $$;


-- -----------------------------------------------------------------------------
-- N16 — stock_balances con contexto A
-- PRECONDICIÓN: contexto A; lote A con 90 y lote B con 40.
-- SQL DE PRUEBA:
--   select count(*) from stock_balances where tenant_id = B;
--   select coalesce(sum(on_hand), 0) from stock_balances;
-- RESULTADO ESPERADO: PASS si B = 0 y la suma = 90 (solo A). BLOQ si no existe.
-- SQLSTATE: — (0 filas); 42501 si se deniega el acceso; 42P01 si falta.
-- -----------------------------------------------------------------------------
do $$
declare
    v_b_count bigint;
    v_total numeric;
    v_kind text;
begin
    -- N16 exige que `stock_balances` sea una vista protegible, no una matview.
    select relkind::text into v_kind
      from pg_class
     where oid = 'public.stock_balances'::regclass;
    if v_kind is distinct from 'v' then
        raise exception 'N16 FAIL: stock_balances no es una vista (relkind=%)', v_kind;
    end if;

    select count(*) into v_b_count
      from public.stock_balances
     where tenant_id = '00000000-0000-0000-0000-0000000000b2';
    if v_b_count <> 0 then
        raise exception 'N16 FAIL: stock_balances mostró % filas del tenant B', v_b_count;
    end if;

    select coalesce(sum(on_hand), 0) into v_total
      from public.stock_balances;
    if v_total <> 90 then
        raise exception 'N16 FAIL: stock_balances sumó % (se esperaba 90 solo de A)', v_total;
    end if;

    raise notice 'N16 PASS: stock_balances solo devuelve el tenant A (90)';
end $$;


-- -----------------------------------------------------------------------------
-- N17 — vw_sales_summary con contexto A
-- PRECONDICIÓN: contexto A; venta A (20) y venta B (30).
-- SQL DE PRUEBA:
--   select count(*) from vw_sales_summary;
--   select count(*) from vw_sales_summary where tenant_id = B;
--   select reloptions from pg_class where oid = 'public.vw_sales_summary'::regclass;
-- RESULTADO ESPERADO: PASS si solo A (1 fila), B = 0 y reloptions contiene
--   security_invoker=true. BLOQ si no existe.
-- SQLSTATE: — (0 filas); 42501 si falta permiso; 42P01 si falta la vista.
-- -----------------------------------------------------------------------------
do $$
declare
    v_count bigint;
    v_b_count bigint;
    v_options text[];
begin
    select count(*) into v_count from public.vw_sales_summary;
    if v_count <> 1 then
        raise exception 'N17 FAIL: vw_sales_summary devolvió % filas (se esperaba 1 de A)', v_count;
    end if;

    select count(*) into v_b_count
      from public.vw_sales_summary
     where tenant_id = '00000000-0000-0000-0000-0000000000b2';
    if v_b_count <> 0 then
        raise exception 'N17 FAIL: vw_sales_summary mostró % filas del tenant B', v_b_count;
    end if;

    select reloptions into v_options
      from pg_class
     where oid = 'public.vw_sales_summary'::regclass;

    if not ('security_invoker=true' = any(coalesce(v_options, array[]::text[]))) then
        raise exception 'N17 FAIL: la vista no tiene security_invoker=true (reloptions=%)',
            coalesce(v_options::text, 'null');
    end if;

    raise notice 'N17 PASS: vw_sales_summary es security_invoker y solo devuelve A';
end $$;


-- -----------------------------------------------------------------------------
-- N18 — fn_claim_async_jobs
-- PRECONDICIÓN: contexto A; job A y job B ambos queued; worker 'w1'.
-- SQL DE PRUEBA:
--   select count(*) from fn_claim_async_jobs('fixture', 'w1', 10, 300);
-- RESULTADO ESPERADO: PASS si devuelve 1 job (A) y todos son del tenant A.
--   BLOQ si la función no existe (42P01).
-- SQLSTATE: — (0 o 1 fila); 42501 sin contexto; 22023 argumentos inválidos.
-- -----------------------------------------------------------------------------
do $$
declare
    v_count bigint;
    v_foreign bigint;
begin
    select count(*) into v_count
      from public.fn_claim_async_jobs('fixture', 'w1', 10, 300);

    if v_count <> 1 then
        raise exception 'N18 FAIL: claim devolvió % jobs (se esperaba 1 del tenant A)', v_count;
    end if;

    select count(*) into v_foreign
      from public.fn_claim_async_jobs('fixture', 'w1-again', 10, 300);
    -- El lease del worker w1 sigue vigente; el segundo worker no debe reclamar A
    -- ni ver B. Si devuelve >0, es una fuga o un lease mal aplicado.
    if v_foreign <> 0 then
        raise exception 'N18 FAIL: un segundo claim reclamó % jobs con lease vigente', v_foreign;
    end if;

    raise notice 'N18 PASS: claim solo devuelve jobs del tenant A y respeta el lease';
end $$;

-- Verificación de que el job B sigue queued (con owner, fuera de la RLS).
reset role;
do $$
declare
    v_status text;
begin
    select status into v_status
      from public.async_jobs
     where job_id = '86000000-0000-0000-0000-0000000000b2';
    if v_status is distinct from 'queued' then
        raise exception 'N18 FAIL: el job B cambió a % (debía seguir queued)', v_status;
    end if;
    raise notice 'N18 PASS: el job del tenant B permaneció queued';
end $$;
set local role ofirone_pending_n_actor;
select set_config('app.tenant_id',
                  '00000000-0000-0000-0000-0000000000a1', true);


-- -----------------------------------------------------------------------------
-- N19 — fn_complete_async_job
-- PRECONDICIÓN: job A reclamado por 'w1' en N18; job B queued de otro tenant.
-- SQL DE PRUEBA:
--   select fn_complete_async_job(jobB, 'w1');
--   select fn_complete_async_job(jobA, 'w1');
-- RESULTADO ESPERADO: PASS si B lanza 42501, A pasa a succeeded y repetir el
--   complete de A con el mismo worker es idempotente. BLOQ si la función no existe.
-- SQLSTATE: 42501 para otro tenant/worker/lease vencido; 42P01 si falta.
-- -----------------------------------------------------------------------------
do $$
declare
    v_job public.async_jobs%rowtype;
begin
    -- N19: job del tenant B bajo contexto A → no visible, 42501.
    begin
        perform public.fn_complete_async_job(
            '86000000-0000-0000-0000-0000000000b2', 'w1', 300);
        raise exception 'N19 FAIL: completó un job del tenant B bajo contexto A';
    exception
        when insufficient_privilege then null;
    end;

    -- Job A reclamado por w1: debe completar.
    select * into v_job
      from public.fn_complete_async_job(
          '86000000-0000-0000-0000-0000000000a1', 'w1', 300);

    if v_job.status <> 'succeeded' then
        raise exception 'N19 FAIL: el job A quedó en % (se esperaba succeeded)', v_job.status;
    end if;

    -- Idempotencia: repetir el complete del mismo worker no falla ni duplica.
    select * into v_job
      from public.fn_complete_async_job(
          '86000000-0000-0000-0000-0000000000a1', 'w1', 300);

    if v_job.status <> 'succeeded' then
        raise exception 'N19 FAIL: el complete idempotente dejó el job A en %', v_job.status;
    end if;

    raise notice 'N19 PASS: complete rechazó el job B (42501) y fue idempotente para A';
end $$;


-- N18b: claim sin contexto → 42501.
select set_config('app.tenant_id', '', true);
do $$
begin
    begin
        perform public.fn_claim_async_jobs('fixture', 'w3', 10, 300);
        raise exception 'N18b FAIL: claim aceptado sin app.tenant_id';
    exception
        when insufficient_privilege then null;
    end;
    raise notice 'N18b PASS: claim sin contexto devuelve 42501';
end $$;

reset role;
rollback;

-- =============================================================================
-- FIN
-- =============================================================================
-- Tras el ROLLBACK no quedan fixtures, roles ni jobs de prueba. El DDL de la
-- propuesta sí permanece en la base desechable: destruirla.
--
-- Resumen de estados esperados hoy:
--   N8  RESUELTO/PASS con membership_roles (no requiere migración)
--   N9  BLOQ (42P01) → PASS tras migración
--   N10 BLOQ (42P01) → PASS tras migración
--   N16 BLOQ (42P01) → PASS con vista security_invoker; FAIL si se expone matview
--   N17 BLOQ (42P01) → PASS con security_invoker=true
--   N18 BLOQ (42P01) → PASS con claim por tenant
--   N19 BLOQ (42P01) → PASS con complete 42501/idempotente
-- =============================================================================
