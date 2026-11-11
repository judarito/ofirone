import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getValidSessionMock, fromMock, uploadMock } = vi.hoisted(() => ({
  getValidSessionMock: vi.fn(),
  fromMock: vi.fn(),
  uploadMock: vi.fn(),
}))

vi.mock('@/services/supabase.service', () => ({
  default: {
    getValidSession: getValidSessionMock,
    client: {
      storage: {
        from: fromMock,
      },
    },
  },
}))

async function loadServiceWithEnv({ enabled = true, baseUrl = 'https://backend.test/' } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_USE_BACKEND_MEDIA_JOBS', enabled ? 'true' : 'false')
  vi.stubEnv('VITE_BACKEND_API_URL', baseUrl)
  vi.stubEnv('VITE_MEDIA_PROCESSING_BUCKET', 'dataimport')
  return import('@/services/mediaProcessingClient.service')
}

describe('mediaProcessingClient.service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    getValidSessionMock.mockReset()
    fromMock.mockReset()
    uploadMock.mockReset()
    globalThis.fetch = vi.fn()
  })

  it('no sube ni encola cuando el feature flag está apagado', async () => {
    const service = await loadServiceWithEnv({ enabled: false })
    const file = new Blob(['img'], { type: 'image/jpeg' })

    const result = await service.enqueuePurchaseInvoicePhotoJob({ tenantId: 'tenant-1', file })

    expect(result).toEqual({ queued: false, job_id: null })
    expect(fromMock).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('sube factura a Storage y encola media job en backend', async () => {
    const file = new File(['img'], 'factura demo.jpg', { type: 'image/jpeg' })
    getValidSessionMock.mockResolvedValue({ access_token: 'user-token' })
    fromMock.mockReturnValue({ upload: uploadMock })
    uploadMock.mockResolvedValue({ error: null })
    globalThis.fetch.mockResolvedValue(Response.json({ job_id: 'job-1' }, { status: 202 }))

    const service = await loadServiceWithEnv()
    const result = await service.enqueuePurchaseInvoicePhotoJob({
      tenantId: 'tenant-1',
      file,
      context: { source_view: 'purchases' },
    })

    expect(result.queued).toBe(true)
    expect(result.job_id).toBe('job-1')
    expect(result.bucket).toBe('dataimport')
    expect(result.file_key).toContain('tenant-1/media/purchase_invoice_photo/')
    expect(fromMock).toHaveBeenCalledWith('dataimport')
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringContaining('tenant-1/media/purchase_invoice_photo/'),
      file,
      expect.objectContaining({
        upsert: false,
        contentType: 'image/jpeg',
      }),
    )
    expect(globalThis.fetch).toHaveBeenCalledWith('https://backend.test/media-processing/jobs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer user-token' }),
    }))
    const [, options] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toMatchObject({
      tenant_id: 'tenant-1',
      type: 'purchase_invoice_photo',
      bucket: 'dataimport',
      mime_type: 'image/jpeg',
      size_bytes: file.size,
      context: { source_view: 'purchases' },
      priority: 45,
      source: 'web',
    })
  })

  it('sube foto de catálogo y encola product_catalog_photo', async () => {
    const file = new File(['img'], 'lista productos.jpg', { type: 'image/jpeg' })
    getValidSessionMock.mockResolvedValue({ access_token: 'user-token' })
    fromMock.mockReturnValue({ upload: uploadMock })
    uploadMock.mockResolvedValue({ error: null })
    globalThis.fetch.mockResolvedValue(Response.json({ job_id: 'job-2' }, { status: 202 }))

    const service = await loadServiceWithEnv()
    const result = await service.enqueueProductCatalogPhotoJob({
      tenantId: 'tenant-1',
      file,
      context: { source_view: 'bulk_imports' },
    })

    expect(result.queued).toBe(true)
    expect(result.job_id).toBe('job-2')
    expect(result.file_key).toContain('tenant-1/media/product_catalog_photo/')
    const [, options] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toMatchObject({
      tenant_id: 'tenant-1',
      type: 'product_catalog_photo',
      bucket: 'dataimport',
      mime_type: 'image/jpeg',
      context: { source_view: 'bulk_imports' },
      priority: 45,
      source: 'web',
    })
  })
})
