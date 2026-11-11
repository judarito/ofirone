-- Contratos SQL de referencia — Ofirone PostgreSQL portable (0001–0012)
-- NO implementa handlers ni modifica backend-go. Especifica consultas, entradas,
-- salidas y errores esperados para que el agente principal las consuma.
--
-- Contexto de sesión (SET LOCAL dentro de la transacción):
--   set local app.tenant_id = :tenant_id;
--   set local app.identity_id = :identity_id;
-- El rol de runtime NO debe tener BYPASSRLS ni ser owner de las tablas.

-- ---------------------------------------------------------------------------
-- 1) Listado de productos (keyset, sin offset)
-- Entrada: :tenant_id (por contexto), :after_name, :after_id, :limit
-- Salida: product_id, code, name
-- Errores: 42501 si el contexto no coincide con el tenant.
-- ---------------------------------------------------------------------------
select p.product_id, p.code, p.name
from public.products p
where p.tenant_id = app_private.current_tenant_id()
  and (p.name, p.product_id) > (coalesce(:after_name, ''), coalesce(:after_id, '00000000-0000-0000-0000-000000000000'::uuid))
order by p.name, p.product_id
limit :limit;

-- ---------------------------------------------------------------------------
-- 2) Listado de ventas (keyset por sold_at + sale_id)
-- Entrada: :after_sold_at, :after_sale_id, :limit
-- Salida: sale_id, sale_number, sold_at, total
-- ---------------------------------------------------------------------------
select s.sale_id, s.sale_number, s.sold_at, s.total
from public.sales s
where s.tenant_id = app_private.current_tenant_id()
  and (s.sold_at, s.sale_id) > (
        coalesce(:after_sold_at, '1970-01-01 00:00:00+00'::timestamptz),
        coalesce(:after_sale_id, '00000000-0000-0000-0000-000000000000'::uuid))
order by s.sold_at, s.sale_id
limit :limit;

-- ---------------------------------------------------------------------------
-- 3) Inventario por variante (suma de movimientos; sustituye stock_balances)
-- Salida: variant_id, on_hand (suma de quantity_delta)
-- ---------------------------------------------------------------------------
select m.variant_id, sum(m.quantity_delta) as on_hand
from public.inventory_moves m
where m.tenant_id = app_private.current_tenant_id()
group by m.variant_id
order by m.variant_id;

-- ---------------------------------------------------------------------------
-- 4) Claim de job (contrato propuesto; no existe fn_claim_async_jobs todavía)
-- Entrada: :worker, :job_type
-- Salida: job_id, idempotency_key, attempts
-- Semántica: una sola fila por worker, lock SKIP LOCKED, lease en locked_at.
-- Errores: 0 filas si no hay trabajo; 42501 si el contexto no coincide.
-- ---------------------------------------------------------------------------
with candidate as (
    select j.job_id
    from public.async_jobs j
    where j.tenant_id = app_private.current_tenant_id()
      and j.job_type = :job_type
      and j.status = 'queued'
      and j.available_at <= clock_timestamp()
    order by j.priority, j.available_at
    for update skip locked
    limit 1
)
update public.async_jobs j
set status = 'running',
    locked_at = clock_timestamp(),
    locked_by = :worker,
    attempts = attempts + 1,
    updated_at = clock_timestamp()
from candidate c
where j.job_id = c.job_id
returning j.job_id, j.idempotency_key, j.attempts;

-- ---------------------------------------------------------------------------
-- 5) Completar job (contrato; valida lease y tenant)
-- Entrada: :job_id, :worker, :success, :error
-- Errores: 42501 si el job es de otro tenant o el lease no es del worker.
-- ---------------------------------------------------------------------------
update public.async_jobs
set status = case when :success then 'succeeded' else 'failed' end,
    last_error = :error,
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
where job_id = :job_id
  and tenant_id = app_private.current_tenant_id()
  and locked_by = :worker
returning job_id, status;

-- ---------------------------------------------------------------------------
-- 6) Auditoría (append-only)
-- Entrada: :action, :resource_type, :resource_id, :metadata
-- ---------------------------------------------------------------------------
insert into public.audit_log (tenant_id, actor_identity_id, action, resource_type, resource_id, metadata)
values (app_private.current_tenant_id(), app_private.current_identity_id(), :action, :resource_type, :resource_id, :metadata)
returning audit_id;

-- ---------------------------------------------------------------------------
-- 7) Cartera de cliente
-- Salida: customer_id, credit_limit, current_balance
-- ---------------------------------------------------------------------------
select a.customer_id, a.credit_limit, a.current_balance
from public.customer_credit_accounts a
where a.tenant_id = app_private.current_tenant_id()
order by a.customer_id;

-- ---------------------------------------------------------------------------
-- 8) Compras y cuentas por pagar (resumen)
-- ---------------------------------------------------------------------------
select p.purchase_id, p.purchase_number, p.total, coalesce(sp.paid_amount, 0) as paid
from public.purchases p
left join public.supplier_payables sp
  on sp.tenant_id = p.tenant_id and sp.purchase_id = p.purchase_id
where p.tenant_id = app_private.current_tenant_id()
order by p.purchased_at desc, p.purchase_id desc
limit :limit;
