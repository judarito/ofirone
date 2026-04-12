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

const SIZE_TOKENS = new Set([
  'xs',
  's',
  'm',
  'l',
  'xl',
  'xxl',
  'xxxl',
  '2xl',
  '3xl',
  '4xl',
])

const MATCH_STOP_TOKENS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'en',
  'con',
  'por',
  'para',
  'un',
  'una',
])

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
    .filter((token) => !MATCH_STOP_TOKENS.has(token))
    .filter((token) => token.length >= 2 || SIZE_TOKENS.has(token))
}

function extractSizeTokens(value) {
  const tokens = normalizeText(value).split(' ').filter(Boolean)
  const sizes = new Set()

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index]
    const next = tokens[index + 1]

    const direct = normalizeSizeToken(current)
    if (direct) sizes.add(direct)

    if (current === 'talla' && next) {
      const hinted = normalizeSizeToken(next)
      if (hinted) sizes.add(hinted)
    }
  }

  return sizes
}

function normalizeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeLineItems(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : [])
    .map((item) => ({
      raw_name: String(item?.raw_name || item?.name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
      line_total: item?.line_total == null ? null : Number(item.line_total || 0),
    }))
    .filter((item) => item.raw_name)
}

export function normalizeInvoiceAnalysisPayload(payload = {}) {
  return {
    invoice: payload?.invoice || {},
    line_items: normalizeLineItems(payload?.line_items),
    ocr_text: String(payload?.ocr_text || '').trim() || null,
    model: payload?.model ? String(payload.model) : null,
  }
}

function scoreByTokens(lineText, candidate) {
  const lineTokens = tokenize(lineText)
  if (lineTokens.length === 0) return 0

  const candidateNameText = `${candidate?.product?.name || ''} ${candidate?.variant_name || ''}`.trim()
  const candidateSkuText = `${candidate?.sku || ''}`.trim()
  const candidateNameTokens = tokenize(candidateNameText)
  if (candidateNameTokens.length === 0) return 0

  const normalizedLine = normalizeText(lineText)
  const normalizedCandidateName = normalizeText(candidateNameText)
  const nameTokenSet = new Set(candidateNameTokens)
  const skuTokenSet = new Set(tokenize(candidateSkuText))

  const nameIntersectionTokens = lineTokens.filter((token) => nameTokenSet.has(token))
  const skuIntersectionTokens = lineTokens.filter((token) => skuTokenSet.has(token))
  const nameIntersection = nameIntersectionTokens.length
  const strongNameOverlap = nameIntersectionTokens.filter((token) => token.length >= 4 || SIZE_TOKENS.has(token)).length
  const containmentBonus =
    normalizedCandidateName.includes(normalizedLine) || normalizedLine.includes(normalizedCandidateName)
      ? 0.12
      : 0

  if (nameIntersection === 0 && containmentBonus === 0) {
    return 0
  }

  let score = nameIntersection / lineTokens.length

  if (strongNameOverlap > 0) {
    score += 0.08
  }

  if (skuIntersectionTokens.length > 0 && nameIntersection > 0) {
    score += 0.04
  }

  return Math.min(1, score + containmentBonus)
}

function findBestVariantMatch(line, catalog) {
  const lineSku = normalizeSku(line?.sku)
  const rawName = String(`${line?.raw_name || line?.name || ''} ${line?.unit_hint || ''}`).trim()
  const normalizedName = normalizeText(rawName)
  const lineSizes = extractSizeTokens(rawName)

  if (lineSku) {
    const bySku = catalog.find((item) => normalizeSku(item?.sku) === lineSku)
    if (bySku) {
      return { variant: bySku, confidence: 1, matchReason: 'sku_exact' }
    }
  }

  if (normalizedName) {
    const exactName = catalog.find((item) => {
      const candidate = normalizeText(`${item?.product?.name || ''} ${item?.variant_name || ''}`)
      return candidate === normalizedName
    })
    if (exactName) {
      return { variant: exactName, confidence: 0.94, matchReason: 'name_exact' }
    }
  }

  let candidates = Array.isArray(catalog) ? [...catalog] : []
  if (lineSizes.size > 0) {
    const sizedCandidates = candidates.filter((candidate) => {
      const candidateText = `${candidate?.product?.name || ''} ${candidate?.variant_name || ''} ${candidate?.sku || ''}`
      return extractSizeTokens(candidateText).size > 0
    })
    const withOverlappingSize = sizedCandidates.filter((candidate) => {
      const candidateText = `${candidate?.product?.name || ''} ${candidate?.variant_name || ''} ${candidate?.sku || ''}`
      const candidateSizes = extractSizeTokens(candidateText)
      return Array.from(lineSizes).some((size) => candidateSizes.has(size))
    })

    if (sizedCandidates.length > 0 && withOverlappingSize.length === 0) {
      return null
    }

    if (withOverlappingSize.length > 0) {
      candidates = withOverlappingSize
    }
  }

  let best = null
  for (const candidate of candidates) {
    let score = scoreByTokens(rawName, candidate)
    const candidateText = `${candidate?.product?.name || ''} ${candidate?.variant_name || ''} ${candidate?.sku || ''}`
    const candidateSizes = extractSizeTokens(candidateText)

    if (lineSizes.size > 0 && candidateSizes.size > 0) {
      const hasSizeOverlap = Array.from(lineSizes).some((size) => candidateSizes.has(size))
      if (hasSizeOverlap) score += 0.35
      else score -= 0.35
    }

    if (lineSizes.size > 0 && candidateSizes.size === 0) {
      score -= 0.15
    }

    if (!best || score > best.score) {
      best = { candidate, score }
    }
  }

  if (best && best.score >= 0.52) {
    return {
      variant: best.candidate,
      confidence: Number(Math.min(1, Math.max(0, best.score)).toFixed(3)),
      matchReason: 'name_tokens',
    }
  }

  return null
}

