-- ============================================================
-- Monetizacion multi-tenant: planes, suscripciones y renovaciones
-- Dominio separado de tenants y tenant_settings
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1) Catalogo comercial de planes
-- ============================================================

create table if not exists billing_plans (
  plan_id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_public boolean not null default true,
  is_active boolean not null default true,
  is_custom boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing_plan_prices (
  plan_price_id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references billing_plans(plan_id) on delete cascade,
  currency_code char(3) not null default 'COP',
  billing_interval text not null check (billing_interval in ('monthly', 'quarterly', 'semiannual', 'annual')),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  setup_fee numeric(14,2) not null default 0 check (setup_fee >= 0),
  trial_days integer not null default 0 check (trial_days >= 0),
  grace_days integer not null default 0 check (grace_days >= 0),
  auto_renew_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, currency_code, billing_interval)
);

create table if not exists billing_plan_features (
  plan_feature_id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references billing_plans(plan_id) on delete cascade,
  feature_code text not null,
  feature_name text not null,
  is_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, feature_code)
);

create table if not exists billing_plan_limits (
  plan_limit_id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references billing_plans(plan_id) on delete cascade,
  limit_code text not null,
  limit_name text not null,
  limit_value numeric(14,2) not null check (limit_value >= 0),
  limit_unit text not null default 'count',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, limit_code)
);

create index if not exists ix_billing_plan_prices_plan_active
  on billing_plan_prices(plan_id, is_active, billing_interval);

create index if not exists ix_billing_plan_features_plan
  on billing_plan_features(plan_id, feature_code);

create index if not exists ix_billing_plan_limits_plan
  on billing_plan_limits(plan_id, limit_code);

-- ============================================================
-- 2) Suscripciones por tenant (tabla hija de tenants)
-- ============================================================

create table if not exists tenant_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  plan_id uuid not null references billing_plans(plan_id),
  plan_price_id uuid references billing_plan_prices(plan_price_id),
  status text not null default 'pending_activation'
    check (status in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period', 'suspended', 'canceled', 'expired')),
  start_at timestamptz not null default now(),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end_at timestamptz,
  grace_end_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  suspended_at timestamptz,
  renewal_mode text not null default 'manual' check (renewal_mode in ('manual', 'auto')),
  payment_provider text,
  provider_customer_id text,
  provider_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    current_period_start is null
    or current_period_end is null
    or current_period_end >= current_period_start
  ),
  unique (tenant_id, provider_subscription_id)
);

create unique index if not exists ux_tenant_subscriptions_one_open
  on tenant_subscriptions(tenant_id)
  where status in ('trialing', 'active', 'pending_activation', 'past_due', 'grace_period');

create index if not exists ix_tenant_subscriptions_tenant_status
  on tenant_subscriptions(tenant_id, status, current_period_end desc);

create index if not exists ix_tenant_subscriptions_plan
  on tenant_subscriptions(plan_id, status);

create table if not exists tenant_subscription_periods (
  subscription_period_id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references tenant_subscriptions(subscription_id) on delete cascade,
  tenant_id uuid not null,
  period_number integer not null default 1 check (period_number > 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  invoice_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'invoiced', 'paid', 'grace', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (subscription_id, period_number)
);

create index if not exists ix_tenant_subscription_periods_tenant
  on tenant_subscription_periods(tenant_id, period_end desc);

create table if not exists tenant_subscription_events (
  event_id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references tenant_subscriptions(subscription_id) on delete cascade,
  tenant_id uuid not null,
  event_type text not null,
  event_source text not null default 'system'
    check (event_source in ('system', 'admin', 'payment_webhook', 'support')),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists ix_tenant_subscription_events_tenant
  on tenant_subscription_events(tenant_id, created_at desc);

create index if not exists ix_tenant_subscription_events_subscription
  on tenant_subscription_events(subscription_id, created_at desc);

-- ============================================================
-- 3) Invoices, pagos y metodos de pago
-- ============================================================

create table if not exists tenant_invoices (
  invoice_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  subscription_id uuid not null references tenant_subscriptions(subscription_id) on delete cascade,
  subscription_period_id uuid references tenant_subscription_periods(subscription_period_id) on delete set null,
  number text not null,
  currency_code char(3) not null default 'COP',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  due_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'paid', 'void', 'overdue')),
  issued_at timestamptz,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number)
);

