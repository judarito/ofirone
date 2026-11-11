const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || ''
export const USE_BACKEND_AUTH = import.meta.env.VITE_USE_BACKEND_AUTH === 'true'
const STORAGE_KEY = 'ofirone_backend_session'

export function getBackendSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch (_) { return null }
}

export function clearBackendSession() {
  try { localStorage.removeItem(STORAGE_KEY) } catch (_) { /* storage may be unavailable in SSR/tests */ }
}

function saveSession(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      accessToken: payload?.AccessToken || payload?.access_token,
      refreshToken: payload?.RefreshToken || payload?.refresh_token,
      expiresAt: payload?.ExpiresAt || payload?.expires_at,
      sessionId: payload?.SessionID || payload?.session_id,
    }))
  } catch (_) { /* storage may be unavailable in SSR/tests */ }
  return payload
}

function baseUrl() {
  return BACKEND_BASE_URL.replace(/\/+$/, '')
}

async function post(path, body) {
  if (!BACKEND_BASE_URL) throw new Error('VITE_BACKEND_API_URL no configurado.')
  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Backend respondió ${response.status}.`)
  return payload
}

export function loginBackend({ email, password, tenantId }) {
  return post('/api/v1/auth/login', { email, password, tenant_id: tenantId }).then(saveSession)
}

export function refreshBackend(refreshToken) {
  return post('/api/v1/auth/refresh', { refresh_token: refreshToken }).then(saveSession)
}

export function logoutBackend({ accessToken, sessionId }) {
  if (!BACKEND_BASE_URL) return Promise.reject(new Error('VITE_BACKEND_API_URL no configurado.'))
  return fetch(`${baseUrl()}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.message || payload?.error || `Backend respondió ${response.status}.`)
    }
    clearBackendSession()
    return true
  })
}

export async function getBackendMe(accessToken = getBackendSession()?.accessToken) {
  if (!BACKEND_BASE_URL) throw new Error('VITE_BACKEND_API_URL no configurado.')
  const response = await fetch(`${baseUrl()}/api/v1/me`, { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || 'No se pudo cargar la sesión Go.')
  return payload
}

export async function getBackendMenus(accessToken = getBackendSession()?.accessToken) {
  if (!BACKEND_BASE_URL) throw new Error('VITE_BACKEND_API_URL no configurado.')
  const response = await fetch(`${baseUrl()}/api/v1/me/menu`, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || 'No se pudo cargar el menú Go.')
  return payload?.data || []
}
