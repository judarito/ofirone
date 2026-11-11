import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/services/supabase.service', () => ({
  default: {
    client: {
      rpc: rpcMock,
    },
  },
}));

async function loadService() {
  vi.resetModules();
  vi.stubEnv('VITE_AI_TELEMETRY_REMOTE_ENABLED', 'true');
  return import('@/services/aiTelemetry.service');
}

describe('getRemoteAICostSummary', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    rpcMock.mockReset();
  });

  it('requiere tenant_id', async () => {
    const service = await loadService();
    const result = await service.getRemoteAICostSummary({ tenantId: null });
    expect(result.success).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('invoca el RPC y normaliza la fila devuelta', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          total_cost: '0.00480000',
          cost_last_7_days: '0.00300000',
          cost_last_30_days: '0.00480000',
          cloud_events: 3,
          total_events: 40,
          cost_by_day: [{ date: '2026-08-23', cost: '0.00084500' }],
        },
      ],
      error: null,
    });
    const service = await loadService();

    const result = await service.getRemoteAICostSummary({ tenantId: 'tenant-1', days: 30 });

    expect(rpcMock).toHaveBeenCalledWith('fn_ai_telemetry_cost_summary', {
      p_tenant_id: 'tenant-1',
      p_window_days: 30,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      total_cost: 0.0048,
      cost_last_7_days: 0.003,
      cost_last_30_days: 0.0048,
      cloud_events: 3,
      total_events: 40,
      cost_by_day: [{ date: '2026-08-23', cost: '0.00084500' }],
    });
  });

  it('devuelve ceros cuando el RPC no tiene filas', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const service = await loadService();

    const result = await service.getRemoteAICostSummary({ tenantId: 'tenant-1' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      total_cost: 0,
      cost_last_7_days: 0,
      cost_last_30_days: 0,
      cloud_events: 0,
      total_events: 0,
      cost_by_day: [],
    });
  });

  it('propaga errores del RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permiso denegado' } });
    const service = await loadService();

    const result = await service.getRemoteAICostSummary({ tenantId: 'tenant-1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('permiso denegado');
  });
});
