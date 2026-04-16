import { DiscountType, calculateDiscount } from './discountCalculator'
import { applyLineTaxes } from './taxCalculator'

export const LAYAWAY_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
})

export const LAYAWAY_DUE_SOON_DAYS = 7

const STATUS_LABELS = Object.freeze({
  [LAYAWAY_STATUS.ACTIVE]: 'Activo',
  [LAYAWAY_STATUS.COMPLETED]: 'Completado',
  [LAYAWAY_STATUS.CANCELLED]: 'Cancelado',
  [LAYAWAY_STATUS.EXPIRED]: 'Expirado',
})

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100
}

function normalizeStatus(status) {
  return String(status || '').trim().toUpperCase()
}

function parseYmdDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2]) - 1
    const day = Number(match[3])
    const date = new Date(year, month, day)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

function startOfToday(referenceDate = new Date()) {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
}

function buildEffectiveTaxResult(line, taxResult) {
  if (taxResult && typeof taxResult === 'object' && taxResult.success === true) {
    return taxResult
  }

  const rate = toNumber(line?.tax_rate, 0)
  if (rate > 0) {
    return {
      success: true,
      rate,
      code: line?.tax_code || null,
      name: line?.tax_name || null,
    }
  }

  return { success: false, rate: 0, code: null, name: null }
}

export function getLayawayStatusLabel(status) {
  const normalizedStatus = normalizeStatus(status)
  return STATUS_LABELS[normalizedStatus] || normalizedStatus || 'Sin estado'
}

export function getLayawayDueState(contract, referenceDate = new Date()) {
  const status = normalizeStatus(contract?.status)
  const balance = Math.max(0, toNumber(contract?.balance, 0))
  const dueDate = parseYmdDate(contract?.due_date)
  if (!dueDate) {
    return {
      dueDate: null,
      daysUntilDue: null,
      isDueSoon: false,
      isOverdue: false,
      shouldAutoExpire: false,
    }
  }

  const diffMs = dueDate.getTime() - startOfToday(referenceDate).getTime()
  const daysUntilDue = Math.round(diffMs / (24 * 60 * 60 * 1000))
  const isOverdue = status === LAYAWAY_STATUS.ACTIVE && balance > 0 && daysUntilDue < 0

  return {
    dueDate,
    daysUntilDue,
    isDueSoon: status === LAYAWAY_STATUS.ACTIVE && daysUntilDue >= 0 && daysUntilDue <= LAYAWAY_DUE_SOON_DAYS,
    isOverdue,
    shouldAutoExpire: isOverdue,
  }
}

export function calculateLayawayDraftLine(line, taxResult = null) {
  const nextLine = {
    ...line,
  }

  const quantity = Math.max(0, toNumber(nextLine?.qty ?? nextLine?.quantity, 0))
  const unitPrice = Math.max(0, toNumber(nextLine?.unit_price, 0))
  const discountValue = Math.max(0, toNumber(nextLine?.discount ?? nextLine?.discount_amount, 0))
  const discountType = String(nextLine?.discount_type || DiscountType.AMOUNT).trim().toUpperCase() || DiscountType.AMOUNT
  const subtotal = roundMoney(quantity * unitPrice)

  let discountAmount = 0
  try {
    discountAmount = roundMoney(calculateDiscount(subtotal, discountValue, discountType))
  } catch (_error) {
    discountAmount = 0
  }

  const priceAfterDiscount = Math.max(0, roundMoney(subtotal - discountAmount))
  applyLineTaxes(nextLine, buildEffectiveTaxResult(nextLine, taxResult), priceAfterDiscount)

  nextLine.qty = quantity
  nextLine.quantity = quantity
  nextLine.unit_price = unitPrice
  nextLine.discount = discountValue
  nextLine.discount_type = discountType
  nextLine.discount_amount = discountAmount
  nextLine.subtotal = subtotal
  nextLine.total = roundMoney(nextLine.line_total ?? priceAfterDiscount)

  return nextLine
}

export function summarizeLayawayDraftItems(items = []) {
  return (Array.isArray(items) ? items : []).reduce((acc, rawItem) => {
    const item = calculateLayawayDraftLine(rawItem)
    acc.subtotal += roundMoney(item.subtotal)
    acc.discount += roundMoney(item.discount_amount)
    acc.tax += roundMoney(item.tax_amount)
    acc.total += roundMoney(item.total)
    return acc
  }, {
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
  })
}

export function createLayawayInstallmentDraft(payload = {}) {
  const amount = payload.amount === undefined || payload.amount === null
    ? ''
    : String(payload.amount)

  return {
    installment_id: payload.installment_id || `layaway-installment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    due_date: String(payload.due_date || '').trim(),
    amount,
    status: String(payload.status || 'PENDING').trim().toUpperCase() || 'PENDING',
  }
}

export function sanitizeLayawayInstallments(installments = []) {
  return (Array.isArray(installments) ? installments : [])
    .map((item) => ({
      due_date: String(item?.due_date || '').trim(),
      amount: roundMoney(item?.amount),
      status: String(item?.status || 'PENDING').trim().toUpperCase() || 'PENDING',
    }))
    .filter((item) => item.due_date && item.amount > 0)
    .sort((left, right) => String(left.due_date).localeCompare(String(right.due_date)))
}

export function summarizeLayawayInstallments(installments = []) {
  const cleanItems = sanitizeLayawayInstallments(installments)
  return {
    count: cleanItems.length,
    totalAmount: cleanItems.reduce((sum, item) => sum + roundMoney(item.amount), 0),
  }
}
