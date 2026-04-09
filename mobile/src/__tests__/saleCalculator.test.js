/**
 * Tests del saleCalculator compartido desde la perspectiva mobile.
 * Verifica que los cálculos de carrito producen los mismos resultados
 * que se enviarán a sp_create_sale, tanto online como offline.
 */
import {
  getDocumentLineSubtotal,
  normalizeLineDiscountInput,
  getCartLineDiscountAmount,
  getCartLineGlobalDiscountAmount,
  getCartLineTotalDiscountAmount,
  getCartLineNetSubtotal,
  allocateGlobalDiscountAcrossLines,
  validateCartDiscounts,
  validateSalePayloadDiscounts,
  getMaxGlobalDiscountAmount,
  summarizeCartTotals,
  buildSalePayloadLines,
} from '../../../shared/utils/saleCalculator';

function cartLine({
  quantity = 1,
  unit_price = 50000,
  discount_line = 0,
  discount_line_type = 'AMOUNT',
  discount_global = 0,
  base_amount = null,
  tax_amount = 0,
  tax_rate = 0,
  tax_code = null,
  tax_name = null,
  line_total = null,
  price_includes_tax = false,
  variant_id = 'v-1',
} = {}) {
  const sub = quantity * unit_price;
  return {
    variant_id,
    quantity,
    unit_price,
    discount_line,
    discount_line_type,
    discount_global,
    base_amount: base_amount ?? sub,
    tax_amount,
    tax_rate,
    tax_code,
    tax_name,
    line_total: line_total ?? sub,
    price_includes_tax,
  };
}

// ─── getDocumentLineSubtotal ───────────────────────────────────────────────
describe('getDocumentLineSubtotal', () => {
  it('calcula subtotal bruto de línea', () => {
    expect(getDocumentLineSubtotal({ quantity: 3, unit_price: 15000 })).toBe(45000);
  });

  it('devuelve 0 para línea vacía', () => {
    expect(getDocumentLineSubtotal({})).toBe(0);
  });

  it('devuelve 0 para valores no numéricos', () => {
    expect(getDocumentLineSubtotal({ quantity: 'dos', unit_price: 10000 })).toBe(0);
  });
});

// ─── normalizeLineDiscountInput ────────────────────────────────────────────
describe('normalizeLineDiscountInput', () => {
  it('descuento AMOUNT válido no se ajusta', () => {
    const r = normalizeLineDiscountInput(100000, 20000, 'AMOUNT');
    expect(r.valid).toBe(true);
    expect(r.adjusted).toBe(false);
    expect(r.sanitizedValue).toBe(20000);
  });

  it('descuento mayor que subtotal se ajusta al máximo', () => {
    const r = normalizeLineDiscountInput(50000, 80000, 'AMOUNT');
    expect(r.sanitizedValue).toBe(50000);
    expect(r.adjusted).toBe(true);
  });

  it('PERCENT > 100 se ajusta a 100', () => {
    const r = normalizeLineDiscountInput(50000, 150, 'PERCENT');
    expect(r.sanitizedValue).toBe(100);
  });

  it('descuento negativo se normaliza a 0', () => {
    const r = normalizeLineDiscountInput(50000, -100, 'AMOUNT');
    expect(r.sanitizedValue).toBe(0);
  });
});

// ─── getCartLineDiscountAmount ─────────────────────────────────────────────
describe('getCartLineDiscountAmount', () => {
  it('sin descuento devuelve 0', () => {
    expect(getCartLineDiscountAmount(cartLine())).toBe(0);
  });

  it('descuento AMOUNT', () => {
    const line = cartLine({ quantity: 2, unit_price: 50000, discount_line: 10000 });
    expect(getCartLineDiscountAmount(line)).toBe(10000);
  });

  it('descuento PERCENT 15%', () => {
    const line = cartLine({ quantity: 1, unit_price: 80000, discount_line: 15, discount_line_type: 'PERCENT' });
    expect(getCartLineDiscountAmount(line)).toBe(12000);
  });

  it('descuento PERCENT 100% — descuenta el subtotal completo', () => {
    const line = cartLine({ quantity: 1, unit_price: 50000, discount_line: 100, discount_line_type: 'PERCENT' });
    expect(getCartLineDiscountAmount(line)).toBe(50000);
  });
});

