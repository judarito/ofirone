import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadClient() {
  vi.resetModules()
  vi.stubEnv('VITE_BACKEND_API_URL', 'http://localhost:8787')
  return import('@/services/backendAuthClient')
}

describe('backendAuthClient', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    globalThis.fetch = vi.fn()
  })

  it('envía login con tenant y devuelve tokens Go', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({ AccessToken: 'access', RefreshToken: 'refresh' }))
    const client = await loadClient()
    const result = await client.loginBackend({ email: 'user@example.test', password: 'secret', tenantId: 'tenant-1' })
    expect(result.AccessToken).toBe('access')
    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.test', password: 'secret', tenant_id: 'tenant-1' }),
    }))
  })

  it('propaga errores del backend', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({ message: 'Credenciales inválidas.' }, { status: 401 }))
    const client = await loadClient()
    await expect(client.loginBackend({ email: 'x', password: 'y', tenantId: 't' })).rejects.toThrow('Credenciales inválidas')
  })
})
