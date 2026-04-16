const {
  buildBatchAlertMeta,
  createBatchDraft,
  formatDaysToExpiry,
  getBatchAlertLevel,
} = require('../services/batches.service');

describe('batches.service', () => {
  it('clasifica correctamente un lote crítico según su fecha de vencimiento', () => {
    const result = getBatchAlertLevel('2026-04-18', { baseDate: new Date('2026-04-12T10:00:00Z') });
    expect(result).toBe('CRITICAL');
  });

  it('construye metadata legible para un lote vencido', () => {
    const meta = buildBatchAlertMeta('2026-04-10', new Date('2026-04-12T10:00:00Z'));
    expect(meta.level).toBe('EXPIRED');
    expect(meta.label).toContain('Vencido');
  });

  it('crea un draft de lote con sede inicial y valores string compatibles con el formulario', () => {
    const draft = createBatchDraft('loc-1', { batch_number: 'LOT-1', on_hand: 5 });
    expect(draft.location_id).toBe('loc-1');
    expect(draft.batch_number).toBe('LOT-1');
    expect(draft.on_hand).toBe('5');
    expect(formatDaysToExpiry(1)).toBe('Vence mañana');
  });
});
