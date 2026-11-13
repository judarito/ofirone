import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { listBackendInventoryMovesMock, listBackendStockBalancesMock, createBackendInventoryMovementMock, serviceErrorResultMock } = vi.hoisted(() => ({
  listBackendInventoryMovesMock: vi.fn(),
  listBackendStockBalancesMock: vi.fn(),
  createBackendInventoryMovementMock: vi.fn(),
  serviceErrorResultMock: vi.fn((error, extra = {}) => ({ success: false, error: error?.message || 'unknown', ...extra })),
}))

vi.mock('@/services/backendInventoryClient', () => ({
  listBackendInventoryMoves: listBackendInventoryMovesMock,
  createBackendInventoryMovement: createBackendInventoryMovementMock,
}))

vi.mock('@/services/backendDomainClient', () => ({
  listBackendStockBalances: listBackendStockBalancesMock,
}))

vi.mock('@/services/supabase.service', () => ({
  default: { client: { rpc: vi.fn(), from: vi.fn() } },
}))

vi.mock('@/utils/appErrors', () => ({
  serviceErrorResult: serviceErrorResultMock,
}))

async function loadService() {
  vi.resetModules()
  vi.stubEnv('VITE_USE_BACKEND_INVENTORY', 'true')
  return import('@/services/inventory.service')
}

describe('inventory.service in Go mode', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    listBackendInventoryMovesMock.mockReset()
    listBackendStockBalancesMock.mockReset()
    createBackendInventoryMovementMock.mockReset()
    serviceErrorResultMock.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('aplica filtros y recorre el cursor sin repetir ni omitir páginas del Kardex', async () => {
    listBackendInventoryMovesMock
      .mockResolvedValueOnce({
        items: [{ movement_id: 'move-1', movement_type: 'purchase_in', quantity_delta: 5, location_name: 'Principal', sku: 'SKU-1', product_name: 'Producto' }],
        has_more: true,
        next_occurred_at: '2026-11-13T10:00:00Z',
        next_id: 'move-1',
      })
      .mockResolvedValueOnce({
        items: [{ movement_id: 'move-2', movement_type: 'sale_out', quantity_delta: -1, location_name: 'Principal', sku: 'SKU-1', product_name: 'Producto' }],
        has_more: false,
      })

    const { default: service } = await loadService()
    const result = await service.getInventoryMoves('tenant-1', 2, 1, {
      location_id: 'loc-1',
      move_type: 'PURCHASE_IN',
    })

    expect(listBackendInventoryMovesMock).toHaveBeenCalledTimes(2)
    expect(listBackendInventoryMovesMock).toHaveBeenNthCalledWith(1, {
      limit: 1,
      locationId: 'loc-1',
      variantId: undefined,
      moveType: 'PURCHASE_IN',
      afterOccurredAt: null,
      afterId: null,
    })
    expect(listBackendInventoryMovesMock).toHaveBeenNthCalledWith(2, {
      limit: 1,
      locationId: 'loc-1',
      variantId: undefined,
      moveType: 'PURCHASE_IN',
      afterOccurredAt: '2026-11-13T10:00:00Z',
      afterId: 'move-1',
    })
    expect(result.data[0]).toEqual(expect.objectContaining({
      inventory_move_id: 'move-2',
      signed_qty: -1,
      location: { name: 'Principal' },
      variant: expect.objectContaining({
        sku: 'SKU-1',
        product: expect.objectContaining({ name: 'Producto' }),
      }),
    }))
    expect(result.total).toBe(2)
  })
})
