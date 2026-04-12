import { describe, expect, it } from 'vitest'
import {
  buildPurchaseInvoiceSummary,
  buildPurchaseLinesFromInvoiceMatches,
  findBestSupplierCandidate,
  matchInvoiceLinesToCatalog,
} from '@/utils/purchaseInvoiceOcr'

const catalog = [
  {
    variant_id: 'v1',
    sku: 'CAM-M',
    variant_name: 'Talla M',
    requires_expiration: false,
    cost: 28000,
    product: { name: 'Camiseta blanca' },
  },
  {
    variant_id: 'v2',
    sku: 'CAM-L',
    variant_name: 'Talla L',
    requires_expiration: false,
    cost: 28000,
    product: { name: 'Camiseta blanca' },
  },
]

describe('purchaseInvoiceOcr', () => {
  it('hace match exacto por sku', () => {
    const result = matchInvoiceLinesToCatalog([
      { raw_name: 'Camiseta blanca talla M', sku: 'CAM-M', quantity: 2, unit_price: 30000 },
    ], catalog)

    expect(result.matched).toHaveLength(1)
    expect(result.matched[0].variant.variant_id).toBe('v1')
    expect(result.unmatched).toHaveLength(0)
  })

  it('evita match cuando la talla no coincide', () => {
    const result = matchInvoiceLinesToCatalog([
      { raw_name: 'Camiseta blanca talla S', quantity: 1 },
    ], catalog)

    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })

  it('construye lineas de compra usando costo de la factura', () => {
    const [line] = buildPurchaseLinesFromInvoiceMatches([
      {
        line: { raw_name: 'Camiseta blanca talla M', quantity: 2, unit_price: 31000 },
        variant: catalog[0],
        confidence: 0.9,
        matchReason: 'sku_exact',
      },
    ])

    expect(line.variant_id).toBe('v1')
    expect(line.qty).toBe(2)
    expect(line.unit_cost).toBe(31000)
    expect(line.product_name).toBe('Camiseta blanca')
  })

  it('encuentra proveedor por nombre parecido', () => {
    const supplier = findBestSupplierCandidate(
      { vendor_name: 'Distribuidora Textil SAS' },
      [
        { third_party_id: 'a', legal_name: 'Distribuidora Textil S.A.S.' },
        { third_party_id: 'b', legal_name: 'Proveedor Alterno' },
      ],
    )

    expect(supplier?.supplier?.third_party_id).toBe('a')
    expect(supplier?.confidence).toBeGreaterThan(0.8)
  })

  it('resume el resultado de la importacion OCR', () => {
    const summary = buildPurchaseInvoiceSummary({
      analysis: {
        invoice: { vendor_name: 'Distribuidora Textil', invoice_number: 'FAC-123', total: 62000 },
        line_items: [
          { raw_name: 'Camiseta blanca talla M', quantity: 2 },
          { raw_name: 'Camiseta blanca talla L', quantity: 1 },
        ],
      },
      matched: [{}, {}],
      unmatched: [{}],
    })

    expect(summary.vendorName).toBe('Distribuidora Textil')
    expect(summary.invoiceNumber).toBe('FAC-123')
    expect(summary.totalLines).toBe(2)
    expect(summary.matchedCount).toBe(2)
    expect(summary.unmatchedCount).toBe(1)
    expect(summary.totalEstimate).toBe(62000)
  })
})
