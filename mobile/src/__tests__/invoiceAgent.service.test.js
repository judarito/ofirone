jest.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const { supabase } = require('../lib/supabase');
const {
  analyzeInvoiceWithText,
  analyzeInvoiceWithImage,
  matchInvoiceLinesToCatalog,
} = require('../services/invoiceAgent.service');

describe('invoiceAgent.service', () => {
  beforeEach(() => {
    supabase.functions.invoke.mockReset();
  });

  it('valida tenant y texto OCR', async () => {
    await expect(analyzeInvoiceWithText({ tenantId: null, ocrText: 'abc' })).resolves.toEqual({
      success: false,
      error: 'tenantId es requerido.',
    });

    await expect(analyzeInvoiceWithText({ tenantId: 't1', ocrText: '   ' })).resolves.toEqual({
      success: false,
      error: 'No hay texto OCR para analizar.',
    });
  });

  it('normaliza respuesta exitosa de analyzeInvoiceWithText', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: {
        content: JSON.stringify({
          invoice: { vendor_name: 'Proveedor Demo' },
          line_items: [{ raw_name: 'Jean azul', quantity: 2, unit_price: 80000 }],
        }),
        model: 'deepseek-chat',
      },
      error: null,
    });

    const result = await analyzeInvoiceWithText({ tenantId: 't1', ocrText: 'ocr' });
    expect(result.success).toBe(true);
    expect(result.data.invoice.vendor_name).toBe('Proveedor Demo');
    expect(result.data.line_items[0]).toEqual({
      raw_name: 'Jean azul',
      sku: null,
      quantity: 2,
      unit_price: 80000,
      line_total: null,
    });
  });

  it('rechaza imagen demasiado grande', async () => {
    const result = await analyzeInvoiceWithImage({
      tenantId: 't1',
      imageBase64: 'a'.repeat(5_500_001),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('demasiado grande');
  });

  it('hace match de lineas contra catalogo', () => {
    const result = matchInvoiceLinesToCatalog(
      [{ raw_name: 'Camiseta blanca talla M', quantity: 1 }],
      [{ variant_id: 'v1', sku: 'CAM-M', variant_name: 'Talla M', product: { name: 'Camiseta blanca' } }],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
    expect(result.matched[0].variant.variant_id).toBe('v1');
  });
});
