-- ===================================================================
-- Push Dispatcher Supabase Cron
-- Fecha: 2026-03-20
-- Objetivo:
--   1) Ejecutar push-dispatcher desde Supabase Cron
--   2) Evitar dependencia de GitHub Actions para la ejecucion programada
--   3) Reusar Vault + pg_net para invocar la Edge Function de forma segura
-- ===================================================================

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
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
  v_cron_schema TEXT;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    v_cron_schema := 'cron';
  ELSIF to_regclass('extensions.job') IS NOT NULL THEN
    v_cron_schema := 'extensions';
  END IF;

  IF v_cron_schema IS NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'skipped', TRUE,
      'message', 'pg_cron no disponible; se omite push dispatcher cron.'
    );
  END IF;

  IF to_regnamespace('net') IS NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'skipped', TRUE,
      'message', 'pg_net no disponible; se omite push dispatcher cron.'
    );
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'skipped', TRUE,
      'message', 'Vault no disponible; se omite push dispatcher cron.'
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
  'Invoca push-dispatcher usando Supabase Cron, pg_net y secretos almacenados en Vault.';

REVOKE ALL ON FUNCTION public.fn_push_dispatcher_cron(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_push_dispatcher_cron(INT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_push_dispatcher_cron(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_push_dispatcher_cron(INT) TO service_role;

DO $$
DECLARE
  v_job_id BIGINT;
  v_cron_schema TEXT;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    v_cron_schema := 'cron';
  ELSIF to_regclass('extensions.job') IS NOT NULL THEN
    v_cron_schema := 'extensions';
  END IF;

  IF v_cron_schema IS NULL THEN
    RAISE NOTICE 'pg_cron no disponible. Se omite programacion del job push dispatcher.';
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT jobid FROM %I.job WHERE jobname = %L LIMIT 1',
    v_cron_schema,
    'poslite_push_dispatcher_every_minute'
  )
  INTO v_job_id;

  IF v_job_id IS NOT NULL THEN
    EXECUTE format('SELECT %I.unschedule($1)', v_cron_schema) USING v_job_id;
  END IF;

  EXECUTE format('SELECT %I.schedule($1, $2, $3)', v_cron_schema)
  USING
    'poslite_push_dispatcher_every_minute',
    '* * * * *',
    'SELECT public.fn_push_dispatcher_cron(100);';

  RAISE NOTICE 'Job pg_cron creado/actualizado: poslite_push_dispatcher_every_minute (schema: %)', v_cron_schema;
END
$$;
