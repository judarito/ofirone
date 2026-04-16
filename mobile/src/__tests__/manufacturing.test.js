import {
  getWasteMultiplier,
  getRequiredComponentQuantity,
  getBomComponentLineCost,
  getBomEstimatedCost,
  normalizeAvailabilityResult,
  normalizeProductionOrderStatus,
} from '../../../shared/utils/manufacturing';

function validateAvailability(components, stockMap, orderQty) {
  return normalizeAvailabilityResult({
    components: components.map((component) => ({
      component_variant_id: component.component_variant_id,
      sku: component.sku,
      required: getRequiredComponentQuantity(
        component.quantity_required,
        component.waste_percentage || 0,
        orderQty,
      ),
      available: stockMap.get(component.component_variant_id) || 0,
      is_optional: component.is_optional,
    })),
  });
}

describe('getWasteMultiplier', () => {
  it('0% → 1.0 (sin desperdicio)', () => {
    expect(getWasteMultiplier(0)).toBe(1);
  });

  it('10% → 1.10', () => {
    expect(getWasteMultiplier(10)).toBe(1.1);
  });

  it('50% → 1.50', () => {
    expect(getWasteMultiplier(50)).toBe(1.5);
  });

  it('null/undefined → 1.0', () => {
    expect(getWasteMultiplier(null)).toBe(1);
    expect(getWasteMultiplier(undefined)).toBe(1);
  });
});

describe('getRequiredComponentQuantity', () => {
  it('2 kg × sin desperdicio × 10 unidades → 20 kg', () => {
    expect(getRequiredComponentQuantity(2, 0, 10)).toBe(20);
  });

  it('2 kg × 10% desperdicio × 10 unidades → 22 kg', () => {
    expect(getRequiredComponentQuantity(2, 10, 10)).toBe(22);
  });

  it('1 kg × 25% desperdicio × 5 unidades → 6.25 kg', () => {
    expect(getRequiredComponentQuantity(1, 25, 5)).toBeCloseTo(6.25);
  });

  it('producir 1 unidad con waste 0 → retorna quantity_required exacto', () => {
    expect(getRequiredComponentQuantity(3.5, 0, 1)).toBe(3.5);
  });
});

describe('getBomComponentLineCost', () => {
  it('cost 1000 × qty 2 × sin waste → 2000', () => {
    expect(getBomComponentLineCost(1000, 2, 0)).toBe(2000);
  });

  it('cost 5000 × qty 1 × waste 10% → 5500', () => {
    expect(getBomComponentLineCost(5000, 1, 10)).toBe(5500);
  });

  it('costo 0 → linea en 0 sin importar qty', () => {
    expect(getBomComponentLineCost(0, 5, 20)).toBe(0);
  });
});

describe('getBomEstimatedCost', () => {
  it('BOM con 2 componentes sin waste', () => {
    const components = [
      { component_variant: { cost: 1000 }, quantity_required: 2, waste_percentage: 0 },
      { component_variant: { cost: 500 }, quantity_required: 3, waste_percentage: 0 },
    ];
    expect(getBomEstimatedCost(components)).toBe(3500);
  });

  it('BOM con waste en un componente', () => {
    const components = [
      { component_variant: { cost: 2000 }, quantity_required: 1, waste_percentage: 10 },
      { component_variant: { cost: 1000 }, quantity_required: 2, waste_percentage: 0 },
    ];
    expect(getBomEstimatedCost(components)).toBeCloseTo(4200);
  });

  it('BOM vacío → costo 0', () => {
    expect(getBomEstimatedCost([])).toBe(0);
  });

  it('componente sin cost registrado → no suma', () => {
    const components = [
      { component_variant: { cost: 0 }, quantity_required: 5, waste_percentage: 0 },
      { component_variant: { cost: 3000 }, quantity_required: 1, waste_percentage: 0 },
    ];
    expect(getBomEstimatedCost(components)).toBe(3000);
  });
});

describe('normalizeAvailabilityResult', () => {
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
    const result = validateAvailability([component(V1, 5, 0)], new Map([[V1, 10]]), 1);
    expect(result.all_available).toBe(true);
    expect(result.components[0].is_sufficient).toBe(true);
  });

  it('un componente con stock insuficiente → all_available = false', () => {
    const result = validateAvailability([component(V1, 10, 0)], new Map([[V1, 5]]), 1);
    expect(result.all_available).toBe(false);
    expect(result.components[0].is_sufficient).toBe(false);
  });

  it('componente opcional insuficiente no bloquea la orden', () => {
    const result = validateAvailability(
      [component(V1, 5, 0, false), component(V2, 10, 0, true)],
      new Map([[V1, 10], [V2, 3]]),
      1,
    );
    expect(result.all_available).toBe(true);
    expect(result.components[1].is_sufficient).toBe(false);
  });

  it('sin stock registrado reporta disponible = 0', () => {
    const result = validateAvailability([component(V1, 2, 0)], new Map(), 1);
    expect(result.components[0].available_quantity).toBe(0);
    expect(result.components[0].is_sufficient).toBe(false);
  });

  it('waste aumenta lo requerido', () => {
    const result = validateAvailability([component(V1, 2, 10, false)], new Map([[V1, 21]]), 10);
    expect(result.all_available).toBe(false);
    expect(result.components[0].required_quantity).toBeCloseTo(22);
  });

  it('lista vacía de componentes → disponible', () => {
    const result = validateAvailability([], new Map(), 5);
    expect(result.all_available).toBe(true);
    expect(result.components).toHaveLength(0);
  });

  it('normaliza payloads legacy con components dentro de data', () => {
    const result = normalizeAvailabilityResult({
      all_available: false,
      components: [
        {
          variant_id: V3,
          sku: 'TELA-01',
          required: 12,
          available: 5,
          is_available: false,
        },
      ],
    });

    expect(result.all_available).toBe(false);
    expect(result.components[0].component_variant_id).toBe(V3);
    expect(result.components[0].component_name).toBe('TELA-01');
  });
});

describe('normalizeProductionOrderStatus', () => {
  it('mapea DRAFT a PENDING para mantener paridad frontend', () => {
    expect(normalizeProductionOrderStatus('DRAFT')).toBe('PENDING');
  });

  it('mantiene IN_PROGRESS y COMPLETED', () => {
    expect(normalizeProductionOrderStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(normalizeProductionOrderStatus('COMPLETED')).toBe('COMPLETED');
  });
});
