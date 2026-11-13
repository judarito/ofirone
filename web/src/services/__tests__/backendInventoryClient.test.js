import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getBackendSessionMock } = vi.hoisted(() => ({
  getBackendSessionMock: vi.fn(),
}))

vi.mock('@/services/backendAuthClient', () => ({
  getBackendSession: getBackendSessionMock,
}))

async function loadClient({ baseUrl = 'http://localhost:8787' } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_BACKEND_API_URL', baseUrl)
  return import('@/services/backendInventoryClient')
}

describe('backendInventoryClient', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    getBackendSessionMock.mockReset()
    getBackendSessionMock.mockReturnValue({ accessToken: 'token-1' })
    globalThis.fetch = vi.fn()
  })

  it('envía filtros y cursor del Kardex al endpoint Go', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({
      items: [{ movement_id: 'move-1' }],
      has_more: true,
      next_occurred_at: '2026-11-13T10:00:00Z',
      next_id: 'move-1',
    }))
    const client = await loadClient()

    const result = await client.listBackendInventoryMoves({
      limit: 20,
      locationId: 'loc-1',
      variantId: 'var-1',
      moveType: 'PURCHASE_IN',
      afterOccurredAt: '2026-11-13T11:00:00Z',
      afterId: 'move-0',
    })

    expect(result).toEqual({
      items: [{ movement_id: 'move-1' }],
      has_more: true,
      next_occurred_at: '2026-11-13T10:00:00Z',
      next_id: 'move-1',
    })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/v1/inventory/movements?limit=20&location_id=loc-1&variant_id=var-1&move_type=PURCHASE_IN&after_occurred_at=2026-11-13T11%3A00%3A00Z&after_id=move-0',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      }),
    )
  })
})
