-- ============================================================
-- RPC seguro para listar tenants desde el panel de superadmin
-- Evita lecturas vacias por RLS en la tabla tenants
-- ============================================================

create or replace function fn_superadmin_list_tenants()
returns table (
  tenant_id uuid,
  name text,
  legal_name text,
  tax_id text,
  email text,
  phone text,
  address text,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid;
  v_has_profile boolean := false;
begin
  v_auth_user_id := auth.uid();

  if v_auth_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select exists (
    select 1
    from users
    where auth_user_id = v_auth_user_id
  )
  into v_has_profile;

  if v_has_profile then
    raise exception 'Solo Super Administradores pueden listar tenants';
  end if;

  return query
  select
    t.tenant_id,
    t.name,
    t.legal_name,
    t.tax_id,
    t.email,
    t.phone,
    t.address,
    t.is_active,
    t.created_at
  from tenants t
  order by t.created_at desc nulls last, t.name asc;
end;
$$;

revoke all on function fn_superadmin_list_tenants() from public;
grant execute on function fn_superadmin_list_tenants() to authenticated;

comment on function fn_superadmin_list_tenants is
'Lista tenants para superadmin via SECURITY DEFINER, sin depender de SELECT directo sobre tenants.';
