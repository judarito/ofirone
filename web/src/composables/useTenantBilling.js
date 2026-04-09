import { computed, ref, watch } from 'vue'
import { useTenant } from './useTenant'
import tenantBillingService from '@/services/tenantBilling.service'

const summary = ref(null)
const loading = ref(false)
const error = ref('')
const loadedTenantId = ref(null)

export function useTenantBilling() {
  const { tenantId } = useTenant()

  const loadBillingSummary = async (options = {}) => {
    if (!tenantId.value) {
      summary.value = null
      error.value = ''
      loadedTenantId.value = null
      return { success: false, data: null, error: 'tenantId no disponible' }
    }

    loading.value = true
    error.value = ''

    try {
      const result = await tenantBillingService.getTenantBillingSummary(tenantId.value, options)
      if (result.success) {
        summary.value = result.data || null
        loadedTenantId.value = tenantId.value
      } else {
        summary.value = null
        error.value = result.error || 'No fue posible cargar billing'
      }
      return result
    } finally {
      loading.value = false
    }
  }

  watch(
    () => tenantId.value,
    async (nextTenantId) => {
      if (!nextTenantId) {
        summary.value = null
        error.value = ''
        loadedTenantId.value = null
        return
      }

      if (loadedTenantId.value !== nextTenantId) {
        await loadBillingSummary()
      }
    },
    { immediate: true }
  )

  return {
    billingSummary: computed(() => summary.value),
    billingLoading: computed(() => loading.value),
    billingError: computed(() => error.value),
    billingStatusLabel: computed(() => summary.value?.status_label || 'Sin estado'),
    billingBannerMessage: computed(() => summary.value?.banner_message || ''),
    canOperateSales: computed(() => summary.value?.can_operate_sales !== false),
    canOperateAdmin: computed(() => summary.value?.can_operate_admin !== false),
    hasBillingSummary: computed(() => !!summary.value),
    loadBillingSummary,
  }
}
