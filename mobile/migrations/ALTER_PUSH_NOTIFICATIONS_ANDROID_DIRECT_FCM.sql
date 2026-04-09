-- ============================================================
-- Upgrade push notifications: Android directo a FCM, iOS/fallback por Expo
-- Compatible con esquemas creados desde ADD_PUSH_NOTIFICATIONS_EXPO.sql
-- ============================================================

ALTER TABLE user_push_devices
  ADD COLUMN IF NOT EXISTS push_provider text;

ALTER TABLE user_push_devices
  ADD COLUMN IF NOT EXISTS push_token text;

ALTER TABLE notification_push_queue
  ADD COLUMN IF NOT EXISTS push_provider text;

ALTER TABLE notification_push_queue
  ADD COLUMN IF NOT EXISTS push_token text;

UPDATE user_push_devices
SET
  push_provider = COALESCE(push_provider, 'expo'),
  push_token = COALESCE(push_token, expo_push_token)
WHERE push_provider IS NULL
   OR push_token IS NULL;

UPDATE notification_push_queue
SET
  push_provider = COALESCE(push_provider, 'expo'),
  push_token = COALESCE(push_token, expo_push_token)
WHERE push_provider IS NULL
   OR push_token IS NULL;

ALTER TABLE user_push_devices
  ALTER COLUMN expo_push_token DROP NOT NULL;

ALTER TABLE notification_push_queue
  ALTER COLUMN expo_push_token DROP NOT NULL;

UPDATE user_push_devices
SET push_provider = 'unknown'
WHERE push_provider NOT IN ('expo','fcm','apns','web','unknown');

UPDATE notification_push_queue
SET push_provider = 'unknown'
WHERE push_provider NOT IN ('expo','fcm','apns','web','unknown');

ALTER TABLE user_push_devices
  ALTER COLUMN push_provider SET DEFAULT 'expo';

ALTER TABLE notification_push_queue
  ALTER COLUMN push_provider SET DEFAULT 'expo';

ALTER TABLE user_push_devices
  ALTER COLUMN push_provider SET NOT NULL;

ALTER TABLE user_push_devices
  ALTER COLUMN push_token SET NOT NULL;

ALTER TABLE notification_push_queue
  ALTER COLUMN push_provider SET NOT NULL;

