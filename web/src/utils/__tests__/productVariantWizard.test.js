import { describe, expect, it } from 'vitest'
import {
  buildInitialVariantDraft,
  buildVariantPayloadForSave,
  getVariantMinimumAlertSummary,
  sanitizeVariantDraft,
} from '../../../../shared/utils/productVariantWizard'

describe('productVariantWizard', () => {
  it('limpia inventario de la variante cuando el producto no lo controla', () => {
    const draft = sanitizeVariantDraft({
      min_stock: 8,
      allow_backorder: true,
    }, {
      track_inventory: false,
    })

    expect(draft.min_stock).toBe(0)
    expect(draft.allow_backorder).toBe(false)
  })

  it('limpia vencimiento cuando el producto no lo permite', () => {
    const draft = sanitizeVariantDraft({
      requires_expiration: true,
    }, {
      can_require_expiration: false,
    })

    expect(draft.requires_expiration).toBe(null)
  })

  it('prepara payload consistente y resumen de alerta', () => {
    const payload = buildVariantPayloadForSave({
      sku: 'SKU-1',
      variant_name: 'Negro M',
      min_stock: 4,
    }, {
      track_inventory: true,
      can_require_expiration: true,
    })

    expect(payload.sku).toBe('SKU-1')
    expect(payload.variant_name).toBe('Negro M')
    expect(getVariantMinimumAlertSummary(payload, { track_inventory: true })).toBe('Activa desde 4')
  })

  it('genera draft inicial saneado', () => {
    const draft = buildInitialVariantDraft({
      sku: '  TEST-1 ',
    })

    expect(draft.sku).toBe('TEST-1')
    expect(draft.is_active).toBe(true)
  })
})
