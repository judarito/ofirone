import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'
import {
  BILLING_FEATURE_CODES,
  evaluateBillingLimit,
  getBillingAccessForRequirement,
  getBillingRouteAccess as resolveBillingRouteAccess,
  hasBillingFeature,
  isOfflineModeAllowed,
} from '../../../shared/utils/billingAccess'

const STATUS_LABELS = {
  trialing: 'En prueba',
  active: 'Activo',
  pending_activation: 'Pendiente de activación',
  past_due: 'Vencido',
  grace_period: 'En gracia',
  suspended: 'Suspendido',
  canceled: 'Cancelado',
  expired: 'Expirado',
}

const SUBSCRIPTION_PROVISION_FUNCTION = import.meta.env.VITE_SUBSCRIPTION_PROVISION_EDGE_FUNCTION || 'subscription-provision-signup'

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function computeDaysToExpiry(expirationDate) {
  if (!expirationDate) return null
  const target = new Date(expirationDate)
  if (Number.isNaN(target.getTime())) return null

  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const diffMs = startOfTarget.getTime() - startOfToday.getTime()
  return Math.round(diffMs / (24 * 60 * 60 * 1000))
}

export function getBillingStatusLabel(status) {
  return STATUS_LABELS[String(status || '').trim()] || 'Sin estado'
}

export function normalizeTenantBillingSummary(data) {
  if (!data || typeof data !== 'object') return null

  const expirationDate = data.current_period_end || data.trial_end_at || data.grace_end_at || null
  const parsedDaysToExpiry = Number(data.days_to_expiry)

  return {
    ...data,
    status: String(data.status || '').trim(),
    status_label: getBillingStatusLabel(data.status),
    feature_flags: normalizeJsonObject(data.feature_flags),
    plan_limits: normalizeJsonObject(data.plan_limits),
    expiration_date: expirationDate,
    days_to_expiry: Number.isFinite(parsedDaysToExpiry) ? parsedDaysToExpiry : computeDaysToExpiry(expirationDate),
  }
}

export function getBillingRouteAccess(summary, path) {
  return resolveBillingRouteAccess(summary, path)
}

function sortPlanChildren(items, key) {
  return [...(items || [])].sort((a, b) => String(a?.[key] || '').localeCompare(String(b?.[key] || '')))
}

function normalizeBillingPlan(plan) {
  if (!plan) return null

  return {
    ...plan,
    prices: sortPlanChildren(plan.prices || [], 'billing_interval'),
    features: sortPlanChildren(plan.features || [], 'feature_code'),
    limits: sortPlanChildren(plan.limits || [], 'limit_code'),
  }
}

class TenantBillingService {
  invalidateBillingCaches(tenantId = null) {
    if (tenantId) {
      queryCache.invalidateByTags(['tenant-billing'], { tenantId })
      queryCache.invalidate('tenant-billing-summary', { tenantId })
      queryCache.invalidate('tenant-billing-limit-usage', { tenantId })
    }

    queryCache.invalidateByTags(['billing-plans', 'superadmin-billing'], { tenantId: 'global' })
    queryCache.invalidate('billing-plans', { tenantId: 'global' })
    queryCache.invalidate('superadmin-billing-summary', { tenantId: 'global' })
    queryCache.invalidate('superadmin-public-subscription-signups', { tenantId: 'global' })
  }

  async getTenantBillingSummary(tenantId, options = {}) {
    if (!tenantId) {
      return { success: false, data: null, error: 'tenantId es requerido' }
    }

    try {
      const data = await queryCache.getOrLoad(
        'tenant-billing-summary',
        async () => {
          const { data, error } = await supabaseService.client.rpc('fn_get_tenant_billing_summary', {
            p_tenant_id: tenantId,
          })
          if (error) throw error
          return Array.isArray(data) ? (data[0] || null) : (data || null)
        },
        {
          tenantId,
          ttlMs: 60 * 1000,
          swrMs: 4 * 60 * 1000,
          storage: 'session',
          forceRefresh: options.forceRefresh === true,
          tags: ['tenant-billing'],
        }
      )

      return { success: true, data: normalizeTenantBillingSummary(data) }
    } catch (error) {
      return { success: false, data: null, error: error.message }
    }
  }

