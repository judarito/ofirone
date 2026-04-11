/**
 * Constantes de terceros (clientes / proveedores).
 * Aplican en Colombia — sin dependencias de framework.
 */

/**
 * Códigos de tipo de documento válidos en Colombia.
 */
export const DOCUMENT_TYPE_CODES = [
  'CC',
  'NIT',
  'CE',
  'TI',
  'PASSPORT',
  'PEP',
  'NUI',
  'RUT',
];

/**
 * Regímenes tributarios.
 * Cada entrada tiene: value (código DIAN), shortLabel (mobile/compacto),
 * fullLabel (web/formularios).
 */
export const TAX_REGIMES = [
  { value: '48',  shortLabel: 'Responsable IVA (48)',       fullLabel: 'Responsable de IVA (Régimen Ordinario) - 48' },
  { value: '49',  shortLabel: 'No Responsable IVA (49)',    fullLabel: 'No Responsable de IVA - 49' },
  { value: 'O-13', shortLabel: 'Gran Contribuyente (O-13)', fullLabel: 'Gran Contribuyente - O-13' },
  { value: 'ZZ',  shortLabel: 'Régimen Simple (ZZ)',        fullLabel: 'Régimen Simple de Tributación - ZZ' },
];

/**
 * Opciones de régimen para selectores mobile (value + label).
 */
export const TAX_REGIME_OPTIONS_MOBILE = TAX_REGIMES.map(({ value, shortLabel }) => ({
  value,
  label: shortLabel,
}));

/**
 * Opciones de régimen para selectores web/Vuetify (value + title).
 */
export const TAX_REGIME_OPTIONS_WEB = TAX_REGIMES.map(({ value, fullLabel }) => ({
  value,
  title: fullLabel,
}));
