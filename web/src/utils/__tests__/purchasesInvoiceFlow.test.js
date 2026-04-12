import { describe, expect, it } from 'vitest'
import {
  buildInvoiceImportViewState,
  mergeInvoiceLinesIntoDraft,
} from '@/utils/purchasesInvoiceFlow'

describe('purchasesInvoiceFlow', () => {
  it('fusiona lineas importadas con el borrador existente', () => {
    const merged = mergeInvoiceLinesIntoDraft(
      [{ variant_id: 'v1', qty: 1, unit_cost: 1000, label: 'Base' }],
      [
        { variant_id: 'v1', qty: 2, unit_cost: 1500, label: 'Base nueva' },
        { variant_id: 'v2', qty: 1, unit_cost: 800, product_name: 'Nuevo' },
      ],
    )

    expect(merged).toHaveLength(2)
    expect(merged[0].qty).toBe(3)
    expect(merged[0].unit_cost).toBe(1500)
    expect(merged[0].label).toBe('Base nueva')
    expect(merged[1].variant_id).toBe('v2')
  })

  it('construye el estado visible del resumen OCR', () => {
    const viewState = buildInvoiceImportViewState({
      analysisSummary: { matchedCount: 2, unmatchedCount: 3, vendorName: 'ACME' },
      supplierMatch: {
        confidence: 0.87,
        supplier: { legal_name: 'ACME SAS' },
      },
      unmatched: [{ raw_name: 'A' }, { raw_name: 'B' }, { raw_name: 'C' }, { raw_name: 'D' }],
    })

    expect(viewState.autoSupplierName).toBe('ACME SAS')
    expect(viewState.supplierConfidence).toBe(0.87)
    expect(viewState.unmatchedPreview).toHaveLength(4)
    expect(viewState.vendorName).toBe('ACME')
  })
})
