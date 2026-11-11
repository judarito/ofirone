-- Integration migration fragment. Apply through the migration runner with its next
-- available version; never run DDL at application startup. Requires 0001/0004.
CREATE TABLE public.reference_currencies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(tenant_id),
 code text NOT NULL CHECK (code ~ '^[A-Z]{3}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 decimal_places integer NOT NULL CHECK (decimal_places BETWEEN 0 AND 6),
 is_active boolean NOT NULL DEFAULT true,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE TABLE public.reference_regional_settings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(tenant_id),
 code text NOT NULL CHECK (length(code) BETWEEN 1 AND 50 AND code=btrim(code)),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 currency_code text NOT NULL,
 locale text NOT NULL CHECK (locale<>''),
 timezone text NOT NULL CHECK (timezone<>''),
 is_active boolean NOT NULL DEFAULT true,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code),
 FOREIGN KEY(tenant_id,currency_code) REFERENCES public.reference_currencies(tenant_id,code) ON UPDATE CASCADE
);
CREATE INDEX reference_currencies_page_idx ON public.reference_currencies(tenant_id,code,id);
CREATE INDEX reference_regional_page_idx ON public.reference_regional_settings(tenant_id,code,id);
CREATE INDEX taxes_code_page_idx ON public.taxes(tenant_id,code,tax_id);
ALTER TABLE public.reference_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_currencies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.reference_currencies FOR ALL
 USING (tenant_id=app_private.current_tenant_id()) WITH CHECK (tenant_id=app_private.current_tenant_id());
ALTER TABLE public.reference_regional_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_regional_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.reference_regional_settings FOR ALL
 USING (tenant_id=app_private.current_tenant_id()) WITH CHECK (tenant_id=app_private.current_tenant_id());
REVOKE ALL ON public.reference_currencies,public.reference_regional_settings FROM PUBLIC;
-- Grant SELECT/INSERT/UPDATE on these tables to the runtime role explicitly.
