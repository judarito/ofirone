import { supabase } from '@/plugins/supabase';
import { getBackendSession } from './backendAuthClient';

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || '';

export const USE_BACKEND_CATALOG = import.meta.env.VITE_USE_BACKEND_CATALOG === 'true';
export const USE_BACKEND_SALES = import.meta.env.VITE_USE_BACKEND_SALES === 'true';
export const USE_BACKEND_PRICING = import.meta.env.VITE_USE_BACKEND_PRICING === 'true' || USE_BACKEND_CATALOG;

function backendBaseUrl() {
  return BACKEND_BASE_URL.replace(/\/+$/, '');
}

// Cliente de endpoints read-only del backend gateway para dominios de listado.
// Devuelve { success, data, total }; el mapeo al shape de la UI lo hace el
// service de cada dominio (reutilizando sus mappers existentes).

async function requestJson(path, params = {}, { includeCursor = false, method = 'GET', body } = {}) {
  if (!BACKEND_BASE_URL) {
    throw new Error(`VITE_BACKEND_API_URL no configurado para ${path}.`);
  }

  // En modo Go la sesión vive en localStorage y no debemos consultar Supabase
  // ni siquiera para resolver el token. El fallback Supabase solo se conserva
  // para el modo híbrido/legacy.
  const backendSession = getBackendSession();
  let accessToken = backendSession?.accessToken;
  if (!accessToken) {
    const { data } = await supabase.auth.getSession();
    accessToken = data?.session?.access_token;
  }
  if (!accessToken) {
    throw new Error('Sesión requerida para consultar el backend.');
  }

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  const url = `${backendBaseUrl()}${path}${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return { success: true, data: [] };
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Backend respondió ${response.status} en ${path}.`);
  }

  const payload = await response.json().catch(() => ({}));
  // Los endpoints Go usan respuestas keyset {items, has_more, next_*}.
  // Se conserva data/total para los consumidores legacy mientras migran.
  const rows = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.Items)
      ? payload.Items
      : Array.isArray(payload?.data) ? payload.data : [];
  const total = payload?.total == null ? undefined : Number(payload.total);
  const result = {
    success: true,
    data: rows,
    total,
  };
  if (includeCursor) Object.assign(result, {
    items: rows,
    hasMore: payload?.has_more === true,
    nextCursor: {
      createdAt: payload?.next_created_at ?? null,
      updatedAt: payload?.next_updated_at ?? null,
      soldAt: payload?.next_sold_at ?? null,
      name: payload?.next_name ?? null,
      id: payload?.next_id ?? null,
    },
  });
  return result;
}

export function listBackendProducts({ limit = 25, afterName, afterId, search } = {}) {
  return requestJson('/api/v1/products', { limit, after_name: afterName, after_id: afterId, search }, { includeCursor: true });
}

export function listBackendVariants({ limit = 25, afterName, afterId } = {}) {
  return requestJson('/api/v1/variants', { limit, after_name: afterName, after_id: afterId }, { includeCursor: true });
}
export function searchBackendVariants(search, { limit = 20, locationId } = {}) {
  return requestJson('/api/v1/variants', { limit, search, location_id: locationId }, { includeCursor: true });
}

export function listBackendCustomers({ limit = 25, afterCreatedAt, afterId } = {}) {
  return requestJson('/api/v1/customers', {
    limit,
    after_created_at: afterCreatedAt,
    after_id: afterId,
  }, { includeCursor: true });
}

export function listBackendInventory({ limit = 25, locationId, variantId, afterUpdatedAt, afterId } = {}) {
  return requestJson('/api/v1/inventory', {
    limit,
    location_id: locationId,
    variant_id: variantId,
    after_updated_at: afterUpdatedAt,
    after_id: afterId,
  }, { includeCursor: true });
}

export function listBackendSalesKeyset({ limit = 25, afterSoldAt, afterId } = {}) {
  return requestJson('/api/v1/sales', { limit, after_sold_at: afterSoldAt, after_id: afterId }, { includeCursor: true });
}

export function listBackendSales({ page = 1, pageSize = 20 } = {}) {
  return requestJson('/sales', { page, page_size: pageSize });
}

export function listBackendPurchases({ page = 1, pageSize = 20 } = {}) {
  return requestJson('/purchases', { page, page_size: pageSize });
}

export function listBackendStockBalances({
  page = 1,
  pageSize = 20,
  locationId = null,
  variantId = null,
  lowStock = null,
} = {}) {
  return requestJson('/api/v1/inventory/stock-balances', {
    page,
    page_size: pageSize,
    location_id: locationId,
    variant_id: variantId,
    low_stock: lowStock,
  });
}

export function listBackendPricingRules({ page = 1, pageSize = 50, scope, isActive } = {}) {
  return requestJson('/api/v1/pricing-rules', { page, page_size: pageSize, scope, is_active: isActive });
}
export function createBackendPricingRule(rule) {
  return requestJson('/api/v1/pricing-rules', {}, { method: 'POST', body: rule });
}
export function updateBackendPricingRule(id, rule) {
  return requestJson(`/api/v1/pricing-rules/${encodeURIComponent(id)}`, {}, { method: 'PATCH', body: rule });
}
export function deleteBackendPricingRule(id) {
  return requestJson(`/api/v1/pricing-rules/${encodeURIComponent(id)}`, {}, { method: 'DELETE' });
}
export function listBackendLocations({ limit = 100 } = {}) {
  return requestJson('/api/v1/locations', { limit });
}
