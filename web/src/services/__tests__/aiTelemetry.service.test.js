import { describe, expect, it } from 'vitest'

import { buildAITelemetrySummary, estimateAITokens } from '@/services/aiTelemetry.service'

describe('AI telemetry service', () => {
  it('estima tokens de forma conservadora por longitud de texto', () => {
    expect(estimateAITokens('abcd')).toBe(1)
    expect(estimateAITokens('abcde')).toBe(2)
  })

  it('resume avoidance, fuentes, latencia y errores', () => {
    const summary = buildAITelemetrySummary([
      {
        feature: 'ops_rag_agent',
        resolution_source: 'local_cache',
        latency_ms: 20,
        estimated_cost: 0,
        success: true,
      },
      {
        feature: 'invoice_ocr_image',
        input_type: 'image',
        resolution_source: 'local_ocr',
        latency_ms: 120,
        estimated_cost: 0,
        success: true,
      },
      {
        feature: 'invoice_ocr_image',
        input_type: 'image',
        resolution_source: 'cloud_llm',
        latency_ms: 200,
        estimated_cost: 0.012,
        model: 'deepseek-chat',
        fallback: 'native_low_score',
        success: true,
      },
      {
        feature: 'sales_forecast',
        resolution_source: 'cloud_llm',
        latency_ms: 900,
        estimated_cost: 0.018,
        model: 'deepseek-chat',
        success: false,
        error: 'timeout',
      },
    ])

    expect(summary.total_events).toBe(4)
    expect(summary.cloud_events).toBe(2)
    expect(summary.non_cloud_events).toBe(2)
    expect(summary.cloud_avoidance_rate).toBeCloseTo(50, 1)
    expect(summary.ocr_image_events).toBe(2)
    expect(summary.ocr_image_cloud_events).toBe(1)
    expect(summary.ocr_image_cloud_rate).toBeCloseTo(50, 1)
    expect(summary.total_cost).toBeCloseTo(0.03)
    expect(summary.latency_p95_ms).toBe(900)
    expect(summary.error_rate).toBeCloseTo(25, 1)
    expect(summary.by_feature[0]).toMatchObject({
      key: 'invoice_ocr_image',
      count: 2,
      cloud: 1,
    })
    expect(summary.by_source[0]).toMatchObject({
      key: 'cloud_llm',
      count: 2,
    })
    expect(summary.errors_by_model[0]).toMatchObject({
      key: 'deepseek-chat',
      count: 1,
    })
    expect(summary.fallbacks_to_cloud[0]).toMatchObject({
      key: 'native_low_score',
      count: 1,
    })
  })
})
