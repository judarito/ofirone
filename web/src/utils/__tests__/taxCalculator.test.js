import { describe, it, expect } from 'vitest'
import { applyLineTaxes } from '../taxCalculator'

function makeLine(overrides = {}) {
  return {
    price_includes_tax: false,
    tax_rate: 0,
    tax_code: null,
    tax_name: null,
    base_amount: 0,
    tax_amount: 0,
    line_total: 0,
    ...overrides,
  }
}

// ─── sin impuesto ─────────────────────────────────────────────────────────
describe('applyLineTaxes — sin impuesto configurado', () => {
  it('asigna la base y el total como el precio, impuesto 0', () => {
    const line = makeLine()
    applyLineTaxes(line, { success: false }, 50000)
    expect(line.base_amount).toBe(50000)
    expect(line.tax_amount).toBe(0)
    expect(line.line_total).toBe(50000)
    expect(line.tax_rate).toBe(0)
    expect(line.tax_code).toBeNull()
  })

  it('muta el objeto in-place — misma referencia', () => {
    const line = makeLine()
    const ref = line
    applyLineTaxes(line, { success: false }, 30000)
    expect(line).toBe(ref)
    expect(line.base_amount).toBe(30000)
  })

  it('tax_rate=0 con success=true — se comporta como sin impuesto', () => {
    const line = makeLine()
    applyLineTaxes(line, { success: true, rate: 0, code: 'IVA0', name: 'Exento' }, 40000)
    // rate=0 → la condición "if (taxResult.success && taxResult.rate)" es falsa
    expect(line.tax_amount).toBe(0)
    expect(line.line_total).toBe(40000)
  })
})

// ─── IVA adicional ────────────────────────────────────────────────────────
describe('applyLineTaxes — IVA adicional (price_includes_tax = false)', () => {
  it('calcula IVA 19% sobre la base', () => {
    const line = makeLine({ price_includes_tax: false })
    applyLineTaxes(line, { success: true, rate: 0.19, code: 'IVA', name: 'IVA 19%' }, 100000)
    expect(line.tax_rate).toBe(0.19)
    expect(line.tax_code).toBe('IVA')
    expect(line.tax_name).toBe('IVA 19%')
    expect(line.base_amount).toBe(100000)
    expect(line.tax_amount).toBe(19000)
    expect(line.line_total).toBe(119000)
  })

  it('IVA 5% — bien de la canasta familiar', () => {
    const line = makeLine({ price_includes_tax: false })
    applyLineTaxes(line, { success: true, rate: 0.05, code: 'IVA5', name: 'IVA 5%' }, 200000)
    expect(line.tax_amount).toBe(10000)
    expect(line.line_total).toBe(210000)
  })

  it('consistencia: base_amount + tax_amount === line_total', () => {
    const line = makeLine({ price_includes_tax: false })
    applyLineTaxes(line, { success: true, rate: 0.19, code: 'IVA', name: 'IVA 19%' }, 73500)
    expect(line.base_amount + line.tax_amount).toBe(line.line_total)
  })

  it('precio bajo con IVA 19% — redondeo correcto', () => {
    const line = makeLine({ price_includes_tax: false })
    applyLineTaxes(line, { success: true, rate: 0.19, code: 'IVA', name: 'IVA 19%' }, 1000)
    // 1000 * 0.19 = 190 → line_total = 1190
    expect(line.line_total).toBe(1190)
  })
})

// ─── precio incluye IVA ───────────────────────────────────────────────────
describe('applyLineTaxes — precio incluye IVA (price_includes_tax = true)', () => {
  it('descompone IVA 19% desde el precio total', () => {
    const line = makeLine({ price_includes_tax: true })
    // Precio de venta = 119000 (ya incluye IVA 19%)
    applyLineTaxes(line, { success: true, rate: 0.19, code: 'IVA', name: 'IVA 19%' }, 119000)
    expect(line.base_amount).toBe(Math.round(119000 / 1.19))
    expect(line.line_total).toBe(119000)
    expect(line.tax_amount).toBe(119000 - line.base_amount)
  })

  it('IVA incluido 5%', () => {
    const line = makeLine({ price_includes_tax: true })
    applyLineTaxes(line, { success: true, rate: 0.05, code: 'IVA5', name: 'IVA 5%' }, 105000)
    expect(line.base_amount).toBe(Math.round(105000 / 1.05))
    expect(line.line_total).toBe(105000)
  })

  it('consistencia: base_amount + tax_amount === line_total siempre', () => {
    const line = makeLine({ price_includes_tax: true })
    applyLineTaxes(line, { success: true, rate: 0.19, code: 'IVA', name: 'IVA 19%' }, 59500)
    expect(line.base_amount + line.tax_amount).toBe(line.line_total)
  })

  it('fija tax_code y tax_name en la línea', () => {
    const line = makeLine({ price_includes_tax: true })
    applyLineTaxes(line, { success: true, rate: 0.19, code: 'IVA_COL', name: 'IVA Colombia 19%' }, 119000)
    expect(line.tax_code).toBe('IVA_COL')
    expect(line.tax_name).toBe('IVA Colombia 19%')
    expect(line.tax_rate).toBe(0.19)
  })
})
