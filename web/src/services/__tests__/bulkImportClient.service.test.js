import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}))

vi.mock('@/plugins/supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}))

const importRecord = {
  tenant_id: 'tenant-1',
  import_id: 'import-1',
  import_type: 'product_variants',
  file_key: 'tenant-1/product_variants/file.xlsx',
  file_name: 'file.xlsx',
}

async function loadServiceWithEnv({ enabled = true, baseUrl = 'https://backend.test/' } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_USE_BACKEND_IMPORT_JOBS', enabled ? 'true' : 'false')
  vi.stubEnv('VITE_BACKEND_API_URL', baseUrl)
  return import('@/services/bulkImportClient.service')
}

describe('bulkImportClient.service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    getSessionMock.mockReset()
    globalThis.fetch = vi.fn()
  })

  it('no encola jobs cuando el feature flag está apagado', async () => {
    const service = await loadServiceWithEnv({ enabled: false })

    const result = await service.enqueueBulkImportApplyProducts(importRecord)

    expect(result).toEqual({ queued: false, job_id: null })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('encola aplicación de preview con contrato de job import_jobs', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'user-token' } },
    })
    globalThis.fetch.mockResolvedValue(Response.json({ job_id: 'job-1' }, { status: 202 }))

    const service = await loadServiceWithEnv()
    const result = await service.enqueueBulkImportApplyProducts(importRecord)

    expect(result).toEqual({ queued: true, job_id: 'job-1' })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://backend.test/async-jobs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer user-token',
      }),
    }))
    const [, options] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toMatchObject({
      tenant_id: 'tenant-1',
      queue: 'import_jobs',
      job_type: 'bulk_import_apply_products',
      dedupe_key: 'bulk-import-apply:import-1',
      priority: 40,
      payload: {
        import_id: 'import-1',
        import_type: 'product_variants',
        file_key: 'tenant-1/product_variants/file.xlsx',
        file_name: 'file.xlsx',
      },
    })
  })

  it('encola aplicación de preview de terceros con su job_type propio', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'user-token' } },
    })
    globalThis.fetch.mockResolvedValue(Response.json({ job_id: 'job-2' }, { status: 202 }))

    const service = await loadServiceWithEnv()
    const result = await service.enqueueBulkImportApplyThirdParties({
      ...importRecord,
      import_type: 'third_parties',
    })

    expect(result).toEqual({ queued: true, job_id: 'job-2' })
    const [, options] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toMatchObject({
      tenant_id: 'tenant-1',
      queue: 'import_jobs',
      job_type: 'bulk_import_apply_third_parties',
      dedupe_key: 'bulk-import-apply:import-1',
      payload: {
        import_id: 'import-1',
        import_type: 'third_parties',
      },
    })
  })
})
