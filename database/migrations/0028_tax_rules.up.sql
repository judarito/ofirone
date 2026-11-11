-- Portable tenant tax rules, preserving Supabase function precedence.
CREATE TABLE public.tax_rules (
    tax_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    tax_id uuid NOT NULL,
    scope text NOT NULL,
    category_id uuid,
    product_id uuid,
    variant_id uuid,
    priority integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, tax_rule_id),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, tax_id) REFERENCES public.taxes (tenant_id, tax_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, category_id) REFERENCES public.categories (tenant_id, category_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, product_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, variant_id) REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE CASCADE,
    CONSTRAINT tax_rules_scope_valid CHECK (
        (scope = 'TENANT' AND category_id IS NULL AND product_id IS NULL AND variant_id IS NULL) OR
        (scope = 'CATEGORY' AND category_id IS NOT NULL AND product_id IS NULL AND variant_id IS NULL) OR
        (scope = 'PRODUCT' AND category_id IS NULL AND product_id IS NOT NULL AND variant_id IS NULL) OR
        (scope = 'VARIANT' AND category_id IS NULL AND product_id IS NULL AND variant_id IS NOT NULL)
    )
);
CREATE INDEX tax_rules_resolution_idx ON public.tax_rules (tenant_id, is_active, scope, priority DESC, tax_rule_id);
CREATE INDEX tax_rules_category_idx ON public.tax_rules (tenant_id, category_id, priority DESC) WHERE is_active AND category_id IS NOT NULL;
CREATE INDEX tax_rules_product_idx ON public.tax_rules (tenant_id, product_id, priority DESC) WHERE is_active AND product_id IS NOT NULL;
CREATE INDEX tax_rules_variant_idx ON public.tax_rules (tenant_id, variant_id, priority DESC) WHERE is_active AND variant_id IS NOT NULL;
CREATE TRIGGER tax_rules_updated_at BEFORE UPDATE ON public.tax_rules
    FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
ALTER TABLE public.tax_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.tax_rules FOR ALL
    USING (tenant_id = app_private.current_tenant_id())
    WITH CHECK (tenant_id = app_private.current_tenant_id());
REVOKE ALL ON public.tax_rules FROM PUBLIC;
