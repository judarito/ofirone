import { describe, it, expect } from 'vitest'
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
} from '../saleCalculator'

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
  const subtotal = quantity * unit_price
  return {
    variant_id,
    quantity,
    unit_price,
    discount_line,
    discount_line_type,
    discount_global,
    base_amount: base_amount ?? subtotal,
    tax_amount,
    tax_rate,
    tax_code,
    tax_name,
    line_total: line_total ?? subtotal,
    price_includes_tax,
  }
}

// ─── getDocumentLineSubtotal ───────────────────────────────────────────────
describe('getDocumentLineSubtotal', () => {
  it('multiplica cantidad por precio', () => {
    expect(getDocumentLineSubtotal({ quantity: 3, unit_price: 15000 })).toBe(45000)
  })

  it('devuelve 0 si cantidad es 0', () => {
    expect(getDocumentLineSubtotal({ quantity: 0, unit_price: 50000 })).toBe(0)
  })

  it('devuelve 0 si la línea está vacía', () => {
    expect(getDocumentLineSubtotal({})).toBe(0)
  })

  it('soporta campos personalizados', () => {
    const result = getDocumentLineSubtotal(
      { qty: 2, cost: 30000 },
      { quantityField: 'qty', unitPriceField: 'cost' },
    )
    expect(result).toBe(60000)
  })

  it('devuelve 0 para valores no numéricos', () => {
    expect(getDocumentLineSubtotal({ quantity: 'dos', unit_price: 10000 })).toBe(0)
  })

  it('nunca devuelve negativo (Math.max(0, ...))', () => {
    // precio negativo no tiene sentido operativo
    expect(getDocumentLineSubtotal({ quantity: 2, unit_price: -5000 })).toBeGreaterThanOrEqual(0)
  })
})

// ─── normalizeLineDiscountInput ────────────────────────────────────────────
describe('normalizeLineDiscountInput', () => {
  it('descuento AMOUNT dentro del subtotal es válido y no se ajusta', () => {
    const result = normalizeLineDiscountInput(100000, 20000, 'AMOUNT')
    expect(result.valid).toBe(true)
    expect(result.adjusted).toBe(false)
    expect(result.sanitizedValue).toBe(20000)
  })

  it('descuento AMOUNT mayor que subtotal se ajusta al máximo', () => {
    const result = normalizeLineDiscountInput(50000, 80000, 'AMOUNT')
    expect(result.sanitizedValue).toBe(50000)
    expect(result.adjusted).toBe(true)
  })

  it('descuento PERCENT > 100 se ajusta a 100', () => {
    const result = normalizeLineDiscountInput(50000, 120, 'PERCENT')
    expect(result.sanitizedValue).toBe(100)
    expect(result.adjusted).toBe(true)
  })

  it('descuento PERCENT exactamente 100 — válido, no se ajusta', () => {
    const result = normalizeLineDiscountInput(50000, 100, 'PERCENT')
    expect(result.valid).toBe(true)
    expect(result.adjusted).toBe(false)
    expect(result.sanitizedValue).toBe(100)
  })

  it('descuento negativo se normaliza a 0', () => {
    const result = normalizeLineDiscountInput(50000, -500, 'AMOUNT')
    expect(result.sanitizedValue).toBe(0)
  })

  it('devuelve el subtotal en la respuesta', () => {
    const result = normalizeLineDiscountInput(80000, 10000, 'AMOUNT')
    expect(result.subtotal).toBe(80000)
  })

  it('devuelve discountType en la respuesta', () => {
    const result = normalizeLineDiscountInput(80000, 10, 'PERCENT')
    expect(result.discountType).toBe('PERCENT')
  })

  it('descuento 0 — válido, no se ajusta, sanitizedValue 0', () => {
    const result = normalizeLineDiscountInput(50000, 0, 'AMOUNT')
    expect(result.valid).toBe(true)
    expect(result.sanitizedValue).toBe(0)
    expect(result.adjusted).toBe(false)
  })
})

