jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../services/thirdParties.service', () => ({
  listThirdParties: jest.fn(),
}));

jest.mock('../services/ai-purchase-advisor.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(),
    generatePurchaseRecommendations: jest.fn(),
    generateExecutiveSummary: jest.fn(),
  },
}));

const { supabase } = require('../lib/supabase');
const aiPurchaseAdvisor = require('../services/ai-purchase-advisor.service').default;
const {
  getOpenPurchaseOrders,
  getSupplierPayablesDashboard,
  getAIPurchaseAnalysis,
  isAIAvailable,
} = require('../services/purchases.service');

function buildQuery(result) {
  return {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    not() { return this; },
    lte() { return this; },
    order() { return this; },
    limit() { return Promise.resolve(result); },
    range() { return Promise.resolve(result); },
  };
}

describe('purchases.service', () => {
  beforeEach(() => {
    supabase.from.mockReset();
    supabase.rpc.mockReset();
    aiPurchaseAdvisor.isAvailable.mockReset();
    aiPurchaseAdvisor.generatePurchaseRecommendations.mockReset();
    aiPurchaseAdvisor.generateExecutiveSummary.mockReset();
  });

  it('mapea ordenes de compra abiertas con cantidades pendientes', async () => {
    supabase.from.mockImplementation((table) => {
      if (table !== 'purchase_orders') throw new Error(`tabla no mockeada: ${table}`);
      return buildQuery({
        data: [{
          purchase_order_id: 'po1',
          status: 'DRAFT',
          lines: [
            { purchase_order_line_id: 'l1', qty_ordered: 5, qty_received: 2, unit_cost: 1000, variant_id: 'v1' },
            { purchase_order_line_id: 'l2', qty_ordered: 3, qty_received: 3, unit_cost: 2000, variant_id: 'v2' },
          ],
        }],
        error: null,
      });
    });

    const result = await getOpenPurchaseOrders('t1');

    expect(result.success).toBe(true);
    expect(result.data[0].pending_lines_count).toBe(1);
    expect(result.data[0].computed_total).toBe(11000);
    expect(result.data[0].lines[0].qty_remaining).toBe(3);
    expect(result.data[0].lines[1].qty_remaining).toBe(0);
  });

  it('mapea la bandeja de cuentas por pagar y calcula vencimiento', async () => {
    supabase.from.mockImplementation((table) => {
      if (table !== 'supplier_payables') throw new Error(`tabla no mockeada: ${table}`);
      return buildQuery({
        data: [{
          payable_id: 'pay1',
          purchase_id: 'p1',
          due_date: '2099-01-15',
          total_amount: 80000,
          paid_amount: 10000,
          balance: 70000,
          status: 'OPEN',
          supplier: { trade_name: 'Proveedor Demo', legal_name: 'Proveedor Demo SAS' },
          purchase: { location_id: 'l1', location: { name: 'Principal' } },
        }],
        error: null,
        count: 1,
      });
    });

    const result = await getSupplierPayablesDashboard({
      tenantId: 't1',
      status: 'OPEN_PARTIAL',
      dueInDays: null,
      page: 1,
      pageSize: 20,
    });

    expect(result.success).toBe(true);
    expect(result.total).toBe(1);
    expect(result.data[0].supplier_name).toBe('Proveedor Demo');
    expect(result.data[0].location_name).toBe('Principal');
    expect(result.data[0].is_overdue).toBe(false);
  });

  it('combina sugerencias base, rotacion y analisis IA', async () => {
    aiPurchaseAdvisor.isAvailable.mockReturnValue(true);
    aiPurchaseAdvisor.generatePurchaseRecommendations.mockResolvedValue({
      suggestions: [{ variant_id: 'v1', ai_priority: 1, ai_suggested_qty: 6 }],
      insights: [{ type: 'risk', impact: 'high', description: 'Stock crítico en top seller' }],
      warnings: [{ severity: 'critical', message: 'Reponer de inmediato' }],
      optimization_tips: [],
    });
    aiPurchaseAdvisor.generateExecutiveSummary.mockReturnValue({
      critical_products_count: 1,
      total_investment: 60000,
    });

    supabase.rpc.mockImplementation((fnName) => {
      if (fnName !== 'fn_get_purchase_suggestions') throw new Error(`rpc no mockeada: ${fnName}`);
      return Promise.resolve({
        data: [{ variant_id: 'v1', product_name: 'Jean', priority: 1, suggested_order_qty: 4, unit_cost: 10000 }],
        error: null,
      });
    });

    supabase.from.mockImplementation((table) => {
      if (table !== 'vw_inventory_rotation_analysis') throw new Error(`tabla no mockeada: ${table}`);
      return buildQuery({
        data: [{ variant_id: 'v1', current_stock: 1, sold_last_30d: 20 }],
        error: null,
      });
    });

    const result = await getAIPurchaseAnalysis('t1', { priorityLevel: 3 });

    expect(isAIAvailable()).toBe(true);
    expect(result.success).toBe(true);
    expect(aiPurchaseAdvisor.generatePurchaseRecommendations).toHaveBeenCalled();
    expect(result.data.executive_summary).toEqual({
      critical_products_count: 1,
      total_investment: 60000,
    });
    expect(result.data.base_suggestions).toHaveLength(1);
  });
});
