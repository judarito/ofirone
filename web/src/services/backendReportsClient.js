import { getBackendSession } from './backendAuthClient'

const BASE = (import.meta.env.VITE_BACKEND_API_URL || '').replace(/\/+$/, '')

async function request(kind, params = {}) {
  const token = getBackendSession()?.accessToken
  if (!BASE) throw new Error('VITE_BACKEND_API_URL no configurado.')
  if (!token) throw new Error('Sesión requerida para reportes.')
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)) })
  const response = await fetch(`${BASE}/api/v1/reports/${kind}?${q}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.message || `Backend respondió ${response.status}.`)
  return body
}

export const getBackendSalesReport = (filters) => request('sales', filters)
export const getBackendPurchasesReport = (filters) => request('purchases', filters)
export const getBackendInventoryReport = (filters) => request('inventory', filters)
export const getBackendReceivablesReport = (filters) => request('receivables', filters)
export const getBackendDashboardSummary = (filters) => request('dashboard', filters)
