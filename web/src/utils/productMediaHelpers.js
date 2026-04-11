export function normalizeProductPhotoText(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export function buildProductPhotoAiSummary(payload = {}) {
  return [
    payload.suggested_name ? `Nombre sugerido: ${payload.suggested_name}` : null,
    payload.suggested_category ? `Categoría sugerida: ${payload.suggested_category}` : null,
    payload.suggested_brand ? `Marca detectada: ${payload.suggested_brand}` : null,
  ]
    .filter(Boolean)
    .join(' · ') || null
}

export function normalizeProductPhotoAiData(payload = null) {
  return {
    ai_status: payload ? 'READY' : 'FAILED',
    ai_summary: payload ? buildProductPhotoAiSummary(payload) : null,
    ai_detected_name: normalizeProductPhotoText(payload?.suggested_name),
    ai_detected_brand: normalizeProductPhotoText(payload?.suggested_brand),
    ai_detected_category: normalizeProductPhotoText(payload?.suggested_category),
    ai_suggested_description: normalizeProductPhotoText(payload?.suggested_description),
    ai_labels: Array.isArray(payload?.labels) ? payload.labels : [],
    ai_warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
  }
}

export function buildProductPhotoStoragePath({
  tenantId,
  productId,
  timestampMs = Date.now(),
  token = 'media',
  extension = 'jpg',
} = {}) {
  const safeTenantId = String(tenantId || '').trim()
  const safeProductId = String(productId || '').trim()
  const safeToken = String(token || 'media').trim() || 'media'
  const safeExtension = String(extension || 'jpg').replace(/^\.+/, '').trim() || 'jpg'

  if (!safeTenantId || !safeProductId) {
    throw new Error('tenantId y productId son requeridos para generar el path de media.')
  }

  return `${safeTenantId}/${safeProductId}/${Number(timestampMs || Date.now())}_${safeToken}.${safeExtension}`
}
