-- ============================================================
-- Fix RLS para sale_counters en consecutivos de venta
-- Evita que fn_next_sale_number falle cuando sale_counters
-- tiene RLS activa en ambientes productivos.
-- ============================================================

create table if not exists sale_counters (
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  location_id uuid not null references locations(location_id) on delete cascade,
  next_sale_number bigint not null default 1,
  primary key (tenant_id, location_id)
);

create index if not exists ix_sale_counters_tenant_loc
  on sale_counters(tenant_id, location_id);

create or replace function fn_next_sale_number(p_tenant uuid, p_location uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  if p_tenant is null or p_location is null then
    raise exception 'tenant y location son requeridos para generar consecutivo de venta';
  end if;

  if not exists (
    select 1
    from locations l
    where l.location_id = p_location
      and l.tenant_id = p_tenant
  ) then
    raise exception 'La sede % no pertenece al tenant %', p_location, p_tenant;
  end if;

  insert into sale_counters (tenant_id, location_id, next_sale_number)
  values (p_tenant, p_location, 1)
  on conflict (tenant_id, location_id) do nothing;

  update sale_counters
     set next_sale_number = next_sale_number + 1
   where tenant_id = p_tenant
     and location_id = p_location
  returning next_sale_number - 1 into v_number;

  if v_number is null then
    raise exception 'No fue posible generar consecutivo de venta para tenant % y sede %', p_tenant, p_location;
  end if;

  return v_number;
end;
$$;

revoke all on function fn_next_sale_number(uuid, uuid) from public;
grant execute on function fn_next_sale_number(uuid, uuid) to authenticated;

comment on function fn_next_sale_number(uuid, uuid) is
'Genera el siguiente consecutivo de venta por tenant/sede usando SECURITY DEFINER para evitar bloqueos por RLS en sale_counters.';
