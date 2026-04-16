jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const { supabase } = require('../lib/supabase');
const { createManualAdjustment, createPurchaseIngress } = require('../services/inventoryOperations.service');

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
    supabase.rpc.mockImplementation((fnName) => {
      if (fnName === 'sp_create_manual_purchase_ingress') return Promise.resolve({ data: 'm1', error: null });
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
    expect(supabase.rpc).toHaveBeenCalledWith('sp_create_manual_purchase_ingress', {
      p_tenant: 't1',
      p_location: 'l1',
      p_variant: 'v1',
      p_quantity: 3,
      p_unit_cost: 12000,
      p_created_by: 'u1',
      p_note: 'Ingreso manual',
    });
  });

  it('registra un ajuste atómico con rpc específico', async () => {
    supabase.rpc.mockImplementation((fnName) => {
      if (fnName === 'sp_create_inventory_adjustment') return Promise.resolve({ data: 'm2', error: null });
      if (fnName === 'fn_refresh_stock_alerts') return Promise.resolve({ error: null });
      throw new Error(`rpc no mockeada: ${fnName}`);
    });

    const result = await createManualAdjustment({
      tenantId: 't1',
      locationId: 'l1',
      variantId: 'v1',
      quantity: 2,
      unitCost: 5000,
      isIncrease: false,
      note: 'Ajuste de salida',
      createdBy: 'u1',
    });

    expect(result.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('sp_create_inventory_adjustment', {
      p_tenant: 't1',
      p_location: 'l1',
      p_variant: 'v1',
      p_quantity: 2,
      p_unit_cost: 5000,
      p_is_increase: false,
      p_created_by: 'u1',
      p_note: 'Ajuste de salida',
    });
  });
});