// ─── getCartLineDiscountAmount ─────────────────────────────────────────────
describe('getCartLineDiscountAmount', () => {
  it('sin descuento devuelve 0', () => {
    expect(getCartLineDiscountAmount(cartLine())).toBe(0)
  })

  it('descuento AMOUNT', () => {
    expect(getCartLineDiscountAmount(cartLine({ quantity: 2, unit_price: 50000, discount_line: 5000 }))).toBe(5000)
  })

  it('descuento PERCENT 10%', () => {
    expect(
      getCartLineDiscountAmount(cartLine({ quantity: 1, unit_price: 100000, discount_line: 10, discount_line_type: 'PERCENT' })),
    ).toBe(10000)
  })

  it('descuento PERCENT 100% — descuenta el subtotal completo', () => {
    const line = cartLine({ quantity: 2, unit_price: 30000, discount_line: 100, discount_line_type: 'PERCENT' })
    expect(getCartLineDiscountAmount(line)).toBe(60000)
  })

  it('descuento AMOUNT que excede el subtotal se clampea al subtotal', () => {
    const line = cartLine({ quantity: 1, unit_price: 10000, discount_line: 50000 })
    // normalizeLineDiscountInput clampea al subtotal: 10000
    expect(getCartLineDiscountAmount(line)).toBe(10000)
  })
})

// ─── getCartLineGlobalDiscountAmount ──────────────────────────────────────
describe('getCartLineGlobalDiscountAmount', () => {
  it('sin descuento global devuelve 0', () => {
    expect(getCartLineGlobalDiscountAmount(cartLine())).toBe(0)
  })

  it('devuelve el monto del descuento global prorrateado ya aplicado', () => {
    const line = cartLine({ discount_global: 8000 })
    expect(getCartLineGlobalDiscountAmount(line)).toBe(8000)
  })

  it('nunca devuelve negativo', () => {
    const line = cartLine({ discount_global: -3000 })
    expect(getCartLineGlobalDiscountAmount(line)).toBeGreaterThanOrEqual(0)
  })
})

// ─── getCartLineTotalDiscountAmount ───────────────────────────────────────
describe('getCartLineTotalDiscountAmount', () => {
  it('suma descuento de línea + descuento global prorrateado', () => {
    const line = cartLine({ quantity: 1, unit_price: 100000, discount_line: 10000, discount_global: 5000 })
    expect(getCartLineTotalDiscountAmount(line)).toBe(15000)
  })

  it('solo descuento de línea, sin global', () => {
    const line = cartLine({ discount_line: 7000 })
    expect(getCartLineTotalDiscountAmount(line)).toBe(7000)
  })

  it('solo descuento global, sin descuento de línea', () => {
    const line = cartLine({ discount_global: 4000 })
    expect(getCartLineTotalDiscountAmount(line)).toBe(4000)
  })
})

// ─── getCartLineNetSubtotal ────────────────────────────────────────────────
describe('getCartLineNetSubtotal', () => {
  it('subtotal neto = subtotal bruto - descuento de línea', () => {
    const line = cartLine({ quantity: 2, unit_price: 50000, discount_line: 10000 })
    expect(getCartLineNetSubtotal(line)).toBe(90000)
  })

  it('nunca es negativo', () => {
    const line = cartLine({ quantity: 1, unit_price: 10000, discount_line: 10000 })
    expect(getCartLineNetSubtotal(line)).toBeGreaterThanOrEqual(0)
  })

  it('sin descuento es igual al subtotal bruto', () => {
    const line = cartLine({ quantity: 3, unit_price: 20000 })
    expect(getCartLineNetSubtotal(line)).toBe(60000)
  })

  it('con descuento PERCENT', () => {
    const line = cartLine({ quantity: 1, unit_price: 80000, discount_line: 25, discount_line_type: 'PERCENT' })
    expect(getCartLineNetSubtotal(line)).toBe(60000)
  })
})

