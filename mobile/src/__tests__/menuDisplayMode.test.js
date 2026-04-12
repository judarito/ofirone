import {
  getNextMenuDisplayMode,
  loadMenuDisplayMode,
  MENU_DISPLAY_MODE_GRID,
  MENU_DISPLAY_MODE_LIST,
  MENU_DISPLAY_MODE_STORAGE_KEY,
  normalizeMenuDisplayMode,
  persistMenuDisplayMode,
} from '../lib/menuDisplayMode';

function createStorageMock(initialValue = null, fail = false) {
  const bucket = new Map();
  if (initialValue !== null) {
    bucket.set(MENU_DISPLAY_MODE_STORAGE_KEY, initialValue);
  }

  return {
    async getItem(key) {
      if (fail) throw new Error('storage unavailable');
      return bucket.has(key) ? bucket.get(key) : null;
    },
    async setItem(key, value) {
      if (fail) throw new Error('storage unavailable');
      bucket.set(key, value);
    },
  };
}

describe('menuDisplayMode', () => {
  it('normaliza modos validos e invalidos', () => {
    expect(normalizeMenuDisplayMode('grid')).toBe(MENU_DISPLAY_MODE_GRID);
    expect(normalizeMenuDisplayMode(' LIST ')).toBe(MENU_DISPLAY_MODE_LIST);
    expect(normalizeMenuDisplayMode('cards')).toBe(MENU_DISPLAY_MODE_LIST);
  });

  it('alterna entre lista y cuadricula', () => {
    expect(getNextMenuDisplayMode(MENU_DISPLAY_MODE_LIST)).toBe(MENU_DISPLAY_MODE_GRID);
    expect(getNextMenuDisplayMode(MENU_DISPLAY_MODE_GRID)).toBe(MENU_DISPLAY_MODE_LIST);
  });

  it('carga y persiste en storage asincrono', async () => {
    const storage = createStorageMock('grid');
    expect(await loadMenuDisplayMode(storage)).toBe(MENU_DISPLAY_MODE_GRID);

    await persistMenuDisplayMode('list', storage);
    expect(await storage.getItem(MENU_DISPLAY_MODE_STORAGE_KEY)).toBe(MENU_DISPLAY_MODE_LIST);
  });

  it('vuelve a lista si falla storage', async () => {
    const storage = createStorageMock(null, true);
    expect(await loadMenuDisplayMode(storage)).toBe(MENU_DISPLAY_MODE_LIST);
    await expect(persistMenuDisplayMode('grid', storage)).resolves.toBe(MENU_DISPLAY_MODE_GRID);
  });
});
