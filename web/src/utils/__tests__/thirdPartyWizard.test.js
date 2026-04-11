import { describe, expect, it } from 'vitest'
import {
  buildInitialThirdPartyDraft,
  buildThirdPartyDraftFromExisting,
  buildThirdPartyPayloadForSave,
  getThirdPartyTypeHelpText,
  normalizeThirdPartyType,
  sanitizeThirdPartyDraft,
} from '../../../../shared/utils/thirdPartyWizard'

describe('thirdPartyWizard', () => {
  it('arranca en cliente cuando no se fuerza un tipo', () => {
    const draft = buildInitialThirdPartyDraft()
    expect(draft.type).toBe('customer')
  })

  it('respeta forcedType al inicializar', () => {
    const draft = buildInitialThirdPartyDraft('supplier')
    expect(draft.type).toBe('supplier')
  })

  it('normaliza numeros y strings del draft', () => {
    const draft = sanitizeThirdPartyDraft({
      legal_name: '  Comercial SAS ',
      email: ' TEST@MAIL.COM ',
      max_credit_amount: '1000',
      default_payment_terms: '30',
    })

    expect(draft.legal_name).toBe('Comercial SAS')
    expect(draft.email).toBe('test@mail.com')
    expect(draft.max_credit_amount).toBe(1000)
    expect(draft.default_payment_terms).toBe(30)
  })

  it('arma payload listo para guardar', () => {
    const payload = buildThirdPartyPayloadForSave({
      legal_name: 'Cliente Demo',
      document_number: '123',
      address_text: 'Calle 1',
      default_currency: 'cop',
    }, { tenantId: 'tenant-1' })

    expect(payload.tenant_id).toBe('tenant-1')
    expect(payload.address).toBe('Calle 1')
    expect(payload.default_currency).toBe('COP')
  })

  it('reconstruye draft desde tercero existente', () => {
    const draft = buildThirdPartyDraftFromExisting({
      third_party_id: 'tp1',
      legal_name: 'Proveedor Uno',
      type: 'supplier',
      address: { street: 'Cra 10' },
    })

    expect(draft.third_party_id).toBe('tp1')
    expect(draft.type).toBe('supplier')
    expect(draft.address_text).toBe('Cra 10')
  })

  it('expone ayuda por tipo', () => {
    expect(normalizeThirdPartyType('customer')).toBe('customer')
    expect(getThirdPartyTypeHelpText('both')).toContain('ambos')
  })
})
