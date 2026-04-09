/**
 * Composable que centraliza la gestión de alertas del sistema en tiempo real.
 * Extrae de App.vue toda la lógica de stock, vencimiento y layaway alerts
 * para mantener el componente raíz enfocado en navegación/layout.
 *
 * Uso en App.vue:
 *   import { useAppAlerts } from '@/composables/useAppAlerts'
 *   const { allAlerts, totalAlertsCount, stockAlerts, ... } = useAppAlerts()
 */

import { ref, computed } from 'vue'
import { useTenant } from '@/composables/useTenant'
import alertsService from '@/services/alerts.service'
import locationsService from '@/services/locations.service'

const allAlerts = ref([])
const loadingAlerts = ref(false)
const locations = ref([])
let alertsChannel = null

const ALERT_TYPES = ['STOCK', 'EXPIRATION', 'LAYAWAY', 'PAYABLE', 'RECEIVABLE']
const ALERTS_PER_TYPE_LIMIT = 80
const MAX_ALERTS_IN_MEMORY = ALERT_TYPES.length * ALERTS_PER_TYPE_LIMIT

const sortAlertsByCreatedAt = (alerts) => (
  [...(Array.isArray(alerts) ? alerts : [])].sort((left, right) => {
    const leftDate = new Date(left?.created_at || 0).getTime()
    const rightDate = new Date(right?.created_at || 0).getTime()
    return rightDate - leftDate
  })
)

const trimAlerts = (alerts) => sortAlertsByCreatedAt(alerts).slice(0, MAX_ALERTS_IN_MEMORY)

const stockFilters = ref({ alert_level: null, location_id: null, search: '' })
const expirationFilters = ref({ alert_level: null, location_id: null, search: '' })
const layawayFilters = ref({ alert_level: null, search: '' })
const payableFilters = ref({ alert_level: null, search: '' })
const receivableFilters = ref({ alert_level: null, search: '' })

const stockAlertLevels = [
  { title: 'Sin stock', value: 'OUT_OF_STOCK' },
  { title: 'Stock bajo', value: 'LOW_STOCK' },
  { title: 'Sin disponible', value: 'NO_AVAILABLE' },
  { title: 'Disponible bajo', value: 'LOW_AVAILABLE' }
]

const expirationAlertLevels = [
  { title: 'Vencido', value: 'EXPIRED' },
  { title: 'Crítico', value: 'CRITICAL' },
  { title: 'Advertencia', value: 'WARNING' }
]

const layawayAlertLevels = [
  { title: 'Vencido', value: 'EXPIRED' },
  { title: 'Próximo a vencer', value: 'DUE_SOON' }
]

const payableAlertLevels = [
  { title: 'Vencida', value: 'OVERDUE' },
  { title: 'Por vencer', value: 'DUE_SOON' }
]

const receivableAlertLevels = [
  { title: 'Cupo excedido', value: 'OVER_LIMIT' },
  { title: 'Con saldo', value: 'WITH_DEBT' }
]

