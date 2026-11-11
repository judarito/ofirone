-- Portable price policies consumed by the POS catalog search.
CREATE TABLE public.pricing_rules (
    pricing_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    scope text NOT NULL,
    location_id uuid,
    category_id uuid,
    product_id uuid,
    variant_id uuid,
    pricing_method text NOT NULL DEFAULT 'MARKUP',
    markup_percentage numeric(10,2) NOT NULL DEFAULT 20,
    price_rounding text NOT NULL DEFAULT 'NONE',
    rounding_to numeric(10,2) NOT NULL DEFAULT 1,
    priority integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, pricing_rule_id),
    FOREIGN KEY (tenant_id) REFERENCES public.tenants (tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, location_id) REFERENCES public.locations (tenant_id, location_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, category_id) REFERENCES public.categories (tenant_id, category_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, product_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, variant_id) REFERENCES public.product_variants (tenant_id, variant_id) ON DELETE CASCADE,
    CONSTRAINT pricing_rules_scope_valid CHECK (scope IN ('TENANT','LOCATION','CATEGORY','PRODUCT','VARIANT')),
    CONSTRAINT pricing_rules_scope_target_valid CHECK (
        (scope='TENANT' AND location_id IS NULL AND category_id IS NULL AND product_id IS NULL AND variant_id IS NULL) OR
        (scope='LOCATION' AND location_id IS NOT NULL AND category_id IS NULL AND product_id IS NULL AND variant_id IS NULL) OR
        (scope='CATEGORY' AND location_id IS NULL AND category_id IS NOT NULL AND product_id IS NULL AND variant_id IS NULL) OR
        (scope='PRODUCT' AND location_id IS NULL AND category_id IS NULL AND product_id IS NOT NULL AND variant_id IS NULL) OR
        (scope='VARIANT' AND location_id IS NULL AND category_id IS NULL AND product_id IS NULL AND variant_id IS NOT NULL)
    ),
    CONSTRAINT pricing_rules_method_valid CHECK (pricing_method IN ('MARKUP','FIXED')),
    CONSTRAINT pricing_rules_markup_valid CHECK (markup_percentage BETWEEN 0 AND 100000),
    CONSTRAINT pricing_rules_rounding_valid CHECK (price_rounding IN ('NONE','UP','DOWN','NEAREST') AND rounding_to > 0)
);

CREATE INDEX pricing_rules_resolution_idx ON public.pricing_rules
    (tenant_id, scope, is_active, priority DESC, pricing_rule_id);
CREATE INDEX pricing_rules_location_idx ON public.pricing_rules (tenant_id, location_id, priority DESC)
    WHERE location_id IS NOT NULL AND is_active;
CREATE INDEX pricing_rules_category_idx ON public.pricing_rules (tenant_id, category_id, priority DESC)
    WHERE category_id IS NOT NULL AND is_active;
CREATE INDEX pricing_rules_product_idx ON public.pricing_rules (tenant_id, product_id, priority DESC)
    WHERE product_id IS NOT NULL AND is_active;
CREATE INDEX pricing_rules_variant_idx ON public.pricing_rules (tenant_id, variant_id, priority DESC)
    WHERE variant_id IS NOT NULL AND is_active;

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY pricing_rules_tenant_isolation ON public.pricing_rules FOR ALL
    USING (tenant_id = app_private.current_tenant_id())
    WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE TRIGGER pricing_rules_updated_at BEFORE UPDATE ON public.pricing_rules
    FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
REVOKE ALL ON public.pricing_rules FROM PUBLIC;
