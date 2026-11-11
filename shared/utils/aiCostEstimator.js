// Estimador de costo de inferencia IA por modelo.
// Núcleo puro compartido (mobile + web + backend).
// Nota: los precios son referenciales (USD por millón de tokens) y deben
// revisarse periódicamente; se usan para KPI de costo, no para facturación.

export const AI_MODEL_TOKEN_COST_USD_PER_1M = Object.freeze({
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
});

export const DEFAULT_AI_TOKEN_COST_USD_PER_1M = Object.freeze({
  input: 0.27,
  output: 1.1,
});

export function getAiTokenCostPer1M(model) {
  const key = String(model || '').trim();
  return AI_MODEL_TOKEN_COST_USD_PER_1M[key] || DEFAULT_AI_TOKEN_COST_USD_PER_1M;
}

// Extrae tokens reales de un objeto `usage` típico de proveedor LLM.
// DeepSeek/OpenAI: { prompt_tokens, completion_tokens, total_tokens }.
// Otros proveedores pueden usar { input_tokens, output_tokens }.
export function resolveUsageTokens(usage = {}) {
  const u = usage || {};
  const rawInput = u.prompt_tokens ?? u.input_tokens;
  const rawOutput = u.completion_tokens ?? u.output_tokens;
  const tokensInput = Number(rawInput);
  const tokensOutput = Number(rawOutput);
  return {
    tokensInput: Number.isFinite(tokensInput) && tokensInput > 0 ? Math.round(tokensInput) : 0,
    tokensOutput:
      Number.isFinite(tokensOutput) && tokensOutput > 0 ? Math.round(tokensOutput) : 0,
  };
}

// Costo estimado en USD con 8 decimales.
export function estimateAICost({ model = null, tokensInput = 0, tokensOutput = 0 } = {}) {
  const rates = getAiTokenCostPer1M(model);
  const inputTokens = Math.max(0, Number(tokensInput) || 0);
  const outputTokens = Math.max(0, Number(tokensOutput) || 0);
  const cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  return Math.round(cost * 1e8) / 1e8;
}
