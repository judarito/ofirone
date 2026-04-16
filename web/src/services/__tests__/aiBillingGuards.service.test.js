import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureFeatureAccessMock = vi.fn()

vi.mock('@/plugins/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}))

vi.mock('@/services/tenantBilling.service', () => ({
  default: {
    ensureFeatureAccess: ensureFeatureAccessMock,
  },
}))

import aiPurchaseAdvisorService from '@/services/ai-purchase-advisor.service'
import salesForecastService from '@/services/sales-forecast.service'

describe('AI billing guards', () => {
  beforeEach(() => {
    ensureFeatureAccessMock.mockReset()
  })

  it('bloquea recomendaciones de compra cuando el plan no incluye asistentes IA', async () => {
    ensureFeatureAccessMock.mockResolvedValue({
      success: false,
      error: 'Tu plan actual no incluye asistentes IA.',
    })

    await expect(
      aiPurchaseAdvisorService.generatePurchaseRecommendations('tenant-1', [], [], {})
    ).rejects.toThrow('Tu plan actual no incluye asistentes IA.')
  })

  it('bloquea pronósticos de venta cuando el plan no incluye pronóstico IA', async () => {
    ensureFeatureAccessMock.mockResolvedValue({
      success: false,
      error: 'Tu plan actual no incluye pronóstico IA.',
    })

    await expect(
      salesForecastService.generateForecast('tenant-1', null, [], {})
    ).rejects.toThrow('Tu plan actual no incluye pronóstico IA.')
  })
})
