import { describe, it, expect } from 'vitest'
import { resolveApplicableRule, applyPriceRule } from '../../../../shared/utils/pricingRuleEngine'

const VARIANT_ID   = 'variant-001'
const PRODUCT_ID   = 'product-001'
const CATEGORY_ID  = 'category-001'
const LOCATION_ID  = 'location-001'

function rule(overrides) {
  return {
    pricing_rule_id: 'rule-' + Math.random(),
    scope: 'TENANT',
    location_id: null,
    category_id: null,
    product_id: null,
    variant_id: null,
    pricing_method: 'MARKUP',
    markup_percentage: 30,
    price_rounding: 'NONE',
    rounding_to: 1,
    priority: 0,
    is_active: true,
    ...overrides,
  }
}

// ─── resolveApplicableRule ─────────────────────────────────────────────────
describe('resolveApplicableRule', () => {
  describe('casos vacíos / sin match', () => {
    it('lista vacía → null', () => {
      expect(resolveApplicableRule([], { variantId: VARIANT_ID })).toBeNull()
    })

    it('lista null → null', () => {
      expect(resolveApplicableRule(null, {})).toBeNull()
    })

    it('ninguna regla aplica → null', () => {
      const rules = [rule({ scope: 'VARIANT', variant_id: 'otro-variant' })]
      expect(resolveApplicableRule(rules, { variantId: VARIANT_ID })).toBeNull()
    })

    it('reglas inactivas se ignoran', () => {
      const rules = [
        rule({ scope: 'TENANT', is_active: false }),
        rule({ scope: 'VARIANT', variant_id: VARIANT_ID, is_active: false }),
      ]
      expect(resolveApplicableRule(rules, { variantId: VARIANT_ID })).toBeNull()
    })

    it('mix de activa e inactiva — solo retorna la activa', () => {
      const inactive = rule({ scope: 'VARIANT', variant_id: VARIANT_ID, markup_percentage: 99, is_active: false })
      const active   = rule({ scope: 'TENANT', markup_percentage: 20, is_active: true })
      expect(resolveApplicableRule([inactive, active], { variantId: VARIANT_ID })).toBe(active)
    })
  })

  describe('prioridad de scope', () => {
    it('TENANT aplica a cualquier variante', () => {
      const r = rule({ scope: 'TENANT', markup_percentage: 20 })
      expect(resolveApplicableRule([r], { variantId: VARIANT_ID })).toBe(r)
    })

    it('VARIANT gana sobre TENANT', () => {
      const tenant  = rule({ scope: 'TENANT',  markup_percentage: 20 })
      const variant = rule({ scope: 'VARIANT', markup_percentage: 50, variant_id: VARIANT_ID })
      expect(resolveApplicableRule([tenant, variant], { variantId: VARIANT_ID })).toBe(variant)
    })

    it('VARIANT gana sobre todos los demás scopes simultáneamente', () => {
      const tenant   = rule({ scope: 'TENANT' })
      const location = rule({ scope: 'LOCATION', location_id: LOCATION_ID })
      const category = rule({ scope: 'CATEGORY', category_id: CATEGORY_ID })
      const product  = rule({ scope: 'PRODUCT',  product_id: PRODUCT_ID })
      const variant  = rule({ scope: 'VARIANT',  variant_id: VARIANT_ID, markup_percentage: 99 })
      const result = resolveApplicableRule(
        [tenant, location, category, product, variant],
        { variantId: VARIANT_ID, productId: PRODUCT_ID, categoryId: CATEGORY_ID, locationId: LOCATION_ID },
      )
      expect(result).toBe(variant)
    })

    it('PRODUCT gana sobre CATEGORY', () => {
      const category = rule({ scope: 'CATEGORY', markup_percentage: 25, category_id: CATEGORY_ID })
      const product  = rule({ scope: 'PRODUCT',  markup_percentage: 40, product_id: PRODUCT_ID })
      expect(resolveApplicableRule([category, product], { productId: PRODUCT_ID, categoryId: CATEGORY_ID })).toBe(product)
    })

    it('CATEGORY gana sobre LOCATION', () => {
      const location = rule({ scope: 'LOCATION', markup_percentage: 15, location_id: LOCATION_ID })
      const category = rule({ scope: 'CATEGORY', markup_percentage: 35, category_id: CATEGORY_ID })
      expect(resolveApplicableRule([location, category], { categoryId: CATEGORY_ID, locationId: LOCATION_ID })).toBe(category)
    })

    it('LOCATION gana sobre TENANT', () => {
      const tenant   = rule({ scope: 'TENANT',   markup_percentage: 20 })
      const location = rule({ scope: 'LOCATION', markup_percentage: 30, location_id: LOCATION_ID })
      expect(resolveApplicableRule([tenant, location], { locationId: LOCATION_ID })).toBe(location)
    })
  })

  describe('contexto con campos null — no hace match para scopes específicos', () => {
    it('PRODUCT con productId null no aplica', () => {
      const r = rule({ scope: 'PRODUCT', product_id: PRODUCT_ID })
      expect(resolveApplicableRule([r], { productId: null })).toBeNull()
    })

    it('CATEGORY con categoryId null no aplica', () => {
      const r = rule({ scope: 'CATEGORY', category_id: CATEGORY_ID })
      expect(resolveApplicableRule([r], { categoryId: null })).toBeNull()
    })

    it('LOCATION con locationId null no aplica', () => {
      const r = rule({ scope: 'LOCATION', location_id: LOCATION_ID })
      expect(resolveApplicableRule([r], { locationId: null })).toBeNull()
    })

    it('VARIANT con variantId null no aplica', () => {
      const r = rule({ scope: 'VARIANT', variant_id: VARIANT_ID })
      expect(resolveApplicableRule([r], { variantId: null })).toBeNull()
    })

    it('TENANT aplica aunque todos los demás campos sean null', () => {
      const r = rule({ scope: 'TENANT' })
      expect(resolveApplicableRule([r], {})).toBe(r)
    })
  })

  describe('desempate por priority', () => {
    it('mayor priority gana dentro del mismo scope', () => {
      const low  = rule({ scope: 'TENANT', markup_percentage: 10, priority: 1 })
      const high = rule({ scope: 'TENANT', markup_percentage: 40, priority: 10 })
      expect(resolveApplicableRule([low, high], {})).toBe(high)
    })

    it('priority 0 vs priority 0 — el primero en score (no deterministico entre iguales)', () => {
      const a = rule({ scope: 'TENANT', priority: 0, markup_percentage: 10 })
      const b = rule({ scope: 'TENANT', priority: 0, markup_percentage: 20 })
      const result = resolveApplicableRule([a, b], {})
      // Ambos tienen score igual; el resultado debe ser uno de los dos (no lanzar error)
      expect([a, b]).toContain(result)
    })

    it('el orden del array no afecta cuando hay diferencia de scope', () => {
      const tenant  = rule({ scope: 'TENANT',  markup_percentage: 20 })
      const variant = rule({ scope: 'VARIANT', markup_percentage: 50, variant_id: VARIANT_ID })
      const r1 = resolveApplicableRule([tenant, variant], { variantId: VARIANT_ID })
      const r2 = resolveApplicableRule([variant, tenant], { variantId: VARIANT_ID })
      expect(r1).toBe(variant)
      expect(r2).toBe(variant)
    })
  })
})