create index if not exists ix_tenant_invoices_tenant_status
  on tenant_invoices(tenant_id, status, due_at);

create index if not exists ix_tenant_invoices_subscription
  on tenant_invoices(subscription_id, created_at desc);

create table if not exists tenant_payments (
  payment_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null references tenant_invoices(invoice_id) on delete cascade,
  provider text not null,
  provider_payment_id text,
  amount numeric(14,2) not null check (amount >= 0),
  currency_code char(3) not null default 'COP',
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'paid', 'failed', 'refunded')),
  paid_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_tenant_payments_tenant_status
  on tenant_payments(tenant_id, status, created_at desc);

create index if not exists ix_tenant_payments_invoice
  on tenant_payments(invoice_id, created_at desc);

create table if not exists tenant_payment_methods (
  tenant_payment_method_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  provider text not null,
  provider_token text not null,
  brand text,
  last4 text,
  expires_at timestamptz,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, provider_token)
);

create unique index if not exists ux_tenant_payment_methods_one_default
  on tenant_payment_methods(tenant_id)
  where is_default = true;

create index if not exists ix_tenant_payment_methods_tenant
  on tenant_payment_methods(tenant_id, provider, is_default);

do $$
declare
  v_tenant_pk_column text;
  v_tenant_pk_udt text;
  v_actor_table text;
  v_actor_pk_column text;
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
    raise exception 'No se encontro public.tenants.tenant_id ni public.tenants.id; ajusta la migracion al esquema real antes de continuar.';
  end if;

  select c.udt_name
  into v_tenant_pk_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'tenants'
    and c.column_name = v_tenant_pk_column;

  if v_tenant_pk_udt is distinct from 'uuid' then
    raise exception 'La columna public.tenants.% es de tipo %, pero billing espera UUID.', v_tenant_pk_column, coalesce(v_tenant_pk_udt, 'desconocido');
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenant_subscriptions'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (tenant_id) REFERENCES tenants(%'
  ) then
    execute format(
      'alter table tenant_subscriptions add constraint fk_tsub_tenant foreign key (tenant_id) references tenants(%I) on delete cascade',
      v_tenant_pk_column
    );
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'user_id'
  ) then
    v_actor_table := 'users';
    v_actor_pk_column := 'user_id';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'id'
  ) then
    v_actor_table := 'profiles';
    v_actor_pk_column := 'id';
  end if;

  if v_actor_table is not null and not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenant_subscription_events'
      and con.contype = 'f'
      and con.conname = 'fk_tsub_event_created_by_actor'
  ) then
    execute format(
      'alter table tenant_subscription_events add constraint fk_tsub_event_created_by_actor foreign key (created_by) references %I(%I) on delete set null',
      v_actor_table,
      v_actor_pk_column
    );
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenant_subscription_periods'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (tenant_id) REFERENCES tenants(%'
  ) then
    execute format(
      'alter table tenant_subscription_periods add constraint fk_tsub_period_tenant foreign key (tenant_id) references tenants(%I) on delete cascade',
      v_tenant_pk_column
    );
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenant_subscription_events'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (tenant_id) REFERENCES tenants(%'
  ) then
    execute format(
      'alter table tenant_subscription_events add constraint fk_tsub_event_tenant foreign key (tenant_id) references tenants(%I) on delete cascade',
      v_tenant_pk_column
    );
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenant_invoices'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (tenant_id) REFERENCES tenants(%'
  ) then
    execute format(
      'alter table tenant_invoices add constraint fk_tinv_tenant foreign key (tenant_id) references tenants(%I) on delete cascade',
      v_tenant_pk_column
    );
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenant_payments'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (tenant_id) REFERENCES tenants(%'
  ) then
    execute format(
      'alter table tenant_payments add constraint fk_tpay_tenant foreign key (tenant_id) references tenants(%I) on delete cascade',
      v_tenant_pk_column
    );
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenant_payment_methods'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (tenant_id) REFERENCES tenants(%'
  ) then
    execute format(
      'alter table tenant_payment_methods add constraint fk_tpm_tenant foreign key (tenant_id) references tenants(%I) on delete cascade',
      v_tenant_pk_column
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_tenant_subscription_periods_invoice'
      and conrelid = 'tenant_subscription_periods'::regclass
  ) then
    alter table tenant_subscription_periods
      add constraint fk_tenant_subscription_periods_invoice
      foreign key (invoice_id) references tenant_invoices(invoice_id) on delete set null;
  end if;
