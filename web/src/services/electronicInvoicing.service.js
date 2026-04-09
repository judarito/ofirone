/**
 * electronicInvoicing.service.js
 * ------------------------------------------------------------------
 * Servicio DUAL para facturación electrónica DIAN Colombia.
 *
 * Modo POS normal  → electronic_invoicing_enabled = false
 *   submitInvoice() devuelve { success: true, mode: 'pos' } sin llamar a nadie.
 *
 * Modo FE habilitado → electronic_invoicing_enabled = true
 *   submitInvoice() construye el payload y llama al proveedor tecnológico
 *   configurado en fe_provider_config, luego persiste el CUFE + estado en sales.
 * ------------------------------------------------------------------
 */
import supabaseService from './supabase.service'

class ElectronicInvoicingService {
  // ----------------------------------------------------------------
  // CONFIGURACIÓN DEL PROVEEDOR TECNOLÓGICO
  // ----------------------------------------------------------------

  /** Obtiene la configuración del proveedor tecnológico del tenant */
  async getProviderConfig (tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('fe_provider_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (error) throw error
      return { success: true, data: data || null }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /** Crea o actualiza (upsert por tenant_id) la configuración del proveedor */
  async saveProviderConfig (tenantId, payload) {
    try {
      const record = {
        tenant_id:      tenantId,
        provider_name:  payload.provider_name  || '',
        base_url:       (payload.base_url || '').replace(/\/$/, ''), // sin barra al final
        auth_type:      payload.auth_type      || 'apikey',
        auth_header:    payload.auth_header    || 'X-API-Key',
        api_key:        payload.api_key        || null,
        software_id:    payload.software_id    || null,
        software_pin:   payload.software_pin   || null,
        environment:    payload.environment    || 'habilitacion',
        test_set_id:    payload.test_set_id    || null,
        timeout_seconds: payload.timeout_seconds || 30,
        is_active:      payload.is_active !== false,
        updated_at:     new Date().toISOString()
      }

      const { data, error } = await supabaseService.client
        .from('fe_provider_config')
        .upsert(record, { onConflict: 'tenant_id' })
        .select()
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ----------------------------------------------------------------
  // RESOLUCIONES DIAN
  // ----------------------------------------------------------------

  /** Lista todas las resoluciones del tenant */
  async getResolutions (tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('invoice_resolutions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('is_active', { ascending: false })
        .order('resolution_date', { ascending: false })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /** Resolución activa para un tipo de documento */
  async getActiveResolution (tenantId, documentType = 'FE') {
    try {
      const { data, error } = await supabaseService.client
        .from('invoice_resolutions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('document_type', documentType)
        .eq('is_active', true)
        .order('resolution_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return { success: true, data: data || null }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /** Crea o actualiza una resolución */
  async upsertResolution (tenantId, payload) {
    try {
      const record = {
        tenant_id:         tenantId,
        document_type:     payload.document_type  || 'FE',
        prefix:            payload.prefix          || '',
        from_number:       payload.from_number     || 1,
        to_number:         payload.to_number       || 1000,
        current_number:    payload.current_number  ?? 0,
        resolution_number: payload.resolution_number || null,
        resolution_date:   payload.resolution_date   || null,
        valid_from:        payload.valid_from         || null,
        valid_to:          payload.valid_to           || null,
        technical_key:     payload.technical_key      || null,
        is_active:         payload.is_active !== false,
        updated_at:        new Date().toISOString()
      }

      if (payload.resolution_id) {
        // UPDATE
        const { data, error } = await supabaseService.client
          .from('invoice_resolutions')
          .update(record)
          .eq('resolution_id', payload.resolution_id)
          .eq('tenant_id', tenantId)
          .select()
          .single()
        if (error) throw error
        return { success: true, data }
      } else {
        // INSERT
        const { data, error } = await supabaseService.client
          .from('invoice_resolutions')
          .insert(record)
          .select()
          .single()
        if (error) throw error
        return { success: true, data }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /** Elimina una resolución (solo si no tiene documentos asociados) */
  async deleteResolution (tenantId, resolutionId) {
    try {
      const { error } = await supabaseService.client
        .from('invoice_resolutions')
        .delete()
        .eq('resolution_id', resolutionId)
        .eq('tenant_id', tenantId)
      if (error) throw error
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ----------------------------------------------------------------
  // ENVÍO AL PROVEEDOR TECNOLÓGICO (lógica dual)
  // ----------------------------------------------------------------

  /**
   * Envía una venta al proveedor tecnológico para obtener CUFE.
   *
   * @param {string} saleId  - ID de la venta (sale_id)
   * @param {string} tenantId
   * @param {boolean} feEnabled - Viene de settings.electronic_invoicing_enabled
   * @returns {{ success, mode, cufe, qrUrl, status, error }}
   */
  async submitInvoice (saleId, tenantId, feEnabled = false) {
    // ── Modo POS normal: FE deshabilitado ──────────────────────────
    if (!feEnabled) {
      // Marcar la venta como FV (tiquete POS); dian_status queda NULL (no hay procesamiento FE)
      await supabaseService.client
        .from('sales')
        .update({ invoice_type: 'FV' })
        .eq('sale_id', saleId)
        .eq('tenant_id', tenantId)
      return { success: true, mode: 'pos' }
    }

    // ── Modo FE habilitado ─────────────────────────────────────────
    try {
      // 1. Obtener configuración del proveedor
      const cfgRes = await this.getProviderConfig(tenantId)
      if (!cfgRes.success || !cfgRes.data) {
        return { success: false, error: 'No hay proveedor tecnológico configurado. Configure el proveedor en Configuración > Facturación.' }
      }
      const cfg = cfgRes.data
      if (!cfg.base_url) {
        return { success: false, error: 'La URL del proveedor tecnológico no está configurada.' }
      }

      // 2. Obtener la venta completa con líneas, tercero, impuestos
      const salePayload = await this._buildInvoicePayload(saleId, tenantId)
      if (!salePayload.success) {
        return { success: false, error: salePayload.error }
      }

      // 3. Obtener resolución activa y siguiente consecutivo
      const resRes = await this.getActiveResolution(tenantId, 'FE')
      if (!resRes.success || !resRes.data) {
        return { success: false, error: 'No hay resolución DIAN activa para Factura Electrónica. Configure la resolución en Configuración > Facturación.' }
      }
      const resolution = resRes.data

      // Verificar rango
      const nextConsecutive = resolution.current_number + 1
      if (nextConsecutive > resolution.to_number) {
        return { success: false, error: `La resolución DIAN (${resolution.prefix}) ha agotado su rango de consecutivos hasta ${resolution.to_number}.` }
      }

      // 4. Construir headers de autenticación
      const headers = { 'Content-Type': 'application/json' }
      if (cfg.auth_type === 'apikey') {
        headers[cfg.auth_header || 'X-API-Key'] = cfg.api_key
      } else if (cfg.auth_type === 'bearer') {
        headers['Authorization'] = `Bearer ${cfg.api_key}`
      } else if (cfg.auth_type === 'basic') {
        headers['Authorization'] = 'Basic ' + btoa(cfg.api_key || '')
      }

      if (cfg.environment === 'habilitacion' && cfg.test_set_id) {
        headers['X-Test-Set-Id'] = cfg.test_set_id
      }

      // 5. Payload final para el proveedor
      const body = {
        ...salePayload.data,
        resolution: {
          id:         resolution.resolution_id,
          number:     resolution.resolution_number,
          prefix:     resolution.prefix,
          date:       resolution.resolution_date,
          from:       resolution.from_number,
          to:         resolution.to_number,
          consecutive: nextConsecutive,
          technicalKey: resolution.technical_key
        },
        software: {
          id:  cfg.software_id,
          pin: cfg.software_pin
        },
        environment: cfg.environment
      }

      // 6. Llamada HTTP al proveedor con timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), (cfg.timeout_seconds || 30) * 1000)

      let providerResponse
      try {
        const resp = await fetch(`${cfg.base_url}/invoices`, {
          method:  'POST',
          headers,
          body:    JSON.stringify(body),
          signal:  controller.signal
        })
        clearTimeout(timeoutId)
        providerResponse = await resp.json()

        if (!resp.ok) {
          throw new Error(providerResponse?.message || providerResponse?.error || `HTTP ${resp.status}`)
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId)
        // Persistir el error de envío
        await supabaseService.client
          .from('sales')
          .update({
            invoice_type:  'FE',
            resolution_id: resolution.resolution_id,
            dian_status:   'ERROR',
            dian_response: { error: fetchErr.message, ts: new Date().toISOString() },
            dian_sent_at:  new Date().toISOString()
          })
          .eq('sale_id', saleId)
          .eq('tenant_id', tenantId)
        return { success: false, error: `Error al conectar con el proveedor: ${fetchErr.message}` }
      }

      // 7. Reservar el consecutivo en la resolución
      await supabaseService.client
        .from('invoice_resolutions')
        .update({ current_number: nextConsecutive, updated_at: new Date().toISOString() })
        .eq('resolution_id', resolution.resolution_id)

      // 8. Persistir resultado en la venta
      const cufe   = providerResponse.cufe   || providerResponse.CUFE   || null
      const qrUrl  = providerResponse.qrUrl  || providerResponse.qr_url || null
      const status = cufe ? 'ACCEPTED' : 'PROCESSING'

      await supabaseService.client
        .from('sales')
        .update({
          invoice_type:    'FE',
          resolution_id:   resolution.resolution_id,
          dian_consecutive: nextConsecutive,
          cufe,
          qr_url:          qrUrl,
          dian_status:     status,
          dian_response:   providerResponse,
          dian_sent_at:    new Date().toISOString()
        })
        .eq('sale_id', saleId)
        .eq('tenant_id', tenantId)

      return { success: true, mode: 'fe', cufe, qrUrl, status, consecutive: nextConsecutive }

    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Consulta el estado de una factura enviada al proveedor y actualiza sales.
   * Útil para reintentos / polling cuando el estado queda en PROCESSING.
   */
  async checkInvoiceStatus (saleId, tenantId) {
    try {
      const cfgRes = await this.getProviderConfig(tenantId)
      if (!cfgRes.success || !cfgRes.data?.base_url) {
        return { success: false, error: 'Proveedor no configurado' }
      }
      const cfg = cfgRes.data

      const headers = { 'Content-Type': 'application/json' }
      if (cfg.auth_type === 'apikey')  headers[cfg.auth_header || 'X-API-Key'] = cfg.api_key
      if (cfg.auth_type === 'bearer')  headers['Authorization'] = `Bearer ${cfg.api_key}`
      if (cfg.auth_type === 'basic')   headers['Authorization'] = 'Basic ' + btoa(cfg.api_key || '')

      const resp = await fetch(`${cfg.base_url}/invoices/${saleId}/status`, { headers })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const providerResponse = await resp.json()

      const cufe   = providerResponse.cufe  || providerResponse.CUFE  || null
      const qrUrl  = providerResponse.qrUrl || providerResponse.qr_url || null
      const status = providerResponse.status === 'ACCEPTED' || cufe ? 'ACCEPTED'
                   : providerResponse.status === 'REJECTED'          ? 'REJECTED'
                   : 'PROCESSING'

      await supabaseService.client
        .from('sales')
        .update({
          cufe,
          qr_url:       qrUrl,
          dian_status:  status,
          dian_response: providerResponse
        })
        .eq('sale_id', saleId)
        .eq('tenant_id', tenantId)

      return { success: true, status, cufe, qrUrl }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ----------------------------------------------------------------
  // HELPERS INTERNOS
  // ----------------------------------------------------------------

  /**
   * Construye el payload JSON con toda la información de la venta
   * lista para enviarse al proveedor tecnológico.
   */
  async _buildInvoicePayload (saleId, tenantId) {
    try {
      // Venta + tercero + líneas + tenant
      const [saleRes, tenantRes] = await Promise.all([
        supabaseService.client
          .from('sales')
          .select(`
            *,
            third_party:third_party_id (
              third_party_id, document_type, document_number, dv, legal_name, trade_name,
              tax_regime, is_responsible_for_iva, fiscal_email, phone,
              address, city, city_code, department, country_code, postal_code
            ),
            payments:sale_payments (
              amount, reference, paid_at,
              method:payment_method_id ( code, name, dian_payment_code )
            ),
            lines:sale_lines (
              sale_line_id, variant_id, quantity, unit_price, discount_amount,
              tax_amount, line_total, tax_detail,
              unit:unit_id ( unit_id, code, name, dian_code ),
              standard_code, standard_code_type,
              variant:variant_id (
                sku, variant_name,
                product:product_id ( name, description ),
                standard_code, standard_code_type,
                unit:unit_id ( unit_id, code, name, dian_code )
              )
            )
          `)
          .eq('sale_id', saleId)
          .eq('tenant_id', tenantId)
          .single(),

        supabaseService.client
          .from('tenants')
          .select('*, settings:tenant_settings(*)')
          .eq('tenant_id', tenantId)
          .single()
      ])

      if (saleRes.error) throw new Error(`Venta no encontrada: ${saleRes.error.message}`)
      if (tenantRes.error) throw new Error(`Tenant no encontrado: ${tenantRes.error.message}`)

      const sale   = saleRes.data
      const tenant = tenantRes.data

      const payload = {
        issuer: {
          nit:                  tenant.tax_id,
          dv:                   tenant.dv,
          legalName:            tenant.name,
          tradeName:            tenant.trade_name || tenant.name,
          taxRegime:            tenant.tax_regime,
          isResponsibleForIva:  tenant.is_responsible_for_iva,
          obligatedAccounting:  tenant.obligated_accounting,
          ciiu:                 tenant.ciiu_code,
          email:                tenant.fiscal_email,
          phone:                tenant.fiscal_phone,
          address:              tenant.address,
          city:                 tenant.city,
          cityCode:             tenant.city_code,
          department:           tenant.department,
          countryCode:          tenant.country_code || 'CO',
          postalCode:           tenant.postal_code
        },
        receiver: sale.third_party
          ? {
              documentType:        sale.third_party.document_type,
              documentNumber:      sale.third_party.document_number,
              dv:                  sale.third_party.dv,
              legalName:           sale.third_party.legal_name,
              tradeName:           sale.third_party.trade_name,
              taxRegime:           sale.third_party.tax_regime,
              isResponsibleForIva: sale.third_party.is_responsible_for_iva,
              email:               sale.third_party.fiscal_email,
              phone:               sale.third_party.phone,
              address:             sale.third_party.address,
              city:                sale.third_party.city,
              cityCode:            sale.third_party.city_code,
              department:          sale.third_party.department,
              countryCode:         sale.third_party.country_code || 'CO'
            }
          : null,
        document: {
          saleId:        saleId,
          saleNumber:    sale.sale_number,
          issuedAt:      sale.sold_at || new Date().toISOString(),
          currency:      tenant.currency_code || 'COP',
          subtotal:      sale.subtotal,
          discountTotal: sale.discount_total,
          taxTotal:      sale.tax_total,
          total:         sale.total,
          note:          sale.note,
          // Forma de pago para XML FE
          paymentMeans: (sale.payments || []).map(p => ({
            code:      p.method?.dian_payment_code || '10',
            name:      p.method?.name || p.method?.code || 'Efectivo',
            amount:    p.amount,
            reference: p.reference
          }))
        },
        lines: (sale.lines || []).map(l => {
          const variant = l.variant || {}
          const product = variant.product || {}
          // unit: prefer line unit → variant unit → fallback unset
          const unit    = l.unit || variant.unit || null
          const stdCode = l.standard_code || variant.standard_code || null
          const stdType = l.standard_code_type || variant.standard_code_type || 'UNSPSC'
          return {
            lineId:           l.sale_line_id,
            sku:              variant.sku,
            description:      product.name + (variant.variant_name ? ` - ${variant.variant_name}` : ''),
            quantity:         l.quantity,
            unitCode:         unit?.dian_code || unit?.code || '94',  // '94'=Unidad si no hay
            unitPrice:        l.unit_price,
            discountAmount:   l.discount_amount,
            taxAmount:        l.tax_amount,
            lineTotal:        l.line_total,
            taxDetail:        l.tax_detail,
            standardCode:     stdCode,
            standardCodeType: stdType
          }
        })
      }

      return { success: true, data: payload }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

export default new ElectronicInvoicingService()
