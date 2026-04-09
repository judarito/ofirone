/**
 * Utilidad para cálculo de descuentos flexibles
 * Soporta descuentos por valor fijo (AMOUNT) o por porcentaje (PERCENT)
 */

/**
 * Tipos de descuento
 */
export const DiscountType = {
  AMOUNT: 'AMOUNT',   // Valor fijo en moneda
  PERCENT: 'PERCENT'  // Porcentaje del subtotal
};

/**
 * Calcula el monto real del descuento según su tipo
 * @param {number} subtotal - Subtotal de la línea (cantidad * precio unitario)
 * @param {number} discountValue - Valor del descuento (cantidad o porcentaje)
 * @param {string} discountType - Tipo de descuento: 'AMOUNT' o 'PERCENT'
 * @returns {number} Monto real del descuento
 */
export function calculateDiscount(subtotal, discountValue, discountType = DiscountType.AMOUNT) {
  // Si no hay descuento, retornar 0
  if (!discountValue || discountValue <= 0) {
    return 0;
  }

  // Asegurar que subtotal sea un número
  subtotal = parseFloat(subtotal) || 0;
  discountValue = parseFloat(discountValue) || 0;

  switch (discountType) {
    case DiscountType.PERCENT:
      // Validar que el porcentaje no exceda 100%
      if (discountValue > 100) {
        throw new Error('El porcentaje de descuento no puede ser mayor a 100%');
      }
      // Calcular: subtotal * (porcentaje / 100)
      return Math.round((subtotal * (discountValue / 100)) * 100) / 100;

    case DiscountType.AMOUNT:
      // Validar que el descuento no exceda el subtotal
      if (discountValue > subtotal) {
        throw new Error('El descuento no puede ser mayor al subtotal');
      }
      return Math.round(discountValue * 100) / 100;

    default:
      throw new Error(`Tipo de descuento inválido: ${discountType}. Use 'AMOUNT' o 'PERCENT'`);
  }
}

/**
 * Calcula los totales de una línea de venta/documento
 * @param {Object} line - Línea con qty, unit_price, discount_value, discount_type, tax_rate
 * @returns {Object} - { subtotal, discount, taxable_base, tax, total }
 */
export function calculateLineTotal(line) {
  const {
    qty = 0,
    unit_price = 0,
    discount_value = 0,
    discount_type = DiscountType.AMOUNT,
    tax_rate = 0
  } = line;

  // Calcular subtotal de la línea
  const subtotal = Math.round((qty * unit_price) * 100) / 100;

  // Calcular descuento según tipo
  const discount = calculateDiscount(subtotal, discount_value, discount_type);

  // Base imponible (después del descuento)
  const taxable_base = Math.max(0, subtotal - discount);

  // Calcular impuesto
  const tax = Math.round((taxable_base * tax_rate) * 100) / 100;

  // Total de la línea
  const total = taxable_base + tax;

  return {
    subtotal,
    discount,
    taxable_base,
    tax,
    total
  };
}

/**
 * Formatea el descuento para mostrar en UI
 * @param {number} discountValue - Valor del descuento
 * @param {string} discountType - Tipo de descuento
 * @returns {string} Texto formateado (ej: "$5,000" o "10%")
 */
export function formatDiscount(discountValue, discountType = DiscountType.AMOUNT) {
  if (!discountValue || discountValue <= 0) {
    return '-';
  }

  if (discountType === DiscountType.PERCENT) {
    return `${discountValue}%`;
  }

  return `$${Math.round(discountValue).toLocaleString()}`;
}

/**
 * Convierte descuento de un tipo a otro (útil para switching en UI)
 * @param {number} subtotal - Subtotal de la línea
 * @param {number} currentValue - Valor actual del descuento
 * @param {string} fromType - Tipo actual
 * @param {string} toType - Tipo objetivo
 * @returns {number} Valor convertido
 */
export function convertDiscountType(subtotal, currentValue, fromType, toType) {
  if (fromType === toType || !currentValue || currentValue <= 0) {
    return currentValue;
  }

  subtotal = parseFloat(subtotal) || 0;
  currentValue = parseFloat(currentValue) || 0;

  if (fromType === DiscountType.AMOUNT && toType === DiscountType.PERCENT) {
    // Convertir valor fijo a porcentaje
    if (subtotal === 0) return 0;
    return Math.round((currentValue / subtotal) * 10000) / 100; // 2 decimales
  }

  if (fromType === DiscountType.PERCENT && toType === DiscountType.AMOUNT) {
    // Convertir porcentaje a valor fijo
    return Math.round((subtotal * (currentValue / 100)) * 100) / 100;
  }

  return currentValue;
}

/**
 * Valida un descuento
 * @param {number} subtotal - Subtotal de la línea
 * @param {number} discountValue - Valor del descuento
 * @param {string} discountType - Tipo de descuento
 * @returns {Object} { valid: boolean, error: string|null }
 */
export function validateDiscount(subtotal, discountValue, discountType = DiscountType.AMOUNT) {
  if (!discountValue || discountValue <= 0) {
    return { valid: true, error: null };
  }

  subtotal = parseFloat(subtotal) || 0;
  discountValue = parseFloat(discountValue) || 0;

  if (discountValue < 0) {
    return { valid: false, error: 'El descuento no puede ser negativo' };
  }

  if (discountType === DiscountType.PERCENT) {
    if (discountValue > 100) {
      return { valid: false, error: 'El porcentaje no puede ser mayor a 100%' };
    }
  } else if (discountType === DiscountType.AMOUNT) {
    if (discountValue > subtotal) {
      return { valid: false, error: 'El descuento no puede ser mayor al subtotal' };
    }
  }

  return { valid: true, error: null };
}

export default {
  DiscountType,
  calculateDiscount,
  calculateLineTotal,
  formatDiscount,
  convertDiscountType,
  validateDiscount
};