export function matchInvoiceLinesToCatalog(lineItems, catalog, options = {}) {
  const lines = normalizeLineItems(lineItems)
  const list = Array.isArray(catalog) ? catalog : []
  const configuredMinTokenConfidence = Number(options?.minTokenConfidence)
  const minTokenConfidence = Number.isFinite(configuredMinTokenConfidence)
    ? Math.max(0, Math.min(1, configuredMinTokenConfidence))
    : 0.42

  const matched = []
  const unmatched = []

  for (const line of lines) {
    const best = findBestVariantMatch(line, list)
    if (best?.variant) {
      const isWeakTokenMatch =
        best.matchReason === 'name_tokens' &&
        Number(best.confidence || 0) < minTokenConfidence
      if (isWeakTokenMatch) {
        unmatched.push(line)
        continue
      }
      matched.push({
        line,
        variant: best.variant,
        confidence: best.confidence,
        matchReason: best.matchReason,
      })
    } else {
      unmatched.push(line)
    }
  }

  return { matched, unmatched }
}

function resolveInvoiceUnitCost(line, variant) {
  const quantity = Math.max(1, Number(line?.quantity || 1))
  const unitPrice = normalizeNumber(line?.unit_price)
  if (unitPrice != null && unitPrice >= 0) return unitPrice

  const lineTotal = normalizeNumber(line?.line_total)
  if (lineTotal != null && lineTotal >= 0) {
    return Number((lineTotal / quantity).toFixed(2))
  }

  const variantCost = normalizeNumber(variant?.cost)
  if (variantCost != null && variantCost >= 0) return variantCost

  return 0
}

export function buildPurchaseLinesFromInvoiceMatches(matched = []) {
  return (Array.isArray(matched) ? matched : []).map((entry) => {
    const line = entry?.line || {}
    const variant = entry?.variant || {}
    return {
      variant_id: variant.variant_id || null,
      qty: Math.max(1, Number(line.quantity || 1)),
      unit_cost: resolveInvoiceUnitCost(line, variant),
      requires_expiration: !!variant.requires_expiration,
      batch_number: '',
      expiration_date: null,
      physical_location: '',
      label: `${variant?.product?.name || 'Producto'}${variant?.variant_name ? ` - ${variant.variant_name}` : ''}`,
      product_name: variant?.product?.name || 'Producto',
      variant_name: variant?.variant_name || '',
      sku: variant?.sku || null,
      source: 'invoice_ocr',
      invoice_confidence: Number(entry?.confidence || 0),
      invoice_match_reason: entry?.matchReason || null,
      invoice_raw_name: line.raw_name || '',
    }
  }).filter((item) => item.variant_id)
}

export function findBestSupplierCandidate(invoice = {}, suppliers = []) {
  const vendorName = String(invoice?.vendor_name || '').trim()
  if (!vendorName) return null

  const normalizedVendor = normalizeText(vendorName)
  if (!normalizedVendor) return null

  const list = Array.isArray(suppliers) ? suppliers : []
  let best = null

  for (const supplier of list) {
    const candidateTexts = [
      supplier?.legal_name,
      supplier?.commercial_name,
      supplier?.document_number,
      supplier?.email,
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)

    for (const candidateText of candidateTexts) {
      const normalizedCandidate = normalizeText(candidateText)
      if (!normalizedCandidate) continue

      let score = 0
      if (normalizedCandidate === normalizedVendor) score = 1
      else if (
        normalizedCandidate.includes(normalizedVendor) ||
        normalizedVendor.includes(normalizedCandidate)
      ) score = 0.82
      else {
        const vendorTokens = tokenize(vendorName)
        const candidateTokens = new Set(tokenize(candidateText))
        const overlap = vendorTokens.filter((token) => candidateTokens.has(token)).length
        if (vendorTokens.length > 0) {
          score = overlap / vendorTokens.length
        }
      }

      if (!best || score > best.score) {
        best = { supplier, score }
      }
    }
  }

  if (!best || best.score < 0.55) return null

  return {
    supplier: best.supplier,
    confidence: Number(best.score.toFixed(3)),
    vendor_name: vendorName,
  }
}

export function buildPurchaseInvoiceSummary({
  analysis = {},
  matched = [],
  unmatched = [],
} = {}) {
  const normalized = normalizeInvoiceAnalysisPayload(analysis)
  const vendorName = String(normalized?.invoice?.vendor_name || '').trim() || null
  const invoiceNumber = String(normalized?.invoice?.invoice_number || '').trim() || null
  const preview = normalized.ocr_text
    ? normalized.ocr_text.slice(0, 180)
    : normalized.line_items
      .slice(0, 4)
      .map((item) => `${item.quantity} ${item.raw_name}`)
      .join(' | ')
      .slice(0, 180)

  return {
    vendorName,
    invoiceNumber,
    totalLines: normalized.line_items.length,
    matchedCount: Array.isArray(matched) ? matched.length : 0,
    unmatchedCount: Array.isArray(unmatched) ? unmatched.length : 0,
    totalEstimate: normalizeNumber(normalized?.invoice?.total),
    preview: preview || null,
  }
}
