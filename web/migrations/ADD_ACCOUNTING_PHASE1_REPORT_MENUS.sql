-- ===================================================================
-- Fase 1 Contabilidad: menús de Libro Diario y Libro Mayor
-- Fecha: 2026-03-11
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE '⚙️  Instalando menús contables Fase 1 (Diario/Mayor)';
END $$;

INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order, is_active)
VALUES
  ('CONTABILIDAD.LIBRO_DIARIO', 'Libro Diario', 'mdi-book-open-variant', '/accounting/diario', 'CONTABILIDAD', 582, TRUE),
  ('CONTABILIDAD.LIBRO_MAYOR', 'Libro Mayor', 'mdi-book-multiple', '/accounting/mayor', 'CONTABILIDAD', 583, TRUE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  route = EXCLUDED.route,
  parent_code = EXCLUDED.parent_code,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

INSERT INTO menu_permissions (menu_item_id, permission_id)
SELECT mi.menu_item_id, p.permission_id
FROM menu_items mi
JOIN permissions p ON p.code = 'ACCOUNTING.VIEW'
WHERE mi.code IN ('CONTABILIDAD.LIBRO_DIARIO', 'CONTABILIDAD.LIBRO_MAYOR')
ON CONFLICT DO NOTHING;

INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT role_name, mi.menu_item_id
FROM (VALUES ('ADMINISTRADOR'), ('GERENTE'), ('CONTADOR')) AS roles(role_name)
JOIN menu_items mi ON mi.code IN ('CONTABILIDAD.LIBRO_DIARIO', 'CONTABILIDAD.LIBRO_MAYOR')
ON CONFLICT DO NOTHING;

INSERT INTO role_menus (role_id, menu_item_id)
SELECT r.role_id, mi.menu_item_id
FROM roles r
JOIN menu_items mi ON mi.code IN ('CONTABILIDAD.LIBRO_DIARIO', 'CONTABILIDAD.LIBRO_MAYOR')
WHERE r.name IN ('ADMINISTRADOR', 'GERENTE', 'CONTADOR')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '✅ Menús contables Fase 1 instalados: /accounting/diario y /accounting/mayor';
END $$;