// ─── getCartLineGlobalDiscountAmount ──────────────────────────────────────
describe('getCartLineGlobalDiscountAmount', () => {
  it('sin global devuelve 0', () => {
    expect(getCartLineGlobalDiscountAmount(cartLine())).toBe(0);
  });

  it('devuelve el monto global asignado a la línea', () => {
    const line = cartLine({ discount_global: 8000 });
    expect(getCartLineGlobalDiscountAmount(line)).toBe(8000);
  });

  it('nunca devuelve negativo', () => {
    const line = cartLine({ discount_global: -3000 });
    expect(getCartLineGlobalDiscountAmount(line)).toBeGreaterThanOrEqual(0);
  });
});

// ─── getCartLineNetSubtotal ────────────────────────────────────────────────
describe('getCartLineNetSubtotal', () => {
  it('subtotal neto descuenta el descuento de línea', () => {
    const line = cartLine({ quantity: 1, unit_price: 100000, discount_line: 20000 });
    expect(getCartLineNetSubtotal(line)).toBe(80000);
  });

  it('sin descuento el subtotal neto es igual al bruto', () => {
    const line = cartLine({ quantity: 2, unit_price: 30000 });
    expect(getCartLineNetSubtotal(line)).toBe(60000);
  });

  it('nunca es negativo', () => {
    const line = cartLine({ quantity: 1, unit_price: 10000, discount_line: 10000 });
    expect(getCartLineNetSubtotal(line)).toBeGreaterThanOrEqual(0);
  });
});

// ─── getCartLineTotalDiscountAmount ───────────────────────────────────────
describe('getCartLineTotalDiscountAmount', () => {
  it('suma descuento de línea + global', () => {
    const line = cartLine({ discount_line: 10000, discount_global: 5000 });
    expect(getCartLineTotalDiscountAmount(line)).toBe(15000);
  });

  it('solo descuento de línea', () => {
    expect(getCartLineTotalDiscountAmount(cartLine({ discount_line: 7000 }))).toBe(7000);
  });

  it('solo descuento global', () => {
    expect(getCartLineTotalDiscountAmount(cartLine({ discount_global: 4000 }))).toBe(4000);
  });
});

// ─── allocateGlobalDiscountAcrossLines ────────────────────────────────────
describe('allocateGlobalDiscountAcrossLines', () => {
  it('distribuye en proporción a los subtotales netos', () => {
    // A=60000, B=40000 → total=100000, descuento=20000 → A=12000, B=8000
    const lines = [
      cartLine({ quantity: 1, unit_price: 60000 }),
      cartLine({ quantity: 1, unit_price: 40000 }),
    ];
    const result = allocateGlobalDiscountAcrossLines(lines, 20000);
    expect(result.appliedAmount).toBe(20000);
    expect(result.allocations[0].amount).toBe(12000);
    expect(result.allocations[1].amount).toBe(8000);
  });

  it('tres líneas con pesos distintos — suma exacta', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 60000 }),
      cartLine({ quantity: 1, unit_price: 30000 }),
      cartLine({ quantity: 1, unit_price: 10000 }),
    ];
    const result = allocateGlobalDiscountAcrossLines(lines, 10000);
    expect(result.allocations[0].amount).toBe(6000);
    expect(result.allocations[1].amount).toBe(3000);
    expect(result.allocations[2].amount).toBe(1000);
  });

  it('la suma de allocations siempre iguala appliedAmount (sin residuo perdido)', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 33333 }),
      cartLine({ quantity: 1, unit_price: 33333 }),
      cartLine({ quantity: 1, unit_price: 33334 }),
    ];
    const result = allocateGlobalDiscountAcrossLines(lines, 9999);
    const total = result.allocations.reduce((s, a) => s + a.amount, 0);
    expect(total).toBe(result.appliedAmount);
  });

  it('capea el descuento al valor total de la factura', () => {
    const lines = [cartLine({ quantity: 1, unit_price: 30000 })];
    const result = allocateGlobalDiscountAcrossLines(lines, 99999);
    expect(result.capped).toBe(true);
    expect(result.appliedAmount).toBe(30000);
  });

  it('lista vacía — appliedAmount 0', () => {
    const result = allocateGlobalDiscountAcrossLines([], 5000);
    expect(result.appliedAmount).toBe(0);
  });

  it('líneas con descuentos previos — distribuye sobre el neto', () => {
    // Neto A = 40000 (tenía desc 10000), neto B = 60000
    const lines = [
      cartLine({ quantity: 1, unit_price: 50000, discount_line: 10000 }),
      cartLine({ quantity: 1, unit_price: 60000 }),
    ];
    const result = allocateGlobalDiscountAcrossLines(lines, 20000);
    expect(result.allocations[0].amount).toBe(8000);
    expect(result.allocations[1].amount).toBe(12000);
  });
});

