/**
 * Re-exporta desde shared/utils/stringUtils para mantener compatibilidad
 * con todos los importadores existentes de este módulo.
 * La lógica canónica vive en shared/utils/stringUtils.js
 */
export {
  normalizeCommandText,
  hashNormalizedText,
  normalizeCustomerName,
} from '../../../../shared/utils/stringUtils';
