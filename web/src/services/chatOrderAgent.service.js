import { supabase } from '@/plugins/supabase'

const CHAT_ORDER_EDGE_FUNCTION =
  import.meta.env.VITE_CHAT_ORDER_EDGE_FUNCTION || 'chat-order-parser'
const DEFAULT_TEXT_MODEL =
  import.meta.env.VITE_DEEPSEEK_TEXT_MODEL || 'deepseek-chat'
const AUTO_MATCH_MIN_CONFIDENCE = 0.72
const SUGGESTION_MIN_CONFIDENCE = 0.45
const MAX_VARIANT_SUGGESTIONS = 3
const CUSTOMER_SUGGESTION_MIN_SCORE = 0.6

const NUMBER_WORDS = new Map([
  ['un', 1],
  ['una', 1],
  ['uno', 1],
  ['dos', 2],
  ['tres', 3],
  ['cuatro', 4],
  ['cinco', 5],
  ['seis', 6],
  ['siete', 7],
  ['ocho', 8],
  ['nueve', 9],
  ['diez', 10],
  ['media', 0.5],
  ['medio', 0.5],
])

const ORDER_NOISE_PATTERNS = [
  /\bpor favor\b/gi,
  /\bgracias\b/gi,
  /\bsi hay\b/gi,
  /\bsi tienes\b/gi,
  /\bsi tiene\b/gi,
  /\bme regalas\b/gi,
  /\bnecesito\b/gi,
  /\bquiero\b/gi,
  /\bquisiera\b/gi,
  /\bpara hoy\b/gi,
  /\bentrega hoy\b/gi,
  /\bpara manana\b/gi,
  /\bpara mañana\b/gi,
  /\bdomicilio\b/gi,
]

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
      if (bodyText?.trim()) fragments.push(bodyText.trim().slice(0, 280))
    }
  } catch (_e) {
    // No-op
  }

  const unique = Array.from(new Set(fragments.filter(Boolean)))
  return unique.join(' | ') || 'Error desconocido'
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSku(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function extractUnitHint(rawName) {
  const match = normalizeWhitespace(rawName).match(/(\d+(?:[.,]\d+)?\s?(?:kg|g|gr|gramos|grs|lb|l|lt|lts|litros|ml|cc|oz|u|und|unds|unidad|unidades))$/i)
  return match ? match[1] : null
}

function cleanupProductName(value) {
  let current = normalizeWhitespace(value)
  for (const pattern of ORDER_NOISE_PATTERNS) {
    current = current.replace(pattern, ' ')
  }

  current = current
    .replace(/^[,;:. -]+/, '')
    .replace(/[,;:. -]+$/, '')
    .replace(/\b(entrega|llevar|mandar)\b.*$/i, '')
    .replace(/\b(hola|buenas|buenos dias|buen día|buen dia|buenas tardes|buenas noches)\b/gi, ' ')

  return normalizeWhitespace(current)
}

function extractCustomerName(text) {
  const patterns = [
    /\b(?:pedido|orden)\s+para\s+([^,:;.\n]+)(?=[:;,.\n]|$)/i,
    /\bpara\s+([^,:;.\n]+)(?=[:;,.\n]|$)/i,
    /\bcliente\s*:?\s*([^,:;.\n]+)(?=[:;,.\n]|$)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const candidate = cleanupProductName(match[1])
      if (candidate.length >= 2) return candidate
    }
  }

  return null
}

function splitOrderSegments(text) {
  const normalized = String(text || '')
    .replace(/\n+/g, ',')
    .replace(/\s*;\s*/g, ',')
    .replace(/\s{2,}/g, ' ')

  const commaSegments = normalized
    .split(',')
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean)

  const segments = []
  for (const segment of commaSegments) {
    const parts = segment
      .split(/\s+y\s+(?=(?:x?\s*\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio|media)\b)/i)
      .map((part) => normalizeWhitespace(part))
      .filter(Boolean)

    segments.push(...parts)
  }

  return segments
}