end
$$;

-- ============================================================
-- 4) Trigger generico para updated_at
-- ============================================================

create or replace function trg_touch_billing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_billing_plans on billing_plans;
create trigger trg_touch_billing_plans
before update on billing_plans
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_billing_plan_prices on billing_plan_prices;
create trigger trg_touch_billing_plan_prices
before update on billing_plan_prices
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_billing_plan_features on billing_plan_features;
create trigger trg_touch_billing_plan_features
before update on billing_plan_features
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_billing_plan_limits on billing_plan_limits;
create trigger trg_touch_billing_plan_limits
before update on billing_plan_limits
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_tenant_subscriptions on tenant_subscriptions;
create trigger trg_touch_tenant_subscriptions
before update on tenant_subscriptions
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_tenant_subscription_periods on tenant_subscription_periods;
create trigger trg_touch_tenant_subscription_periods
before update on tenant_subscription_periods
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_tenant_invoices on tenant_invoices;
create trigger trg_touch_tenant_invoices
before update on tenant_invoices
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_tenant_payments on tenant_payments;
create trigger trg_touch_tenant_payments
before update on tenant_payments
for each row
execute function trg_touch_billing_updated_at();

drop trigger if exists trg_touch_tenant_payment_methods on tenant_payment_methods;
create trigger trg_touch_tenant_payment_methods
before update on tenant_payment_methods
for each row
execute function trg_touch_billing_updated_at();

-- ============================================================
-- 5) Helpers de compatibilidad para tenant / permisos
-- ============================================================

create or replace function get_current_user_tenant_id()
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'auth_user_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'tenant_id'
  ) then
    execute 'select tenant_id from public.users where auth_user_id = auth.uid() limit 1'
      into v_tenant_id;
    if v_tenant_id is not null then
      return v_tenant_id;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'tenant_id'
  ) then
    execute 'select tenant_id from public.profiles where id = auth.uid() limit 1'
      into v_tenant_id;
    if v_tenant_id is not null then
      return v_tenant_id;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'auth_user_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'tenant_id'
  ) then
    execute 'select tenant_id from public.profiles where auth_user_id = auth.uid() limit 1'
      into v_tenant_id;
    if v_tenant_id is not null then
      return v_tenant_id;
    end if;
  end if;

  return null;
end;
$$;

create or replace function has_permission(permission_code text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_has_permission boolean := false;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'users'
  ) and exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_roles'
  ) and exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'role_permissions'
  ) and exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'permissions'
  ) then
    execute $sql$
      select exists (
        select 1
        from public.users u
        inner join public.user_roles ur on ur.user_id = u.user_id
        inner join public.role_permissions rp on rp.role_id = ur.role_id
        inner join public.permissions p on p.permission_id = rp.permission_id
        where u.auth_user_id = auth.uid()
          and p.code = $1
      )
    $sql$
    into v_has_permission
    using permission_code;
    return coalesce(v_has_permission, false);
  end if;

  return false;
end;
$$;

-- ============================================================
-- 6) RLS para tablas tenant-scoped
-- ============================================================

