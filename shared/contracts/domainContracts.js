// Contratos de repositorio por dominio (fase 18A.4 / Núcleo A3).
// Define qué métodos debe implementar cada dominio para que pantallas y
// servicios no conozcan tablas/RPC. Cada dominio tendrá un adapter Supabase
// (hoy) y un adapter BackendGateway (cuando exista el endpoint equivalente),
// conmutados por feature flag y con fallback (patrón del piloto `lookups`).

import { createFeatureFlagAdapter } from './repositoryContract.js';

export const SALES_REPOSITORY_METHODS = ['listSales', 'getSale', 'createSale'];

export const PAYMENT_REPOSITORY_METHODS = ['listPayments', 'registerPayment'];

export const INVENTORY_REPOSITORY_METHODS = ['getStockBalances', 'registerMovement'];

export const PURCHASE_REPOSITORY_METHODS = ['listPurchases', 'createPurchase'];

export const CUSTOMER_REPOSITORY_METHODS = ['listCustomers', 'getCustomer', 'upsertCustomer'];

export const CARTERA_REPOSITORY_METHODS = ['listReceivables', 'registerPayment'];

const DOMAIN_CONTRACTS = Object.freeze({
  Sales: SALES_REPOSITORY_METHODS,
  Payment: PAYMENT_REPOSITORY_METHODS,
  Inventory: INVENTORY_REPOSITORY_METHODS,
  Purchase: PURCHASE_REPOSITORY_METHODS,
  Customer: CUSTOMER_REPOSITORY_METHODS,
  Cartera: CARTERA_REPOSITORY_METHODS,
});

export function createDomainRepositoryAdapter({
  domain,
  primary = null,
  fallback,
  usePrimary = false,
}) {
  const contractKey = Object.keys(DOMAIN_CONTRACTS).find(
    (name) => name.toLowerCase() === String(domain || '').toLowerCase()
  );
  if (!contractKey) {
    throw new Error(`Dominio no soportado por createDomainRepositoryAdapter: ${domain}`);
  }
  const requiredMethods = DOMAIN_CONTRACTS[contractKey];
  const domainKey = contractKey === 'Cartera' ? 'cartera' : contractKey.toLowerCase();

  return createFeatureFlagAdapter({
    contractName: `${contractKey}Repository`,
    domain: domainKey,
    requiredMethods,
    primary,
    fallback,
    usePrimary,
  });
}
