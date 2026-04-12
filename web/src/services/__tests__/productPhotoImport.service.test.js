import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const rpcMock = vi.fn()

function buildQuery(result) {
  return {
    select() { return this },
    eq() { return this },
    ilike() { return this },
    or() { return this },
    order() { return this },
    limit() { return Promise.resolve(result) },
    single() { return Promise.resolve(result) },
    maybeSingle() { return Promise.resolve(result) },
  }
}

function buildInsertChain(result) {
  return {
    select() {
      return {
        single: () => Promise.resolve(result),
      }
    },
  }
}

let fromMock = vi.fn()

vi.mock('@/services/supabase.service', () => ({
  default: {
    client: {
      functions: {
        invoke: invokeMock,
      },
      rpc: rpcMock,
      from: (...args) => fromMock(...args),
    },
  },
}))

import { importProductsFromRows, parseProductsFromPhoto } from '@/services/productPhotoImport.service'

describe('productPhotoImport.service', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    rpcMock.mockReset()
    fromMock = vi.fn()
  })

  it('valida tenant e imagen en parseProductsFromPhoto', async () => {
    await expect(parseProductsFromPhoto({ tenantId: null, imageBase64: 'x' })).resolves.toEqual({
      success: false,
      error: 'tenantId es requerido.',
    })

    await expect(parseProductsFromPhoto({ tenantId: 't1', imageBase64: '' })).resolves.toEqual({
      success: false,
      error: 'imageBase64 es requerido.',
    })
  })

  it('normaliza respuesta exitosa del parser por foto', async () => {
    invokeMock.mockResolvedValue({
      data: {
        products: [
          { product_name: 'Jean slim', unit_price: 99000, initial_stock: 8, confidence: 0.91 },
        ],
        warnings: ['texto borroso'],
        model: 'deepseek-chat',
      },
      error: null,
    })

    const result = await parseProductsFromPhoto({ tenantId: 't1', imageBase64: 'abcd' })
    expect(result.success).toBe(true)
    expect(result.data.rows).toHaveLength(1)
    expect(result.data.rows[0].product_name).toBe('Jean slim')
    expect(result.data.warnings).toEqual(['texto borroso'])
  })

  it('retorna error si la edge function falla', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: 'invoke failed',
        context: {
          status: 500,
          clone() { return this },
          json: async () => ({ error: 'boom' }),
        },
      },
    })

    const result = await parseProductsFromPhoto({ tenantId: 't1', imageBase64: 'abcd' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('product-photo-parser')
    expect(result.error).toContain('boom')
  })

  it('importa una fila simple creando producto y variante', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'products') {
        return {
          ...buildQuery({ data: [], error: null }),
          insert: () => buildInsertChain({ data: { product_id: 'p1' }, error: null }),
        }
      }
      if (table === 'product_variants') {
        return {
          ...buildQuery({ data: [], error: null }),
          insert: () => buildInsertChain({ data: { variant_id: 'v1' }, error: null }),
        }
      }
      throw new Error(`tabla no mockeada: ${table}`)
    })

    const result = await importProductsFromRows({
      tenantId: 't1',
      rows: [{ product_name: 'Producto demo', unit_price: 1000, unit_cost: 500 }],
      defaults: {},
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      processed: 1,
      created: 1,
      updated: 0,
      failed: 0,
      errors: [],
      warnings: [],
    })
  })

  it('reporta importacion parcial cuando una fila falla', async () => {
    const result = await importProductsFromRows({
      tenantId: 't1',
      rows: [{ product_name: 'Producto demo' }, { product_name: '' }],
      defaults: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Importacion parcial')
    expect(result.data.failed).toBe(1)
  })
})
