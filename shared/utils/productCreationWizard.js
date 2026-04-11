import { hashNormalizedText, normalizeSku } from './stringUtils'

export const PRODUCT_CREATION_PROFILES = [
  {
    id: 'sale_simple',
    title: 'Producto simple',
    shortTitle: 'Simple',
    description: 'Un producto normal para vender con una sola variante predeterminada.',
    inventory_behavior: 'RESELL',
    variant_mode: 'single',
    is_component: false,
    track_inventory: false,
    requires_expiration: false,
    production_type: null,
  },
  {
    id: 'sale_variants',
    title: 'Producto con variantes',
    shortTitle: 'Con variantes',
    description: 'Un producto para vender en varias tallas, colores o presentaciones.',
    inventory_behavior: 'RESELL',
    variant_mode: 'multiple',
    is_component: false,
    track_inventory: false,
    requires_expiration: false,
    production_type: null,
  },
  {
    id: 'component',
    title: 'Insumo o componente',
    shortTitle: 'Componente',
    description: 'Materia prima o insumo que luego usarás en fórmulas o manufactura.',
    inventory_behavior: 'RESELL',
    variant_mode: 'single',
    is_component: true,
    track_inventory: false,
    requires_expiration: false,
    production_type: null,
  },
  {
    id: 'manufactured',
    title: 'Producto fabricado',
    shortTitle: 'Fabricado',
    description: 'Producto terminado que se fabrica con una BOM y control de producción.',
    inventory_behavior: 'MANUFACTURED',
    variant_mode: 'single',
    is_component: false,
    track_inventory: false,
    requires_expiration: false,
    production_type: 'ON_DEMAND',
  },
  {
    id: 'bundle',
    title: 'Combo o bundle',
    shortTitle: 'Bundle',
    description: 'Combo comercial o paquete que no maneja stock directo como un producto normal.',
    inventory_behavior: 'BUNDLE',
    variant_mode: 'single',
    is_component: false,
    track_inventory: false,
    requires_expiration: false,
    production_type: null,
  },
  {
    id: 'service',
    title: 'Servicio',
    shortTitle: 'Servicio',
    description: 'Servicio sin control de inventario ni vencimiento.',
    inventory_behavior: 'SERVICE',
    variant_mode: 'single',
    is_component: false,
    track_inventory: false,
    requires_expiration: false,
    production_type: null,
  },
]

export const PRODUCT_CREATION_PROFILE_IDS = PRODUCT_CREATION_PROFILES.map((profile) => profile.id)

const PRODUCT_CREATION_PROFILE_MAP = new Map(
  PRODUCT_CREATION_PROFILES.map((profile) => [profile.id, profile]),
)

const INVENTORY_BEHAVIOR_OPTIONS = new Set(['RESELL', 'SERVICE', 'MANUFACTURED', 'BUNDLE'])
const VARIANT_MODE_OPTIONS = new Set(['single', 'multiple'])

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const clampToZero = (value) => Math.max(0, toNumber(value, 0))
const DEFAULT_VARIANT_NAMES = new Set(['', 'predeterminado', 'predeterminada', 'principal', 'default'])

export function getProductCreationProfile(profileId) {
  return PRODUCT_CREATION_PROFILE_MAP.get(profileId) || PRODUCT_CREATION_PROFILE_MAP.get('sale_simple')
}

export function applyProductCreationProfile(draft = {}, profileId = 'sale_simple') {
  const profile = getProductCreationProfile(profileId)
  return sanitizeProductDraft({
    ...draft,
    product_profile: profile.id,
    inventory_behavior: profile.inventory_behavior,
    variant_mode: profile.variant_mode,
    is_component: profile.is_component,
    track_inventory: profile.track_inventory,
    requires_expiration: profile.requires_expiration,
    production_type: profile.production_type,
  })
}

export function sanitizeProductDraft(draft = {}) {
  const next = {
    ...draft,
    name: String(draft.name || '').trim(),
    description: String(draft.description || '').trim(),
    category_id: draft.category_id || null,
    unit_id: draft.unit_id || null,
    variant_mode: VARIANT_MODE_OPTIONS.has(draft.variant_mode) ? draft.variant_mode : 'single',
    inventory_behavior: INVENTORY_BEHAVIOR_OPTIONS.has(draft.inventory_behavior) ? draft.inventory_behavior : 'RESELL',
    product_profile: PRODUCT_CREATION_PROFILE_MAP.has(draft.product_profile) ? draft.product_profile : 'sale_simple',
    is_active: draft.is_active !== false,
    track_inventory: draft.track_inventory === true,
    requires_expiration: draft.requires_expiration === true,
    is_component: draft.is_component === true,
    production_type: draft.production_type || null,
    base_cost: clampToZero(draft.base_cost),
    base_price: clampToZero(draft.base_price),
    base_min_stock: clampToZero(draft.base_min_stock),
    seed_variant_name: String(draft.seed_variant_name || '').trim(),
    seed_variant_sku: String(draft.seed_variant_sku || '').trim(),
    seed_variant_cost: clampToZero(draft.seed_variant_cost),
    seed_variant_price: clampToZero(draft.seed_variant_price),
    seed_variant_min_stock: clampToZero(draft.seed_variant_min_stock),
  }

  if (next.is_component) {
    next.inventory_behavior = 'RESELL'
  }

  if (next.inventory_behavior === 'SERVICE' || next.inventory_behavior === 'BUNDLE') {
    next.track_inventory = false
    next.requires_expiration = false
    next.is_component = false
    next.base_min_stock = 0
    next.seed_variant_min_stock = 0
    next.production_type = null
  }

  if (next.inventory_behavior === 'MANUFACTURED') {
    next.is_component = false
    next.production_type = next.production_type || 'ON_DEMAND'
  }

  if (next.variant_mode === 'multiple') {
    next.base_cost = 0
    next.base_price = 0
    next.base_min_stock = 0
  }

  return next
}

