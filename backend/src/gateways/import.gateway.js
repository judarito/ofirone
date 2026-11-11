import { assertImportGateway } from '../../../shared/contracts/importGateway.js';
import { invokeSupabaseEdgeFunction } from './edgeFunctionGateway.js';

export function createImportGateway(deps) {
  return assertImportGateway({
    invokeFunction(functionName, body) {
      return invokeSupabaseEdgeFunction(functionName, body, {
        ...deps,
        domain: 'imports',
        operation: 'invokeFunction',
        allowedFunctions: deps.env.allowedImportFunctions,
      });
    },
  });
}
