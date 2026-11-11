import { estimateAICost, resolveUsageTokens } from '../../../../shared/utils/aiCostEstimator';
import { estimateAITokens, recordAITelemetryEvent } from '../aiTelemetry.service';

function resolveEngine(source) {
  if (source === 'cloud_llm') return 'deepseek';
  if (source === 'local_llm') return 'local_llm';
  if (source === 'deterministic_parser') return 'deterministic';
  if (source === 'local_cache') return 'cache';
  return source || 'unknown';
}

function resolveConfidence(result) {
  // Venta: el parser determinístico guarda la confianza en `order.confidence`.
  // Reportes: el motor la guarda en `intent.confidence`.
  const value =
    result?.order?.confidence ?? result?.intent?.confidence ?? result?.confidence ?? null;
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function resolveInputTokens(text) {
  return estimateAITokens(text || '');
}

function resolveOutputTokens(result, usage, success) {
  if (!success) return 0;
  if (usage && (usage.tokensInput > 0 || usage.tokensOutput > 0)) return usage.tokensOutput;
  return estimateAITokens(result || '');
}

export async function recordCommandResolutionTelemetry({
  tenantId,
  userId = null,
  feature,
  inputType = 'text',
  text = '',
  result = null,
  source = 'unknown',
  startedAtMs,
  success = true,
  error = null,
  cacheHit = false,
  model = null,
  fallback = null,
} = {}) {
  if (!tenantId || !feature) return null;

  const isCloud = source === 'cloud_llm';
  const usage = resolveUsageTokens(result?.usage);
  const tokensInput = usage.tokensInput > 0 ? usage.tokensInput : resolveInputTokens(text);
  const tokensOutput = resolveOutputTokens(result, usage, success);
  const estimatedCost = isCloud ? estimateAICost({ model, tokensInput, tokensOutput }) : 0;

  return recordAITelemetryEvent({
    tenant_id: tenantId,
    user_id: userId,
    feature,
    input_type: inputType,
    engine: resolveEngine(source),
    model,
    resolution_source: source || 'unknown',
    latency_ms: Math.max(0, Date.now() - Number(startedAtMs || Date.now())),
    confidence: resolveConfidence(result),
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    estimated_cost: estimatedCost,
    cache_hit: cacheHit === true,
    fallback,
    success,
    error,
  });
}

const CART_CORRECTION_WINDOW_MS = 5 * 60 * 1000;

// Una edición manual solo se considera "corrección de un resultado IA" si
// ocurre poco después de que el motor agregó ese producto al carrito.
export function shouldTrackCartCorrection({
  appliedAt,
  now = Date.now(),
  productId = null,
  windowMs = CART_CORRECTION_WINDOW_MS,
} = {}) {
  if (!productId || !appliedAt) return false;
  const applied = Number(appliedAt);
  if (!Number.isFinite(applied)) return false;
  const elapsed = Number(now) - applied;
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= windowMs;
}

// Emite un evento de telemetría marcando que un resultado IA aplicado al
// carrito fue corregido manualmente por el usuario (feedback loop, Fase 9).
// No guarda prompts ni textos: solo metadata estructurada y el payload
// corregido (producto + tipo de edición).
export async function recordCartManualCorrection({
  tenantId,
  userId = null,
  appliedAt,
  productId,
  kind,
  previousValue = null,
  nextValue = null,
  source = 'manual',
} = {}) {
  if (!tenantId || !shouldTrackCartCorrection({ appliedAt, productId })) return null;

  return recordAITelemetryEvent({
    tenant_id: tenantId,
    user_id: userId,
    feature: 'command_engine_sale_correction',
    input_type: 'text',
    engine: resolveEngine(source),
    model: null,
    resolution_source: 'manual_resolution',
    latency_ms: 0,
    confidence: null,
    tokens_input: 0,
    tokens_output: 0,
    estimated_cost: 0,
    cache_hit: false,
    fallback: null,
    success: true,
    error: null,
    corrected_at: new Date().toISOString(),
    corrected_by_user_id: userId,
    correction_source: 'pos_cart_edit',
    corrected_payload: {
      kind,
      product_id: productId,
      previous_value: previousValue,
      next_value: nextValue,
    },
  });
}
