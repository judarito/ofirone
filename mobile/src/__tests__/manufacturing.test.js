/**
 * Tests de lógica pura del módulo de manufactura mobile.
 *
 * Cubre:
 * - Cálculo de costo total de BOM (waste% incluido)
 * - Cálculo de cantidad requerida por componente (qty × wasteMultiplier × orderQty)
 * - Lógica de validateBOMAvailability (pura, sin Supabase)
 * - Lógica de disponibilidad: optional vs required
 */

// ─── Helpers puros extraídos de la lógica de manufactura ─────────────────────

/**
 * Calcula el multiplicador de desperdicio.
 * waste_percentage = 10 → multiplier = 1.10
 */
function wasteMultiplier(wastePercentage) {
  return 1 + (wastePercentage || 0) / 100;
}

/**
 * Cantidad real requerida de un componente para una orden de N unidades.
 */
function requiredQty(quantityRequired, wastePercentage, orderQty) {
  return quantityRequired * wasteMultiplier(wastePercentage) * orderQty;
}

/**
 * Costo de una línea de componente (para 1 unidad producida).
 */
function componentLineCost(unitCost, quantityRequired, wastePercentage) {
  return unitCost * quantityRequired * wasteMultiplier(wastePercentage);
}

/**
 * Costo total de BOM para producir 1 unidad.
 */
function calcBOMTotalCost(components) {
  return components.reduce((acc, comp) => {
    return acc + componentLineCost(
      comp.component_variant?.cost || 0,
      comp.quantity_required,
      comp.waste_percentage || 0,
    );
  }, 0);
}

/**
 * Replica la lógica pura de validateBOMAvailability.
 * Recibe components (con sku, quantity_required, waste_percentage, is_optional)
 * y stockMap (Map<variant_id, available>).
 */
function validateAvailability(components, stockMap, orderQty) {
  let allAvailable = true;
  const result = components.map((comp) => {
    const required = requiredQty(comp.quantity_required, comp.waste_percentage || 0, orderQty);
    const available = stockMap.get(comp.component_variant_id) || 0;
    const isAvailable = available >= required;
    if (!isAvailable && !comp.is_optional) allAvailable = false;
    return { variant_id: comp.component_variant_id, required, available, is_available: isAvailable, is_optional: comp.is_optional };
  });
  return { all_available: allAvailable, components: result };
}

// ─── wasteMultiplier ──────────────────────────────────────────────────────────

describe('wasteMultiplier', () => {
  it('0% → 1.0 (sin desperdicio)', () => {
    expect(wasteMultiplier(0)).toBe(1);
  });

  it('10% → 1.10', () => {
    expect(wasteMultiplier(10)).toBe(1.1);
  });

  it('50% → 1.50', () => {
    expect(wasteMultiplier(50)).toBe(1.5);
  });

  it('null/undefined → 1.0', () => {
    expect(wasteMultiplier(null)).toBe(1);
    expect(wasteMultiplier(undefined)).toBe(1);
  });
});

// ─── requiredQty ──────────────────────────────────────────────────────────────

describe('requiredQty', () => {
  it('2 kg × sin desperdicio × 10 unidades → 20 kg', () => {
    expect(requiredQty(2, 0, 10)).toBe(20);
  });

  it('2 kg × 10% desperdicio × 10 unidades → 22 kg', () => {
    expect(requiredQty(2, 10, 10)).toBe(22);
  });

  it('1 kg × 25% desperdicio × 5 unidades → 6.25 kg', () => {
    expect(requiredQty(1, 25, 5)).toBeCloseTo(6.25);
  });

  it('producir 1 unidad con waste 0 → retorna quantity_required exacto', () => {
    expect(requiredQty(3.5, 0, 1)).toBe(3.5);
  });
});

// ─── componentLineCost ────────────────────────────────────────────────────────

describe('componentLineCost', () => {
  it('cost 1000 × qty 2 × sin waste → 2000', () => {
    expect(componentLineCost(1000, 2, 0)).toBe(2000);
  });

  it('cost 5000 × qty 1 × waste 10% → 5500', () => {
    expect(componentLineCost(5000, 1, 10)).toBe(5500);
  });

  it('costo 0 → linea en 0 sin importar qty', () => {
    expect(componentLineCost(0, 5, 20)).toBe(0);
  });
});

// ─── calcBOMTotalCost ──────────────────────────────────────────────────────────

