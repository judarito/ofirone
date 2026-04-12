import { createEmptyPurchaseLine } from '@/utils/purchasesShared'

export function mergeInvoiceLinesIntoDraft(draftLines = [], importedLines = []) {
  const lines = (Array.isArray(draftLines) ? draftLines : []).map((item) => ({ ...item }))

  for (const item of Array.isArray(importedLines) ? importedLines : []) {
    const existing = lines.find((line) => line.variant_id === item?.variant_id)
    if (existing) {
      existing.qty = Number(existing.qty || 0) + Number(item?.qty || 0)
      if (Number(item?.unit_cost || 0) > 0) {
        existing.unit_cost = Number(item.unit_cost)
      }
      existing.label = item.label || existing.label || null
      existing.product_name = item.product_name || existing.product_name || null
      existing.variant_name = item.variant_name || existing.variant_name || null
      existing.sku = item.sku || existing.sku || null
    } else {
      lines.push(createEmptyPurchaseLine(item))
    }
  }

  return lines
}

export function buildInvoiceImportViewState({ analysisSummary = {}, supplierMatch = null, unmatched = [] } = {}) {
  return {
    ...analysisSummary,
    autoSupplierName: supplierMatch?.supplier?.legal_name || supplierMatch?.supplier?.commercial_name || null,
    supplierConfidence: supplierMatch?.confidence ?? null,
    unmatchedPreview: (Array.isArray(unmatched) ? unmatched : []).slice(0, 6),
  }
}
