export function resolveCashSessionMaxHours(settings, fallback = 24) {
  const parsed = Number(settings?.cash_session_max_hours || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getCashSessionOpenedAt(sessionOrOpenedAt) {
  if (!sessionOrOpenedAt) return null;
  if (typeof sessionOrOpenedAt === 'string' || sessionOrOpenedAt instanceof Date) {
    return sessionOrOpenedAt;
  }
  return sessionOrOpenedAt?.opened_at || null;
}

export function getCashSessionAgeHours(sessionOrOpenedAt, nowMs = Date.now()) {
  const openedAt = getCashSessionOpenedAt(sessionOrOpenedAt);
  const openedAtMs = new Date(openedAt || '').getTime();
  if (!Number.isFinite(openedAtMs)) return 0;
  return Math.max(0, Math.floor((nowMs - openedAtMs) / 3600000));
}

export function isCashSessionExpired(sessionOrOpenedAt, maxHours, nowMs = Date.now()) {
  const limit = Number(maxHours || 0);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return getCashSessionAgeHours(sessionOrOpenedAt, nowMs) >= limit;
}
