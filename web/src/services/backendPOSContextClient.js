import { getBackendSession } from './backendAuthClient'

const BASE_URL = (import.meta.env.VITE_BACKEND_API_URL || '').replace(/\/+$/, '')

export async function getBackendPOSContext() {
  const token = getBackendSession()?.accessToken
  const response = await fetch(`${BASE_URL}/api/v1/pos/context`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || 'No se pudo cargar el contexto POS.')
  return payload
}