function parseQuantityPrefix(segment) {
  const cleaned = normalizeWhitespace(segment)
  if (!cleaned) return null

  const colonPayloadMatch = cleaned.match(/^[^:]{1,80}:\s*(.+)$/)
  if (colonPayloadMatch?.[1]) {
    return parseQuantityPrefix(colonPayloadMatch[1])
  }

  let match = cleaned.match(/^(?:x\s*)?(\d+(?:[.,]\d+)?)\s+(.+)$/i)
  if (match) {
    return {
      quantity: Math.max(0.5, Number(String(match[1]).replace(',', '.')) || 1),
      rawName: match[2],
      explicitQuantity: true,
    }
  }

  match = cleaned.match(/^(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio|media)\s+(.+)$/i)
  if (match) {
    return {
      quantity: NUMBER_WORDS.get(match[1].toLowerCase()) || 1,
      rawName: match[2],
      explicitQuantity: true,
    }
  }

  match = cleaned.match(/^(.+?)\s+x\s*(\d+(?:[.,]\d+)?)$/i)
  if (match) {
    return {
      quantity: Math.max(0.5, Number(String(match[2]).replace(',', '.')) || 1),
      rawName: match[1],
      explicitQuantity: true,
    }
  }

  return {
    quantity: 1,
    rawName: cleaned,
    explicitQuantity: false,
  }
}

function parseDeterministicLine(segment) {
  const parsed = parseQuantityPrefix(segment)
  if (!parsed) return null

  const rawName = cleanupProductName(parsed.rawName)
  if (!rawName) return null

  const tokens = tokenize(rawName)
  if (tokens.length === 0) return null

  let confidence = 0.45
  if (parsed.explicitQuantity) confidence += 0.2
  confidence += Math.min(0.25, tokens.length * 0.08)
  if (extractUnitHint(rawName)) confidence += 0.08

  return {
    raw_name: rawName,
    sku: null,
    quantity: Math.max(1, Number(parsed.quantity || 1)),
    unit_hint: extractUnitHint(rawName),
    unit_price: null,
    _parse_confidence: Number(Math.min(0.98, confidence).toFixed(3)),
  }
}

function analyzeChatOrderDeterministic(text) {
  const customerName = extractCustomerName(text)
  let workingText = String(text || '')

  const firstColonIndex = workingText.indexOf(':')
  if (customerName && firstColonIndex >= 0 && firstColonIndex <= 80) {
    workingText = workingText.slice(firstColonIndex + 1)
  }

  workingText = workingText.replace(/^(hola|buenas|buenos dias|buen día|buen dia|buenas tardes|buenas noches)[, ]+/i, '')

  const segments = splitOrderSegments(workingText)
  const items = []

  for (const segment of segments) {
    const cleaned = cleanupProductName(segment)
    if (!cleaned) continue
    if (/^(hola|buenas|buenos dias|buen día|buen dia|buenas tardes|buenas noches)$/i.test(cleaned)) {
      continue
    }

    const line = parseDeterministicLine(cleaned)
    if (line) {
      items.push(line)
    }
  }

  const avgConfidence = items.length
    ? items.reduce((acc, item) => acc + Number(item._parse_confidence || 0), 0) / items.length
    : 0

  return {
    success: items.length > 0,
    data: {
      order: {
        customer_name: customerName,
        notes: null,
        confidence: Number(avgConfidence.toFixed(3)),
      },
      line_items: items,
      model: null,
      usage: null,
      raw: null,
      cache_hit: false,
      parser: 'deterministic',
      parser_confidence: Number(avgConfidence.toFixed(3)),
      fallback_used: false,
    },
  }
}

function shouldUseCloudParser(text, deterministicResult) {
  if (!deterministicResult?.success) return true

  const items = deterministicResult.data?.line_items || []
  if (!items.length) return true

  const parserConfidence = Number(deterministicResult.data?.parser_confidence || 0)
  if (parserConfidence < 0.72) return true

  const textLength = normalizeWhitespace(text).length
  if (textLength > 120 && items.length === 1) return true

  return false
}

