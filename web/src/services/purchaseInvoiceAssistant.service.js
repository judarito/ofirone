import supabaseService from './supabase.service'

const PRIMARY_TEXT_EDGE_FUNCTION =
  import.meta.env.VITE_PURCHASE_INVOICE_TEXT_EDGE_FUNCTION
  || import.meta.env.VITE_DEEPSEEK_TEXT_EDGE_FUNCTION
  || 'deepseek-proxy'
const PRIMARY_TEXT_MODEL =
  import.meta.env.VITE_PURCHASE_INVOICE_TEXT_MODEL
  || import.meta.env.VITE_DEEPSEEK_TEXT_MODEL
  || 'deepseek-chat'
const FALLBACK_TEXT_EDGE_FUNCTION =
  import.meta.env.VITE_PURCHASE_INVOICE_FALLBACK_EDGE_FUNCTION
  || import.meta.env.VITE_OPENAI_TEXT_EDGE_FUNCTION
  || PRIMARY_TEXT_EDGE_FUNCTION
const FALLBACK_TEXT_MODEL =
  import.meta.env.VITE_PURCHASE_INVOICE_FALLBACK_MODEL
  || import.meta.env.VITE_OPENAI_TEXT_MODEL
  || PRIMARY_TEXT_MODEL

function normalizeText(value) {
  return String(value || '').trim()
}

function parseAiJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (_innerError) {
      return null
    }
  }
}

async function extractInvokeError(error) {
  const fragments = []
  if (error?.message) fragments.push(String(error.message))

  const context = error?.context
  if (!context) return fragments.join(' | ') || 'Error desconocido'

  try {
    const response = typeof context.clone === 'function' ? context.clone() : context
    if (response?.status) fragments.push(`HTTP ${response.status}`)

    let bodyJson = null
    if (typeof response?.json === 'function') {
      bodyJson = await response.json().catch(() => null)
    }

    if (bodyJson?.error) fragments.push(String(bodyJson.error))
    if (bodyJson?.details) fragments.push(String(bodyJson.details))

    if (!bodyJson && typeof response?.text === 'function') {
      const bodyText = await response.text().catch(() => '')
      if (bodyText?.trim()) fragments.push(bodyText.trim().slice(0, 240))
    }
  } catch (_e) {
    // no-op
  }

  const unique = Array.from(new Set(fragments.filter(Boolean)))
  return unique.join(' | ') || 'Error desconocido'
}

function resolveProviderLabel(edgeFunction, model) {
  const fingerprint = `${edgeFunction || ''} ${model || ''}`.toLowerCase()
  if (fingerprint.includes('gpt') || fingerprint.includes('openai')) return 'openai'
  if (fingerprint.includes('deepseek')) return 'deepseek'
  return 'cloud_llm'
}

function buildHeuristicSuggestion(line) {
  const rawName = normalizeText(line?.raw_name || line?.name || 'Articulo factura')
  return {
    product_name: rawName || 'Articulo factura',
    variant_name: 'Predeterminada',
    suggested_sku: null,
    requires_expiration: false,
    inventory_behavior: 'RESELL',
    is_component: false,
    confidence: 0.35,
    notes: 'Sugerencia heuristica aplicada por fallback local.',
    provider: 'heuristic',
    model: 'heuristic-fallback-v1',
  }
}

async function invokeLineNormalizer({ edgeFunction, model, line }) {
  const rawName = normalizeText(line?.raw_name || line?.name || '')
  const systemPrompt =
    'Eres un asistente de catalogacion para compras en POS. A partir de una linea de factura, propones el mejor articulo de catalogo. Responde SOLO JSON valido.'
  const userPrompt = `Normaliza esta linea de factura a una sugerencia de catalogo.

Responde JSON con:
{
  "product_name": "string",
  "variant_name": "string",
  "suggested_sku": "string|null",
  "requires_expiration": boolean,
  "inventory_behavior": "RESELL|MANUFACTURED|SERVICE|BUNDLE",
  "is_component": boolean,
  "confidence": number,
  "notes": "string|null"
}

Reglas:
- product_name debe ser un nombre general y reutilizable.
- variant_name debe conservar talla, color, presentacion o capacidad si aplica.
- Si no hay variante clara, usa "Predeterminada".
- suggested_sku solo si viene claramente en la linea; no lo inventes.
- requires_expiration solo true si hay evidencia clara de lote/vencimiento/caducidad.
- Para compras regulares usa inventory_behavior = "RESELL".
- No agregues texto fuera del JSON.

Linea factura:
raw_name: "${rawName}"
sku: "${normalizeText(line?.sku || '') || 'null'}"
quantity: ${Math.max(1, Number(line?.quantity || 1))}
unit_price: ${line?.unit_price == null ? 'null' : Number(line.unit_price || 0)}
line_total: ${line?.line_total == null ? 'null' : Number(line.line_total || 0)}`

  const { data, error } = await supabaseService.client.functions.invoke(edgeFunction, {
    body: {
      model,
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  })

  if (error) {
    const details = await extractInvokeError(error)
    return { success: false, error: `Error invocando ${edgeFunction}: ${details}` }
  }

  const parsed = parseAiJson(data?.content)
  if (!parsed || !normalizeText(parsed?.product_name)) {
    return { success: false, error: 'La IA no devolvio una sugerencia valida para el articulo.' }
  }

  return {
    success: true,
    data: {
      product_name: normalizeText(parsed.product_name),
      variant_name: normalizeText(parsed.variant_name || 'Predeterminada') || 'Predeterminada',
      suggested_sku: normalizeText(parsed.suggested_sku || '') || null,
      requires_expiration: parsed.requires_expiration === true,
      inventory_behavior: normalizeText(parsed.inventory_behavior || 'RESELL').toUpperCase() || 'RESELL',
      is_component: parsed.is_component === true,
      confidence: Number(parsed.confidence || 0),
      notes: normalizeText(parsed.notes || '') || null,
      provider: resolveProviderLabel(edgeFunction, data?.model || model),
      model: data?.model || model,
    },
  }
}

export async function suggestCatalogProductFromInvoiceLine({ tenantId, line }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.', data: buildHeuristicSuggestion(line) }
  }

  const primary = await invokeLineNormalizer({
    edgeFunction: PRIMARY_TEXT_EDGE_FUNCTION,
    model: PRIMARY_TEXT_MODEL,
    line,
  })

  if (primary.success && Number(primary.data?.confidence || 0) >= 0.4) {
    return primary
  }

  const shouldTryFallback =
    FALLBACK_TEXT_EDGE_FUNCTION !== PRIMARY_TEXT_EDGE_FUNCTION
    || FALLBACK_TEXT_MODEL !== PRIMARY_TEXT_MODEL

  if (shouldTryFallback) {
    const fallback = await invokeLineNormalizer({
      edgeFunction: FALLBACK_TEXT_EDGE_FUNCTION,
      model: FALLBACK_TEXT_MODEL,
      line,
    })
    if (fallback.success) {
      return fallback
    }
  }

  if (primary.success) {
    return primary
  }

  return {
    success: true,
    data: buildHeuristicSuggestion(line),
    warning: primary.error || 'Se uso una sugerencia heuristica para crear el articulo.',
  }
}
