export const MENU_DISPLAY_MODE_LIST = 'list'
export const MENU_DISPLAY_MODE_GRID = 'grid'
export const MENU_DISPLAY_MODE_STORAGE_KEY = 'ofir_menu_display_mode'

export function normalizeMenuDisplayMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === MENU_DISPLAY_MODE_GRID ? MENU_DISPLAY_MODE_GRID : MENU_DISPLAY_MODE_LIST
}

export function getNextMenuDisplayMode(currentMode) {
  return normalizeMenuDisplayMode(currentMode) === MENU_DISPLAY_MODE_GRID
    ? MENU_DISPLAY_MODE_LIST
    : MENU_DISPLAY_MODE_GRID
}

export function loadMenuDisplayMode(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage?.getItem) return MENU_DISPLAY_MODE_LIST
  return normalizeMenuDisplayMode(storage.getItem(MENU_DISPLAY_MODE_STORAGE_KEY))
}

export function persistMenuDisplayMode(
  value,
  storage = typeof window !== 'undefined' ? window.localStorage : null,
) {
  const normalized = normalizeMenuDisplayMode(value)
  if (storage?.setItem) {
    storage.setItem(MENU_DISPLAY_MODE_STORAGE_KEY, normalized)
  }
  return normalized
}
