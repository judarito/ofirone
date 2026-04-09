const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

const FIELD_LABELS = new Map([
  ['tenant_id', 'empresa'],
  ['product_id', 'producto'],
  ['variant_id', 'variante'],
  ['location_id', 'sede'],
  ['to_location_id', 'sede destino'],
  ['from_location_id', 'sede origen'],
  ['cash_session_id', 'sesion de caja'],
  ['cash_register_id', 'caja'],
  ['customer_id', 'cliente'],
  ['supplier_id', 'proveedor'],
  ['user_id', 'usuario'],
  ['role_id', 'rol'],
  ['menu_id', 'menu'],
  ['permission_id', 'permiso'],
  ['bom_id', 'formula'],
  ['component_variant_id', 'componente'],
  ['sale_id', 'venta'],
  ['purchase_id', 'compra'],
  ['layaway_id', 'plan separe'],
  ['account_id', 'cuenta contable'],
  ['config_id', 'configuracion'],
  ['rule_id', 'regla'],
  ['exception_id', 'excepcion'],
])

const getRawMessage = (error) => {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error?.message === 'string') return error.message
  if (typeof error?.error === 'string') return error.error
  if (typeof error?.details === 'string') return error.details
  return String(error)
}

const normalizeText = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()

const buildIdLabelMap = (context = {}) => {
  const labels = new Map()
  const appendEntries = (source) => {
    if (!source) return
    if (source instanceof Map) {
      source.forEach((value, key) => {
        if (!key || !value) return
        labels.set(String(key).toLowerCase(), String(value))
      })
      return
    }

    if (Array.isArray(source)) {
      source.forEach((entry) => {
        if (!entry) return
        if (Array.isArray(entry) && entry.length >= 2) {
          const [key, value] = entry
          if (key && value) labels.set(String(key).toLowerCase(), String(value))
        }
      })
      return
    }

    Object.entries(source).forEach(([key, value]) => {
      if (!key || !value) return
      labels.set(String(key).toLowerCase(), String(value))
    })
  }

  appendEntries(context.idLabels)
  appendEntries(context.variantLabels)
  appendEntries(context.productLabels)
  appendEntries(context.locationLabels)
  appendEntries(context.entityLabels)

  return labels
}

const replaceFieldNames = (message) => {
  let next = message
  FIELD_LABELS.forEach((label, field) => {
    const regex = new RegExp(`\\b${field}\\b`, 'gi')
    next = next.replace(regex, label)
  })
  return next
}

const normalizeKnownDatabaseErrors = (message) => {
  const lower = message.toLowerCase()

  if (lower.includes('sale_counters') && lower.includes('row-level security')) {
    return 'La base de datos bloqueó el consecutivo de venta. Ejecuta la migración pendiente e intenta de nuevo.'
  }

  if (lower.includes('row-level security')) {
    return 'No tienes permisos para completar esta operación.'
  }

  if (lower.includes('duplicate key value violates unique constraint') || lower.includes('violates unique constraint')) {
    return 'Ya existe un registro con esos datos. Revisa e intenta de nuevo.'
  }

  if (lower.includes('violates foreign key constraint') || lower.includes('is not present in table')) {
    return 'No se pudo completar la operación porque una referencia relacionada no es válida.'
  }

  if (lower.includes('invalid input syntax for type uuid')) {
    return 'La referencia enviada no es válida.'
  }

  if (lower.includes('schema cache') || lower.includes('could not find the function') || lower.includes('could not find the table')) {
    return 'La base de datos no tiene actualizado este cambio. Aplica las migraciones pendientes e intenta de nuevo.'
  }

  if (lower.includes('networkerror') || lower.includes('failed to fetch') || lower.includes('fetch failed')) {
    return 'No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.'
  }

  if (lower.includes('jwt') && lower.includes('expired')) {
    return 'Tu sesión expiró. Inicia sesión nuevamente.'
  }

  return message
}

export const humanizeAppError = (error, context = {}) => {
  const fallbackMessage = context.defaultMessage || 'Ocurrió un error al procesar la operación.'
  let message = normalizeText(getRawMessage(error))
  if (!message) return fallbackMessage

  message = normalizeKnownDatabaseErrors(message)
  message = replaceFieldNames(message)

  const idLabels = buildIdLabelMap(context)
  message = message.replace(UUID_REGEX, (match) => (
    idLabels.get(String(match).toLowerCase()) ||
    context.uuidFallbackLabel ||
    'este registro'
  ))

  message = message
    .replace(/\bvariant\b/gi, 'producto')
    .replace(/\bvariante\b/gi, 'producto')
    .replace(/\bproduct id\b/gi, 'producto')
    .replace(/\btenant id\b/gi, 'empresa')
    .replace(/\bcash session\b/gi, 'sesion de caja')
    .replace(/\bcould not choose the best candidate function\b/gi, 'No se pudo resolver la función correcta en base de datos')

  message = normalizeText(message)

  if (!message) return fallbackMessage
  return message
}

export const serviceErrorResult = (error, extra = {}, context = {}) => ({
  success: false,
  error: humanizeAppError(error, context),
  ...extra,
})

export default {
  humanizeAppError,
  serviceErrorResult,
}
