import { assertRepositoryContract } from './repositoryContract.js';

export const IMPORT_GATEWAY_METHODS = [
  'invokeFunction',
];

export function assertImportGateway(gateway, name = 'ImportGateway') {
  return assertRepositoryContract(name, gateway, IMPORT_GATEWAY_METHODS);
}

