export const THIRD_PARTY_WIZARD_TYPES = [
  {
    id: 'customer',
    title: 'Cliente',
    shortTitle: 'Cliente',
    description: 'Se usa en POS, cartera y reportes de ventas.',
  },
  {
    id: 'supplier',
    title: 'Proveedor',
    shortTitle: 'Proveedor',
    description: 'Se usa en compras, abastecimiento y cuentas por pagar.',
  },
  {
    id: 'both',
    title: 'Cliente y proveedor',
    shortTitle: 'Ambos',
    description: 'La misma empresa actúa en ambos roles con la misma identificación.',
  },
]

const THIRD_PARTY_TYPE_MAP = new Map(
  THIRD_PARTY_WIZARD_TYPES.map((entry) => [entry.id, entry]),
)

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const clampToZero = (value) => Math.max(0, toNumber(value, 0))

export function normalizeThirdPartyType(value, forcedType = '') {
  const forced = String(forcedType || '').trim().toLowerCase()
  if (THIRD_PARTY_TYPE_MAP.has(forced)) return forced

  const normalized = String(value || '').trim().toLowerCase()
  return THIRD_PARTY_TYPE_MAP.has(normalized) ? normalized : 'customer'
}

export function getThirdPartyWizardType(type, forcedType = '') {
  return THIRD_PARTY_TYPE_MAP.get(normalizeThirdPartyType(type, forcedType))
    || THIRD_PARTY_TYPE_MAP.get('customer')
}

export function getThirdPartyTypeHelpText(type, forcedType = '') {
  return getThirdPartyWizardType(type, forcedType).description
}

export function buildInitialThirdPartyDraft(forcedType = '') {
  return sanitizeThirdPartyDraft({
    third_party_id: null,
    type: forcedType || 'customer',
    legal_name: '',
    trade_name: '',
    document_type: 'CC',
    document_number: '',
    dv: '',
    phone: '',
    email: '',
    fiscal_email: '',
    department: '',
    city: '',
    city_code: '',
    address_text: '',
    tax_regime: '',
    ciiu_code: '',
    is_responsible_for_iva: false,
    obligated_accounting: false,
    electronic_invoicing_enabled: false,
    max_credit_amount: 0,
    default_payment_terms: 0,
    default_currency: 'COP',
    is_active: true,
  }, { forcedType })
}

export function sanitizeThirdPartyDraft(draft = {}, options = {}) {
  const forcedType = options.forcedType || ''

  return {
    ...draft,
    third_party_id: draft.third_party_id || null,
    tenant_id: draft.tenant_id || null,
    type: normalizeThirdPartyType(draft.type || 'customer', forcedType),
    legal_name: String(draft.legal_name || '').trim(),
    trade_name: String(draft.trade_name || '').trim(),
    document_type: String(draft.document_type || 'CC').trim().toUpperCase() || 'CC',
    document_number: String(draft.document_number || '').trim(),
    dv: String(draft.dv || '').trim(),
    phone: String(draft.phone || '').trim(),
    email: String(draft.email || '').trim().toLowerCase(),
    fiscal_email: String(draft.fiscal_email || '').trim().toLowerCase(),
    department: String(draft.department || '').trim(),
    city: String(draft.city || '').trim(),
    city_code: String(draft.city_code || '').trim(),
    address_text: String(draft.address_text || draft.address || '').trim(),
    tax_regime: String(draft.tax_regime || '').trim(),
    ciiu_code: String(draft.ciiu_code || '').trim(),
    is_responsible_for_iva: draft.is_responsible_for_iva === true,
    obligated_accounting: draft.obligated_accounting === true,
    electronic_invoicing_enabled: draft.electronic_invoicing_enabled === true,
    max_credit_amount: clampToZero(draft.max_credit_amount),
    default_payment_terms: clampToZero(draft.default_payment_terms),
    default_currency: String(draft.default_currency || 'COP').trim().toUpperCase() || 'COP',
    country_code: String(draft.country_code || 'CO').trim().toUpperCase() || 'CO',
    is_active: draft.is_active !== false,
  }
}

export function buildThirdPartyPayloadForSave(draft = {}, options = {}) {
  const sanitized = sanitizeThirdPartyDraft(draft, options)
  return {
    third_party_id: sanitized.third_party_id || undefined,
    tenant_id: options.tenantId || sanitized.tenant_id || undefined,
    type: sanitized.type,
    legal_name: sanitized.legal_name,
    trade_name: sanitized.trade_name || null,
    document_type: sanitized.document_type,
    document_number: sanitized.document_number,
    dv: sanitized.dv || null,
    phone: sanitized.phone || null,
    email: sanitized.email || null,
    fiscal_email: sanitized.fiscal_email || null,
    department: sanitized.department || null,
    city: sanitized.city || null,
    city_code: sanitized.city_code || null,
    address: sanitized.address_text || null,
    tax_regime: sanitized.tax_regime || null,
    ciiu_code: sanitized.ciiu_code || null,
    is_responsible_for_iva: sanitized.is_responsible_for_iva,
    obligated_accounting: sanitized.obligated_accounting,
    electronic_invoicing_enabled: sanitized.electronic_invoicing_enabled,
    max_credit_amount: sanitized.max_credit_amount,
    default_payment_terms: sanitized.default_payment_terms,
    default_currency: sanitized.default_currency,
    country_code: sanitized.country_code,
    is_active: sanitized.is_active,
  }
}

export function buildThirdPartyDraftFromExisting(item = {}, options = {}) {
  let addressText = ''
  const address = item.address
  if (typeof address === 'string') {
    addressText = address
  } else if (address && typeof address === 'object') {
    addressText = address.street || address.text || address.address || Object.values(address)[0] || ''
  }

  return sanitizeThirdPartyDraft({
    third_party_id: item.third_party_id || null,
    tenant_id: item.tenant_id || null,
    type: item.type || 'customer',
    legal_name: item.legal_name || '',
    trade_name: item.trade_name || '',
    document_type: item.document_type || 'CC',
    document_number: item.document_number || '',
    dv: item.dv || '',
    phone: item.phone || '',
    email: item.email || '',
    fiscal_email: item.fiscal_email || '',
    department: item.department || '',
    city: item.city || '',
    city_code: item.city_code || '',
    address_text: addressText,
    tax_regime: item.tax_regime || '',
    ciiu_code: item.ciiu_code || '',
    is_responsible_for_iva: item.is_responsible_for_iva === true,
    obligated_accounting: item.obligated_accounting === true,
    electronic_invoicing_enabled: item.electronic_invoicing_enabled === true,
    max_credit_amount: item.max_credit_amount || 0,
    default_payment_terms: item.default_payment_terms || 0,
    default_currency: item.default_currency || 'COP',
    country_code: item.country_code || 'CO',
    is_active: item.is_active !== false,
  }, options)
}
