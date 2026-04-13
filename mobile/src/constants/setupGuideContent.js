export const SETUP_OPTIONS = [
  {
    key: 'TenantConfig',
    title: 'Empresa',
    subtitle: 'Parámetros generales del tenant',
    icon: 'business-outline',
    accent: '#4db7ff',
  },
  {
    key: 'AIInsights',
    title: 'Centro IA',
    subtitle: 'Analítica y consultas inteligentes',
    icon: 'sparkles-outline',
    accent: '#8f7cff',
  },
  {
    key: 'Locations',
    title: 'Sedes',
    subtitle: 'Gestión de sedes y direcciones',
    icon: 'location-outline',
    accent: '#57d65a',
  },
  {
    key: 'Taxes',
    title: 'Impuestos',
    subtitle: 'Tarifas y códigos tributarios',
    icon: 'pricetag-outline',
    accent: '#f7c843',
  },
  {
    key: 'TaxRules',
    title: 'Reglas de Impuesto',
    subtitle: 'Asignación de impuesto por alcance',
    icon: 'document-text-outline',
    accent: '#8f7cff',
  },
  {
    key: 'PricingRules',
    title: 'Reglas de Precio',
    subtitle: 'Precios por sede/regla comercial',
    icon: 'trending-up-outline',
    accent: '#ffb347',
  },
  {
    key: 'Users',
    title: 'Usuarios',
    subtitle: 'Usuarios del tenant y roles',
    icon: 'people-outline',
    accent: '#4db7ff',
  },
  {
    key: 'Roles',
    title: 'Roles',
    subtitle: 'Consulta roles y permisos asignados',
    icon: 'shield-outline',
    accent: '#8f7cff',
  },
  {
    key: 'RolesMenus',
    title: 'Roles y Menús',
    subtitle: 'Roles, permisos y asignación de menús',
    icon: 'shield-checkmark-outline',
    accent: '#57d65a',
  },
  {
    key: 'Settings',
    title: 'Preferencias',
    subtitle: 'Tema y vista del menú',
    icon: 'options-outline',
    accent: '#ffb347',
  },
  {
    key: 'HelpCenter',
    title: 'Centro de Ayuda',
    subtitle: 'Guías, FAQs y rutas operativas',
    icon: 'help-circle-outline',
    accent: '#4db7ff',
  },
];

export const GUIDED_ROUTES = [
  {
    key: 'PointOfSale',
    title: 'Vender',
    subtitle: 'Abrir POS, cobrar y facturar',
    icon: 'cart-outline',
    accent: '#ff8b5e',
  },
  {
    key: 'Purchases',
    title: 'Comprar',
    subtitle: 'Registrar compras y facturas proveedor',
    icon: 'receipt-outline',
    accent: '#57d65a',
  },
  {
    key: 'Inventory',
    title: 'Inventario',
    subtitle: 'Ajustes, consultas y stock',
    icon: 'cube-outline',
    accent: '#4db7ff',
  },
  {
    key: 'Reports',
    title: 'Reportes',
    subtitle: 'Revisar ventas, caja e indicadores',
    icon: 'bar-chart-outline',
    accent: '#f7c843',
  },
  {
    key: 'HelpCenter',
    title: 'Ayuda',
    subtitle: 'Abrir manual y FAQs operativas',
    icon: 'help-circle-outline',
    accent: '#4db7ff',
  },
];

export const HELP_FAQS = [
  {
    question: '¿Por dónde empezar en un tenant nuevo?',
    answer: 'Primero configura Empresa, luego Sedes e Impuestos, después Usuarios/Roles y por último valida POS, compras e inventario.',
  },
  {
    question: '¿Qué sí trae mobile hoy?',
    answer: 'Operación diaria, IA compacta, compras, POS, inventario, caja y reportes. Contabilidad completa y tenant management avanzado siguen web-only.',
  },
  {
    question: '¿Dónde está el manual completo?',
    answer: 'Ábrelo desde Centro de Ayuda en mobile. Para contabilidad y billing avanzados sigue usando la web.',
  },
];

export const RECOMMENDED_SETUP_STEPS = [
  '1. Empresa y tema',
  '2. Sedes e impuestos',
  '3. Usuarios, roles y permisos',
  '4. Validar POS, compras e inventario',
];
