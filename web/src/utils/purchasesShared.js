export function createEmptyPurchaseLine(payload = {}) {
  return {
    variant_id: payload.variant_id || null,
    qty: Number(payload.qty ?? 1),
    unit_cost: Number(payload.unit_cost ?? 0),
    requires_expiration: !!payload.requires_expiration,
    batch_number: payload.batch_number || '',
    expiration_date: payload.expiration_date || null,
    physical_location: payload.physical_location || '',
    label: payload.label || null,
    product_name: payload.product_name || null,
    variant_name: payload.variant_name || null,
    sku: payload.sku || null,
    source: payload.source || null,
    invoice_confidence: payload.invoice_confidence ?? null,
    invoice_match_reason: payload.invoice_match_reason || null,
    invoice_raw_name: payload.invoice_raw_name || null,
  }
}
