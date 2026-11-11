-- ============================================================
-- AI telemetry local OCR source
-- ============================================================
-- Allows native OCR image attempts to be measured separately from
-- deterministic parsers and local LLMs.

ALTER TABLE ai_telemetry_events
  DROP CONSTRAINT IF EXISTS ai_telemetry_events_resolution_source_check;

ALTER TABLE ai_telemetry_events
  ADD CONSTRAINT ai_telemetry_events_resolution_source_check CHECK (
    resolution_source IN (
      'local_cache',
      'deterministic_parser',
      'local_llm',
      'local_ocr',
      'cloud_llm',
      'manual_resolution',
      'unknown'
    )
  );

NOTIFY pgrst, 'reload schema';
