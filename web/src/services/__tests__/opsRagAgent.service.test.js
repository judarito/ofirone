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

import { askOpsRagAgent } from '@/services/opsRagAgent.service'

describe('opsRagAgent.service', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    ensureFeatureAccessMock.mockReset()
    ensureFeatureAccessMock.mockResolvedValue({ success: true, data: null })
  })

  it('valida query requerida', async () => {
    await expect(askOpsRagAgent({ tenantId: 't1', query: '   ' })).resolves.toEqual({
      success: false,
      error: 'query es requerido',
      data: null,
    })
  })

  it('devuelve error enriquecido cuando falla la edge function', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: 'invoke failed',
        context: {
          status: 500,
          clone() { return this },
          json: async () => ({ error: 'boom', details: 'timeout' }),
        },
      },
    })

    const result = await askOpsRagAgent({ tenantId: 't1', query: 'ventas hoy' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('ops-rag-agent')
    expect(result.error).toContain('boom')
    expect(result.error).toContain('timeout')
  })

  it('devuelve error si el payload no trae data valida', async () => {
    invokeMock.mockResolvedValue({
      data: { success: false, error: 'sin contexto' },
      error: null,
    })

    await expect(askOpsRagAgent({ tenantId: 't1', query: 'ventas hoy' })).resolves.toEqual({
      success: false,
      error: 'sin contexto',
      data: null,
    })
  })

  it('bloquea la consulta cuando el plan no incluye IA', async () => {
    ensureFeatureAccessMock.mockResolvedValue({
      success: false,
      error: 'Tu plan actual no incluye Centro IA.',
    })

    const result = await askOpsRagAgent({ tenantId: 't1', query: 'ventas hoy' })

    expect(result).toEqual({
      success: false,
      error: 'Tu plan actual no incluye Centro IA.',
      data: null,
    })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('retorna data cuando la consulta es exitosa', async () => {
    invokeMock.mockResolvedValue({
      data: { success: true, data: { answer: 'ok', confidence: 0.8 } },
      error: null,
    })

    const result = await askOpsRagAgent({
      tenantId: 't1',
      query: 'ventas hoy',
      domains: ['sales'],
      useCache: false,
    })

    expect(invokeMock).toHaveBeenCalledWith('ops-rag-agent', {
      body: expect.objectContaining({
        tenant_id: 't1',
        query: 'ventas hoy',
        domains: ['sales'],
        use_cache: false,
      }),
    })
    expect(result).toEqual({
      success: true,
      data: { answer: 'ok', confidence: 0.8 },
    })
  })
})
