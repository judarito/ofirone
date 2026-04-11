import { describe, expect, it } from 'vitest'
import {
  buildProductPhotoAiSummary,
  buildProductPhotoStoragePath,
  normalizeProductPhotoAiData,
} from '../productMediaHelpers'

describe('productMediaHelpers', () => {
  it('normaliza payload IA para guardar en product_media', () => {
    const normalized = normalizeProductPhotoAiData({
      suggested_name: 'Camiseta negra',
      suggested_category: 'Ropa',
      suggested_brand: 'Ofir',
      suggested_description: 'Prenda casual',
      labels: ['camiseta', 'negra'],
    })

    expect(normalized.ai_status).toBe('READY')
    expect(normalized.ai_detected_name).toBe('Camiseta negra')
    expect(normalized.ai_detected_category).toBe('Ropa')
    expect(normalized.ai_labels).toEqual(['camiseta', 'negra'])
  })

  it('arma un resumen IA legible', () => {
    expect(buildProductPhotoAiSummary({
      suggested_name: 'Termo 500ml',
      suggested_brand: 'Acero Plus',
    })).toContain('Nombre sugerido')
  })

  it('genera storage paths deterministas', () => {
    expect(buildProductPhotoStoragePath({
      tenantId: 'tenant-1',
      productId: 'product-9',
      timestampMs: 123,
      token: 'abc',
      extension: 'jpg',
    })).toBe('tenant-1/product-9/123_abc.jpg')
  })
})
