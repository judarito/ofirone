import { describe, expect, it } from 'vitest'
import {
  applyPhotoAnalysisToState,
  buildPhotoImportFeedback,
  removePhotoDraftRow,
  updatePhotoDraftRow,
} from '@/utils/bulkImportPhotoFlow'

describe('bulkImportPhotoFlow', () => {
  it('normaliza el resultado del analisis por foto', () => {
    const state = applyPhotoAnalysisToState({
      rows: [{ local_id: '1' }, { local_id: '2' }],
      warnings: ['borroso'],
      model: 'deepseek-chat',
      usage: { total_tokens: 100 },
    })

    expect(state.rows).toHaveLength(2)
    expect(state.warnings).toEqual(['borroso'])
    expect(state.meta.model).toBe('deepseek-chat')
    expect(state.shouldOpenPreview).toBe(true)
  })

  it('actualiza y elimina filas draft', () => {
    const updated = updatePhotoDraftRow([{ product_name: 'A' }, { product_name: 'B' }], 1, 'product_name', 'C')
    expect(updated[1].product_name).toBe('C')

    const removed = removePhotoDraftRow(updated, 0)
    expect(removed).toEqual([{ product_name: 'C' }])
  })

  it('construye mensajes de feedback para importacion', () => {
    expect(buildPhotoImportFeedback({ processed: 5, failed: 0 })).toEqual({
      color: 'success',
      message: 'Importacion completada: 5 fila(s) procesadas.',
    })

    expect(buildPhotoImportFeedback({ processed: 3, failed: 2 })).toEqual({
      color: 'warning',
      message: 'Importacion parcial: 3 ok, 2 con error.',
    })
  })
})
