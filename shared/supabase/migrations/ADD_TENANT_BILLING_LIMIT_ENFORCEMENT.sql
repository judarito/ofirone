-- ============================================================
-- Billing multi-tenant: enforcement real de limites por plan
-- ============================================================

create or replace function fn_get_tenant_billing_limit_value(
  p_tenant_id uuid,
  p_limit_code text
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (tbs.plan_limits -> lower(coalesce(p_limit_code, '')) ->> 'value')::numeric
  from tenant_billing_summary tbs
  where tbs.tenant_id = p_tenant_id
  limit 1;
$$;

create or replace function fn_get_tenant_billing_limit_usage(
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_tenant_id uuid;
  v_current_tenant_id uuid;
begin
  v_current_tenant_id := get_current_user_tenant_id();
  v_requested_tenant_id := coalesce(p_tenant_id, v_current_tenant_id);

  if v_requested_tenant_id is null then
    return '{}'::jsonb;
  end if;

  if not (fn_is_super_admin() or v_requested_tenant_id = v_current_tenant_id) then
    raise exception 'Solo puedes consultar limites de billing de tu tenant';
  end if;

  return jsonb_build_object(
    'users_active',
      coalesce((
        select count(*)
        from users
        where tenant_id = v_requested_tenant_id
          and coalesce(is_active, true) = true
      ), 0),
    'locations_max',
      coalesce((
        select count(*)
        from locations
        where tenant_id = v_requested_tenant_id
          and coalesce(is_active, true) = true
      ), 0),
    'cash_registers_max',
      coalesce((
        select count(*)
        from cash_registers
        where tenant_id = v_requested_tenant_id
          and coalesce(is_active, true) = true
      ), 0),
    'products_max',
      coalesce((
        select count(*)
        from products
        where tenant_id = v_requested_tenant_id
          and coalesce(is_active, true) = true
      ), 0),
    'invoices_per_month',
      coalesce((
        select count(*)
        from sales
        where tenant_id = v_requested_tenant_id
          and sold_at >= date_trunc('month', now())
          and sold_at < date_trunc('month', now()) + interval '1 month'
      ), 0)
  );
end;
$$;

create or replace function fn_enforce_tenant_plan_limit_on_active_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_limit_code text := lower(coalesce(TG_ARGV[0], ''));
  v_entity_label text := coalesce(nullif(TG_ARGV[1], ''), 'registros');
  v_tenant_id uuid;
  v_limit numeric;
  v_current_count bigint;
  v_plan_name text;
  v_new_active boolean;
  v_old_active boolean;
begin
  if TG_OP not in ('INSERT', 'UPDATE') then
    return new;
  end if;

  v_tenant_id := new.tenant_id;
  if v_tenant_id is null then
    return new;
  end if;

  v_new_active := coalesce(new.is_active, true);
  v_old_active := case
    when TG_OP = 'UPDATE' then coalesce(old.is_active, true)
    else false
  end;

  if not v_new_active then
    return new;
  end if;

  if TG_OP = 'UPDATE' and v_old_active = true and old.tenant_id = new.tenant_id then
    return new;
  end if;

  v_limit := fn_get_tenant_billing_limit_value(v_tenant_id, v_limit_code);
  if v_limit is null then
    return new;
  end if;

  execute format(
    'select count(*) from %I where tenant_id = $1 and coalesce(is_active, true) = true',
    TG_TABLE_NAME
  )
  into v_current_count
  using v_tenant_id;

  if v_current_count >= v_limit then
    select coalesce(plan_name, plan_code, 'actual')
    into v_plan_name
    from tenant_billing_summary
    where tenant_id = v_tenant_id
    limit 1;

    raise exception using
      message = format(
        'Tu plan %s permite hasta %s %s. Actualiza tu suscripcion o libera cupos antes de continuar.',
        coalesce(v_plan_name, 'actual'),
        trim(to_char(v_limit, 'FM999999999990D##')),
        v_entity_label
      );
  end if;

  return new;
end;
$$;

create or replace function fn_enforce_tenant_invoice_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_limit numeric;
  v_current_count bigint;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_plan_name text;
begin
  if TG_OP <> 'INSERT' then
    return new;
  end if;

  if new.tenant_id is null then
    return new;
  end if;

  v_limit := fn_get_tenant_billing_limit_value(new.tenant_id, 'invoices_per_month');
  if v_limit is null then
    return new;
  end if;

  v_period_start := date_trunc('month', coalesce(new.sold_at, now()));
  v_period_end := v_period_start + interval '1 month';

  select count(*)
  into v_current_count
  from sales
  where tenant_id = new.tenant_id
    and coalesce(sold_at, now()) >= v_period_start
    and coalesce(sold_at, now()) < v_period_end;

  if v_current_count >= v_limit then
    select coalesce(plan_name, plan_code, 'actual')
    into v_plan_name
    from tenant_billing_summary
    where tenant_id = new.tenant_id
    limit 1;

    raise exception using
      message = format(
        'Tu plan %s permite hasta %s facturas por mes. Actualiza tu suscripcion o espera al siguiente periodo.',
        coalesce(v_plan_name, 'actual'),
        trim(to_char(v_limit, 'FM999999999990D##'))
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_users_active_limit on users;
create trigger trg_enforce_users_active_limit
before insert or update on users
for each row
execute function fn_enforce_tenant_plan_limit_on_active_row('users_active', 'usuarios activos');

drop trigger if exists trg_enforce_locations_limit on locations;
create trigger trg_enforce_locations_limit
before insert or update on locations
for each row
execute function fn_enforce_tenant_plan_limit_on_active_row('locations_max', 'sedes activas');

drop trigger if exists trg_enforce_cash_registers_limit on cash_registers;
create trigger trg_enforce_cash_registers_limit
before insert or update on cash_registers
for each row
execute function fn_enforce_tenant_plan_limit_on_active_row('cash_registers_max', 'cajas activas');

drop trigger if exists trg_enforce_products_limit on products;
create trigger trg_enforce_products_limit
before insert or update on products
for each row
execute function fn_enforce_tenant_plan_limit_on_active_row('products_max', 'productos activos');

drop trigger if exists trg_enforce_sales_invoice_limit on sales;
create trigger trg_enforce_sales_invoice_limit
before insert on sales
for each row
execute function fn_enforce_tenant_invoice_limit();

grant execute on function fn_get_tenant_billing_limit_value(uuid, text) to authenticated;
grant execute on function fn_get_tenant_billing_limit_usage(uuid) to authenticated;

comment on function fn_get_tenant_billing_limit_value is
  'Obtiene el valor numerico efectivo de un limite comercial del plan vigente del tenant.';

comment on function fn_get_tenant_billing_limit_usage is
  'Entrega el uso actual de limites comerciales clave del tenant autenticado o consultado por superadmin.';
