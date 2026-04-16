/* ============================================================================
   ADD_MANUFACTURING_COST_POLICY_FIELDS.sql

   Política explícita de costos/precios para manufactura:
   - production_orders.actual_unit_cost: costo real unitario de la orden
   - product_variants.standard_cost: costo estándar/canónico del SKU
   - product_variants.suggested_price: precio sugerido calculado por pricing rules
   - product_variants.price: sigue siendo precio catálogo y NO se auto-pisa
   ============================================================================ */

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS actual_unit_cost NUMERIC(14,2);

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS standard_cost NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS suggested_price NUMERIC(14,2);

UPDATE product_variants
SET standard_cost = COALESCE(standard_cost, cost),
    suggested_price = COALESCE(suggested_price, price)
WHERE standard_cost IS NULL
   OR suggested_price IS NULL;

UPDATE production_orders
SET actual_unit_cost = ROUND(actual_cost / NULLIF(quantity_produced, 0), 2)
WHERE actual_unit_cost IS NULL
  AND actual_cost IS NOT NULL
  AND quantity_produced > 0;

COMMENT ON COLUMN production_orders.actual_unit_cost IS 'Costo real unitario de la orden = (componentes + MOD + CIF) / cantidad producida.';
COMMENT ON COLUMN product_variants.standard_cost IS 'Costo estándar o de referencia del SKU. Puede sincronizarse con TO_STOCK sin tocar price.';
COMMENT ON COLUMN product_variants.suggested_price IS 'Precio sugerido calculado desde pricing_rules. No reemplaza automáticamente el precio catálogo.';