alter table billing_plans enable row level security;
alter table billing_plan_prices enable row level security;
alter table billing_plan_features enable row level security;
alter table billing_plan_limits enable row level security;
alter table tenant_subscriptions enable row level security;
alter table tenant_subscription_periods enable row level security;
alter table tenant_subscription_events enable row level security;
alter table tenant_invoices enable row level security;
alter table tenant_payments enable row level security;
alter table tenant_payment_methods enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plans'
      and policyname = 'billing_plans_select_policy'
  ) then
    create policy billing_plans_select_policy on billing_plans
      for select
      using (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plan_prices'
      and policyname = 'billing_plan_prices_select_policy'
  ) then
    create policy billing_plan_prices_select_policy on billing_plan_prices
      for select
      using (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plan_features'
      and policyname = 'billing_plan_features_select_policy'
  ) then
    create policy billing_plan_features_select_policy on billing_plan_features
      for select
      using (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_plan_limits'
      and policyname = 'billing_plan_limits_select_policy'
  ) then
    create policy billing_plan_limits_select_policy on billing_plan_limits
      for select
      using (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscriptions'
      and policyname = 'tenant_subscriptions_select_policy'
  ) then
    create policy tenant_subscriptions_select_policy on tenant_subscriptions
      for select
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscriptions'
      and policyname = 'tenant_subscriptions_insert_policy'
  ) then
    create policy tenant_subscriptions_insert_policy on tenant_subscriptions
      for insert
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscriptions'
      and policyname = 'tenant_subscriptions_update_policy'
  ) then
    create policy tenant_subscriptions_update_policy on tenant_subscriptions
      for update
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      )
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscriptions'
      and policyname = 'tenant_subscriptions_delete_policy'
  ) then
    create policy tenant_subscriptions_delete_policy on tenant_subscriptions
      for delete
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_periods'
      and policyname = 'tenant_subscription_periods_select_policy'
  ) then
    create policy tenant_subscription_periods_select_policy on tenant_subscription_periods
      for select
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_periods'
      and policyname = 'tenant_subscription_periods_insert_policy'
  ) then
    create policy tenant_subscription_periods_insert_policy on tenant_subscription_periods
      for insert
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_periods'
      and policyname = 'tenant_subscription_periods_update_policy'
  ) then
    create policy tenant_subscription_periods_update_policy on tenant_subscription_periods
      for update
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      )
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_periods'
      and policyname = 'tenant_subscription_periods_delete_policy'
  ) then
    create policy tenant_subscription_periods_delete_policy on tenant_subscription_periods
      for delete
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_events'
      and policyname = 'tenant_subscription_events_select_policy'
  ) then
    create policy tenant_subscription_events_select_policy on tenant_subscription_events
      for select
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_events'
      and policyname = 'tenant_subscription_events_insert_policy'
  ) then
    create policy tenant_subscription_events_insert_policy on tenant_subscription_events
      for insert
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_subscription_events'
      and policyname = 'tenant_subscription_events_delete_policy'
  ) then
    create policy tenant_subscription_events_delete_policy on tenant_subscription_events
      for delete
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_invoices'
      and policyname = 'tenant_invoices_select_policy'
  ) then
    create policy tenant_invoices_select_policy on tenant_invoices
      for select
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_invoices'
      and policyname = 'tenant_invoices_insert_policy'
  ) then
    create policy tenant_invoices_insert_policy on tenant_invoices
      for insert
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_invoices'
      and policyname = 'tenant_invoices_update_policy'
  ) then
    create policy tenant_invoices_update_policy on tenant_invoices
      for update
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      )
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_invoices'
      and policyname = 'tenant_invoices_delete_policy'
  ) then
    create policy tenant_invoices_delete_policy on tenant_invoices
      for delete
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payments'
      and policyname = 'tenant_payments_select_policy'
  ) then
    create policy tenant_payments_select_policy on tenant_payments
      for select
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payments'
      and policyname = 'tenant_payments_insert_policy'
  ) then
    create policy tenant_payments_insert_policy on tenant_payments
      for insert
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payments'
      and policyname = 'tenant_payments_update_policy'
  ) then
    create policy tenant_payments_update_policy on tenant_payments
      for update
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      )
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payments'
      and policyname = 'tenant_payments_delete_policy'
  ) then
    create policy tenant_payments_delete_policy on tenant_payments
      for delete
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payment_methods'
      and policyname = 'tenant_payment_methods_select_policy'
  ) then
    create policy tenant_payment_methods_select_policy on tenant_payment_methods
      for select
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payment_methods'
      and policyname = 'tenant_payment_methods_insert_policy'
  ) then
    create policy tenant_payment_methods_insert_policy on tenant_payment_methods
      for insert
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payment_methods'
      and policyname = 'tenant_payment_methods_update_policy'
  ) then
    create policy tenant_payment_methods_update_policy on tenant_payment_methods
      for update
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      )
      with check (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_payment_methods'
      and policyname = 'tenant_payment_methods_delete_policy'
  ) then
    create policy tenant_payment_methods_delete_policy on tenant_payment_methods
      for delete
      using (
        tenant_id = get_current_user_tenant_id()
        and has_permission('SETTINGS.TENANT.MANAGE')
      );
  end if;