  async listTenantBillingSummaries(options = {}) {
    try {
      const data = await queryCache.getOrLoad(
        'superadmin-billing-summary',
        async () => {
          const { data, error } = await supabaseService.client.rpc('fn_superadmin_list_tenant_billing_summary')
          if (error) throw error
          return data || []
        },
        {
          tenantId: 'global',
          ttlMs: 60 * 1000,
          swrMs: 3 * 60 * 1000,
          storage: 'session',
          forceRefresh: options.forceRefresh === true,
          tags: ['superadmin-billing'],
        }
      )

      return {
        success: true,
        data: (data || []).map((item) => normalizeTenantBillingSummary(item)),
      }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async getBillingPlans(options = {}) {
    try {
      const data = await queryCache.getOrLoad(
        'billing-plans',
        async () => {
          const { data, error } = await supabaseService.client
            .from('billing_plans')
            .select(`
              *,
              prices:billing_plan_prices(*),
              features:billing_plan_features(*),
              limits:billing_plan_limits(*)
            `)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true })

          if (error) throw error
          return data || []
        },
        {
          tenantId: 'global',
          ttlMs: 2 * 60 * 1000,
          swrMs: 5 * 60 * 1000,
          storage: 'session',
          forceRefresh: options.forceRefresh === true,
          tags: ['billing-plans'],
        }
      )

      return { success: true, data: (data || []).map(normalizeBillingPlan) }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async saveBillingPlan(planData) {
    try {
      const basePayload = {
        code: String(planData.code || '').trim().toLowerCase(),
        name: String(planData.name || '').trim(),
        description: String(planData.description || '').trim() || null,
        is_public: planData.is_public !== false,
        is_active: planData.is_active !== false,
        is_custom: planData.is_custom === true,
        sort_order: Number(planData.sort_order || 0),
      }

      let planId = planData.plan_id || null

      if (planId) {
        const { error } = await supabaseService.client
          .from('billing_plans')
          .update(basePayload)
          .eq('plan_id', planId)

        if (error) throw error
      } else {
        const { data, error } = await supabaseService.client
          .from('billing_plans')
          .insert(basePayload)
          .select()
          .single()

        if (error) throw error
        planId = data.plan_id
      }

      const prices = (planData.prices || [])
        .filter((item) => item?.billing_interval)
        .map((item) => ({
          plan_id: planId,
          currency_code: String(item.currency_code || 'COP').trim().toUpperCase(),
          billing_interval: item.billing_interval,
          amount: Number(item.amount || 0),
          setup_fee: Number(item.setup_fee || 0),
          trial_days: Number(item.trial_days || 0),
          grace_days: Number(item.grace_days || 0),
          auto_renew_default: item.auto_renew_default === true,
          is_active: item.is_active !== false,
        }))

      if (prices.length > 0) {
        const { error } = await supabaseService.client
          .from('billing_plan_prices')
          .upsert(prices, { onConflict: 'plan_id,currency_code,billing_interval' })

        if (error) throw error
      }

      const features = (planData.features || [])
        .filter((item) => item?.feature_code)
        .map((item) => ({
          plan_id: planId,
          feature_code: String(item.feature_code || '').trim().toUpperCase(),
          feature_name: String(item.feature_name || '').trim(),
          is_enabled: item.is_enabled === true,
          metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
        }))

      if (features.length > 0) {
        const { error } = await supabaseService.client
          .from('billing_plan_features')
          .upsert(features, { onConflict: 'plan_id,feature_code' })

        if (error) throw error
      }

      const limits = (planData.limits || [])
        .filter((item) => item?.limit_code)
        .map((item) => ({
          plan_id: planId,
          limit_code: String(item.limit_code || '').trim().toLowerCase(),
          limit_name: String(item.limit_name || '').trim(),
          limit_value: Number(item.limit_value || 0),
          limit_unit: String(item.limit_unit || 'count').trim().toLowerCase(),
          metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
        }))

      if (limits.length > 0) {
        const { error } = await supabaseService.client
          .from('billing_plan_limits')
          .upsert(limits, { onConflict: 'plan_id,limit_code' })

        if (error) throw error
      }

      this.invalidateBillingCaches()
      return { success: true, data: { plan_id: planId } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async getTenantSubscriptionHistory(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('tenant_subscriptions')
        .select(`
          *,
          plan:plan_id(plan_id, code, name),
          plan_price:plan_price_id(plan_price_id, currency_code, billing_interval, amount, grace_days, trial_days)
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async assignTenantPlan(payload) {
    try {
      const { data, error } = await supabaseService.client.rpc('fn_superadmin_assign_tenant_plan', {
        p_tenant_id: payload.tenant_id,
        p_plan_price_id: payload.plan_price_id,
        p_status: payload.status || 'active',
        p_start_at: payload.start_at || new Date().toISOString(),
        p_trial_end_at: payload.trial_end_at || null,
        p_current_period_end: payload.current_period_end || null,
        p_renewal_mode: payload.renewal_mode || 'manual',
        p_note: payload.note || null,
      })

      if (error) throw error
      this.invalidateBillingCaches(payload.tenant_id)
      return { success: Boolean(data?.success !== false), data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async updateSubscriptionStatus(payload) {
    try {
      const { data, error } = await supabaseService.client.rpc('fn_superadmin_update_subscription_status', {
        p_subscription_id: payload.subscription_id,
        p_status: payload.status,
        p_grace_end_at: payload.grace_end_at || null,
        p_note: payload.note || null,
      })

      if (error) throw error
      this.invalidateBillingCaches(payload.tenant_id || null)
      return { success: Boolean(data?.success !== false), data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async listPublicSubscriptionSignups(options = {}) {
    try {
      const data = await queryCache.getOrLoad(
        'superadmin-public-subscription-signups',
        async () => {
          const { data, error } = await supabaseService.client.rpc('fn_superadmin_list_public_subscription_signups', {
            p_limit: options.limit || 150,
          })
          if (error) throw error
          return data || []
        },
        {
          tenantId: 'global',
          ttlMs: 30 * 1000,
          swrMs: 90 * 1000,
          storage: 'session',
          forceRefresh: options.forceRefresh === true,
          tags: ['superadmin-billing'],
        }
      )

      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async retryPublicSubscriptionSignup(signupId) {
    try {
      const normalizedSignupId = String(signupId || '').trim()
      if (!normalizedSignupId) throw new Error('signupId es requerido')

      const { data, error } = await supabaseService.client.functions.invoke('mercadopago-webhook', {
        body: {
          external_reference: `subscription_signup:${normalizedSignupId}`,
        },
      })

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      queryCache.invalidate('superadmin-public-subscription-signups', { tenantId: 'global' })
      queryCache.invalidate('superadmin-billing-summary', { tenantId: 'global' })
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message || 'No fue posible reintentar el alta publica.' }
    }
  }

  async provisionPublicSubscriptionSignup(signupId) {
    try {
      const normalizedSignupId = String(signupId || '').trim()
      if (!normalizedSignupId) throw new Error('signupId es requerido')

      const { data, error } = await supabaseService.client.functions.invoke(SUBSCRIPTION_PROVISION_FUNCTION, {
        body: {
          signup_id: normalizedSignupId,
        },
      })

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      queryCache.invalidate('superadmin-public-subscription-signups', { tenantId: 'global' })
      queryCache.invalidate('superadmin-billing-summary', { tenantId: 'global' })
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message || 'No fue posible aprovisionar el alta publica.' }
    }
  }

  async managePublicSubscriptionSignup(signupId, action, options = {}) {
    try {
      const normalizedSignupId = String(signupId || '').trim()
      const normalizedAction = String(action || '').trim().toLowerCase()
      if (!normalizedSignupId) throw new Error('signupId es requerido')
      if (!normalizedAction) throw new Error('action es requerido')

      const { data, error } = await supabaseService.client.functions.invoke(SUBSCRIPTION_PROVISION_FUNCTION, {
        body: {
          signup_id: normalizedSignupId,
          action: normalizedAction,
          note: String(options.note || '').trim() || undefined,
        },
      })

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      queryCache.invalidate('superadmin-public-subscription-signups', { tenantId: 'global' })
      queryCache.invalidate('superadmin-billing-summary', { tenantId: 'global' })
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message || 'No fue posible ejecutar la acción del alta pública.' }
    }
  }

  async cancelPublicSubscriptionSignup(signupId, note = '') {
    return this.managePublicSubscriptionSignup(signupId, 'cancel', { note })
  }

  async markPublicSubscriptionSignupReviewed(signupId, note = '') {
    return this.managePublicSubscriptionSignup(signupId, 'mark_reviewed', { note })
  }

  async resendPublicSubscriptionSignupAccess(signupId, note = '') {
    return this.managePublicSubscriptionSignup(signupId, 'resend_access', { note })
  }

  async listPublicSubscriptionSignupEvents(signupId) {
    try {
      const { data, error } = await supabaseService.client.rpc('fn_superadmin_list_public_subscription_signup_events', {
        p_signup_id: signupId,
      })
      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, data: [], error: error.message }
    }
  }

  async getTenantPlanLimitUsage(tenantId, options = {}) {
    if (!tenantId) {
      return { success: false, data: {}, error: 'tenantId es requerido' }
    }

    try {
      const data = await queryCache.getOrLoad(
        'tenant-billing-limit-usage',
        async () => {
          const { data, error } = await supabaseService.client.rpc('fn_get_tenant_billing_limit_usage', {
            p_tenant_id: tenantId,
          })
          if (error) throw error
          return data || {}
        },
        {
          tenantId,
          ttlMs: 45 * 1000,
          swrMs: 2 * 60 * 1000,
          storage: 'session',
          forceRefresh: options.forceRefresh === true,
          tags: ['tenant-billing'],
        }
      )

      const normalized = Object.entries(data || {}).reduce((acc, [key, value]) => {
        const numericValue = Number(value)
        acc[key] = Number.isFinite(numericValue) ? numericValue : 0
        return acc
      }, {})

      return { success: true, data: normalized }
    } catch (error) {
      return { success: false, data: {}, error: error.message }
    }
  }

  getFeatureAccess(summary, featureCode, options = {}) {
    return getBillingAccessForRequirement(summary, {
      baseRestriction: options.baseRestriction || 'admin',
      featureCode,
    })
  }

  hasFeature(summary, featureCode, options = {}) {
    return hasBillingFeature(summary, featureCode, options)
  }

  async ensureFeatureAccess(tenantId, featureCode, options = {}) {
    const summaryResult = await this.getTenantBillingSummary(tenantId)
    if (!summaryResult.success) {
      return { success: true, data: null }
    }

    const access = this.getFeatureAccess(summaryResult.data, featureCode, options)
    if (access.allowed) {
      return { success: true, data: summaryResult.data }
    }

    const featureLabel = options.featureLabel || featureCode
    return {
      success: false,
      error: options.errorMessage || `Tu plan actual no incluye ${featureLabel}.`,
      code: access.restriction,
      featureCode: access.featureCode || featureCode,
    }
  }

  async ensureOfflineModeAccess(tenantId, options = {}) {
    const summaryResult = await this.getTenantBillingSummary(tenantId)
    if (!summaryResult.success) {
      return { success: true, data: null }
    }

    if (isOfflineModeAllowed(summaryResult.data)) {
      return { success: true, data: summaryResult.data }
    }

    return {
      success: false,
      error: options.errorMessage || 'Tu plan actual no incluye operación offline.',
      featureCode: BILLING_FEATURE_CODES.OFFLINE_MODE,
    }
  }

  async ensurePlanLimit(tenantId, limitCode, options = {}) {
    const [summaryResult, usageResult] = await Promise.all([
      this.getTenantBillingSummary(tenantId),
      this.getTenantPlanLimitUsage(tenantId),
    ])

    if (!summaryResult.success || !usageResult.success) {
      return { success: true, data: null }
    }

    const evaluation = evaluateBillingLimit(
      summaryResult.data,
      usageResult.data,
      limitCode,
      options.requestedUnits || 1
    )

    if (evaluation.allowed) {
      return {
        success: true,
        data: evaluation,
      }
    }

    const limitLabel = options.limitLabel || limitCode
    const planName = summaryResult.data?.plan_name || summaryResult.data?.plan_code || 'actual'

    return {
      success: false,
      error: options.errorMessage || `Tu plan ${planName} ya alcanzó el límite de ${limitLabel}.`,
      data: evaluation,
    }
  }
}

export default new TenantBillingService()
