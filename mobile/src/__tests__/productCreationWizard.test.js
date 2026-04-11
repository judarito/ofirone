import {
  applyProductCreationProfile,
  buildProductDraftFromProduct,
  buildProductPayloadForSave,
  buildSeedVariantPayload,
  inferProductCreationProfile,
  sanitizeProductDraft,
  shouldAskSeedVariant,
} from '../../../shared/utils/productCreationWizard';

describe('productCreationWizard shared logic', () => {
  it('component no se convierte en manufactured', () => {
    const draft = applyProductCreationProfile({}, 'component');
    expect(draft.inventory_behavior).toBe('RESELL');
    expect(draft.is_component).toBe(true);
    expect(draft.track_inventory).toBe(false);
  });

  it('manufactured conserva inventario y tipo de producción por defecto', () => {
    const draft = applyProductCreationProfile({}, 'manufactured');
    expect(draft.inventory_behavior).toBe('MANUFACTURED');
    expect(draft.track_inventory).toBe(false);
    expect(draft.production_type).toBe('ON_DEMAND');
  });

  it('bundle desactiva inventario, vencimiento y componente', () => {
    const draft = applyProductCreationProfile({
      track_inventory: true,
      requires_expiration: true,
      is_component: true,
    }, 'bundle');
    expect(draft.inventory_behavior).toBe('BUNDLE');
    expect(draft.track_inventory).toBe(false);
    expect(draft.requires_expiration).toBe(false);
    expect(draft.is_component).toBe(false);
  });

  it('service apaga inventario, vencimiento y componente', () => {
    const draft = sanitizeProductDraft({
      inventory_behavior: 'SERVICE',
      track_inventory: true,
      requires_expiration: true,
      is_component: true,
    });
    expect(draft.track_inventory).toBe(false);
    expect(draft.requires_expiration).toBe(false);
    expect(draft.is_component).toBe(false);
  });

  it('sale_variants pide variante inicial y omite campos base al guardar', () => {
    expect(shouldAskSeedVariant({ variant_mode: 'multiple' })).toBe(true);
    const payload = buildProductPayloadForSave({
      name: 'Zapato',
      variant_mode: 'multiple',
      base_cost: 10,
      base_price: 20,
    });
    expect(payload.base_cost).toBeUndefined();
    expect(payload.base_price).toBeUndefined();
  });

  it('buildSeedVariantPayload prepara la primera variante para mobile', () => {
    const payload = buildSeedVariantPayload({
      name: 'Zapato deportivo',
      variant_mode: 'multiple',
      inventory_behavior: 'RESELL',
      seed_variant_name: 'Negro 40',
      seed_variant_cost: 50000,
      seed_variant_price: 95000,
    });
    expect(payload.variant_name).toBe('Negro 40');
    expect(payload.cost).toBe(50000);
    expect(payload.price).toBe(95000);
    expect(typeof payload.sku).toBe('string');
    expect(payload.sku.length).toBeGreaterThan(0);
  });

  it('reconstruye un draft de edicion desde un producto existente', () => {
    const product = {
      product_id: 'p1',
      name: 'Tela antifluido',
      track_inventory: true,
      inventory_behavior: 'RESELL',
      product_variants: [
        { variant_name: 'Predeterminado', cost: 10000, price: 18000, min_stock: 5 },
      ],
    };

    expect(inferProductCreationProfile(product)).toBe('sale_simple');

    const draft = buildProductDraftFromProduct(product);
    expect(draft.product_id).toBe('p1');
    expect(draft.track_inventory).toBe(true);
    expect(draft.base_cost).toBe(10000);
    expect(draft.base_price).toBe(18000);
    expect(draft.base_min_stock).toBe(5);
  });
});
