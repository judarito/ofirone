export const COMMON_TEXT = {
  select: 'Seleccionar',
  search: 'Buscar',
  close: 'Cerrar',
  save: 'Guardar',
  cancel: 'Cancelar',
  loading: 'Cargando...',
  noData: 'Sin datos',
  noResults: 'Sin resultados',
  previous: 'Anterior',
  next: 'Siguiente',
  noSelection: 'Sin selección',
  clearSelection: 'Limpiar selección',
  password: 'Contraseña',
  noCache: 'Sin caché',
  yes: 'Sí',
  no: 'No',
};

export const APP_TEXT = {
  sessionExpired: 'Tu sesión expiró. Inicia sesión nuevamente.',
  sessionEnded: 'Sesión finalizada. Inicia sesión nuevamente.',
  loginMenuLoadFailed: 'Sesión iniciada, pero no fue posible cargar el menú dinámico.',
  loginFailed: 'No fue posible iniciar sesión.',
  offlineInitError: 'Error al inicializar el modo offline.',
  userManualWebOnly: 'El manual de usuario está disponible solo en la app web.',
  noOfflineCache: 'No hay caché local para modo offline.',
  continueOffline: 'Continuar sin conexión',
  lastCachePrefix: 'Última caché',
  clearOfflineCache: 'Limpiar caché offline',
  noMenuAvailable: 'No hay menú disponible para este usuario.',
  closeSession: 'Cerrar sesión',
  notifications: 'Notificaciones',
  markAll: 'Marcar todas',
  noNotifications: 'No tienes notificaciones.',
  userFallback: 'Usuario',
  tenantFallback: 'Sin tenant',
  todaySales: 'Ventas Hoy',
  thisMonth: 'Este Mes',
  thisYear: 'Este Año',
  newSale: 'Nueva Venta',
  newSaleHint: 'Registrar pedido, pago y factura',
  aiCenter: 'Centro IA',
  aiCenterSummary: '8 análisis: inventario, compras, ventas, cajas, cartera, producción, terceros y dashboard',
  mobileUnavailableSuffix: 'no está disponible en mobile todavía.',
};

export function buildNoAccessModuleText(moduleName) {
  return `No tienes acceso al módulo "${moduleName}" con tu rol actual.`;
}

export function buildNoAccessLabelText(label) {
  return `No tienes acceso a "${label}" con tu rol actual.`;
}

export function buildMobileUnavailableText(label) {
  return `"${label}" ${APP_TEXT.mobileUnavailableSuffix}`;
}
