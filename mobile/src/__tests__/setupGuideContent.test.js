import {
  GUIDED_ROUTES,
  HELP_FAQS,
  RECOMMENDED_SETUP_STEPS,
  SETUP_OPTIONS,
} from '../constants/setupGuideContent';

describe('setupGuideContent', () => {
  it('expone opciones de configuracion base', () => {
    expect(SETUP_OPTIONS.some((item) => item.key === 'TenantConfig')).toBe(true);
    expect(SETUP_OPTIONS.some((item) => item.key === 'AIInsights')).toBe(true);
  });

  it('incluye rutas guiadas operativas', () => {
    expect(GUIDED_ROUTES.map((item) => item.key)).toEqual([
      'PointOfSale',
      'Purchases',
      'Inventory',
      'Reports',
    ]);
  });

  it('mantiene FAQ con aclaracion web-only y flujo recomendado', () => {
    expect(HELP_FAQS.some((item) => String(item.answer).includes('web'))).toBe(true);
    expect(RECOMMENDED_SETUP_STEPS).toHaveLength(4);
    expect(RECOMMENDED_SETUP_STEPS[3]).toContain('POS');
  });
});
