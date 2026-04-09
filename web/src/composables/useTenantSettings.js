import { ref, computed, readonly } from 'vue'
import { useTenant } from './useTenant'
import tenantSettingsService from '@/services/tenantSettings.service'

const settings = ref(null)
const loadedTenantId = ref(null)
const loading = ref(false)
const error = ref(null)

export function useTenantSettings() {
  const { tenantId } = useTenant()

  // Cargar configuraciones
  const loadSettings = async (force = false) => {
    if (!tenantId.value) {
      settings.value = null
      loadedTenantId.value = null
      error.value = 'No hay tenant activo'
      return null
    }

    if (loadedTenantId.value !== tenantId.value) {
      settings.value = null
    }

    if (settings.value && loadedTenantId.value === tenantId.value && !force) return settings.value


    loading.value = true
    error.value = null

    try {
      const result = await tenantSettingsService.getSettings(tenantId.value, { forceRefresh: force })
      if (result.success) {
        settings.value = result.data || {}
        loadedTenantId.value = tenantId.value
        return settings.value
      } else {
        error.value = result.error
        return null
      }
    } catch (err) {
      error.value = err.message
      return null
    } finally {
      loading.value = false
    }
  }

  // Configuración de UI
  const defaultPageSize = computed(() => settings.value?.default_page_size || 20)
  const theme = computed(() => settings.value?.theme || 'light')
  const dateFormat = computed(() => settings.value?.date_format || 'DD/MM/YYYY')
  const locale = computed(() => settings.value?.locale || 'es-CO')
  const sessionTimeout = computed(() => settings.value?.session_timeout_minutes || 60)

  // Configuración de IA
  const aiForecastDaysBack = computed(() => settings.value?.ai_forecast_days_back || 90)
  const aiPurchaseSuggestionDays = computed(() => settings.value?.ai_purchase_suggestion_days || 14)
  const aiPurchaseAdvisorEnabled = computed(() => settings.value?.ai_purchase_advisor_enabled !== false)
  const aiSalesForecastEnabled = computed(() => settings.value?.ai_sales_forecast_enabled !== false)

  // Configuración de Contabilidad
  const accountingEnabled = computed(() => settings.value?.accounting_enabled || false)
  const accountingMode = computed(() => settings.value?.accounting_mode || 'ASYNC')
  const accountingAiEnabled = computed(() => settings.value?.accounting_ai_enabled !== false)
  const accountingAutoPostSales = computed(() => settings.value?.accounting_auto_post_sales || false)
  const accountingAutoPostPurchases = computed(() => settings.value?.accounting_auto_post_purchases || false)
  const accountingCountryCode = computed(() => settings.value?.accounting_country_code || 'CO')

  // Configuración de Inventario
  const expiryAlertDays = computed(() => settings.value?.expiry_alert_days || 30)
  const reserveStockOnLayaway = computed(() => settings.value?.reserve_stock_on_layaway !== false)

  // Configuración de Caja
  const cashSessionMaxHours = computed(() => settings.value?.cash_session_max_hours || 24)

  // Configuración de Ventas
  const maxDiscountWithoutAuth = computed(() => settings.value?.max_discount_without_auth || 5)
  const roundingMethod = computed(() => settings.value?.rounding_method || 'normal')
  const roundingMultiple = computed(() => settings.value?.rounding_multiple || 100)
  const posAllowManualSaleDatetime = computed(() => settings.value?.pos_allow_manual_sale_datetime === true)
  const posMaxBackdateHours = computed(() => settings.value?.pos_max_backdate_hours || 24)

  // Configuración de Facturación
  const invoicePrefix = computed(() => settings.value?.invoice_prefix || 'FAC')
  const nextInvoiceNumber = computed(() => settings.value?.next_invoice_number || 1)
  const electronicInvoicingEnabled = computed(() => settings.value?.electronic_invoicing_enabled || false)
  const printFormat = computed(() => settings.value?.print_format || 'thermal')
  const thermalPaperWidth = computed(() => settings.value?.thermal_paper_width || 80)

  // Configuración de Notificaciones
  const emailAlertsEnabled = computed(() => settings.value?.email_alerts_enabled || false)
  const alertEmail = computed(() => settings.value?.alert_email || '')
  const notifyLowStock = computed(() => settings.value?.notify_low_stock !== false)
  const notifyExpiringProducts = computed(() => settings.value?.notify_expiring_products !== false)

  // Función auxiliar para redondear totales según configuración
  const applyRounding = (amount) => {
    const method = roundingMethod.value
    const multiple = roundingMultiple.value

    if (method === 'none' || multiple === 1) return amount

    const divided = amount / multiple

    let rounded
    switch (method) {
      case 'up':
        rounded = Math.ceil(divided)
        break
      case 'down':
        rounded = Math.floor(divided)
        break
      case 'normal':
      default:
        rounded = Math.round(divided)
        break
    }

    return rounded * multiple
  }

  // Función para obtener siguiente número de factura
  const getNextInvoiceNumber = () => {
    return `${invoicePrefix.value}-${String(nextInvoiceNumber.value).padStart(6, '0')}`
  }

  // Incrementar número de factura
  const incrementInvoiceNumber = async () => {
    if (!tenantId.value || !settings.value) return false

    const newNumber = nextInvoiceNumber.value + 1
    const result = await tenantSettingsService.saveSettings(tenantId.value, {
      ...settings.value,
      next_invoice_number: newNumber
    })

    if (result.success) {
      settings.value.next_invoice_number = newNumber
      return true
    }

    return false
  }

  return {
    // Estado
    settings: readonly(settings),
    loading: readonly(loading),
    error: readonly(error),

    // Métodos
    loadSettings,

    // UI
    defaultPageSize,
    theme,
    dateFormat,
    locale,
    sessionTimeout,

    // IA
    aiForecastDaysBack,
    aiPurchaseSuggestionDays,
    aiPurchaseAdvisorEnabled,
    aiSalesForecastEnabled,

    // Contabilidad
    accountingEnabled,
    accountingMode,
    accountingAiEnabled,
    accountingAutoPostSales,
    accountingAutoPostPurchases,
    accountingCountryCode,

    // Inventario
    expiryAlertDays,
    reserveStockOnLayaway,

    // Caja
    cashSessionMaxHours,

    // Ventas
    maxDiscountWithoutAuth,
    roundingMethod,
    roundingMultiple,
    posAllowManualSaleDatetime,
    posMaxBackdateHours,
    applyRounding,

    // Facturación
    invoicePrefix,
    nextInvoiceNumber,
    electronicInvoicingEnabled,
    printFormat,
    thermalPaperWidth,
    getNextInvoiceNumber,
    incrementInvoiceNumber,

    // Notificaciones
    emailAlertsEnabled,
    alertEmail,
    notifyLowStock,
    notifyExpiringProducts
  }
}
