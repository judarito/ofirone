import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getValidSessionMock } = vi.hoisted(() => ({
  getValidSessionMock: vi.fn(),
}))

vi.mock('@/services/supabase.service', () => ({
  default: {
    getValidSession: getValidSessionMock,
  },
}))

async function loadServiceWithEnv({
  baseUrl = 'https://backend.test/',
  importJobs = true,
  mediaJobs = true,
} = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_BACKEND_API_URL', baseUrl)
  vi.stubEnv('VITE_USE_BACKEND_IMPORT_JOBS', importJobs ? 'true' : 'false')
  vi.stubEnv('VITE_USE_BACKEND_MEDIA_JOBS', mediaJobs ? 'true' : 'false')
  return import('@/services/asyncJobsClient.service')
}

describe('asyncJobsClient.service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    getValidSessionMock.mockReset()
    globalThis.fetch = vi.fn()
  })

  it('retorna historial vacío cuando no hay backend jobs activos', async () => {
    const service = await loadServiceWithEnv({ importJobs: false, mediaJobs: false })

    const result = await service.listAsyncJobHistory()

    expect(result.jobs).toEqual([])
    expect(result.summary.total).toBe(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('consulta historial de jobs con JWT y filtros de cola', async () => {
    getValidSessionMock.mockResolvedValue({ access_token: 'user-token' })
    globalThis.fetch.mockResolvedValue(Response.json({
      summary: { total: 1, byStatus: { completed: 1 }, byQueue: { import_jobs: { total: 1 } } },
      jobs: [{ job_id: 'job-1', queue: 'import_jobs', status: 'completed' }],
    }))

    const service = await loadServiceWithEnv()
    const result = await service.listAsyncJobHistory({ queues: ['import_jobs', 'media_processing'], limit: 20 })

    expect(result.jobs).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://backend.test/async-jobs/history?queues=import_jobs%2Cmedia_processing&limit=20',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer user-token' }),
      }),
    )
  })
})
