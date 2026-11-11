import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { session } = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock('../backendAuthClient', () => ({ getBackendSession: session }))

async function load() {
  vi.resetModules()
  vi.stubEnv('VITE_BACKEND_API_URL', 'http://localhost:8787/')
  return import('../backendReferenceCatalogClient')
}
beforeEach(() => {
  session.mockReturnValue({ accessToken: 'jwt' })
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('reference catalog client', () => {
  it('preserves keyset metadata and sends JWT', async () => {
    const page = { items: [], has_more: true, next_name: 'A', next_id: 'id' }
    fetch.mockResolvedValue(Response.json(page))
    const { backendCategories } = await load()
    expect(await backendCategories.list({ limit: 5, afterName: 'A & B', afterId: 'id' })).toEqual(page)
    expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/categories?limit=5&after_name=A+%26+B&after_id=id', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer jwt' }) }))
  })
  it('supports create, get, partial update and deactivate for both resources', async () => {
    const clients = await load()
    for (const client of [clients.backendCategories, clients.backendUnitsOfMeasure]) {
      fetch.mockResolvedValue(Response.json({ id: 'id' }))
      await client.create({ code: 'KG', name: 'Kilo' })
      expect(fetch.mock.lastCall[1].method).toBe('POST')
      await client.get('id')
      expect(fetch.mock.lastCall[1].method).toBe('GET')
      await client.update('id', { name: 'Nuevo' })
      expect(fetch.mock.lastCall[1]).toMatchObject({ method: 'PATCH', body: '{"name":"Nuevo"}' })
      fetch.mockResolvedValue(new Response(null, { status: 204 }))
      expect(await client.deactivate('id')).toBeNull()
      expect(fetch.mock.lastCall[1].method).toBe('DELETE')
    }
  })
  it('rejects missing session before fetching', async () => {
    const { backendCategories } = await load()
    session.mockReturnValue(null)
    await expect(backendCategories.list()).rejects.toThrow('Sesión requerida')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('retains backend conflict status and code', async () => {
    const { backendCategories } = await load()
    fetch.mockResolvedValue(Response.json({ code: 'REFERENCE_CONFLICT', message: 'Duplicado' }, { status: 409 }))
    await expect(backendCategories.create({})).rejects.toMatchObject({ status: 409, code: 'REFERENCE_CONFLICT', message: 'Duplicado' })
  })
})
