/**
 * Motor de resolución y aplicación de reglas de precio.
 * Puro JS — sin dependencias de framework. Usable en web y mobile (offline).
 *
 * Prioridad de scope (mayor = más específico = gana):
 *   VARIANT(50) > PRODUCT(40) > CATEGORY(30) > LOCATION(20) > TENANT(10)
 *
 * Entre reglas del mismo scope gana la de mayor `priority`.
 */

const SCOPE_SPECIFICITY = { VARIANT: 50, PRODUCT: 40, CATEGORY: 30, LOCATION: 20, TENANT: 10 };

/**
 * Devuelve la regla de precio más específica que aplica a la variante/contexto dados.
 *
 * @param {Array}  rules       - Lista de reglas (de caché o BD)
 * @param {Object} ctx
 * @param {string} ctx.variantId
 * @param {string} ctx.productId
 * @param {string} ctx.categoryId
 * @param {string} ctx.locationId
 * @returns {Object|null} La regla ganadora, o null si ninguna aplica
 */
export function resolveApplicableRule(rules, { variantId, productId, categoryId, locationId } = {}) {
  if (!Array.isArray(rules) || rules.length === 0) return null;

  let best = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (!rule.is_active) continue;

    const scope = String(rule.scope || 'TENANT').toUpperCase();
    let matches = false;

    switch (scope) {
      case 'VARIANT':
        matches = variantId != null && rule.variant_id === variantId;
        break;
      case 'PRODUCT':
        matches = productId != null && rule.product_id === productId;
        break;
      case 'CATEGORY':
        matches = categoryId != null && rule.category_id === categoryId;
        break;
      case 'LOCATION':
        matches = locationId != null && rule.location_id === locationId;
        break;
      case 'TENANT':
        matches = true;
        break;
    }

    if (!matches) continue;

    // Más específico gana; empate se rompe por priority
    const score = (SCOPE_SPECIFICITY[scope] || 0) * 1000 + (Number(rule.priority) || 0);
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }

  return best;
}

function applyRounding(value, method, roundingTo) {
  const to = Math.max(1, Number(roundingTo || 1));
  switch (String(method || 'NONE').toUpperCase()) {
    case 'UP':      return Math.ceil(value / to) * to;
    case 'DOWN':    return Math.floor(value / to) * to;
    case 'NEAREST': return Math.round(value / to) * to;
    default:        return value;
  }
}

/**
 * Calcula el precio a partir del costo y una regla de precio.
 * Solo aplica reglas MARKUP. Reglas FIXED usan el precio ya almacenado en la variante.
 *
 * @param {number}      baseCost - Costo de la variante (variant.cost)
 * @param {Object|null} rule     - Regla resuelta por resolveApplicableRule
 * @returns {number|null} Precio calculado, o null si no aplica (usar variant.price)
 */
export function applyPriceRule(baseCost, rule) {
  if (!rule) return null;
  if (String(rule.pricing_method || '').toUpperCase() !== 'MARKUP') return null;

  const cost = Math.max(0, Number(baseCost || 0));
  if (cost <= 0) return null;

  const markup = Number(rule.markup_percentage || 0);
  const rawPrice = cost * (1 + markup / 100);
  const rounded = applyRounding(rawPrice, rule.price_rounding, rule.rounding_to);

  return Math.max(0, Math.round(rounded));
}

export default { resolveApplicableRule, applyPriceRule };
