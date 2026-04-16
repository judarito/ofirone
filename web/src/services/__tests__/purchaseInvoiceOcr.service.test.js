import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const ensureFeatureAccessMock = vi.fn()

vi.mock('@/services/supabase.service', () => ({
  default: {
    client: {
      functions: {
        invoke: invokeMock,
      },
    },
  },
}))

vi.mock('@/services/tenantBilling.service', () => ({
  default: {
    ensureFeatureAccess: ensureFeatureAccessMock,
  },
}))

import { analyzeInvoiceFile, analyzeInvoiceWithText } from '@/services/purchaseInvoiceOcr.service'

describe('purchaseInvoiceOcr.service', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    ensureFeatureAccessMock.mockReset()
    ensureFeatureAccessMock.mockResolvedValue({ success: true, data: null })
  })

  it('valida tenant y texto OCR', async () => {
    await expect(analyzeInvoiceWithText({ tenantId: null, ocrText: 'abc' })).resolves.toEqual({
      success: false,
      error: 'tenantId es requerido.',
    })

    await expect(analyzeInvoiceWithText({ tenantId: 't1', ocrText: '   ' })).resolves.toEqual({
      success: false,
      error: 'No hay texto OCR para analizar.',
    })
  })

  it('normaliza respuesta exitosa de IA', async () => {
    invokeMock.mockResolvedValue({
      data: {
        content: JSON.stringify({
          invoice: { vendor_name: 'Proveedor Demo', invoice_number: 'FAC-1' },
          line_items: [
            { raw_name: 'Camiseta blanca talla M', quantity: 2, unit_price: 30000 },
          ],
        }),
        model: 'deepseek-chat',
      },
      error: null,
    })

    const result = await analyzeInvoiceWithText({ tenantId: 't1', ocrText: 'texto ocr' })

    expect(invokeMock).toHaveBeenCalledWith('deepseek-proxy', expect.any(Object))
    expect(result.success).toBe(true)
    expect(result.data.invoice.vendor_name).toBe('Proveedor Demo')
    expect(result.data.line_items).toEqual([
      {
        raw_name: 'Camiseta blanca talla M',
        sku: null,
        quantity: 2,
        unit_price: 30000,
        line_total: null,
      },
    ])
  })

  it('reporta error enriquecido cuando falla la invocacion', async () => {
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

    const result = await analyzeInvoiceWithText({ tenantId: 't1', ocrText: 'texto ocr' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('deepseek-proxy')
    expect(result.error).toContain('bad gateway')
  })

  it('bloquea OCR por billing antes de invocar la edge function', async () => {
    ensureFeatureAccessMock.mockResolvedValue({
      success: false,
      error: 'Tu plan actual no incluye OCR de facturas.',
    })

    await expect(analyzeInvoiceWithText({ tenantId: 't1', ocrText: 'texto ocr' })).resolves.toEqual({
      success: false,
      error: 'Tu plan actual no incluye OCR de facturas.',
    })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('bloquea OCR de archivo por billing antes de procesar la imagen', async () => {
    ensureFeatureAccessMock.mockResolvedValue({
      success: false,
      error: 'Tu plan actual no incluye OCR de facturas.',
    })

    await expect(analyzeInvoiceFile({ tenantId: 't1', file: {} })).resolves.toEqual({
      success: false,
      error: 'Tu plan actual no incluye OCR de facturas.',
    })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('falla cuando la IA no devuelve JSON usable', async () => {
    invokeMock.mockResolvedValue({
      data: { content: 'sin json' },
      error: null,
    })

    await expect(analyzeInvoiceWithText({ tenantId: 't1', ocrText: 'texto ocr' })).resolves.toEqual({
      success: false,
      error: 'No se pudo parsear la respuesta de IA para la factura.',
    })
  })
})
