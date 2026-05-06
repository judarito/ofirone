-- ============================================================
-- Billing SaaS: renovaciones manuales y expiracion de suscripciones
-- ============================================================

create extension if not exists pgcrypto;

create or replace function fn_billing_period_end(
  p_period_start timestamptz,
  p_billing_interval text
) returns timestamptz
language sql
stable
as $$
  select case lower(coalesce(p_billing_interval, 'monthly'))
    when 'annual' then p_period_start + interval '1 year'
    when 'semiannual' then p_period_start + interval '6 months'
    when 'quarterly' then p_period_start + interval '3 months'
    else p_period_start + interval '1 month'
  end;
$$;

create or replace function fn_create_tenant_subscription_renewal_invoice(
  p_subscription_id uuid,
  p_due_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription tenant_subscriptions%rowtype;
  v_price billing_plan_prices%rowtype;
  v_existing tenant_invoices%rowtype;
  v_period tenant_subscription_periods%rowtype;
  v_invoice tenant_invoices%rowtype;
  v_period_number integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if p_subscription_id is null then
    return jsonb_build_object('success', false, 'message', 'subscription_id requerido.');
  end if;

  select *
  into v_subscription
  from tenant_subscriptions
  where subscription_id = p_subscription_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Suscripcion no encontrada.');
  end if;

  if not (
    auth.role() = 'service_role'
    or fn_is_super_admin()
    or v_subscription.tenant_id = get_current_user_tenant_id()
  ) then
    raise exception 'No autorizado.';
  end if;

  if v_subscription.status in ('canceled', 'expired', 'suspended') then
    return jsonb_build_object('success', false, 'message', 'La suscripcion no esta habilitada para renovar.');
  end if;

  select *
  into v_price
  from billing_plan_prices
  where plan_price_id = v_subscription.plan_price_id
    and is_active = true
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'message', 'La suscripcion no tiene un precio activo asociado.');
  end if;

  select *
  into v_existing
  from tenant_invoices
  where subscription_id = p_subscription_id
    and status in ('draft', 'issued', 'overdue')
    and metadata ->> 'type' = 'subscription_renewal'
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'already_exists', true,
      'invoice', to_jsonb(v_existing)
    );
  end if;

  select coalesce(max(period_number), 0) + 1
  into v_period_number
  from tenant_subscription_periods
  where subscription_id = p_subscription_id;

  v_period_start := greatest(coalesce(v_subscription.current_period_end, now()), now());
  v_period_end := fn_billing_period_end(v_period_start, v_price.billing_interval);

  insert into tenant_subscription_periods (
    subscription_id,
    tenant_id,
    period_number,
    period_start,
    period_end,
    status
  ) values (
    v_subscription.subscription_id,
    v_subscription.tenant_id,
    v_period_number,
    v_period_start,
    v_period_end,
    'invoiced'
  )
  returning * into v_period;

  insert into tenant_invoices (
    tenant_id,
    subscription_id,
    subscription_period_id,
    number,
    currency_code,
    subtotal,
    tax_amount,
    total,
    due_at,
    status,
    issued_at,
    metadata
  ) values (
    v_subscription.tenant_id,
    v_subscription.subscription_id,
    v_period.subscription_period_id,
    'REN-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_price.currency_code,
    v_price.amount,
    0,
    v_price.amount,
    coalesce(p_due_at, now() + interval '7 days'),
    'issued',
    now(),
    jsonb_build_object(
      'type', 'subscription_renewal',
      'billing_interval', v_price.billing_interval,
      'plan_price_id', v_price.plan_price_id,
      'period_start', v_period_start,
      'period_end', v_period_end
    )
  )
  returning * into v_invoice;

  update tenant_subscription_periods
  set invoice_id = v_invoice.invoice_id
  where subscription_period_id = v_period.subscription_period_id;

  insert into tenant_subscription_events (
    subscription_id,
    tenant_id,
    event_type,
    event_source,
    payload
  ) values (
    v_subscription.subscription_id,
    v_subscription.tenant_id,
    'renewal_invoice_created',
    'system',
    jsonb_build_object('invoice_id', v_invoice.invoice_id, 'period_id', v_period.subscription_period_id)
  );

  return jsonb_build_object(
    'success', true,
    'invoice', to_jsonb(v_invoice),
    'period', to_jsonb(v_period),
    'subscription', to_jsonb(v_subscription)
  );
end;
$$;

