import { describe, it, expect } from 'vitest'
import {
  calculateDiscount,
  validateDiscount,
  calculateLineTotal,
  convertDiscountType,
  formatDiscount,
  DiscountType,
} from '../discountCalculator'

// ─── calculateDiscount ────────────────────────────────────────────────────
describe('calculateDiscount', () => {
  describe('AMOUNT', () => {
    it('devuelve el descuento fijo', () => {
      expect(calculateDiscount(50000, 5000, 'AMOUNT')).toBe(5000)
    })

    it('descuento igual al subtotal devuelve el subtotal', () => {
      expect(calculateDiscount(20000, 20000, 'AMOUNT')).toBe(20000)
    })

    it('descuento cero devuelve 0', () => {
      expect(calculateDiscount(50000, 0, 'AMOUNT')).toBe(0)
    })

    it('descuento negativo devuelve 0', () => {
      expect(calculateDiscount(50000, -100, 'AMOUNT')).toBe(0)
    })

    it('lanza si el descuento supera el subtotal', () => {
      expect(() => calculateDiscount(10000, 15000, 'AMOUNT')).toThrow()
    })

    it('redondea a 2 decimales', () => {
      // 33333 * 1 = 33333 (exacto, solo verifica que no haya decimales extra)
      expect(calculateDiscount(50000, 33333, 'AMOUNT')).toBe(33333)
    })
  })

  describe('PERCENT', () => {
    it('calcula porcentaje correctamente', () => {
      expect(calculateDiscount(100000, 10, 'PERCENT')).toBe(10000)
    })

    it('19% sobre 84034 — caso IVA colombia', () => {
      // 84034 * 0.19 = 15966.46 → redondeado a 2 decimales
      expect(calculateDiscount(84034, 19, 'PERCENT')).toBe(15966.46)
    })

    it('100% devuelve el subtotal completo', () => {
      expect(calculateDiscount(50000, 100, 'PERCENT')).toBe(50000)
    })

    it('lanza si supera 100%', () => {
      expect(() => calculateDiscount(50000, 101, 'PERCENT')).toThrow()
    })

    it('5% — bien de canasta familiar', () => {
      expect(calculateDiscount(200000, 5, 'PERCENT')).toBe(10000)
    })

    it('0% devuelve 0', () => {
      expect(calculateDiscount(80000, 0, 'PERCENT')).toBe(0)
    })
  })

  it('tipo por defecto es AMOUNT', () => {
    expect(calculateDiscount(30000, 3000)).toBe(3000)
  })

  it('tipo inválido lanza error', () => {
    expect(() => calculateDiscount(50000, 5000, 'UNKNOWN')).toThrow()
  })

  it('subtotal 0 con descuento 0 devuelve 0', () => {
    expect(calculateDiscount(0, 0, 'PERCENT')).toBe(0)
  })
})