export function useAppAlerts() {
  const { tenantId } = useTenant()

  // ── Computeds filtrados ───────────────────────────────────────────────────
  const stockAlerts = computed(() => {
    let alerts = allAlerts.value.filter(a => a.alert_type === 'STOCK')
    if (stockFilters.value.alert_level) {
      alerts = alerts.filter(a => a.alert_level === stockFilters.value.alert_level)
    }
    if (stockFilters.value.location_id) {
      alerts = alerts.filter(a => a.data.location_id === stockFilters.value.location_id)
    }
    if (stockFilters.value.search) {
      const q = stockFilters.value.search.toLowerCase()
      alerts = alerts.filter(a =>
        a.data.product_name?.toLowerCase().includes(q) ||
        a.data.sku?.toLowerCase().includes(q)
      )
    }
    return alerts
  })

  const expirationAlerts = computed(() => {
    let alerts = allAlerts.value.filter(a => a.alert_type === 'EXPIRATION')
    if (expirationFilters.value.alert_level) {
      alerts = alerts.filter(a => a.alert_level === expirationFilters.value.alert_level)
    }
    if (expirationFilters.value.location_id) {
      alerts = alerts.filter(a => a.data.location_id === expirationFilters.value.location_id)
    }
    if (expirationFilters.value.search) {
      const q = expirationFilters.value.search.toLowerCase()
      alerts = alerts.filter(a =>
        a.data.product_name?.toLowerCase().includes(q) ||
        a.data.sku?.toLowerCase().includes(q) ||
        a.data.batch_number?.toLowerCase().includes(q)
      )
    }
    return alerts
  })

  const layawayAlerts = computed(() => {
    let alerts = allAlerts.value.filter(a => a.alert_type === 'LAYAWAY')
    if (layawayFilters.value.alert_level) {
      alerts = alerts.filter(a => a.alert_level === layawayFilters.value.alert_level)
    }
    if (layawayFilters.value.search) {
      const q = layawayFilters.value.search.toLowerCase()
      alerts = alerts.filter(a =>
        a.data.customer_name?.toLowerCase().includes(q) ||
        a.data.customer_document?.toLowerCase().includes(q) ||
        a.data.customer_phone?.toLowerCase().includes(q)
      )
    }
    return alerts
  })

  const payableAlerts = computed(() => {
    let alerts = allAlerts.value.filter(a => a.alert_type === 'PAYABLE')
    if (payableFilters.value.alert_level) {
      alerts = alerts.filter(a => a.alert_level === payableFilters.value.alert_level)
    }
    if (payableFilters.value.search) {
      const q = payableFilters.value.search.toLowerCase()
      alerts = alerts.filter(a =>
        a.data.supplier_name?.toLowerCase().includes(q) ||
        a.data.invoice_number?.toLowerCase().includes(q) ||
        a.data.location_name?.toLowerCase().includes(q)
      )
    }
    return alerts
  })

  const receivableAlerts = computed(() => {
    let alerts = allAlerts.value.filter(a => a.alert_type === 'RECEIVABLE')
    if (receivableFilters.value.alert_level) {
      alerts = alerts.filter(a => a.alert_level === receivableFilters.value.alert_level)
    }
    if (receivableFilters.value.search) {
      const q = receivableFilters.value.search.toLowerCase()
      alerts = alerts.filter(a =>
        a.data.customer_name?.toLowerCase().includes(q) ||
        a.data.customer_document?.toLowerCase().includes(q)
      )
    }
    return alerts
  })

  const stockAlertsCount = computed(() => stockAlerts.value.length)
  const expirationAlertsCount = computed(() => expirationAlerts.value.length)
  const layawayAlertsCount = computed(() => layawayAlerts.value.length)
  const payableAlertsCount = computed(() => payableAlerts.value.length)
  const receivableAlertsCount = computed(() => receivableAlerts.value.length)
  const totalAlertsCount = computed(
    () => (
      stockAlertsCount.value +
      expirationAlertsCount.value +
      layawayAlertsCount.value +
      payableAlertsCount.value +
      receivableAlertsCount.value
    )
  )

  // Alias de compatibilidad (deprecated)
  const filteredLayawayAlerts = computed(() => layawayAlerts.value)
  const payableOverdueAlerts = computed(() => payableAlerts.value.filter((alert) => alert.alert_level === 'OVERDUE'))
  const payableDueSoonAlerts = computed(() => payableAlerts.value.filter((alert) => alert.alert_level === 'DUE_SOON'))
  const payableSummary = computed(() => ({
    overdueCount: payableOverdueAlerts.value.length,
    dueSoonCount: payableDueSoonAlerts.value.length,
    overdueAmount: payableOverdueAlerts.value.reduce((acc, item) => acc + Number(item?.data?.balance || 0), 0),
    dueSoonAmount: payableDueSoonAlerts.value.reduce((acc, item) => acc + Number(item?.data?.balance || 0), 0)
  }))

  // ── Carga y realtime ──────────────────────────────────────────────────────
  const loadAlerts = async () => {
    if (!tenantId.value) return
    loadingAlerts.value = true
    try {
      const results = await Promise.all(
        ALERT_TYPES.map((type) => alertsService.getAlertsByType(tenantId.value, type, { limit: ALERTS_PER_TYPE_LIMIT }))
      )

      const merged = results.flatMap((result) => result.success ? (result.data || []) : [])
      allAlerts.value = trimAlerts(merged)
    } catch (error) {
      console.error('Error loading alerts:', error)
    } finally {
      loadingAlerts.value = false
    }
  }

  const loadLocations = async () => {
    if (!tenantId.value) return
    try {
      const result = await locationsService.getLocations(tenantId.value)
      if (result.success) {
        locations.value = result.data || []
      }
    } catch (error) {
      console.error('Error loading locations:', error)
    }
  }

  const handleAlertChange = (payload) => {
    const { eventType, new: newRecord, old: oldRecord } = payload

    if (eventType === 'INSERT') {
      const exists = allAlerts.value.find(a => a.alert_id === newRecord.alert_id)
      if (!exists) {
        allAlerts.value = trimAlerts([newRecord, ...allAlerts.value])
      }
    } else if (eventType === 'UPDATE') {
      const index = allAlerts.value.findIndex(a => a.alert_id === newRecord.alert_id)
      if (index !== -1) {
        allAlerts.value[index] = newRecord
        allAlerts.value = sortAlertsByCreatedAt(allAlerts.value)
      } else {
        allAlerts.value = trimAlerts([newRecord, ...allAlerts.value])
      }
    } else if (eventType === 'DELETE') {
      allAlerts.value = allAlerts.value.filter(a => a.alert_id !== oldRecord.alert_id)
    }
  }

  const subscribeToAlerts = () => {
    if (!tenantId.value) return
    if (alertsChannel) {
      alertsService.unsubscribe(alertsChannel)
    }
    alertsChannel = alertsService.subscribeToAlerts(tenantId.value, handleAlertChange)
    if (!alertsChannel) {
      console.error('Error al suscribirse a alertas en tiempo real')
    }
  }

  const unsubscribeFromAlerts = () => {
    if (alertsChannel) {
      alertsService.unsubscribe(alertsChannel)
      alertsChannel = null
    }
  }

  const loadStockAlerts = async () => { await alertsService.refreshStockAlerts() }
  const loadExpirationAlerts = async () => { await alertsService.refreshExpirationAlerts() }
  const loadLayawayAlerts = async () => { await alertsService.refreshLayawayAlerts() }
  const loadPayableAlerts = async () => { await alertsService.refreshSupplierPayableAlerts() }
  const loadReceivableAlerts = async () => { await alertsService.refreshCustomerReceivableAlerts() }

  // ── Helpers de color / ícono / etiqueta ───────────────────────────────────
  const getStockAlertColor = (level) => (
    { OUT_OF_STOCK: 'error', LOW_STOCK: 'warning', NO_AVAILABLE: 'deep-orange', LOW_AVAILABLE: 'orange' }[level] || 'grey'
  )
  const getStockAlertIcon = (level) => (
    { OUT_OF_STOCK: 'mdi-alert-circle', LOW_STOCK: 'mdi-alert', NO_AVAILABLE: 'mdi-cancel', LOW_AVAILABLE: 'mdi-alert-outline' }[level] || 'mdi-information'
  )
  const getStockAlertLabel = (level) => (
    { OUT_OF_STOCK: 'Sin stock', LOW_STOCK: 'Stock bajo', NO_AVAILABLE: 'Sin disponible', LOW_AVAILABLE: 'Disponible bajo' }[level] || level
  )

  const getExpirationAlertColor = (level) => (
    { EXPIRED: 'error', CRITICAL: 'deep-orange', WARNING: 'warning' }[level] || 'grey'
  )
  const getExpirationAlertIcon = (level) => (
    { EXPIRED: 'mdi-alert-circle', CRITICAL: 'mdi-alert-octagon', WARNING: 'mdi-alert' }[level] || 'mdi-information'
  )
  const getExpirationAlertLabel = (level) => (
    { EXPIRED: 'Vencido', CRITICAL: 'Crítico', WARNING: 'Advertencia' }[level] || level
  )

  const getLayawayAlertColor = (level) => (
    { EXPIRED: 'error', DUE_SOON: 'warning' }[level] || 'grey'
  )
  const getLayawayAlertIcon = (level) => (
    { EXPIRED: 'mdi-alert-circle', DUE_SOON: 'mdi-clock-alert' }[level] || 'mdi-information'
  )
  const getLayawayAlertLabel = (level) => (
    { EXPIRED: 'Vencido', DUE_SOON: 'Próximo a vencer' }[level] || level
  )

  const getPayableAlertColor = (level) => (
    { OVERDUE: 'error', DUE_SOON: 'warning' }[level] || 'grey'
  )
  const getPayableAlertIcon = (level) => (
    { OVERDUE: 'mdi-alert-circle', DUE_SOON: 'mdi-calendar-clock' }[level] || 'mdi-information'
  )
  const getPayableAlertLabel = (level) => (
    { OVERDUE: 'Vencida', DUE_SOON: 'Por vencer' }[level] || level
  )

  const getReceivableAlertColor = (level) => (
    { OVER_LIMIT: 'error', WITH_DEBT: 'warning' }[level] || 'grey'
  )
  const getReceivableAlertIcon = (level) => (
    { OVER_LIMIT: 'mdi-alert-circle', WITH_DEBT: 'mdi-account-cash' }[level] || 'mdi-information'
  )
  const getReceivableAlertLabel = (level) => (
    { OVER_LIMIT: 'Cupo excedido', WITH_DEBT: 'Con saldo' }[level] || level
  )

  return {
    // Estado
    allAlerts,
    loadingAlerts,
    locations,
    // Filtros
    stockFilters,
    expirationFilters,
    layawayFilters,
    payableFilters,
    receivableFilters,
    // Niveles
    stockAlertLevels,
    expirationAlertLevels,
    layawayAlertLevels,
    payableAlertLevels,
    receivableAlertLevels,
    // Computeds
    stockAlerts,
    expirationAlerts,
    layawayAlerts,
    payableAlerts,
    receivableAlerts,
    stockAlertsCount,
    expirationAlertsCount,
    layawayAlertsCount,
    payableAlertsCount,
    receivableAlertsCount,
    totalAlertsCount,
    filteredLayawayAlerts,
    payableOverdueAlerts,
    payableDueSoonAlerts,
    payableSummary,
    // Funciones
    loadAlerts,
    loadLocations,
    subscribeToAlerts,
    unsubscribeFromAlerts,
    loadStockAlerts,
    loadExpirationAlerts,
    loadLayawayAlerts,
    loadPayableAlerts,
    loadReceivableAlerts,
    // Helpers
    getStockAlertColor,
    getStockAlertIcon,
    getStockAlertLabel,
    getExpirationAlertColor,
    getExpirationAlertIcon,
    getExpirationAlertLabel,
    getLayawayAlertColor,
    getLayawayAlertIcon,
    getLayawayAlertLabel,
    getPayableAlertColor,
    getPayableAlertIcon,
    getPayableAlertLabel,
    getReceivableAlertColor,
    getReceivableAlertIcon,
    getReceivableAlertLabel
  }
}
