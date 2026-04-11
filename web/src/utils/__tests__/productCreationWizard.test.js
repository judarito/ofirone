import { describe, it, expect } from 'vitest'
import {
  PRODUCT_CREATION_PROFILE_IDS,
  applyProductCreationProfile,
  buildProductDraftFromProduct,
  buildProductPayloadForSave,
  buildSeedVariantPayload,
  generateSeedVariantSku,
  inferProductCreationProfile,
  sanitizeProductDraft,
  shouldAskSeedVariant,
} from '../../../../shared/utils/productCreationWizard'

describe('productCreationWizard', () => {
  it('expone los perfiles esperados del wizard', () => {
    expect(PRODUCT_CREATION_PROFILE_IDS).toEqual([
      'sale_simple',
      'sale_variants',
      'component',
      'manufactured',
      'bundle',
      'service',
    ])
  })

  it('perfil component mantiene RESELL y componente=true', () => {
    const draft = applyProductCreationProfile({}, 'component')
    expect(draft.inventory_behavior).toBe('RESELL')
    expect(draft.is_component).toBe(true)
    expect(draft.track_inventory).toBe(false)
  })

  it('perfil manufactured fuerza MANUFACTURED y production_type por defecto', () => {
    const draft = applyProductCreationProfile({}, 'manufactured')
    expect(draft.inventory_behavior).toBe('MANUFACTURED')
    expect(draft.production_type).toBe('ON_DEMAND')
    expect(draft.is_component).toBe(false)
    expect(draft.track_inventory).toBe(false)
  })

  it('service desactiva inventario y vencimiento', () => {
    const draft = sanitizeProductDraft({
      inventory_behavior: 'SERVICE',
      track_inventory: true,
      requires_expiration: true,
      is_component: true,
      base_min_stock: 20,
    })
    expect(draft.track_inventory).toBe(false)
    expect(draft.requires_expiration).toBe(false)
    expect(draft.is_component).toBe(false)
    expect(draft.base_min_stock).toBe(0)
  })

  it('bundle desactiva inventario, vencimiento y componente', () => {
    const draft = applyProductCreationProfile({
      track_inventory: true,
      requires_expiration: true,
      is_component: true,
    }, 'bundle')
    expect(draft.inventory_behavior).toBe('BUNDLE')
    expect(draft.track_inventory).toBe(false)
    expect(draft.requires_expiration).toBe(false)
    expect(draft.is_component).toBe(false)
  })

  it('variant_mode multiple limpia base_cost/base_price/base_min_stock', () => {
    const draft = sanitizeProductDraft({
      variant_mode: 'multiple',
      base_cost: 100,
      base_price: 200,
      base_min_stock: 3,
    })
    expect(draft.base_cost).toBe(0)
    expect(draft.base_price).toBe(0)
    expect(draft.base_min_stock).toBe(0)
  })

  it('detecta cuando debe pedir primera variante', () => {
    expect(shouldAskSeedVariant({ variant_mode: 'multiple' })).toBe(true)
    expect(shouldAskSeedVariant({ variant_mode: 'single' })).toBe(false)
  })

  it('buildProductPayloadForSave no envía campos base en modo multiple', () => {
    const payload = buildProductPayloadForSave({
      name: 'Camiseta',
      variant_mode: 'multiple',
      base_cost: 10,
      base_price: 20,
      base_min_stock: 2,
    })
    expect(payload.variant_mode).toBeUndefined()
    expect(payload.base_cost).toBeUndefined()
    expect(payload.base_price).toBeUndefined()
    expect(payload.base_min_stock).toBeUndefined()
  })

  it('buildSeedVariantPayload genera SKU determinístico y usa datos de la primera variante', () => {
    const payload = buildSeedVariantPayload({
      name: 'Camiseta básica',
      inventory_behavior: 'RESELL',
      variant_mode: 'multiple',
      requires_expiration: false,
      seed_variant_name: 'Azul M',
      seed_variant_cost: 25000,
      seed_variant_price: 49000,
      seed_variant_min_stock: 4,
    })
    expect(payload.variant_name).toBe('Azul M')
    expect(payload.cost).toBe(25000)
    expect(payload.price).toBe(49000)
    expect(payload.min_stock).toBe(4)
    expect(payload.sku).toBe(generateSeedVariantSku('Camiseta básica', 'Azul M'))
  })

  it('infiere perfil y draft de edición desde un producto simple existente', () => {
    const product = {
      product_id: 'p1',
      name: 'Camiseta básica',
      inventory_behavior: 'RESELL',
      track_inventory: true,
      product_variants: [
        {
          variant_name: 'Predeterminado',
          cost: 12000,
          price: 25000,
          min_stock: 3,
        },
      ],
    }

    expect(inferProductCreationProfile(product)).toBe('sale_simple')

    const draft = buildProductDraftFromProduct(product)
    expect(draft.product_id).toBe('p1')
    expect(draft.variant_mode).toBe('single')
    expect(draft.base_cost).toBe(12000)
    expect(draft.base_price).toBe(25000)
    expect(draft.base_min_stock).toBe(3)
    expect(draft.track_inventory).toBe(true)
  })

  it('infiere perfil con variantes cuando el producto ya maneja varias variantes', () => {
    const product = {
      inventory_behavior: 'RESELL',
      product_variants: [
        { variant_name: 'Azul M' },
        { variant_name: 'Azul L' },
      ],
    }

    expect(inferProductCreationProfile(product)).toBe('sale_variants')
  })
})
