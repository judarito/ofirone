-- ===================================================================
-- Fase 2 Contabilidad: menus para capacidades operativas avanzadas
-- Fecha: 2026-03-12
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE 'Instalando menus contables fase 2 (producto)';
END $$;

INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order, is_active)
VALUES
  ('CONTABILIDAD.ASIENTOS_MANUALES', 'Asientos Manuales', 'mdi-notebook-edit-outline', '/accounting/asientos-manuales', 'CONTABILIDAD', 594, TRUE),
  ('CONTABILIDAD.PLAN_CUENTAS', 'Plan de Cuentas', 'mdi-file-tree-outline', '/accounting/plan-cuentas', 'CONTABILIDAD', 595, TRUE),
  ('CONTABILIDAD.ESTADOS_FINANCIEROS', 'Estados Financieros', 'mdi-finance', '/accounting/estados-financieros', 'CONTABILIDAD', 596, TRUE),
  ('CONTABILIDAD.CENTRO_TRIBUTARIO', 'Centro Tributario', 'mdi-receipt-text-check-outline', '/accounting/centro-tributario', 'CONTABILIDAD', 597, TRUE),
  ('CONTABILIDAD.CONCILIACION', 'Conciliacion Caja/Bancos', 'mdi-bank-check', '/accounting/conciliacion', 'CONTABILIDAD', 598, TRUE),
  ('CONTABILIDAD.CONTROL_IA', 'Control Interno IA', 'mdi-robot-outline', '/accounting/control-ia', 'CONTABILIDAD', 599, TRUE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  route = EXCLUDED.route,
  parent_code = EXCLUDED.parent_code,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

WITH permission_map AS (
  SELECT *
  FROM (VALUES
    ('CONTABILIDAD.ASIENTOS_MANUALES', 'ACCOUNTING.ENTRY.CREATE'),
    ('CONTABILIDAD.PLAN_CUENTAS', 'ACCOUNTING.CATALOG.MANAGE'),
    ('CONTABILIDAD.ESTADOS_FINANCIEROS', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.CENTRO_TRIBUTARIO', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.CONCILIACION', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.CONTROL_IA', 'ACCOUNTING.AI.ASSIST')
  ) AS t(menu_code, permission_code)
)
INSERT INTO menu_permissions (menu_item_id, permission_id)
SELECT mi.menu_item_id, p.permission_id
FROM permission_map pm
JOIN menu_items mi ON mi.code = pm.menu_code
JOIN permissions p ON p.code = pm.permission_code
ON CONFLICT DO NOTHING;

INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT roles.role_name, mi.menu_item_id
FROM (VALUES ('ADMINISTRADOR'), ('GERENTE'), ('CONTADOR')) AS roles(role_name)
JOIN menu_items mi ON mi.code IN (
  'CONTABILIDAD.ASIENTOS_MANUALES',
  'CONTABILIDAD.PLAN_CUENTAS',
  'CONTABILIDAD.ESTADOS_FINANCIEROS',
  'CONTABILIDAD.CENTRO_TRIBUTARIO',
  'CONTABILIDAD.CONCILIACION',
  'CONTABILIDAD.CONTROL_IA'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_menus (role_id, menu_item_id)
SELECT r.role_id, mi.menu_item_id
FROM roles r
JOIN menu_items mi ON mi.code IN (
  'CONTABILIDAD.ASIENTOS_MANUALES',
  'CONTABILIDAD.PLAN_CUENTAS',
  'CONTABILIDAD.ESTADOS_FINANCIEROS',
  'CONTABILIDAD.CENTRO_TRIBUTARIO',
  'CONTABILIDAD.CONCILIACION',
  'CONTABILIDAD.CONTROL_IA'
)
WHERE r.name IN ('ADMINISTRADOR', 'GERENTE', 'CONTADOR')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'Menus contables fase 2 instalados';
END $$;
