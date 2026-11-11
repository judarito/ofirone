import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../backendAuthClient', () => ({ getBackendSession: vi.fn(() => ({ accessToken: 'verified-go-token' })) }))
const id = '38323d67-30f4-42a9-91f2-749750d16b56'

async function load() {
  vi.resetModules()
  vi.stubEnv('VITE_BACKEND_API_URL', 'http://localhost:8787/')
  return import('../backendReferenceTaxClient')
}

describe('backendReferenceTaxClient', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })

  it.each([
    ['taxesClient', 'taxes'],
    ['currenciesClient', 'currencies'],
    ['regionalSettingsClient', 'regional-settings'],
  ])('expone CRUD autenticado de %s', async (name, path) => {
    const client = (await load())[name]
    fetch.mockResolvedValue(Response.json({ items: [], has_more: false }))
    await client.list({ limit: 2, cursor: 'opaque+/=' })
    expect(fetch).toHaveBeenLastCalledWith(`http://localhost:8787/api/v1/${path}?limit=2&cursor=opaque%2B%2F%3D`, expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer verified-go-token' }) }))
    fetch.mockResolvedValue(Response.json({ id }))
    await client.get(id)
    expect(fetch).toHaveBeenLastCalledWith(`http://localhost:8787/api/v1/${path}/${id}`, expect.objectContaining({ method: 'GET' }))
    const body = { code: 'COP', name: 'Peso', decimal_places: 2 }
    await client.create(body)
    expect(fetch).toHaveBeenLastCalledWith(`http://localhost:8787/api/v1/${path}`, expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }))
    await client.update(id, { ...body, is_active: false })
    expect(fetch).toHaveBeenLastCalledWith(`http://localhost:8787/api/v1/${path}/${id}`, expect.objectContaining({ method: 'PUT' }))
    fetch.mockResolvedValue(new Response(null, { status: 204 }))
    expect(await client.deactivate(id)).toBeNull()
    expect(fetch).toHaveBeenLastCalledWith(`http://localhost:8787/api/v1/${path}/${id}`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('propaga conflictos con código y estado', async () => {
    const { currenciesClient } = await load()
    fetch.mockResolvedValue(Response.json({ code: 'REFERENCE_CONFLICT', message: 'Código duplicado.' }, { status: 409 }))
    await expect(currenciesClient.create({})).rejects.toMatchObject({ status: 409, code: 'REFERENCE_CONFLICT', message: 'Código duplicado.' })
  })

  it('rechaza paginación e identificadores inválidos antes de llamar la API', async () => {
    const { taxesClient } = await load()
    for (const limit of [0, 101, 1.5]) await expect(taxesClient.list({ limit })).rejects.toThrow('Límite')
    await expect(taxesClient.get('../currencies')).rejects.toThrow('Identificador')
    await expect(taxesClient.get()).rejects.toThrow('Identificador')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no recurre a Supabase cuando falta sesión Go', async () => {
    const { taxesClient } = await load()
    const auth = await import('../backendAuthClient')
    auth.getBackendSession.mockReturnValueOnce(null)
    await expect(taxesClient.list()).rejects.toThrow('Sesión requerida')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propaga cancelación de la petición', async () => {
    const { regionalSettingsClient } = await load()
    const controller = new AbortController()
    fetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    await expect(regionalSettingsClient.list({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }))
  })
})