// ─── allocateGlobalDiscountAcrossLines ────────────────────────────────────
describe('allocateGlobalDiscountAcrossLines', () => {
  it('sin líneas devuelve allocations vacío', () => {
    const result = allocateGlobalDiscountAcrossLines([], 5000)
    expect(result.allocations).toHaveLength(0)
    expect(result.appliedAmount).toBe(0)
  })

  it('distribuye proporcionalmente entre dos líneas iguales', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 50000 }),
      cartLine({ quantity: 1, unit_price: 50000 }),
    ]
    const result = allocateGlobalDiscountAcrossLines(lines, 20000)
    expect(result.appliedAmount).toBe(20000)
    expect(result.capped).toBe(false)
    const total = result.allocations.reduce((s, a) => s + a.amount, 0)
    expect(total).toBe(20000)
    expect(result.allocations[0].amount).toBe(10000)
    expect(result.allocations[1].amount).toBe(10000)
  })

  it('distribuye proporcionalmente entre tres líneas con pesos distintos', () => {
    // A=60000, B=30000, C=10000 → total=100000
    // Descuento 10000 → A=6000, B=3000, C=1000
    const lines = [
      cartLine({ quantity: 1, unit_price: 60000 }),
      cartLine({ quantity: 1, unit_price: 30000 }),
      cartLine({ quantity: 1, unit_price: 10000 }),
    ]
    const result = allocateGlobalDiscountAcrossLines(lines, 10000)
    expect(result.appliedAmount).toBe(10000)
    expect(result.allocations[0].amount).toBe(6000)
    expect(result.allocations[1].amount).toBe(3000)
    expect(result.allocations[2].amount).toBe(1000)
  })

  it('la última línea absorbe cualquier residuo de redondeo', () => {
    // 3 líneas idénticas, descuento 10000 → no es divisible por 3 exactamente
    const lines = [
      cartLine({ quantity: 1, unit_price: 33333 }),
      cartLine({ quantity: 1, unit_price: 33333 }),
      cartLine({ quantity: 1, unit_price: 33334 }),
    ]
    const result = allocateGlobalDiscountAcrossLines(lines, 9999)
    const totalAllocated = result.allocations.reduce((s, a) => s + a.amount, 0)
    // La suma total debe ser exactamente el appliedAmount
    expect(totalAllocated).toBe(result.appliedAmount)
  })

  it('capea al valor neto de la factura', () => {
    const lines = [cartLine({ quantity: 1, unit_price: 30000 })]
    const result = allocateGlobalDiscountAcrossLines(lines, 50000)
    expect(result.capped).toBe(true)
    expect(result.appliedAmount).toBe(30000)
  })

  it('descuento 0 — allocations todas en 0', () => {
    const lines = [cartLine({ quantity: 2, unit_price: 40000 })]
    const result = allocateGlobalDiscountAcrossLines(lines, 0)
    expect(result.allocations[0].amount).toBe(0)
    expect(result.capped).toBe(false)
  })

  it('líneas con descuentos de línea previos — distribuye sobre el neto, no el bruto', () => {
    // Neto línea A = 40000 (tenía descuento de 10000), neto línea B = 60000
    const lines = [
      cartLine({ quantity: 1, unit_price: 50000, discount_line: 10000 }),
      cartLine({ quantity: 1, unit_price: 60000 }),
    ]
    const result = allocateGlobalDiscountAcrossLines(lines, 20000)
    // Base total neta = 40000 + 60000 = 100000
    // A recibe 20000*(40000/100000) = 8000, B recibe 12000
    expect(result.allocations[0].amount).toBe(8000)
    expect(result.allocations[1].amount).toBe(12000)
  })
})

// ─── validateCartDiscounts ─────────────────────────────────────────────────
describe('validateCartDiscounts', () => {
  it('líneas sin descuento son válidas', () => {
    const lines = [cartLine(), cartLine({ quantity: 2, unit_price: 30000 })]
    expect(validateCartDiscounts(lines).valid).toBe(true)
  })

  it('descuento de línea igual al subtotal es válido', () => {
    const line = cartLine({ quantity: 1, unit_price: 50000, discount_line: 50000 })
    expect(validateCartDiscounts([line]).valid).toBe(true)
  })

  it('descuento de línea mayor que subtotal es inválido', () => {
    const line = { ...cartLine({ quantity: 1, unit_price: 50000 }), discount_line: 60000, discount_line_type: 'AMOUNT' }
    expect(validateCartDiscounts([line]).valid).toBe(false)
  })

  it('lista vacía es válida', () => {
    expect(validateCartDiscounts([]).valid).toBe(true)
  })

  it('descuento PERCENT válido (<=100)', () => {
    const line = cartLine({ quantity: 1, unit_price: 80000, discount_line: 50, discount_line_type: 'PERCENT' })
    expect(validateCartDiscounts([line]).valid).toBe(true)
  })

  it('si una línea es inválida el carrito completo es inválido', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 50000 }),
      { ...cartLine({ quantity: 1, unit_price: 10000 }), discount_line: 20000, discount_line_type: 'AMOUNT' },
    ]
    const result = validateCartDiscounts(lines)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('devuelve mensaje de error cuando es inválido', () => {
    const line = { ...cartLine({ quantity: 1, unit_price: 50000 }), discount_line: 60000, discount_line_type: 'AMOUNT' }
    const result = validateCartDiscounts([line])
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(0)
  })
})

