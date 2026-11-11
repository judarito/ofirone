import { assertRepositoryContract } from './repositoryContract.js';

export const AI_GATEWAY_METHODS = [
  'invokeFunction',
];

export function assertAiGateway(gateway, name = 'AiGateway') {
  return assertRepositoryContract(name, gateway, AI_GATEWAY_METHODS);
}

