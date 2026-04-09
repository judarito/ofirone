import { calculateDiscount, validateDiscount } from '@/utils/discountCalculator'

// Fuente canónica de cálculos de venta en web: líneas, descuentos, totales y payload al backend.
const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100
const getNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const getDocumentLineSubtotal = (
  line,
  {
    quantityField = 'quantity',
    unitPriceField = 'unit_price',
  } = {}
) => {
  const quantity = getNumber(line?.[quantityField])
  const unitPrice = getNumber(line?.[unitPriceField])
  return Math.max(0, roundCurrency(quantity * unitPrice))
}

export const normalizeLineDiscountInput = (
  subtotal,
  discountValue,
  discountType = 'AMOUNT'
) => {
  const normalizedSubtotal = Math.max(0, roundCurrency(subtotal))
  const numericValue = getNumber(discountValue)
  const currentValue = numericValue < 0 ? 0 : numericValue
  const validation = validateDiscount(normalizedSubtotal, currentValue, discountType)

  const sanitizedValue = discountType === 'PERCENT'
    ? Math.min(100, Math.max(0, currentValue))
    : Math.min(normalizedSubtotal, Math.max(0, currentValue))

  return {
    valid: validation.valid,
    adjusted: sanitizedValue !== currentValue,
    currentValue,
    sanitizedValue,
    error: validation.error || null,
    subtotal: normalizedSubtotal,
    discountType,
  }
}

export const normalizeCartLineDiscount = (line) => {
  const subtotal = getDocumentLineSubtotal(line, {
    quantityField: 'quantity',
    unitPriceField: 'unit_price',
  })
  const discountType = line?.discount_line_type || 'AMOUNT'
  return normalizeLineDiscountInput(subtotal, line?.discount_line, discountType)
}

export const getCartLineDiscountAmount = (line) => {
  const subtotal = getDocumentLineSubtotal(line, {
    quantityField: 'quantity',
    unitPriceField: 'unit_price',
  })
  const discountType = line?.discount_line_type || 'AMOUNT'
  const { sanitizedValue } = normalizeLineDiscountInput(subtotal, line?.discount_line, discountType)

  if (sanitizedValue <= 0) return 0
  return roundCurrency(calculateDiscount(subtotal, sanitizedValue, discountType))
}

export const getCartLineGlobalDiscountAmount = (line) => {
  return Math.max(0, roundCurrency(line?.discount_global))
}

export const getCartLineTotalDiscountAmount = (line) => {
  return roundCurrency(getCartLineDiscountAmount(line) + getCartLineGlobalDiscountAmount(line))
}

export const getCartLineNetSubtotal = (line) => {
  const subtotal = getDocumentLineSubtotal(line, {
    quantityField: 'quantity',
    unitPriceField: 'unit_price',
  })
  return Math.max(0, roundCurrency(subtotal - getCartLineDiscountAmount(line)))
}

export const allocateGlobalDiscountAcrossLines = (lines = [], requestedDiscountAmount = 0) => {
  const lineBases = lines.map((line) => ({
    line,
    available: getCartLineNetSubtotal(line),
  }))
  const invoiceBase = roundCurrency(
    lineBases.reduce((sum, entry) => sum + entry.available, 0)
  )
  const requestedAmount = Math.max(0, roundCurrency(requestedDiscountAmount))
  const appliedAmount = Math.min(requestedAmount, invoiceBase)

  if (invoiceBase <= 0 || appliedAmount <= 0) {
    return {
      appliedAmount: 0,
      invoiceBase,
      capped: requestedAmount > 0,
      allocations: lineBases.map(({ line }) => ({ line, amount: 0 })),
    }
  }

  let remaining = appliedAmount
  const allocations = lineBases.map((entry, index) => {
    const isLast = index === lineBases.length - 1
    let amount = 0

    if (isLast) {
      amount = remaining
    } else {
      const proportion = invoiceBase > 0 ? entry.available / invoiceBase : 0
      amount = roundCurrency(appliedAmount * proportion)
      amount = Math.min(amount, remaining, entry.available)
    }

    remaining = Math.max(0, roundCurrency(remaining - amount))
    return {
      line: entry.line,
      amount: roundCurrency(amount),
    }
  })

  return {
    appliedAmount,
    invoiceBase,
    capped: appliedAmount < requestedAmount,
    allocations,
  }
}

