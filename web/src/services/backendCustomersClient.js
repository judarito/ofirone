import { supabase } from '@/plugins/supabase';
import { getBackendSession } from './backendAuthClient';

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || '';
export const USE_BACKEND_CUSTOMERS = import.meta.env.VITE_USE_BACKEND_CUSTOMERS === 'true';
const cursorCache = new Map();

function backendBaseUrl() {
  return BACKEND_BASE_URL.replace(/\/+$/, '');
}

// Lista clientes (terceros) vía el endpoint del backend gateway.
// Devuelve { success, data, total } con las filas crudas de `third_parties`;
// el mapeo al shape de la UI lo hace el caller (customers.service => _map...).
export async function listBackendCustomers({ page = 1, pageSize = 20, search = '' } = {}) {
  if (!BACKEND_BASE_URL) {
    throw new Error('VITE_BACKEND_API_URL no configurado para listar clientes vía backend.');
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new Error('Sesión requerida para listar clientes vía backend.');
  }

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (search) params.set('search', search);

  const response = await fetch(`${backendBaseUrl()}/customers?${params.toString()}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Backend respondió ${response.status} al listar clientes.`);
  }

  const payload = await response.json().catch(() => ({}));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const total = Number(payload?.total ?? 0);
  return { success: true, data: rows, total };
}

// Adaptador de la paginación keyset Go a la API histórica por páginas de la UI.
// Solo se usa sin búsqueda; el endpoint Go añadirá filtros en un slice posterior.
export async function listBackendCustomersKeyset({ tenantId, page = 1, pageSize = 20 } = {}) {
  if (!tenantId) throw new Error('Tenant requerido para listar clientes vía backend.')
  const key = `${tenantId}:${pageSize}`
  let cursor = cursorCache.get(key) || { afterCreatedAt: null, afterId: null }
  let result = { data: [], hasMore: false }

  for (let current = 1; current <= page; current += 1) {
    const params = new URLSearchParams({ limit: String(pageSize) })
    if (cursor.afterCreatedAt) params.set('after_created_at', cursor.afterCreatedAt)
    if (cursor.afterId) params.set('after_id', cursor.afterId)
    const { data } = await supabase.auth.getSession()
    const accessToken = getBackendSession()?.accessToken || data?.session?.access_token
    const response = await fetch(`${backendBaseUrl()}/api/v1/customers?${params}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error || `Backend respondió ${response.status}.`)
    result = { data: payload.items || [], hasMore: payload.has_more === true }
    cursor = { afterCreatedAt: payload.next_created_at || null, afterId: payload.next_id || null }
    if (!result.hasMore || current === page) break
  }
  cursorCache.set(key, cursor)
  return { success: true, data: result.data, total: result.hasMore ? page * pageSize + 1 : (page - 1) * pageSize + result.data.length }
}
