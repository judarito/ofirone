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

async function loadClientWithEnv({ baseUrl = 'http://localhost:8787', backendAuth = undefined } = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_BACKEND_API_URL', baseUrl);
  if (backendAuth !== undefined) vi.stubEnv('VITE_USE_BACKEND_AUTH', backendAuth ? 'true' : 'false');
  return import('@/services/backendDomainClient');
}

describe('backendDomainClient', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    getSessionMock.mockReset();
    globalThis.fetch = vi.fn();
    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    };
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
  });

  it('construye la URL de /sales y mapea data/total', async () => {
    globalThis.fetch.mockResolvedValue(
      Response.json({ data: [{ sale_id: 's-1', total: 1200 }], total: 5 })
    );
    const client = await loadClientWithEnv();

    const result = await client.listBackendSales({ page: 2, pageSize: 25 });

    expect(result).toEqual({ success: true, data: [{ sale_id: 's-1', total: 1200 }], total: 5 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/sales?page=2&page_size=25',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      })
    );
  });

  it('construye la URL de /purchases', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({ data: [], total: 0 }));
    const client = await loadClientWithEnv();

    await client.listBackendPurchases({ page: 1, pageSize: 10 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/purchases?page=1&page_size=10',
      expect.anything()
    );
  });

  it('construye la URL de stock balances con filtros opcionales', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({ data: [], total: 0 }));
    const client = await loadClientWithEnv();

    await client.listBackendStockBalances({ locationId: 'loc-1', lowStock: 5 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/v1/inventory/stock-balances?page=1&page_size=20&location_id=loc-1&low_stock=5',
      expect.anything()
    );
  });

  it('omite filtros vacíos de la URL de stock balances', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({ data: [], total: 0 }));
    const client = await loadClientWithEnv();

    await client.listBackendStockBalances({ variantId: null });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/v1/inventory/stock-balances?page=1&page_size=20',
      expect.anything()
    );
  });

  it('falla sin sesión o sin VITE_BACKEND_API_URL', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const client = await loadClientWithEnv();
    await expect(client.listBackendSales({})).rejects.toThrow(/Sesión requerida/);

    const noUrl = await loadClientWithEnv({ baseUrl: '' });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
    await expect(noUrl.listBackendSales({})).rejects.toThrow(/VITE_BACKEND_API_URL/);
  });

  it('consume el contrato keyset del backend Go', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({
      items: [{ product_id: 'p-1', name: 'Producto' }],
      has_more: true,
      next_name: 'Producto',
      next_id: 'p-1',
    }));
    const client = await loadClientWithEnv();

    const result = await client.listBackendProducts({ limit: 10, afterName: 'A', afterId: 'p-0' });

    expect(result.items).toEqual([{ product_id: 'p-1', name: 'Producto' }]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toMatchObject({ name: 'Producto', id: 'p-1' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/v1/products?limit=10&after_name=A&after_id=p-0',
      expect.anything()
    );
  });

  it('en modo auth Go usa la sesión local sin consultar Supabase', async () => {
    localStorage.setItem('ofirone_backend_session', JSON.stringify({ accessToken: 'go-token' }));
    const client = await loadClientWithEnv({ backendAuth: true });
    globalThis.fetch.mockResolvedValue(Response.json({ data: [] }));

    await client.listBackendSales({});

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8787/sales?page=1&page_size=20',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer go-token' }),
      })
    );
    globalThis.localStorage.removeItem('ofirone_backend_session');
  });
});
