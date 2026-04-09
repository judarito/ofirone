import { ref } from 'vue'
import es from './locales/es'
import en from './locales/en'

const APP_LOCALE_STORAGE_KEY = 'app_locale'
const DEFAULT_APP_LOCALE = 'es'

const messages = { es, en }

const localeToTag = {
  es: 'es-CO',
  en: 'en-US'
}

export function normalizeAppLocale(localeLike) {
  const value = String(localeLike || '').toLowerCase()
  if (value.startsWith('en')) return 'en'
  return 'es'
}

function resolveInitialLocale() {
  if (typeof window === 'undefined') return DEFAULT_APP_LOCALE

  const stored = localStorage.getItem(APP_LOCALE_STORAGE_KEY)
  if (stored) return normalizeAppLocale(stored)

  return normalizeAppLocale(navigator.language)
}

const locale = ref(resolveInitialLocale())

function interpolate(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`))
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, segment) => acc?.[segment], obj)
}

export function t(key, params) {
  const localized = getByPath(messages[locale.value], key)
  const fallback = getByPath(messages.es, key)
  const text = typeof localized === 'string' ? localized : (typeof fallback === 'string' ? fallback : key)
  return params ? interpolate(text, params) : text
}

export function setLocale(nextLocale) {
  const normalized = normalizeAppLocale(nextLocale)
  locale.value = normalized

  if (typeof window !== 'undefined') {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, normalized)
  }
}

export function getCurrentLocale() {
  return locale.value
}

export function getCurrentLocaleTag() {
  return localeToTag[locale.value] || localeToTag[DEFAULT_APP_LOCALE]
}

export function useI18n() {
  return {
    locale,
    setLocale,
    t,
    availableLocales: Object.keys(messages)
  }
}

export function createI18nPlugin() {
  return {
    install(app) {
      app.config.globalProperties.$t = t
    }
  }
}