// ─── validateSalePayloadDiscounts ─────────────────────────────────────────
describe('validateSalePayloadDiscounts', () => {
  it('payload con campo qty/discount es válido', () => {
    const lines = [{ qty: 1, unit_price: 50000, discount: 5000, discount_type: 'AMOUNT' }]
    expect(validateSalePayloadDiscounts(lines).valid).toBe(true)
  })

  it('payload vacío es válido', () => {
    expect(validateSalePayloadDiscounts([]).valid).toBe(true)
  })

  it('payload con descuento inválido es inválido', () => {
    const lines = [{ qty: 1, unit_price: 10000, discount: 20000, discount_type: 'AMOUNT' }]
    expect(validateSalePayloadDiscounts(lines).valid).toBe(false)
  })

  it('múltiples líneas válidas son válidas', () => {
    const lines = [
      { qty: 2, unit_price: 30000, discount: 0, discount_type: 'AMOUNT' },
      { qty: 1, unit_price: 80000, discount: 8000, discount_type: 'AMOUNT' },
    ]
    expect(validateSalePayloadDiscounts(lines).valid).toBe(true)
  })
})

// ─── getMaxGlobalDiscountAmount ────────────────────────────────────────────
describe('getMaxGlobalDiscountAmount', () => {
  it('es la suma de subtotales netos de todas las líneas', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 100000, discount_line: 10000 }),
      cartLine({ quantity: 2, unit_price: 50000, discount_line: 0 }),
    ]
    expect(getMaxGlobalDiscountAmount(lines)).toBe(190000)
  })

  it('líneas vacías devuelven 0', () => {
    expect(getMaxGlobalDiscountAmount([])).toBe(0)
  })

  it('considera los descuentos de línea ya aplicados', () => {
    // Neto = 50000 - 20000 = 30000
    const lines = [cartLine({ quantity: 1, unit_price: 50000, discount_line: 20000 })]
    expect(getMaxGlobalDiscountAmount(lines)).toBe(30000)
  })
})

// ─── summarizeCartTotals ───────────────────────────────────────────────────
describe('summarizeCartTotals', () => {
  it('suma correctamente subtotales, descuentos e impuestos', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 100000, discount_line: 5000, tax_amount: 17860, line_total: 112860, base_amount: 95000, tax_code: 'IVA', tax_name: 'IVA 19%' }),
      cartLine({ quantity: 2, unit_price: 30000, discount_line: 0, tax_amount: 11400, line_total: 71400, base_amount: 60000, tax_code: 'IVA', tax_name: 'IVA 19%' }),
    ]
    const totals = summarizeCartTotals(lines)
    expect(totals.discountLine).toBe(5000)
    expect(totals.tax).toBe(29260)
    expect(totals.total).toBe(184260)
  })

  it('lista vacía devuelve todo en cero', () => {
    const totals = summarizeCartTotals([])
    expect(totals.subtotal).toBe(0)
    expect(totals.total).toBe(0)
    expect(totals.tax).toBe(0)
    expect(totals.discount).toBe(0)
  })

  it('acumula correctamente dos tax_codes distintos en taxDetails', () => {
    const lines = [
      cartLine({ tax_amount: 19000, tax_code: 'IVA19', tax_name: 'IVA 19%', base_amount: 100000, line_total: 119000 }),
      cartLine({ unit_price: 200000, tax_amount: 10000, tax_code: 'IVA5', tax_name: 'IVA 5%', base_amount: 200000, line_total: 210000 }),
    ]
    const totals = summarizeCartTotals(lines)
    expect(totals.taxDetails.size).toBe(2)
    expect(totals.taxDetails.get('IVA19').amount).toBe(19000)
    expect(totals.taxDetails.get('IVA5').amount).toBe(10000)
  })

  it('suma correctamente descuento global', () => {
    const lines = [
      cartLine({ quantity: 1, unit_price: 100000, discount_global: 5000, base_amount: 100000, line_total: 100000 }),
    ]
    const totals = summarizeCartTotals(lines)
    expect(totals.discountGlobal).toBe(5000)
    expect(totals.discount).toBe(5000) // discountLine + discountGlobal
  })

  it('sin impuesto — taxLabel por defecto es "Impuestos"', () => {
    const lines = [cartLine({ tax_amount: 0, line_total: 50000, base_amount: 50000 })]
    const totals = summarizeCartTotals(lines)
    expect(totals.taxLabel).toBe('Impuestos')
  })

  it('devuelve todos los campos esperados', () => {
    const totals = summarizeCartTotals([])
    expect(totals).toHaveProperty('subtotal')
    expect(totals).toHaveProperty('discountLine')
    expect(totals).toHaveProperty('discountGlobal')
    expect(totals).toHaveProperty('discount')
    expect(totals).toHaveProperty('tax')
    expect(totals).toHaveProperty('taxLabel')
    expect(totals).toHaveProperty('taxDetails')
    expect(totals).toHaveProperty('total')
  })
})

