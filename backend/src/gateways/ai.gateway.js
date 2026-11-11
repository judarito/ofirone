import { assertAiGateway } from '../../../shared/contracts/aiGateway.js';
import { invokeSupabaseEdgeFunction } from './edgeFunctionGateway.js';

export function createAiGateway(deps) {
  return assertAiGateway({
    invokeFunction(functionName, body) {
      return invokeSupabaseEdgeFunction(functionName, body, {
        ...deps,
        domain: 'ai',
        operation: 'invokeFunction',
        allowedFunctions: deps.env.allowedAiFunctions,
      });
    },
  });
}

