/**
 * Utilidades puras de manipulación de strings.
 * Sin dependencias de framework — usable en web y mobile.
 */

/**
 * Elimina diacríticos (tildes, diéresis, etc.) de un string.
 * @param {string} value
 * @returns {string}
 */
export function stripDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza texto para búsqueda o comparación:
 * lowercase, sin diacríticos, sin caracteres especiales, sin espacios extra.
 * @param {string} value
 * @returns {string}
 */
export function normalizeText(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Alias semántico de normalizeText para uso en el command engine.
 * Normaliza el texto de un comando de voz/texto.
 * @param {string} value
 * @returns {string}
 */
export function normalizeCommandText(value) {
  return normalizeText(value);
}

/**
 * Hash DJB2 de 32 bits sobre texto ya normalizado.
 * Devuelve un string hexadecimal de 8 caracteres.
 * @param {string} value
 * @returns {string}
 */
export function hashNormalizedText(value) {
  const text = String(value || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash |= 0;
  }
  const asUint = hash >>> 0;
  return asUint.toString(16).padStart(8, '0');
}

/**
 * Normaliza un nombre de cliente: elimina puntuación final y espacios extra.
 * @param {string} value
 * @returns {string}
 */
export function normalizeCustomerName(value) {
  return String(value || '')
    .replace(/[,:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza texto para uso como SKU:
 * mayúsculas, sin diacríticos, solo alfanumérico.
 * @param {string} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function normalizeSku(value, maxLength) {
  const result = stripDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return maxLength ? result.substring(0, maxLength) : result;
}
