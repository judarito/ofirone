import {
  buildInitialVariantDraft,
  buildVariantPayloadForSave,
  getVariantMinimumAlertSummary,
  sanitizeVariantDraft,
} from '../../../shared/utils/productVariantWizard';

describe('productVariantWizard shared logic', () => {
  it('apaga sobreventa y alerta cuando no hay control de inventario', () => {
    const draft = sanitizeVariantDraft({
      min_stock: 7,
      allow_backorder: true,
    }, {
      track_inventory: false,
    });

    expect(draft.min_stock).toBe(0);
    expect(draft.allow_backorder).toBe(false);
  });

  it('respeta la alerta minima cuando el producto si controla inventario', () => {
    const payload = buildVariantPayloadForSave({
      sku: 'SKU-2',
      variant_name: 'Azul 38',
      min_stock: 2,
    }, {
      track_inventory: true,
    });

    expect(payload.min_stock).toBe(2);
    expect(getVariantMinimumAlertSummary(payload, { track_inventory: true })).toBe('Activa desde 2');
  });

  it('crea un draft inicial activo y saneado', () => {
    const draft = buildInitialVariantDraft({
      sku: '  SKU-3 ',
    });

    expect(draft.sku).toBe('SKU-3');
    expect(draft.is_active).toBe(true);
  });
});