function isDefaultVariantName(value) {
  return DEFAULT_VARIANT_NAMES.has(String(value || '').trim().toLowerCase())
}

export function inferProductCreationProfile(product = {}) {
  const inventoryBehavior = String(product.inventory_behavior || 'RESELL').trim().toUpperCase()
  const variants = Array.isArray(product.product_variants) ? product.product_variants : []
  const hasMultipleVariants = variants.length > 1
  const firstVariant = variants[0] || null
  const looksLikeSingleDefaultVariant = variants.length <= 1 && isDefaultVariantName(firstVariant?.variant_name)

  if (inventoryBehavior === 'SERVICE') return 'service'
  if (inventoryBehavior === 'BUNDLE') return 'bundle'
  if (inventoryBehavior === 'MANUFACTURED') return 'manufactured'
  if (product.is_component === true) return 'component'
  if (hasMultipleVariants || !looksLikeSingleDefaultVariant) return 'sale_variants'
  return 'sale_simple'
}

export function buildProductDraftFromProduct(product = {}) {
  const variants = Array.isArray(product.product_variants) ? product.product_variants : []
  const profileId = inferProductCreationProfile(product)
  const variantMode = profileId === 'sale_variants' ? 'multiple' : 'single'
  const primaryVariant = variants[0] || null

  return sanitizeProductDraft({
    product_id: product.product_id || null,
    name: product.name || '',
    description: product.description || '',
    category_id: product.category_id || null,
    unit_id: product.unit_id || null,
    is_active: product.is_active !== false,
    track_inventory: product.track_inventory === true,
    requires_expiration: product.requires_expiration === true,
    inventory_behavior: product.inventory_behavior || 'RESELL',
    production_type: product.production_type || null,
    is_component: product.is_component === true,
    active_bom_id: product.active_bom_id || null,
    product_profile: profileId,
    variant_mode: variantMode,
    base_cost: variantMode === 'single' ? primaryVariant?.cost || 0 : 0,
    base_price: variantMode === 'single' ? primaryVariant?.price || 0 : 0,
    base_min_stock: variantMode === 'single' ? primaryVariant?.min_stock || 0 : 0,
    seed_variant_name: '',
    seed_variant_sku: '',
    seed_variant_cost: 0,
    seed_variant_price: 0,
    seed_variant_min_stock: 0,
  })
}

export function shouldAskSeedVariant(draft = {}) {
  return sanitizeProductDraft(draft).variant_mode === 'multiple'
}

export function shouldAllowExpirationControl(draft = {}) {
  const sanitized = sanitizeProductDraft(draft)
  return sanitized.inventory_behavior === 'RESELL' || sanitized.inventory_behavior === 'MANUFACTURED'
}

export function shouldTrackInventoryForDraft(draft = {}) {
  return sanitizeProductDraft(draft).track_inventory === true
}

export function generateSeedVariantSku(productName, variantName = '') {
  const productPart = normalizeSku(productName, 8)
  const variantPart = normalizeSku(variantName, 5)
  const hash = hashNormalizedText(`${productName || ''}|${variantName || ''}`).slice(0, 4).toUpperCase()
  return [productPart, variantPart, hash].filter(Boolean).join('-') || `SKU-${hash}`
}

export function buildSeedVariantPayload(draft = {}) {
  const sanitized = sanitizeProductDraft(draft)
  const variantName = sanitized.seed_variant_name || 'Principal'
  return {
    sku: sanitized.seed_variant_sku || generateSeedVariantSku(sanitized.name, variantName),
    variant_name: variantName,
    cost: sanitized.seed_variant_cost,
    price: sanitized.seed_variant_price,
    min_stock: sanitized.track_inventory ? sanitized.seed_variant_min_stock : 0,
    price_includes_tax: false,
    allow_backorder: false,
    is_active: true,
    requires_expiration: shouldAllowExpirationControl(sanitized)
      ? (sanitized.requires_expiration ? true : null)
      : null,
  }
}

export function buildProductPayloadForSave(draft = {}) {
  const sanitized = sanitizeProductDraft(draft)
  const payload = {
    name: sanitized.name,
    description: sanitized.description || null,
    category_id: sanitized.category_id,
    unit_id: sanitized.unit_id,
    is_active: sanitized.is_active,
    track_inventory: sanitized.track_inventory,
    requires_expiration: sanitized.requires_expiration,
    inventory_behavior: sanitized.inventory_behavior,
    production_type: sanitized.production_type,
    is_component: sanitized.is_component,
    base_cost: sanitized.base_cost,
    base_price: sanitized.base_price,
    base_min_stock: sanitized.base_min_stock,
  }

  if (sanitized.variant_mode === 'multiple') {
    delete payload.base_cost
    delete payload.base_price
    delete payload.base_min_stock
  }

  return payload
}