// ─── applyPriceRule ────────────────────────────────────────────────────────
describe('applyPriceRule', () => {
  describe('casos que devuelven null', () => {
    it('rule null → null', () => {
      expect(applyPriceRule(50000, null)).toBeNull()
    })

    it('rule undefined → null', () => {
      expect(applyPriceRule(50000, undefined)).toBeNull()
    })

    it('método FIXED → null (usa variant.price sin modificar)', () => {
      expect(applyPriceRule(50000, rule({ pricing_method: 'FIXED' }))).toBeNull()
    })

    it('costo 0 → null', () => {
      expect(applyPriceRule(0, rule({ markup_percentage: 30 }))).toBeNull()
    })

    it('costo negativo → null', () => {
      expect(applyPriceRule(-1000, rule())).toBeNull()
    })
  })

  describe('cálculo MARKUP', () => {
    it('markup 30% sobre costo real COP', () => {
      const price = applyPriceRule(84034, rule({ markup_percentage: 30, price_rounding: 'NONE' }))
      expect(price).toBe(Math.round(84034 * 1.3))
    })

    it('markup 0% devuelve el costo sin modificar', () => {
      expect(applyPriceRule(50000, rule({ markup_percentage: 0 }))).toBe(50000)
    })

    it('markup 100% duplica el costo', () => {
      expect(applyPriceRule(50000, rule({ markup_percentage: 100 }))).toBe(100000)
    })

    it('markup >100% — margen sobre costo alto', () => {
      // 200% markup: precio = costo * 3
      expect(applyPriceRule(10000, rule({ markup_percentage: 200 }))).toBe(30000)
    })

    it('resultado nunca es negativo aunque markup sea muy negativo', () => {
      expect(applyPriceRule(100, rule({ markup_percentage: -200 }))).toBeGreaterThanOrEqual(0)
    })

    it('devuelve un entero (Math.round aplicado)', () => {
      const price = applyPriceRule(33333, rule({ markup_percentage: 27, price_rounding: 'NONE' }))
      expect(Number.isInteger(price)).toBe(true)
    })
  })

  describe('price_rounding', () => {
    it('NONE — sin redondeo adicional', () => {
      const price = applyPriceRule(77000, rule({ markup_percentage: 20, price_rounding: 'NONE' }))
      expect(price).toBe(Math.round(77000 * 1.2))
    })

    it('NEAREST 1000 — redondea al múltiplo más cercano', () => {
      // 10000 * 1.37 = 13699.99... → 13.699 → Math.round(13.699) = 14 → 14000
      const price = applyPriceRule(10000, rule({ markup_percentage: 37, price_rounding: 'NEAREST', rounding_to: 1000 }))
      expect(price).toBe(14000)
    })

    it('UP 500 — siempre sube al siguiente múltiplo', () => {
      // 10000 * 1.22 = 12200 → ceil(12200/500)*500 = 25*500 = 12500
      const price = applyPriceRule(10000, rule({ markup_percentage: 22, price_rounding: 'UP', rounding_to: 500 }))
      expect(price).toBe(12500)
    })

    it('UP — si el valor ya es múltiplo exacto no sube', () => {
      // 10000 * 1.0 = 10000 → ceil(10000/1000)*1000 = 10000
      const price = applyPriceRule(10000, rule({ markup_percentage: 0, price_rounding: 'UP', rounding_to: 1000 }))
      expect(price).toBe(10000)
    })

    it('DOWN 100 — siempre baja al múltiplo anterior', () => {
      const price = applyPriceRule(10000, rule({ markup_percentage: 23, price_rounding: 'DOWN', rounding_to: 100 }))
      expect(price % 100).toBe(0)
    })

    it('DOWN — si el valor ya es múltiplo exacto no baja', () => {
      const price = applyPriceRule(10000, rule({ markup_percentage: 20, price_rounding: 'DOWN', rounding_to: 1000 }))
      // 10000 * 1.2 = 12000 → floor(12000/1000)*1000 = 12000
      expect(price).toBe(12000)
    })

    it('rounding_to=1 con NEAREST es equivalente a NONE (redondeo a entero)', () => {
      const none    = applyPriceRule(33333, rule({ markup_percentage: 27, price_rounding: 'NONE',    rounding_to: 1 }))
      const nearest = applyPriceRule(33333, rule({ markup_percentage: 27, price_rounding: 'NEAREST', rounding_to: 1 }))
      expect(nearest).toBe(none)
    })
  })
})
