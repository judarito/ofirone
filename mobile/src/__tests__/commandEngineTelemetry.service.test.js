jest.mock('../services/aiTelemetry.service', () => ({
  estimateAITokens: jest.fn((value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value || '');
    return Math.max(0, Math.ceil(text.length / 4));
  }),
  recordAITelemetryEvent: jest.fn((event) => Promise.resolve(event)),
}));

const { recordAITelemetryEvent } = require('../services/aiTelemetry.service');
const { recordCommandResolutionTelemetry } = require('../services/commandEngine/telemetry.service');

describe('command engine telemetry bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registra una resolucion terminal del command engine (local_llm sin costo)', async () => {
    const event = await recordCommandResolutionTelemetry({
      tenantId: 'tenant-1',
      userId: 'user-1',
      feature: 'command_engine_report',
      inputType: 'voice',
      text: 'ventas de hoy',
      result: {
        intent: { confidence: 0.82 },
        model: 'local-llm',
      },
      source: 'local_llm',
      startedAtMs: Date.now() - 25,
      success: true,
      cacheHit: false,
      model: 'local-llm',
      fallback: 'cache_lookup>deterministic_parser>local_llm',
    });

    expect(event).toEqual(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        feature: 'command_engine_report',
        input_type: 'voice',
        engine: 'local_llm',
        model: 'local-llm',
        resolution_source: 'local_llm',
        confidence: 0.82,
        estimated_cost: 0,
        cache_hit: false,
        success: true,
        fallback: 'cache_lookup>deterministic_parser>local_llm',
      })
    );
    expect(event.tokens_input).toBeGreaterThan(0);
    expect(event.tokens_output).toBeGreaterThan(0);
    expect(recordAITelemetryEvent).toHaveBeenCalledTimes(1);
  });

  it('lee la confianza de order.confidence en comandos de venta (bug corregido)', async () => {
    const event = await recordCommandResolutionTelemetry({
      tenantId: 'tenant-1',
      feature: 'command_engine_sale',
      text: '2 coca colas',
      result: {
        order: { confidence: 0.93, customer_name: null, notes: null },
        line_items: [{ raw_name: 'coca cola', quantity: 2 }],
      },
      source: 'deterministic_parser',
      startedAtMs: Date.now() - 10,
      success: true,
      model: 'deterministic-parser-v1',
    });

    expect(event).toEqual(
      expect.objectContaining({
        resolution_source: 'deterministic_parser',
        confidence: 0.93,
        estimated_cost: 0,
      })
    );
  });

  it('estima costo cloud real a partir del usage devuelto por la Edge Function', async () => {
    const event = await recordCommandResolutionTelemetry({
      tenantId: 'tenant-1',
      feature: 'command_engine_sale',
      text: 'me regalas dos gaseosas y una bolsa',
      result: {
        order: { confidence: 0.8 },
        line_items: [{ raw_name: 'gaseosa', quantity: 2 }],
        model: 'deepseek-chat',
        usage: { prompt_tokens: 1500, completion_tokens: 400, total_tokens: 1900 },
      },
      source: 'cloud_llm',
      startedAtMs: Date.now() - 5,
      success: true,
      model: 'deepseek-chat',
      fallback: 'cache_lookup>deterministic_parser>local_llm>cloud_llm',
    });

    expect(event).toEqual(
      expect.objectContaining({
        resolution_source: 'cloud_llm',
        engine: 'deepseek',
        model: 'deepseek-chat',
        confidence: 0.8,
        tokens_input: 1500,
        tokens_output: 400,
        estimated_cost: 0.000845, // 1500*0.27/1M + 400*1.10/1M
        cache_hit: false,
      })
    );
  });

  it('no registra sin tenant o feature', async () => {
    await expect(
      recordCommandResolutionTelemetry({ feature: 'command_engine_sale' })
    ).resolves.toBeNull();
    await expect(recordCommandResolutionTelemetry({ tenantId: 'tenant-1' })).resolves.toBeNull();
    expect(recordAITelemetryEvent).not.toHaveBeenCalled();
  });

  it('solo considera correccion de carrito dentro de la ventana posterior a la IA', async () => {
    const { shouldTrackCartCorrection } = require('../services/commandEngine/telemetry.service');
    const now = Date.now();

    expect(shouldTrackCartCorrection({ appliedAt: now - 1000, productId: 'prod-1', now })).toBe(
      true
    );
    expect(
      shouldTrackCartCorrection({
        appliedAt: now - 6 * 60 * 1000,
        productId: 'prod-1',
        now,
      })
    ).toBe(false);
    expect(shouldTrackCartCorrection({ appliedAt: now, productId: null, now })).toBe(false);
    expect(shouldTrackCartCorrection({ appliedAt: null, productId: 'prod-1', now })).toBe(false);
  });

  it('registra correccion manual de carrito como evento manual_resolution', async () => {
    const { recordCartManualCorrection } = require('../services/commandEngine/telemetry.service');

    const event = await recordCartManualCorrection({
      tenantId: 'tenant-1',
      userId: 'user-1',
      appliedAt: Date.now() - 2000,
      productId: 'prod-1',
      kind: 'quantity',
      previousValue: 2,
      nextValue: 1,
      source: 'cloud_llm',
    });

    expect(event).toEqual(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        feature: 'command_engine_sale_correction',
        engine: 'deepseek',
        resolution_source: 'manual_resolution',
        estimated_cost: 0,
        correction_source: 'pos_cart_edit',
        corrected_by_user_id: 'user-1',
        corrected_payload: {
          kind: 'quantity',
          product_id: 'prod-1',
          previous_value: 2,
          next_value: 1,
        },
      })
    );
    expect(event.corrected_at).toBeTruthy();
  });

  it('ignora correcciones fuera de ventana o sin producto', async () => {
    const { recordCartManualCorrection } = require('../services/commandEngine/telemetry.service');

    const stale = await recordCartManualCorrection({
      tenantId: 'tenant-1',
      appliedAt: Date.now() - 10 * 60 * 1000,
      productId: 'prod-1',
      kind: 'remove',
    });
    const missingProduct = await recordCartManualCorrection({
      tenantId: 'tenant-1',
      appliedAt: Date.now() - 1000,
      productId: null,
      kind: 'remove',
    });

    expect(stale).toBeNull();
    expect(missingProduct).toBeNull();
  });
});
