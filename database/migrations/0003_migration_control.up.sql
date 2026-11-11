-- PostgreSQL >= 15. Global migration ledger, managed by the migration runner.
-- Intentionally empty: existing migrations must be reconciled explicitly.
BEGIN;

CREATE TABLE public.schema_migrations (
    version bigint NOT NULL,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    dirty boolean NOT NULL DEFAULT true,
    CONSTRAINT schema_migrations_pkey PRIMARY KEY (version),
    CONSTRAINT schema_migrations_version_positive CHECK (version > 0),
    CONSTRAINT schema_migrations_name_valid CHECK (
        length(name) BETWEEN 1 AND 200
        AND name = btrim(name)
        AND name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT schema_migrations_checksum_sha256 CHECK (
        length(checksum) = 64 AND checksum COLLATE "C" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT schema_migrations_applied_at_finite CHECK (isfinite(applied_at))
);

-- The primary key already indexes version and rejects duplicate versions.
CREATE INDEX schema_migrations_applied_at_idx
    ON public.schema_migrations (applied_at DESC, version DESC);
CREATE INDEX schema_migrations_dirty_idx
    ON public.schema_migrations (version) WHERE dirty;

-- Infrastructure metadata is global, not tenant-scoped. Only the trusted
-- migration role should receive access; runtime API roles do not need it.
REVOKE ALL ON public.schema_migrations FROM PUBLIC;

COMMIT;
