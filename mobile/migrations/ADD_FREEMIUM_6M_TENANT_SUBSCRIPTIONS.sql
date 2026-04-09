-- ============================================================
-- Plan freemium + backfill seguro de suscripciones por 6 meses
-- Solo asigna a tenants sin suscripcion abierta
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1) Seed comercial del plan freemium
-- ============================================================

insert into billing_plans (code, name, description, is_public, is_active, is_custom, sort_order)
values
  (
    'freemium',
    'Freemium',
    'Plan promocional sin costo por 6 meses para tenants sin suscripcion abierta.',
    false,
    true,
    false,
    15
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  is_public = excluded.is_public,
  is_active = excluded.is_active,
  is_custom = excluded.is_custom,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into billing_plan_prices (
  plan_id,
  currency_code,
  billing_interval,
  amount,
  setup_fee,
  trial_days,
  grace_days,
  auto_renew_default,
  is_active
)
select
  bp.plan_id,
  'COP',
  'semiannual',
  0,
  0,
  0,
  7,
  false,
  true
from billing_plans bp
where bp.code = 'freemium'
on conflict (plan_id, currency_code, billing_interval) do update
set
  amount = excluded.amount,
  setup_fee = excluded.setup_fee,
  trial_days = excluded.trial_days,
  grace_days = excluded.grace_days,
  auto_renew_default = excluded.auto_renew_default,
  is_active = excluded.is_active,
  updated_at = now();

insert into billing_plan_features (plan_id, feature_code, feature_name, is_enabled)
select bp.plan_id, seed.feature_code, seed.feature_name, seed.is_enabled
from (
  values
    ('POS_CORE', 'Punto de venta base', true),
    ('OFFLINE_MODE', 'Operacion offline', true),
    ('AI_ASSISTANT', 'Asistente IA', false),
    ('OCR_IMPORT', 'Importacion por OCR', false),
    ('ADVANCED_REPORTS', 'Reportes avanzados', false)
) as seed(feature_code, feature_name, is_enabled)
join billing_plans bp on bp.code = 'freemium'
on conflict (plan_id, feature_code) do update
set
  feature_name = excluded.feature_name,
  is_enabled = excluded.is_enabled,
  updated_at = now();

insert into billing_plan_limits (plan_id, limit_code, limit_name, limit_value, limit_unit)
select bp.plan_id, seed.limit_code, seed.limit_name, seed.limit_value, seed.limit_unit
from (
  values
    ('users_active', 'Usuarios activos', 3, 'count'),
    ('locations_max', 'Sedes maximas', 1, 'count'),
    ('cash_registers_max', 'Cajas maximas', 2, 'count'),
    ('products_max', 'Productos maximos', 2000, 'count'),
    ('invoices_per_month', 'Facturas por mes', 1000, 'count')
) as seed(limit_code, limit_name, limit_value, limit_unit)
join billing_plans bp on bp.code = 'freemium'
on conflict (plan_id, limit_code) do update
set
  limit_name = excluded.limit_name,
  limit_value = excluded.limit_value,
  limit_unit = excluded.limit_unit,
  updated_at = now();

-- ============================================================
-- 2) Backfill de suscripciones abiertas faltantes
-- ============================================================

do $$
declare
  v_tenant_pk_column text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenants'
      and column_name = 'tenant_id'
  ) then
    v_tenant_pk_column := 'tenant_id';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenants'
      and column_name = 'id'
  ) then
    v_tenant_pk_column := 'id';
  else
    raise exception 'No se encontro public.tenants.tenant_id ni public.tenants.id; ajusta la migracion antes de continuar.';
  end if;

  execute format(
    $sql$
      with freemium_plan as (
        select
          bp.plan_id,
          bpp.plan_price_id
        from billing_plans bp
        join billing_plan_prices bpp on bpp.plan_id = bp.plan_id
        where bp.code = 'freemium'
          and bpp.currency_code = 'COP'
          and bpp.billing_interval = 'semiannual'
          and bpp.is_active = true
        limit 1
      ),
      candidate_tenants as (
        select t.%1$I as tenant_id
        from tenants t
        where not exists (
          select 1
          from tenant_subscriptions ts
          where ts.tenant_id = t.%1$I
            and ts.status in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period')
        )
      ),
      inserted_subscriptions as (
        insert into tenant_subscriptions (
          tenant_id,
          plan_id,
          plan_price_id,
          status,
          start_at,
          current_period_start,
          current_period_end,
          renewal_mode,
          metadata
        )
        select
          ct.tenant_id,
          fp.plan_id,
          fp.plan_price_id,
          'active',
          now(),
          now(),
          now() + interval '6 months',
          'manual',
          jsonb_build_object(
            'source', 'migration',
            'mode', 'freemium_backfill_6m',
            'applied_at', now(),
            'plan_code', 'freemium'
          )
        from candidate_tenants ct
        cross join freemium_plan fp
        returning subscription_id, tenant_id, current_period_start, current_period_end
      ),
      inserted_periods as (
        insert into tenant_subscription_periods (
          subscription_id,
          tenant_id,
          period_number,
          period_start,
          period_end,
          status
        )
        select
          isub.subscription_id,
          isub.tenant_id,
          1,
          isub.current_period_start,
          isub.current_period_end,
          'paid'
        from inserted_subscriptions isub
        returning subscription_id, tenant_id
      )
      insert into tenant_subscription_events (
        subscription_id,
        tenant_id,
        event_type,
        event_source,
        payload
      )
      select
        isub.subscription_id,
        isub.tenant_id,
        'subscription_created',
        'system',
        jsonb_build_object(
          'source', 'migration',
          'mode', 'freemium_backfill_6m',
          'plan_code', 'freemium',
          'period_months', 6
        )
      from inserted_subscriptions isub;
    $sql$,
    v_tenant_pk_column
  );
end $$;

