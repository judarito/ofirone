function normalizeLineItems(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : [])
    .map((item) => ({
      raw_name: String(item?.raw_name || item?.name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
    }))
    .filter((item) => item.raw_name)
}

export function buildCommandTextFromOcrPayload(payload = {}) {
  const directText = String(payload?.ocr_text || '').trim()
  if (directText) return directText

  const synthesized = normalizeLineItems(payload?.line_items)
    .map((item) => `${Math.max(1, Number(item.quantity || 1))} ${item.raw_name}`.trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  return synthesized
}

export function normalizeOrderImageOcrPayload(payload = {}) {
  const line_items = normalizeLineItems(payload?.line_items)
  const ocr_text = String(payload?.ocr_text || '').trim() || null
  const command_text = buildCommandTextFromOcrPayload({
    ocr_text,
    line_items,
  })

  return {
    line_items,
    ocr_text,
    command_text,
    model: payload?.model ? String(payload.model) : null,
  }
}

export function buildOrderImageOcrSummary(payload = {}) {
  const normalized = normalizeOrderImageOcrPayload(payload)
  const commandText = String(normalized.command_text || '').trim()

  return {
    ocrChars: commandText.length,
    ocrLines: commandText ? commandText.split('\n').filter(Boolean).length : 0,
    ocrPreview: commandText.slice(0, 180) || null,
  }
}

