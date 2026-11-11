-- Modelo portable definitivo de autorización visual.
-- Los UUID de roles/permisos existentes no se reemplazan.
BEGIN;

CREATE TABLE public.menu_items (
    menu_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    label text NOT NULL,
    icon text,
    route text,
    action text,
    parent_code text REFERENCES public.menu_items(code) ON DELETE SET NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_superadmin_only boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT menu_items_code_valid CHECK (code ~ '^[A-Z][A-Z0-9_.:-]*$'),
    CONSTRAINT menu_items_target_valid CHECK (route IS NOT NULL OR action IS NOT NULL OR parent_code IS NULL)
);

CREATE TABLE public.menu_permissions (
    menu_item_id uuid NOT NULL REFERENCES public.menu_items(menu_item_id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES public.permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (menu_item_id, permission_id)
);

CREATE TABLE public.role_menus (
    tenant_id uuid NOT NULL,
    role_id uuid NOT NULL,
    menu_item_id uuid NOT NULL REFERENCES public.menu_items(menu_item_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, role_id, menu_item_id),
    FOREIGN KEY (tenant_id, role_id) REFERENCES public.roles(tenant_id, role_id) ON DELETE CASCADE
);

CREATE TABLE public.role_menu_templates (
    template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code text NOT NULL,
    menu_item_id uuid NOT NULL REFERENCES public.menu_items(menu_item_id) ON DELETE CASCADE,
    UNIQUE (role_code, menu_item_id)
);

CREATE INDEX role_menus_page_idx ON public.role_menus (tenant_id, role_id, menu_item_id);
CREATE INDEX menu_items_parent_idx ON public.menu_items (parent_code, sort_order, code);

INSERT INTO public.menu_items (code, label, icon, route, sort_order) VALUES
    ('DASHBOARD', 'Escritorio', 'mdi-view-dashboard', '/', 10),
    ('CUSTOMERS', 'Clientes', 'mdi-account-group', '/customers', 20),
    ('PRODUCTS', 'Productos', 'mdi-package-variant', '/products', 30),
    ('INVENTORY', 'Inventario', 'mdi-warehouse', '/inventory', 40),
    ('SALES', 'Ventas', 'mdi-cart', '/sales', 50);

-- El catálogo inicial queda visible para todos los roles existentes del tenant.
INSERT INTO public.role_menus (tenant_id, role_id, menu_item_id)
SELECT r.tenant_id, r.role_id, m.menu_item_id
FROM public.roles r
CROSS JOIN public.menu_items m
ON CONFLICT DO NOTHING;

COMMIT;
