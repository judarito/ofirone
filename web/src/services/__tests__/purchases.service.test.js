import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()

vi.mock('@/services/supabase.service', () => ({
  default: {
    client: {
      from: fromMock,
    },
  },
}))

vi.mock('@/services/ai-purchase-advisor.service', () => ({
  default: {
    isAvailable: vi.fn(() => true),
    generatePurchaseRecommendations: vi.fn(),
    generateExecutiveSummary: vi.fn(),
  },
}))

import purchasesService from '@/services/purchases.service'

function createAwaitableQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }

  return query
}

describe('purchases.service', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('lista compras formales desde purchases y agrupa sus líneas', async () => {
    const purchasesQuery = createAwaitableQuery({
      data: [{
        purchase_id: 'purchase-1',
        tenant_id: 'tenant-1',
        location_id: 'loc-1',
        created_at: '2026-04-16T10:00:00Z',
        note: 'Compra semanal',
        total: 85000,
        location: { name: 'Principal' },
        supplier: { legal_name: 'Proveedor Demo', trade_name: 'Proveedor Demo', document_number: '900123' },
        created_by_user: { full_name: 'Admin' },
      }],
      error: null,
      count: 1,
    })
    const linesQuery = createAwaitableQuery({
      data: [
        {
          source_id: 'purchase-1',
          quantity: 2,
          unit_cost: 20000,
          variant: {
            sku: 'SKU-1',
            variant_name: 'Azul',
            price: 35000,
            product: { name: 'Camisa' },
          },
        },
        {
          source_id: 'purchase-1',
          quantity: 1,
          unit_cost: 45000,
          variant: {
            sku: 'SKU-2',
            variant_name: 'Negra',
            price: 60000,
            product: { name: 'Pantalón' },
          },
        },
      ],
      error: null,
    })

    fromMock.mockImplementation((table) => {
      if (table === 'purchases') return purchasesQuery
      if (table === 'inventory_moves') return linesQuery
      throw new Error(`tabla no mockeada: ${table}`)
    })

    const result = await purchasesService.getPurchases('tenant-1', 1, 20, {
      location_id: 'loc-1',
    })

    expect(fromMock).toHaveBeenNthCalledWith(1, 'purchases')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'inventory_moves')
    expect(purchasesQuery.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-1')
    expect(purchasesQuery.eq).toHaveBeenNthCalledWith(2, 'location_id', 'loc-1')
    expect(linesQuery.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-1')
    expect(linesQuery.eq).toHaveBeenNthCalledWith(2, 'move_type', 'PURCHASE_IN')
    expect(linesQuery.in).toHaveBeenCalledWith('source_id', ['purchase-1'])
    expect(result).toEqual({
      success: true,
      data: [{
        purchase_id: 'purchase-1',
        supplier_name: 'Proveedor Demo',
        supplier_document: '900123',
        items_count: 2,
        items_summary: 'Camisa - Azul +1 item',
        qty_total: 3,
        sku: 'SKU-1',
        variant_name: 'Azul',
        product_name: 'Camisa',
        location_name: 'Principal',
        total: 85000,
        purchased_at: '2026-04-16T10:00:00Z',
        purchased_by_name: 'Admin',
        note: 'Compra semanal',
        current_price: 35000,
      }],
      total: 1,
    })
  })
})
