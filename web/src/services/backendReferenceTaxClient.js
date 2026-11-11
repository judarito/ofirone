import { getBackendSession } from './backendAuthClient'

const base = (import.meta.env.VITE_BACKEND_API_URL || '').replace(/\/+$/, '')
const resources = new Set(['taxes', 'currencies', 'regional-settings'])

async function request(resource, { id, method = 'GET', body, limit = 25, cursor, signal } = {}) {
  if (!resources.has(resource)) throw new Error('Maestro no válido.')
  if (!base) throw new Error('VITE_BACKEND_API_URL no configurado.')
  const token = getBackendSession()?.accessToken
  if (!token) throw new Error('Sesión requerida.')
  let path = `/api/v1/${resource}`
  if (id !== undefined) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador no válido.')
    path += `/${encodeURIComponent(id)}`
  } else if (method === 'GET') {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Límite entre 1 y 100 requerido.')
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    path += `?${params}`
  }
  const response = await fetch(`${base}${path}`, {
    method, signal,
    headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || `Backend respondió ${response.status}.`)
    error.status = response.status
    error.code = payload.code
    throw error
  }
  return payload
}

function client(resource) {
  return Object.freeze({
    list: (options = {}) => request(resource, { limit: options.limit, cursor: options.cursor, signal: options.signal }),
    get: (id, { signal } = {}) => request(resource, { id: id ?? null, signal }),
    create: (body, { signal } = {}) => request(resource, { method: 'POST', body, signal }),
    update: (id, body, { signal } = {}) => request(resource, { id: id ?? null, method: 'PUT', body, signal }),
    deactivate: (id, { signal } = {}) => request(resource, { id: id ?? null, method: 'DELETE', signal }),
  })
}

export const taxesClient = client('taxes')
export const currenciesClient = client('currencies')
export const regionalSettingsClient = client('regional-settings')

export async function getBackendTaxInfoForVariant(variantId, { signal } = {}) {
  if (typeof variantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(variantId)) {
    throw new Error('Identificador de variante no válido.')
  }
  if (!base) throw new Error('VITE_BACKEND_API_URL no configurado.')
  const token = getBackendSession()?.accessToken
  if (!token) throw new Error('Sesión requerida.')
  const response = await fetch(`${base}/api/v1/tax-info/variants/${encodeURIComponent(variantId)}`, {
    signal,
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || `Backend respondió ${response.status}.`)
    error.status = response.status
    error.code = payload.code
    throw error
  }
  return { success: true, rate: Number(payload.rate) || 0, code: payload.code || null, name: payload.name || null }
}
