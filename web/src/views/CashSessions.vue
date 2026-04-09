<template>
  <div>
    <ListView
      title="Sesiones de Caja"
      icon="mdi-cash-register"
      :items="sessions"
      :total-items="totalSessions"
      :loading="loadingSessions"
      :page-size="defaultPageSize"
      item-key="cash_session_id"
      title-field="cash_session_id"
      avatar-icon="mdi-cash-register"
      :avatar-color="'blue'"
      empty-message="No hay sesiones de caja"
      create-button-text="Abrir Caja"
      :editable="false"
      :deletable="false"
      :clickable="true"
      @create="openSessionDialog"
      @item-click="viewSession"
      @load-page="loadSessions"
      @search="loadSessions"
    >
      <template #title="{ item }">
        {{ item.cash_register?.name || 'Caja' }} — {{ item.cash_register?.location?.name || '' }}
      </template>
      <template #subtitle="{ item }">
        Abierta: {{ formatDate(item.opened_at) }} por {{ item.opened_by_user?.full_name }}
      </template>
      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip
            :color="item.status === 'OPEN' ? 'success' : item.status === 'FORCE_CLOSED' ? 'error' : 'grey'"
            size="small" variant="flat"
          >
            {{ item.status === 'OPEN' ? 'Abierta' : item.status === 'FORCE_CLOSED' ? 'Forzado cierre' : 'Cerrada' }}
          </v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-cash">
            Apertura: {{ formatMoney(item.opening_amount) }}
          </v-chip>
          <v-chip v-if="item.status === 'CLOSED'" size="small" variant="tonal" :color="item.difference >= 0 ? 'success' : 'error'" prepend-icon="mdi-swap-vertical">
            Dif: {{ formatMoney(item.difference) }}
          </v-chip>
          <v-chip v-if="item.status === 'OPEN' && isExpired(item)" size="small" variant="tonal" color="error" prepend-icon="mdi-clock-alert">
            {{ sessionHours(item) }}h abierta
          </v-chip>
        </div>
        <!-- Botones en móvil - debajo del contenido -->
        <div v-if="item.status === 'OPEN'" class="d-flex d-sm-none flex-wrap ga-2 mt-2">
          <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-swap-vertical" @click.stop="openMovementDialog(item)">Movimiento</v-btn>
          <v-btn size="small" color="error" variant="tonal" prepend-icon="mdi-lock" @click.stop="openCloseDialog(item)">{{ t('common.close') }}</v-btn>
          <v-btn v-if="isAdmin && isExpired(item)" size="small" color="deep-orange" variant="flat" prepend-icon="mdi-lock-alert" @click.stop="confirmForceClose(item)">Forzar cierre</v-btn>
        </div>
      </template>
      <template #actions="{ item }">
        <!-- Botones en desktop - al lado derecho -->
        <div class="d-none d-sm-flex ga-1">
          <v-btn v-if="item.status === 'OPEN'" size="small" color="primary" variant="tonal" prepend-icon="mdi-swap-vertical" @click.stop="openMovementDialog(item)">Movimiento</v-btn>
          <v-btn v-if="item.status === 'OPEN'" size="small" color="error" variant="tonal" prepend-icon="mdi-lock" @click.stop="openCloseDialog(item)">{{ t('common.close') }}</v-btn>
          <v-btn v-if="isAdmin && item.status === 'OPEN' && isExpired(item)" size="small" color="deep-orange" variant="flat" prepend-icon="mdi-lock-alert" @click.stop="confirmForceClose(item)">Forzar cierre</v-btn>
        </div>
      </template>
    </ListView>

    <!-- Dialog Abrir Caja -->
    <v-dialog v-model="sessionDialog" max-width="500">
      <v-card>
        <v-card-title><v-icon start color="success">mdi-lock-open</v-icon>Abrir Sesión de Caja</v-card-title>
        <v-card-text>
          <v-form ref="sessionForm">
            <v-select v-model="sessionData.cash_register_id" label="Caja registradora" prepend-inner-icon="mdi-desktop-classic" variant="outlined" :items="registerOptions" item-title="label" item-value="cash_register_id" :rules="[rules.required]" class="mb-2"></v-select>
            <v-text-field v-model.number="sessionData.opening_amount" label="Monto de apertura" prepend-inner-icon="mdi-cash" variant="outlined" type="number" :rules="[rules.positive]"></v-text-field>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="sessionDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="success" :loading="savingSession" @click="openSession">Abrir Caja</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Cerrar Caja -->
    <v-dialog v-model="closeDialog" max-width="700" scrollable class="cash-close-dialog">
      <v-card :class="['cash-close-modal', isDark ? 'cash-close-modal--dark' : 'cash-close-modal--light']">
        <v-card-title class="cash-close-modal__header">
          <div class="d-flex align-center ga-2">
            <v-icon color="error">mdi-lock</v-icon>
            <span>Cerrar Sesión de Caja</span>
          </div>
          <v-spacer></v-spacer>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            class="cash-close-modal__close"
            @click="closeDialog = false"
          />
        </v-card-title>
        <v-card-text v-if="closeSummary" class="cash-close-modal__body">
          <!-- Información de la sesión -->
          <v-alert type="info" variant="tonal" class="mb-3 cash-close-modal__session-info">
            <strong>Caja:</strong> {{ selectedSession?.cash_register?.name }}<br>
            <strong>Abierta:</strong> {{ formatDate(selectedSession?.opened_at) }}<br>
            <strong>Por:</strong> {{ selectedSession?.opened_by_user?.full_name }}
          </v-alert>

          <!-- Resumen de ventas -->
          <v-card variant="outlined" class="mb-3 cash-close-section cash-close-section--sales">
            <v-card-title class="text-subtitle-1 cash-close-section__title">
              <v-icon start>mdi-receipt</v-icon>Resumen de Ventas
            </v-card-title>
            <v-card-text>
              <v-row dense>
                <v-col cols="6">
                  <div class="text-caption text-grey">Total Ventas</div>
                  <div class="text-h6">{{ closeSummary.sales_count }}</div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption text-grey">Ingresos por Ventas</div>
                  <div class="text-h6 text-success">{{ formatMoney(closeSummary.sales_total) }}</div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <!-- Abonos Plan Separe -->
          <v-card v-if="closeSummary.layaway_count > 0" variant="outlined" class="mb-3 cash-close-section cash-close-section--layaway">
            <v-card-title class="text-subtitle-1 cash-close-section__title">
              <v-icon start>mdi-calendar-clock</v-icon>Abonos Plan Separe
            </v-card-title>
            <v-card-text>
              <v-row dense>
                <v-col cols="6">
                  <div class="text-caption text-grey">Total Abonos</div>
                  <div class="text-h6">{{ closeSummary.layaway_count }}</div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption text-grey">Ingresos por Abonos</div>
                  <div class="text-h6 text-success">{{ formatMoney(closeSummary.layaway_total) }}</div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <!-- Resumen de pagos por método -->
          <v-card variant="outlined" class="mb-3 cash-close-section cash-close-section--payments">
            <v-card-title class="text-subtitle-1 cash-close-section__title">
              <v-icon start>mdi-credit-card</v-icon>Pagos por Método
            </v-card-title>
            <v-card-text>
              <v-table density="compact" class="cash-close-table">
                <tbody>
                  <tr v-for="pm in closeSummary.payments_by_method" :key="pm.code">
                    <td>{{ pm.name }}</td>
                    <td class="text-right font-weight-bold">{{ formatMoney(pm.total) }}</td>
                  </tr>
                  <tr v-if="closeSummary.payments_by_method.length === 0">
                    <td colspan="2" class="text-center text-grey">Sin pagos</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
          </v-card>

          <!-- Movimientos de caja -->
          <v-card variant="outlined" class="mb-3 cash-close-section cash-close-section--movements">
            <v-card-title class="text-subtitle-1 cash-close-section__title">
              <v-icon start>mdi-swap-vertical</v-icon>Movimientos de Caja
            </v-card-title>
            <v-card-text>
              <v-row dense>
                <v-col cols="6">
                  <div class="text-caption text-grey">Ingresos</div>
                  <div class="text-body-1 text-success">{{ formatMoney(closeSummary.income_total) }}</div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption text-grey">Gastos</div>
                  <div class="text-body-1 text-error">{{ formatMoney(closeSummary.expense_total) }}</div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <!-- Arqueo de caja -->
          <v-card variant="outlined" class="mb-3 cash-close-section cash-close-section--counting">
            <v-card-title class="text-subtitle-1 cash-close-section__title">
              <v-icon start>mdi-calculator</v-icon>Arqueo de Caja
            </v-card-title>
            <v-card-text>
              <v-table density="compact" class="mb-3 cash-close-table">
                <tbody>
                  <tr>
                    <td>Monto de apertura</td>
                    <td class="text-right">{{ formatMoney(selectedSession?.opening_amount || 0) }}</td>
                  </tr>
                  <tr>
                    <td>Ventas en efectivo</td>
                    <td class="text-right text-success">+ {{ formatMoney((closeSummary.cash_sales || 0) - (closeSummary.layaway_cash || 0)) }}</td>
                  </tr>
                  <tr v-if="closeSummary.layaway_cash > 0">
                    <td>Abonos plan separe (efectivo)</td>
                    <td class="text-right text-success">+ {{ formatMoney(closeSummary.layaway_cash || 0) }}</td>
                  </tr>
                  <tr>
                    <td>Otros ingresos</td>
                    <td class="text-right text-success">+ {{ formatMoney(closeSummary.income_total) }}</td>
                  </tr>
                  <tr>
                    <td>Gastos</td>
                    <td class="text-right text-error">- {{ formatMoney(closeSummary.expense_total) }}</td>
                  </tr>
                  <tr class="cash-close-expected-row">
                    <td class="font-weight-bold">Efectivo Esperado</td>
                    <td class="text-right font-weight-bold">{{ formatMoney(closeSummary.expected_cash) }}</td>
                  </tr>
                </tbody>
              </v-table>

              <!-- Input del efectivo contado -->
              <v-form ref="closeForm">
                <v-text-field 
                  v-model.number="closeData.closing_amount_counted" 
                  label="Efectivo contado en caja" 
                  prepend-inner-icon="mdi-cash" 
                  variant="outlined" 
                  type="number" 
                  :rules="[rules.required, rules.positive]"
                  class="mb-2 cash-close-input"
                ></v-text-field>
              </v-form>

              <!-- Diferencia calculada -->
              <v-alert v-if="closeData.closing_amount_counted !== null" :type="difference === 0 ? 'success' : (difference > 0 ? 'warning' : 'error')" variant="tonal" class="cash-close-difference">
                <div class="d-flex justify-space-between align-center">
                  <span class="font-weight-bold">Diferencia:</span>
                  <span class="text-h6">{{ formatMoney(difference) }}</span>
                </div>
                <div class="text-caption mt-1">
                  {{ difference === 0 ? '✓ Cuadra perfecto' : (difference > 0 ? 'Sobrante en caja' : 'Faltante en caja') }}
                </div>
              </v-alert>
            </v-card-text>
          </v-card>
        </v-card-text>
        <v-card-actions class="cash-close-modal__actions">
          <v-spacer></v-spacer>
          <v-btn class="cash-close-modal__cancel" @click="closeDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn class="cash-close-modal__confirm" color="error" :loading="closingSession" @click="closeSession" prepend-icon="mdi-lock">Cerrar Caja</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Detalle Sesión con Movimientos -->
    <v-dialog v-model="detailDialog" max-width="600" scrollable>
      <v-card>
        <v-card-title>
          Detalle de Sesión
          <v-btn v-if="selectedSession?.status === 'OPEN'" class="ml-4" size="small" color="primary" variant="tonal" prepend-icon="mdi-plus" @click="openMovementDialog">Registrar Movimiento</v-btn>
        </v-card-title>
        <v-card-text>
          <v-list density="compact">
            <v-list-item v-for="m in sessionMovements" :key="m.cash_movement_id">
              <v-list-item-title>
                <v-chip :color="m.type === 'INCOME' ? 'success' : 'error'" size="x-small" variant="flat" class="mr-2">{{ m.type === 'INCOME' ? 'Ingreso' : 'Gasto' }}</v-chip>
                {{ formatMoney(m.amount) }}
              </v-list-item-title>
              <v-list-item-subtitle>{{ m.category || '' }} {{ m.note ? '— ' + m.note : '' }} | {{ formatDate(m.created_at) }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <v-alert v-if="sessionMovements.length === 0" type="info" variant="tonal" class="mt-2">Sin movimientos</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="detailDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Movimiento -->
    <v-dialog v-model="movementDialog" max-width="500">
      <v-card>
        <v-card-title><v-icon start>mdi-swap-vertical</v-icon>Registrar Movimiento</v-card-title>
        <v-card-text v-if="selectedSessionForMovement">
          <v-alert type="info" variant="tonal" class="mb-3">
            <strong>Caja:</strong> {{ selectedSessionForMovement.cash_register?.name }}<br>
            <strong>Sede:</strong> {{ selectedSessionForMovement.cash_register?.location?.name }}
          </v-alert>
          <v-form ref="movementForm">
            <v-select v-model="movementData.type" :label="t('common.type')" variant="outlined" :items="[{title:'Ingreso',value:'INCOME'},{title:'Gasto',value:'EXPENSE'}]" :rules="[rules.required]" class="mb-2"></v-select>
            <v-text-field v-model="movementData.category" label="Categoría" variant="outlined" hint="Ej: Gasto operativo, Compra insumos, Pago servicios" persistent-hint class="mb-3"></v-text-field>
            <v-text-field v-model.number="movementData.amount" label="Monto" prepend-inner-icon="mdi-cash" variant="outlined" type="number" :rules="[rules.required, rules.minAmount]" class="mb-2"></v-text-field>
            <v-textarea v-model="movementData.note" label="Nota / Descripción" variant="outlined" rows="3"></v-textarea>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="movementDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="savingMovement" @click="saveMovement">{{ t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Forzar Cierre -->
    <v-dialog v-model="forceCloseDialogVisible" max-width="460">
      <v-card border="error lg">
        <v-card-title>
          <v-icon start color="deep-orange">mdi-lock-alert</v-icon>
          Forzar cierre de caja
        </v-card-title>
        <v-card-text>
          <v-alert type="warning" variant="tonal" class="mb-3">
            Esta acción cierra la sesión sin hacer arqueo. Las ventas quedan registradas pero <strong>no habrá conteo de efectivo</strong>.
          </v-alert>
          <div v-if="selectedSession" class="text-body-2">
            <strong>Caja:</strong> {{ selectedSession.cash_register?.name }}<br>
            <strong>Abierta:</strong> {{ formatDate(selectedSession.opened_at) }}<br>
            <strong>Por:</strong> {{ selectedSession.opened_by_user?.full_name }}<br>
            <strong>Tiempo abierta:</strong> {{ sessionHours(selectedSession) }} horas
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="forceCloseDialogVisible = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="deep-orange" variant="flat" :loading="forcingClose" prepend-icon="mdi-lock-alert" @click="doForceClose">
            Forzar cierre
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAuth } from '@/composables/useAuth'
import { useTheme } from '@/composables/useTheme'
import ListView from '@/components/ListView.vue'
import cashService from '@/services/cash.service'
import supabaseService from '@/services/supabase.service'
import { humanizeAppError } from '@/utils/appErrors'
import { formatMoney, formatDateTimeFull as formatDate } from '@/utils/formatters'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { tenantId } = useTenant()
const { defaultPageSize, cashSessionMaxHours, loadSettings } = useTenantSettings()
const { userProfile } = useAuth()
const { isDark } = useTheme()