async function analyzeChatOrderWithCloud({ tenantId, chatText, fallbackUsed = false, forceRefresh = false }) {
  const text = String(chatText || '').trim()

  const { data, error } = await supabase.functions.invoke(CHAT_ORDER_EDGE_FUNCTION, {
    body: {
      tenant_id: tenantId,
      model: DEFAULT_TEXT_MODEL,
      temperature: 0.1,
      max_tokens: 1800,
      force_refresh: forceRefresh === true,
      chat_text: text.slice(0, 10000)
    }
  })

  if (error) {
    const details = await extractInvokeError(error)
    return {
      success: false,
      error: `Error invocando Edge Function "${CHAT_ORDER_EDGE_FUNCTION}": ${details}.`
    }
  }

  const lineItems = Array.isArray(data?.line_items) ? data.line_items : []
  if (!lineItems.length) {
    return { success: false, error: 'La IA no devolvió ítems para convertir a venta.' }
  }

  const normalized = lineItems
    .map((item) => ({
      raw_name: cleanupProductName(String(item?.raw_name || '').trim()),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unit_hint: item?.unit_hint ? String(item.unit_hint).trim() : null,
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0)
    }))
    .filter((item) => item.raw_name)

  if (!normalized.length) {
    return { success: false, error: 'No se pudieron normalizar ítems válidos del chat.' }
  }

  return {
    success: true,
    data: {
      order: data?.order || {},
      line_items: normalized,
      model: data?.model || null,
      usage: data?.usage || null,
      raw: data?.raw || null,
      cache_hit: Boolean(data?.cache_hit),
      parser: 'llm_cloud',
      parser_confidence: Number(data?.order?.confidence || 0),
      fallback_used: fallbackUsed,
    }
  }
}

const SIZE_TOKENS = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl'])

function normalizeSizeToken(token) {
  const clean = String(token || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (!clean) return null
  if (SIZE_TOKENS.has(clean)) return clean
  return null
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter((t) => t.length >= 2 || SIZE_TOKENS.has(t))
}

function extractSizeTokens(value) {
  const tokens = normalizeText(value).split(' ').filter(Boolean)
  const sizes = new Set()

  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i]
    const next = tokens[i + 1]

    const direct = normalizeSizeToken(current)
    if (direct) sizes.add(direct)

    if (current === 'talla' && next) {
      const hinted = normalizeSizeToken(next)
      if (hinted) sizes.add(hinted)
    }
  }

  return sizes
}

function scoreByTokens(lineText, candidate) {
  const lineTokens = tokenize(lineText)
  if (lineTokens.length === 0) return 0

  const candidateText = `${candidate?.product?.name || ''} ${candidate?.variant_name || ''} ${candidate?.sku || ''}`
  const candidateTokens = tokenize(candidateText)
  if (candidateTokens.length === 0) return 0

  const candidateSet = new Set(candidateTokens)
  const intersection = lineTokens.filter((token) => candidateSet.has(token)).length
  const containmentBonus =
    normalizeText(candidateText).includes(normalizeText(lineText)) ||
    normalizeText(lineText).includes(normalizeText(candidateText))
      ? 0.15
      : 0

  return Math.min(1, intersection / lineTokens.length + containmentBonus)
}

function scoreVariantCandidate(line, candidate) {
  const lineSku = normalizeSku(line?.sku)
  const rawName = String(`${line?.raw_name || line?.name || ''} ${line?.unit_hint || ''}`).trim()
  const normalizedName = normalizeText(rawName)
  const lineSizes = extractSizeTokens(rawName)

  if (lineSku) {
    if (normalizeSku(candidate?.sku) === lineSku) {
      return { candidate, score: 1, matchReason: 'sku_exact' }
    }
  }

  if (normalizedName) {
    const candidateName = normalizeText(`${candidate?.product?.name || ''} ${candidate?.variant_name || ''}`)
    if (candidateName === normalizedName) {
      return { candidate, score: 0.94, matchReason: 'name_exact' }
    }
  }

  let score = scoreByTokens(rawName, candidate)
  let matchReason = 'name_tokens'
  const candidateText = `${candidate?.product?.name || ''} ${candidate?.variant_name || ''} ${candidate?.sku || ''}`
  const candidateSizes = extractSizeTokens(candidateText)

  if (lineSizes.size > 0) {
    if (candidateSizes.size > 0) {
      const hasSizeOverlap = Array.from(lineSizes).some((size) => candidateSizes.has(size))
      if (hasSizeOverlap) {
        score += 0.35
        matchReason = 'name_tokens_size'
      } else {
        score -= 0.35
      }
    } else {
      score -= 0.15
    }
  }

  return {
    candidate,
    score: Number(Math.min(1, Math.max(0, score)).toFixed(3)),
    matchReason,
  }
}

