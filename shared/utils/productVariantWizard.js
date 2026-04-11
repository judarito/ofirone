const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const clampToZero = (value) => Math.max(0, toNumber(value, 0))

export function sanitizeVariantDraft(draft = {}, context = {}) {
  const trackInventory = context.track_inventory === true
  const canRequireExpiration = context.can_require_expiration === true

  const next = {
    ...draft,
    variant_id: draft.variant_id || null,
    product_id: draft.product_id || null,
    sku: String(draft.sku || '').trim(),
    variant_name: String(draft.variant_name || '').trim(),
    cost: clampToZero(draft.cost),
    price: clampToZero(draft.price),
    price_includes_tax: draft.price_includes_tax === true,
    min_stock: clampToZero(draft.min_stock),
    allow_backorder: draft.allow_backorder === true,
    is_active: draft.is_active !== false,
    requires_expiration: draft.requires_expiration === true
      ? true
      : draft.requires_expiration === false
        ? false
        : null,
    standard_code: String(draft.standard_code || '').trim(),
    standard_code_type: draft.standard_code_type || 'UNSPSC',
    unit_id: draft.unit_id || null,
  }

  if (!trackInventory) {
    next.min_stock = 0
    next.allow_backorder = false
  }

  if (!canRequireExpiration) {
    next.requires_expiration = null
  }

  return next
}

export function buildInitialVariantDraft(variant = {}, context = {}) {
  return sanitizeVariantDraft({
    variant_id: null,
    product_id: null,
    sku: '',
    variant_name: '',
    cost: 0,
    price: 0,
    price_includes_tax: false,
    min_stock: 0,
    allow_backorder: false,
    is_active: true,
    requires_expiration: null,
    standard_code: '',
    standard_code_type: 'UNSPSC',
    unit_id: null,
    ...variant,
  }, context)
}

export function buildVariantPayloadForSave(draft = {}, context = {}) {
  return sanitizeVariantDraft(draft, context)
}

export function getVariantMinimumAlertSummary(draft = {}, context = {}) {
  const sanitized = sanitizeVariantDraft(draft, context)
  if (context.track_inventory !== true) return 'No aplica'
  return sanitized.min_stock > 0 ? `Activa desde ${sanitized.min_stock}` : 'Sin alerta mínima'
}
