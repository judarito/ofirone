-- =============================================================================
-- ADD_AI_TELEMETRY_COST_SUMMARY_FN.sql
-- Objetivo: agregación server-side de costo/tokens de ai_telemetry_events para
-- el dashboard de IA (evita depender del límite de eventos descargados en el
-- cliente). Respeta RLS: se ejecuta con privilegios del invocador.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_ai_telemetry_cost_summary(
  p_tenant_id UUID,
  p_window_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  total_cost NUMERIC,
  cost_last_7_days NUMERIC,
  cost_last_30_days NUMERIC,
  cloud_events BIGINT,
  total_events BIGINT,
  cost_by_day JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_until timestamptz := now();
  v_since timestamptz;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;
  v_since := now() - make_interval(days => GREATEST(1, COALESCE(p_window_days, 30)));

  RETURN QUERY
  WITH scope AS (
    SELECT occurred_at, estimated_cost, resolution_source
    FROM ai_telemetry_events
    WHERE tenant_id = p_tenant_id
      AND occurred_at >= v_since
  ),
  day_rows AS (
    SELECT to_char(occurred_at, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(estimated_cost), 0)::numeric(14,8) AS cost
    FROM scope
    GROUP BY 1
  ),
  agg AS (
    SELECT
      COALESCE(SUM(estimated_cost), 0)::numeric(14,8) AS total_cost,
      COALESCE(SUM(estimated_cost)
        FILTER (WHERE occurred_at >= v_until - interval '7 days'), 0)::numeric(14,8) AS cost_7d,
      COALESCE(SUM(estimated_cost)
        FILTER (WHERE occurred_at >= v_until - interval '30 days'), 0)::numeric(14,8) AS cost_30d,
      COUNT(*)::bigint AS total_events,
      COUNT(*) FILTER (WHERE resolution_source IN ('cloud_llm'))::bigint AS cloud_events
    FROM scope
  )
  SELECT
    agg.total_cost,
    agg.cost_7d,
    agg.cost_30d,
    agg.cloud_events,
    agg.total_events,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('date', d.day, 'cost', d.cost) ORDER BY d.day)
        FROM day_rows d),
      '[]'::jsonb
    )
  FROM agg;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_ai_telemetry_cost_summary(UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
