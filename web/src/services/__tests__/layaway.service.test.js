import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.fn()
const fromMock = vi.fn()
const serviceErrorResultMock = vi.fn((error) => ({
  success: false,
  error: error?.message || 'unknown',
}))

vi.mock('@/services/supabase.service', () => ({
  default: {
    client: {
      rpc: rpcMock,
      from: fromMock,
    },
  },
}))

vi.mock('@/utils/appErrors', () => ({
  serviceErrorResult: serviceErrorResultMock,
}))

import layawayService from '@/services/layaway.service'

function createAwaitableQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    not: vi.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }

  return query
}

describe('layaway.service', () => {
  let warnSpy
  let errorSpy

  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
    serviceErrorResultMock.mockClear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('refresca el estado operativo antes de listar contratos', async () => {
    const summaryQuery = createAwaitableQuery({
      data: [{ layaway_id: 'lay-1', status: 'ACTIVE' }],
      error: null,
      count: 1,
    })

    rpcMock.mockResolvedValue({ error: null })
    fromMock.mockReturnValue(summaryQuery)

    const result = await layawayService.getLayawayContracts('tenant-1', 2, 5, 'ACTIVE')

    expect(result).toEqual({
      success: true,
      data: [{ layaway_id: 'lay-1', status: 'ACTIVE' }],
      total: 1,
    })
    expect(rpcMock).toHaveBeenCalledWith('fn_expire_due_layaways', {
      p_tenant: 'tenant-1',
    })
    expect(rpcMock.mock.invocationCallOrder[0]).toBeLessThan(fromMock.mock.invocationCallOrder[0])
    expect(fromMock).toHaveBeenCalledWith('vw_layaway_summary')
    expect(summaryQuery.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-1')
    expect(summaryQuery.eq).toHaveBeenNthCalledWith(2, 'status', 'ACTIVE')
    expect(summaryQuery.range).toHaveBeenCalledWith(5, 9)
  })

  it('arma el detalle con items, pagos y cuotas', async () => {
    const contractQuery = createAwaitableQuery({
      data: { layaway_id: 'lay-1', status: 'ACTIVE', customer: { full_name: 'Cliente Demo' } },
      error: null,
    })
    const itemsQuery = createAwaitableQuery({
      data: [{ layaway_item_id: 'item-1', qty: 2 }],
      error: null,
    })
    const paymentsQuery = createAwaitableQuery({
      data: [{ payment_id: 'pay-1', amount: 10000 }],
      error: null,
    })
    const installmentsQuery = createAwaitableQuery({
      data: [{ installment_id: 'inst-1', amount: 5000 }],
      error: null,
    })

    rpcMock.mockResolvedValue({ error: null })
    fromMock.mockImplementation((table) => {
      if (table === 'layaway_contracts') return contractQuery
      if (table === 'layaway_items') return itemsQuery
      if (table === 'vw_layaway_payments') return paymentsQuery
      if (table === 'layaway_installments') return installmentsQuery
      throw new Error(`tabla no mockeada: ${table}`)
    })

    const result = await layawayService.getLayawayDetail('tenant-1', 'lay-1')

    expect(result.success).toBe(true)
    expect(result.data.items).toEqual([{ layaway_item_id: 'item-1', qty: 2 }])
    expect(result.data.payments).toEqual([{ payment_id: 'pay-1', amount: 10000 }])
    expect(result.data.installments).toEqual([{ installment_id: 'inst-1', amount: 5000 }])
    expect(contractQuery.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-1')
    expect(contractQuery.eq).toHaveBeenNthCalledWith(2, 'layaway_id', 'lay-1')
    expect(paymentsQuery.order).toHaveBeenCalledWith('paid_at', { ascending: false })
    expect(installmentsQuery.order).toHaveBeenCalledWith('due_date', { ascending: true })
  })

  it('envia cuotas y abono inicial al crear contratos', async () => {
    rpcMock.mockResolvedValue({
      data: { layaway_id: 'lay-9' },
      error: null,
    })

    const result = await layawayService.createLayaway('tenant-1', {
      location_id: 'loc-1',
      customer_id: 'cust-1',
      created_by: 'user-1',
      items: [{ variant_id: 'var-1', qty: 1, unit_price: 12000 }],
      due_date: '2026-04-30',
      note: 'Contrato demo',
      initial_payment: { payment_method_code: 'cash', amount: 5000 },
      installments: [{ due_date: '2026-05-05', amount: 7000, status: 'PENDING' }],
    })

    expect(result).toEqual({
      success: true,
      data: { layaway_id: 'lay-9' },
    })
    expect(rpcMock).toHaveBeenCalledWith('sp_create_layaway', {
      p_tenant: 'tenant-1',
      p_location: 'loc-1',
      p_customer: 'cust-1',
      p_created_by: 'user-1',
      p_items: [{ variant_id: 'var-1', qty: 1, unit_price: 12000 }],
      p_due_date: '2026-04-30',
      p_note: 'Contrato demo',
      p_initial_payment: { payment_method_code: 'cash', amount: 5000 },
      p_installments: [{ due_date: '2026-05-05', amount: 7000, status: 'PENDING' }],
    })
  })

  it('sigue permitiendo abonar cuando el refresh operativo falla', async () => {
    rpcMock
      .mockResolvedValueOnce({ error: { message: 'rpc missing' } })
      .mockResolvedValueOnce({ error: null })

    const result = await layawayService.addPayment('tenant-1', 'lay-1', {
      payment_method_code: 'cash',
      amount: 9000,
      paid_by: 'user-1',
      cash_session_id: 'cash-1',
      reference: 'REC-1',
    })

    expect(result).toEqual({ success: true })
    expect(warnSpy).toHaveBeenCalledWith(
      'No se pudo refrescar el estado operativo de plan separe:',
      'rpc missing',
    )
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'sp_add_layaway_payment', {
      p_tenant: 'tenant-1',
      p_layaway: 'lay-1',
      p_payment_method_code: 'cash',
      p_amount: 9000,
      p_paid_by: 'user-1',
      p_cash_session: 'cash-1',
      p_reference: 'REC-1',
    })
  })

  it('devuelve error controlado cuando completar falla', async () => {
    rpcMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'saldo pendiente' } })

    const result = await layawayService.completeLayaway('tenant-1', 'lay-1', 'user-1')

    expect(serviceErrorResultMock).toHaveBeenCalledWith({ message: 'saldo pendiente' })
    expect(result).toEqual({
      success: false,
      error: 'saldo pendiente',
    })
  })
})