// Sesiones
const sessions = ref([])
const totalSessions = ref(0)
const loadingSessions = ref(false)
const sessionDialog = ref(false)
const closeDialog = ref(false)
const detailDialog = ref(false)
const movementDialog = ref(false)
const savingSession = ref(false)
const closingSession = ref(false)
const savingMovement = ref(false)
const selectedSession = ref(null)
const selectedSessionForMovement = ref(null)
const sessionMovements = ref([])
const sessionForm = ref(null)
const closeForm = ref(null)
const movementForm = ref(null)
const sessionData = ref({ cash_register_id: null, opening_amount: 0 })
const closeData = ref({ closing_amount_counted: null })
const closeSummary = ref(null)
const movementData = ref({ type: 'EXPENSE', category: '', amount: 0, note: '' })
const registerOptions = ref([])

const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

// Forzar cierre
const forceCloseDialogVisible = ref(false)
const forcingClose = ref(false)

const isAdmin = computed(() => userProfile.value?.roles?.some(r => r.name === 'ADMINISTRADOR') ?? false)
const isExpired = (item) => item?.status === 'OPEN' && (Date.now() - new Date(item.opened_at)) / 3600000 >= cashSessionMaxHours.value
const sessionHours = (item) => Math.floor((Date.now() - new Date(item?.opened_at)) / 3600000)

