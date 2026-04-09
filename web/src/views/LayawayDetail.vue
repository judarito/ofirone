<template>
  <div v-if="contract">
    <!-- Encabezado -->
    <v-card class="mb-3">
      <v-card-title class="d-flex flex-column flex-sm-row align-start align-sm-center pa-2 pa-sm-4">
        <div class="d-flex align-center mb-2 mb-sm-0" style="flex: 1; min-width: 0;">
          <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="goBack" class="mr-2 flex-shrink-0"></v-btn>
          <v-icon class="mr-2 flex-shrink-0" color="blue">mdi-calendar-clock</v-icon>
          <span class="text-truncate">Plan Separe - {{ contract.customer?.full_name }}</span>
        </div>
        <v-chip :color="getStatusColor(contract.status)" variant="flat" class="flex-shrink-0">
          {{ getStatusLabel(contract.status) }}
        </v-chip>
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="4">
            <div class="text-caption text-grey">Cliente</div>
            <div class="text-body-1 font-weight-medium">{{ contract.customer?.full_name }}</div>
            <div class="text-caption">{{ contract.customer?.document }} • {{ contract.customer?.phone }}</div>
          </v-col>
          <v-col cols="12" md="4">
            <div class="text-caption text-grey">Sede</div>
            <div class="text-body-1">{{ contract.location?.name }}</div>
          </v-col>
          <v-col cols="12" md="4">
            <div class="text-caption text-grey">Creado</div>
            <div class="text-body-1">{{ formatDate(contract.created_at) }}</div>
            <div v-if="contract.due_date" class="text-caption">Vence: {{ formatDate(contract.due_date) }}</div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row>
      <!-- Productos -->
      <v-col cols="12" md="7">
        <v-card>
          <v-card-title>
            <v-icon start>mdi-package-variant</v-icon>
            Productos
          </v-card-title>
          <v-card-text>
            <v-table density="compact">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="text-center">Cant.</th>
                  <th class="text-right">Precio</th>
                  <th class="text-right">Desc.</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in contract.items" :key="item.layaway_item_id">
                  <td>
                    <div class="text-body-2">{{ item.variant?.product?.name }}</div>
                    <div class="text-caption text-grey">{{ item.variant?.variant_name }} — {{ item.variant?.sku }}</div>
                  </td>
                  <td class="text-center">{{ item.quantity }}</td>
                  <td class="text-right">{{ formatMoney(item.unit_price) }}</td>
                  <td class="text-right">{{ formatMoney(item.discount_amount) }}</td>
                  <td class="text-right font-weight-bold">{{ formatMoney(item.line_total) }}</td>
                </tr>
              </tbody>
            </v-table>

            <v-divider class="my-3"></v-divider>
            
            <!-- Totales -->
            <div class="d-flex justify-space-between mb-1">
              <span>Subtotal:</span><span>{{ formatMoney(contract.subtotal) }}</span>
            </div>
            <div class="d-flex justify-space-between mb-1">
              <span>Descuento:</span><span>{{ formatMoney(contract.discount_total) }}</span>
            </div>
            <div class="d-flex justify-space-between mb-1">
              <span>Impuestos:</span><span>{{ formatMoney(contract.tax_total) }}</span>
            </div>
            <v-divider class="my-2"></v-divider>
            <div class="d-flex justify-space-between text-h6 font-weight-bold">
              <span>TOTAL:</span><span class="text-primary">{{ formatMoney(contract.total) }}</span>
            </div>
          </v-card-text>
        </v-card>

        <!-- Abonos/Pagos -->
        <v-card class="mt-3">
          <v-card-title class="d-flex flex-column flex-sm-row align-start align-sm-center pa-2 pa-sm-4">
            <div class="d-flex align-center mb-2 mb-sm-0">
              <v-icon start>mdi-cash-multiple</v-icon>
              <span>Historial de Abonos</span>
            </div>
            <v-spacer class="d-none d-sm-flex"></v-spacer>
            <v-btn 
              v-if="contract.status === 'ACTIVE' && canAddPayment" 
              color="success" 
              size="small" 
              prepend-icon="mdi-plus"
              :block="$vuetify.display.xs"
              @click="openPaymentDialog"
            >
              Registrar Abono
            </v-btn>
          </v-card-title>
          <v-card-text>
            <v-list v-if="contract.payments && contract.payments.length > 0" density="compact">
              <v-list-item v-for="payment in contract.payments" :key="payment.layaway_payment_id">
                <template #prepend>
                  <v-icon color="success">mdi-cash-check</v-icon>
                </template>
                <v-list-item-title>{{ payment.payment_method_name }} — {{ formatMoney(payment.amount) }}</v-list-item-title>
                <v-list-item-subtitle>
                  {{ formatDate(payment.paid_at) }}
                  <span v-if="payment.reference"> • Ref: {{ payment.reference }}</span>
                </v-list-item-subtitle>
                <template #append>
                  <v-btn icon="mdi-printer" size="x-small" variant="text" :loading="printing" @click="handlePrintPaymentReceipt(payment)"></v-btn>
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-center text-grey py-4">
              <v-icon size="48">mdi-cash-remove</v-icon>
              <div>Sin abonos registrados</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Resumen y acciones -->
      <v-col cols="12" md="5">
        <!-- Estado financiero -->
        <v-card variant="tonal" :color="contract.balance > 0 ? 'warning' : 'success'">
          <v-card-text class="pa-3">
            <div class="text-h6 mb-2">Estado Financiero</div>
            <div class="d-flex justify-space-between mb-2">
              <span>Total contrato:</span>
              <span class="font-weight-bold">{{ formatMoney(contract.total) }}</span>
            </div>
            <div class="d-flex justify-space-between mb-2 text-success">
              <span>Pagado:</span>
              <span class="font-weight-bold">{{ formatMoney(contract.paid_total) }}</span>
            </div>
            <v-divider class="my-2"></v-divider>
            <div class="d-flex justify-space-between text-h5" :class="contract.balance > 0 ? 'text-warning' : 'text-success'">
              <span>Saldo:</span>
              <span class="font-weight-bold">{{ formatMoney(contract.balance) }}</span>
            </div>
          </v-card-text>
        </v-card>

        <!-- Factura asociada -->
        <v-card v-if="contract.sale_id" class="mt-3" variant="tonal" color="green">
          <v-card-text>
            <v-icon start color="green">mdi-receipt</v-icon>
            <span class="font-weight-medium">Factura #{{ contract.sale?.sale_number }}</span>
            <div class="text-caption">Contrato completado y facturado</div>
          </v-card-text>
        </v-card>

        <!-- Acciones -->
        <v-card class="mt-3">
          <v-card-title>Acciones</v-card-title>
          <v-card-text class="d-flex flex-column ga-2">
            <v-btn 
              color="primary" 
              block 
              variant="tonal"
              prepend-icon="mdi-printer"
              :loading="printing"
              @click="handlePrintContract"
            >
              Imprimir Contrato
            </v-btn>
            
            <v-btn 
              v-if="contract.status === 'ACTIVE' && contract.balance === 0 && canComplete"
              color="primary" 
              block 
              prepend-icon="mdi-check-circle"
              :loading="completing"
              @click="confirmComplete"
            >
              Completar y Facturar
            </v-btn>
            
            <v-btn 
              v-if="contract.status === 'ACTIVE' && canCancel"
              color="error" 
              block 
              variant="tonal"
              prepend-icon="mdi-cancel"
              @click="confirmCancel"
            >
              Cancelar Contrato
            </v-btn>

            <v-btn 
              v-if="contract.status === 'ACTIVE' && canCancel"
              color="warning" 
              block 
              variant="tonal"
              prepend-icon="mdi-clock-alert"
              @click="confirmExpire"
            >
              Marcar como Expirado
            </v-btn>
          </v-card-text>
        </v-card>

        <!-- Nota -->
        <v-card v-if="contract.note" class="mt-3">
          <v-card-title>Nota</v-card-title>
          <v-card-text>{{ contract.note }}</v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Dialog: Registrar Abono -->
    <v-dialog v-model="paymentDialog" max-width="500">
      <v-card>
        <v-card-title>
          <v-icon start color="success">mdi-cash-plus</v-icon>
          Registrar Abono
        </v-card-title>
        <v-card-text>
          <v-form ref="paymentForm">
            <v-select
              v-model="paymentData.payment_method_code"
              :items="paymentMethods"
              item-title="name"
              item-value="code"
              label="Método de pago *"
              prepend-inner-icon="mdi-cash"
              variant="outlined"
              density="compact"
              :rules="[rules.required]"
              class="mb-2"
            ></v-select>

            <v-text-field
              v-model.number="paymentData.amount"
              type="number"
              label="Monto *"
              prepend-inner-icon="mdi-currency-usd"
              variant="outlined"
              density="compact"
              :rules="[rules.required, rules.positive]"
              :hint="`Saldo pendiente: ${formatMoney(contract.balance)}`"
              persistent-hint
              class="mb-2"
              min="0"
            ></v-text-field>

            <v-text-field
              v-model="paymentData.reference"
              label="Referencia (opcional)"
              prepend-inner-icon="mdi-tag"
              variant="outlined"
              density="compact"
            ></v-text-field>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="paymentDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="success" :loading="savingPayment" @click="savePayment">
            Registrar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog: Confirmar Completar -->
    <v-dialog v-model="completeDialog" max-width="400">
      <v-card>
        <v-card-title>
          <v-icon start color="primary">mdi-check-circle</v-icon>
          Completar Contrato
        </v-card-title>
        <v-card-text>
          ¿Desea completar el contrato y generar la factura por {{ formatMoney(contract.total) }}?
          <v-alert class="mt-3" type="info" density="compact">
            El inventario reservado será liberado y descontado del stock físico.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="completeDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="completing" @click="completeContract">
            Completar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog: Confirmar Cancelar -->
    <v-dialog v-model="cancelDialog" max-width="400">
      <v-card>
        <v-card-title>
          <v-icon start color="error">mdi-cancel</v-icon>
          {{ cancelAction === 'CANCELLED' ? 'Cancelar Contrato' : 'Marcar como Expirado' }}
        </v-card-title>
        <v-card-text>
          <p>{{ cancelAction === 'CANCELLED' ? '¿Desea cancelar este contrato?' : '¿Desea marcar este contrato como expirado?' }}</p>
          <v-alert class="mt-3" type="warning" density="compact">
            El inventario reservado será liberado. Los abonos realizados NO se reembolsan automáticamente.
          </v-alert>
          <v-textarea 
            v-model="cancelNote" 
            label="Motivo (opcional)" 
            variant="outlined" 
            rows="2" 
            density="compact"
            class="mt-3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="cancelDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn :color="cancelAction === 'CANCELLED' ? 'error' : 'warning'" :loading="cancelling" @click="cancelContract">
            Confirmar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
  <div v-else class="text-center py-8">
    <v-progress-circular indeterminate color="primary"></v-progress-circular>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTenant } from '@/composables/useTenant'