// ─── validateCartDiscounts ─────────────────────────────────────────────────
describe('validateCartDiscounts', () => {
  it('carrito sin descuentos es válido', () => {
    expect(validateCartDiscounts([cartLine(), cartLine()]).valid).toBe(true);
  });

  it('descuento de línea exactamente igual al subtotal es válido', () => {
    const line = cartLine({ quantity: 1, unit_price: 50000, discount_line: 50000 });
    expect(validateCartDiscounts([line]).valid).toBe(true);
  });

  it('carrito vacío es válido', () => {
    expect(validateCartDiscounts([]).valid).toBe(true);
  });

  it('una línea inválida invalida todo el carrito', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 50000 }),
      { ...cartLine({ quantity: 1, unit_price: 10000 }), discount_line: 20000, discount_line_type: 'AMOUNT' },
    ];
    expect(validateCartDiscounts(lines).valid).toBe(false);
  });

  it('descuento PERCENT válido es válido', () => {
    const line = cartLine({ discount_line: 50, discount_line_type: 'PERCENT' });
    expect(validateCartDiscounts([line]).valid).toBe(true);
  });
});

// ─── validateSalePayloadDiscounts ─────────────────────────────────────────
describe('validateSalePayloadDiscounts — payload para sp_create_sale', () => {
  it('payload válido', () => {
    const lines = [{ qty: 1, unit_price: 50000, discount: 5000, discount_type: 'AMOUNT' }];
    expect(validateSalePayloadDiscounts(lines).valid).toBe(true);
  });

  it('payload vacío es válido', () => {
    expect(validateSalePayloadDiscounts([]).valid).toBe(true);
  });

  it('descuento inválido es inválido', () => {
    const lines = [{ qty: 1, unit_price: 10000, discount: 20000, discount_type: 'AMOUNT' }];
    expect(validateSalePayloadDiscounts(lines).valid).toBe(false);
  });
});

// ─── getMaxGlobalDiscountAmount ────────────────────────────────────────────
describe('getMaxGlobalDiscountAmount', () => {
  it('suma de subtotales netos', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 100000, discount_line: 10000 }),
      cartLine({ quantity: 2, unit_price: 50000 }),
    ];
    expect(getMaxGlobalDiscountAmount(lines)).toBe(190000);
  });

  it('lista vacía devuelve 0', () => {
    expect(getMaxGlobalDiscountAmount([])).toBe(0);
  });
});

