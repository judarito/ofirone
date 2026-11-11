import { assertRepositoryContract, createFeatureFlagAdapter } from './repositoryContract.js';

export const LOOKUPS_REPOSITORY_METHODS = [
  'listDocumentTypes',
  'listDepartments',
  'listCities',
];

export function assertLookupsRepository(repository, name = 'LookupsRepository') {
  return assertRepositoryContract(name, repository, LOOKUPS_REPOSITORY_METHODS);
}

export function createLookupsRepositoryAdapter({ primary, fallback, usePrimary = false }) {
  return createFeatureFlagAdapter({
    contractName: 'LookupsRepository',
    domain: 'lookups',
    requiredMethods: LOOKUPS_REPOSITORY_METHODS,
    primary,
    fallback,
    usePrimary,
  });
}
