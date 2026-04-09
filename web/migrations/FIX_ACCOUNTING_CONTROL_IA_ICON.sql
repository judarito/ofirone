-- ===================================================================
-- Fix: icono de menu Control IA
-- Fecha: 2026-03-12
-- ===================================================================

UPDATE menu_items
SET icon = 'mdi-robot-outline'
WHERE code = 'CONTABILIDAD.CONTROL_IA';
