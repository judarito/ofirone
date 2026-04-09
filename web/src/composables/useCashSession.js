import { ref, computed } from 'vue'
import { useTenant } from './useTenant'
import { useAuth } from './useAuth'
import cashAssignmentService from '@/services/cashAssignment.service'
import cashService from '@/services/cash.service'

const currentCashSession = ref(null)
const assignedRegisters = ref([])
const posContext = ref(null)

export function useCashSession() {
  const { tenantId } = useTenant()
  const { userProfile } = useAuth()

  const hasOpenSession = computed(() => !!posContext.value?.open_cash_session_id)
  const assignedCount = computed(() => posContext.value?.assigned_registers_count || 0)
  const singleRegisterId = computed(() => posContext.value?.single_cash_register_id)

  // Cargar contexto POS al login
  const loadPOSContext = async () => {
    if (!tenantId.value || !userProfile.value) return { success: false }

    const r = await cashAssignmentService.getPOSHomeContext(tenantId.value, userProfile.value.user_id)
    if (r.success) {
      posContext.value = r.context

      // Si tiene sesión abierta, cargarla
      if (r.context.open_cash_session_id) {
        await loadCurrentSession(r.context.open_cash_session_id)
      }

      // Si tiene cajas asignadas, cargarlas
      if (r.context.assigned_registers_count > 0) {
        await loadAssignedRegisters()
      }

      return { success: true, context: r.context }
    }

    return { success: false, error: r.error }
  }

  // Cargar sesión actual
  const loadCurrentSession = async (sessionId) => {
    if (!tenantId.value) return

    const r = await cashService.getCashSessions(tenantId.value, { sessionId }, 1, 1)
    if (r.success && r.data.length > 0) {
      currentCashSession.value = r.data[0]
    }
  }

  // Cargar cajas asignadas
  const loadAssignedRegisters = async () => {
    if (!tenantId.value || !userProfile.value) return

    const r = await cashAssignmentService.getUserCashRegisters(tenantId.value, userProfile.value.user_id)
    if (r.success) {
      assignedRegisters.value = r.data
    }
  }

  // Abrir sesión
  const openSession = async (cashRegisterId, openingAmount) => {
    if (!tenantId.value || !userProfile.value) return { success: false }

    const r = await cashAssignmentService.openCashSession(
      tenantId.value,
      cashRegisterId,
      userProfile.value.user_id,
      openingAmount
    )

    if (r.success) {
      await loadPOSContext()
      return { success: true, sessionId: r.sessionId }
    }

    return { success: false, error: r.error }
  }

  // Cerrar sesión
  const closeSession = async (countedAmount) => {
    if (!tenantId.value || !userProfile.value || !currentCashSession.value) {
      return { success: false, error: 'No hay sesión activa' }
    }

    const r = await cashAssignmentService.closeCashSessionSecure(
      tenantId.value,
      currentCashSession.value.cash_session_id,
      userProfile.value.user_id,
      countedAmount
    )

    if (r.success) {
      currentCashSession.value = null
      posContext.value = null
      await loadPOSContext()
      return { success: true }
    }

    return { success: false, error: r.error }
  }

  // Limpiar contexto (logout)
  const clearContext = () => {
    currentCashSession.value = null
    assignedRegisters.value = []
    posContext.value = null
  }

  return {
    // State
    currentCashSession,
    assignedRegisters,
    posContext,

    // Computed
    hasOpenSession,
    assignedCount,
    singleRegisterId,

    // Methods
    loadPOSContext,
    loadCurrentSession,
    loadAssignedRegisters,
    openSession,
    closeSession,
    clearContext
  }
}
