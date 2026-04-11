/**
 * Re-exporta desde shared/utils/cashSessionUtils para mantener compatibilidad
 * con los importadores existentes.
 * La lógica canónica vive en shared/utils/cashSessionUtils.js
 */
export {
  resolveCashSessionMaxHours,
  getCashSessionOpenedAt,
  getCashSessionAgeHours,
  isCashSessionExpired,
  getCashSessionState,
  buildCashSessionExpiredMessage,
  validateCashSessionForOperation,
} from '../../../shared/utils/cashSessionUtils';
