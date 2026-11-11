import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getBackendSalesReport } from '../backendReportsClient'

vi.mock('../backendAuthClient', () => ({ getBackendSession: () => ({ accessToken: 'test-token' }) }))

describe('backendReportsClient', () => {
  beforeEach(() => { global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }) })
  it('requests the tenant-scoped sales report with filters', async () => {
    await getBackendSalesReport({ limit: 10, location_id: 'loc-1' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/reports/sales?limit=10&location_id=loc-1'), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer test-token' }) }))
  })
})
