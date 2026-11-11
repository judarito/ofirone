import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AI_MODEL_TOKEN_COST_USD_PER_1M,
  DEFAULT_AI_TOKEN_COST_USD_PER_1M,
  estimateAICost,
  getAiTokenCostPer1M,
  resolveUsageTokens,
} from './aiCostEstimator.js';

describe('aiCostEstimator', () => {
  it('expone tasas conocidas para deepseek-chat y deepseek-reasoner', () => {
    assert.equal(AI_MODEL_TOKEN_COST_USD_PER_1M['deepseek-chat'].input, 0.27);
    assert.equal(AI_MODEL_TOKEN_COST_USD_PER_1M['deepseek-chat'].output, 1.1);
    assert.equal(AI_MODEL_TOKEN_COST_USD_PER_1M['deepseek-reasoner'].output, 2.19);
  });

  it('usa tasas por defecto para modelos desconocidos', () => {
    assert.equal(getAiTokenCostPer1M('modelo-desconocido'), DEFAULT_AI_TOKEN_COST_USD_PER_1M);
    assert.equal(getAiTokenCostPer1M(''), DEFAULT_AI_TOKEN_COST_USD_PER_1M);
    assert.equal(getAiTokenCostPer1M(null), DEFAULT_AI_TOKEN_COST_USD_PER_1M);
  });

  it('calcula costo estimado con deepseek-chat', () => {
    // 1.000 tokens input * 0.27/1M + 200 tokens output * 1.10/1M
    const cost = estimateAICost({ model: 'deepseek-chat', tokensInput: 1000, tokensOutput: 200 });
    assert.ok(Math.abs(cost - (0.00027 + 0.00022)) < 1e-10);
  });

  it('calcula costo estimado con deepseek-reasoner', () => {
    const cost = estimateAICost({ model: 'deepseek-reasoner', tokensInput: 1000, tokensOutput: 200 });
    assert.ok(Math.abs(cost - (0.00055 + 0.000438)) < 1e-10);
  });

  it('redondea a 8 decimales y tolera valores inválidos', () => {
    const tiny = estimateAICost({ model: 'deepseek-chat', tokensInput: 1, tokensOutput: 1 });
    assert.ok(Math.abs(tiny - (0.27 + 1.1) / 1_000_000) < 1e-10);
    assert.equal(estimateAICost({}), 0);
    assert.equal(estimateAICost({ model: null, tokensInput: -5, tokensOutput: 'x' }), 0);
  });

  it('resuelve tokens de usage estilo DeepSeek/OpenAI', () => {
    assert.deepEqual(resolveUsageTokens({ prompt_tokens: 1500, completion_tokens: 400 }), {
      tokensInput: 1500,
      tokensOutput: 400,
    });
  });

  it('resuelve tokens de usage estilo input/output', () => {
    assert.deepEqual(resolveUsageTokens({ input_tokens: 800, output_tokens: 60 }), {
      tokensInput: 800,
      tokensOutput: 60,
    });
  });

  it('tolera usage ausente o inválido', () => {
    assert.deepEqual(resolveUsageTokens(null), { tokensInput: 0, tokensOutput: 0 });
    assert.deepEqual(resolveUsageTokens({ prompt_tokens: -3 }), { tokensInput: 0, tokensOutput: 0 });
  });
});
