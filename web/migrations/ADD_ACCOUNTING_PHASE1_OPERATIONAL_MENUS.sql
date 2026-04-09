-- ===================================================================
-- Fase 1 Contabilidad: menu operativo para contador (navegacion directa)
-- Fecha: 2026-03-11
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE 'Instalando menus operativos contables Fase 1';
END $$;

INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order, is_active)
VALUES
  ('CONTABILIDAD.PANEL_DIAN', 'Panel Contador / DIAN', 'mdi-clipboard-check-outline', '/accounting/compliance', 'CONTABILIDAD', 584, TRUE),
  ('CONTABILIDAD.COLA_POS', 'Cola POS -> Contabilidad', 'mdi-queue-first-in-last-out', '/accounting/queue', 'CONTABILIDAD', 585, TRUE),
  ('CONTABILIDAD.ASISTENTE_IA', 'Asistente IA Contable', 'mdi-robot-outline', '/accounting/assistant', 'CONTABILIDAD', 586, TRUE),
  ('CONTABILIDAD.REP_FINANCIERO', 'Reporte Financiero', 'mdi-finance', '/reports/financiero', 'CONTABILIDAD', 587, TRUE),
  ('CONTABILIDAD.REP_VENTAS_IVA', 'Ventas e IVA', 'mdi-cash-register', '/reports/ventas', 'CONTABILIDAD', 588, TRUE),
  ('CONTABILIDAD.REP_CAJAS', 'Caja y Flujo', 'mdi-cash-multiple', '/reports/cajas', 'CONTABILIDAD', 589, TRUE),
  ('CONTABILIDAD.TERCEROS', 'Maestro de Terceros', 'mdi-account-group-outline', '/third-parties', 'CONTABILIDAD', 590, TRUE)
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
    ('CONTABILIDAD.PANEL_DIAN', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.COLA_POS', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.ASISTENTE_IA', 'ACCOUNTING.AI.ASSIST'),
    ('CONTABILIDAD.REP_FINANCIERO', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.REP_VENTAS_IVA', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.REP_CAJAS', 'ACCOUNTING.VIEW'),
    ('CONTABILIDAD.TERCEROS', 'ACCOUNTING.VIEW')
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
  'CONTABILIDAD.PANEL_DIAN',
  'CONTABILIDAD.COLA_POS',
  'CONTABILIDAD.ASISTENTE_IA',
  'CONTABILIDAD.REP_FINANCIERO',
  'CONTABILIDAD.REP_VENTAS_IVA',
  'CONTABILIDAD.REP_CAJAS',
  'CONTABILIDAD.TERCEROS'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_menus (role_id, menu_item_id)
SELECT r.role_id, mi.menu_item_id
FROM roles r
JOIN menu_items mi ON mi.code IN (
  'CONTABILIDAD.PANEL_DIAN',
  'CONTABILIDAD.COLA_POS',
  'CONTABILIDAD.ASISTENTE_IA',
  'CONTABILIDAD.REP_FINANCIERO',
  'CONTABILIDAD.REP_VENTAS_IVA',
  'CONTABILIDAD.REP_CAJAS',
  'CONTABILIDAD.TERCEROS'
)
WHERE r.name IN ('ADMINISTRADOR', 'GERENTE', 'CONTADOR')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'Menus operativos contables Fase 1 instalados';
END $$;
