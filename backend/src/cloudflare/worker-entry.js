// Entrada para Cloudflare Workers (gateway HTTP).
// Reutiliza el mismo routeRequest que el server Node; solo cambia el
// origen del entorno (bindings del Worker en vez de process.env) y la
// firma `{ fetch }` que espera Cloudflare.
//
// Deploy (desde backend/):
//   npx wrangler deploy
// Variables/secrets vía wrangler o dashboard: SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (no usar en el gateway), CORS_ORIGIN, etc.

import { routeRequest } from '../http/app.js';

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function envFromBindings(bindings = {}) {
  return {
    supabaseUrl: bindings.SUPABASE_URL || '',
    supabaseAnonKey: bindings.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: bindings.SUPABASE_SERVICE_ROLE_KEY || '',
    corsOrigin: bindings.CORS_ORIGIN || '*',
    maxBodyBytes: Number(bindings.MAX_BODY_BYTES || 1024 * 1024),
    rateLimitMax: Number(bindings.RATE_LIMIT_MAX || 300),
    rateLimitWindowMs: Number(bindings.RATE_LIMIT_WINDOW_MS || 60_000),
    allowedAiFunctions: parseCsv(
      bindings.ALLOWED_AI_FUNCTIONS ||
        'deepseek-proxy,deepseek-ocr-proxy,ops-rag-agent,chat-order-parser'
    ),
    allowedImportFunctions: parseCsv(
      bindings.ALLOWED_IMPORT_FUNCTIONS ||
        'product-photo-parser,product-photo-analyzer,deepseek-ocr-proxy'
    ),
  };
}

export default {
  async fetch(request, env) {
    return routeRequest(request, { env: envFromBindings(env) });
  },
};
