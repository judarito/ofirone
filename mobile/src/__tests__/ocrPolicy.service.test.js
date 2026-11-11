const {
  analyzeInvoiceOcrQuality,
  resolveOcrPolicyMode,
  scoreInvoiceOcrText,
  shouldTryCloudOcr,
} = require('../services/ocrPolicy.service');

describe('ocrPolicy.service', () => {
  it('usa native-first como default y fuerza native-first offline', () => {
    expect(resolveOcrPolicyMode()).toBe('native-first');
    expect(resolveOcrPolicyMode({ mode: 'cloud-first' })).toBe('cloud-first');
    expect(resolveOcrPolicyMode({ mode: 'cloud-first', offlineMode: true })).toBe('native-first');
    expect(resolveOcrPolicyMode({ mode: 'weird' })).toBe('native-first');
  });

  it('califica texto OCR util de factura', () => {
    const text = 'Factura 123\nCantidad Descripcion Valor\n2 Arroz Diana 5000\n1 Aceite vegetal 12000';
    const quality = analyzeInvoiceOcrQuality(text);

    expect(scoreInvoiceOcrText(text)).toBeGreaterThan(10);
    expect(quality.sufficient).toBe(true);
    expect(quality.reason).toBe('sufficient');
  });

  it('rechaza texto corto o ruidoso', () => {
    expect(analyzeInvoiceOcrQuality('abc').reason).toBe('too_short');
    expect(analyzeInvoiceOcrQuality('@@@ ### $$$ %%% &&& !!!!!', { minChars: 10 }).reason).toBe('too_noisy');
  });

  it('permite cloud solo como fallback o diagnostico', () => {
    expect(shouldTryCloudOcr({ policyMode: 'native-first', nativeAvailable: false })).toEqual({
      shouldTry: true,
      reason: 'native_unavailable',
    });
    expect(shouldTryCloudOcr({
      policyMode: 'native-first',
      nativeAvailable: true,
      nativeQuality: { sufficient: true },
    })).toEqual({ shouldTry: false, reason: 'native_sufficient' });
    expect(shouldTryCloudOcr({ policyMode: 'cloud-first' })).toEqual({
      shouldTry: true,
      reason: 'diagnostic_cloud_first',
    });
    expect(shouldTryCloudOcr({ policyMode: 'cloud-first', offlineMode: true })).toEqual({
      shouldTry: false,
      reason: 'offline',
    });
  });
});
