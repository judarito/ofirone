-- ============================================================================
-- PROPUESTA — NO EJECUTAR COMO MIGRACIÓN REAL
-- Track: PostgreSQL portable / backend-go. No está en database/migrations/.
-- Requiere revisión y aprobación; no contiene credenciales ni datos reales.
-- Base: 0001–0012 (PostgreSQL >= 15). El runner aplica el archivo up en una
-- transacción; el down va en 0014_sales_customer_link.down.sql.
-- Ver ADR-007: docs/decisions/ADR-007-venta-cliente.md
-- ============================================================================

-- ----------------------------------------------------------------------------
-- UP — 0014_sales_customer_link.up.sql
-- ----------------------------------------------------------------------------

-- Columna nullable: NULL = venta anónima/de mostrador. Sin DEFAULT ni backfill.
ALTER TABLE public.sales
    ADD COLUMN customer_id uuid;

-- FK compuesta: el par (tenant_id, customer_id) debe existir en customers.
-- MATCH SIMPLE (default): si customer_id es NULL, la FK no se evalúa.
-- ON DELETE RESTRICT protege la historia; la baja de cliente es lógica.
ALTER TABLE public.sales
    ADD CONSTRAINT sales_customer_fk
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES public.customers (tenant_id, customer_id)
    ON DELETE RESTRICT
    NOT VALID;

-- La columna es nueva y todas las filas son NULL: la validación es barata.
ALTER TABLE public.sales
    VALIDATE CONSTRAINT sales_customer_fk;

-- Historial por cliente con keyset estable. Parcial: no indexa ventas anónimas.
CREATE INDEX sales_customer_page_idx
    ON public.sales (tenant_id, customer_id, sold_at DESC, sale_id DESC)
    WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.sales.customer_id IS
    'Cliente de la venta; NULL = venta anónima. FK compuesta por tenant.';

-- La RLS existente de sales no cambia: sigue siendo tenant_isolation con FORCE
-- (0007_sales.up.sql:86-98). La FK compuesta es la defensa cross-tenant.

-- ----------------------------------------------------------------------------
-- DOWN — 0014_sales_customer_link.down.sql
-- Destructivo para la atribución ya escrita. Exportar antes:
--   SELECT tenant_id, sale_id, customer_id, sold_at FROM public.sales
--   WHERE customer_id IS NOT NULL;
-- ----------------------------------------------------------------------------
/*
DROP INDEX IF EXISTS public.sales_customer_page_idx;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_customer_fk;
ALTER TABLE public.sales DROP COLUMN IF EXISTS customer_id;
*/

-- ----------------------------------------------------------------------------
-- Backfill (NO forma parte de la migración; ejecutar solo en importación con
-- staging y datos sintéticos/legacy controlados, nunca en PROD por este script).
-- ----------------------------------------------------------------------------
-- 1) Cargar en una tabla temporal el mapeo legacy:
--      (tenant_id, sale_id, legacy_customer_id)
--    donde legacy_customer_id es el UUID histórico de sales.customer_id
--    (tras FIX_CUSTOMER_FK_TO_THIRD_PARTIES apunta a third_parties).
-- 2) Resolver contra customers.third_party_id del mismo tenant.
-- 3) Dejar NULL lo no resuelto y reportar conteos por tenant.
--
-- UPDATE public.sales s
-- SET customer_id = c.customer_id
-- FROM legacy_sale_customer_map m
-- JOIN public.customers c
--   ON c.tenant_id = m.tenant_id
--  AND c.third_party_id = m.legacy_customer_id
-- WHERE s.tenant_id = m.tenant_id
--   AND s.sale_id = m.sale_id
--   AND s.customer_id IS NULL;
--
-- Verificación: 0 huérfanos.
-- SELECT count(*) AS orphan_links
-- FROM public.sales s
-- LEFT JOIN public.customers c
--   ON c.tenant_id = s.tenant_id AND c.customer_id = s.customer_id
-- WHERE s.customer_id IS NOT NULL AND c.customer_id IS NULL;
