import { describe, expect, it } from 'vitest'
import {
  AI_INSIGHT_QUICK_ACTIONS,
  normalizeOpsInsightResult,
  resolveAiQuickAction,
} from '@/utils/aiInsightsCenter'

describe('aiInsightsCenter', () => {
  it('resuelve acciones rapidas conocidas', () => {
    const action = resolveAiQuickAction('inventory-alerts')
    expect(action?.title).toBe('Inventario en riesgo')
    expect(action?.domains).toEqual(['inventory'])
  })

  it('devuelve null para acciones inexistentes', () => {
    expect(resolveAiQuickAction('missing-action')).toBeNull()
    expect(AI_INSIGHT_QUICK_ACTIONS.length).toBeGreaterThan(0)
  })

  it('normaliza el resultado del agente operativo', () => {
    const normalized = normalizeOpsInsightResult({
      answer: 'Hay dos alertas',
      summary: 'Resumen corto',
      suggested_actions: ['Comprar hoy', '', 'Validar caja'],
      domains: ['inventory', null, 'cash'],
      confidence: '0.78',
      cache_hit: true,
    })

    expect(normalized.answer).toBe('Hay dos alertas')
    expect(normalized.suggestedActions).toEqual(['Comprar hoy', 'Validar caja'])
    expect(normalized.domains).toEqual(['inventory', 'cash'])
    expect(normalized.confidence).toBe(0.78)
    expect(normalized.cacheHit).toBe(true)
  })
})
