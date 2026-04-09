CREATE OR REPLACE FUNCTION fn_reports_dashboard_summary(
  p_tenant_id UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id UUID;
  v_user_tenant_id UUID;
  v_now TIMESTAMPTZ := now();
  v_today_start TIMESTAMPTZ := date_trunc('day', v_now);
  v_today_end TIMESTAMPTZ := date_trunc('day', v_now) + interval '1 day' - interval '1 second';
  v_month_start TIMESTAMPTZ := date_trunc('month', v_now);
  v_prev_month_start TIMESTAMPTZ := date_trunc('month', v_now) - interval '1 month';
  v_prev_month_end TIMESTAMPTZ := date_trunc('month', v_now) - interval '1 second';
  v_year_start TIMESTAMPTZ := date_trunc('year', v_now);
  v_last30_start TIMESTAMPTZ := date_trunc('day', v_now) - interval '29 day';
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'tenant_id es requerido');
  END IF;

  v_auth_user_id := auth.uid();
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Usuario no autenticado');
  END IF;

  SELECT u.tenant_id
  INTO v_user_tenant_id
  FROM users u
  WHERE u.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_user_tenant_id IS DISTINCT FROM p_tenant_id THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No autorizado para este tenant');
  END IF;

  RETURN (
    WITH sales_base AS (
      SELECT
        s.sale_id,
        s.total,
        s.sold_at
      FROM sales s
      WHERE s.tenant_id = p_tenant_id
        AND s.status IN ('COMPLETED', 'PARTIAL_RETURN')
        AND (p_location_id IS NULL OR s.location_id = p_location_id)
    ),
    today_sales AS (
      SELECT
        COALESCE(SUM(total), 0) AS total,
        COUNT(*) AS count
      FROM sales_base
      WHERE sold_at >= v_today_start
        AND sold_at <= v_today_end
    ),
    month_sales AS (
      SELECT
        COALESCE(SUM(total), 0) AS total,
        COUNT(*) AS count
      FROM sales_base
      WHERE sold_at >= v_month_start
        AND sold_at <= v_now
    ),
    prev_month_sales AS (
      SELECT
        COALESCE(SUM(total), 0) AS total,
        COUNT(*) AS count
      FROM sales_base
      WHERE sold_at >= v_prev_month_start
        AND sold_at <= v_prev_month_end
    ),
    year_sales AS (
      SELECT
        COALESCE(SUM(total), 0) AS total,
        COUNT(*) AS count
      FROM sales_base
      WHERE sold_at >= v_year_start
        AND sold_at <= v_now
    ),
    daily_series AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'date', day_key,
          'total', total
        )
        ORDER BY day_key
      ) AS rows
      FROM (
        SELECT
          to_char(day_ref::date, 'YYYY-MM-DD') AS day_key,
          COALESCE(SUM(sb.total), 0) AS total
        FROM generate_series(v_last30_start::date, v_now::date, interval '1 day') AS day_ref
        LEFT JOIN sales_base sb
          ON sb.sold_at >= day_ref::timestamptz
         AND sb.sold_at < (day_ref::timestamptz + interval '1 day')
        GROUP BY day_ref
      ) series_rows
    ),
    top_products AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', product_name,
          'revenue', revenue,
          'qty', qty
        )
        ORDER BY revenue DESC
      ) AS rows
      FROM (
        SELECT
          COALESCE(p.name, 'Producto') ||
            CASE WHEN pv.variant_name IS NOT NULL AND pv.variant_name <> '' THEN ' (' || pv.variant_name || ')' ELSE '' END
            AS product_name,
          COALESCE(SUM(sl.line_total), 0) AS revenue,
          COALESCE(SUM(sl.quantity), 0) AS qty
        FROM sale_lines sl
        INNER JOIN sales s ON s.sale_id = sl.sale_id
        LEFT JOIN product_variants pv ON pv.variant_id = sl.variant_id
        LEFT JOIN products p ON p.product_id = pv.product_id
        WHERE s.tenant_id = p_tenant_id
          AND s.status IN ('COMPLETED', 'PARTIAL_RETURN')
          AND s.sold_at >= v_month_start
          AND s.sold_at <= v_now
          AND (p_location_id IS NULL OR s.location_id = p_location_id)
        GROUP BY product_name
        ORDER BY revenue DESC
        LIMIT 7
      ) product_rows
    ),
    payment_methods_summary AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'method', method_name,
          'total', total
        )
        ORDER BY total DESC
      ) AS rows
      FROM (
        SELECT
          COALESCE(pm.name, pm.code, 'Otro') AS method_name,
          COALESCE(SUM(sp.amount), 0) AS total
        FROM sale_payments sp
        INNER JOIN sales s ON s.sale_id = sp.sale_id
        LEFT JOIN payment_methods pm ON pm.payment_method_id = sp.payment_method_id
        WHERE s.tenant_id = p_tenant_id
          AND s.status IN ('COMPLETED', 'PARTIAL_RETURN')
          AND s.sold_at >= v_month_start
          AND s.sold_at <= v_now
          AND (p_location_id IS NULL OR s.location_id = p_location_id)
        GROUP BY method_name
        ORDER BY total DESC
      ) payment_rows
    )
    SELECT jsonb_build_object(
      'success', TRUE,
      'kpis', jsonb_build_object(
        'today', jsonb_build_object(
          'total', (SELECT total FROM today_sales),
          'count', (SELECT count FROM today_sales)
        ),
        'month', jsonb_build_object(
          'total', (SELECT total FROM month_sales),
          'count', (SELECT count FROM month_sales),
          'vs_prev',
          CASE
            WHEN (SELECT total FROM prev_month_sales) > 0
              THEN ROUND((((SELECT total FROM month_sales) - (SELECT total FROM prev_month_sales)) / (SELECT total FROM prev_month_sales)) * 100, 1)
            ELSE NULL
          END
        ),
        'prev_month', jsonb_build_object(
          'total', (SELECT total FROM prev_month_sales),
          'count', (SELECT count FROM prev_month_sales)
        ),
        'year', jsonb_build_object(
          'total', (SELECT total FROM year_sales),
          'count', (SELECT count FROM year_sales)
        )
      ),
      'daily_series', COALESCE((SELECT rows FROM daily_series), '[]'::jsonb),
      'top_products', COALESCE((SELECT rows FROM top_products), '[]'::jsonb),
      'payment_methods', COALESCE((SELECT rows FROM payment_methods_summary), '[]'::jsonb)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reports_dashboard_summary(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_reports_dashboard_summary(UUID, UUID) TO service_role;
