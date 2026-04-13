export const HELP_CENTER_PROCESSES = [
  { key: 'all', label: 'Todos' },
  { key: 'setup', label: 'Primeros pasos' },
  { key: 'sales', label: 'Ventas' },
  { key: 'purchases', label: 'Compras' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'cash', label: 'Caja' },
  { key: 'admin', label: 'Administración' },
];

export const HELP_CENTER_ARTICLES = [
  {
    slug: 'primeros-pasos',
    process: 'setup',
    title: 'Primeros pasos del tenant',
    summary: 'Checklist corto para dejar empresa, usuarios, POS e inventario listos para operar.',
    audience: 'Administrador',
    estimatedMinutes: 8,
    steps: [
      { id: 'tenant', title: 'Configura empresa', description: 'Valida datos básicos, prefijo y formato del ticket.', screen: 'TenantConfig' },
      { id: 'users', title: 'Revisa usuarios', description: 'Confirma usuarios activos y sus roles operativos.', screen: 'Users' },
      { id: 'pos', title: 'Haz una venta de prueba', description: 'Valida caja, pagos y comprobante desde POS.', screen: 'PointOfSale' },
    ],
  },
  {
    slug: 'ventas-operacion',
    process: 'sales',
    title: 'Operación de ventas',
    summary: 'Cómo vender, validar pagos y revisar el histórico desde mobile.',
    audience: 'Cajero y administrador',
    estimatedMinutes: 6,
    steps: [
      { id: 'sale-open', title: 'Abre POS', description: 'Busca productos, agrega cliente si aplica y completa pagos.', screen: 'PointOfSale' },
      { id: 'sale-history', title: 'Revisa historial', description: 'Confirma la venta, impresión y trazabilidad posterior.', screen: 'Sales' },
      { id: 'sale-reports', title: 'Consulta reportes', description: 'Usa reportes para validar totales y desempeño del turno.', screen: 'Reports' },
    ],
  },
  {
    slug: 'compras-operacion',
    process: 'purchases',
    title: 'Compras y abastecimiento',
    summary: 'Registro de compras, OCR, OC pendientes y tablero básico de proveedores.',
    audience: 'Compras y administrador',
    estimatedMinutes: 7,
    steps: [
      { id: 'purchase-new', title: 'Registra la compra', description: 'Selecciona sede, proveedor y líneas de compra.', screen: 'Purchases' },
      { id: 'purchase-ocr', title: 'Usa OCR si tienes factura', description: 'Analiza la factura y completa líneas o faltantes de catálogo.', screen: 'Purchases' },
      { id: 'purchase-followup', title: 'Haz seguimiento', description: 'Consulta OC pendientes y CxP proveedores dentro del módulo.', screen: 'Purchases' },
    ],
  },
  {
    slug: 'inventario-operacion',
    process: 'inventory',
    title: 'Inventario y movimientos',
    summary: 'Stock, kardex, ajustes, traslados, lotes e ingreso por compra.',
    audience: 'Bodega y administrador',
    estimatedMinutes: 7,
    steps: [
      { id: 'inventory-stock', title: 'Consulta stock y kardex', description: 'Revisa saldos actuales y movimientos por variante.', screen: 'Inventory' },
      { id: 'inventory-batches', title: 'Controla lotes', description: 'Monitorea vencimientos y recepciones por lote.', screen: 'Batches' },
      { id: 'inventory-reports', title: 'Abre reportes de inventario', description: 'Consulta stock bajo, por sede, sin movimiento y próximos a vencer.', screen: 'Reports' },
    ],
  },
  {
    slug: 'caja-operacion',
    process: 'cash',
    title: 'Caja y sesiones',
    summary: 'Apertura, operación, asignación y cierre de cajas para no bloquear POS.',
    audience: 'Cajero y supervisor',
    estimatedMinutes: 5,
    steps: [
      { id: 'cash-sessions', title: 'Abre una sesión', description: 'Verifica caja, usuario asignado y monto inicial.', screen: 'CashSessions' },
      { id: 'cash-registers', title: 'Revisa cajas y asignaciones', description: 'Mantén cajas activas y personal asociado.', screen: 'CashRegisters' },
      { id: 'cash-payments', title: 'Valida métodos de pago', description: 'Confirma que los medios de pago estén listos para operar.', screen: 'PaymentMethods' },
    ],
  },
  {
    slug: 'administracion-mobile',
    process: 'admin',
    title: 'Gestión de tenant, ayuda y web-only',
    summary: 'Qué puedes hacer desde mobile y qué sigue concentrado en la web.',
    audience: 'Administrador y superadmin',
    estimatedMinutes: 4,
    steps: [
      { id: 'tenant-summary', title: 'Usa Gestión Empresa', description: 'Revisa el resumen operativo del tenant y accesos clave.', screen: 'TenantManagement' },
      { id: 'roles-readonly', title: 'Consulta roles', description: 'Mobile expone la vista de roles; la edición avanzada va por separado.', screen: 'Roles' },
      { id: 'accounting-web', title: 'Contabilidad y billing avanzados', description: 'Estos flujos siguen web-only para evitar falsa paridad.', webOnly: true, route: '/accounting' },
    ],
  },
];

export const HELP_CENTER_FAQS = [
  {
    id: 'faq-menu',
    question: '¿Por qué algunos accesos aparecen como web-only?',
    answer: 'Porque siguen concentrados en la app web y mobile ahora los marca explícitamente para no prometer una pantalla equivalente.',
  },
  {
    id: 'faq-roles',
    question: '¿Dónde edito roles y menús?',
    answer: 'La ruta /roles ahora es consulta de roles. La edición avanzada sigue en Roles y Menús para superadmin.',
  },
  {
    id: 'faq-settings',
    question: '¿Dónde cambio tema y preferencias?',
    answer: 'Desde Preferencias puedes cambiar tema y revisar la vista actual del menú sin entrar a Configuración de Empresa.',
  },
  {
    id: 'faq-accounting',
    question: '¿Contabilidad y billing ya están en mobile?',
    answer: 'No. Permanecen web-only y ahora se muestran así en el menú y en la ayuda.',
  },
];
