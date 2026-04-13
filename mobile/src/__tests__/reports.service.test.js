const { mapExpiringInventoryBatches } = require('../services/reports.service');

describe('reports.service', () => {
  it('mapea lotes proximos a vencer usando on_hand', () => {
    const rows = [
      {
        batch_id: 'b1',
        batch_number: 'LOT-1',
        expiration_date: '2026-04-20',
        on_hand: 5,
        location: { name: 'Principal' },
        variant: {
          sku: 'SKU-1',
          variant_name: 'Azul',
          cost: 12000,
          product: { name: 'Jean' },
        },
      },
    ];

    const result = mapExpiringInventoryBatches(rows, new Date('2026-04-12T10:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(5);
    expect(result[0].at_risk_value).toBe(60000);
    expect(result[0].status).toBe('WARNING');
    expect(result[0].location_name).toBe('Principal');
  });

  it('mantiene compatibilidad si llega quantity_on_hand desde una fuente legacy', () => {
    const rows = [
      {
        batch_id: 'b2',
        batch_number: 'LOT-2',
        expiration_date: '2026-04-15',
        quantity_on_hand: 3,
        location: { name: 'Bodega' },
        variant: {
          sku: 'SKU-2',
          cost: 1000,
          product: { name: 'Media' },
        },
      },
    ];

    const result = mapExpiringInventoryBatches(rows, new Date('2026-04-12T10:00:00Z'));

    expect(result[0].quantity).toBe(3);
    expect(result[0].at_risk_value).toBe(3000);
    expect(result[0].status).toBe('CRITICAL');
  });
});