create or replace function fn_mark_tenant_subscription_renewal_paid(
  p_invoice_id uuid,
  p_provider_payment_id text,
  p_provider_status text,
  p_payment_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice tenant_invoices%rowtype;
  v_period tenant_subscription_periods%rowtype;
  v_payment tenant_payments%rowtype;
  v_status text := lower(trim(coalesce(p_provider_status, 'pending')));
  v_payment_status text;
begin
  if p_invoice_id is null then
    return jsonb_build_object('success', false, 'message', 'invoice_id requerido.');
  end if;

  select *
  into v_invoice
  from tenant_invoices
  where invoice_id = p_invoice_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Factura de renovacion no encontrada.');
  end if;

  v_payment_status := case
    when v_status = 'approved' then 'paid'
    when v_status in ('rejected', 'cancelled', 'refunded', 'charged_back') then 'failed'
    else 'pending'
  end;

  select *
  into v_payment
  from tenant_payments
  where invoice_id = p_invoice_id
    and provider = 'MERCADO_PAGO'
    and provider_payment_id = nullif(trim(coalesce(p_provider_payment_id, '')), '')
  limit 1;

  if found then
    update tenant_payments
    set
      status = v_payment_status,
      paid_at = case when v_payment_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
      raw_response = coalesce(raw_response, '{}'::jsonb) || coalesce(p_payment_payload, '{}'::jsonb)
    where payment_id = v_payment.payment_id
    returning * into v_payment;
  else
    insert into tenant_payments (
      tenant_id,
      invoice_id,
      provider,
      provider_payment_id,
      amount,
      currency_code,
      status,
      paid_at,
      raw_response
    ) values (
      v_invoice.tenant_id,
      v_invoice.invoice_id,
      'MERCADO_PAGO',
      nullif(trim(coalesce(p_provider_payment_id, '')), ''),
      v_invoice.total,
      v_invoice.currency_code,
      v_payment_status,
      case when v_payment_status = 'paid' then now() else null end,
      coalesce(p_payment_payload, '{}'::jsonb)
    )
    returning * into v_payment;
  end if;

  if v_payment_status <> 'paid' then
    return jsonb_build_object('success', true, 'paid', false, 'invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment));
  end if;

  select *
  into v_period
  from tenant_subscription_periods
  where subscription_period_id = v_invoice.subscription_period_id
  for update;

  update tenant_invoices
  set
    status = 'paid',
    paid_at = coalesce(paid_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('paid_by_provider', 'MERCADO_PAGO')
  where invoice_id = v_invoice.invoice_id
  returning * into v_invoice;

  if found then
    update tenant_subscription_periods
    set status = 'paid'
    where subscription_period_id = v_period.subscription_period_id;
  end if;

  update tenant_subscriptions
  set
    status = 'active',
    current_period_start = coalesce(v_period.period_start, current_period_start, now()),
    current_period_end = coalesce(v_period.period_end, current_period_end),
    grace_end_at = null,
    suspended_at = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_renewal_invoice_id', v_invoice.invoice_id)
  where subscription_id = v_invoice.subscription_id;

  insert into tenant_subscription_events (
    subscription_id,
    tenant_id,
    event_type,
    event_source,
    payload
  ) values (
    v_invoice.subscription_id,
    v_invoice.tenant_id,
    'renewal_payment_approved',
    'payment_webhook',
    jsonb_build_object('invoice_id', v_invoice.invoice_id, 'payment_id', v_payment.payment_id, 'provider_payment_id', p_provider_payment_id)
  );

  return jsonb_build_object('success', true, 'paid', true, 'invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment));
end;
$$;

create or replace function fn_process_tenant_subscription_expirations(
  p_limit integer default 250
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_processed integer := 0;
  v_grace integer;
  v_next_status text;
  v_grace_end timestamptz;
begin
  if not (auth.role() = 'service_role' or fn_is_super_admin()) then
    raise exception 'No autorizado.';
  end if;

  for v_row in
    select ts.*, bpp.grace_days
    from tenant_subscriptions ts
    left join billing_plan_prices bpp on bpp.plan_price_id = ts.plan_price_id
    where ts.status in ('trialing', 'active', 'past_due', 'grace_period')
      and coalesce(ts.current_period_end, ts.trial_end_at, ts.grace_end_at) is not null
      and coalesce(ts.current_period_end, ts.trial_end_at, ts.grace_end_at) < now()
    order by coalesce(ts.current_period_end, ts.trial_end_at, ts.grace_end_at)
    limit least(greatest(coalesce(p_limit, 250), 1), 1000)
  loop
    v_grace := coalesce(v_row.grace_days, 0);
    v_grace_end := coalesce(v_row.current_period_end, v_row.trial_end_at) + make_interval(days => v_grace);

    v_next_status := case
      when v_row.status = 'grace_period' and coalesce(v_row.grace_end_at, v_grace_end) < now() then 'suspended'
      when v_row.status in ('trialing', 'active') and v_grace > 0 and v_grace_end >= now() then 'grace_period'
      when v_row.status in ('trialing', 'active') then 'past_due'
      when v_row.status = 'past_due' and v_grace > 0 and v_grace_end < now() then 'suspended'
      else v_row.status
    end;

    if v_next_status is distinct from v_row.status then
      update tenant_subscriptions
      set
        status = v_next_status,
        grace_end_at = case when v_next_status = 'grace_period' then v_grace_end else grace_end_at end,
        suspended_at = case when v_next_status = 'suspended' then coalesce(suspended_at, now()) else suspended_at end
      where subscription_id = v_row.subscription_id;

      insert into tenant_subscription_events (
        subscription_id,
        tenant_id,
        event_type,
        event_source,
        payload
      ) values (
        v_row.subscription_id,
        v_row.tenant_id,
        'subscription_status_auto_updated',
        'system',
        jsonb_build_object('from_status', v_row.status, 'to_status', v_next_status)
      );

      v_processed := v_processed + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'processed', v_processed);
end;
$$;

grant execute on function fn_create_tenant_subscription_renewal_invoice(uuid, timestamptz) to authenticated, service_role;
grant execute on function fn_mark_tenant_subscription_renewal_paid(uuid, text, text, jsonb) to service_role;
grant execute on function fn_process_tenant_subscription_expirations(integer) to authenticated, service_role;

comment on function fn_create_tenant_subscription_renewal_invoice is
  'Crea o reutiliza una factura emitida para renovar manualmente una suscripcion.';
comment on function fn_mark_tenant_subscription_renewal_paid is
  'Marca una factura de renovacion como pagada desde webhook de Mercado Pago y extiende el periodo.';
comment on function fn_process_tenant_subscription_expirations is
  'Worker SQL para mover suscripciones vencidas a past_due, grace_period o suspended.';
