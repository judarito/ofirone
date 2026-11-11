import supabaseService from './supabase.service'

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || ''
const USE_BACKEND_IMPORT_JOBS = import.meta.env.VITE_USE_BACKEND_IMPORT_JOBS === 'true'
const USE_BACKEND_MEDIA_JOBS = import.meta.env.VITE_USE_BACKEND_MEDIA_JOBS === 'true'

function backendBaseUrl() {
  return BACKEND_BASE_URL.replace(/\/+$/, '')
}

async function getAccessToken() {
  const session = await supabaseService.getValidSession({ redirectOnFail: false, minValiditySeconds: 30 })
  const accessToken = session?.access_token
  if (!accessToken) {
    throw new Error('Sesión requerida para consultar historial de jobs.')
  }
  return accessToken
}

export function isBackendJobHistoryEnabled() {
  return Boolean(BACKEND_BASE_URL && (USE_BACKEND_IMPORT_JOBS || USE_BACKEND_MEDIA_JOBS))
}

export async function listAsyncJobHistory({
  queues = ['import_jobs', 'media_processing'],
  limit = 50,
} = {}) {
  if (!isBackendJobHistoryEnabled()) {
    return { summary: { total: 0, byStatus: {}, byQueue: {} }, jobs: [] }
  }

  const accessToken = await getAccessToken()
  const params = new URLSearchParams({
    queues: queues.join(','),
    limit: String(limit),
  })
  const response = await fetch(`${backendBaseUrl()}/async-jobs/history?${params.toString()}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Backend respondió ${response.status} al consultar historial de jobs.`)
  }

  return {
    summary: payload?.summary || { total: 0, byStatus: {}, byQueue: {} },
    jobs: Array.isArray(payload?.jobs) ? payload.jobs : [],
  }
}
