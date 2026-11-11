-- ============================================================================
-- PROPUESTA — NO EJECUTAR COMO MIGRACIÓN REAL (ADR-009)
-- Guardas de integridad P1 detectadas en la suite de ciclo de vida:
--   1) transiciones de estado de compras;
--   2) sobrepago de cuentas por pagar (y sincronización de paid_amount);
--   3) enlace apartado -> venta (conversión).
-- Base 0001–0012; PostgreSQL 15+. Sin credenciales ni datos reales.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Transiciones de estado de compras
-- ----------------------------------------------------------------------------
create function app_private.purchases_status_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    if new.status is distinct from old.status then
        if not (
            (old.status = 'draft'              and new.status in ('draft','ordered','cancelled')) or
            (old.status = 'ordered'            and new.status in ('ordered','partially_received','received','cancelled')) or
            (old.status = 'partially_received' and new.status in ('partially_received','received','cancelled')) or
            (old.status = 'received'           and new.status in ('received','returned')) or
            (old.status = 'returned'           and new.status = 'returned') or
            (old.status = 'cancelled'          and new.status = 'cancelled')
        ) then
            raise exception 'transición de compra no permitida: % -> %', old.status, new.status
                using errcode = '23514';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists purchases_status_guard on public.purchases;
create trigger purchases_status_guard
before update of status on public.purchases
for each row execute function app_private.purchases_status_guard();

-- ----------------------------------------------------------------------------
-- 2) Sobrepago de CxP y sincronización de paid_amount/status
-- ----------------------------------------------------------------------------
create function app_private.supplier_payment_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
    v_original numeric(19,6);
    v_others numeric(19,6);
begin
    select original_amount into v_original
      from public.supplier_payables
     where tenant_id = new.tenant_id and payable_id = new.payable_id
     for update;

    if v_original is null then
        raise exception 'cuenta por pagar inexistente' using errcode = '23503';
    end if;

    select coalesce(sum(amount), 0) into v_others
      from public.supplier_payable_payments
     where tenant_id = new.tenant_id
       and payable_id = new.payable_id
       and (tg_op = 'INSERT' or payable_payment_id <> new.payable_payment_id);

    if v_others + new.amount > v_original then
        raise exception 'el pago excede el saldo de la cuenta por pagar (original %, pagos %)', v_original, v_others
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create function app_private.supplier_payment_sync() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
    v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
    v_payable uuid := coalesce(new.payable_id, old.payable_id);
    v_total numeric(19,6);
    v_original numeric(19,6);
begin
    select coalesce(sum(amount), 0) into v_total
      from public.supplier_payable_payments
     where tenant_id = v_tenant and payable_id = v_payable;
    select original_amount into v_original
      from public.supplier_payables
     where tenant_id = v_tenant and payable_id = v_payable;

    update public.supplier_payables
       set paid_amount = v_total,
           status = case
                      when v_total = 0 then 'open'
                      when v_total < v_original then 'partially_paid'
                      else 'paid'
                    end,
           updated_at = clock_timestamp()
     where tenant_id = v_tenant and payable_id = v_payable and status <> 'cancelled';
    return null;
end;
$$;

drop trigger if exists supplier_payment_guard on public.supplier_payable_payments;
create trigger supplier_payment_guard
before insert or update on public.supplier_payable_payments
for each row execute function app_private.supplier_payment_guard();

drop trigger if exists supplier_payment_sync on public.supplier_payable_payments;
create trigger supplier_payment_sync
after insert or update or delete on public.supplier_payable_payments
for each row execute function app_private.supplier_payment_sync();

-- ----------------------------------------------------------------------------
-- 3) Conversión apartado -> venta
-- ----------------------------------------------------------------------------
alter table public.sales
    add column layaway_contract_id uuid;

alter table public.sales
    add constraint sales_layaway_fk
    foreign key (tenant_id, layaway_contract_id)
    references public.layaway_contracts (tenant_id, layaway_id)
    on delete restrict
    not valid;

alter table public.sales validate constraint sales_layaway_fk;

create unique index sales_layaway_unique_idx
    on public.sales (tenant_id, layaway_contract_id)
    where layaway_contract_id is not null;

comment on column public.sales.layaway_contract_id is
    'Apartado convertido en venta; NULL = venta sin apartado. FK compuesta por tenant.';

-- DOWN (comentado; exportar antes)
-- drop index if exists public.sales_layaway_unique_idx;
-- alter table public.sales drop constraint if exists sales_layaway_fk;
-- alter table public.sales drop column if exists layaway_contract_id;
-- drop trigger if exists supplier_payment_sync on public.supplier_payable_payments;
-- drop trigger if exists supplier_payment_guard on public.supplier_payable_payments;
-- drop function if exists app_private.supplier_payment_sync();
-- drop function if exists app_private.supplier_payment_guard();
-- drop trigger if exists purchases_status_guard on public.purchases;
-- drop function if exists app_private.purchases_status_guard();
