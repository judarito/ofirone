-- ============================================================
-- Billing multi-tenant: workflows de superadmin y consumo web
-- Complementa ADD_TENANT_BILLING_MONETIZATION.sql
-- ============================================================

-- ============================================================
-- 1) Políticas adicionales para superadmin sin tenant
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plans'
      and policyname = 'billing_plans_write_superadmin'
  ) then
    create policy billing_plans_write_superadmin on billing_plans
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plan_prices'
      and policyname = 'billing_plan_prices_write_superadmin'
  ) then
    create policy billing_plan_prices_write_superadmin on billing_plan_prices
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plan_features'
      and policyname = 'billing_plan_features_write_superadmin'
  ) then
    create policy billing_plan_features_write_superadmin on billing_plan_features
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plan_limits'
      and policyname = 'billing_plan_limits_write_superadmin'
  ) then
    create policy billing_plan_limits_write_superadmin on billing_plan_limits
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscriptions'
      and policyname = 'tenant_subscriptions_superadmin_all'
  ) then
    create policy tenant_subscriptions_superadmin_all on tenant_subscriptions
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_periods'
      and policyname = 'tenant_subscription_periods_superadmin_all'
  ) then
    create policy tenant_subscription_periods_superadmin_all on tenant_subscription_periods
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_events'
      and policyname = 'tenant_subscription_events_superadmin_all'
  ) then
    create policy tenant_subscription_events_superadmin_all on tenant_subscription_events
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_invoices'
      and policyname = 'tenant_invoices_superadmin_all'
  ) then
    create policy tenant_invoices_superadmin_all on tenant_invoices
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payments'
      and policyname = 'tenant_payments_superadmin_all'
  ) then
    create policy tenant_payments_superadmin_all on tenant_payments
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payment_methods'
      and policyname = 'tenant_payment_methods_superadmin_all'
  ) then
    create policy tenant_payment_methods_superadmin_all on tenant_payment_methods
      for all
      using (fn_is_super_admin())
      with check (fn_is_super_admin());
  end if;
end
$$;

-- ============================================================
-- 2) Lectura resumida de billing por tenant / superadmin
-- ============================================================

create or replace function fn_get_tenant_billing_summary(p_tenant_id uuid default null)
returns setof tenant_billing_summary
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
    return;
  end if;

  if fn_is_super_admin() or v_requested_tenant_id = v_current_tenant_id then
    return query
    select *
    from tenant_billing_summary
    where tenant_id = v_requested_tenant_id;
  end if;

  return;
end;
$$;

create or replace function fn_superadmin_list_tenant_billing_summary()
returns table (
  tenant_id uuid,
  tenant_name text,
  tenant_email text,
  tenant_is_active boolean,
  subscription_id uuid,
  plan_id uuid,
  plan_code text,
  plan_name text,
  status text,
  renewal_mode text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end_at timestamptz,
  grace_end_at timestamptz,
  days_to_expiry integer,
  can_operate_sales boolean,
  can_operate_admin boolean,
  banner_message text,
  feature_flags jsonb,
  plan_limits jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not fn_is_super_admin() then
    raise exception 'Solo Super Administradores pueden consultar billing global';
  end if;

  return query
  select
    t.tenant_id,
    t.name as tenant_name,
    t.email as tenant_email,
    t.is_active as tenant_is_active,
    s.subscription_id,
    s.plan_id,
    s.plan_code,
    s.plan_name,
    s.status,
    s.renewal_mode,
    s.current_period_start,
    s.current_period_end,
    s.trial_end_at,
    s.grace_end_at,
    s.days_to_expiry,
    s.can_operate_sales,
    s.can_operate_admin,
    s.banner_message,
    s.feature_flags,
    s.plan_limits
  from tenants t
  left join tenant_billing_summary s on s.tenant_id = t.tenant_id
  order by t.created_at desc nulls last, t.name asc;
end;
$$;

-- ============================================================
-- 3) Workflow seguro: asignar plan a un tenant
-- ============================================================

