export function createDraftProductPhotoRow(seed = {}) {
  return {
    local_id: seed.local_id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    product_name: String(seed.product_name || '').trim(),
    variant_name: String(seed.variant_name || 'Predeterminada').trim() || 'Predeterminada',
    category_name: String(seed.category_name || '').trim(),
    unit_price: seed.unit_price == null ? '' : String(seed.unit_price),
    unit_cost: seed.unit_cost == null ? '' : String(seed.unit_cost),
    initial_stock: seed.initial_stock == null ? '' : String(seed.initial_stock),
    notes: String(seed.notes || '').trim(),
    confidence: Number(seed.confidence || 0),
  }
}

export function normalizeParsedPhotoProducts(payload = {}) {
  const rows = (Array.isArray(payload?.products) ? payload.products : [])
    .map((item) => createDraftProductPhotoRow(item))
    .filter((item) => item.product_name)

  return {
    rows,
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    ocrText: String(payload?.ocr_text || '').trim() || null,
    model: payload?.model ? String(payload.model) : null,
    usage: payload?.usage || null,
  }
}

export function countValidProductPhotoRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const name = String(row?.product_name || '').trim()
    const price = Number(row?.unit_price)
    return Boolean(name) && Number.isFinite(price) && price > 0
  }).length
}

export function buildProductPhotoImportSummary(rows = []) {
  const source = Array.isArray(rows) ? rows : []
  const validCount = countValidProductPhotoRows(source)
  const preview = source
    .slice(0, 3)
    .map((item) => String(item?.product_name || '').trim())
    .filter(Boolean)
    .join(' | ')

  return {
    totalRows: source.length,
    validRows: validCount,
    invalidRows: Math.max(0, source.length - validCount),
    preview: preview || null,
  }
}
