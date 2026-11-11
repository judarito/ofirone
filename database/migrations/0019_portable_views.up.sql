-- 0019_portable_views.up.sql
-- Slice H (autorizado): N16 stock_balances y N17 vw_sales_summary como vistas security_invoker.
-- Sin BEGIN/COMMIT.
--   create view public.stock_balances
--   with (security_invoker = true, security_barrier = true) as ...
--
-- `security_barrier` evita que predicados del llamador se evalúen antes del
-- filtro de la vista; es opcional y puede medirse. `security_invoker` requiere
-- PostgreSQL 15+.
--
-- ALTERNATIVA CON MATVIEW (menos preferida): mantener la matview en
-- `app_private` (nunca en `public`), revocar todo privilegio directo y exponer
-- una vista o función con filtro explícito de tenant. Si se usa una vista
-- normal (security definer), el filtro es la única barrera; por eso debe ser
-- obligatorio y probarse con N16. No otorgar `SELECT` sobre la matview al rol
-- de runtime. Ver el bloque comentado al final de esta sección.
--
-- PRECONDICIÓN: `inventory_batches` con RLS FORCE y filas de A y B.
-- SQL DE PRUEBA: ver sección 8, bloque N16.
-- RESULTADO ESPERADO: PASS con la vista segura (solo A; 0 filas de B; 0 sin
--   contexto). BLOQ hoy (42P01) y FAIL/BLOQ si se expone una matview sin filtro.
-- SQLSTATE: sin error para la consulta filtrada (0 filas); 42501 si se deniega
--   el acceso directo a la matview; 42P01 si el objeto no existe.

create view public.stock_balances
with (security_invoker = true, security_barrier = true)
as
select
    b.tenant_id,
    b.location_id,
    b.variant_id,
    -- Se conservan los nombres legacy `on_hand`/`reserved`; las columnas base
    -- del baseline son `quantity_on_hand`/`quantity_reserved`.
    sum(b.quantity_on_hand) as on_hand,
    sum(b.quantity_reserved) as reserved,
    max(b.updated_at) as updated_at
from public.inventory_batches b
where b.is_active
  and b.tenant_id = app_private.current_tenant_id()
group by b.tenant_id, b.location_id, b.variant_id;

comment on view public.stock_balances is
    'PROPUESTA N16. Vista security_invoker sobre inventory_batches; no es matview. '
    'Expone on_hand/reserved (nombres legacy) desde quantity_on_hand/quantity_reserved. '
    'Filtra por app_private.current_tenant_id() y por la RLS del invocador. '
    'Nunca otorgar SELECT directo a una matview equivalente.';

create view public.vw_sales_summary
with (security_invoker = true)
as
select
    s.tenant_id,
    s.location_id,
    l.name as location_name,
    s.sale_id,
    s.sale_number,
    s.status,
    s.sold_at,
    s.created_by_identity_id,
    s.subtotal,
    s.discount_total,
    s.tax_total,
    s.total
from public.sales s
join public.locations l
  on l.tenant_id = s.tenant_id
 and l.location_id = s.location_id
where s.tenant_id = app_private.current_tenant_id();

comment on view public.vw_sales_summary is
    'PROPUESTA N17. Vista security_invoker. No incluye cliente porque '
    'sales.customer_id aún no existe en 0001–0012.';


-- =============================================================================
