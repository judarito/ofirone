-- ============================================================
-- AI telemetry events
-- ============================================================
-- Stores operational metrics for AI usage. Do not store prompts,
-- images, extracted documents, or full model responses here.

CREATE TABLE IF NOT EXISTS ai_telemetry_events (
  ai_telemetry_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  device_id TEXT,
  feature TEXT NOT NULL,
  input_type TEXT NOT NULL DEFAULT 'text',
  engine TEXT,
  model TEXT,
  resolution_source TEXT NOT NULL DEFAULT 'unknown',
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  confidence NUMERIC(5,4),
  tokens_input INTEGER NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
  tokens_output INTEGER NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),
  estimated_cost NUMERIC(14,8) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  fallback TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ai_telemetry_events_event_tenant_unique UNIQUE (tenant_id, event_id),
  CONSTRAINT ai_telemetry_events_resolution_source_check CHECK (
    resolution_source IN (
      'local_cache',
      'deterministic_parser',
      'local_llm',
      'cloud_llm',
      'manual_resolution',
      'unknown'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_telemetry_events_tenant_time
  ON ai_telemetry_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_telemetry_events_feature_time
  ON ai_telemetry_events (tenant_id, feature, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_telemetry_events_source_time
  ON ai_telemetry_events (tenant_id, resolution_source, occurred_at DESC);

ALTER TABLE ai_telemetry_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_telemetry_events_select_policy ON ai_telemetry_events;
DROP POLICY IF EXISTS ai_telemetry_events_insert_policy ON ai_telemetry_events;

CREATE POLICY ai_telemetry_events_select_policy
ON ai_telemetry_events FOR SELECT
TO authenticated
USING (
  fn_is_super_admin()
  OR tenant_id = get_current_user_tenant_id()
);

CREATE POLICY ai_telemetry_events_insert_policy
ON ai_telemetry_events FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
);

GRANT SELECT, INSERT ON ai_telemetry_events TO authenticated;

NOTIFY pgrst, 'reload schema';
