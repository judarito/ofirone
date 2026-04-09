import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'poslite_accounting_view_mode'
const sharedViewMode = ref('LIST')
let isInitialized = false

const normalizeMode = (value) => {
  const mode = String(value || '').toUpperCase()
  return mode === 'TABLE' ? 'TABLE' : 'LIST'
}

const loadStoredMode = () => {
  if (typeof window === 'undefined') return
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (!saved) return
  sharedViewMode.value = normalizeMode(saved)
}

export function useAccountingViewMode() {
  if (!isInitialized) {
    isInitialized = true
    loadStoredMode()
  }

  watch(sharedViewMode, (value) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, normalizeMode(value))
  })

  const isListView = computed(() => sharedViewMode.value === 'LIST')
  const isTableView = computed(() => sharedViewMode.value === 'TABLE')

  return {
    viewMode: sharedViewMode,
    isListView,
    isTableView
  }
}
