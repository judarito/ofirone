import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000

class TenantSettingsService {
  constructor() {
    this.table = 'tenant_settings'
    this.tenantsTable = 'tenants'
  }

  isManualSaleDatetimeSchemaError(error) {
    const message = String(error?.message || error || '').toLowerCase()
    return (
      message.includes('pos_allow_manual_sale_datetime') ||
      message.includes('pos_max_backdate_hours')
    )
  }

  buildSettingsPayload(tenantId, settings, { includeManualSaleDatetime = true } = {}) {
    const payload = {
      tenant_id: tenantId,
      // Negocio básico
      business_name: settings.business_name || null,
      business_address: settings.business_address || null,
      business_phone: settings.business_phone || null,
      logo_url: settings.logo_url || null,
      receipt_footer: settings.receipt_footer || null,
      default_tax_included: settings.default_tax_included || false,

      // Interfaz y UX
      default_page_size: settings.default_page_size || 20,
      theme: settings.theme || 'light',
      date_format: settings.date_format || 'DD/MM/YYYY',
      locale: settings.locale || 'es-CO',
      session_timeout_minutes: settings.session_timeout_minutes || 60,

      // IA
      ai_forecast_days_back: settings.ai_forecast_days_back || 90,
      ai_purchase_suggestion_days: settings.ai_purchase_suggestion_days || 14,
      ai_purchase_advisor_enabled: settings.ai_purchase_advisor_enabled !== false,
      ai_sales_forecast_enabled: settings.ai_sales_forecast_enabled !== false,

      // Contabilidad
      accounting_enabled: settings.accounting_enabled || false,
      accounting_mode: settings.accounting_mode || 'ASYNC',
      accounting_ai_enabled: settings.accounting_ai_enabled !== false,
      accounting_auto_post_sales: settings.accounting_auto_post_sales || false,
      accounting_auto_post_purchases: settings.accounting_auto_post_purchases || false,
      accounting_country_code: settings.accounting_country_code || 'CO',

      // Inventario
      expiry_alert_days: settings.expiry_alert_days || 30,
      reserve_stock_on_layaway: settings.reserve_stock_on_layaway !== false,

      // Ventas y precios
      max_discount_without_auth: settings.max_discount_without_auth || 5.0,
      rounding_method: settings.rounding_method || 'normal',
      rounding_multiple: settings.rounding_multiple || 100,

      // Facturación
      invoice_prefix: settings.invoice_prefix || 'FAC',
      next_invoice_number: settings.next_invoice_number || 1,
      electronic_invoicing_enabled: settings.electronic_invoicing_enabled || false,
      print_format: settings.print_format || 'thermal',
      thermal_paper_width: settings.thermal_paper_width || 80,

      // Notificaciones
      email_alerts_enabled: settings.email_alerts_enabled || false,
      alert_email: settings.alert_email || null,
      notify_low_stock: settings.notify_low_stock !== false,
      notify_expiring_products: settings.notify_expiring_products !== false
    }

    if (includeManualSaleDatetime) {
      payload.pos_allow_manual_sale_datetime = settings.pos_allow_manual_sale_datetime === true
      payload.pos_max_backdate_hours = settings.pos_max_backdate_hours || 24
    }

    return payload
  }

  // Obtener configuración del tenant
  async getSettings(tenantId, options = {}) {
    try {
      return await queryCache.getOrLoad(
        'tenant-settings:settings',
        async () => {
          const { data, error } = await supabaseService.client
            .from(this.table)
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle()

          if (error) throw error
          return { success: true, data: data || {} }
        },
        {
          tenantId,
          ttlMs: SETTINGS_CACHE_TTL_MS,
          storage: 'session',
          tags: ['tenant-settings'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true,
        }
      )
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Obtener datos del tenant
  async getTenant(tenantId, options = {}) {
    try {
      return await queryCache.getOrLoad(
        'tenant-settings:tenant',
        async () => {
          const { data, error } = await supabaseService.client
            .from(this.tenantsTable)
            .select('*')
            .eq('tenant_id', tenantId)
            .single()

          if (error) throw error
          return { success: true, data }
        },
        {
          tenantId,
          ttlMs: SETTINGS_CACHE_TTL_MS,
          storage: 'session',
          tags: ['tenant-settings'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true,
        }
      )
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Guardar/actualizar configuración (upsert)
  async saveSettings(tenantId, settings) {
    try {
      let payload = this.buildSettingsPayload(tenantId, settings)
      let data

      const executeUpsert = async (upsertPayload) => {
        const result = await supabaseService.client
          .from(this.table)
          .upsert(upsertPayload, { onConflict: 'tenant_id' })
          .select()

        if (result.error) throw result.error
        return result.data
      }

      try {
        data = await executeUpsert(payload)
      } catch (error) {
        if (!this.isManualSaleDatetimeSchemaError(error)) throw error

        console.warn('[tenantSettings] tenant_settings sin columnas POS manual sale datetime; guardando con payload legacy')
        payload = this.buildSettingsPayload(tenantId, settings, { includeManualSaleDatetime: false })
        data = await executeUpsert(payload)
      }

      queryCache.invalidateByTags(['tenant-settings'], { tenantId })
      queryCache.prime('tenant-settings:settings', { success: true, data: data[0] || {} }, {
        tenantId,
        ttlMs: SETTINGS_CACHE_TTL_MS,
        storage: 'session',
        tags: ['tenant-settings'],
      })
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Actualizar datos generales del tenant (incluye campos fiscales para FE)
  async updateTenant(tenantId, updates) {
    try {
      const { data, error } = await supabaseService.update(this.tenantsTable, {
        name:                  updates.name,
        tax_id:                updates.tax_id                || null,
        currency_code:         updates.currency_code         || 'COP',
        // Campos fiscales para Facturación Electrónica DIAN
        dv:                    updates.dv                    || null,
        trade_name:            updates.trade_name            || null,
        tax_regime:            updates.tax_regime            || null,
        is_responsible_for_iva: updates.is_responsible_for_iva || false,
        obligated_accounting:  updates.obligated_accounting  || false,
        ciiu_code:             updates.ciiu_code             || null,
        fiscal_email:          updates.fiscal_email          || null,
        fiscal_phone:          updates.fiscal_phone          || null,
        // Dirección fiscal del emisor (requerida en XML FE)
        address:               updates.address               || null,
        city:                  updates.city                  || null,
        department:            updates.department            || null,
        country_code:          updates.country_code          || 'CO',
        postal_code:           updates.postal_code           || null,
        city_code:             updates.city_code             || null
      }, { tenant_id: tenantId })
      if (error) throw error
      queryCache.invalidateByTags(['tenant-settings'], { tenantId })
      queryCache.prime('tenant-settings:tenant', { success: true, data: data[0] }, {
        tenantId,
        ttlMs: SETTINGS_CACHE_TTL_MS,
        storage: 'session',
        tags: ['tenant-settings'],
      })
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}

export default new TenantSettingsService()