// ─── buildSalePayloadLines ─────────────────────────────────────────────────
describe('buildSalePayloadLines', () => {
  it('genera el payload mínimo con variant_id, qty, unit_price', () => {
    const lines = [cartLine({ variant_id: 'abc', quantity: 2, unit_price: 50000 })]
    const payload = buildSalePayloadLines(lines)
    expect(payload[0].variant_id).toBe('abc')
    expect(payload[0].qty).toBe(2)
    expect(payload[0].unit_price).toBe(50000)
    expect(payload[0].discount_type).toBe('AMOUNT')
  })

  it('array vacío devuelve array vacío', () => {
    expect(buildSalePayloadLines([])).toHaveLength(0)
  })

  it('preserva todas las líneas', () => {
    const lines = [cartLine({ variant_id: 'v1' }), cartLine({ variant_id: 'v2' }), cartLine({ variant_id: 'v3' })]
    expect(buildSalePayloadLines(lines)).toHaveLength(3)
  })

  it('discount_type siempre es AMOUNT en el payload', () => {
    // El SP maneja solo AMOUNT — los PERCENT se convierten antes
    const lines = [cartLine({ discount_line: 10, discount_line_type: 'PERCENT', unit_price: 100000 })]
    const [p] = buildSalePayloadLines(lines)
    expect(p.discount_type).toBe('AMOUNT')
  })

  it('price_includes_tax: descompone unit_price antes de enviar al backend', () => {
    // El cajero ve 119000 (IVA incluido) — el SP debe recibir la base ~100000
    const lines = [{
      variant_id: 'xyz',
      quantity: 1,
      unit_price: 119000,
      discount_line: 0,
      discount_line_type: 'AMOUNT',
      discount_global: 0,
      tax_rate: 0.19,
      price_includes_tax: true,
    }]
    const [p] = buildSalePayloadLines(lines)
    expect(p.unit_price).toBe(Math.round(119000 / 1.19))
  })

  it('price_includes_tax: el descuento también se divide por el factor', () => {
    // Si el descuento es sobre precio-con-IVA, el SP recibe el descuento sobre la base
    const factor = 1.19
    const lines = [{
      variant_id: 'xyz',
      quantity: 1,
      unit_price: 119000,
      discount_line: 11900, // 10% de 119000 (precio con IVA)
      discount_line_type: 'AMOUNT',
      discount_global: 0,
      tax_rate: 0.19,
      price_includes_tax: true,
    }]
    const [p] = buildSalePayloadLines(lines)
    // El descuento también se ajusta a la base
    expect(p.discount).toBe(Math.round(11900 / factor))
  })

  it('sin price_includes_tax el unit_price llega sin modificar', () => {
    const lines = [{
      variant_id: 'v1',
      quantity: 1,
      unit_price: 50000,
      discount_line: 0,
      discount_line_type: 'AMOUNT',
      discount_global: 0,
      tax_rate: 0.19,
      price_includes_tax: false,
    }]
    const [p] = buildSalePayloadLines(lines)
    expect(p.unit_price).toBe(50000)
  })
})
