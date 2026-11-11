jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const { supabase } = require('../lib/supabase');
const {
  clearAITelemetryEvents,
  estimateAITokens,
  flushPendingAITelemetryEvents,
  getAITelemetryEvents,
  persistAITelemetryEvent,
  recordAITelemetryEvent,
} = require('../services/aiTelemetry.service');

describe('mobile AI telemetry service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearAITelemetryEvents();
  });

  it('guarda eventos locales y agrega device_id cuando no viene en el evento', async () => {
    await recordAITelemetryEvent({
      tenant_id: 'tenant-1',
      feature: 'ops_rag_agent',
      resolution_source: 'local_cache',
      latency_ms: 12,
    });

    const events = await getAITelemetryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenant_id: 'tenant-1',
      feature: 'ops_rag_agent',
      resolution_source: 'local_cache',
      latency_ms: 12,
      success: true,
    });
    expect(events[0].device_id).toMatch(/^dev_/);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('persiste eventos remotos con upsert por tenant y event_id', async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    supabase.from.mockReturnValue({ upsert });

    const result = await persistAITelemetryEvent({
      id: 'event-1',
      timestamp: '2026-08-23T04:00:00.000Z',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      device_id: 'device-1',
      feature: 'sales_forecast',
      input_type: 'text',
      engine: 'deepseek',
      model: 'deepseek-chat',
      resolution_source: 'cloud_llm',
      latency_ms: 156.7,
      confidence: 0.91,
      tokens_input: 120.2,
      tokens_output: 42.9,
      estimated_cost: 0.0012,
      cache_hit: false,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('ai_telemetry_events');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'event-1',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        device_id: 'device-1',
        feature: 'sales_forecast',
        resolution_source: 'cloud_llm',
        latency_ms: 157,
        tokens_input: 120,
        tokens_output: 43,
        occurred_at: '2026-08-23T04:00:00.000Z',
      }),
      { onConflict: 'tenant_id,event_id' }
    );
  });

  it('estima tokens de forma conservadora', () => {
    expect(estimateAITokens('abcd')).toBe(1);
    expect(estimateAITokens('abcde')).toBe(2);
  });

  it('persiste los campos de correccion manual cuando existen', async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    supabase.from.mockReturnValue({ upsert });

    await persistAITelemetryEvent({
      id: 'event-1',
      timestamp: '2026-08-23T04:00:00.000Z',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      device_id: 'device-1',
      feature: 'command_engine_sale',
      resolution_source: 'cloud_llm',
      latency_ms: 10,
      estimated_cost: 0.001,
      corrected_at: '2026-08-23T04:05:00.000Z',
      corrected_by_user_id: 'user-2',
      correction_source: 'pos_manual_edit',
      corrected_payload: { line_items: [{ raw_name: 'gaseosa', quantity: 1 }] },
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        corrected_at: '2026-08-23T04:05:00.000Z',
        corrected_by_user_id: 'user-2',
        correction_source: 'pos_manual_edit',
        corrected_payload: { line_items: [{ raw_name: 'gaseosa', quantity: 1 }] },
      }),
      { onConflict: 'tenant_id,event_id' }
    );
  });

  it('flush no envia eventos remotos cuando la telemetria remota esta apagada', async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    supabase.from.mockReturnValue({ upsert });

    await recordAITelemetryEvent({
      tenant_id: 'tenant-1',
      feature: 'command_engine_sale',
      resolution_source: 'cloud_llm',
      estimated_cost: 0.0008,
    });
    await recordAITelemetryEvent({
      tenant_id: 'tenant-1',
      feature: 'ops_rag_agent',
      resolution_source: 'local_cache',
    });

    const result = await flushPendingAITelemetryEvents({ limit: 10 });

    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    const events = await getAITelemetryEvents();
    expect(events).toHaveLength(2);
  });

  it('flush conserva en la cola los eventos pendientes cuando esta apagado', async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: { message: 'red caida' } }));
    supabase.from.mockReturnValue({ upsert });

    await recordAITelemetryEvent({
      tenant_id: 'tenant-1',
      feature: 'command_engine_sale',
      resolution_source: 'cloud_llm',
      estimated_cost: 0.0008,
    });

    const result = await flushPendingAITelemetryEvents({ limit: 10 });

    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    const events = await getAITelemetryEvents();
    expect(events).toHaveLength(1);
  });
});
