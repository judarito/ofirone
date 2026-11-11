import { getBackendSession } from './backendAuthClient'

const BASE_URL = (import.meta.env.VITE_BACKEND_API_URL || '').replace(/\/+$/, '')

async function request(path, options = {}) {
  const token = getBackendSession()?.accessToken
  if (!BASE_URL) throw new Error('VITE_BACKEND_API_URL no configurado.')
  if (!token) throw new Error('Sesión requerida para ventas.')
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Backend respondió ${response.status}.`)
  return payload
}

export function createBackendSale(payload) {
  return request('/api/v1/sales', { method: 'POST', body: JSON.stringify(payload) })
}

export function listBackendSales({ limit = 25, afterSoldAt, afterId } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (afterSoldAt) params.set('after_sold_at', afterSoldAt)
  if (afterId) params.set('after_id', afterId)
  return request(`/api/v1/sales?${params.toString()}`)
}
export function getBackendSale(id) { return request(`/api/v1/sales/${encodeURIComponent(id)}`) }
export function voidBackendSale(id) { return request(`/api/v1/sales/${encodeURIComponent(id)}/void`, { method: 'POST' }) }
