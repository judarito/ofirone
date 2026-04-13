import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@/services/supabase.service', () => ({
  default: {
    client: {
      functions: {
        invoke: invokeMock,
      },
    },
  },
}))

import { suggestCatalogProductFromInvoiceLine } from '@/services/purchaseInvoiceAssistant.service'

describe('purchaseInvoiceAssistant.service', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('retorna error controlado cuando falta tenant', async () => {
    const result = await suggestCatalogProductFromInvoiceLine({
      tenantId: null,
      line: { raw_name: 'Jean azul' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('tenantId es requerido.')
    expect(result.data.product_name).toBe('Jean azul')
  })

  it('normaliza una sugerencia valida de IA', async () => {
    invokeMock.mockResolvedValue({
      data: {
        content: JSON.stringify({
          product_name: 'Jean',
          variant_name: 'Azul talla 32',
          suggested_sku: 'JEA-032',
          requires_expiration: false,
          inventory_behavior: 'RESELL',
          is_component: false,
          confidence: 0.82,
          notes: 'Detectado desde factura',
        }),
        model: 'deepseek-chat',
      },
      error: null,
    })

    const result = await suggestCatalogProductFromInvoiceLine({
      tenantId: 't1',
      line: { raw_name: 'Jean azul talla 32', quantity: 2, unit_price: 90000 },
    })

    expect(invokeMock).toHaveBeenCalledWith('deepseek-proxy', expect.any(Object))
    expect(result).toEqual({
      success: true,
      data: {
        product_name: 'Jean',
        variant_name: 'Azul talla 32',
        suggested_sku: 'JEA-032',
        requires_expiration: false,
        inventory_behavior: 'RESELL',
        is_component: false,
        confidence: 0.82,
        notes: 'Detectado desde factura',
        provider: 'deepseek',
        model: 'deepseek-chat',
      },
    })
  })

  it('usa fallback heuristico cuando la IA falla', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: 'invoke failed',
        context: {
          status: 502,
          clone() { return this },
          text: async () => 'bad gateway',
        },
      },
    })

    const result = await suggestCatalogProductFromInvoiceLine({
      tenantId: 't1',
      line: { raw_name: 'Blusa estampada' },
    })

    expect(result.success).toBe(true)
    expect(result.data.product_name).toBe('Blusa estampada')
    expect(result.data.provider).toBe('heuristic')
    expect(result.warning).toContain('deepseek-proxy')
  })
})
