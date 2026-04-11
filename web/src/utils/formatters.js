/**
 * Re-exporta los formatters de shared inyectando el locale activo del i18n de web.
 * Todos los importadores existentes continúan funcionando sin cambios.
 *
 * Mobile importa directamente desde shared/utils/formatters (locale 'es-CO' fijo).
 */
import { getCurrentLocaleTag } from '@/i18n'
import {
  formatMoney as _formatMoney,
  formatMoneyShort,
  formatDate as _formatDate,
  formatDateTime as _formatDateTime,
  formatDateTimeFull as _formatDateTimeFull,
} from '../../../shared/utils/formatters'

export const formatMoney = (value, locale, currency) =>
  _formatMoney(value, locale ?? getCurrentLocaleTag(), currency)

export const formatDate = (date, locale) =>
  _formatDate(date, locale ?? getCurrentLocaleTag())

export const formatDateTime = (date, locale) =>
  _formatDateTime(date, locale ?? getCurrentLocaleTag())

export const formatDateTimeFull = (date, locale) =>
  _formatDateTimeFull(date, locale ?? getCurrentLocaleTag())

export { formatMoneyShort }
