import {
  GATEWAY_ERROR_CODES,
  createGatewayContext,
  normalizeGatewayError,
} from './gatewayErrors.js';

export function assertRepositoryContract(name, repository, requiredMethods = []) {
  if (!repository || typeof repository !== 'object') {
    throw new Error(`${name} debe ser un objeto de repositorio.`);
  }

  const missing = requiredMethods.filter((method) => typeof repository[method] !== 'function');
  if (missing.length) {
    throw new Error(`${name} no implementa: ${missing.join(', ')}.`);
  }

  return repository;
}

export function createFeatureFlagAdapter({
  contractName,
  requiredMethods,
  primary,
  fallback,
  usePrimary = false,
  domain = contractName,
}) {
  const fallbackRepository = assertRepositoryContract(`${contractName} fallback`, fallback, requiredMethods);
  const primaryRepository = primary
    ? assertRepositoryContract(`${contractName} primary`, primary, requiredMethods)
    : null;

  const selected = usePrimary && primaryRepository ? primaryRepository : fallbackRepository;
  return requiredMethods.reduce((adapter, method) => {
    adapter[method] = async (...args) => {
      const context = createGatewayContext({ domain, operation: method });
      try {
        return await selected[method](...args);
      } catch (error) {
        if (!usePrimary || !primaryRepository || selected === fallbackRepository) {
          throw normalizeGatewayError(error, {
            ...context,
            code: GATEWAY_ERROR_CODES.DATA_ACCESS_ERROR,
          });
        }

        try {
          return await fallbackRepository[method](...args);
        } catch (fallbackError) {
          throw normalizeGatewayError(fallbackError, {
            ...context,
            code: GATEWAY_ERROR_CODES.DATA_ACCESS_ERROR,
          });
        }
      }
    };
    return adapter;
  }, {});
}
