import { describe, expect, it } from 'vitest'
import {
  getNextMenuDisplayMode,
  loadMenuDisplayMode,
  MENU_DISPLAY_MODE_GRID,
  MENU_DISPLAY_MODE_LIST,
  MENU_DISPLAY_MODE_STORAGE_KEY,
  normalizeMenuDisplayMode,
  persistMenuDisplayMode,
} from '@/utils/menuDisplayMode'

function createStorageMock(initialValue = null) {
  const bucket = new Map()
  if (initialValue !== null) {
    bucket.set(MENU_DISPLAY_MODE_STORAGE_KEY, initialValue)
  }

  return {
    getItem(key) {
      return bucket.has(key) ? bucket.get(key) : null
    },
    setItem(key, value) {
      bucket.set(key, value)
    },
  }
}

describe('menuDisplayMode', () => {
  it('normaliza el modo y protege contra valores invalidos', () => {
    expect(normalizeMenuDisplayMode('grid')).toBe(MENU_DISPLAY_MODE_GRID)
    expect(normalizeMenuDisplayMode(' GRID ')).toBe(MENU_DISPLAY_MODE_GRID)
    expect(normalizeMenuDisplayMode('cards')).toBe(MENU_DISPLAY_MODE_LIST)
    expect(normalizeMenuDisplayMode(null)).toBe(MENU_DISPLAY_MODE_LIST)
  })

  it('alterna entre lista y cuadricula', () => {
    expect(getNextMenuDisplayMode(MENU_DISPLAY_MODE_LIST)).toBe(MENU_DISPLAY_MODE_GRID)
    expect(getNextMenuDisplayMode(MENU_DISPLAY_MODE_GRID)).toBe(MENU_DISPLAY_MODE_LIST)
  })

  it('carga y persiste el modo en storage', () => {
    const storage = createStorageMock('grid')
    expect(loadMenuDisplayMode(storage)).toBe(MENU_DISPLAY_MODE_GRID)

    persistMenuDisplayMode('list', storage)
    expect(storage.getItem(MENU_DISPLAY_MODE_STORAGE_KEY)).toBe(MENU_DISPLAY_MODE_LIST)
  })

  it('cae a lista cuando no hay storage disponible', () => {
    expect(loadMenuDisplayMode(null)).toBe(MENU_DISPLAY_MODE_LIST)
    expect(persistMenuDisplayMode('grid', null)).toBe(MENU_DISPLAY_MODE_GRID)
  })
})