end
$$;

revoke all on billing_plans, billing_plan_prices, billing_plan_features, billing_plan_limits from anon, public;
revoke all on tenant_subscriptions, tenant_subscription_periods, tenant_subscription_events from anon, public;
revoke all on tenant_invoices, tenant_payments, tenant_payment_methods from anon, public;

grant select on billing_plans, billing_plan_prices, billing_plan_features, billing_plan_limits to authenticated;
grant select, insert, update, delete on tenant_subscriptions, tenant_subscription_periods, tenant_subscription_events to authenticated;
grant select, insert, update, delete on tenant_invoices, tenant_payments, tenant_payment_methods to authenticated;

-- ============================================================
-- 6) Resumen operativo para mobile/admin
-- ============================================================

create or replace view tenant_billing_summary
with (security_invoker = true)
as
with ranked_subscriptions as (
  select
    ts.*,
    row_number() over (
      partition by ts.tenant_id
      order by
        case ts.status
          when 'active' then 1
          when 'trialing' then 2
          when 'past_due' then 3
          when 'grace_period' then 4
          when 'pending_activation' then 5
          when 'suspended' then 6
          when 'canceled' then 7
          when 'expired' then 8
          else 99
        end,
        coalesce(ts.current_period_end, ts.created_at) desc
    ) as rn
  from tenant_subscriptions ts
),
current_subscription as (
  select *
  from ranked_subscriptions
  where rn = 1
)
select
  cs.tenant_id,
  cs.subscription_id,
  cs.plan_id,
  bp.code as plan_code,
  bp.name as plan_name,
  cs.status,
  cs.renewal_mode,
  cs.current_period_start,
  cs.current_period_end,
  cs.trial_end_at,
  cs.grace_end_at,
  case
    when coalesce(cs.current_period_end, cs.trial_end_at, cs.grace_end_at) is null then null
    else (coalesce(cs.current_period_end, cs.trial_end_at, cs.grace_end_at)::date - current_date)
  end as days_to_expiry,
  case
    when cs.status in ('trialing', 'active', 'past_due', 'grace_period') then true
    else false
  end as can_operate_sales,
  case
    when cs.status in ('trialing', 'active', 'past_due') then true
    else false
  end as can_operate_admin,
  case
    when cs.status = 'trialing' and cs.trial_end_at is not null then
      'Tu periodo de prueba vence el ' || to_char(cs.trial_end_at, 'YYYY-MM-DD HH24:MI')
    when cs.status = 'past_due' and cs.current_period_end is not null then
      'Tu plan esta vencido desde ' || to_char(cs.current_period_end, 'YYYY-MM-DD')
    when cs.status = 'grace_period' and cs.grace_end_at is not null then
      'Estas en periodo de gracia hasta ' || to_char(cs.grace_end_at, 'YYYY-MM-DD')
    when cs.status = 'suspended' then
      'Tu tenant esta suspendido por estado comercial'
    else null
  end as banner_message,
  coalesce(features.feature_flags, '{}'::jsonb) as feature_flags,
  coalesce(limits.plan_limits, '{}'::jsonb) as plan_limits
from current_subscription cs
join billing_plans bp on bp.plan_id = cs.plan_id
left join lateral (
  select jsonb_object_agg(bpf.feature_code, bpf.is_enabled) as feature_flags
  from billing_plan_features bpf
  where bpf.plan_id = cs.plan_id
) features on true
left join lateral (
  select jsonb_object_agg(
    bpl.limit_code,
    jsonb_build_object(
      'value', bpl.limit_value,
      'unit', bpl.limit_unit
    )
  ) as plan_limits
  from billing_plan_limits bpl
  where bpl.plan_id = cs.plan_id
) limits on true;