const rules = {
  required: v => (v !== '' && v !== null && v !== undefined) || 'Campo requerido',
  positive: v => v >= 0 || 'Debe ser >= 0',
  minAmount: v => v > 0 || 'Debe ser mayor a 0'
}

// Computed para diferencia en el arqueo
const difference = computed(() => {
  if (closeData.value.closing_amount_counted === null || !closeSummary.value) return 0
  return closeData.value.closing_amount_counted - (closeSummary.value.expected_cash || 0)
})

// ---- Sesiones ----
const loadSessions = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loadingSessions.value = true
  try {
    const r = await cashService.getCashSessions(tid, page, pageSize, search)
    if (r.success) { sessions.value = r.data; totalSessions.value = r.total }
  } finally { loadingSessions.value = false }
}

const openSessionDialog = async () => {
  sessionData.value = { cash_register_id: null, opening_amount: 0 }
  const r = await cashService.getAllCashRegisters(tenantId.value)
  if (r.success) registerOptions.value = r.data.map(x => ({ ...x, label: `${x.name} — ${x.location?.name || ''}` }))
  sessionDialog.value = true
}

const openSession = async () => {
  const { valid } = await sessionForm.value.validate()
  if (!valid || !tenantId.value) return
  savingSession.value = true
  try {
    const r = await cashService.openCashSession(tenantId.value, sessionData.value.cash_register_id, userProfile.value?.user_id, sessionData.value.opening_amount)
    if (r.success) { showMsg('Caja abierta'); sessionDialog.value = false; loadSessions({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error, 'error')
  } finally { savingSession.value = false }
}

const openCloseDialog = async (item) => { 
  selectedSession.value = item
  closeData.value = { closing_amount_counted: null }
  closeSummary.value = null
  
  // Cargar resumen de la sesión
  try {
    // 1. Ventas totales
    const { data: sales } = await supabaseService.client
      .from('sales')
      .select('sale_id, total')
      .eq('tenant_id', tenantId.value)
      .eq('cash_session_id', item.cash_session_id)
      .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
    
    // 2. Pagos de ventas por método
    const { data: payments } = await supabaseService.client
      .from('sale_payments')
      .select(`
        amount,
        payment_method:payment_method_id(code, name),
        sale:sale_id!inner(cash_session_id, tenant_id)
      `)
      .eq('sale.tenant_id', tenantId.value)
      .eq('sale.cash_session_id', item.cash_session_id)
    
    // 3. Abonos de plan separe por método
    const { data: layawayPayments } = await supabaseService.client
      .from('layaway_payments')
      .select(`
        amount,
        payment_method:payment_method_id(code, name)
      `)
      .eq('tenant_id', tenantId.value)
      .eq('cash_session_id', item.cash_session_id)
    
    // 4. Movimientos de caja
    const { data: movements } = await supabaseService.client
      .from('cash_movements')
      .select('type, amount')
      .eq('tenant_id', tenantId.value)
      .eq('cash_session_id', item.cash_session_id)
    
    // Calcular totales
    const sales_total = (sales || []).reduce((sum, s) => sum + parseFloat(s.total || 0), 0)
    const sales_count = (sales || []).length
    
    // Totales de abonos de plan separe
    const layaway_total = (layawayPayments || []).reduce((sum, p) => sum + parseFloat(p.amount || 0), 0)
    const layaway_count = (layawayPayments || []).length
    let layaway_cash = 0
    
    // Agrupar pagos por método (ventas + abonos plan separe)
    const paymentGroups = {}
    let cash_sales = 0
    
    // Pagos de ventas
    ;(payments || []).forEach(p => {
      const code = p.payment_method?.code || 'N/A'
      const name = p.payment_method?.name || 'Otro'
      const amount = parseFloat(p.amount || 0)
      
      if (!paymentGroups[code]) {
        paymentGroups[code] = { code, name, total: 0 }
      }
      paymentGroups[code].total += amount
      
      // Sumar efectivo
      if (code === 'EFECTIVO' || code === 'CASH') {
        cash_sales += amount
      }
    })
    
    // Abonos de plan separe
    ;(layawayPayments || []).forEach(p => {
      const code = p.payment_method?.code || 'N/A'
      const name = p.payment_method?.name || 'Otro'
      const amount = parseFloat(p.amount || 0)
      
      if (!paymentGroups[code]) {
        paymentGroups[code] = { code, name, total: 0 }
      }
      paymentGroups[code].total += amount
      
      // Sumar efectivo de abonos
      if (code === 'EFECTIVO' || code === 'CASH') {
        layaway_cash += amount
        cash_sales += amount
      }
    })
    
    // Sumar movimientos
    let income_total = 0
    let expense_total = 0
    ;(movements || []).forEach(m => {
      const amount = parseFloat(m.amount || 0)
      if (m.type === 'INCOME') income_total += amount
      else expense_total += amount
    })
    
    // Calcular efectivo esperado = apertura + ventas efectivo + abonos efectivo + ingresos - gastos
    const expected_cash = (parseFloat(item.opening_amount) || 0) + cash_sales + income_total - expense_total
    
    closeSummary.value = {
      sales_count,
      sales_total,
      layaway_count,
      layaway_total,
      layaway_cash,
      payments_by_method: Object.values(paymentGroups),
      cash_sales,
      income_total,
      expense_total,
      expected_cash
    }
  } catch (error) {
    console.error('Error loading close summary:', error)
  }
  
  closeDialog.value = true
}

const closeSession = async () => {
  const { valid } = await closeForm.value.validate()
  if (!valid || !selectedSession.value) return
  closingSession.value = true
  try {
    const r = await cashService.closeCashSession(tenantId.value, selectedSession.value.cash_session_id, userProfile.value?.user_id, closeData.value.closing_amount_counted)
    if (r.success) { showMsg('Caja cerrada'); closeDialog.value = false; loadSessions({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error, 'error')
  } finally { closingSession.value = false }
}

const viewSession = async (item) => {
  selectedSession.value = item
  const r = await cashService.getCashMovements(tenantId.value, item.cash_session_id)
  sessionMovements.value = r.success ? r.data : []
  detailDialog.value = true
}

const openMovementDialog = (item) => { 
  selectedSessionForMovement.value = item
  movementData.value = { type: 'EXPENSE', category: '', amount: 0, note: '' }
  movementDialog.value = true 
}

const saveMovement = async () => {
  const { valid } = await movementForm.value.validate()
  if (!valid || !selectedSessionForMovement.value) return
  savingMovement.value = true
  try {
    const r = await cashService.createCashMovement(tenantId.value, selectedSessionForMovement.value.cash_session_id, movementData.value, userProfile.value?.user_id)
    if (r.success) {
      showMsg('Movimiento registrado')
      movementDialog.value = false
      loadSessions({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
    } else showMsg(r.error, 'error')
  } finally { savingMovement.value = false }
}

const confirmForceClose = (item) => {
  selectedSession.value = item
  forceCloseDialogVisible.value = true
}

const doForceClose = async () => {
  if (!selectedSession.value) return
  forcingClose.value = true
  try {
    const r = await cashService.forceCloseSession(
      tenantId.value,
      selectedSession.value.cash_session_id,
      userProfile.value?.user_id
    )
    if (r.success) {
      showMsg('Sesión cerrada forzosamente')
      forceCloseDialogVisible.value = false
      loadSessions({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
    } else {
      showMsg(r.error || 'Error al forzar cierre', 'error')
    }
  } finally {
    forcingClose.value = false
  }
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = color === 'error'
    ? humanizeAppError(msg, { defaultMessage: 'Ocurrió un error en caja.' })
    : msg
  snackbarColor.value = color
  snackbar.value = true
}

onMounted(async () => {
  await loadSettings()
})
</script>

<style scoped>
.cash-close-modal {
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  background: linear-gradient(145deg, rgba(14, 23, 45, 0.96), rgba(8, 15, 30, 0.96)) !important;
  box-shadow: 0 20px 38px rgba(6, 12, 28, 0.34);
}

.cash-close-modal__header {
  min-height: 60px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.22);
  background: linear-gradient(120deg, rgba(236, 86, 74, 0.93), rgba(196, 54, 42, 0.9));
  color: #fff5f4;
  letter-spacing: 0.2px;
}

.cash-close-modal__close {
  border-radius: 12px;
  color: inherit;
  background: rgba(255, 255, 255, 0.14);
}

.cash-close-modal__body {
  padding: 16px !important;
}

.cash-close-modal__session-info {
  border-radius: 14px;
  border: 1px solid rgba(120, 164, 255, 0.26);
}

.cash-close-section {
  --cash-section-accent: 77, 129, 255;
  border-radius: 14px;
  border-color: rgba(var(--cash-section-accent), 0.26) !important;
  background: linear-gradient(145deg, rgba(14, 23, 44, 0.62), rgba(10, 18, 35, 0.52));
  overflow: hidden;
}

.cash-close-section__title {
  min-height: 50px;
  border-bottom: 1px solid rgba(var(--cash-section-accent), 0.24);
  background: linear-gradient(120deg, rgba(var(--cash-section-accent), 0.22), rgba(var(--cash-section-accent), 0.08));
}

.cash-close-section--sales {
  --cash-section-accent: 58, 127, 255;
}

.cash-close-section--layaway {
  --cash-section-accent: 108, 99, 255;
}

.cash-close-section--payments {
  --cash-section-accent: 53, 171, 95;
}

.cash-close-section--movements {
  --cash-section-accent: 244, 146, 52;
}

.cash-close-section--counting {
  --cash-section-accent: 166, 98, 235;
}

.cash-close-table {
  background: transparent !important;
}

.cash-close-table :deep(td) {
  border-bottom-color: rgba(var(--v-theme-primary), 0.14) !important;
}

.cash-close-expected-row {
  background: linear-gradient(100deg, rgba(255, 255, 255, 0.93), rgba(238, 245, 255, 0.9));
  color: #111827;
}

.cash-close-input :deep(.v-field) {
  border-radius: 12px;
}

.cash-close-difference {
  border-radius: 12px;
}

.cash-close-modal__actions {
  border-top: 1px solid rgba(var(--v-theme-primary), 0.18);
  padding: 14px 16px !important;
  gap: 10px;
}

.cash-close-modal__cancel,
.cash-close-modal__confirm {
  border-radius: 10px;
  font-weight: 700;
  letter-spacing: 0.25px;
}

.cash-close-modal--light {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(243, 249, 255, 0.96)) !important;
  border-color: rgba(39, 92, 219, 0.16);
  box-shadow: 0 18px 30px rgba(22, 42, 85, 0.16);
}

.cash-close-modal--light .cash-close-section {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(241, 247, 255, 0.95));
  color: #172033;
  border-color: rgba(var(--cash-section-accent), 0.2) !important;
}

.cash-close-modal--light .cash-close-section__title {
  color: #162238;
  border-bottom-color: rgba(var(--cash-section-accent), 0.18);
  background: linear-gradient(120deg, rgba(var(--cash-section-accent), 0.16), rgba(255, 255, 255, 0.82));
}

.cash-close-modal--light .cash-close-table :deep(td) {
  color: #1f2a3d;
  border-bottom-color: rgba(23, 33, 54, 0.08) !important;
}

.cash-close-modal--light .cash-close-modal__session-info {
  background: linear-gradient(145deg, rgba(233, 244, 255, 0.98), rgba(245, 250, 255, 0.96)) !important;
  color: #143153;
  border-color: rgba(58, 127, 255, 0.2);
}

.cash-close-modal--light .cash-close-input :deep(.v-field),
.cash-close-modal--light .cash-close-difference {
  background: rgba(255, 255, 255, 0.96);
}

.cash-close-modal--light .cash-close-modal__close {
  background: rgba(255, 255, 255, 0.28);
}

.cash-close-modal--light .cash-close-expected-row {
  background: linear-gradient(100deg, rgba(236, 246, 255, 0.92), rgba(224, 240, 255, 0.9));
}

@media (max-width: 600px) {
  .cash-close-modal__body {
    padding: 12px !important;
  }

  .cash-close-modal__actions {
    padding: 12px !important;
  }
}
</style>
