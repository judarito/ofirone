/**
 * Utilidades de cálculo de impuestos para líneas de venta.
 * Extraído de PointOfSale.vue para mejorar la separación de responsabilidades.
 *
 * Importar en componentes que necesiten calcular impuestos:
 *   import { applyLineTaxes } from '@/utils/taxCalculator'
 */

/**
 * Aplica la información de impuesto a una línea de venta, mutando sus campos.
 *
 * @param {Object} line             - Línea del carrito (se muta in-place)
 * @param {Object} taxResult        - Resultado de taxesService.getTaxInfoForVariant()
 * @param {number} priceAfterDiscount - Precio ya descontado (subtotal - descuentos)
 *
 * Campos que actualiza en `line`:
 *   tax_rate, tax_code, tax_name, base_amount, tax_amount, line_total
 */
export function applyLineTaxes(line, taxResult, priceAfterDiscount) {
  if (taxResult.success && taxResult.rate) {
    line.tax_rate = taxResult.rate
    line.tax_code = taxResult.code
    line.tax_name = taxResult.name

    if (line.price_includes_tax) {
      // IVA INCLUIDO: El precio ya incluye el impuesto — descomponerlo
      // Total = precio después de descuento
      // Base  = total / (1 + tasa)
      // IVA   = total − base
      const total = priceAfterDiscount
      const base  = total / (1 + line.tax_rate)
      const tax   = total - base

      line.base_amount = Math.round(base)
      line.tax_amount  = Math.round(tax)
      line.line_total  = Math.round(total)
    } else {
      // IVA ADICIONAL: El impuesto se suma al precio
      // Base  = precio después de descuento
      // IVA   = base × tasa
      // Total = base + IVA
      const base  = priceAfterDiscount
      const tax   = base * line.tax_rate
      const total = base + tax

      line.base_amount = Math.round(base)
      line.tax_amount  = Math.round(tax)
      line.line_total  = Math.round(total)
    }
  } else {
    // Sin impuesto configurado
    line.base_amount = Math.round(priceAfterDiscount)
    line.tax_amount  = 0
    line.tax_rate    = 0
    line.tax_code    = null
    line.tax_name    = null
    line.line_total  = Math.round(priceAfterDiscount)
  }
}
