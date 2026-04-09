CREATE TABLE IF NOT EXISTS public.ops_ai_query_cache (
  cache_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  auth_user_id UUID NOT NULL,
  query_hash TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  filters JSONB NOT NULL DEFAULT '{}'::JSONB,
  response_payload JSONB NOT NULL,
  model TEXT NULL,
  use_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_ai_query_cache_tenant_hash
  ON public.ops_ai_query_cache (tenant_id, query_hash);

CREATE INDEX IF NOT EXISTS idx_ops_ai_query_cache_expires_at
  ON public.ops_ai_query_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_ops_ai_query_cache_last_used_at
  ON public.ops_ai_query_cache (last_used_at DESC);

ALTER TABLE public.ops_ai_query_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ops_ai_query_cache IS
  'Cache de respuestas del agente operativo RAG para web/mobile. Se usa principalmente desde Edge Functions con service role.';

COMMENT ON COLUMN public.ops_ai_query_cache.response_payload IS
  'Payload final retornado por el agente, listo para reusar en mobile/web.';
