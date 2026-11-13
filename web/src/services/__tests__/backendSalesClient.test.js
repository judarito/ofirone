import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getBackendSessionMock } = vi.hoisted(() => ({
  getBackendSessionMock: vi.fn(),
}))

vi.mock('@/services/backendAuthClient', () => ({
  getBackendSession: getBackendSessionMock,
}))

async function loadClient() {
  vi.resetModules()
  vi.stubEnv('VITE_BACKEND_API_URL', 'http://localhost:8787/')
  return import('@/services/backendSalesClient')
}

describe('backendSalesClient POS Go', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    getBackendSessionMock.mockReset()
    getBackendSessionMock.mockReturnValue({ accessToken: 'go-token' })
    globalThis.fetch = vi.fn()
  })

  it('busca variantes y precio en Go sin consultar Supabase', async () => {
    fetch.mockResolvedValue(Response.json({
      items: [{ ID: 'variant-1', SKU: 'SKU-1', Name: 'Predeterminado', SalePrice: 1200, StockOnHand: 4 }],
      has_more: false,
    }))
    const { searchBackendPOSVariants } = await loadClient()

    const result = await searchBackendPOSVariants('camisa', { limit: 20, locationId: 'location-1' })

    expect(result.items).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/v1/variants?limit=20&search=camisa&location_id=location-1',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer go-token' }),
      }),
    )
  })

  it('obtiene impuestos por el endpoint Go', async () => {
    fetch.mockResolvedValue(Response.json({ rate: 0.19, code: 'IVA', name: 'IVA 19%' }))
    const { getBackendSaleTaxInfo } = await loadClient()

    await expect(getBackendSaleTaxInfo('variant-1')).resolves.toMatchObject({ rate: 0.19, code: 'IVA' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/v1/tax-info/variants/variant-1',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer go-token' }) }),
    )
  })
})
