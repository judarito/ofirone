-- Contratos de reportes operativos — Ofirone PostgreSQL portable (0001–0012)
-- Consultas de referencia; no son handlers. Contexto por transacción:
--   set local app.tenant_id = :tenant_id;
-- Rol de runtime NOBYPASSRLS. Errores: 42501 sin contexto/tenant ajeno.

-- 1) Ventas por día (P0/P1)
-- Entrada: :desde, :hasta. Salida: día, tickets, total, pagos cash.
select date_trunc('day', s.sold_at)::date as dia,
       count(*) as tickets,
       coalesce(sum(s.total), 0) as total,
       coalesce(sum(case when pm.method_type = 'cash' then sp.amount else 0 end), 0) as cash
from public.sales s
left join public.sale_payments sp
  on sp.tenant_id = s.tenant_id and sp.sale_id = s.sale_id
left join public.payment_methods pm
  on pm.tenant_id = sp.tenant_id and pm.payment_method_id = sp.payment_method_id
where s.tenant_id = app_private.current_tenant_id()
  and s.sold_at >= :desde and s.sold_at < :hasta
group by 1
order by 1;

-- 2) Existencias por variante y sede (P0)
select m.location_id, m.variant_id, sum(m.quantity_delta) as on_hand
from public.inventory_moves m
where m.tenant_id = app_private.current_tenant_id()
group by m.location_id, m.variant_id
order by m.location_id, m.variant_id;

-- 3) Compras pendientes de recibir (P1)
select p.purchase_id, p.purchase_number, p.status,
       sum(l.quantity) as pedido,
       sum(l.quantity_received) as recibido,
       sum(l.quantity - l.quantity_received) as pendiente
from public.purchases p
join public.purchase_lines l
  on l.tenant_id = p.tenant_id and l.purchase_id = p.purchase_id
where p.tenant_id = app_private.current_tenant_id()
  and p.status in ('ordered', 'partially_received')
group by p.purchase_id, p.purchase_number, p.status
order by p.purchased_at, p.purchase_id;

-- 4) Aging de cuentas por pagar (P1)
-- Buckets 0–30, 31–60, >60 días sobre saldo abierto.
select case
         when current_date - sp.due_date <= 30 then '0-30'
         when current_date - sp.due_date <= 60 then '31-60'
         else '>60'
       end as bucket,
       count(*) as documentos,
       coalesce(sum(sp.original_amount - sp.paid_amount), 0) as saldo
from public.supplier_payables sp
where sp.tenant_id = app_private.current_tenant_id()
  and sp.status in ('open', 'partially_paid')
  and sp.due_date is not null
group by 1
order by 1;

-- 5) Cartera de clientes (P1)
select a.customer_id, a.credit_limit, a.current_balance,
       case when a.current_balance > a.credit_limit then 'over_limit' else 'ok' end as estado
from public.customer_credit_accounts a
where a.tenant_id = app_private.current_tenant_id()
order by a.current_balance desc, a.customer_id;

-- 6) Apartados por vencer (P1)
select c.layaway_id, c.contract_number, c.balance_due, c.expires_at,
       current_date - c.expires_at as dias_vencido
from public.layaway_contracts c
where c.tenant_id = app_private.current_tenant_id()
  and c.status = 'active'
  and c.balance_due > 0
order by c.expires_at nulls last, c.layaway_id;

-- 7) Jobs pendientes/atascados (P1)
select j.status, count(*) as jobs,
       count(*) filter (where j.available_at < clock_timestamp() - interval '5 minutes') as atrasados
from public.async_jobs j
where j.tenant_id = app_private.current_tenant_id()
group by j.status
order by j.status;

-- 8) Auditoría reciente (P1)
select a.created_at, a.action, a.resource_type, a.resource_id
from public.audit_log a
where a.tenant_id = app_private.current_tenant_id()
order by a.created_at desc, a.audit_id desc
limit :limit;