function getVariantSuggestions(line, catalog, limit = MAX_VARIANT_SUGGESTIONS) {
  const list = Array.isArray(catalog) ? catalog : []

  return list
    .map((candidate) => scoreVariantCandidate(line, candidate))
    .filter((entry) => entry.score >= SUGGESTION_MIN_CONFIDENCE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      variant: entry.candidate,
      confidence: entry.score,
      matchReason: entry.matchReason,
    }))
}

function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreCustomerName(targetName, customer) {
  const target = normalizeMatchText(targetName)
  const candidate = normalizeMatchText(customer?.full_name || '')
  if (!target || !candidate) return 0
  if (target === candidate) return 1
  if (candidate.includes(target) || target.includes(candidate)) return 0.92

  const targetTokens = target.split(' ').filter((t) => t.length > 1)
  const candidateTokens = candidate.split(' ').filter((t) => t.length > 1)
  if (!targetTokens.length || !candidateTokens.length) return 0

  const candidateSet = new Set(candidateTokens)
  const common = targetTokens.filter((token) => candidateSet.has(token)).length
  return common / targetTokens.length
}

export function findBestCustomerMatch(targetName, customersList) {
  const list = Array.isArray(customersList) ? customersList : []
  let best = null
  for (const c of list) {
    const score = scoreCustomerName(targetName, c)
    if (!best || score > best.score) best = { customer: c, score }
  }
  if (!best || best.score < CUSTOMER_SUGGESTION_MIN_SCORE) return null
  return best
}

export function matchChatLinesToCatalog(lineItems, catalog) {
  const lines = Array.isArray(lineItems) ? lineItems : []
  const list = Array.isArray(catalog) ? catalog : []

  const matched = []
  const review = []
  const unmatched = []

  for (const line of lines) {
    const suggestions = getVariantSuggestions(line, list)
    const best = suggestions[0]

    if (best?.variant && best.confidence >= AUTO_MATCH_MIN_CONFIDENCE) {
      matched.push({
        line,
        variant: best.variant,
        confidence: best.confidence,
        matchReason: best.matchReason
      })
    } else if (suggestions.length > 0) {
      review.push({
        line,
        confidence: best?.confidence || 0,
        candidates: suggestions
      })
    } else {
      unmatched.push(line)
    }
  }

  return { matched, review, unmatched }
}

export function suggestCatalogMatchesFromChatText(chatText, catalog) {
  const text = String(chatText || '').trim()
  const list = Array.isArray(catalog) ? catalog : []
  if (!text || list.length === 0) return []

  const customerName = extractCustomerName(text)
  let workingText = text
  const firstColonIndex = workingText.indexOf(':')
  if (customerName && firstColonIndex >= 0 && firstColonIndex <= 80) {
    workingText = workingText.slice(firstColonIndex + 1)
  }

  const rawSegments = splitOrderSegments(workingText)
  const seen = new Set()
  const suggestions = []

  for (const segment of rawSegments) {
    const parsed = parseDeterministicLine(segment) || {
      raw_name: cleanupProductName(segment),
      quantity: 1,
      sku: null,
      unit_hint: extractUnitHint(segment),
    }

    const rawName = cleanupProductName(parsed?.raw_name || '')
    if (!rawName || rawName.length < 2) continue
    if (seen.has(rawName)) continue
    seen.add(rawName)

    const candidates = getVariantSuggestions({ ...parsed, raw_name: rawName }, list)
    if (candidates.length > 0) {
      suggestions.push({
        line: {
          raw_name: rawName,
          quantity: Math.max(1, Number(parsed.quantity || 1)),
        },
        confidence: candidates[0].confidence,
        candidates,
      })
    }
  }

  return suggestions
}

export async function analyzeChatOrderText({ tenantId, chatText, forceCloud = false, forceRefresh = false }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' }
  }

  const text = String(chatText || '').trim()
  if (!text) {
    return { success: false, error: 'Escribe o pega un chat para convertir.' }
  }

  if (!forceCloud) {
    const deterministicResult = analyzeChatOrderDeterministic(text)
    if (!shouldUseCloudParser(text, deterministicResult)) {
      return deterministicResult
    }
  }

  return analyzeChatOrderWithCloud({
    tenantId,
    chatText: text,
    fallbackUsed: !forceCloud,
    forceRefresh: forceRefresh === true
  })
}
