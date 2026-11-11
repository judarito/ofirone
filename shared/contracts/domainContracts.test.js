import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CARTERA_REPOSITORY_METHODS,
  CUSTOMER_REPOSITORY_METHODS,
  INVENTORY_REPOSITORY_METHODS,
  PAYMENT_REPOSITORY_METHODS,
  PURCHASE_REPOSITORY_METHODS,
  SALES_REPOSITORY_METHODS,
  createDomainRepositoryAdapter,
} from './domainContracts.js';

function stubRepository(methods) {
  return Object.fromEntries(methods.map((method) => [method, async () => ({ method })]));
}

describe('domain repository contracts', () => {
  it('expone los métodos mínimos por dominio', () => {
    assert.ok(SALES_REPOSITORY_METHODS.includes('createSale'));
    assert.ok(INVENTORY_REPOSITORY_METHODS.includes('registerMovement'));
    assert.ok(CUSTOMER_REPOSITORY_METHODS.includes('upsertCustomer'));
    assert.ok(CARTERA_REPOSITORY_METHODS.includes('listReceivables'));
    assert.ok(PAYMENT_REPOSITORY_METHODS.includes('registerPayment'));
    assert.ok(PURCHASE_REPOSITORY_METHODS.includes('createPurchase'));
  });

  it('construye adapters conmutables con el patrón lookups', async () => {
    const fallback = stubRepository(INVENTORY_REPOSITORY_METHODS);
    const primary = stubRepository(INVENTORY_REPOSITORY_METHODS);
    const adapter = createDomainRepositoryAdapter({
      domain: 'inventory',
      fallback,
      primary,
      usePrimary: true,
    });

    assert.equal(typeof adapter.getStockBalances, 'function');
    assert.equal(typeof adapter.registerMovement, 'function');
    const result = await adapter.getStockBalances('tenant-1');
    assert.deepEqual(result, { method: 'getStockBalances' });
  });

  it('usa el fallback cuando el flag está apagado', async () => {
    const fallback = stubRepository(SALES_REPOSITORY_METHODS);
    const primary = stubRepository(SALES_REPOSITORY_METHODS);
    const adapter = createDomainRepositoryAdapter({
      domain: 'sales',
      fallback,
      primary,
      usePrimary: false,
    });
    const result = await adapter.listSales('tenant-1');
    assert.deepEqual(result, { method: 'listSales' });
  });

  it('rechaza dominios no soportados y repositorios incompletos', () => {
    assert.throws(
      () => createDomainRepositoryAdapter({ domain: 'marketing', fallback: {} }),
      /Dominio no soportado/
    );
    assert.throws(
      () =>
        createDomainRepositoryAdapter({
          domain: 'customer',
          fallback: stubRepository(SALES_REPOSITORY_METHODS),
        }),
      /no implementa/
    );
  });
});
