-- ============================================================
-- Billing SaaS: upgrade/downgrade, emails de vencimiento y pagos manuales
-- ============================================================

-- 1. UPGRADE/DOWNGRADE de plan
create or replace function fn_change_subscription_plan(
  p_subscription_id uuid,
  p_new_plan_price_id uuid,
  p_apply_from text default 'next_period'  -- 'immediate' o 'next_period'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription tenant_subscriptions%rowtype;
  v_new_price billing_plan_prices%rowtype;
  v_old_price billing_plan_prices%rowtype;
  v_new_plan billing_plans%rowtype;
  v_message text;
begin
  if p_subscription_id is null then
    return jsonb_build_object('success', false, 'message', 'subscription_id requerido.');
  end if;

  if p_new_plan_price_id is null then
    return jsonb_build_object('success', false, 'message', 'new_plan_price_id requerido.');
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

  if v_subscription.status in ('canceled', 'expired') then
    return jsonb_build_object('success', false, 'message', 'La suscripcion no esta activa para cambiar de plan.');
  end if;

  -- Validar nuevo precio
  select *
  into v_new_price
  from billing_plan_prices
  where plan_price_id = p_new_plan_price_id
    and is_active = true
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'message', 'El precio del plan destino no existe o no esta activo.');
  end if;

  -- Cargar plan destino
  select *
  into v_new_plan
  from billing_plans
  where plan_id = v_new_price.plan_id
  limit 1;

  -- Cargar precio anterior para auditoria
  if v_subscription.plan_price_id is not null then
    select *
    into v_old_price
    from billing_plan_prices
    where plan_price_id = v_subscription.plan_price_id
    limit 1;
  end if;

  -- Determinar si es upgrade o downgrade por precio
  v_message := case
    when coalesce(v_new_price.amount, 0) > coalesce(v_old_price.amount, 0)
      then 'Upgrade a plan superior'
    when coalesce(v_new_price.amount, 0) < coalesce(v_old_price.amount, 0)
      then 'Downgrade a plan inferior'
    else 'Cambio de plan (mismo precio)'
  end;

  -- Aplicar cambio
  if lower(coalesce(p_apply_from, 'next_period')) = 'immediate' and v_subscription.current_period_end > now() then
    -- Si es inmediato, el cambio se refleja ya y la vigencia se ajusta proporcionalmente
    update tenant_subscriptions
    set
      plan_id = v_new_price.plan_id,
      plan_price_id = p_new_plan_price_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'previous_plan_price_id', v_subscription.plan_price_id,
        'previous_plan_id', v_subscription.plan_id,
        'changed_at', now(),
        'change_type', 'immediate_swap'
      )
    where subscription_id = p_subscription_id;
  else
    -- next_period: guardar para aplicar al renovar
    update tenant_subscriptions
    set
      plan_id = v_new_price.plan_id,
      plan_price_id = p_new_plan_price_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'previous_plan_price_id', v_subscription.plan_price_id,
        'previous_plan_id', v_subscription.plan_id,
        'changed_at', now(),
        'change_type', 'next_period_swap'
      )
    where subscription_id = p_subscription_id;
  end if;

  -- Registrar evento
  insert into tenant_subscription_events (
    subscription_id,
    tenant_id,
    event_type,
    event_source,
    payload
  ) values (
    v_subscription.subscription_id,
    v_subscription.tenant_id,
    'plan_changed',
    'self_service',
    jsonb_build_object(
      'from_plan_price_id', v_subscription.plan_price_id,
      'to_plan_price_id', p_new_plan_price_id,
      'from_plan', v_old_price,
      'to_plan', v_new_price,
      'apply_from', p_apply_from,
      'message', v_message
    )
  );

  return jsonb_build_object(
    'success', true,
    'message', v_message || ' - Aplica desde: ' || coalesce(p_apply_from, 'next_period'),
    'subscription_id', v_subscription.subscription_id,
    'new_plan', v_new_plan,
    'new_price', v_new_price
  );
end;
$$;


