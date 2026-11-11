import { getBackendSession } from './backendAuthClient'

const BASE = (import.meta.env.VITE_BACKEND_API_URL || '').replace(/\/+$/, '')

export async function listBackendAlerts({ limit = 100, alertType, alertLevel, afterCreatedAt, afterId } = {}) {
  const token = getBackendSession()?.accessToken
  if (!BASE) throw new Error('VITE_BACKEND_API_URL no configurado.')
  if (!token) throw new Error('Sesión requerida para alertas.')
  const query = new URLSearchParams({ limit: String(limit) })
  if (alertType) query.set('alert_type', alertType)
  if (alertLevel) query.set('alert_level', alertLevel)
  if (afterCreatedAt) query.set('after_created_at', afterCreatedAt)
  if (afterId) query.set('after_id', afterId)
  const response = await fetch(`${BASE}/api/v1/system-alerts?${query}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.message || `Backend respondió ${response.status}.`)
  return body
}
