BEGIN;
CREATE TABLE IF NOT EXISTS public.tenant_settings (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
 business_name text, business_address text, business_phone text, logo_url text, receipt_footer text,
 default_tax_included boolean NOT NULL DEFAULT false, default_page_size integer NOT NULL DEFAULT 20 CHECK(default_page_size between 1 and 100),
 theme text NOT NULL DEFAULT 'light', date_format text NOT NULL DEFAULT 'DD/MM/YYYY', locale text NOT NULL DEFAULT 'es-CO', session_timeout_minutes integer NOT NULL DEFAULT 60 CHECK(session_timeout_minutes > 0),
 accounting_enabled boolean NOT NULL DEFAULT false, accounting_mode text NOT NULL DEFAULT 'ASYNC', accounting_auto_post_sales boolean NOT NULL DEFAULT false, accounting_auto_post_purchases boolean NOT NULL DEFAULT false,
 expiry_alert_days integer NOT NULL DEFAULT 30 CHECK(expiry_alert_days >= 0), reserve_stock_on_layaway boolean NOT NULL DEFAULT true, max_discount_without_auth numeric(5,2) NOT NULL DEFAULT 5 CHECK(max_discount_without_auth between 0 and 100), rounding_method text NOT NULL DEFAULT 'normal', rounding_multiple integer NOT NULL DEFAULT 100,
 invoice_prefix text NOT NULL DEFAULT 'FAC', next_invoice_number integer NOT NULL DEFAULT 1, electronic_invoicing_enabled boolean NOT NULL DEFAULT false, print_format text NOT NULL DEFAULT 'thermal', thermal_paper_width integer NOT NULL DEFAULT 80,
 email_alerts_enabled boolean NOT NULL DEFAULT false, alert_email text, notify_low_stock boolean NOT NULL DEFAULT true, notify_expiring_products boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_settings_isolation ON public.tenant_settings;
CREATE POLICY tenant_settings_isolation ON public.tenant_settings USING(tenant_id=app_private.current_tenant_id()) WITH CHECK(tenant_id=app_private.current_tenant_id());
CREATE INDEX IF NOT EXISTS tenant_settings_tenant_idx ON public.tenant_settings(tenant_id);
INSERT INTO public.tenant_settings(tenant_id) SELECT tenant_id FROM public.tenants ON CONFLICT DO NOTHING;
COMMIT;
