-- Password credentials for provider-independent authentication.
-- The hash is generated and verified by Go using Argon2id; PostgreSQL never
-- receives a plaintext password.
CREATE TABLE public.identity_credentials (
    identity_id uuid PRIMARY KEY REFERENCES public.identities (identity_id) ON DELETE CASCADE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_credentials_hash_valid CHECK (
        length(password_hash) BETWEEN 60 AND 500
        AND password_hash = btrim(password_hash)
    )
);
CREATE TRIGGER identity_credentials_updated_at BEFORE UPDATE ON public.identity_credentials
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
ALTER TABLE public.identity_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_credentials_owner ON public.identity_credentials FOR SELECT
USING (identity_id = app_private.current_identity_id());
REVOKE ALL ON public.identity_credentials FROM PUBLIC;
