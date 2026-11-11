import {
  GATEWAY_ERROR_CODES,
  createCorrelationId,
  createGatewayError,
} from '../../../../shared/contracts/gatewayErrors.js'
import { supabase } from '@/plugins/supabase'

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || ''

async function requestJson(path, operation) {
  const correlationId = createCorrelationId()
  const { data } = await supabase.auth.getSession()
  const accessToken = data?.session?.access_token

  if (!BACKEND_BASE_URL) {
    throw createGatewayError('VITE_BACKEND_API_URL no configurado.', {
      code: GATEWAY_ERROR_CODES.BACKEND_UNAVAILABLE,
      domain: 'lookups',
      operation,
      correlationId,
      retryable: true,
    })
  }

  const response = await fetch(`${BACKEND_BASE_URL.replace(/\/+$/, '')}${path}`, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-correlation-id': correlationId,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
  })
  if (!response.ok) {
    throw createGatewayError(`Backend respondió ${response.status} en ${path}.`, {
      code: response.status === 404 ? GATEWAY_ERROR_CODES.NOT_FOUND : GATEWAY_ERROR_CODES.BACKEND_UNAVAILABLE,
      domain: 'lookups',
      operation,
      correlationId,
      retryable: response.status >= 500,
      status: response.status,
    })
  }
  return response.json()
}

const backendLookupsRepository = {
  async listDocumentTypes() {
    const data = await requestJson('/lookups/document-types', 'listDocumentTypes')
    return Array.isArray(data) ? data : data?.data || []
  },

  async listDepartments() {
    const data = await requestJson('/lookups/departments', 'listDepartments')
    return Array.isArray(data) ? data : data?.data || []
  },

  async listCities(departmentId = null) {
    const query = departmentId ? `?department_id=${encodeURIComponent(departmentId)}` : ''
    const data = await requestJson(`/lookups/cities${query}`, 'listCities')
    return Array.isArray(data) ? data : data?.data || []
  },
}

export default backendLookupsRepository
