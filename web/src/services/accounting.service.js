import { supabase } from '@/plugins/supabase'
import supabaseService from './supabase.service'
import tenantSettingsService from './tenantSettings.service'
import queryCache from '@/utils/queryCache'

const AI_EDGE_FUNCTION = 'deepseek-proxy'
const AI_MODEL = import.meta.env.VITE_DEEPSEEK_TEXT_MODEL || 'deepseek-chat'

function extractJsonBlock(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (_e) {
      return null
    }
  }
}

class AccountingService {
  getDefaultPeriod() {
    const now = new Date()
    const year = now.getFullYear()
    const month = `${now.getMonth() + 1}`.padStart(2, '0')
    const day = `${now.getDate()}`.padStart(2, '0')

    return {
      date_from: `${year}-${month}-01`,
      date_to: `${year}-${month}-${day}`
    }
  }

  async getSettings(tenantId) {
    try {
      const result = await tenantSettingsService.getSettings(tenantId)
      if (!result.success) {
        throw new Error(result.error)
      }

      const data = result.data || {}

      return {
        success: true,
        data: {
          accounting_enabled: data?.accounting_enabled || false,
          accounting_mode: data?.accounting_mode || 'ASYNC',
          accounting_ai_enabled: data?.accounting_ai_enabled !== false,
          accounting_auto_post_sales: data?.accounting_auto_post_sales || false,
          accounting_auto_post_purchases: data?.accounting_auto_post_purchases || false,
          accounting_country_code: data?.accounting_country_code || 'CO'
        }
      }
    } catch (error) {
      const message = String(error?.message || '')
      if (message.includes('tenant_settings_rounding_method_check')) {
        return {
          success: false,
          error: 'Configuración inconsistente en tenant_settings.rounding_method. Ejecuta la migración FixRoundingMethodConstraint.sql y vuelve a intentar.'
        }
      }
      return { success: false, error: message || 'No se pudo guardar configuración contable.' }
    }
  }

