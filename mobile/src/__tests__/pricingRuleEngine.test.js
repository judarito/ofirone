import { resolveApplicableRule, applyPriceRule } from '../../../shared/utils/pricingRuleEngine';

const VARIANT_ID  = 'v-001';
const PRODUCT_ID  = 'p-001';
const CATEGORY_ID = 'c-001';
const LOCATION_ID = 'l-001';

function rule(overrides) {
  return {
    pricing_rule_id: 'r-' + Math.random(),
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
  };
}

// ─── resolveApplicableRule ─────────────────────────────────────────────────
describe('resolveApplicableRule', () => {
  describe('casos vacíos / sin match', () => {
    it('lista vacía → null', () => {
      expect(resolveApplicableRule([], {})).toBeNull();
    });

    it('lista null → null', () => {
      expect(resolveApplicableRule(null, {})).toBeNull();
    });

    it('regla inactiva se ignora', () => {
      expect(resolveApplicableRule([rule({ is_active: false })], {})).toBeNull();
    });

    it('mezcla de activa e inactiva — retorna solo la activa', () => {
      const inactive = rule({ scope: 'VARIANT', variant_id: VARIANT_ID, markup_percentage: 99, is_active: false });
      const active   = rule({ scope: 'TENANT', markup_percentage: 20, is_active: true });
      expect(resolveApplicableRule([inactive, active], { variantId: VARIANT_ID })).toBe(active);
    });

    it('múltiples reglas inactivas + una activa — retorna la activa', () => {
      const rules = [
        rule({ scope: 'TENANT',  markup_percentage: 10, is_active: false }),
        rule({ scope: 'PRODUCT', product_id: PRODUCT_ID, markup_percentage: 40, is_active: false }),
        rule({ scope: 'LOCATION', location_id: LOCATION_ID, markup_percentage: 25, is_active: true }),
      ];
      const result = resolveApplicableRule(rules, { productId: PRODUCT_ID, locationId: LOCATION_ID });
      expect(result.markup_percentage).toBe(25);
    });
  });

  describe('prioridad de scope', () => {
    it('TENANT aplica siempre', () => {
      const r = rule({ scope: 'TENANT', markup_percentage: 25 });
      expect(resolveApplicableRule([r], { variantId: VARIANT_ID })).toBe(r);
    });

    it('VARIANT gana sobre PRODUCT, CATEGORY, LOCATION y TENANT', () => {
      const tenant   = rule({ scope: 'TENANT' });
      const location = rule({ scope: 'LOCATION', location_id: LOCATION_ID });
      const category = rule({ scope: 'CATEGORY', category_id: CATEGORY_ID });
      const product  = rule({ scope: 'PRODUCT',  product_id: PRODUCT_ID });
      const variant  = rule({ scope: 'VARIANT',  variant_id: VARIANT_ID, markup_percentage: 99 });

      const result = resolveApplicableRule(
        [tenant, location, category, product, variant],
        { variantId: VARIANT_ID, productId: PRODUCT_ID, categoryId: CATEGORY_ID, locationId: LOCATION_ID },
      );
      expect(result).toBe(variant);
    });

    it('PRODUCT gana sobre CATEGORY cuando coincide product_id', () => {
      const category = rule({ scope: 'CATEGORY', category_id: CATEGORY_ID, markup_percentage: 20 });
      const product  = rule({ scope: 'PRODUCT',  product_id: PRODUCT_ID,   markup_percentage: 40 });
      const result   = resolveApplicableRule([category, product], {
        productId: PRODUCT_ID,
        categoryId: CATEGORY_ID,
      });
      expect(result).toBe(product);
    });

    it('desempate por priority — mayor priority gana', () => {
      const low  = rule({ scope: 'LOCATION', location_id: LOCATION_ID, priority: 1,  markup_percentage: 10 });
      const high = rule({ scope: 'LOCATION', location_id: LOCATION_ID, priority: 99, markup_percentage: 45 });
      const result = resolveApplicableRule([low, high], { locationId: LOCATION_ID });
      expect(result).toBe(high);
    });

    it('el orden del array no cambia el resultado', () => {
      const tenant  = rule({ scope: 'TENANT',  markup_percentage: 10 });
      const variant = rule({ scope: 'VARIANT', markup_percentage: 50, variant_id: VARIANT_ID });
      const ctx = { variantId: VARIANT_ID };
      expect(resolveApplicableRule([tenant, variant], ctx)).toBe(variant);
      expect(resolveApplicableRule([variant, tenant], ctx)).toBe(variant);
    });
  });

  describe('contexto con campos null — no hace match para scopes específicos', () => {
    it('PRODUCT con productId null no aplica', () => {
      const r = rule({ scope: 'PRODUCT', product_id: PRODUCT_ID });
      expect(resolveApplicableRule([r], { productId: null })).toBeNull();
    });

    it('CATEGORY con categoryId null no aplica', () => {
      const r = rule({ scope: 'CATEGORY', category_id: CATEGORY_ID });
      expect(resolveApplicableRule([r], { categoryId: null })).toBeNull();
    });

    it('LOCATION con locationId null no aplica — caja sin sede asignada', () => {
      const r = rule({ scope: 'LOCATION', location_id: LOCATION_ID });
      expect(resolveApplicableRule([r], { locationId: null })).toBeNull();
    });

    it('TENANT sigue aplicando aunque el contexto esté vacío', () => {
      const r = rule({ scope: 'TENANT' });
      expect(resolveApplicableRule([r], {})).toBe(r);
    });
  });

  describe('escenario multi-sede — varias reglas simultáneas', () => {
    it('sede A ve regla de su sede, sede B ve regla global', () => {
      const LOCATION_A = 'loc-A';
      const LOCATION_B = 'loc-B';
      const ruleForA  = rule({ scope: 'LOCATION', location_id: LOCATION_A, markup_percentage: 35 });
      const ruleGlobal = rule({ scope: 'TENANT', markup_percentage: 20 });
      const allRules = [ruleForA, ruleGlobal];

      // Sede A → regla específica de sede
      expect(resolveApplicableRule(allRules, { locationId: LOCATION_A })).toBe(ruleForA);
      // Sede B → cae al tenant global
      expect(resolveApplicableRule(allRules, { locationId: LOCATION_B })).toBe(ruleGlobal);
    });

    it('variante con regla especial en sede específica — gana la variante', () => {
      const ruleLocation = rule({ scope: 'LOCATION', location_id: LOCATION_ID, markup_percentage: 30 });
      const ruleVariant  = rule({ scope: 'VARIANT',  variant_id: VARIANT_ID,   markup_percentage: 5  });
      const allRules = [ruleLocation, ruleVariant];

      const result = resolveApplicableRule(allRules, { variantId: VARIANT_ID, locationId: LOCATION_ID });
      expect(result).toBe(ruleVariant);
    });
  });
});