// ─── validateDiscount ─────────────────────────────────────────────────────
describe('validateDiscount', () => {
  it('descuento 0 es siempre válido', () => {
    expect(validateDiscount(50000, 0).valid).toBe(true)
  })

  it('AMOUNT dentro del subtotal es válido', () => {
    expect(validateDiscount(50000, 25000, 'AMOUNT').valid).toBe(true)
  })

  it('AMOUNT exactamente igual al subtotal es válido', () => {
    expect(validateDiscount(30000, 30000, 'AMOUNT').valid).toBe(true)
  })

  it('AMOUNT mayor que subtotal es inválido', () => {
    const result = validateDiscount(50000, 60000, 'AMOUNT')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('PERCENT <= 100 es válido', () => {
    expect(validateDiscount(50000, 100, 'PERCENT').valid).toBe(true)
  })

  it('PERCENT > 100 es inválido', () => {
    const result = validateDiscount(50000, 101, 'PERCENT')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('valor negativo se trata como sin descuento — early-return en <= 0', () => {
    // El consumidor (normalizeLineDiscountInput) clampea a 0 antes de llegar aquí.
    expect(validateDiscount(50000, -1, 'AMOUNT').valid).toBe(true)
  })

  it('subtotal 0 con descuento 0 es válido', () => {
    expect(validateDiscount(0, 0, 'AMOUNT').valid).toBe(true)
  })

  it('resultado siempre tiene campo error (string o null)', () => {
    const valid   = validateDiscount(100000, 10000, 'AMOUNT')
    const invalid = validateDiscount(10000, 20000, 'AMOUNT')
    expect(valid.error).toBeNull()
    expect(typeof invalid.error).toBe('string')
  })
})

// ─── calculateLineTotal ───────────────────────────────────────────────────
describe('calculateLineTotal', () => {
  it('calcula línea sin descuento ni impuesto', () => {
    const result = calculateLineTotal({ qty: 3, unit_price: 10000 })
    expect(result.subtotal).toBe(30000)
    expect(result.discount).toBe(0)
    expect(result.tax).toBe(0)
    expect(result.total).toBe(30000)
  })

  it('calcula línea con descuento AMOUNT y IVA 19%', () => {
    const result = calculateLineTotal({
      qty: 2,
      unit_price: 50000,
      discount_value: 5000,
      discount_type: 'AMOUNT',
      tax_rate: 0.19,
    })
    expect(result.subtotal).toBe(100000)
    expect(result.discount).toBe(5000)
    expect(result.taxable_base).toBe(95000)
    expect(result.tax).toBe(18050)
    expect(result.total).toBe(113050)
  })

  it('calcula línea con descuento PERCENT', () => {
    const result = calculateLineTotal({
      qty: 1,
      unit_price: 200000,
      discount_value: 10,
      discount_type: 'PERCENT',
      tax_rate: 0,
    })
    expect(result.discount).toBe(20000)
    expect(result.total).toBe(180000)
  })

  it('qty 0 → subtotal 0, todo en cero', () => {
    const result = calculateLineTotal({ qty: 0, unit_price: 50000 })
    expect(result.subtotal).toBe(0)
    expect(result.total).toBe(0)
  })

  it('solo impuesto sin descuento — taxable_base === subtotal', () => {
    const result = calculateLineTotal({ qty: 1, unit_price: 100000, tax_rate: 0.19 })
    expect(result.taxable_base).toBe(100000)
    expect(result.tax).toBe(19000)
    expect(result.total).toBe(119000)
  })

  it('devuelve todos los campos esperados', () => {
    const result = calculateLineTotal({ qty: 1, unit_price: 10000 })
    expect(result).toHaveProperty('subtotal')
    expect(result).toHaveProperty('discount')
    expect(result).toHaveProperty('taxable_base')
    expect(result).toHaveProperty('tax')
    expect(result).toHaveProperty('total')
  })
})

// ─── convertDiscountType ──────────────────────────────────────────────────
describe('convertDiscountType', () => {
  it('AMOUNT → PERCENT', () => {
    const pct = convertDiscountType(100000, 20000, 'AMOUNT', 'PERCENT')
    expect(pct).toBe(20)
  })

  it('PERCENT → AMOUNT', () => {
    const amt = convertDiscountType(80000, 25, 'PERCENT', 'AMOUNT')
    expect(amt).toBe(20000)
  })

  it('mismo tipo devuelve el mismo valor', () => {
    expect(convertDiscountType(50000, 5000, 'AMOUNT', 'AMOUNT')).toBe(5000)
    expect(convertDiscountType(50000, 10, 'PERCENT', 'PERCENT')).toBe(10)
  })

  it('valor 0 devuelve 0 en cualquier dirección', () => {
    expect(convertDiscountType(50000, 0, 'AMOUNT', 'PERCENT')).toBe(0)
    expect(convertDiscountType(50000, 0, 'PERCENT', 'AMOUNT')).toBe(0)
  })

  it('subtotal 0 en AMOUNT → PERCENT devuelve 0 sin dividir por cero', () => {
    expect(convertDiscountType(0, 5000, 'AMOUNT', 'PERCENT')).toBe(0)
  })
})

// ─── formatDiscount ───────────────────────────────────────────────────────
describe('formatDiscount', () => {
  it('formatea AMOUNT con símbolo $ y el valor numérico', () => {
    const result = formatDiscount(5000, 'AMOUNT')
    expect(result).toMatch(/^\$/)
    expect(result).toMatch(/5.?000/) // separador de miles depende del locale del sistema
  })

  it('formatea PERCENT con signo %', () => {
    expect(formatDiscount(15, 'PERCENT')).toBe('15%')
  })

  it('descuento 0 devuelve guión', () => {
    expect(formatDiscount(0)).toBe('-')
  })

  it('descuento undefined devuelve guión', () => {
    expect(formatDiscount(undefined)).toBe('-')
  })

  it('descuento null devuelve guión', () => {
    expect(formatDiscount(null)).toBe('-')
  })

  it('PERCENT 100 devuelve 100%', () => {
    expect(formatDiscount(100, 'PERCENT')).toBe('100%')
  })
})

// ─── DiscountType ─────────────────────────────────────────────────────────
describe('DiscountType', () => {
  it('expone AMOUNT y PERCENT', () => {
    expect(DiscountType.AMOUNT).toBe('AMOUNT')
    expect(DiscountType.PERCENT).toBe('PERCENT')
  })

  it('los valores coinciden con los strings usados en las funciones', () => {
    // Garantiza que no haya typos si se usa DiscountType.AMOUNT como parámetro
    expect(calculateDiscount(10000, 1000, DiscountType.AMOUNT)).toBe(1000)
    expect(calculateDiscount(10000, 10, DiscountType.PERCENT)).toBe(1000)
  })
})
