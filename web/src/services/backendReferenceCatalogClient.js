import { getBackendSession } from './backendAuthClient'

const base = (import.meta.env.VITE_BACKEND_API_URL || '').replace(/\/+$/, '')

async function request(kind, id, method = 'GET', body, query) {
  const token = getBackendSession()?.accessToken
  if (!base) throw new Error('VITE_BACKEND_API_URL no configurado.')
  if (!token) throw new Error('Sesión requerida para maestros.')
  const params = new URLSearchParams()
  if (query) {
    params.set('limit', String(query.limit ?? 25))
    if (query.afterName) params.set('after_name', query.afterName)
    if (query.afterId) params.set('after_id', query.afterId)
  }
  const suffix = params.size ? `?${params}` : ''
  const response = await fetch(`${base}/api/v1/${kind}${id ? `/${encodeURIComponent(id)}` : ''}${suffix}`, {
    method,
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

function catalog(kind) {
  return {
    list: (query = {}) => request(kind, null, 'GET', undefined, query),
    get: id => request(kind, id),
    create: data => request(kind, null, 'POST', data),
    update: (id, data) => request(kind, id, 'PATCH', data),
    deactivate: id => request(kind, id, 'DELETE'),
  }
}

export const backendUnitsOfMeasure = catalog('units-of-measure')
export const backendCategories = catalog('categories')