ALTER TABLE notification_push_queue
  ALTER COLUMN push_token SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_user_push_devices_provider'
  ) THEN
    ALTER TABLE user_push_devices
      ADD CONSTRAINT chk_user_push_devices_provider
      CHECK (push_provider IN ('expo','fcm','apns','web','unknown'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notification_push_queue_provider'
  ) THEN
    ALTER TABLE notification_push_queue
      ADD CONSTRAINT chk_notification_push_queue_provider
      CHECK (push_provider IN ('expo','fcm','apns','web','unknown'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ix_user_push_devices_provider_token
  ON user_push_devices(push_provider, push_token);

CREATE UNIQUE INDEX IF NOT EXISTS ix_user_push_devices_tenant_provider_token_uk
  ON user_push_devices(tenant_id, push_provider, push_token);

CREATE INDEX IF NOT EXISTS ix_notification_push_queue_provider_token
  ON notification_push_queue(push_provider, push_token);

CREATE UNIQUE INDEX IF NOT EXISTS ix_notification_push_queue_notification_provider_token_uk
  ON notification_push_queue(notification_id, push_provider, push_token);

CREATE OR REPLACE FUNCTION fn_upsert_my_push_device(
  p_push_token text,
  p_push_provider text DEFAULT 'expo',
  p_platform text DEFAULT 'unknown',
  p_device_name text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_uid text DEFAULT NULL,
  p_expo_push_token text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_platform text;
  v_provider text;
  v_push_token text;
  v_expo_push_token text;
  v_id uuid;
BEGIN
  v_tenant := get_current_user_tenant_id();
  v_user := get_current_user_app_user_id();

  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado o sin tenant';
  END IF;

  v_push_token := trim(COALESCE(p_push_token, ''));
  IF v_push_token = '' THEN
    RAISE EXCEPTION 'p_push_token es requerido';
  END IF;

  v_platform := lower(COALESCE(NULLIF(trim(p_platform), ''), 'unknown'));
  IF v_platform NOT IN ('ios','android','web','unknown') THEN
    v_platform := 'unknown';
  END IF;

  v_provider := lower(COALESCE(NULLIF(trim(p_push_provider), ''), 'expo'));
  IF v_provider NOT IN ('expo','fcm','apns','web','unknown') THEN
    v_provider := 'unknown';
  END IF;

  v_expo_push_token := NULLIF(trim(COALESCE(p_expo_push_token, '')), '');
  IF v_provider = 'expo' AND v_expo_push_token IS NULL THEN
    v_expo_push_token := v_push_token;
  END IF;

  INSERT INTO user_push_devices (
    tenant_id,
    user_id,
    push_provider,
    push_token,
    expo_push_token,
    platform,
    device_name,
    app_version,
    device_uid,
    is_active,
    last_seen_at
  ) VALUES (
    v_tenant,
    v_user,
    v_provider,
    v_push_token,
    v_expo_push_token,
    v_platform,
    NULLIF(trim(COALESCE(p_device_name, '')), ''),
    NULLIF(trim(COALESCE(p_app_version, '')), ''),
    NULLIF(trim(COALESCE(p_device_uid, '')), ''),
    true,
    now()
  )
  ON CONFLICT (tenant_id, push_provider, push_token)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    expo_push_token = EXCLUDED.expo_push_token,
    platform = EXCLUDED.platform,
    device_name = EXCLUDED.device_name,
    app_version = EXCLUDED.app_version,
    device_uid = EXCLUDED.device_uid,
    is_active = true,
    last_seen_at = now(),
    updated_at = now()
  RETURNING push_device_id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_upsert_my_push_device(
  p_expo_push_token text,
  p_platform text DEFAULT 'unknown',
  p_device_name text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_uid text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN fn_upsert_my_push_device(
    p_push_token => p_expo_push_token,
    p_push_provider => 'expo',
    p_platform => p_platform,
    p_device_name => p_device_name,
    p_app_version => p_app_version,
    p_device_uid => p_device_uid,
    p_expo_push_token => p_expo_push_token
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_deactivate_my_push_device(
  p_push_token text,
  p_push_provider text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_count integer;
  v_provider text;
BEGIN
  v_tenant := get_current_user_tenant_id();
  v_user := get_current_user_app_user_id();
  v_provider := lower(COALESCE(NULLIF(trim(p_push_provider), ''), ''));

  UPDATE user_push_devices upd
  SET is_active = false,
      updated_at = now()
  WHERE upd.tenant_id = v_tenant
    AND upd.user_id = v_user
    AND upd.push_token = p_push_token
    AND (
      v_provider = ''
      OR upd.push_provider = v_provider
    )
    AND upd.is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION fn_deactivate_my_push_device(p_expo_push_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN fn_deactivate_my_push_device(p_push_token => p_expo_push_token, p_push_provider => 'expo');
END;
$$;

CREATE OR REPLACE FUNCTION fn_enqueue_push_for_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notification_push_queue (
    notification_id,
    tenant_id,
    user_id,
    push_device_id,
    push_provider,
    push_token,
    expo_push_token,
    title,
    message,
    payload,
    status,
    attempts,
    next_attempt_at,
    created_at
  )
  SELECT
    NEW.notification_id,
    NEW.tenant_id,
    NEW.user_id,
    upd.push_device_id,
    upd.push_provider,
    upd.push_token,
    upd.expo_push_token,
    NEW.title,
    NEW.message,
    COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'notification_id', NEW.notification_id,
      'event_type', NEW.event_type,
      'severity', NEW.severity,
      'action_url', NEW.action_url
    ),
    'PENDING',
    0,
    now(),
    now()
  FROM user_push_devices upd
  LEFT JOIN LATERAL (
    SELECT up.push_enabled
    FROM user_notification_prefs up
    WHERE up.tenant_id = NEW.tenant_id
      AND up.user_id = NEW.user_id
      AND up.event_type IN (NEW.event_type, '*')
    ORDER BY CASE WHEN up.event_type = NEW.event_type THEN 0 ELSE 1 END
    LIMIT 1
  ) pref ON TRUE
  WHERE upd.tenant_id = NEW.tenant_id
    AND upd.user_id = NEW.user_id
    AND upd.is_active = true
    AND (
      (upd.push_provider = 'expo' AND (
        upd.push_token LIKE 'ExponentPushToken%'
        OR upd.push_token LIKE 'ExpoPushToken%'
      ))
      OR (upd.push_provider = 'fcm' AND upd.platform = 'android' AND COALESCE(upd.push_token, '') <> '')
    )
    AND COALESCE(pref.push_enabled, true) = true
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_upsert_my_push_device(text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_upsert_my_push_device(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_deactivate_my_push_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_deactivate_my_push_device(text) TO authenticated;