create or replace function fn_get_my_tenant_billing_summary()
returns setof tenant_billing_summary
language sql
security definer
set search_path = public
as $$
  select *
  from tenant_billing_summary
  where tenant_id = get_current_user_tenant_id();
$$;

revoke all on tenant_billing_summary from anon, public;
revoke all on function fn_get_my_tenant_billing_summary() from public;
grant execute on function fn_get_my_tenant_billing_summary() to authenticated;

-- ============================================================
-- 7) Semillas iniciales de planes
-- ============================================================

insert into billing_plans (code, name, description, is_public, is_active, is_custom, sort_order)
values
  ('trial', 'Trial', 'Plan de prueba para onboarding inicial del tenant', true, true, false, 10),
  ('basic', 'Basic', 'Plan base para operacion comercial pequena', true, true, false, 20),
  ('pro', 'Pro', 'Plan con modulos avanzados y mayor capacidad operativa', true, true, false, 30),
  ('enterprise', 'Enterprise', 'Plan empresarial con limites altos y soporte prioritario', true, true, false, 40)
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
  plan_id, currency_code, billing_interval, amount, setup_fee, trial_days, grace_days, auto_renew_default, is_active
)
select plan_id, 'COP', 'monthly', 0, 0, 15, 3, false, true
from billing_plans
where code = 'trial'
on conflict (plan_id, currency_code, billing_interval) do update
set
  amount = excluded.amount,
  setup_fee = excluded.setup_fee,
  trial_days = excluded.trial_days,
  grace_days = excluded.grace_days,
  auto_renew_default = excluded.auto_renew_default,
  is_active = excluded.is_active,
  updated_at = now();

insert into billing_plan_prices (
  plan_id, currency_code, billing_interval, amount, setup_fee, trial_days, grace_days, auto_renew_default, is_active
)
select plan_id, 'COP', 'monthly', 49000, 0, 0, 5, false, true
from billing_plans
where code = 'basic'
on conflict (plan_id, currency_code, billing_interval) do update
set
  amount = excluded.amount,
  setup_fee = excluded.setup_fee,
  trial_days = excluded.trial_days,
  grace_days = excluded.grace_days,
  auto_renew_default = excluded.auto_renew_default,
  is_active = excluded.is_active,
  updated_at = now();

insert into billing_plan_prices (
  plan_id, currency_code, billing_interval, amount, setup_fee, trial_days, grace_days, auto_renew_default, is_active
)
select plan_id, 'COP', 'monthly', 99000, 0, 0, 5, false, true
from billing_plans
where code = 'pro'
on conflict (plan_id, currency_code, billing_interval) do update
set
  amount = excluded.amount,
  setup_fee = excluded.setup_fee,
  trial_days = excluded.trial_days,
  grace_days = excluded.grace_days,
  auto_renew_default = excluded.auto_renew_default,
  is_active = excluded.is_active,
  updated_at = now();

