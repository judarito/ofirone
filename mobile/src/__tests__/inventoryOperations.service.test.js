jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const { supabase } = require('../lib/supabase');
const { createPurchaseIngress } = require('../services/inventoryOperations.service');

function buildInsertChain(result) {
  return {
    select() {
      return {
        single: () => Promise.resolve(result),
      };
    },
  };
}

describe('inventoryOperations.service', () => {
  beforeEach(() => {
    supabase.from.mockReset();
    supabase.rpc.mockReset();
  });

  it('valida los datos requeridos para ingreso por compra', async () => {
    await expect(createPurchaseIngress({
      tenantId: null,
      locationId: 'l1',
      variantId: 'v1',
      quantity: 1,
      unitCost: 1000,
      createdBy: 'u1',
    })).resolves.toEqual({
      success: false,
      error: 'Faltan datos para registrar el ingreso por compra.',
    });

    await expect(createPurchaseIngress({
      tenantId: 't1',
      locationId: 'l1',
      variantId: 'v1',
      quantity: 0,
      unitCost: 1000,
      createdBy: 'u1',
    })).resolves.toEqual({
      success: false,
      error: 'La cantidad debe ser mayor a 0.',
    });
  });

  it('registra un ingreso por compra y aplica delta de stock', async () => {
    supabase.from.mockImplementation((table) => {
      if (table !== 'inventory_moves') throw new Error(`tabla no mockeada: ${table}`);
      return {
        insert: () => buildInsertChain({
          data: { inventory_move_id: 'm1', move_type: 'PURCHASE_IN' },
          error: null,
        }),
      };
    });

    supabase.rpc.mockImplementation((fnName) => {
      if (fnName === 'fn_apply_stock_delta') return Promise.resolve({ error: null });
      if (fnName === 'fn_refresh_stock_alerts') return Promise.resolve({ error: null });
      throw new Error(`rpc no mockeada: ${fnName}`);
    });

    const result = await createPurchaseIngress({
      tenantId: 't1',
      locationId: 'l1',
      variantId: 'v1',
      quantity: 3,
      unitCost: 12000,
      note: 'Ingreso manual',
      createdBy: 'u1',
    });

    expect(result.success).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('inventory_moves');
    expect(supabase.rpc).toHaveBeenCalledWith('fn_apply_stock_delta', {
      p_tenant: 't1',
      p_location: 'l1',
      p_variant: 'v1',
      p_delta: 3,
    });
  });
});
