import { describe, expect, it } from 'vitest'
import {
  buildCommandTextFromOcrPayload,
  buildOrderImageOcrSummary,
  normalizeOrderImageOcrPayload,
} from '../orderImageOcr'

describe('orderImageOcr', () => {
  it('prioriza el texto OCR directo cuando existe', () => {
    const payload = normalizeOrderImageOcrPayload({
      ocr_text: '2 coca cola\n1 arroz diana',
      line_items: [
        { raw_name: 'esto no debe reemplazar el OCR', quantity: 5 },
      ],
      model: 'deepseek-chat',
    })

    expect(payload.ocr_text).toBe('2 coca cola\n1 arroz diana')
    expect(payload.command_text).toBe('2 coca cola\n1 arroz diana')
    expect(payload.model).toBe('deepseek-chat')
  })

  it('sintetiza texto desde line_items cuando el OCR no lo entrega', () => {
    expect(buildCommandTextFromOcrPayload({
      line_items: [
        { raw_name: 'coca cola 350 ml', quantity: 2 },
        { raw_name: 'arroz diana 500 g', quantity: 1 },
      ],
    })).toBe('2 coca cola 350 ml\n1 arroz diana 500 g')
  })

  it('normaliza líneas inválidas y arma resumen legible', () => {
    const normalized = normalizeOrderImageOcrPayload({
      line_items: [
        { raw_name: '  panela  ', quantity: 0 },
        { raw_name: '', quantity: 2 },
        { name: 'aceite 1l', quantity: '3' },
      ],
    })

    expect(normalized.line_items).toEqual([
      { raw_name: 'panela', sku: null, quantity: 1 },
      { raw_name: 'aceite 1l', sku: null, quantity: 3 },
    ])

    expect(buildOrderImageOcrSummary(normalized)).toEqual({
      ocrChars: '1 panela\n3 aceite 1l'.length,
      ocrLines: 2,
      ocrPreview: '1 panela\n3 aceite 1l',
    })
  })
})

