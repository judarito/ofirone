import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.fn()
const fromMock = vi.fn()
const serviceErrorResultMock = vi.fn((error, extra = {}) => ({
  success: false,
  error: error?.message || 'unknown',
  ...extra,
}))

vi.mock('@/services/supabase.service', () => ({
  default: {
    client: {
      rpc: rpcMock,
      from: fromMock,
    },
  },
}))

vi.mock('@/utils/appErrors', () => ({
  serviceErrorResult: serviceErrorResultMock,
}))

import inventoryService from '@/services/inventory.service'

function createAwaitableQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }

  return query
}

describe('inventory.service', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
    serviceErrorResultMock.mockClear()
  })

  it('consulta kardex desde vw_kardex y expande el filtro de ajustes', async () => {
    const kardexQuery = createAwaitableQuery({
      data: [{
        inventory_move_id: 'move-1',
        tenant_id: 'tenant-1',
        location_id: 'loc-1',
        location_name: 'Principal',
        to_location_id: null,
        to_location_name: null,
        variant_id: 'var-1',
        sku: 'SKU-1',
        product_id: 'prd-1',
        product_name: 'Camisa',
        variant_name: 'Azul',
        move_type: 'ADJUSTMENT_OUT',
        source: 'MANUAL',
        source_id: null,
        signed_qty: -3,
        abs_qty: 3,
        unit_cost: 15000,
        note: 'Rotura',
        created_by: 'user-1',
        created_by_name: 'Admin',
        created_at: '2026-04-16T10:00:00Z',
      }],
      error: null,
      count: 1,
    })

    fromMock.mockReturnValue(kardexQuery)

    const result = await inventoryService.getInventoryMoves('tenant-1', 1, 20, {
      location_id: 'loc-1',
      move_type: 'ADJUSTMENT',
    })

    expect(fromMock).toHaveBeenCalledWith('vw_kardex')
    expect(kardexQuery.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-1')
    expect(kardexQuery.eq).toHaveBeenNthCalledWith(2, 'location_id', 'loc-1')
    expect(kardexQuery.in).toHaveBeenCalledWith('move_type', ['ADJUSTMENT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'])
    expect(result).toEqual({
      success: true,
      data: [{
        inventory_move_id: 'move-1',
        tenant_id: 'tenant-1',
        location_id: 'loc-1',
        location_name: 'Principal',
        to_location_id: null,
        to_location_name: null,
        variant_id: 'var-1',
        sku: 'SKU-1',
        product_id: 'prd-1',
        product_name: 'Camisa',
        variant_name: 'Azul',
        move_type: 'ADJUSTMENT_OUT',
        source: 'MANUAL',
        source_id: null,
        signed_qty: -3,
        abs_qty: 3,
        quantity: 3,
        unit_cost: 15000,
        note: 'Rotura',
        created_by: 'user-1',
        created_by_name: 'Admin',
        created_at: '2026-04-16T10:00:00Z',
        location: { name: 'Principal' },
        to_location: null,
        variant: {
          sku: 'SKU-1',
          variant_name: 'Azul',
          product: { name: 'Camisa' },
        },
        created_by_user: { full_name: 'Admin' },
      }],
      total: 1,
    })
  })

  it('crea ajustes manuales con rpc atómico y refresca alertas', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: 'move-2', error: null })
      .mockResolvedValueOnce({ error: null })

    const result = await inventoryService.createManualAdjustment('tenant-1', {
      location_id: 'loc-1',
      variant_id: 'var-1',
      quantity: 2,
      unit_cost: 5000,
      is_increase: false,
      note: 'Ajuste de salida',
      created_by: 'user-1',
    })

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'sp_create_inventory_adjustment', {
      p_tenant: 'tenant-1',
      p_location: 'loc-1',
      p_variant: 'var-1',
      p_quantity: 2,
      p_unit_cost: 5000,
      p_is_increase: false,
      p_created_by: 'user-1',
      p_note: 'Ajuste de salida',
    })
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'fn_refresh_stock_alerts')
    expect(result).toEqual({ success: true, data: 'move-2' })
  })

  it('crea ingresos manuales por compra con rpc específico', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: 'move-3', error: null })
      .mockResolvedValueOnce({ error: null })

    const result = await inventoryService.createPurchaseEntry('tenant-1', {
      location_id: 'loc-1',
      variant_id: 'var-1',
      quantity: 4,
      unit_cost: 12000,
      note: 'Ingreso rápido',
      created_by: 'user-1',
    })

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'sp_create_manual_purchase_ingress', {
      p_tenant: 'tenant-1',
      p_location: 'loc-1',
      p_variant: 'var-1',
      p_quantity: 4,
      p_unit_cost: 12000,
      p_created_by: 'user-1',
      p_note: 'Ingreso rápido',
    })
    expect(result).toEqual({ success: true, data: 'move-3' })
  })
})
