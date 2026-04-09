import { getCurrentLocaleTag } from '@/i18n'

/**
 * Utilidades de formateo compartidas para toda la aplicación.
 * Centraliza los formatters para evitar duplicación en cada vista.
 *
 * Importar directamente en lugar de declarar funciones locales por vista:
 *   import { formatMoney, formatDate, formatDateTime } from '@/utils/formatters'
 */

const DEFAULT_LOCALE   = () => getCurrentLocaleTag()
const DEFAULT_CURRENCY = 'COP'

/**
 * Formatea un valor numérico como moneda.
 * @param {number|string} value
 * @param {string} [locale]
 * @param {string} [currency]
 * @returns {string}  Ej: "$1.500.000"
 */
export function formatMoney(value, locale = DEFAULT_LOCALE(), currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(parseFloat(value) || 0)
}

/**
 * Formatea un valor numérico como moneda abreviada (K / M).
 * @param {number|string} value
 * @returns {string}  Ej: "$1.5M", "$500K"
 */
export function formatMoneyShort(value) {
  const n = parseFloat(value) || 0
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return formatMoney(n)
}

/**
 * Formatea una fecha ISO como fecha corta (sin hora).
 * @param {string|Date} date
 * @param {string} [locale]
 * @returns {string}  Ej: "15/02/2025"
 */
export function formatDate(date, locale = DEFAULT_LOCALE()) {
  if (!date) return ''
  return new Date(date).toLocaleDateString(locale)
}

/**
 * Formatea una fecha ISO como fecha + hora cortas.
 * @param {string|Date} date
 * @param {string} [locale]
 * @returns {string}  Ej: "15/02/2025, 3:45 p. m."
 */
export function formatDateTime(date, locale = DEFAULT_LOCALE()) {
  if (!date) return ''
  return new Date(date).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Formatea una fecha ISO como fecha + hora completa (toLocaleString sin opciones).
 * Equivalente al legado `new Date(d).toLocaleString('es-CO')`.
 * @param {string|Date} date
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDateTimeFull(date, locale = DEFAULT_LOCALE()) {
  if (!date) return ''
  return new Date(date).toLocaleString(locale)
}