create or replace function fn_superadmin_assign_tenant_plan(
  p_tenant_id uuid,
  p_plan_price_id uuid,
  p_status text default 'active',
  p_start_at timestamptz default now(),
  p_trial_end_at timestamptz default null,
  p_current_period_end timestamptz default null,
  p_renewal_mode text default 'manual',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_plan_code text;
  v_plan_name text;
  v_billing_interval text;
  v_trial_days integer;
  v_subscription_id uuid;
  v_period_end timestamptz;
  v_effective_trial_end timestamptz;
begin
  if not fn_is_super_admin() then
    return jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Solo Super Administradores pueden asignar planes'
    );
  end if;

  if p_status not in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period', 'suspended', 'canceled', 'expired') then
    raise exception 'Estado de suscripcion no soportado: %', p_status;
  end if;

  if p_renewal_mode not in ('manual', 'auto') then
    raise exception 'renewal_mode no soportado: %', p_renewal_mode;
  end if;

  select
    bpp.plan_id,
    bp.code,
    bp.name,
    bpp.billing_interval,
    bpp.trial_days
  into
    v_plan_id,
    v_plan_code,
    v_plan_name,
    v_billing_interval,
    v_trial_days
  from billing_plan_prices bpp
  join billing_plans bp on bp.plan_id = bpp.plan_id
  where bpp.plan_price_id = p_plan_price_id
    and bpp.is_active = true
    and bp.is_active = true;

  if v_plan_id is null then
    raise exception 'No se encontro plan/precio activo para plan_price_id=%', p_plan_price_id;
  end if;

  update tenant_subscriptions
  set
    status = case
      when status in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period') then 'canceled'
      else status
    end,
    canceled_at = case
      when status in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period') then now()
      else canceled_at
    end,
    updated_at = now()
  where tenant_id = p_tenant_id
    and status in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period');

  v_effective_trial_end := null;
  if p_status = 'trialing' then
    v_effective_trial_end := coalesce(
      p_trial_end_at,
      p_start_at + make_interval(days => greatest(coalesce(v_trial_days, 0), 1))
    );
  end if;

  v_period_end := p_current_period_end;
  if v_period_end is null and p_status <> 'trialing' then
    v_period_end := case v_billing_interval
      when 'monthly' then p_start_at + interval '1 month'
      when 'quarterly' then p_start_at + interval '3 months'
      when 'semiannual' then p_start_at + interval '6 months'
      when 'annual' then p_start_at + interval '1 year'
      else p_start_at + interval '1 month'
    end;
  end if;

  insert into tenant_subscriptions (
    tenant_id,
    plan_id,
    plan_price_id,
    status,
    start_at,
    current_period_start,
    current_period_end,
    trial_end_at,
    renewal_mode,
    metadata
  )
  values (
    p_tenant_id,
    v_plan_id,
    p_plan_price_id,
    p_status,
    p_start_at,
    p_start_at,
    v_period_end,
    v_effective_trial_end,
    p_renewal_mode,
    jsonb_build_object(
      'source', 'superadmin_web',
      'note', coalesce(p_note, ''),
      'assigned_at', now(),
      'assigned_by_email', auth.email()
    )
  )
  returning subscription_id into v_subscription_id;

  if v_period_end is not null then
    insert into tenant_subscription_periods (
      subscription_id,
      tenant_id,
      period_number,
      period_start,
      period_end,
      status
    )
    values (
      v_subscription_id,
      p_tenant_id,
      1,
      p_start_at,
      v_period_end,
      case
        when p_status in ('active', 'past_due', 'grace_period') then 'paid'
        when p_status = 'pending_activation' then 'pending'
        else 'pending'
      end
    );
  end if;

  insert into tenant_subscription_events (
    subscription_id,
    tenant_id,
    event_type,
    event_source,
    payload
  )
  values (
    v_subscription_id,
    p_tenant_id,
    'subscription_created',
    'admin',
    jsonb_build_object(
      'plan_id', v_plan_id,
      'plan_code', v_plan_code,
      'plan_name', v_plan_name,
      'status', p_status,
      'renewal_mode', p_renewal_mode,
      'note', coalesce(p_note, '')
    )
  );

  return jsonb_build_object(
    'success', true,
    'subscription_id', v_subscription_id,
    'tenant_id', p_tenant_id,
    'plan_id', v_plan_id,
    'plan_code', v_plan_code,
    'plan_name', v_plan_name,
    'status', p_status
  );
end;
$$;

-- ============================================================
-- 4) Workflow seguro: cambiar estado de suscripción
-- ============================================================

create or replace function fn_superadmin_update_subscription_status(
  p_subscription_id uuid,
  p_status text,
  p_grace_end_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription tenant_subscriptions%rowtype;
begin
  if not fn_is_super_admin() then
    return jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Solo Super Administradores pueden cambiar el estado de billing'
    );
  end if;

  if p_status not in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period', 'suspended', 'canceled', 'expired') then
    raise exception 'Estado de suscripcion no soportado: %', p_status;
  end if;

  select *
  into v_subscription
  from tenant_subscriptions
  where subscription_id = p_subscription_id;

  if not found then
    raise exception 'No se encontro subscription_id=%', p_subscription_id;
  end if;

  update tenant_subscriptions
  set
    status = p_status,
    grace_end_at = case
      when p_status = 'grace_period' then coalesce(p_grace_end_at, grace_end_at, now() + interval '5 days')
      when p_status in ('active', 'trialing', 'pending_activation') then null
      else grace_end_at
    end,
    suspended_at = case
      when p_status = 'suspended' then now()
      when p_status <> 'suspended' then null
      else suspended_at
    end,
    canceled_at = case
      when p_status = 'canceled' then now()
      else canceled_at
    end,
    updated_at = now()
  where subscription_id = p_subscription_id;

  insert into tenant_subscription_events (
    subscription_id,
    tenant_id,
    event_type,
    event_source,
    payload
  )
  values (
    p_subscription_id,
    v_subscription.tenant_id,
    'subscription_status_changed',
    'admin',
    jsonb_build_object(
      'previous_status', v_subscription.status,
      'new_status', p_status,
      'grace_end_at', p_grace_end_at,
      'note', coalesce(p_note, '')
    )
  );

  return jsonb_build_object(
    'success', true,
    'subscription_id', p_subscription_id,
    'tenant_id', v_subscription.tenant_id,
    'previous_status', v_subscription.status,
    'status', p_status
  );
end;
$$;

grant execute on function fn_get_tenant_billing_summary(uuid) to authenticated;
grant execute on function fn_superadmin_list_tenant_billing_summary() to authenticated;
grant execute on function fn_superadmin_assign_tenant_plan(uuid, uuid, text, timestamptz, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function fn_superadmin_update_subscription_status(uuid, text, timestamptz, text) to authenticated;

comment on function fn_get_tenant_billing_summary is
'Retorna el resumen comercial de un tenant. Superadmin puede consultar cualquier tenant; usuarios normales solo su tenant.';

comment on function fn_superadmin_list_tenant_billing_summary is
'Lista el resumen comercial de todos los tenants para paneles globales de superadmin.';

comment on function fn_superadmin_assign_tenant_plan is
'Cierra la suscripcion abierta previa del tenant, crea una nueva suscripcion y registra su evento inicial.';

comment on function fn_superadmin_update_subscription_status is
'Actualiza el estado de una suscripcion y registra el evento comercial correspondiente.';