describe('calcBOMTotalCost', () => {
  it('BOM con 2 componentes sin waste', () => {
    const components = [
      { component_variant: { cost: 1000 }, quantity_required: 2, waste_percentage: 0 },
      { component_variant: { cost: 500 },  quantity_required: 3, waste_percentage: 0 },
    ];
    // 1000*2 + 500*3 = 2000 + 1500 = 3500
    expect(calcBOMTotalCost(components)).toBe(3500);
  });

  it('BOM con waste en un componente', () => {
    const components = [
      { component_variant: { cost: 2000 }, quantity_required: 1, waste_percentage: 10 },
      { component_variant: { cost: 1000 }, quantity_required: 2, waste_percentage: 0  },
    ];
    // 2000 * 1 * 1.10 + 1000 * 2 * 1.0 = 2200 + 2000 = 4200
    expect(calcBOMTotalCost(components)).toBeCloseTo(4200);
  });

  it('BOM vacío → costo 0', () => {
    expect(calcBOMTotalCost([])).toBe(0);
  });

  it('componente sin cost registrado → no suma (costo 0)', () => {
    const components = [
      { component_variant: { cost: 0 }, quantity_required: 5, waste_percentage: 0 },
      { component_variant: { cost: 3000 }, quantity_required: 1, waste_percentage: 0 },
    ];
    expect(calcBOMTotalCost(components)).toBe(3000);
  });

  it('componente sin component_variant → no suma', () => {
    const components = [
      { component_variant: null, quantity_required: 2, waste_percentage: 0 },
      { component_variant: { cost: 500 }, quantity_required: 1, waste_percentage: 0 },
    ];
    expect(calcBOMTotalCost(components)).toBe(500);
  });
});

// ─── validateAvailability ─────────────────────────────────────────────────────

describe('validateAvailability — lógica pura', () => {
  const V1 = 'variant-001';
  const V2 = 'variant-002';
  const V3 = 'variant-003';

  const component = (variantId, qty, waste = 0, optional = false) => ({
    component_variant_id: variantId,
    quantity_required: qty,
    waste_percentage: waste,
    is_optional: optional,
  });

  it('un componente con stock suficiente → all_available = true', () => {
    const comps = [component(V1, 5, 0)];
    const stock = new Map([[V1, 10]]);
    const result = validateAvailability(comps, stock, 1);
    expect(result.all_available).toBe(true);
    expect(result.components[0].is_available).toBe(true);
  });

  it('un componente con stock insuficiente → all_available = false', () => {
    const comps = [component(V1, 10, 0)];
    const stock = new Map([[V1, 5]]);
    const result = validateAvailability(comps, stock, 1);
    expect(result.all_available).toBe(false);
    expect(result.components[0].is_available).toBe(false);
  });

  it('componente opcional insuficiente → all_available sigue en true', () => {
    const comps = [
      component(V1, 5, 0, false),   // requerido, tiene stock
      component(V2, 10, 0, true),   // opcional, sin stock
    ];
    const stock = new Map([[V1, 10], [V2, 3]]);
    const result = validateAvailability(comps, stock, 1);
    expect(result.all_available).toBe(true);
    expect(result.components[1].is_available).toBe(false);
  });

  it('componente sin stock registrado → available = 0', () => {
    const comps = [component(V1, 2, 0)];
    const stock = new Map(); // vacío
    const result = validateAvailability(comps, stock, 1);
    expect(result.components[0].available).toBe(0);
    expect(result.components[0].is_available).toBe(false);
  });

  it('waste reduce el stock efectivo — 2 kg × 10% waste × 10 órdenes → necesita 22', () => {
    const comps = [component(V1, 2, 10, false)];
    const stock = new Map([[V1, 21]]); // 21 < 22
    const result = validateAvailability(comps, stock, 10);
    expect(result.all_available).toBe(false);
    expect(result.components[0].required).toBeCloseTo(22);
  });

  it('waste reduce el stock efectivo — con 22 exacto → suficiente', () => {
    const comps = [component(V1, 2, 10, false)];
    const stock = new Map([[V1, 22]]);
    const result = validateAvailability(comps, stock, 10);
    expect(result.all_available).toBe(true);
  });

  it('múltiples componentes — todos disponibles → all_available = true', () => {
    const comps = [component(V1, 1, 0), component(V2, 3, 0), component(V3, 2, 5)];
    const stock = new Map([[V1, 10], [V2, 20], [V3, 10]]);
    // V3: 2 × 1.05 × 1 = 2.1 → stock 10 es suficiente
    const result = validateAvailability(comps, stock, 1);
    expect(result.all_available).toBe(true);
  });

  it('lista vacía de componentes → all_available = true', () => {
    const result = validateAvailability([], new Map(), 5);
    expect(result.all_available).toBe(true);
    expect(result.components).toHaveLength(0);
  });

  it('producir 0 unidades → required = 0, siempre disponible', () => {
    const comps = [component(V1, 5, 0)];
    const stock = new Map([[V1, 0]]);
    const result = validateAvailability(comps, stock, 0);
    expect(result.components[0].required).toBe(0);
    expect(result.components[0].is_available).toBe(true);
  });

  it('retorna exact required calculado para cada componente', () => {
    const comps = [component(V1, 3, 20, false)]; // 3 × 1.20 × 4 = 14.4
    const stock = new Map([[V1, 20]]);
    const result = validateAvailability(comps, stock, 4);
    expect(result.components[0].required).toBeCloseTo(14.4);
  });
});
