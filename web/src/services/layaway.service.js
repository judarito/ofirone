import supabaseService from './supabase.service'
import { serviceErrorResult } from '@/utils/appErrors'

const layawayService = {
  /**
   * Obtener lista de contratos de plan separe
   */
  async getLayawayContracts(tenantId, page = 1, pageSize = 10, status = null) {
    try {
      let query = supabaseService.client
        .from('vw_layaway_summary')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })

      if (status) {
        query = query.eq('status', status)
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await query.range(from, to)

      if (error) throw error

      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      console.error('Error loading layaway contracts:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Obtener detalle de un contrato específico
   */
  async getLayawayDetail(tenantId, layawayId) {
    try {
      // Contrato principal
      const { data: contract, error: contractError } = await supabaseService.client
        .from('layaway_contracts')
        .select(`
          *,
          location:location_id(location_id, name),
          customer:customer_id(customer_id, full_name, document, phone, email),
          created_by_user:created_by(user_id, full_name),
          sale:sale_id(sale_id, sale_number)
        `)
        .eq('tenant_id', tenantId)
        .eq('layaway_id', layawayId)
        .single()

      if (contractError) throw contractError

      // Items del contrato
      const { data: items, error: itemsError } = await supabaseService.client
        .from('layaway_items')
        .select(`
          *,
          variant:variant_id(
            variant_id,
            sku,
            variant_name,
            price,
            product:product_id(product_id, name)
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('layaway_id', layawayId)

      if (itemsError) throw itemsError

      // Pagos/Abonos
      const { data: payments, error: paymentsError } = await supabaseService.client
        .from('vw_layaway_payments')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('layaway_id', layawayId)
        .order('paid_at', { ascending: false })

      if (paymentsError) throw paymentsError

      // Cuotas (si existen)
      const { data: installments, error: installmentsError } = await supabaseService.client
        .from('layaway_installments')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('layaway_id', layawayId)
        .order('due_date', { ascending: true })

      if (installmentsError) throw installmentsError

      return {
        success: true,
        data: {
          ...contract,
          items: items || [],
          payments: payments || [],
          installments: installments || []
        }
      }
    } catch (error) {
      console.error('Error loading layaway detail:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Crear nuevo contrato de plan separe
   */
  async createLayaway(tenantId, contractData) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('sp_create_layaway', {
          p_tenant: tenantId,
          p_location: contractData.location_id,
          p_customer: contractData.customer_id,
          p_created_by: contractData.created_by,
          p_items: contractData.items, // jsonb array
          p_due_date: contractData.due_date || null,
          p_note: contractData.note || null,
          p_initial_payment: contractData.initial_payment || null, // jsonb object
          p_installments: contractData.installments || null // jsonb array
        })

      if (error) throw error

      return { success: true, data }
    } catch (error) {
      console.error('Error creating layaway:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Registrar abono/pago parcial
   */
  async addPayment(tenantId, layawayId, paymentData) {
    try {
      const { error } = await supabaseService.client
        .rpc('sp_add_layaway_payment', {
          p_tenant: tenantId,
          p_layaway: layawayId,
          p_payment_method_code: paymentData.payment_method_code,
          p_amount: paymentData.amount,
          p_paid_by: paymentData.paid_by,
          p_cash_session: paymentData.cash_session_id || null,
          p_reference: paymentData.reference || null
        })

      if (error) throw error

      return { success: true }
    } catch (error) {
      console.error('Error adding layaway payment:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Completar contrato (convertir a factura/venta)
   */
  async completeLayaway(tenantId, layawayId, soldBy, note = null) {
    try {
      const { data, error } = await supabaseService.client
        .rpc('sp_complete_layaway_to_sale', {
          p_tenant: tenantId,
          p_layaway: layawayId,
          p_sold_by: soldBy,
          p_note: note
        })

      if (error) throw error

      return { success: true, data } // retorna sale_id
    } catch (error) {
      console.error('Error completing layaway:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Cancelar o expirar contrato
   */
  async cancelLayaway(tenantId, layawayId, cancelledBy, status = 'CANCELLED', note = null) {
    try {
      const { error } = await supabaseService.client
        .rpc('sp_cancel_layaway', {
          p_tenant: tenantId,
          p_layaway: layawayId,
          p_cancelled_by: cancelledBy,
          p_status: status, // 'CANCELLED' o 'EXPIRED'
          p_note: note
        })

      if (error) throw error

      return { success: true }
    } catch (error) {
      console.error('Error cancelling layaway:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Obtener stock disponible (on_hand - reserved)
   */
  async getStockAvailable(tenantId, locationId, variantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_stock_available')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)
        .eq('variant_id', variantId)
        .single()

      if (error) throw error

      return { success: true, data }
    } catch (error) {
      console.error('Error getting stock available:', error)
      return serviceErrorResult(error)
    }
  },

  /**
   * Obtener alertas de plan separe (próximos a vencer, vencidos)
   */
  async getLayawayAlerts(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('layaway_contracts')
        .select(`
          layaway_id,
          created_at,
          due_date,
          status,
          total,
          paid_total,
          balance,
          location:location_id(location_id, name),
          customer:customer_id(customer_id, full_name, document, phone)
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'ACTIVE')
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true })

      if (error) throw error

      // Clasificar alertas
      const now = new Date()
      const sevenDaysFromNow = new Date()
      sevenDaysFromNow.setDate(now.getDate() + 7)

      const alerts = (data || []).map(contract => {
        const dueDate = new Date(contract.due_date)
        let alertLevel = 'UPCOMING'
        
        if (dueDate < now) {
          alertLevel = 'EXPIRED'
        } else if (dueDate <= sevenDaysFromNow) {
          alertLevel = 'DUE_SOON'
        }

        const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))

        return {
          ...contract,
          alert_level: alertLevel,
          days_until_due: daysUntilDue
        }
      }).filter(alert => alert.alert_level !== 'UPCOMING') // Solo mostrar vencidos y próximos a vencer

      return { success: true, data: alerts }
    } catch (error) {
      console.error('Error getting layaway alerts:', error)
      return serviceErrorResult(error)
    }
  }
}

export default layawayService
