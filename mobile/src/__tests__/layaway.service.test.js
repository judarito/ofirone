jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const { supabase } = require('../lib/supabase');
const {
  addLayawayPayment,
  completeLayaway,
  createLayaway,
  getLayawayContracts,
  getLayawayDetail,
  getStockAvailable,
} = require('../services/layaway.service');

function createAwaitableQuery(result) {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    order: jest.fn(() => query),
    range: jest.fn(() => Promise.resolve(result)),
    single: jest.fn(() => Promise.resolve(result)),
    not: jest.fn(() => query),
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };

  return query;
}

describe('layaway.service', () => {
  let warnSpy;

  beforeEach(() => {
    supabase.from.mockReset();
    supabase.rpc.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('valida tenant requerido al listar contratos', async () => {
    const result = await getLayawayContracts(null);

    expect(result).toEqual({
      success: false,
      error: 'tenantId es requerido',
      data: [],
      total: 0,
    });
  });

  it('refresca el estado operativo antes de listar y no se bloquea si el rpc falla', async () => {
    const summaryQuery = createAwaitableQuery({
      data: [{ layaway_id: 'lay-1', status: 'ACTIVE' }],
      error: null,
      count: 1,
    });

    supabase.rpc.mockResolvedValueOnce({ error: { message: 'missing function' } });
    supabase.from.mockReturnValue(summaryQuery);

    const result = await getLayawayContracts('tenant-1', 1, 20, 'ACTIVE');

    expect(result).toEqual({
      success: true,
      data: [{ layaway_id: 'lay-1', status: 'ACTIVE' }],
      total: 1,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'No se pudo refrescar el estado operativo de plan separe:',
      'missing function',
    );
    expect(supabase.rpc).toHaveBeenCalledWith('fn_expire_due_layaways', {
      p_tenant: 'tenant-1',
    });
    expect(summaryQuery.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-1');
    expect(summaryQuery.eq).toHaveBeenNthCalledWith(2, 'status', 'ACTIVE');
  });

  it('arma el detalle con items, pagos y cuotas', async () => {
    const contractQuery = createAwaitableQuery({
      data: { layaway_id: 'lay-1', status: 'ACTIVE' },
      error: null,
    });
    const itemsQuery = createAwaitableQuery({
      data: [{ layaway_item_id: 'item-1' }],
      error: null,
    });
    const paymentsQuery = createAwaitableQuery({
      data: [{ payment_id: 'pay-1' }],
      error: null,
    });
    const installmentsQuery = createAwaitableQuery({
      data: [{ installment_id: 'inst-1' }],
      error: null,
    });

    supabase.rpc.mockResolvedValue({ error: null });
    supabase.from.mockImplementation((table) => {
      if (table === 'layaway_contracts') return contractQuery;
      if (table === 'layaway_items') return itemsQuery;
      if (table === 'vw_layaway_payments') return paymentsQuery;
      if (table === 'layaway_installments') return installmentsQuery;
      throw new Error(`tabla no mockeada: ${table}`);
    });

    const result = await getLayawayDetail('tenant-1', 'lay-1');

    expect(result.success).toBe(true);
    expect(result.data.items).toEqual([{ layaway_item_id: 'item-1' }]);
    expect(result.data.payments).toEqual([{ payment_id: 'pay-1' }]);
    expect(result.data.installments).toEqual([{ installment_id: 'inst-1' }]);
    expect(paymentsQuery.order).toHaveBeenCalledWith('paid_at', { ascending: false });
    expect(installmentsQuery.order).toHaveBeenCalledWith('due_date', { ascending: true });
  });

  it('envia cuotas y abono inicial al crear contratos', async () => {
    supabase.rpc.mockResolvedValue({
      data: { layaway_id: 'lay-9' },
      error: null,
    });

    const result = await createLayaway('tenant-1', {
      location_id: 'loc-1',
      customer_id: 'cust-1',
      created_by: 'user-1',
      items: [{ variant_id: 'var-1', qty: 1 }],
      due_date: '2026-04-30',
      note: 'Contrato demo',
      initial_payment: { payment_method_code: 'cash', amount: 5000 },
      installments: [{ due_date: '2026-05-05', amount: 7000, status: 'PENDING' }],
    });

    expect(result).toEqual({
      success: true,
      data: { layaway_id: 'lay-9' },
    });
    expect(supabase.rpc).toHaveBeenCalledWith('sp_create_layaway', {
      p_tenant: 'tenant-1',
      p_location: 'loc-1',
      p_customer: 'cust-1',
      p_created_by: 'user-1',
      p_items: [{ variant_id: 'var-1', qty: 1 }],
      p_due_date: '2026-04-30',
      p_note: 'Contrato demo',
      p_initial_payment: { payment_method_code: 'cash', amount: 5000 },
      p_installments: [{ due_date: '2026-05-05', amount: 7000, status: 'PENDING' }],
    });
  });

  it('refresca antes de completar y valida argumentos de stock disponible', async () => {
    supabase.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ data: { sale_id: 'sale-1' }, error: null });

    const completeResult = await completeLayaway('tenant-1', 'lay-1', 'user-1');
    const stockResult = await getStockAvailable('tenant-1', null, 'var-1');

    expect(completeResult).toEqual({
      success: true,
      data: { sale_id: 'sale-1' },
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'fn_expire_due_layaways', {
      p_tenant: 'tenant-1',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'sp_complete_layaway_to_sale', {
      p_tenant: 'tenant-1',
      p_layaway: 'lay-1',
      p_sold_by: 'user-1',
      p_note: null,
    });
    expect(stockResult).toEqual({
      success: false,
      error: 'tenantId, locationId y variantId son requeridos',
      data: null,
    });
  });

  it('permite seguir abonando aun si el refresh operativo falla', async () => {
    supabase.rpc
      .mockResolvedValueOnce({ error: { message: 'missing function' } })
      .mockResolvedValueOnce({ error: null });

    const result = await addLayawayPayment('tenant-1', 'lay-1', {
      payment_method_code: 'cash',
      amount: 12000,
      paid_by: 'user-1',
      cash_session_id: 'cash-1',
      reference: 'REC-1',
    });

    expect(result).toEqual({ success: true });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'sp_add_layaway_payment', {
      p_tenant: 'tenant-1',
      p_layaway: 'lay-1',
      p_payment_method_code: 'cash',
      p_amount: 12000,
      p_paid_by: 'user-1',
      p_cash_session: 'cash-1',
      p_reference: 'REC-1',
    });
  });
});
