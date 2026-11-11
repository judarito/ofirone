-- 0026_system_alerts.up.sql
-- Alertas operativas del tenant para dashboard y bandejas.
CREATE TABLE public.system_alerts (
    alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    alert_type text NOT NULL,
    alert_level text NOT NULL DEFAULT 'INFO',
    reference_id uuid,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT system_alerts_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
    CONSTRAINT system_alerts_type_valid CHECK (alert_type IN ('STOCK', 'EXPIRATION', 'LAYAWAY', 'PAYABLE', 'RECEIVABLE', 'ONLINE_ORDER')),
    CONSTRAINT system_alerts_level_valid CHECK (alert_level IN ('INFO', 'WARNING', 'CRITICAL'))
);

CREATE INDEX system_alerts_page_idx ON public.system_alerts (tenant_id, created_at DESC, alert_id DESC);
CREATE INDEX system_alerts_filter_idx ON public.system_alerts (tenant_id, alert_type, alert_level, created_at DESC, alert_id DESC);

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY system_alerts_select ON public.system_alerts FOR SELECT USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY system_alerts_insert ON public.system_alerts FOR INSERT WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY system_alerts_update ON public.system_alerts FOR UPDATE USING (tenant_id = app_private.current_tenant_id()) WITH CHECK (tenant_id = app_private.current_tenant_id());

CREATE TRIGGER system_alerts_updated_at BEFORE UPDATE ON public.system_alerts
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