export const validateDocumentDiscounts = (
  lines = [],
  {
    quantityField = 'quantity',
    unitPriceField = 'unit_price',
    discountValueField = 'discount_line',
    discountTypeField = 'discount_line_type',
    extraDiscountField = null,
    lineErrorMessage = 'El descuento total de una línea no puede superar el valor del producto',
    invoiceErrorMessage = 'El descuento total no puede superar el valor de la factura',
  } = {}
) => {
  let invoiceSubtotal = 0
  let invoiceDiscount = 0

  for (const line of lines) {
    const subtotal = getDocumentLineSubtotal(line, { quantityField, unitPriceField })
    const discountType = line?.[discountTypeField] || 'AMOUNT'
    const lineValidation = normalizeLineDiscountInput(subtotal, line?.[discountValueField], discountType)

    if (!lineValidation.valid) {
      return {
        valid: false,
        error: lineValidation.error || 'Hay descuentos inválidos en la venta',
      }
    }

    const primaryDiscount = lineValidation.sanitizedValue > 0
      ? roundCurrency(calculateDiscount(subtotal, lineValidation.sanitizedValue, discountType))
      : 0
    const extraDiscount = extraDiscountField ? Math.max(0, getNumber(line?.[extraDiscountField])) : 0
    const lineDiscount = roundCurrency(primaryDiscount + extraDiscount)

    if (lineDiscount > subtotal) {
      return { valid: false, error: lineErrorMessage }
    }

    invoiceSubtotal = roundCurrency(invoiceSubtotal + subtotal)
    invoiceDiscount = roundCurrency(invoiceDiscount + lineDiscount)
  }

  if (invoiceDiscount > invoiceSubtotal) {
    return { valid: false, error: invoiceErrorMessage }
  }

  return { valid: true, error: null }
}

export const validateCartDiscounts = (lines = []) => (
  validateDocumentDiscounts(lines, {
    quantityField: 'quantity',
    unitPriceField: 'unit_price',
    discountValueField: 'discount_line',
    discountTypeField: 'discount_line_type',
    extraDiscountField: 'discount_global',
  })
)

export const validateSalePayloadDiscounts = (lines = []) => (
  validateDocumentDiscounts(lines, {
    quantityField: 'qty',
    unitPriceField: 'unit_price',
    discountValueField: 'discount',
    discountTypeField: 'discount_type',
  })
)

export const getMaxGlobalDiscountAmount = (lines = []) => (
  roundCurrency(lines.reduce((sum, line) => sum + getCartLineNetSubtotal(line), 0))
)

export const summarizeCartTotals = (lines = [], { applyRounding = (value) => value } = {}) => {
  let subtotal = 0
  let discountLine = 0
  let discountGlobal = 0
  let tax = 0
  let total = 0
  const taxDetails = new Map()

  lines.forEach((line) => {
    subtotal = roundCurrency(subtotal + getNumber(line?.base_amount))
    discountLine = roundCurrency(discountLine + getCartLineDiscountAmount(line))
    discountGlobal = roundCurrency(discountGlobal + getCartLineGlobalDiscountAmount(line))
    tax = roundCurrency(tax + getNumber(line?.tax_amount))
    total = roundCurrency(total + getNumber(line?.line_total))

    if (line?.tax_code && getNumber(line?.tax_amount) > 0) {
      if (!taxDetails.has(line.tax_code)) {
        taxDetails.set(line.tax_code, {
          code: line.tax_code,
          name: line.tax_name,
          amount: 0,
        })
      }

      const currentTax = taxDetails.get(line.tax_code)
      currentTax.amount = roundCurrency(currentTax.amount + getNumber(line.tax_amount))
    }
  })

  total = roundCurrency(applyRounding(total))
  const discount = roundCurrency(discountLine + discountGlobal)
  const firstTax = Array.from(taxDetails.values())[0]
  const taxLabel = firstTax?.code
    ? `${firstTax.code} (${firstTax.name || ''})`.trim()
    : 'Impuestos'

  return {
    subtotal,
    discountLine,
    discountGlobal,
    discount,
    tax,
    taxLabel,
    taxDetails,
    total,
  }
}

export const buildSalePayloadLines = (lines = []) => (
  lines.map((line) => {
    const taxRate = getNumber(line?.tax_rate)
    const priceIncludesTax = Boolean(line?.price_includes_tax && taxRate > 0)
    const factor = priceIncludesTax ? (1 + taxRate) : 1
    const discountAmount = getCartLineTotalDiscountAmount(line)

    return {
      variant_id: line?.variant_id,
      qty: getNumber(line?.quantity),
      unit_price: priceIncludesTax ? Math.round(getNumber(line?.unit_price) / factor) : getNumber(line?.unit_price),
      discount: priceIncludesTax ? Math.round(discountAmount / factor) : discountAmount,
      discount_type: 'AMOUNT',
    }
  })
)

export default {
  allocateGlobalDiscountAcrossLines,
  buildSalePayloadLines,
  getCartLineDiscountAmount,
  getCartLineGlobalDiscountAmount,
  getCartLineNetSubtotal,
  getCartLineTotalDiscountAmount,
  getDocumentLineSubtotal,
  getMaxGlobalDiscountAmount,
  normalizeCartLineDiscount,
  normalizeLineDiscountInput,
  summarizeCartTotals,
  validateCartDiscounts,
  validateDocumentDiscounts,
  validateSalePayloadDiscounts,
}
