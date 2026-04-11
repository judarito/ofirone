/**
 * Utilidades puras para gestión de sesiones de caja.
 * Sin dependencias de framework — usable en web y mobile.
 */

/**
 * Resuelve el máximo de horas permitidas para una sesión de caja.
 * @param {object} settings - Objeto de configuración del tenant (puede tener cash_session_max_hours)
 * @param {number} [fallback=24]
 * @returns {number}
 */
export function resolveCashSessionMaxHours(settings, fallback = 24) {
  const parsed = Number(settings?.cash_session_max_hours || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Extrae la fecha de apertura de una sesión de caja.
 * Acepta string ISO, Date, o un objeto con campo opened_at.
 * @param {string|Date|object} sessionOrOpenedAt
 * @returns {string|Date|null}
 */
export function getCashSessionOpenedAt(sessionOrOpenedAt) {
  if (!sessionOrOpenedAt) return null;
  if (typeof sessionOrOpenedAt === 'string' || sessionOrOpenedAt instanceof Date) {
    return sessionOrOpenedAt;
  }
  return sessionOrOpenedAt?.opened_at || null;
}

/**
 * Calcula la edad de la sesión de caja en horas enteras.
 * @param {string|Date|object} sessionOrOpenedAt
 * @param {number} [nowMs=Date.now()]
 * @returns {number} horas >= 0
 */
export function getCashSessionAgeHours(sessionOrOpenedAt, nowMs = Date.now()) {
  const openedAt = getCashSessionOpenedAt(sessionOrOpenedAt);
  const openedAtMs = new Date(openedAt || '').getTime();
  if (!Number.isFinite(openedAtMs)) return 0;
  return Math.max(0, Math.floor((nowMs - openedAtMs) / 3600000));
}

/**
 * Determina si una sesión de caja superó el límite de horas.
 * @param {string|Date|object} sessionOrOpenedAt
 * @param {number} maxHours
 * @param {number} [nowMs=Date.now()]
 * @returns {boolean}
 */
export function isCashSessionExpired(sessionOrOpenedAt, maxHours, nowMs = Date.now()) {
  const limit = Number(maxHours || 0);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return getCashSessionAgeHours(sessionOrOpenedAt, nowMs) >= limit;
}

/**
 * Resume el estado actual de una sesión de caja frente al límite configurado.
 * @param {string|Date|object} sessionOrOpenedAt
 * @param {number} maxHours
 * @param {number} [nowMs=Date.now()]
 * @returns {{ hasSession: boolean, openedAt: string|Date|null, ageHours: number, maxHours: number, expired: boolean }}
 */
export function getCashSessionState(sessionOrOpenedAt, maxHours, nowMs = Date.now()) {
  const openedAt = getCashSessionOpenedAt(sessionOrOpenedAt);
  const openedAtMs = new Date(openedAt || '').getTime();
  const hasSession = Number.isFinite(openedAtMs);
  const safeMaxHours = resolveCashSessionMaxHours({ cash_session_max_hours: maxHours }, 24);
  const ageHours = hasSession ? getCashSessionAgeHours(sessionOrOpenedAt, nowMs) : 0;

  return {
    hasSession,
    openedAt: hasSession ? openedAt : null,
    ageHours,
    maxHours: safeMaxHours,
    expired: hasSession ? isCashSessionExpired(sessionOrOpenedAt, safeMaxHours, nowMs) : false,
  };
}

/**
 * Construye el mensaje estándar para sesión de caja vencida.
 * @param {{ ageHours?: number, maxHours?: number }} [state]
 * @returns {string}
 */
export function buildCashSessionExpiredMessage(state = {}) {
  const ageHours = Number(state.ageHours || 0);
  const maxHours = Number(state.maxHours || 24);
  return `La sesión de caja lleva ${ageHours}h abierta y superó el límite de ${maxHours}h. Cierra y abre una nueva para continuar.`;
}

/**
 * Valida si una operación puede continuar usando la sesión de caja actual.
 * @param {string|Date|object} sessionOrOpenedAt
 * @param {number} maxHours
 * @param {{ requireOpenSession?: boolean, missingMessage?: string, expiredMessage?: string, nowMs?: number }} [options]
 * @returns {{ valid: boolean, code: string|null, message: string, hasSession: boolean, openedAt: string|Date|null, ageHours: number, maxHours: number, expired: boolean }}
 */
export function validateCashSessionForOperation(sessionOrOpenedAt, maxHours, options = {}) {
  const {
    requireOpenSession = true,
    missingMessage = 'Debe abrir una caja antes de continuar.',
    expiredMessage = '',
    nowMs = Date.now(),
  } = options;

  const state = getCashSessionState(sessionOrOpenedAt, maxHours, nowMs);

  if (requireOpenSession && !state.hasSession) {
    return {
      ...state,
      valid: false,
      code: 'NO_OPEN_SESSION',
      message: missingMessage,
    };
  }

  if (state.expired) {
    return {
      ...state,
      valid: false,
      code: 'EXPIRED_SESSION',
      message: expiredMessage || buildCashSessionExpiredMessage(state),
    };
  }

  return {
    ...state,
    valid: true,
    code: null,
    message: '',
  };
}
