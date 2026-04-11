import {
  buildInitialThirdPartyDraft,
  buildThirdPartyDraftFromExisting,
  buildThirdPartyPayloadForSave,
  sanitizeThirdPartyDraft,
} from '../../../shared/utils/thirdPartyWizard';

describe('thirdPartyWizard shared logic', () => {
  it('usa cliente como tipo inicial por defecto', () => {
    const draft = buildInitialThirdPartyDraft();
    expect(draft.type).toBe('customer');
  });

  it('aplica forcedType al draft inicial', () => {
    const draft = buildInitialThirdPartyDraft('customer');
    expect(draft.type).toBe('customer');
  });

  it('normaliza creditos y terminos numericos', () => {
    const draft = sanitizeThirdPartyDraft({
      max_credit_amount: '5000',
      default_payment_terms: '15',
    });

    expect(draft.max_credit_amount).toBe(5000);
    expect(draft.default_payment_terms).toBe(15);
  });

  it('construye payload persistible', () => {
    const payload = buildThirdPartyPayloadForSave({
      legal_name: 'Tercero Demo',
      document_number: '900123',
      address_text: 'Calle 5',
    }, { tenantId: 'tenant-1' });

    expect(payload.tenant_id).toBe('tenant-1');
    expect(payload.address).toBe('Calle 5');
  });

  it('reconstruye draft de edición', () => {
    const draft = buildThirdPartyDraftFromExisting({
      third_party_id: 'tp1',
      legal_name: 'Cliente Uno',
      type: 'customer',
      address: 'Av 1',
    });

    expect(draft.third_party_id).toBe('tp1');
    expect(draft.address_text).toBe('Av 1');
  });
});