// ─── applyPriceRule ────────────────────────────────────────────────────────
describe('applyPriceRule', () => {
  describe('casos que devuelven null', () => {
    it('rule null → null', () => {
      expect(applyPriceRule(50000, null)).toBeNull();
    });

    it('método FIXED → null — respeta precio manual de la variante', () => {
      expect(applyPriceRule(50000, rule({ pricing_method: 'FIXED' }))).toBeNull();
    });

    it('costo 0 → null — variante sin costo no genera precio', () => {
      expect(applyPriceRule(0, rule())).toBeNull();
    });

    it('costo negativo → null', () => {
      expect(applyPriceRule(-100, rule())).toBeNull();
    });
  });

  describe('cálculo MARKUP', () => {
    it('markup 30% sobre costo real en COP', () => {
      const price = applyPriceRule(84034, rule({ markup_percentage: 30 }));
      expect(price).toBe(Math.round(84034 * 1.3));
    });

    it('markup 0% devuelve el mismo costo', () => {
      expect(applyPriceRule(100000, rule({ markup_percentage: 0 }))).toBe(100000);
    });

    it('markup 100% duplica el costo', () => {
      expect(applyPriceRule(50000, rule({ markup_percentage: 100 }))).toBe(100000);
    });

    it('markup >100%', () => {
      expect(applyPriceRule(10000, rule({ markup_percentage: 200 }))).toBe(30000);
    });

    it('resultado nunca es negativo', () => {
      expect(applyPriceRule(1000, rule({ markup_percentage: -500 }))).toBeGreaterThanOrEqual(0);
    });

    it('devuelve siempre un entero', () => {
      const price = applyPriceRule(33333, rule({ markup_percentage: 27 }));
      expect(Number.isInteger(price)).toBe(true);
    });
  });

  describe('redondeo en precios COP', () => {
    it('NEAREST 1000 — típico en retail colombiano', () => {
      // 10000 * 1.37 = 13699.99... → Math.round(13.699) = 14 → 14000
      const price = applyPriceRule(10000, rule({
        markup_percentage: 37,
        price_rounding: 'NEAREST',
        rounding_to: 1000,
      }));
      expect(price).toBe(14000);
    });

    it('UP 500 — precio de anaquel siempre termina en múltiplo', () => {
      // 10000 * 1.22 = 12200 → ceil(12200/500)*500 = 12500
      const price = applyPriceRule(10000, rule({
        markup_percentage: 22,
        price_rounding: 'UP',
        rounding_to: 500,
      }));
      expect(price).toBe(12500);
    });

    it('UP — si ya es múltiplo exacto no sube', () => {
      // 10000 * 1.0 = 10000 → ceil(10000/1000)*1000 = 10000
      const price = applyPriceRule(10000, rule({
        markup_percentage: 0,
        price_rounding: 'UP',
        rounding_to: 1000,
      }));
      expect(price).toBe(10000);
    });

    it('DOWN 100 — precio redondeado hacia abajo', () => {
      const price = applyPriceRule(33000, rule({
        markup_percentage: 20,
        price_rounding: 'DOWN',
        rounding_to: 100,
      }));
      expect(price % 100).toBe(0);
    });

    it('NONE — sin redondeo adicional al Math.round básico', () => {
      const price = applyPriceRule(77777, rule({
        markup_percentage: 18,
        price_rounding: 'NONE',
      }));
      expect(price).toBe(Math.round(77777 * 1.18));
    });
  });

  describe('escenarios POS offline', () => {
    it('aplica regla TENANT con costo del catálogo cacheado', () => {
      const cachedVariant = { cost: 45000, variant_id: VARIANT_ID };
      // markup 37%: 45000 * 1.37 = 61649.99... → nearest 1000 → 62000
      const tenantRule = rule({ scope: 'TENANT', markup_percentage: 37, price_rounding: 'NEAREST', rounding_to: 1000 });

      const resolved = resolveApplicableRule([tenantRule], {});
      const price = applyPriceRule(cachedVariant.cost, resolved);

      expect(price).toBe(62000);
    });

    it('variante sin costo registrado → POS usa variant.price', () => {
      const cachedVariant = { cost: 0, price: 89000, variant_id: VARIANT_ID };
      const tenantRule = rule({ scope: 'TENANT', markup_percentage: 30 });

      const resolved = resolveApplicableRule([tenantRule], { variantId: VARIANT_ID });
      const rulePrice = applyPriceRule(cachedVariant.cost, resolved);

      // applyPriceRule devuelve null → el POS debe usar cachedVariant.price
      expect(rulePrice).toBeNull();
      const finalPrice = rulePrice !== null ? rulePrice : cachedVariant.price;
      expect(finalPrice).toBe(89000);
    });

    it('sin reglas → POS mantiene variant.price sin cambios', () => {
      const cachedVariant = { cost: 50000, price: 75000, variant_id: VARIANT_ID };

      const resolved = resolveApplicableRule([], { variantId: VARIANT_ID });
      const rulePrice = applyPriceRule(cachedVariant.cost, resolved);

      expect(resolved).toBeNull();
      expect(rulePrice).toBeNull();
      const finalPrice = rulePrice !== null ? rulePrice : cachedVariant.price;
      expect(finalPrice).toBe(75000);
    });

    it('regla FIXED siempre deja el precio de catálogo intacto', () => {
      const cachedVariant = { cost: 50000, price: 89900, variant_id: VARIANT_ID };
      const fixedRule = rule({ scope: 'TENANT', pricing_method: 'FIXED' });

      const resolved = resolveApplicableRule([fixedRule], {});
      const rulePrice = applyPriceRule(cachedVariant.cost, resolved);

      expect(rulePrice).toBeNull();
      const finalPrice = rulePrice !== null ? rulePrice : cachedVariant.price;
      expect(finalPrice).toBe(89900);
    });

    it('precio calculado con markup > precio de catálogo — el cajero ve el calculado', () => {
      const cachedVariant = { cost: 50000, price: 60000, variant_id: VARIANT_ID };
      const aggressiveRule = rule({ scope: 'TENANT', markup_percentage: 80 });

      const resolved = resolveApplicableRule([aggressiveRule], {});
      const rulePrice = applyPriceRule(cachedVariant.cost, resolved);

      // 50000 * 1.8 = 90000 > 60000 (precio catálogo)
      expect(rulePrice).toBe(90000);
    });
  });
});
