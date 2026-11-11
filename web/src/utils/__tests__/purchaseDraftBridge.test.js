import { beforeEach, describe, expect, it } from 'vitest';

import {
  consumePendingPurchaseDraft,
  peekPendingPurchaseDraft,
  savePendingPurchaseDraft,
} from '@/utils/purchaseDraftBridge';

describe('purchaseDraftBridge', () => {
  beforeEach(() => {
    consumePendingPurchaseDraft();
  });

  it('guarda, lee y consume el draft de compra (round-trip)', () => {
    const draft = {
      job_type: 'purchase_invoice_photo',
      result: {
        phase: 'draft_ready',
        draft: {
          invoice: { vendor_name: 'Proveedor Demo' },
          line_items: [{ raw_name: 'Producto factura', quantity: 1 }],
        },
      },
    };

    savePendingPurchaseDraft(draft);
    expect(peekPendingPurchaseDraft()).toEqual(draft);

    const consumed = consumePendingPurchaseDraft();
    expect(consumed).toEqual(draft);
    // Tras consumir queda vacío.
    expect(peekPendingPurchaseDraft()).toBeNull();
    expect(consumePendingPurchaseDraft()).toBeNull();
  });

  it('tolera drafts vacíos', () => {
    expect(peekPendingPurchaseDraft()).toBeNull();
    savePendingPurchaseDraft(null);
    expect(peekPendingPurchaseDraft()).toBeNull();
  });
});
