import AsyncStorage from '@react-native-async-storage/async-storage';

export const MENU_DISPLAY_MODE_LIST = 'list';
export const MENU_DISPLAY_MODE_GRID = 'grid';
export const MENU_DISPLAY_MODE_STORAGE_KEY = 'ofir_menu_display_mode';

export function normalizeMenuDisplayMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === MENU_DISPLAY_MODE_GRID ? MENU_DISPLAY_MODE_GRID : MENU_DISPLAY_MODE_LIST;
}

export function getNextMenuDisplayMode(currentMode) {
  return normalizeMenuDisplayMode(currentMode) === MENU_DISPLAY_MODE_GRID
    ? MENU_DISPLAY_MODE_LIST
    : MENU_DISPLAY_MODE_GRID;
}

export async function loadMenuDisplayMode(storage = AsyncStorage) {
  try {
    const stored = await storage.getItem(MENU_DISPLAY_MODE_STORAGE_KEY);
    return normalizeMenuDisplayMode(stored);
  } catch (_error) {
    return MENU_DISPLAY_MODE_LIST;
  }
}

export async function persistMenuDisplayMode(value, storage = AsyncStorage) {
  const normalized = normalizeMenuDisplayMode(value);
  try {
    await storage.setItem(MENU_DISPLAY_MODE_STORAGE_KEY, normalized);
  } catch (_error) {
    // UI preference only; ignore persistence failures and keep runtime mode.
  }
  return normalized;
}
