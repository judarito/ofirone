import { supabase } from '@/plugins/supabase'

const SUBSCRIPTION_CREATE_PREFERENCE_FUNCTION = import.meta.env.VITE_SUBSCRIPTION_CREATE_PREFERENCE_EDGE_FUNCTION || 'subscription-create-preference'

function normalizeAbsoluteUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw, window.location.origin)
    if (!/^https?:$/.test(url.protocol)) return ''
    return url.toString()
  } catch (_error) {
    return ''
  }
}

class SubscriptionSignupService {
  async listPublicPlans() {
    try {
      const { data, error } = await supabase.rpc('fn_list_public_subscription_plans')
      if (error) throw error
      return { success: true, data: Array.isArray(data) ? data : [] }
    } catch (error) {
      return { success: false, data: [], error: error.message || 'No se pudieron cargar los planes.' }
    }
  }

  async createPreference(payload = {}) {
    try {
      const { data, error } = await supabase.functions.invoke(SUBSCRIPTION_CREATE_PREFERENCE_FUNCTION, {
        body: {
          plan_price_id: payload.plan_price_id,
          business_name: String(payload.business_name || '').trim(),
          legal_name: String(payload.legal_name || '').trim() || null,
          tax_id: String(payload.tax_id || '').trim() || null,
          admin_full_name: String(payload.admin_full_name || '').trim(),
          admin_email: String(payload.admin_email || '').trim(),
          phone: String(payload.phone || '').trim() || null,
          address: String(payload.address || '').trim() || null,
          origin: normalizeAbsoluteUrl(payload.origin) || window.location.origin,
        },
      })

      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message || 'No se pudo iniciar el pago.' }
    }
  }

  async getSignupStatus(signupId) {
    try {
      const { data, error } = await supabase.rpc('fn_get_public_subscription_signup_status', {
        p_signup_id: signupId,
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return { success: true, data }
    } catch (error) {
      return { success: false, data: null, error: error.message || 'No se pudo consultar la solicitud.' }
    }
  }

  async retrySignup(signupId) {
    try {
      const { data, error } = await supabase.functions.invoke('mercadopago-webhook', {
        body: { external_reference: `subscription_signup:${signupId}` },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message || 'No se pudo reintentar la validación del pago.' }
    }
  }
}

export default new SubscriptionSignupService()