import { useAuth } from '@/composables/useAuth'
import { usePrint } from '@/composables/usePrint'
import layawayService from '@/services/layaway.service'
import paymentMethodsService from '@/services/paymentMethods.service'
import cashService from '@/services/cash.service'
import supabaseService from '@/services/supabase.service'
import { humanizeAppError } from '@/utils/appErrors'
import { formatMoney, formatDateTimeFull as formatDate } from '@/utils/formatters'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const { tenantId } = useTenant()
const { userProfile, hasPermission } = useAuth()
const { printing, printLayawayContract, printPaymentReceipt } = usePrint()

const canAddPayment = hasPermission('LAYAWAY.PAYMENT.ADD')
const canComplete = hasPermission('LAYAWAY.COMPLETE')
const canCancel = hasPermission('LAYAWAY.CANCEL')

const contract = ref(null)
const paymentMethods = ref([])
const currentSession = ref(null)

const paymentDialog = ref(false)
const completeDialog = ref(false)
const cancelDialog = ref(false)
const cancelAction = ref('CANCELLED')
const cancelNote = ref('')

const savingPayment = ref(false)
const completing = ref(false)
const cancelling = ref(false)

const paymentForm = ref(null)
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

const paymentData = ref({
  payment_method_code: '',
  amount: 0,
  reference: ''
})