-- 2. PAGOS MANUALES por SuperAdmin
create or replace function fn_superadmin_record_manual_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_currency_code text default 'COP',
  p_provider text default 'MANUAL',
  p_provider_reference text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice tenant_invoices%rowtype;
  v_payment tenant_payments%rowtype;
  v_subscription tenant_subscriptions%rowtype;
  v_period tenant_subscription_periods%rowtype;
begin
  if not (auth.role() = 'service_role' or fn_is_super_admin()) then
    raise exception 'No autorizado. Solo SuperAdmin puede registrar pagos manuales.';
  end if;

  if p_invoice_id is null then
    return jsonb_build_object('success', false, 'message', 'invoice_id requerido.');
  end if;

  select *
  into v_invoice
  from tenant_invoices
  where invoice_id = p_invoice_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Factura no encontrada.');
  end if;

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
    coalesce(p_provider, 'MANUAL'),
    case when p_provider_reference is not null and trim(p_provider_reference) <> ''
      then trim(p_provider_reference) else null end,
    coalesce(p_amount, v_invoice.total),
    coalesce(p_currency_code, v_invoice.currency_code, 'COP'),
    'paid',
    now(),
    jsonb_build_object(
      'registered_by', auth.uid(),
      'note', p_note,
      'registered_at', now()
    )
  )
  returning * into v_payment;

  update tenant_invoices
  set
    status = 'paid',
    paid_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'paid_by_provider', coalesce(p_provider, 'MANUAL'),
      'manual_payment', true
    )
  where invoice_id = v_invoice.invoice_id;

  -- Si es factura de renovacion, extender periodo
  select *
  into v_subscription
  from tenant_subscriptions
  where subscription_id = v_invoice.subscription_id
  for update;

  if found then
    select *
    into v_period
    from tenant_subscription_periods
    where subscription_period_id = v_invoice.subscription_period_id;

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
    where subscription_id = v_subscription.subscription_id;

    insert into tenant_subscription_events (
      subscription_id,
      tenant_id,
      event_type,
      event_source,
      payload
    ) values (
      v_subscription.subscription_id,
      v_subscription.tenant_id,
      'renewal_payment_manual',
      'superadmin',
      jsonb_build_object('invoice_id', v_invoice.invoice_id, 'payment_id', v_payment.payment_id, 'note', p_note)
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payment', to_jsonb(v_payment),
    'invoice_id', v_invoice.invoice_id
  );
end;
$$;


