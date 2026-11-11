-- =============================================================================
-- ADD_AI_TELEMETRY_CORRECTION_FIELDS.sql
-- Objetivo: registrar la corrección manual posterior de un resultado IA
-- (feedback loop, Fase 9 del plan) SIN almacenar prompts ni textos.
--
-- Se guarda solo metadata estructurada: cuándo se corrigió, quién lo hizo,
-- desde qué flujo (correction_source) y el payload estructurado corregido.
-- =============================================================================

ALTER TABLE ai_telemetry_events
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_source TEXT,
  ADD COLUMN IF NOT EXISTS corrected_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_telemetry_events_corrected
  ON ai_telemetry_events (tenant_id, corrected_at)
  WHERE corrected_at IS NOT NULL;

-- La política de UPDATE ya está cubierta por RLS del insert/select; si se
-- necesita actualizar desde el cliente, el usuario solo puede corregir
-- eventos de su propio tenant.
DROP POLICY IF EXISTS ai_telemetry_events_update_policy ON ai_telemetry_events;

CREATE POLICY ai_telemetry_events_update_policy
ON ai_telemetry_events FOR UPDATE
TO authenticated
USING (tenant_id = get_current_user_tenant_id())
WITH CHECK (tenant_id = get_current_user_tenant_id());

GRANT UPDATE (corrected_at, corrected_by_user_id, correction_source, corrected_payload)
  ON ai_telemetry_events TO authenticated;

NOTIFY pgrst, 'reload schema';
