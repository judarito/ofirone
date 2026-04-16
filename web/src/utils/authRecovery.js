const RECOVERY_INTENT_KEY = 'ofirone:auth:recovery-intent'
const RECOVERY_INTENT_TTL_MS = 15 * 60 * 1000

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function hasRecoveryMarkers(rawValue, options = {}) {
  const value = normalizeText(rawValue)
  if (!value) return false

  if (
    value.includes('type=recovery') ||
    value.includes('mode=recovery') ||
    value.includes('recovery=1') ||
    value.includes('recovery=true') ||
    value.includes('access_token=') ||
    value.includes('refresh_token=') ||
    value.includes('token_hash=')
  ) {
    return true
  }

  return options.allowCode === true && value.includes('code=')
}

function readStoredRecoveryIntent() {
  if (!canUseSessionStorage()) return null

  try {
    const raw = window.sessionStorage.getItem(RECOVERY_INTENT_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed?.expiresAt || Number(parsed.expiresAt) < Date.now()) {
      window.sessionStorage.removeItem(RECOVERY_INTENT_KEY)
      return null
    }

    return parsed
  } catch (_error) {
    window.sessionStorage.removeItem(RECOVERY_INTENT_KEY)
    return null
  }
}

export function persistRecoveryIntent() {
  if (!canUseSessionStorage()) return

  try {
    window.sessionStorage.setItem(
      RECOVERY_INTENT_KEY,
      JSON.stringify({ expiresAt: Date.now() + RECOVERY_INTENT_TTL_MS }),
    )
  } catch (_error) {
    // Ignore storage errors so the recovery flow can continue.
  }
}

export function clearRecoveryIntent() {
  if (!canUseSessionStorage()) return

  try {
    window.sessionStorage.removeItem(RECOVERY_INTENT_KEY)
  } catch (_error) {
    // Ignore storage errors so the recovery flow can continue.
  }
}

export function hasPersistedRecoveryIntent() {
  return !!readStoredRecoveryIntent()
}

export function isRecoveryNavigationTarget(target) {
  const path = normalizeText(target?.path)
  const fullPath = normalizeText(target?.fullPath)
  const hash = normalizeText(target?.hash)
  const search = normalizeText(target?.search)
  const href = normalizeText(target?.href)
  const allowCode = path === '/login' || fullPath.startsWith('/login')

  const matches =
    hasRecoveryMarkers(fullPath, { allowCode }) ||
    hasRecoveryMarkers(hash, { allowCode }) ||
    hasRecoveryMarkers(search, { allowCode }) ||
    hasRecoveryMarkers(href, { allowCode })

  if (matches) {
    persistRecoveryIntent()
    return true
  }

  return hasPersistedRecoveryIntent()
}

export function detectRecoveryFromWindow() {
  if (typeof window === 'undefined') {
    return hasPersistedRecoveryIntent()
  }

  return isRecoveryNavigationTarget({
    path: window.location.pathname,
    fullPath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    search: window.location.search,
    hash: window.location.hash,
    href: window.location.href,
  })
}
