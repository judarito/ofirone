-- ===================================================================
-- Supabase Cron Pipelines
-- Fecha: 2026-03-17
-- Objetivo:
--   1) Reemplazar cron jobs de GitHub Actions por Supabase Cron
--   2) Procesar cola contable dentro de Postgres sin depender de HTTP
--   3) Disparar push dispatcher externo via pg_cron + pg_net + Vault
-- ===================================================================

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo habilitar pg_cron: %', SQLERRM;
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo habilitar pg_net: %', SQLERRM;
  END;
END
$$;

CREATE OR REPLACE FUNCTION public.fn_accounting_process_queue_all_tenants(
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_tenant RECORD;
  v_result JSONB;
  v_results JSONB := '[]'::jsonb;

  v_targeted INT := 0;
  v_processed_tenants INT := 0;
  v_failed_tenants INT := 0;

  v_taken INT := 0;
  v_processed INT := 0;
  v_failed INT := 0;
  v_skipped INT := 0;
BEGIN
  -- Emular contexto service_role para reusar la RPC existente.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  FOR v_tenant IN
    SELECT ts.tenant_id
    FROM tenant_settings ts
    WHERE ts.accounting_enabled = TRUE
      AND UPPER(COALESCE(ts.accounting_mode, '')) LIKE 'ASYNC%'
    ORDER BY ts.tenant_id
  LOOP
    v_targeted := v_targeted + 1;

    BEGIN
      SELECT public.fn_accounting_process_queue(v_tenant.tenant_id, v_limit, NULL)
      INTO v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_failed_tenants := v_failed_tenants + 1;
        v_results := v_results || jsonb_build_array(
          jsonb_build_object(
            'tenant_id', v_tenant.tenant_id,
            'success', FALSE,
            'message', SQLERRM
          )
        );
        CONTINUE;
    END;

    IF COALESCE((v_result ->> 'success')::BOOLEAN, FALSE) THEN
      v_processed_tenants := v_processed_tenants + 1;
      v_taken := v_taken + COALESCE((v_result ->> 'taken')::INT, 0);
      v_processed := v_processed + COALESCE((v_result ->> 'processed')::INT, 0);
      v_failed := v_failed + COALESCE((v_result ->> 'failed')::INT, 0);
      v_skipped := v_skipped + COALESCE((v_result ->> 'skipped')::INT, 0);
    ELSE
      v_failed_tenants := v_failed_tenants + 1;
    END IF;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'tenant_id', v_tenant.tenant_id,
        'success', COALESCE((v_result ->> 'success')::BOOLEAN, FALSE),
        'payload', COALESCE(v_result, '{}'::jsonb)
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', v_failed_tenants = 0,
    'tenants_targeted', v_targeted,
    'tenants_processed', v_processed_tenants,
    'tenants_failed', v_failed_tenants,
    'totals', jsonb_build_object(
      'taken', v_taken,
      'processed', v_processed,
      'failed', v_failed,
      'skipped', v_skipped
    ),
    'results', v_results,
    'ran_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.fn_accounting_process_queue_all_tenants(INT) IS
  'Procesa la cola contable para todos los tenants ASYNC habilitados. Diseñada para Supabase Cron.';

REVOKE ALL ON FUNCTION public.fn_accounting_process_queue_all_tenants(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_accounting_process_queue_all_tenants(INT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_accounting_process_queue_all_tenants(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_accounting_process_queue_all_tenants(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_push_dispatcher_cron(
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_url TEXT;
  v_secret TEXT;
  v_request_id BIGINT;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'skipped', TRUE,
      'message', 'Vault no disponible; se omite push dispatcher cron.'
    );
  END IF;

  IF to_regnamespace('net') IS NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'skipped', TRUE,
      'message', 'pg_net no disponible; se omite push dispatcher cron.'
    );
  END IF;

  EXECUTE $sql$
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'PUSH_DISPATCHER_URL'
    ORDER BY created_at DESC
    LIMIT 1
  $sql$
  INTO v_url;

  EXECUTE $sql$
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'PUSH_DISPATCHER_SECRET'
    ORDER BY created_at DESC
    LIMIT 1
  $sql$
  INTO v_secret;

  IF COALESCE(v_url, '') = '' OR COALESCE(v_secret, '') = '' THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'skipped', TRUE,
      'message', 'Faltan secretos Vault PUSH_DISPATCHER_URL o PUSH_DISPATCHER_SECRET.'
    );
  END IF;

  EXECUTE $sql$
    SELECT net.http_post(
      url := $1,
      headers := $2,
      body := $3
    )
  $sql$
  INTO v_request_id
  USING
    v_url,
    jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    jsonb_build_object('limit', v_limit);

  RETURN jsonb_build_object(
    'success', TRUE,
    'request_id', v_request_id,
    'queued_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.fn_push_dispatcher_cron(INT) IS
  'Invoca el push dispatcher externo usando pg_net y secretos almacenados en Vault.';

REVOKE ALL ON FUNCTION public.fn_push_dispatcher_cron(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_push_dispatcher_cron(INT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_push_dispatcher_cron(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_push_dispatcher_cron(INT) TO service_role;

DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron no disponible. Se omite programacion de jobs.';
    RETURN;
  END IF;

  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'poslite_process_accounting_queue_every_minute'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'poslite_process_accounting_queue_every_minute',
    '* * * * *',
    'SELECT public.fn_accounting_process_queue_all_tenants(100);'
  );

  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'poslite_push_dispatcher_every_minute'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'poslite_push_dispatcher_every_minute',
    '* * * * *',
    'SELECT public.fn_push_dispatcher_cron(100);'
  );

  RAISE NOTICE 'Jobs pg_cron creados/actualizados: poslite_process_accounting_queue_every_minute, poslite_push_dispatcher_every_minute';
END
$$;
