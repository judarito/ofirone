-- Idempotency key for retry-safe sale creation.
-- Transaction wrapper is owned by the migration runner.
ALTER TABLE public.sales ADD COLUMN idempotency_key text;
ALTER TABLE public.sales ADD CONSTRAINT sales_idempotency_key_valid CHECK (
    idempotency_key IS NULL OR (idempotency_key = btrim(idempotency_key) AND length(idempotency_key) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX sales_tenant_idempotency_idx ON public.sales (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