insert into billing_plan_prices (
  plan_id, currency_code, billing_interval, amount, setup_fee, trial_days, grace_days, auto_renew_default, is_active
)
select plan_id, 'COP', 'monthly', 199000, 0, 0, 7, false, true
from billing_plans
where code = 'enterprise'
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
select plan_id, feature_code, feature_name, is_enabled
from (
  values
    ('trial', 'POS_CORE', 'Punto de venta base', true),
    ('trial', 'OFFLINE_MODE', 'Operacion offline', true),
    ('trial', 'AI_ASSISTANT', 'Asistente IA', false),
    ('trial', 'OCR_IMPORT', 'Importacion por OCR', false),
    ('trial', 'ADVANCED_REPORTS', 'Reportes avanzados', false),
    ('basic', 'POS_CORE', 'Punto de venta base', true),
    ('basic', 'OFFLINE_MODE', 'Operacion offline', true),
    ('basic', 'AI_ASSISTANT', 'Asistente IA', false),
    ('basic', 'OCR_IMPORT', 'Importacion por OCR', false),
    ('basic', 'ADVANCED_REPORTS', 'Reportes avanzados', false),
    ('pro', 'POS_CORE', 'Punto de venta base', true),
    ('pro', 'OFFLINE_MODE', 'Operacion offline', true),
    ('pro', 'AI_ASSISTANT', 'Asistente IA', true),
    ('pro', 'OCR_IMPORT', 'Importacion por OCR', true),
    ('pro', 'ADVANCED_REPORTS', 'Reportes avanzados', true),
    ('enterprise', 'POS_CORE', 'Punto de venta base', true),
    ('enterprise', 'OFFLINE_MODE', 'Operacion offline', true),
    ('enterprise', 'AI_ASSISTANT', 'Asistente IA', true),
    ('enterprise', 'OCR_IMPORT', 'Importacion por OCR', true),
    ('enterprise', 'ADVANCED_REPORTS', 'Reportes avanzados', true)
) seed(plan_code, feature_code, feature_name, is_enabled)
join billing_plans bp on bp.code = seed.plan_code
on conflict (plan_id, feature_code) do update
set
  feature_name = excluded.feature_name,
  is_enabled = excluded.is_enabled,
  updated_at = now();

insert into billing_plan_limits (plan_id, limit_code, limit_name, limit_value, limit_unit)
select plan_id, limit_code, limit_name, limit_value, limit_unit
from (
  values
    ('trial', 'users_active', 'Usuarios activos', 2, 'count'),
    ('trial', 'locations_max', 'Sedes maximas', 1, 'count'),
    ('trial', 'cash_registers_max', 'Cajas maximas', 1, 'count'),
    ('trial', 'products_max', 'Productos maximos', 100, 'count'),
    ('trial', 'invoices_per_month', 'Facturas por mes', 100, 'count'),
    ('basic', 'users_active', 'Usuarios activos', 3, 'count'),
    ('basic', 'locations_max', 'Sedes maximas', 1, 'count'),
    ('basic', 'cash_registers_max', 'Cajas maximas', 2, 'count'),
    ('basic', 'products_max', 'Productos maximos', 2000, 'count'),
    ('basic', 'invoices_per_month', 'Facturas por mes', 1000, 'count'),
    ('pro', 'users_active', 'Usuarios activos', 10, 'count'),
    ('pro', 'locations_max', 'Sedes maximas', 3, 'count'),
    ('pro', 'cash_registers_max', 'Cajas maximas', 5, 'count'),
    ('pro', 'products_max', 'Productos maximos', 20000, 'count'),
    ('pro', 'invoices_per_month', 'Facturas por mes', 10000, 'count'),
    ('enterprise', 'users_active', 'Usuarios activos', 9999, 'count'),
    ('enterprise', 'locations_max', 'Sedes maximas', 9999, 'count'),
    ('enterprise', 'cash_registers_max', 'Cajas maximas', 9999, 'count'),
    ('enterprise', 'products_max', 'Productos maximos', 999999, 'count'),
    ('enterprise', 'invoices_per_month', 'Facturas por mes', 999999, 'count')
) seed(plan_code, limit_code, limit_name, limit_value, limit_unit)
join billing_plans bp on bp.code = seed.plan_code
on conflict (plan_id, limit_code) do update
set
  limit_name = excluded.limit_name,
  limit_value = excluded.limit_value,
  limit_unit = excluded.limit_unit,
  updated_at = now();

comment on table billing_plans is 'Catalogo de planes comerciales para monetizacion multi-tenant';
comment on table billing_plan_prices is 'Precios por periodicidad de cada plan';
comment on table tenant_subscriptions is 'Suscripciones comerciales historicas por tenant';
comment on table tenant_subscription_periods is 'Periodos facturables o renovables de una suscripcion';
comment on table tenant_invoices is 'Facturas comerciales del tenant por su suscripcion';
comment on table tenant_payments is 'Pagos asociados a las facturas comerciales del tenant';
comment on view tenant_billing_summary is 'Resumen operativo de plan, vigencia, flags y limites efectivos por tenant';