  async saveSettings(tenantId, settings) {
    try {
      const payload = {
        accounting_enabled: Boolean(settings.accounting_enabled),
        accounting_mode: settings.accounting_mode || 'ASYNC',
        accounting_ai_enabled: settings.accounting_ai_enabled !== false,
        accounting_auto_post_sales: Boolean(settings.accounting_auto_post_sales),
        accounting_auto_post_purchases: Boolean(settings.accounting_auto_post_purchases),
        accounting_country_code: settings.accounting_country_code || 'CO'
      }

      // 1) Primero intentar UPDATE (no dispara defaults/constraints de INSERT)
      const { data: updatedRows, error: updateError } = await supabaseService.client
        .from('tenant_settings')
        .update(payload)
        .eq('tenant_id', tenantId)
        .select()
        .limit(1)

      if (updateError) throw updateError
      if (Array.isArray(updatedRows) && updatedRows.length > 0) {
        queryCache.invalidateByTags(['tenant-settings'], { tenantId })
        return { success: true, data: updatedRows[0] }
      }

      // 2) Si no existe fila, insertar con fallback de rounding_method
      const insertBase = {
        tenant_id: tenantId,
        ...payload,
        print_format: 'thermal'
      }

      const roundingCandidates = ['normal', 'NONE']
      let lastInsertError = null

      for (const roundingMethod of roundingCandidates) {
        const { data, error } = await supabaseService.client
          .from('tenant_settings')
          .insert({
            ...insertBase,
            rounding_method: roundingMethod
          })
          .select()
          .single()

        if (!error) {
          queryCache.invalidateByTags(['tenant-settings'], { tenantId })
          return { success: true, data }
        }

        lastInsertError = error
      }

      throw lastInsertError || new Error('No se pudo crear configuración de tenant_settings')
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async getSummary(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_accounting_summary', { p_tenant_id: tenantId })

      if (error) throw error
      return { success: true, data: data || {} }
    } catch (error) {
      return { success: false, error: error.message, data: {} }
    }
  }

  async getComplianceSnapshot(tenantId, filters = {}) {
    try {
      const period = {
        ...this.getDefaultPeriod(),
        ...filters
      }

      const fromDateTime = `${period.date_from}T00:00:00`
      const toDateTime = `${period.date_to}T23:59:59.999`

      const [
        salesRes,
        purchasesRes,
        entriesRes,
        providerRes,
        resolutionRes,
        queueCountRes
      ] = await Promise.all([
        supabaseService.client
          .from('sales')
          .select(`
            sale_id,
            subtotal,
            tax_total,
            total,
            status,
            invoice_type,
            dian_status,
            sold_at,
            third_party_id
          `)
          .eq('tenant_id', tenantId)
          .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
          .gte('sold_at', fromDateTime)
          .lte('sold_at', toDateTime),
        supabaseService.client
          .from('purchases')
          .select('purchase_id, total, created_at, supplier_id')
          .eq('tenant_id', tenantId)
          .gte('created_at', fromDateTime)
          .lte('created_at', toDateTime),
        supabaseService.client
          .from('accounting_entries')
          .select('entry_id, status, entry_date')
          .eq('tenant_id', tenantId)
          .gte('entry_date', period.date_from)
          .lte('entry_date', period.date_to),
        supabaseService.client
          .from('fe_provider_config')
          .select('provider_name, environment, is_active')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        supabaseService.client
          .from('invoice_resolutions')
          .select(`
            resolution_id,
            prefix,
            from_number,
            to_number,
            current_number,
            valid_from,
            valid_to,
            is_active
          `)
          .eq('tenant_id', tenantId)
          .eq('document_type', 'FE')
          .eq('is_active', true)
          .order('resolution_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseService.client
          .from('accounting_event_queue')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .in('status', ['PENDING', 'FAILED'])
      ])

      if (salesRes.error) throw salesRes.error
      if (purchasesRes.error) throw purchasesRes.error
      if (entriesRes.error) throw entriesRes.error
      if (providerRes.error) throw providerRes.error
      if (resolutionRes.error) throw resolutionRes.error
      if (queueCountRes.error) throw queueCountRes.error

      const sales = salesRes.data || []
      const purchases = purchasesRes.data || []
      const entries = entriesRes.data || []
      const provider = providerRes.data || null
      const resolution = resolutionRes.data || null
      const pendingQueueEvents = Number(queueCountRes.count || 0)

      const totals = {
        sales_subtotal: 0,
        sales_tax: 0,
        sales_total: 0,
        purchases_total: 0
      }

      sales.forEach((sale) => {
        totals.sales_subtotal += Number(sale.subtotal || 0)
        totals.sales_tax += Number(sale.tax_total || 0)
        totals.sales_total += Number(sale.total || 0)
      })

      purchases.forEach((purchase) => {
        totals.purchases_total += Number(purchase.total || 0)
      })

      const postedEntries = entries.filter((entry) => entry.status === 'POSTED').length
      const draftEntries = entries.filter((entry) => entry.status === 'DRAFT').length

      const feSales = sales.filter((sale) => sale.invoice_type === 'FE')
      const feAccepted = feSales.filter((sale) => sale.dian_status === 'ACCEPTED').length
      const feRejected = feSales.filter((sale) => sale.dian_status === 'REJECTED').length
      const feError = feSales.filter((sale) => sale.dian_status === 'ERROR').length
      const fePending = feSales.filter((sale) => ['PENDING', 'PROCESSING', null].includes(sale.dian_status)).length

      const thirdPartyIds = new Set(
        sales
          .map((sale) => sale.third_party_id)
          .filter(Boolean)
      )

      const supplierIds = new Set(
        purchases
          .map((purchase) => purchase.supplier_id)
          .filter(Boolean)
      )

      const counterpartyCount = new Set([...thirdPartyIds, ...supplierIds]).size

      const hasProvider = Boolean(provider?.is_active)
      const hasResolution = Boolean(resolution?.resolution_id)
      const readyFEConfig = hasProvider && hasResolution

      const resolutionProgress = resolution
        ? {
            prefix: resolution.prefix || '',
            current_number: Number(resolution.current_number || 0),
            from_number: Number(resolution.from_number || 0),
            to_number: Number(resolution.to_number || 0),
            used_percent: Number(resolution.to_number || 0) > Number(resolution.from_number || 0)
              ? Math.max(
                  0,
                  Math.min(
                    100,
                    (
                      ((Number(resolution.current_number || 0) - Number(resolution.from_number || 0)) /
                        (Number(resolution.to_number || 0) - Number(resolution.from_number || 0) + 1)) * 100
                    )
                  )
                )
              : 0,
            valid_from: resolution.valid_from || null,
            valid_to: resolution.valid_to || null
          }
        : null

      const obligations = [
        {
          key: 'dian_fe',
          name: 'Facturación Electrónica DIAN',
          frequency: 'Por operación',
          meaning: 'Emitir, validar y conservar facturas electrónicas con CUFE ante DIAN.',
          status: readyFEConfig ? (feRejected > 0 || feError > 0 ? 'ALERT' : 'READY') : 'PENDING',
          evidence: readyFEConfig
            ? `FE periodo: ${feSales.length} · Aceptadas: ${feAccepted} · Rechazadas/Error: ${feRejected + feError}`
            : 'Falta proveedor tecnológico o resolución activa.',
          route: '/tenant-config'
        },
        {
          key: 'iva',
          name: 'Declaración de IVA',
          frequency: 'Bimestral o cuatrimestral (según régimen)',
          meaning: 'Consolidar IVA generado en ventas e IVA descontable en compras.',
          status: totals.sales_tax > 0 || totals.purchases_total > 0 ? 'READY' : 'PENDING',
          evidence: `IVA ventas: ${totals.sales_tax.toFixed(2)} · Compras: ${totals.purchases_total.toFixed(2)}`,
          route: '/reports/financiero'
        },
        {
          key: 'books',
          name: 'Libros Contables (Diario y Mayor)',
          frequency: 'Mensual',
          meaning: 'Mantener asientos posteados y balanceados como soporte contable.',
          status: postedEntries > 0 ? (pendingQueueEvents > 0 ? 'ALERT' : 'READY') : 'PENDING',
          evidence: `Asientos posteados: ${postedEntries} · Borrador: ${draftEntries} · Cola pendiente: ${pendingQueueEvents}`,
          route: '/accounting/diario'
        },
        {
          key: 'withholding',
          name: 'Retención en la Fuente / ICA',
          frequency: 'Mensual',
          meaning: 'Controlar bases, conceptos y valores retenidos para declaración y pago.',
          status: 'PARTIAL',
          evidence: 'Disponible de forma asistida: revisar causación y parametrización tributaria específica del cliente.',
          route: '/accounting/retenciones'
        },
        {
          key: 'monthly_close',
          name: 'Cierre Contable Mensual',
          frequency: 'Mensual',
          meaning: 'Cerrar periodos y bloquear cambios para proteger consistencia contable y fiscal.',
          status: postedEntries > 0 ? 'PARTIAL' : 'PENDING',
          evidence: `Asientos posteados periodo: ${postedEntries}`,
          route: '/accounting/cierre'
        },
        {
          key: 'exogena',
          name: 'Información Exógena / Medios Magnéticos',
          frequency: 'Anual',
          meaning: 'Reportar operaciones con terceros de acuerdo con topes y conceptos DIAN.',
          status: counterpartyCount > 0 ? 'PARTIAL' : 'PENDING',
          evidence: `Terceros detectados en el periodo: ${counterpartyCount}`,
          route: '/third-parties'
        }
      ]

      const requiredReports = [
        {
          key: 'journal_book',
          name: 'Libro Diario',
          purpose: 'Detalle cronológico de asientos para revisión y soporte fiscal.',
          route: '/accounting/diario',
          status: postedEntries > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'ledger_book',
          name: 'Libro Mayor',
          purpose: 'Movimientos y saldo acumulado por cuenta contable.',
          route: '/accounting/mayor',
          status: postedEntries > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'trial_balance',
          name: 'Balanza de Comprobación',
          purpose: 'Control de cierre y validación de equilibrio contable.',
          route: '/accounting',
          status: postedEntries > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'financial_summary',
          name: 'Estado Financiero Resumido',
          purpose: 'Revisar ingresos, costo, utilidad, impuestos y margen del periodo.',
          route: '/reports/financiero',
          status: sales.length > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'sales_tax_report',
          name: 'Ventas e IVA',
          purpose: 'Soporte de declaración de IVA y conciliación comercial-fiscal.',
          route: '/reports/ventas',
          status: sales.length > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'cash_report',
          name: 'Caja y Flujo de Efectivo',
          purpose: 'Sustentar movimientos de caja y cruces contra contabilidad.',
          route: '/reports/cajas',
          status: 'READY'
        },
        {
          key: 'third_party_master',
          name: 'Maestro de Terceros',
          purpose: 'Base para reportes a DIAN, retenciones e información exógena.',
          route: '/third-parties',
          status: counterpartyCount > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'withholding_control',
          name: 'Control de Retenciones',
          purpose: 'Estimación operativa de retenciones y trazabilidad de configuración tributaria.',
          route: '/accounting/retenciones',
          status: purchases.length > 0 || sales.length > 0 ? 'PARTIAL' : 'PENDING'
        },
        {
          key: 'period_close_control',
          name: 'Cierre de Periodo',
          purpose: 'Controlar cierre mensual y bloqueo de asientos por periodo.',
          route: '/accounting/cierre',
          status: postedEntries > 0 ? 'PARTIAL' : 'PENDING'
        },
        {
          key: 'automation_console',
          name: 'Consola de Automatización',
          purpose: 'Reglas de contabilización automática y excepciones de integración.',
          route: '/accounting/automatizacion',
          status: pendingQueueEvents > 0 ? 'ALERT' : 'READY'
        },
        {
          key: 'manual_entries',
          name: 'Asientos Manuales',
          purpose: 'Registrar, postear o anular asientos manuales controlados por periodo.',
          route: '/accounting/asientos-manuales',
          status: draftEntries > 0 ? 'ALERT' : (postedEntries > 0 ? 'READY' : 'PENDING')
        },
        {
          key: 'chart_of_accounts',
          name: 'Plan de Cuentas',
          purpose: 'Administrar codificación, naturaleza y estado de cuentas contables.',
          route: '/accounting/plan-cuentas',
          status: 'READY'
        },
        {
          key: 'financial_statements_module',
          name: 'Estados Financieros',
          purpose: 'Consultar estado de resultados y balance general por periodo.',
          route: '/accounting/estados-financieros',
          status: postedEntries > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'tax_center',
          name: 'Centro Tributario',
          purpose: 'Consolidar IVA, retenciones y vista preliminar de exógena.',
          route: '/accounting/centro-tributario',
          status: sales.length > 0 || purchases.length > 0 ? 'READY' : 'PENDING'
        },
        {
          key: 'reconciliation',
          name: 'Conciliación Caja/Bancos',
          purpose: 'Cruzar cierres de caja contra saldos contables de caja y bancos.',
          route: '/accounting/conciliacion',
          status: pendingQueueEvents > 0 ? 'ALERT' : 'PARTIAL'
        },
        {
          key: 'ai_internal_control',
          name: 'Control Interno IA',
          purpose: 'Detectar asientos atípicos y priorizar acciones de auditoría.',
          route: '/accounting/control-ia',
          status: postedEntries > 0 ? 'PARTIAL' : 'PENDING'
        }
      ]

      const readinessScore = obligations.reduce((acc, obligation) => {
        if (obligation.status === 'READY') return acc + 1
        if (obligation.status === 'PARTIAL') return acc + 0.5
        return acc
      }, 0)

      return {
        success: true,
        data: {
          period,
          kpis: {
            sales_count: sales.length,
            sales_subtotal: totals.sales_subtotal,
            sales_tax: totals.sales_tax,
            sales_total: totals.sales_total,
            purchases_count: purchases.length,
            purchases_total: totals.purchases_total,
            posted_entries: postedEntries,
            draft_entries: draftEntries,
            pending_queue_events: pendingQueueEvents,
            fe_total: feSales.length,
            fe_accepted: feAccepted,
            fe_rejected: feRejected,
            fe_error: feError,
            fe_pending: fePending,
            counterparties: counterpartyCount
          },
          fe_configuration: {
            provider_name: provider?.provider_name || null,
            environment: provider?.environment || null,
            is_ready: readyFEConfig,
            resolution: resolutionProgress
          },
          obligations,
          required_reports: requiredReports,
          readiness_score: readinessScore,
          readiness_max: obligations.length
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  normalizeJournalEntries(entries = [], filters = {}) {
    const accountId = filters.account_id || null
    const search = String(filters.search || '').trim().toLowerCase()

    return (entries || [])
      .map((entry) => {
        const baseText = `${entry.entry_number || ''} ${entry.description || ''} ${entry.source_module || ''} ${entry.source_event || ''}`.toLowerCase()
        const entryMatch = !search || baseText.includes(search)

        const filteredLines = (entry.lines || [])
          .filter((line) => !accountId || line.account_id === accountId)
          .filter((line) => {
            if (!search || entryMatch) return true
            const lineText = `${line.description || ''} ${line.account?.code || ''} ${line.account?.name || ''}`.toLowerCase()
            return lineText.includes(search)
          })
          .sort((a, b) => Number(a.line_number || 0) - Number(b.line_number || 0))

        if (!filteredLines.length) return null
        return {
          ...entry,
          lines: filteredLines
        }
      })
      .filter(Boolean)
  }

  flattenJournalRows(entries = []) {
    const rows = []

    for (const entry of (entries || [])) {
      for (const line of (entry.lines || [])) {
        rows.push({
          entry_id: entry.entry_id,
          entry_number: entry.entry_number,
          entry_date: entry.entry_date,
          source_module: entry.source_module,
          source_event: entry.source_event,
          entry_description: entry.description || '',
          entry_status: entry.status,
          line_id: line.line_id,
          line_number: line.line_number,
          line_description: line.description || '',
          account_id: line.account_id,
          account_code: line.account?.code || '',
          account_name: line.account?.name || '',
          account_type: line.account?.account_type || '',
          natural_side: line.account?.natural_side || '',
          third_party_id: line.third_party_id || null,
          debit_amount: Number(line.debit_amount || 0),
          credit_amount: Number(line.credit_amount || 0)
        })
      }
    }

    return rows
  }

  async getJournalEntries(tenantId, filters = {}) {
    try {
      if (!tenantId) {
        return { success: false, error: 'tenant_id es requerido', data: null }
      }

      const limit = Math.max(1, Math.min(5000, Number(filters.limit || 1200)))

      let query = supabaseService.client
        .from('accounting_entries')
        .select(`
          entry_id,
          entry_number,
          entry_date,
          source_module,
          source_event,
          description,
          status,
          created_at,
          lines:accounting_entry_lines(
            line_id,
            line_number,
            account_id,
            third_party_id,
            description,
            debit_amount,
            credit_amount,
            account:account_id(
              account_id,
              code,
              name,
              account_type,
              natural_side
            )
          )
        `)
        .eq('tenant_id', tenantId)

      if (filters.date_from) query = query.gte('entry_date', filters.date_from)
      if (filters.date_to) query = query.lte('entry_date', filters.date_to)
      if (filters.status && filters.status !== 'ALL') query = query.eq('status', filters.status)
      if (filters.source_module && filters.source_module !== 'ALL') query = query.eq('source_module', filters.source_module)

      const { data, error } = await query
        .order('entry_date', { ascending: true })
        .order('entry_number', { ascending: true })
        .limit(limit)

      if (error) throw error

      const entries = this.normalizeJournalEntries(data || [], filters)
      const lines = this.flattenJournalRows(entries)

      const totals = lines.reduce(
        (acc, line) => {
          acc.debit += Number(line.debit_amount || 0)
          acc.credit += Number(line.credit_amount || 0)
          return acc
        },
        { debit: 0, credit: 0 }
      )

      return {
        success: true,
        data: {
          entries,
          lines,
          totals: {
            debit: totals.debit,
            credit: totals.credit,
            balanced: Math.round(totals.debit * 100) === Math.round(totals.credit * 100)
          }
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getLedgerReport(tenantId, filters = {}) {
    try {
      if (!tenantId) {
        return { success: false, error: 'tenant_id es requerido', data: null }
      }

      const accountId = filters.account_id || null
      if (!accountId) {
        return { success: false, error: 'account_id es requerido', data: null }
      }

      const { data: account, error: accountError } = await supabaseService.client
        .from('accounting_accounts')
        .select('account_id, code, name, account_type, natural_side, is_postable, is_active')
        .eq('tenant_id', tenantId)
        .eq('account_id', accountId)
        .maybeSingle()

      if (accountError) throw accountError
      if (!account) {
        return { success: false, error: 'Cuenta contable no encontrada', data: null }
      }

      const journalResult = await this.getJournalEntries(tenantId, {
        ...filters,
        account_id: accountId,
        status: filters.status || 'POSTED',
        limit: filters.limit || 2500
      })

      if (!journalResult.success) {
        return { success: false, error: journalResult.error, data: null }
      }

      const movementsBase = journalResult.data?.lines || []

      let openingBalance = 0
      if (filters.date_from) {
        const prevDate = new Date(`${filters.date_from}T00:00:00`)
        if (!Number.isNaN(prevDate.getTime())) {
          prevDate.setDate(prevDate.getDate() - 1)
          const cutoff = prevDate.toISOString().substring(0, 10)
          const trialResult = await this.getTrialBalance(tenantId, { date_from: null, date_to: cutoff })
          if (trialResult.success) {
            const prevAccount = (trialResult.data || []).find((row) => row.account_code === account.code)
            openingBalance = Number(prevAccount?.balance || 0)
          }
        }
      }

      let runningBalance = openingBalance
      const movements = movementsBase.map((line) => {
        const debit = Number(line.debit_amount || 0)
        const credit = Number(line.credit_amount || 0)
        const delta = account.natural_side === 'CREDIT'
          ? credit - debit
          : debit - credit

        runningBalance += delta

        return {
          ...line,
          delta,
          running_balance: runningBalance
        }
      })

      const totals = movements.reduce(
        (acc, line) => {
          acc.debit += Number(line.debit_amount || 0)
          acc.credit += Number(line.credit_amount || 0)
          return acc
        },
        { debit: 0, credit: 0 }
      )

      return {
        success: true,
        data: {
          account,
          opening_balance: openingBalance,
          closing_balance: runningBalance,
          total_debit: totals.debit,
          total_credit: totals.credit,
          movements,
          entry_count: new Set(movements.map((m) => m.entry_id)).size
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getTrialBalance(tenantId, filters = {}) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_accounting_trial_balance', {
          p_tenant_id: tenantId,
          p_date_from: filters.date_from || null,
          p_date_to: filters.date_to || null
        })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async getRecentEntries(tenantId, limit = 30) {
    try {
      const { data, error } = await supabaseService.client
        .from('accounting_entries')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async getEventQueue(tenantId, limit = 50) {
    try {
      const { data, error } = await supabaseService.client
        .from('accounting_event_queue')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async processQueue(tenantId, options = {}) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_accounting_process_queue', {
          p_tenant_id: tenantId,
          p_limit: Number(options.limit || 50),
          p_only_event_id: options.event_id || null
        })

      if (error) throw error
      return { success: true, data: data || {} }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getAccounts(tenantId, options = {}) {
    try {
      let query = supabaseService.client
        .from('accounting_accounts')
        .select('account_id, code, name, account_type, natural_side, is_postable, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('code', { ascending: true })

      if (options.onlyPostable) {
        query = query.eq('is_postable', true)
      }

      if (options.limit) {
        query = query.limit(options.limit)
      }

      const { data, error } = await query
      if (error) throw error

      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async getWithholdingConfigs(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('accounting_withholding_configs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('code', { ascending: true })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async saveWithholdingConfig(tenantId, config = {}) {
    try {
      const payload = {
        tenant_id: tenantId,
        code: String(config.code || '').trim().toUpperCase(),
        name: String(config.name || '').trim(),
        applies_to: config.applies_to || 'PURCHASES',
        rate: Number(config.rate || 0),
        base_threshold: Number(config.base_threshold || 0),
        account_code: config.account_code ? String(config.account_code).trim() : null,
        is_active: config.is_active !== false,
        updated_at: new Date().toISOString()
      }

      if (!payload.code || !payload.name) {
        return { success: false, error: 'code y name son requeridos' }
      }

      let query = supabaseService.client
        .from('accounting_withholding_configs')
        .upsert(
          config.config_id
            ? { ...payload, config_id: config.config_id }
            : payload,
          { onConflict: config.config_id ? 'config_id' : 'tenant_id,code' }
        )
        .select()
        .limit(1)

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: Array.isArray(data) ? data[0] : data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async getWithholdingSummary(tenantId, filters = {}) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_accounting_get_withholding_summary', {
          p_tenant_id: tenantId,
          p_date_from: filters.date_from || null,
          p_date_to: filters.date_to || null
        })

      if (error) throw error
      if (!data?.success) {
        return { success: false, error: data?.message || 'No se pudo calcular resumen de retenciones', data }
      }
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getPeriodClosures(tenantId, options = {}) {
    try {
      let query = supabaseService.client
        .from('accounting_period_closures')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(options.limit || 48)

      if (options.year) {
        query = query.eq('period_year', Number(options.year))
      }

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async closePeriod(tenantId, params = {}) {
    try {
      const year = Number(params.year)
      const month = Number(params.month)

      const { data, error } = await supabaseService.client
        .rpc('fn_accounting_close_period', {
          p_tenant_id: tenantId,
          p_year: year,
          p_month: month,
          p_notes: params.notes || null
        })

      if (error) throw error
      if (!data?.success) {
        return { success: false, error: data?.message || 'No se pudo cerrar el periodo', data }
      }
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async reopenPeriod(tenantId, params = {}) {
    try {
      const year = Number(params.year)
      const month = Number(params.month)

      const { data, error } = await supabaseService.client
        .rpc('fn_accounting_open_period', {
          p_tenant_id: tenantId,
          p_year: year,
          p_month: month,
          p_notes: params.notes || null
        })

      if (error) {
        // Backward compatibility: old deployments may only have reopen RPC.
        const fallback = await supabaseService.client
          .rpc('fn_accounting_reopen_period', {
            p_tenant_id: tenantId,
            p_year: year,
            p_month: month,
            p_notes: params.notes || null
          })

        if (fallback.error) throw fallback.error
        const fallbackData = fallback.data
        if (!fallbackData?.success) {
          return { success: false, error: fallbackData?.message || 'No se pudo abrir el periodo', data: fallbackData }
        }
        return { success: true, data: fallbackData }
      }

      if (!data?.success) {
        return { success: false, error: data?.message || 'No se pudo abrir el periodo', data }
      }
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getPostingRules(tenantId, filters = {}) {
    try {
      let query = supabaseService.client
        .from('accounting_posting_rules')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })

      if (filters.source_module && filters.source_module !== 'ALL') {
        query = query.eq('source_module', filters.source_module)
      }
      if (filters.event_type && filters.event_type !== 'ALL') {
        query = query.eq('event_type', filters.event_type)
      }

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async savePostingRule(tenantId, rule = {}) {
    try {
      const payload = {
        tenant_id: tenantId,
        source_module: String(rule.source_module || '').trim().toUpperCase(),
        event_type: String(rule.event_type || '').trim().toUpperCase(),
        rule_name: String(rule.rule_name || '').trim(),
        debit_account_code: String(rule.debit_account_code || '').trim(),
        credit_account_code: String(rule.credit_account_code || '').trim(),
        description_template: String(rule.description_template || '').trim(),
        auto_post: rule.auto_post !== false,
        priority: Number(rule.priority || 100),
        is_active: rule.is_active !== false,
        updated_at: new Date().toISOString()
      }

      if (!payload.source_module || !payload.event_type || !payload.rule_name) {
        return { success: false, error: 'source_module, event_type y rule_name son requeridos' }
      }
      if (!payload.debit_account_code || !payload.credit_account_code) {
        return { success: false, error: 'debit_account_code y credit_account_code son requeridos' }
      }

      const { data, error } = await supabaseService.client
        .from('accounting_posting_rules')
        .upsert(
          rule.rule_id
            ? { ...payload, rule_id: rule.rule_id }
            : payload,
          { onConflict: rule.rule_id ? 'rule_id' : 'tenant_id,source_module,event_type,rule_name' }
        )
        .select()
        .limit(1)

      if (error) throw error
      return { success: true, data: Array.isArray(data) ? data[0] : data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getAutomationExceptions(tenantId, options = {}) {
    try {
      let query = supabaseService.client
        .from('accounting_automation_exceptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(options.limit || 100)

      if (options.status && options.status !== 'ALL') {
        query = query.eq('status', options.status)
      }

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async resolveAutomationException(tenantId, exception) {
    try {
      const exceptionId = typeof exception === 'string' ? exception : exception?.exception_id
      if (!exceptionId) {
        return { success: false, error: 'exception_id es requerido' }
      }

      const { data, error } = await supabaseService.client
        .from('accounting_automation_exceptions')
        .update({
          status: 'RESOLVED',
          resolved_at: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)
        .eq('exception_id', exceptionId)
        .select()
        .limit(1)

      if (error) throw error
      return { success: true, data: Array.isArray(data) ? data[0] : data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getCurrentUserProfile() {
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      const authUserId = authData?.user?.id
      if (!authUserId) return { success: false, error: 'Usuario no autenticado', data: null }

      const { data, error } = await supabaseService.client
        .from('users')
        .select('user_id, tenant_id, full_name, email')
        .eq('auth_user_id', authUserId)
        .maybeSingle()

      if (error) throw error
      if (!data?.user_id) return { success: false, error: 'Perfil de usuario no encontrado', data: null }
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getManualEntries(tenantId, filters = {}) {
    return this.getJournalEntries(tenantId, {
      ...filters,
      source_module: 'MANUAL',
      limit: filters.limit || 1000
    })
  }

  async createManualEntry(tenantId, payload = {}) {
    try {
      const entryDate = payload.entry_date || new Date().toISOString().substring(0, 10)
      const description = String(payload.description || '').trim()
      const lines = Array.isArray(payload.lines) ? payload.lines : []

      if (lines.length < 2) {
        return { success: false, error: 'El asiento debe tener al menos dos lineas.' }
      }

      let totalDebit = 0
      let totalCredit = 0
      for (const line of lines) {
        const debit = Number(line.debit_amount || 0)
        const credit = Number(line.credit_amount || 0)
        totalDebit += debit
        totalCredit += credit

        if (!line.account_id) {
          return { success: false, error: 'Todas las lineas deben tener cuenta contable.' }
        }
        if ((debit > 0 && credit > 0) || (debit <= 0 && credit <= 0)) {
          return { success: false, error: 'Cada linea debe tener solo debito o solo credito.' }
        }
      }

      if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
        return { success: false, error: 'El asiento no esta balanceado.' }
      }

      const userResult = await this.getCurrentUserProfile()
      if (!userResult.success) return userResult

      const profile = userResult.data

      const { data: entryRows, error: entryError } = await supabaseService.client
        .from('accounting_entries')
        .insert({
          tenant_id: tenantId,
          entry_date: entryDate,
          source_module: 'MANUAL',
          source_event: 'MANUAL_ENTRY',
          description: description || 'Asiento manual',
          status: 'DRAFT',
          created_by: profile.user_id
        })
        .select('*')
        .limit(1)

      if (entryError) throw entryError

      const entry = Array.isArray(entryRows) ? entryRows[0] : entryRows
      if (!entry?.entry_id) {
        return { success: false, error: 'No se pudo crear la cabecera del asiento.' }
      }

      const linesPayload = lines.map((line, index) => ({
        entry_id: entry.entry_id,
        tenant_id: tenantId,
        line_number: index + 1,
        account_id: line.account_id,
        third_party_id: line.third_party_id || null,
        description: String(line.description || '').trim() || null,
        debit_amount: Number(line.debit_amount || 0),
        credit_amount: Number(line.credit_amount || 0),
        cost_center: line.cost_center ? String(line.cost_center).trim() : null
      }))

      const { error: linesError } = await supabaseService.client
        .from('accounting_entry_lines')
        .insert(linesPayload)

      if (linesError) {
        await supabaseService.client
          .from('accounting_entries')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('entry_id', entry.entry_id)
        throw linesError
      }

      return { success: true, data: entry }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async postEntry(tenantId, entryId, postedBy = null) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('fn_accounting_post_entry', {
          p_tenant_id: tenantId,
          p_entry_id: entryId,
          p_posted_by: postedBy || null
        })

      if (error) throw error
      if (!data?.success) {
        return { success: false, error: data?.message || 'No se pudo postear el asiento', data }
      }
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async voidDraftEntry(tenantId, entryId, reason = '') {
    try {
      const { data, error } = await supabaseService.client
        .from('accounting_entries')
        .update({
          status: 'VOIDED',
          description: reason
            ? `ANULADO: ${String(reason).trim()}`
            : undefined
        })
        .eq('tenant_id', tenantId)
        .eq('entry_id', entryId)
        .eq('status', 'DRAFT')
        .select('*')
        .limit(1)

      if (error) throw error
      if (!data || data.length === 0) {
        return { success: false, error: 'Solo se pueden anular asientos en borrador.' }
      }
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getChartOfAccounts(tenantId, options = {}) {
    try {
      let query = supabaseService.client
        .from('accounting_accounts')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('code', { ascending: true })

      if (!options.includeInactive) {
        query = query.eq('is_active', true)
      }

      const { data, error } = await query
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async saveAccount(tenantId, account = {}) {
    try {
      const payload = {
        tenant_id: tenantId,
        code: String(account.code || '').trim(),
        name: String(account.name || '').trim(),
        account_class: String(account.account_class || '').trim(),
        account_type: String(account.account_type || '').trim().toUpperCase(),
        natural_side: String(account.natural_side || '').trim().toUpperCase(),
        parent_account_id: account.parent_account_id || null,
        is_postable: account.is_postable !== false,
        is_active: account.is_active !== false,
        is_system: Boolean(account.is_system)
      }

      if (!payload.code || !payload.name || !payload.account_class || !payload.account_type || !payload.natural_side) {
        return { success: false, error: 'code, name, account_class, account_type y natural_side son requeridos.' }
      }

      if (account.account_id) {
        const { data, error } = await supabaseService.client
          .from('accounting_accounts')
          .update(payload)
          .eq('tenant_id', tenantId)
          .eq('account_id', account.account_id)
          .select('*')
          .limit(1)

        if (error) throw error
        return { success: true, data: Array.isArray(data) ? data[0] : data }
      }

      const { data, error } = await supabaseService.client
        .from('accounting_accounts')
        .insert(payload)
        .select('*')
        .limit(1)

      if (error) throw error
      return { success: true, data: Array.isArray(data) ? data[0] : data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async toggleAccountActive(tenantId, accountId, isActive) {
    try {
      const { data, error } = await supabaseService.client
        .from('accounting_accounts')
        .update({ is_active: Boolean(isActive) })
        .eq('tenant_id', tenantId)
        .eq('account_id', accountId)
        .select('*')
        .limit(1)

      if (error) throw error
      return { success: true, data: Array.isArray(data) ? data[0] : data }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getFinancialStatements(tenantId, filters = {}) {
    try {
      const trial = await this.getTrialBalance(tenantId, filters)
      if (!trial.success) return trial

      const rows = trial.data || []
      const byType = {
        ASSET: [],
        LIABILITY: [],
        EQUITY: [],
        INCOME: [],
        COST: [],
        EXPENSE: []
      }

      const signedValue = (row) => {
        const debit = Number(row.debit_total || 0)
        const credit = Number(row.credit_total || 0)
        return row.natural_side === 'CREDIT' ? credit - debit : debit - credit
      }

      rows.forEach((row) => {
        const type = String(row.account_type || '').toUpperCase()
        if (byType[type]) {
          byType[type].push({
            ...row,
            signed_amount: signedValue(row)
          })
        }
      })

      const sumSigned = (items) => items.reduce((acc, item) => acc + Number(item.signed_amount || 0), 0)
      const totalAssets = sumSigned(byType.ASSET)
      const totalLiabilities = sumSigned(byType.LIABILITY)
      const totalEquity = sumSigned(byType.EQUITY)
      const totalIncome = sumSigned(byType.INCOME)
      const totalCost = sumSigned(byType.COST)
      const totalExpense = sumSigned(byType.EXPENSE)
      const netProfit = totalIncome - totalCost - totalExpense

      return {
        success: true,
        data: {
          period: {
            date_from: filters.date_from || null,
            date_to: filters.date_to || null
          },
          income_statement: {
            income: totalIncome,
            cost: totalCost,
            expense: totalExpense,
            net_profit: netProfit,
            details: {
              income: byType.INCOME,
              cost: byType.COST,
              expense: byType.EXPENSE
            }
          },
          balance_sheet: {
            assets: totalAssets,
            liabilities: totalLiabilities,
            equity: totalEquity,
            retained_earnings_current: netProfit,
            liabilities_plus_equity: totalLiabilities + totalEquity + netProfit,
            details: {
              assets: byType.ASSET,
              liabilities: byType.LIABILITY,
              equity: byType.EQUITY
            }
          }
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getTaxCenterData(tenantId, filters = {}) {
    try {
      const period = {
        ...this.getDefaultPeriod(),
        ...filters
      }

      const fromDateTime = `${period.date_from}T00:00:00`
      const toDateTime = `${period.date_to}T23:59:59.999`

      const [salesRes, purchasesRes, withholdingRes] = await Promise.all([
        supabaseService.client
          .from('sales')
          .select('sale_id, sold_at, third_party_id, subtotal, tax_total, total, status')
          .eq('tenant_id', tenantId)
          .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
          .gte('sold_at', fromDateTime)
          .lte('sold_at', toDateTime),
        supabaseService.client
          .from('purchases')
          .select('purchase_id, created_at, supplier_id, total')
          .eq('tenant_id', tenantId)
          .gte('created_at', fromDateTime)
          .lte('created_at', toDateTime),
        this.getWithholdingSummary(tenantId, period)
      ])

      if (salesRes.error) throw salesRes.error
      if (purchasesRes.error) throw purchasesRes.error
      if (!withholdingRes.success) {
        return { success: false, error: withholdingRes.error || 'No se pudo cargar retenciones.', data: null }
      }

      const sales = salesRes.data || []
      const purchases = purchasesRes.data || []

      const ivaGenerated = sales.reduce((acc, row) => acc + Number(row.tax_total || 0), 0)
      const ivaPurchasesBase = purchases.reduce((acc, row) => acc + Number(row.total || 0), 0)

      const byCounterparty = new Map()
      sales.forEach((sale) => {
        const key = sale.third_party_id || 'CONSUMIDOR_FINAL'
        if (!byCounterparty.has(key)) {
          byCounterparty.set(key, {
            counterparty_id: key,
            sales_total: 0,
            purchases_total: 0,
            operations_count: 0
          })
        }
        const current = byCounterparty.get(key)
        current.sales_total += Number(sale.total || 0)
        current.operations_count += 1
      })
      purchases.forEach((purchase) => {
        const key = purchase.supplier_id || 'SUPPLIER_UNDEFINED'
        if (!byCounterparty.has(key)) {
          byCounterparty.set(key, {
            counterparty_id: key,
            sales_total: 0,
            purchases_total: 0,
            operations_count: 0
          })
        }
        const current = byCounterparty.get(key)
        current.purchases_total += Number(purchase.total || 0)
        current.operations_count += 1
      })

      const exogenaPreview = Array.from(byCounterparty.values())
        .map((row) => ({
          ...row,
          grand_total: Number(row.sales_total || 0) + Number(row.purchases_total || 0)
        }))
        .sort((a, b) => b.grand_total - a.grand_total)

      return {
        success: true,
        data: {
          period,
          iva: {
            generated: ivaGenerated,
            deductible_estimated: 0,
            purchases_base_reference: ivaPurchasesBase,
            payable_estimated: ivaGenerated
          },
          withholdings: withholdingRes.data || { items: [], kpis: {} },
          exogena_preview: exogenaPreview
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getCloseChecklist(tenantId, filters = {}) {
    try {
      const period = {
        ...this.getDefaultPeriod(),
        ...filters
      }

      const fromDate = period.date_from
      const toDate = period.date_to

      const [entriesRes, queueRes, exceptionsRes, trialRes] = await Promise.all([
        supabaseService.client
          .from('accounting_entries')
          .select('entry_id, status, entry_date')
          .eq('tenant_id', tenantId)
          .gte('entry_date', fromDate)
          .lte('entry_date', toDate),
        supabaseService.client
          .from('accounting_event_queue')
          .select('event_id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .in('status', ['PENDING', 'FAILED']),
        supabaseService.client
          .from('accounting_automation_exceptions')
          .select('exception_id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'OPEN'),
        this.getTrialBalance(tenantId, { date_from: fromDate, date_to: toDate })
      ])

      if (entriesRes.error) throw entriesRes.error
      if (queueRes.error) throw queueRes.error
      if (exceptionsRes.error) throw exceptionsRes.error
      if (!trialRes.success) return trialRes

      const entries = entriesRes.data || []
      const drafts = entries.filter((entry) => entry.status === 'DRAFT').length
      const voided = entries.filter((entry) => entry.status === 'VOIDED').length
      const posted = entries.filter((entry) => entry.status === 'POSTED').length
      const pendingQueue = Number(queueRes.count || 0)
      const openExceptions = Number(exceptionsRes.count || 0)
      const trialRows = trialRes.data || []
      const hasMovements = trialRows.some((row) => Number(row.debit_total || 0) > 0 || Number(row.credit_total || 0) > 0)

      const checks = [
        {
          key: 'draft_entries',
          title: 'Sin asientos en borrador',
          status: drafts === 0 ? 'PASS' : 'WARN',
          value: drafts,
          detail: drafts === 0 ? 'No hay borradores pendientes.' : `Hay ${drafts} asientos en DRAFT.`
        },
        {
          key: 'pending_queue',
          title: 'Cola contable al dia',
          status: pendingQueue === 0 ? 'PASS' : 'WARN',
          value: pendingQueue,
          detail: pendingQueue === 0 ? 'Sin eventos pendientes/fallidos.' : `${pendingQueue} eventos pendientes/fallidos.`
        },
        {
          key: 'automation_exceptions',
          title: 'Excepciones de automatizacion resueltas',
          status: openExceptions === 0 ? 'PASS' : 'WARN',
          value: openExceptions,
          detail: openExceptions === 0 ? 'No hay excepciones abiertas.' : `${openExceptions} excepciones abiertas.`
        },
        {
          key: 'posted_entries',
          title: 'Movimiento contable del periodo',
          status: posted > 0 && hasMovements ? 'PASS' : 'WARN',
          value: posted,
          detail: posted > 0 ? `${posted} asientos posteados en el periodo.` : 'No hay asientos posteados en el periodo.'
        },
        {
          key: 'voided_entries',
          title: 'Asientos anulados controlados',
          status: 'INFO',
          value: voided,
          detail: `${voided} asientos anulados (revisar soporte documental).`
        }
      ]

      return {
        success: true,
        data: {
          period,
          checks
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async getReconciliationSnapshot(tenantId, filters = {}) {
    try {
      const period = {
        ...this.getDefaultPeriod(),
        ...filters
      }

      const fromDateTime = `${period.date_from}T00:00:00`
      const toDateTime = `${period.date_to}T23:59:59.999`

      const [cashSessionsRes, accountsRes] = await Promise.all([
        supabaseService.client
          .from('cash_sessions')
          .select('cash_session_id, opening_amount, closing_amount_expected, closing_amount_counted, difference, status, opened_at, closed_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'CLOSED')
          .gte('opened_at', fromDateTime)
          .lte('opened_at', toDateTime),
        this.getAccounts(tenantId, { onlyPostable: true, limit: 5000 })
      ])

      if (cashSessionsRes.error) throw cashSessionsRes.error
      if (!accountsRes.success) return accountsRes

      const sessions = cashSessionsRes.data || []
      const cashExpected = sessions.reduce((acc, row) => acc + Number(row.closing_amount_expected || 0), 0)
      const cashCounted = sessions.reduce((acc, row) => acc + Number(row.closing_amount_counted || 0), 0)
      const cashDifference = sessions.reduce((acc, row) => acc + Number(row.difference || 0), 0)

      const candidateAccounts = (accountsRes.data || []).filter((account) => String(account.code || '').startsWith('11'))
      const ledgerBalances = []

      for (const account of candidateAccounts.slice(0, 25)) {
        const ledgerResult = await this.getLedgerReport(tenantId, {
          account_id: account.account_id,
          date_from: period.date_from,
          date_to: period.date_to,
          status: 'POSTED',
          limit: 2500
        })
        if (!ledgerResult.success || !ledgerResult.data) continue
        ledgerBalances.push({
          account_id: account.account_id,
          account_code: account.code,
          account_name: account.name,
          closing_balance: Number(ledgerResult.data.closing_balance || 0)
        })
      }

      const ledgerCashBalance = ledgerBalances.reduce((acc, row) => acc + Number(row.closing_balance || 0), 0)

      return {
        success: true,
        data: {
          period,
          cash_sessions: sessions,
          ledger_cash_accounts: ledgerBalances,
          kpis: {
            sessions_closed: sessions.length,
            cash_expected_total: cashExpected,
            cash_counted_total: cashCounted,
            cash_difference_total: cashDifference,
            ledger_cash_balance: ledgerCashBalance,
            reconciliation_gap: cashCounted - ledgerCashBalance
          }
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async seedAdvancedPostingRules(tenantId) {
    try {
      const suggestedRules = [
        {
          source_module: 'POS',
          event_type: 'SALE_RETURNED',
          rule_name: 'Reversion venta',
          debit_account_code: '413595',
          credit_account_code: '110505',
          description_template: 'Reversion automatica venta {{source_id}}',
          auto_post: true,
          priority: 80,
          is_active: true
        },
        {
          source_module: 'PURCHASES',
          event_type: 'PURCHASE_RETURNED',
          rule_name: 'Reversion compra',
          debit_account_code: '220505',
          credit_account_code: '143505',
          description_template: 'Reversion automatica compra {{source_id}}',
          auto_post: true,
          priority: 80,
          is_active: true
        },
        {
          source_module: 'CASH',
          event_type: 'CASH_EXPENSE_CREATED',
          rule_name: 'Gasto de caja',
          debit_account_code: '513530',
          credit_account_code: '110505',
          description_template: 'Gasto de caja {{source_id}}',
          auto_post: true,
          priority: 100,
          is_active: true
        },
        {
          source_module: 'CASH',
          event_type: 'CASH_INCOME_CREATED',
          rule_name: 'Ingreso de caja',
          debit_account_code: '110505',
          credit_account_code: '429595',
          description_template: 'Ingreso de caja {{source_id}}',
          auto_post: true,
          priority: 100,
          is_active: true
        }
      ]

      const results = []
      for (const rule of suggestedRules) {
        const result = await this.savePostingRule(tenantId, rule)
        if (!result.success) {
          results.push({ ...rule, success: false, error: result.error })
        } else {
          results.push({ ...rule, success: true })
        }
      }

      const failed = results.filter((item) => !item.success)
      return {
        success: failed.length === 0,
        data: {
          total: results.length,
          created_or_updated: results.length - failed.length,
          failed: failed.length,
          details: results
        },
        error: failed.length ? 'Algunas reglas no pudieron guardarse.' : null
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async detectAccountingAnomalies(tenantId, filters = {}) {
    try {
      const result = await this.getJournalEntries(tenantId, {
        ...filters,
        status: 'POSTED',
        limit: filters.limit || 2000
      })

      if (!result.success) return result

      const lines = result.data?.lines || []
      if (!lines.length) {
        return { success: true, data: { anomalies: [], sample_size: 0 } }
      }

      const byAccount = new Map()
      for (const line of lines) {
        const key = line.account_code || 'NO_CODE'
        if (!byAccount.has(key)) byAccount.set(key, [])
        byAccount.get(key).push(Math.abs(Number(line.debit_amount || 0) - Number(line.credit_amount || 0)))
      }

      const stats = new Map()
      for (const [code, values] of byAccount.entries()) {
        const avg = values.reduce((acc, v) => acc + v, 0) / Math.max(1, values.length)
        const variance = values.reduce((acc, v) => acc + ((v - avg) ** 2), 0) / Math.max(1, values.length)
        const std = Math.sqrt(variance)
        stats.set(code, { avg, std })
      }

      const anomalies = []
      for (const line of lines) {
        const code = line.account_code || 'NO_CODE'
        const magnitude = Math.abs(Number(line.debit_amount || 0) - Number(line.credit_amount || 0))
        const accountStats = stats.get(code) || { avg: 0, std: 0 }
        const zScore = accountStats.std > 0 ? (magnitude - accountStats.avg) / accountStats.std : 0
        const suspicious = zScore >= 3 || magnitude >= accountStats.avg * 4
        if (!suspicious) continue

        anomalies.push({
          entry_id: line.entry_id,
          entry_number: line.entry_number,
          entry_date: line.entry_date,
          account_code: line.account_code,
          account_name: line.account_name,
          source_module: line.source_module,
          line_description: line.line_description || line.entry_description || '-',
          debit_amount: Number(line.debit_amount || 0),
          credit_amount: Number(line.credit_amount || 0),
          magnitude,
          z_score: Number(zScore.toFixed(2))
        })
      }

      anomalies.sort((a, b) => b.magnitude - a.magnitude)

      return {
        success: true,
        data: {
          sample_size: lines.length,
          anomalies: anomalies.slice(0, 200)
        }
      }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async requestAIAnomalyInsights({ tenantId, anomalies = [] }) {
    try {
      const items = (anomalies || []).slice(0, 30)
      if (!items.length) {
        return { success: false, error: 'No hay anomalias para analizar.' }
      }

      const payload = items.map((item) => ({
        entry_number: item.entry_number,
        entry_date: item.entry_date,
        source_module: item.source_module,
        account_code: item.account_code,
        account_name: item.account_name,
        debit_amount: item.debit_amount,
        credit_amount: item.credit_amount,
        z_score: item.z_score,
        magnitude: item.magnitude,
        description: item.line_description
      }))

      const messages = [
        {
          role: 'system',
          content: 'Eres auditor contable senior para Colombia. Responde SOLO JSON valido.'
        },
        {
          role: 'user',
          content: `Analiza estas lineas atipicas y responde SOLO JSON:
{
  "summary": "string",
  "risk_level": "LOW|MEDIUM|HIGH",
  "top_findings": [{"finding":"string","reason":"string","entry_number":"string"}],
  "recommended_actions": ["string"]
}

Datos:
${JSON.stringify(payload, null, 2)}`
        }
      ]

      const { data, error } = await supabase.functions.invoke(AI_EDGE_FUNCTION, {
        body: {
          model: AI_MODEL,
          messages,
          temperature: 0.1,
          max_tokens: 1400
        }
      })

      if (error) throw error

      const content = data?.content || ''
      const parsed = typeof content === 'object' ? content : extractJsonBlock(content)
      if (!parsed) {
        return {
          success: false,
          error: 'La IA respondio en un formato no interpretable.',
          raw: content
        }
      }
      return { success: true, data: parsed, raw: content }
    } catch (error) {
      return { success: false, error: error.message, data: null }
    }
  }

  async requestAIAssistant({ tenantId, prompt }) {
    try {
      const userPrompt = String(prompt || '').trim()
      if (!userPrompt) {
        return { success: false, error: 'Escribe el contexto del asiento a proponer.' }
      }

      const accountsResult = await this.getAccounts(tenantId, { onlyPostable: true, limit: 60 })
      if (!accountsResult.success) {
        return { success: false, error: accountsResult.error || 'No se pudo cargar el plan de cuentas.' }
      }

      const catalog = accountsResult.data.map((a) => `${a.code} - ${a.name} (${a.natural_side})`).join('\n')

      const messages = [
        {
          role: 'system',
          content: 'Eres un asistente contable experto en Colombia (PUC). Responde SOLO JSON válido, sin markdown.'
        },
        {
          role: 'user',
          content: `Con base en este contexto de negocio, propone un borrador de asiento contable para POS.

Contexto:\n${userPrompt}

Plan de cuentas disponible:\n${catalog}

Responde EXCLUSIVAMENTE JSON con esta forma:
{
  "summary": "string",
  "confidence": 0.0,
  "warnings": ["string"],
  "entry": {
    "entry_date": "YYYY-MM-DD",
    "description": "string",
    "lines": [
      {
        "account_code": "string",
        "account_name": "string",
        "debit_amount": 0,
        "credit_amount": 0,
        "reason": "string"
      }
    ]
  }
}

Reglas:
- Debe quedar balanceado (sum(debit)=sum(credit)).
- No inventes cuentas fuera del catálogo.
- Si no hay suficiente contexto, baja confidence y agrega warnings.
`
        }
      ]

      const { data, error } = await supabase.functions.invoke(AI_EDGE_FUNCTION, {
        body: {
          model: AI_MODEL,
          messages,
          temperature: 0.15,
          max_tokens: 1800
        }
      })

      if (error) throw error

      const content = data?.content || ''
      const parsed = typeof content === 'object' ? content : extractJsonBlock(content)

      if (!parsed) {
        return {
          success: false,
          error: 'La IA respondió, pero no en formato JSON utilizable.',
          raw: content
        }
      }

      return { success: true, data: parsed, raw: content }
    } catch (error) {
      return {
        success: false,
        error: error?.message || 'No se pudo generar sugerencia IA.'
      }
    }
  }
}

export default new AccountingService()