const rules = {
  required: v => !!v || 'Campo requerido',
  positive: v => v > 0 || 'Debe ser mayor a 0'
}

const getStatusColor = (status) => ({
  ACTIVE: 'success',
  COMPLETED: 'primary',
  CANCELLED: 'error',
  EXPIRED: 'warning'
}[status] || 'grey')

const getStatusLabel = (status) => ({
  ACTIVE: 'Activo',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado'
}[status] || status)

const handlePrintContract = async () => {
  if (!contract.value) return
  
  // Obtener datos del tenant
  const { data: tenant } = await supabaseService.client
    .from('tenants')
    .select('*')
    .eq('tenant_id', tenantId.value)
    .single()
  
  printLayawayContract(contract.value, tenant)
}

const handlePrintPaymentReceipt = async (payment) => {
  if (!contract.value || !payment) return
  
  // Obtener datos del tenant
  const { data: tenant } = await supabaseService.client
    .from('tenants')
    .select('*')
    .eq('tenant_id', tenantId.value)
    .single()
  
  printPaymentReceipt(payment, contract.value, tenant)
}

const loadDetail = async () => {
  const r = await layawayService.getLayawayDetail(tenantId.value, route.params.id)
  if (r.success) {
    contract.value = r.data
  } else {
    showMsg('Error al cargar contrato', 'error')
  }
}

