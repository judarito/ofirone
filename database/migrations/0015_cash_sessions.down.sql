-- 0015_cash_sessions.down.sql
-- Rollback destructivo de caja; exportar sesiones/movimientos/arqueos antes.
-- Ejecutar 0015 down antes de 0014 down (ADR-007). Sin BEGIN/COMMIT.

DROP TRIGGER IF EXISTS sale_payment_cash_session_guard ON public.sale_payments;
DROP TRIGGER IF EXISTS sales_cash_session_guard ON public.sales;
DROP TRIGGER IF EXISTS cash_session_counts_open_session ON public.cash_session_counts;
DROP TRIGGER IF EXISTS cash_movements_open_session ON public.cash_movements;
DROP TRIGGER IF EXISTS cash_sessions_guard ON public.cash_sessions;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cash_session_fk;
DROP INDEX IF EXISTS public.sales_cash_session_idx;
ALTER TABLE public.sales DROP COLUMN IF EXISTS cash_session_id;

DROP TRIGGER IF EXISTS cash_movements_append_only ON public.cash_movements;
DROP FUNCTION IF EXISTS app_private.cash_movements_append_only();

DROP TABLE IF EXISTS public.cash_session_counts;
DROP TABLE IF EXISTS public.cash_movements;
DROP TABLE IF EXISTS public.cash_sessions;

DROP FUNCTION IF EXISTS app_private.sale_payment_cash_session_guard();
DROP FUNCTION IF EXISTS app_private.sales_cash_session_guard();
DROP FUNCTION IF EXISTS app_private.cash_requires_open_session();
DROP FUNCTION IF EXISTS app_private.cash_sessions_guard();
DROP FUNCTION IF EXISTS app_private.cash_session_expected_cash(uuid, uuid);
