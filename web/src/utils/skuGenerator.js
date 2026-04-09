/**
 * Generador de SKUs únicos basados en producto, categoría y variante
 */

/**
 * Genera un SKU único basado en el nombre del producto, categoría y variante
 * Formato: CCCCC-PPPPPPPP-VVVVV-XXXX
 * 
 * Donde:
 * - CCCCC: 5 caracteres de la categoría (máx)
 * - PPPPPPPP: 8 caracteres del nombre del producto (máx)
 * - VVVVV: 5 caracteres del nombre de la variante (máx)
 * - XXXX: Sufijo aleatorio de 4 caracteres para garantizar unicidad
 * 
 * @param {string} productName - Nombre del producto
 * @param {string} categoryName - Nombre de la categoría (puede ser vacío)
 * @param {string} variantName - Nombre de la variante (puede ser vacío)
 * @returns {string} SKU generado
 */
export function generateSKU(productName, categoryName = '', variantName = '') {
  // Función auxiliar para normalizar y limpiar texto
  const normalize = (text, maxLength) => {
    if (!text) return ''
    
    // Convertir a mayúsculas y eliminar acentos
    const normalized = text
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Eliminar diacríticos
      .replace(/[^A-Z0-9]/g, '') // Solo letras y números
    
    // Tomar los primeros N caracteres
    return normalized.substring(0, maxLength)
  }

  // Generar sufijo aleatorio de 4 caracteres
  const generateSuffix = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let suffix = ''
    for (let i = 0; i < 4; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return suffix
  }

  // Normalizar cada componente
  const categoryPart = normalize(categoryName, 5)
  const productPart = normalize(productName, 8)
  const variantPart = normalize(variantName, 5)
  const suffix = generateSuffix()

  // Construir el SKU
  const parts = []
  if (categoryPart) parts.push(categoryPart)
  if (productPart) parts.push(productPart)
  if (variantPart) parts.push(variantPart)
  parts.push(suffix)

  return parts.join('-')
}

/**
 * Genera un SKU más corto para casos simples
 * Formato: PPP-VVV-XXX
 * 
 * @param {string} productName - Nombre del producto
 * @param {string} variantName - Nombre de la variante
 * @returns {string} SKU generado
 */
export function generateShortSKU(productName, variantName = '') {
  const normalize = (text, maxLength) => {
    if (!text) return ''
    return text
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, maxLength)
  }

  const generateSuffix = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let suffix = ''
    for (let i = 0; i < 3; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return suffix
  }

  const productPart = normalize(productName, 3)
  const variantPart = normalize(variantName, 3)
  const suffix = generateSuffix()

  const parts = []
  if (productPart) parts.push(productPart)
  if (variantPart) parts.push(variantPart)
  parts.push(suffix)

  return parts.join('-')
}

/**
 * Valida si un SKU tiene el formato correcto
 * @param {string} sku - SKU a validar
 * @returns {boolean} true si es válido
 */
export function isValidSKU(sku) {
  if (!sku || typeof sku !== 'string') return false
  
  // El SKU debe tener al menos un guión y caracteres alfanuméricos
  const pattern = /^[A-Z0-9]+(-[A-Z0-9]+)+$/
  return pattern.test(sku)
}

/**
 * Genera un SKU numérico secuencial simple
 * Útil como fallback o para sistemas que prefieren números
 * @returns {string} SKU numérico
 */
export function generateNumericSKU() {
  const timestamp = Date.now().toString().slice(-8)
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${timestamp}-${random}`
}