-- 3. HISTORIAL DE PAGOS para el tenant
create or replace function fn_get_tenant_payment_history(
  p_tenant_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_result jsonb;
begin
  v_tenant_id := coalesce(p_tenant_id, get_current_user_tenant_id());
  if v_tenant_id is null then
    return jsonb_build_object('success', false, 'message', 'tenant_id no disponible.');
  end if;

  if not (
    auth.role() = 'service_role'
    or fn_is_super_admin()
    or v_tenant_id = get_current_user_tenant_id()
  ) then
    raise exception 'No autorizado.';
  end if;

  select coalesce(jsonb_agg(
    row_to_json(t) order by t.created_at desc
  ), '[]'::jsonb)
  into v_result
  from (
    select
      p.payment_id,
      p.invoice_id,
      p.provider,
      p.provider_payment_id,
      p.amount,
      p.currency_code,
      p.status,
      p.paid_at,
      p.created_at,
      p.raw_response->>'note' as note,
      i.number as invoice_number,
      i.metadata->>'type' as invoice_type,
      i.subscription_id,
      ts.plan_id as subscription_plan_id
    from tenant_payments p
    join tenant_invoices i on i.invoice_id = p.invoice_id
    left join tenant_subscriptions ts on ts.subscription_id = i.subscription_id
    where p.tenant_id = v_tenant_id
    order by p.created_at desc
    limit greatest(least(coalesce(p_limit, 50), 200), 1)
  ) t;

  return jsonb_build_object('success', true, 'payments', v_result);
end;
$$;


-- 4. ENCOLAR EMAILS EN vencimientos
create or replace function fn_enqueue_subscription_status_emails(
  p_subscription_id uuid,
  p_tenant_id uuid,
  p_old_status text,
  p_new_status text,
  p_admin_email text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_plan_name text;
  v_tenant_name text;
  v_subject text;
  v_html text;
  v_dedupe text;
begin
  -- Obtener email y nombres
  if p_admin_email is not null and trim(p_admin_email) <> '' then
    v_email := fn_normalize_email(p_admin_email);
  end if;

  if v_email is null then
    select fn_normalize_email(t.alert_email)
    into v_email
    from tenant_settings t
    where t.tenant_id = p_tenant_id
    limit 1;
  end if;

  if v_email is null then return; end if;

  select coalesce(bp.name, bp.code, 'Sin plan')
  into v_plan_name
  from tenant_subscriptions ts
  left join billing_plans bp on bp.plan_id = ts.plan_id
  where ts.subscription_id = p_subscription_id
  limit 1;

  select name into v_tenant_name from tenants where tenant_id = p_tenant_id;

  -- Construir email segun estado
  case p_new_status
    when 'past_due' then
      v_subject := 'Tu suscripcion OfirOne esta vencida - ' || coalesce(v_tenant_name, 'tu empresa');
      v_html := '<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;"><div style="background:#fff3cd;padding:24px;border-radius:12px;">'
        || '<h2 style="color:#856404;">Tu periodo ha vencido</h2>'
        || '<p>El periodo de tu plan <strong>' || fn_escape_html(v_plan_name) || '</strong> ha vencido.</p>'
        || '<p>Para evitar la suspension de tu cuenta, renueva tu suscripcion desde el panel de administracion.</p>'
        || '</div></div>';
      v_dedupe := 'subscription-past-due-' || p_subscription_id;

    when 'grace_period' then
      v_subject := 'Periodo de gracia activado - OfirOne';
      v_html := '<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;"><div style="background:#fff3e0;padding:24px;border-radius:12px;">'
        || '<h2 style="color:#e65100;">Periodo de gracia</h2>'
        || '<p>Tienes unos dias adicionales antes de la suspension. Tu plan <strong>' || fn_escape_html(v_plan_name) || '</strong> esta en periodo de gracia.</p>'
        || '<p>Renueva ahora para evitar bloqueos en tu operacion.</p>'
        || '</div></div>';
      v_dedupe := 'subscription-grace-period-' || p_subscription_id;

    when 'suspended' then
      v_subject := 'Tu cuenta OfirOne ha sido suspendida - ' || coalesce(v_tenant_name, 'tu empresa');
      v_html := '<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;"><div style="background:#ffebee;padding:24px;border-radius:12px;">'
        || '<h2 style="color:#c62828;">Cuenta suspendida</h2>'
        || '<p>Tu suscripcion del plan <strong>' || fn_escape_html(v_plan_name) || '</strong> ha sido suspendida por falta de pago.</p>'
        || '<p>Contacta a soporte o renueva desde el panel de administracion para reactivar tu cuenta.</p>'
        || '</div></div>';
      v_dedupe := 'subscription-suspended-' || p_subscription_id;

    else
      return;
  end case;

  -- Encolar via el sistema central de emails
  perform fn_enqueue_email_notification(
    p_tenant_id := p_tenant_id,
    p_channel := 'email',
    p_event_type := 'subscription_status_change',
    p_recipient_email := v_email,
    p_recipient_name := v_tenant_name,
    p_subject := v_subject,
    p_html := v_html,
    p_text_body := replace(replace(replace(v_html, '<[^>]+>', '', 'g'), '  ', ' '), E'\n', ' '),
    p_dedupe_key := v_dedupe,
    p_entity_type := 'tenant_subscriptions',
    p_entity_id := p_subscription_id
  );
end;
$$;

-- Modificar fn_process_tenant_subscription_expirations para que encargue emails
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

      -- Encolar email de notificacion del cambio de estado
      begin
        perform fn_enqueue_subscription_status_emails(
          v_row.subscription_id,
          v_row.tenant_id,
          v_row.status,
          v_next_status
        );
      exception when others then
        -- No queremos que falle el worker si falla un email
        null;
      end;

      v_processed := v_processed + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'processed', v_processed);
end;
$$;


-- Permisos
grant execute on function fn_change_subscription_plan(uuid, uuid, text) to authenticated, service_role;
grant execute on function fn_superadmin_record_manual_payment(uuid, numeric, text, text, text, text) to authenticated;
grant execute on function fn_get_tenant_payment_history(uuid, integer) to authenticated, service_role;
grant execute on function fn_enqueue_subscription_status_emails(uuid, uuid, text, text, text) to service_role;
grant execute on function fn_process_tenant_subscription_expirations(integer) to authenticated, service_role;

comment on function fn_change_subscription_plan is
  'Cambia el plan/precio de una suscripcion activa. apply_from: immediate o next_period.';
comment on function fn_superadmin_record_manual_payment is
  'Registra un pago manual (transferencia, efectivo) y marca la factura como pagada. Solo SuperAdmin.';
comment on function fn_get_tenant_payment_history is
  'Devuelve el historial de pagos del tenant autenticado.';
comment on function fn_enqueue_subscription_status_emails is
  'Encola correos de notificacion cuando una suscripcion cambia a past_due, grace_period o suspended.';


-- ============================================================
-- 5. RECORDATORIOS PRE-VENCIMIENTO
-- ============================================================
create or replace function fn_enqueue_pre_expiry_reminders(
  p_limit integer default 250
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_processed integer := 0;
  v_email text;
  v_plan_name text;
  v_tenant_name text;
  v_days_left integer;
  v_subject text;
  v_html text;
  v_dedupe text;
begin
  -- Recorrer suscripciones activas/trial cuyo vencimiento esta en los proximos 7 dias
  for v_row in
    select ts.*, bpp.grace_days
    from tenant_subscriptions ts
    left join billing_plan_prices bpp on bpp.plan_price_id = ts.plan_price_id
    where ts.status in ('trialing', 'active')
      and coalesce(ts.current_period_end, ts.trial_end_at) is not null
      and coalesce(ts.current_period_end, ts.trial_end_at) > now()
      and coalesce(ts.current_period_end, ts.trial_end_at) <= now() + interval '7 days'
    limit least(greatest(coalesce(p_limit, 250), 1), 500)
  loop
    -- Calcular dias restantes
    v_days_left := extract(day from coalesce(v_row.current_period_end, v_row.trial_end_at) - now())::integer;

    -- Obtener email y nombres
    select fn_normalize_email(t.alert_email)
    into v_email
    from tenant_settings t
    where t.tenant_id = v_row.tenant_id
    limit 1;

    if v_email is null then continue; end if;

    select coalesce(bp.name, bp.code, 'Sin plan')
    into v_plan_name
    from billing_plans bp
    where bp.plan_id = v_row.plan_id
    limit 1;

    select name into v_tenant_name from tenants where tenant_id = v_row.tenant_id;

    -- Construir email segun dias restantes
    if v_days_left <= 1 then
      v_subject := 'Tu suscripcion OfirOne vence manana - ' || coalesce(v_tenant_name, 'tu empresa');
      v_html := '<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;"><div style="background:#fff3cd;padding:24px;border-radius:12px;">'
        || '<h2 style="color:#856404;">Tu suscripcion vence manana</h2>'
        || '<p>El plan <strong>' || fn_escape_html(v_plan_name) || '</strong> vence en 1 dia.</p>'
        || '<p>Renueva ahora para evitar interrupcion en tu operacion.</p>'
        || '</div></div>';
      v_dedupe := 'subscription-expiring-1d-' || v_row.subscription_id;
    elsif v_days_left <= 3 then
      v_subject := 'Tu suscripcion OfirOne vence en ' || v_days_left || ' dias - ' || coalesce(v_tenant_name, 'tu empresa');
      v_html := '<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;"><div style="background:#fff3e0;padding:24px;border-radius:12px;">'
        || '<h2 style="color:#e65100;">Tu suscripcion vence en ' || v_days_left || ' dias</h2>'
        || '<p>El plan <strong>' || fn_escape_html(v_plan_name) || '</strong> esta por vencer.</p>'
        || '<p>Renueva desde el panel de administracion para seguir operando sin interrupcion.</p>'
        || '</div></div>';
      v_dedupe := 'subscription-expiring-3d-' || v_row.subscription_id;
    else
      v_subject := 'Recordatorio: tu suscripcion OfirOne vence en ' || v_days_left || ' dias';
      v_html := '<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;"><div style="background:#e8f5e9;padding:24px;border-radius:12px;">'
        || '<h2 style="color:#2e7d32;">Tu suscripcion vence en ' || v_days_left || ' dias</h2>'
        || '<p>Tu plan <strong>' || fn_escape_html(v_plan_name) || '</strong> se renueva pronto.</p>'
        || '<p>Preparate para renovar desde el panel de administracion.</p>'
        || '</div></div>';
      v_dedupe := 'subscription-expiring-7d-' || v_row.subscription_id;
    end if;

    begin
      perform fn_enqueue_email_notification(
        p_tenant_id := v_row.tenant_id,
        p_channel := 'email',
        p_event_type := 'subscription_expiring_soon',
        p_recipient_email := v_email,
        p_recipient_name := v_tenant_name,
        p_subject := v_subject,
        p_html := v_html,
        p_text_body := replace(replace(replace(v_html, '<[^>]+>', '', 'g'), '  ', ' '), E'\n', ' '),
        p_dedupe_key := v_dedupe,
        p_entity_type := 'tenant_subscriptions',
        p_entity_id := v_row.subscription_id
      );
      v_processed := v_processed + 1;
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('success', true, 'processed', v_processed);
end;
$$;


-- ============================================================
-- 6. UPGRADE INMEDIATO CON COBRO PRORRATEADO
-- ============================================================
create or replace function fn_change_subscription_plan_prorated(
  p_subscription_id uuid,
  p_new_plan_price_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription tenant_subscriptions%rowtype;
  v_new_price billing_plan_prices%rowtype;
  v_old_price billing_plan_prices%rowtype;
  v_new_plan billing_plans%rowtype;
  v_days_remaining integer;
  v_days_in_period integer;
  v_prorated_amount numeric;
  v_invoice tenant_invoices%rowtype;
  v_period tenant_subscription_periods%rowtype;
begin
  -- Validaciones basicas (usando fn_change_subscription_plan para chequear permisos)
  if p_subscription_id is null or p_new_plan_price_id is null then
    return jsonb_build_object('success', false, 'message', 'subscription_id y new_plan_price_id requeridos.');
  end if;

  select *
  into v_subscription
  from tenant_subscriptions
  where subscription_id = p_subscription_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Suscripcion no encontrada.');
  end if;

  if not (auth.role() = 'service_role' or fn_is_super_admin() or v_subscription.tenant_id = get_current_user_tenant_id()) then
    raise exception 'No autorizado.';
  end if;

  select *
  into v_new_price
  from billing_plan_prices
  where plan_price_id = p_new_plan_price_id and is_active = true
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'message', 'El precio del plan destino no existe o no esta activo.');
  end if;

  select *
  into v_new_plan
  from billing_plans
  where plan_id = v_new_price.plan_id
  limit 1;

  -- Calcular prorrateo
  v_days_remaining := greatest(extract(day from (v_subscription.current_period_end - now()))::integer, 0);
  v_days_in_period := case
    when v_new_price.billing_interval = 'annual' then 365
    when v_new_price.billing_interval = 'semiannual' then 180
    when v_new_price.billing_interval = 'quarterly' then 90
    else 30
  end;

  v_prorated_amount := round((v_new_price.amount * v_days_remaining::numeric / greatest(v_days_in_period, 1))::numeric, 2);

  -- Generar factura prorrateada
  insert into tenant_invoices (
    tenant_id, subscription_id, number, currency_code,
    subtotal, tax_amount, total, due_at, status, issued_at, metadata
  ) values (
    v_subscription.tenant_id, v_subscription.subscription_id,
    'UPG-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_new_price.currency_code,
    v_prorated_amount, 0, v_prorated_amount,
    now() + interval '7 days', 'issued', now(),
    jsonb_build_object(
      'type', 'plan_upgrade_prorated',
      'from_plan_price_id', v_subscription.plan_price_id,
      'to_plan_price_id', p_new_plan_price_id,
      'days_remaining', v_days_remaining,
      'days_in_period', v_days_in_period,
      'prorated_amount', v_prorated_amount
    )
  )
  returning * into v_invoice;

  -- Actualizar suscripcion
  select *
  into v_old_price
  from billing_plan_prices
  where plan_price_id = v_subscription.plan_price_id
  limit 1;

  update tenant_subscriptions
  set
    plan_id = v_new_price.plan_id,
    plan_price_id = p_new_plan_price_id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'previous_plan_price_id', v_subscription.plan_price_id,
      'previous_plan_id', v_subscription.plan_id,
      'changed_at', now(),
      'change_type', 'immediate_prorated',
      'prorated_invoice_id', v_invoice.invoice_id
    )
  where subscription_id = p_subscription_id;

  -- Evento de auditoria
  insert into tenant_subscription_events (
    subscription_id, tenant_id, event_type, event_source, payload
  ) values (
    v_subscription.subscription_id, v_subscription.tenant_id,
    'plan_changed_prorated', 'self_service',
    jsonb_build_object(
      'from_plan_price_id', v_subscription.plan_price_id,
      'to_plan_price_id', p_new_plan_price_id,
      'prorated_amount', v_prorated_amount,
      'invoice_id', v_invoice.invoice_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'message', 'Upgrade inmediato con cobro prorrateado de ' || v_prorated_amount || ' ' || v_new_price.currency_code,
    'subscription_id', v_subscription.subscription_id,
    'prorated_amount', v_prorated_amount,
    'invoice', to_jsonb(v_invoice),
    'new_plan', v_new_plan
  );
end;
$$;


-- ============================================================
-- 7. LISTADO DE PAGOS PARA SUPERADMIN
-- ============================================================
create or replace function fn_superadmin_list_all_payments(
  p_limit integer default 100,
  p_status text default null,
  p_tenant_search text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not (auth.role() = 'service_role' or fn_is_super_admin()) then
    raise exception 'No autorizado. Solo SuperAdmin.';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      p.payment_id,
      p.invoice_id,
      p.provider,
      p.provider_payment_id,
      p.amount,
      p.currency_code::text as currency_code,
      p.status,
      p.paid_at,
      p.created_at,
      p.raw_response->>'note' as note,
      i.number as invoice_number,
      i.metadata->>'type' as invoice_type,
      i.subscription_id,
      t.tenant_id,
      t.name as tenant_name,
      coalesce(bp.name, bp.code) as plan_name
    from tenant_payments p
    join tenant_invoices i on i.invoice_id = p.invoice_id
    join tenants t on t.tenant_id = p.tenant_id
    left join tenant_subscriptions ts on ts.subscription_id = i.subscription_id
    left join billing_plans bp on bp.plan_id = ts.plan_id
    where (p_status is null or p.status = p_status)
      and (p_tenant_search is null
        or lower(t.name) like '%' || lower(p_tenant_search) || '%'
        or lower(i.number) like '%' || lower(p_tenant_search) || '%')
    order by p.created_at desc
    limit greatest(least(coalesce(p_limit, 100), 500), 1)
  ) t;

  return jsonb_build_object('success', true, 'payments', v_result);
end;
$$;


-- ============================================================
-- PERMISOS ADICIONALES
-- ============================================================
grant execute on function fn_enqueue_pre_expiry_reminders(integer) to service_role;
grant execute on function fn_change_subscription_plan_prorated(uuid, uuid) to authenticated, service_role;
grant execute on function fn_superadmin_list_all_payments(integer, text, text) to authenticated;

comment on function fn_enqueue_pre_expiry_reminders is
  'Encola recordatorios pre-vencimiento (7, 3 y 1 dia antes) para suscripciones activas/trial.';
comment on function fn_change_subscription_plan_prorated is
  'Upgrade inmediato con calculo prorrateado: genera factura por el proporcional de dias restantes.';
comment on function fn_superadmin_list_all_payments is
  'Lista todos los pagos de todos los tenants con filtros. Solo SuperAdmin.';
