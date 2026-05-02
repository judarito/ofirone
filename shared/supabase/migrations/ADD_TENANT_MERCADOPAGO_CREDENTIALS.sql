/* ============================================================================
   ADD_TENANT_MERCADOPAGO_CREDENTIALS.sql
   Guarda credenciales privadas de Mercado Pago por tenant.
   ============================================================================
*/

CREATE TABLE IF NOT EXISTS tenant_gateway_credentials (
  gateway_credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'MERCADO_PAGO',
  environment TEXT NOT NULL DEFAULT 'sandbox',
  public_key TEXT NULL,
  access_token TEXT NULL,
  account_email TEXT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by_auth_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_gateway_credentials_provider_chk CHECK (provider IN ('MERCADO_PAGO')),
  CONSTRAINT tenant_gateway_credentials_env_chk CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT tenant_gateway_credentials_unique_tenant_provider UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_tenant_gateway_credentials_tenant
  ON tenant_gateway_credentials(tenant_id, provider);

CREATE OR REPLACE FUNCTION fn_tenant_gateway_credentials_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_gateway_credentials_updated_at ON tenant_gateway_credentials;
CREATE TRIGGER trg_tenant_gateway_credentials_updated_at
BEFORE UPDATE ON tenant_gateway_credentials
FOR EACH ROW EXECUTE FUNCTION fn_tenant_gateway_credentials_touch_updated_at();

ALTER TABLE tenant_gateway_credentials ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tenant_gateway_credentials'
      AND policyname = 'tenant_gateway_credentials_no_direct_access'
  ) THEN
    CREATE POLICY tenant_gateway_credentials_no_direct_access
    ON tenant_gateway_credentials
    FOR ALL
    TO authenticated
    USING (FALSE)
    WITH CHECK (FALSE);
  END IF;
END $$;

COMMENT ON TABLE tenant_gateway_credentials IS
  'Credenciales privadas de pasarelas por tenant. Se administran solo desde Edge Functions seguras.';

COMMENT ON COLUMN tenant_gateway_credentials.public_key IS
  'Clave pública del proveedor. Puede devolverse al frontend cuando aplique.';

COMMENT ON COLUMN tenant_gateway_credentials.access_token IS
  'Token privado del proveedor. Nunca debe devolverse al frontend.';
