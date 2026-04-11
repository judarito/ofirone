/**
 * Re-exporta desde shared/utils/appErrors para mantener compatibilidad
 * con todos los importadores existentes.
 * La lógica canónica vive en shared/utils/appErrors.js
 */
export { humanizeAppError, serviceErrorResult } from '../../../shared/utils/appErrors'

export { default } from '../../../shared/utils/appErrors'