const goBack = () => {
  router.push({ name: 'LayawayContracts' })
}

// ===== ABONO =====
const openPaymentDialog = () => {
  paymentData.value = {
    payment_method_code: paymentMethods.value[0]?.code || '',
    amount: Math.max(0, contract.value.balance),
    reference: ''
  }
  paymentDialog.value = true
}

const savePayment = async () => {
  const { valid } = await paymentForm.value.validate()
  if (!valid) return

  // Validar que haya una caja abierta
  if (!currentSession.value) {
    showMsg('Debe abrir una caja antes de registrar pagos', 'error')
    return
  }

  savingPayment.value = true
  try {
    const r = await layawayService.addPayment(
      tenantId.value,
      contract.value.layaway_id,
      {
        payment_method_code: paymentData.value.payment_method_code,
        amount: paymentData.value.amount,
        paid_by: userProfile.value.user_id,
        cash_session_id: currentSession.value?.cash_session_id || null,
        reference: paymentData.value.reference || null
      }
    )

    if (r.success) {
      showMsg('Abono registrado exitosamente')
      paymentDialog.value = false
      await loadDetail()
    } else {
      showMsg(r.error, 'error')
    }
  } finally {
    savingPayment.value = false
  }
}

// ===== COMPLETAR =====
const confirmComplete = () => {
  completeDialog.value = true
}

const completeContract = async () => {
  completing.value = true
  try {
    const r = await layawayService.completeLayaway(
      tenantId.value,
      contract.value.layaway_id,
      userProfile.value.user_id,
      'Conversión a factura desde Plan Separe'
    )

    if (r.success) {
      showMsg('Contrato completado y facturado exitosamente')
      completeDialog.value = false
      await loadDetail()
    } else {
      showMsg(r.error, 'error')
    }
  } finally {
    completing.value = false
  }
}

// ===== CANCELAR / EXPIRAR =====
const confirmCancel = () => {
  cancelAction.value = 'CANCELLED'
  cancelNote.value = ''
  cancelDialog.value = true
}

const confirmExpire = () => {
  cancelAction.value = 'EXPIRED'
  cancelNote.value = ''
  cancelDialog.value = true
}

const cancelContract = async () => {
  cancelling.value = true
  try {
    const r = await layawayService.cancelLayaway(
      tenantId.value,
      contract.value.layaway_id,
      userProfile.value.user_id,
      cancelAction.value,
      cancelNote.value || null
    )

    if (r.success) {
      showMsg(`Contrato ${cancelAction.value === 'CANCELLED' ? 'cancelado' : 'marcado como expirado'} exitosamente`)
      cancelDialog.value = false
      await loadDetail()
    } else {
      showMsg(r.error, 'error')
    }
  } finally {
    cancelling.value = false
  }
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = color === 'error'
    ? humanizeAppError(msg, { defaultMessage: 'Ocurrió un error en plan separe.' })
    : msg
  snackbarColor.value = color
  snackbar.value = true
}

onMounted(async () => {
  if (!tenantId.value) return

  // Cargar detalle del contrato
  await loadDetail()

  // Cargar métodos de pago
  // Cargar métodos de pago (excluyendo LAYAWAY)
  const pmR = await paymentMethodsService.getPaymentMethodsForDropdown(tenantId.value, 1, 100)
  if (pmR.success) paymentMethods.value = pmR.data

  // Buscar sesión de caja abierta
  const regs = await cashService.getAllCashRegisters(tenantId.value)
  if (regs.success) {
    for (const reg of regs.data) {
      const s = await cashService.getOpenSession(tenantId.value, reg.cash_register_id)
      if (s.success && s.data) {
        currentSession.value = { ...s.data, cash_register: reg }
        break
      }
    }
  }
})
</script>