// ─── summarizeCartTotals ───────────────────────────────────────────────────
describe('summarizeCartTotals', () => {
  it('carrito vacío devuelve todo en cero', () => {
    const t = summarizeCartTotals([]);
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
    expect(t.tax).toBe(0);
  });

  it('acumula correctamente descuentos e impuestos', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 100000, discount_line: 10000, tax_amount: 17100, line_total: 107100, base_amount: 90000, tax_code: 'IVA', tax_name: 'IVA 19%' }),
      cartLine({ quantity: 3, unit_price: 20000,  discount_line: 0,     tax_amount: 11400, line_total: 71400,  base_amount: 60000, tax_code: 'IVA', tax_name: 'IVA 19%' }),
    ];
    const t = summarizeCartTotals(lines);
    expect(t.discountLine).toBe(10000);
    expect(t.tax).toBe(28500);
    expect(t.total).toBe(178500);
  });

  it('dos tax_codes distintos se agrupan por separado en taxDetails', () => {
    const lines = [
      cartLine({ tax_amount: 19000, tax_code: 'IVA19', tax_name: 'IVA 19%', base_amount: 100000, line_total: 119000 }),
      cartLine({ unit_price: 200000, tax_amount: 10000, tax_code: 'IVA5', tax_name: 'IVA 5%', base_amount: 200000, line_total: 210000 }),
    ];
    const t = summarizeCartTotals(lines);
    expect(t.taxDetails.size).toBe(2);
    expect(t.taxDetails.get('IVA19').amount).toBe(19000);
    expect(t.taxDetails.get('IVA5').amount).toBe(10000);
  });

  it('descuento global se suma en totals.discountGlobal', () => {
    const lines = [cartLine({ discount_global: 5000, base_amount: 50000, line_total: 50000 })];
    const t = summarizeCartTotals(lines);
    expect(t.discountGlobal).toBe(5000);
    expect(t.discount).toBe(5000);
  });

  it('sin impuesto taxLabel es "Impuestos" por defecto', () => {
    const t = summarizeCartTotals([cartLine()]);
    expect(t.taxLabel).toBe('Impuestos');
  });
});

// ─── buildSalePayloadLines ─────────────────────────────────────────────────
describe('buildSalePayloadLines — payload para sp_create_sale', () => {
  it('genera campos requeridos', () => {
    const lines = [cartLine({ variant_id: 'v-abc', quantity: 3, unit_price: 20000 })];
    const [p] = buildSalePayloadLines(lines);
    expect(p.variant_id).toBe('v-abc');
    expect(p.qty).toBe(3);
    expect(p.unit_price).toBe(20000);
    expect(p.discount_type).toBe('AMOUNT');
  });

  it('array vacío devuelve array vacío', () => {
    expect(buildSalePayloadLines([])).toHaveLength(0);
  });

  it('preserva todas las líneas del carrito', () => {
    const lines = [cartLine({ variant_id: 'v1' }), cartLine({ variant_id: 'v2' })];
    expect(buildSalePayloadLines(lines)).toHaveLength(2);
  });

  it('price_includes_tax: el SP recibe el precio base sin IVA', () => {
    // El cajero ve 119000 (IVA incluido) — el SP debe recibir la base ~100000
    const lines = [cartLine({
      variant_id: 'v-iva',
      unit_price: 119000,
      tax_rate: 0.19,
      price_includes_tax: true,
    })];
    const [p] = buildSalePayloadLines(lines);
    expect(p.unit_price).toBe(Math.round(119000 / 1.19));
  });

  it('price_includes_tax: el descuento también se divide por el factor', () => {
    const factor = 1.19;
    const lines = [cartLine({
      variant_id: 'v-iva',
      unit_price: 119000,
      discount_line: 11900,
      discount_line_type: 'AMOUNT',
      discount_global: 0,
      tax_rate: 0.19,
      price_includes_tax: true,
    })];
    const [p] = buildSalePayloadLines(lines);
    expect(p.discount).toBe(Math.round(11900 / factor));
  });

  it('sin price_includes_tax el unit_price llega intacto', () => {
    const lines = [cartLine({ unit_price: 50000, tax_rate: 0.19, price_includes_tax: false })];
    const [p] = buildSalePayloadLines(lines);
    expect(p.unit_price).toBe(50000);
  });

  it('discount_type siempre es AMOUNT en el payload', () => {
    const lines = [cartLine({ discount_line: 10, discount_line_type: 'PERCENT', unit_price: 100000 })];
    const [p] = buildSalePayloadLines(lines);
    expect(p.discount_type).toBe('AMOUNT');
  });
});
