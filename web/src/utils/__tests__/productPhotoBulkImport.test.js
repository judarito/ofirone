import { describe, expect, it } from 'vitest'
import {
  buildProductPhotoImportSummary,
  countValidProductPhotoRows,
  createDraftProductPhotoRow,
  normalizeParsedPhotoProducts,
} from '@/utils/productPhotoBulkImport'

describe('productPhotoBulkImport', () => {
  it('crea filas draft con defaults estables', () => {
    const row = createDraftProductPhotoRow({ product_name: 'Camiseta blanca', unit_price: 45000 })
    expect(row.product_name).toBe('Camiseta blanca')
    expect(row.variant_name).toBe('Predeterminada')
    expect(row.unit_price).toBe('45000')
  })

  it('normaliza productos parseados por foto', () => {
    const result = normalizeParsedPhotoProducts({
      products: [
        { product_name: 'Jean slim', unit_price: 99000, initial_stock: 8 },
        { product_name: '', unit_price: 1000 },
      ],
      warnings: ['Texto poco legible'],
      model: 'deepseek-chat',
    })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].initial_stock).toBe('8')
    expect(result.warnings).toEqual(['Texto poco legible'])
    expect(result.model).toBe('deepseek-chat')
  })

  it('cuenta solo filas validas con precio positivo', () => {
    const rows = [
      createDraftProductPhotoRow({ product_name: 'A', unit_price: 1000 }),
      createDraftProductPhotoRow({ product_name: 'B', unit_price: 0 }),
      createDraftProductPhotoRow({ product_name: '', unit_price: 2000 }),
    ]

    expect(countValidProductPhotoRows(rows)).toBe(1)
  })

  it('resume filas detectadas', () => {
    const rows = [
      createDraftProductPhotoRow({ product_name: 'A', unit_price: 1000 }),
      createDraftProductPhotoRow({ product_name: 'B', unit_price: 2000 }),
      createDraftProductPhotoRow({ product_name: 'C', unit_price: 3000 }),
      createDraftProductPhotoRow({ product_name: 'D', unit_price: '' }),
    ]

    expect(buildProductPhotoImportSummary(rows)).toEqual({
      totalRows: 4,
      validRows: 3,
      invalidRows: 1,
      preview: 'A | B | C',
    })
  })
})
