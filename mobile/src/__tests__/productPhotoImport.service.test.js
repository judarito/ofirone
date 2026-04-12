jest.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const { supabase } = require('../lib/supabase');
const {
  importProductsFromRows,
  parseProductsFromPhoto,
} = require('../services/productPhotoImport.service');

function buildQuery(result) {
  return {
    select() { return this; },
    eq() { return this; },
    ilike() { return this; },
    or() { return this; },
    order() { return this; },
    limit() { return Promise.resolve(result); },
    single() { return Promise.resolve(result); },
  };
}

function buildInsertChain(result) {
  return {
    select() {
      return {
        single: () => Promise.resolve(result),
      };
    },
  };
}

describe('productPhotoImport.service', () => {
  beforeEach(() => {
    supabase.functions.invoke.mockReset();
    supabase.from.mockReset();
    supabase.rpc.mockReset();
  });

  it('valida tenant e imagen', async () => {
    await expect(parseProductsFromPhoto({ tenantId: null, imageBase64: 'x' })).resolves.toEqual({
      success: false,
      error: 'tenantId es requerido.',
    });

    await expect(parseProductsFromPhoto({ tenantId: 't1', imageBase64: '' })).resolves.toEqual({
      success: false,
      error: 'imageBase64 es requerido.',
    });
  });

  it('normaliza productos detectados por foto', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: {
        products: [{ product_name: 'Gorra negra', unit_price: 25000, confidence: 0.88 }],
        warnings: ['angulo bajo'],
        model: 'deepseek-chat',
      },
      error: null,
    });

    const result = await parseProductsFromPhoto({ tenantId: 't1', imageBase64: 'abcd' });
    expect(result.success).toBe(true);
    expect(result.data.products).toHaveLength(1);
    expect(result.data.products[0].product_name).toBe('Gorra negra');
    expect(result.data.warnings).toEqual(['angulo bajo']);
  });

  it('importa una fila simple con mocks de DB', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'products') {
        return {
          ...buildQuery({ data: [], error: null }),
          insert: () => buildInsertChain({ data: { product_id: 'p1' }, error: null }),
        };
      }
      if (table === 'product_variants') {
        return {
          ...buildQuery({ data: [], error: null }),
          insert: () => buildInsertChain({ data: { variant_id: 'v1' }, error: null }),
        };
      }
      throw new Error(`tabla no mockeada: ${table}`);
    });

    const result = await importProductsFromRows({
      tenantId: 't1',
      rows: [{ product_name: 'Producto demo', unit_price: 1000, unit_cost: 500 }],
      defaults: {},
    });

    expect(result.success).toBe(true);
    expect(result.data.processed).toBe(1);
    expect(result.data.created).toBe(1);
  });

  it('retorna error si no hay filas validas', async () => {
    await expect(importProductsFromRows({
      tenantId: 't1',
      rows: [{ product_name: '' }],
      defaults: {},
    })).resolves.toEqual({
      success: false,
      error: 'No hay filas validas para importar.',
    });
  });
});
