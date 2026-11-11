import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock('@/plugins/supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}));

async function loadClientWithEnv({ baseUrl = 'http://localhost:8787' } = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_BACKEND_API_URL', baseUrl);
  return import('@/services/backendCustomersClient');
}

describe('backendCustomersClient', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    getSessionMock.mockReset();
    globalThis.fetch = vi.fn();
  });

  it('lista clientes vía backend con token y mapea data/total', async () => {
    globalThis.fetch.mockResolvedValue(
      Response.json({
        data: [{ third_party_id: 'tp-1', legal_name: 'Cliente A', document_number: '1' }],
        total: 3,
      })
    );
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });

    const service = await loadClientWithEnv();
    const result = await service.listBackendCustomers({ page: 1, pageSize: 10, search: 'cliente' });

    expect(result).toEqual({
      success: true,
      data: [{ third_party_id: 'tp-1', legal_name: 'Cliente A', document_number: '1' }],
      total: 3,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/customers?page=1&page_size=10&search=cliente',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer token-1',
          accept: 'application/json',
        }),
      })
    );
  });

  it('falla si no hay sesión', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const service = await loadClientWithEnv();

    await expect(service.listBackendCustomers({})).rejects.toThrow(/Sesión requerida/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('propaga el error del backend', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({ error: 'Prohibido' }, { status: 403 }));
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
    const service = await loadClientWithEnv();

    await expect(service.listBackendCustomers({})).rejects.toThrow(/Prohibido/);
  });

  it('exige VITE_BACKEND_API_URL', async () => {
    const service = await loadClientWithEnv({ baseUrl: '' });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });

    await expect(service.listBackendCustomers({})).rejects.toThrow(/VITE_BACKEND_API_URL/);
  });
});
