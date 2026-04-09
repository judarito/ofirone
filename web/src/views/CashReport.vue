<template>
  <div>
    <div v-if="isFromAccounting" class="mb-3">
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-arrow-left"
        @click="goBackToAccounting"
      >
        Volver a Contabilidad
      </v-btn>
    </div>

    <v-breadcrumbs :items="breadcrumbs" class="pa-0 mb-4">
      <template #divider><v-icon>mdi-chevron-right</v-icon></template>
    </v-breadcrumbs>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon start color="orange">mdi-cash-multiple</v-icon>
        {{ t('reports.cashTitle') }}
      </v-card-title>
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-text-field v-model="fromDate" type="date" :label="t('reports.from')" variant="outlined" density="compact" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field v-model="toDate" type="date" :label="t('reports.to')" variant="outlined" density="compact" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="3">
            <v-select v-model="locationFilter" :items="locations" item-title="name" item-value="location_id" :label="t('app.branch')" variant="outlined" density="compact" hide-details clearable></v-select>
          </v-col>
          <v-col cols="12" sm="3">
            <v-btn color="orange" prepend-icon="mdi-magnify" @click="loadAll" :loading="loading">{{ t('reports.query') }}</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- KPIs Cajas -->
    <v-row class="mb-4">
      <v-col cols="6" sm="3">
        <v-card color="orange" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ sessions.length }}</div>
            <div class="text-caption">Sesiones</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card color="blue" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ totalSalesCount }}</div>
            <div class="text-caption">Transacciones</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card color="green" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(totalSalesAmount) }}</div>
            <div class="text-caption">Total Vendido</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card :color="sessionsWithDiff > 0 ? 'error' : 'success'" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ sessionsWithDiff }}</div>
            <div class="text-caption">Sesiones con Diferencias</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-tabs v-model="tab" color="orange" class="mb-4">
      <v-tab value="by-register">Ventas por Caja</v-tab>
      <v-tab value="by-cashier">Ventas por Cajero</v-tab>
      <v-tab value="sessions">Sesiones</v-tab>
      <v-tab value="differences">
        <v-badge v-if="sessionsWithDiff > 0" :content="sessionsWithDiff" color="error">
          Sesiones con Diferencias
        </v-badge>
        <span v-else>Sesiones con Diferencias</span>
      </v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- Ventas por Caja -->
      <v-window-item value="by-register">
        <v-card>
          <v-card-title><v-icon start>mdi-cash-register</v-icon>Ventas por Caja Registradora</v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr><th>Caja</th><th>Sede</th><th class="text-center">Transacciones</th><th class="text-right">Total Ventas</th><th class="text-right">Promedio/Venta</th></tr>
            </thead>
            <tbody>
              <tr v-for="reg in byCashRegister" :key="reg.cash_register_id">
                <td class="font-weight-bold">{{ reg.name }}</td>
                <td>{{ reg.location }}</td>
                <td class="text-center">{{ reg.count }}</td>
                <td class="text-right font-weight-bold text-success">{{ formatMoney(reg.total) }}</td>
                <td class="text-right text-grey">{{ formatMoney(reg.count > 0 ? reg.total / reg.count : 0) }}</td>
              </tr>
              <tr v-if="byCashRegister.length === 0">
                <td colspan="5" class="text-center text-grey pa-4">Sin datos</td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="reg in byCashRegister" :key="reg.cash_register_id" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="text-body-1 font-weight-bold mb-1">{{ reg.name }}</div>
                <div class="text-caption text-grey mb-2">{{ reg.location }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Transacciones:</span><span class="font-weight-bold">{{ reg.count }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Total:</span><span class="font-weight-bold text-success">{{ formatMoney(reg.total) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Promedio:</span><span>{{ formatMoney(reg.count > 0 ? reg.total / reg.count : 0) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="byCashRegister.length === 0" class="text-center text-grey pa-4">Sin datos</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Ventas por Cajero -->
      <v-window-item value="by-cashier">
        <v-card>
          <v-card-title><v-icon start>mdi-account-cash</v-icon>Ventas por Cajero/Sesión</v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Cajero</th><th>Caja</th><th>Sede</th>
                <th class="text-right">Ventas</th>
                <th class="text-right">Total</th>
                <th class="text-right">Prom./Venta</th>
                <th class="text-right">Duración (min)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sessions" :key="s.cash_session_id">
                <td class="font-weight-bold">{{ s.opened_by || s.closed_by || '-' }}</td>
                <td>{{ s.register_name }}</td>
                <td>{{ s.location }}</td>
                <td class="text-right">{{ s.sales_count }}</td>
                <td class="text-right font-weight-bold text-success">{{ formatMoney(s.sales_total) }}</td>
                <td class="text-right text-grey">{{ formatMoney(s.avg_per_sale) }}</td>
                <td class="text-right">
                  <v-chip v-if="s.duration_minutes !== null" size="small" color="blue" variant="tonal">
                    {{ s.duration_minutes }} min
                  </v-chip>
                  <span v-else class="text-grey">-</span>
                </td>
              </tr>
              <tr v-if="sessions.length === 0">
                <td colspan="7" class="text-center text-grey pa-4">Sin sesiones</td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="s in sessions" :key="s.cash_session_id" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="text-body-2 font-weight-bold mb-1">{{ s.opened_by || s.closed_by || 'Sin asignar' }}</div>
                <div class="text-caption text-grey mb-2">{{ s.register_name }} • {{ s.location }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Ventas:</span><span class="font-weight-bold">{{ s.sales_count }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Total:</span><span class="font-weight-bold text-success">{{ formatMoney(s.sales_total) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Prom./Venta:</span><span>{{ formatMoney(s.avg_per_sale) }}</span></div>
                <div class="d-flex justify-space-between text-caption" v-if="s.duration_minutes !== null"><span class="text-grey">Duración:</span><span>{{ s.duration_minutes }} min</span></div>
              </v-card-text>
            </v-card>
          </div>
        </v-card>
      </v-window-item>

      <!-- Sesiones Completas -->
      <v-window-item value="sessions">
        <v-card>
          <v-card-title><v-icon start>mdi-calendar-clock</v-icon>Todas las Sesiones</v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Caja</th><th>Estado</th><th>Apertura</th><th>Cierre</th>
                <th class="text-right">Monto Apertura</th><th class="text-right">Monto Cierre</th>
                <th class="text-right">Declarado</th><th class="text-right">Ventas</th><th class="text-right"># Ventas</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sessions" :key="s.cash_session_id">
                <td>
                  <div class="font-weight-bold">{{ s.register_name }}</div>
                  <div class="text-caption text-grey">{{ s.location }}</div>
                </td>
                <td>
                  <v-chip :color="s.status === 'OPEN' ? 'success' : s.status === 'CLOSED' ? 'grey' : 'warning'" size="small" variant="flat">
                    {{ s.status === 'OPEN' ? 'Abierta' : 'Cerrada' }}
                  </v-chip>
                </td>
                <td>
                  <div class="text-body-2">{{ formatDateTime(s.opened_at) }}</div>
                  <div class="text-caption text-grey">{{ s.opened_by }}</div>
                </td>
                <td>
                  <div class="text-body-2">{{ s.closed_at ? formatDateTime(s.closed_at) : '-' }}</div>
                  <div class="text-caption text-grey" v-if="s.closed_by">{{ s.closed_by }}</div>
                </td>
                <td class="text-right">{{ formatMoney(s.opening_amount) }}</td>
                <td class="text-right">{{ formatMoney(s.closing_amount) }}</td>
                <td class="text-right">
                  <span :class="s.has_difference ? 'text-error font-weight-bold' : ''">
                    {{ s.declared_amount > 0 ? formatMoney(s.declared_amount) : '-' }}
                  </span>
                </td>
                <td class="text-right font-weight-bold text-success">{{ formatMoney(s.sales_total) }}</td>
                <td class="text-right">{{ s.sales_count }}</td>
              </tr>
              <tr v-if="sessions.length === 0">
                <td colspan="9" class="text-center text-grey pa-4">Sin sesiones</td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="s in sessions" :key="s.cash_session_id" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center justify-space-between mb-2">
                  <div class="text-body-2 font-weight-bold">{{ s.register_name }}</div>
                  <v-chip :color="s.status === 'OPEN' ? 'success' : 'grey'" size="x-small" variant="flat">
                    {{ s.status === 'OPEN' ? 'Abierta' : 'Cerrada' }}
                  </v-chip>
                </div>
                <div class="text-caption text-grey mb-2">{{ s.location }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Apertura:</span><span>{{ formatDateTime(s.opened_at) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1" v-if="s.closed_at"><span class="text-grey">Cierre:</span><span>{{ formatDateTime(s.closed_at) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Ventas:</span><span class="font-weight-bold text-success">{{ formatMoney(s.sales_total) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey"># Transacciones:</span><span>{{ s.sales_count }}</span></div>
              </v-card-text>
            </v-card>
          </div>
        </v-card>
      </v-window-item>

      <!-- Sesiones con Diferencias -->
      <v-window-item value="differences">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon start color="error">mdi-alert-circle</v-icon>
            Sesiones con Diferencias
          </v-card-title>
          <v-card-subtitle class="pb-2">Sesiones donde el monto declarado difiere del monto de cierre reportado.</v-card-subtitle>

          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Caja</th><th>Cajero</th><th>Fecha Cierre</th>
                <th class="text-right">Monto Cierre</th><th class="text-right">Declarado</th>
                <th class="text-right">Diferencia</th><th class="text-right">Total Ventas</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sessionsWithDifferences" :key="s.cash_session_id">
                <td>
                  <div class="font-weight-bold">{{ s.register_name }}</div>
                  <div class="text-caption text-grey">{{ s.location }}</div>
                </td>
                <td>{{ s.closed_by || s.opened_by || '-' }}</td>
                <td>{{ s.closed_at ? formatDate(s.closed_at) : '-' }}</td>
                <td class="text-right">{{ formatMoney(s.closing_amount) }}</td>
                <td class="text-right">{{ formatMoney(s.declared_amount) }}</td>
                <td class="text-right font-weight-bold" :class="s.difference > 0 ? 'text-success' : 'text-error'">
                  {{ s.difference > 0 ? '+' : '' }}{{ formatMoney(s.difference) }}
                </td>
                <td class="text-right">{{ formatMoney(s.sales_total) }}</td>
              </tr>
              <tr v-if="sessionsWithDifferences.length === 0">
                <td colspan="7" class="text-center pa-6">
                  <v-icon size="large" color="success">mdi-check-circle</v-icon>
                  <div class="mt-2 text-grey">No hay sesiones con diferencias</div>
                </td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="s in sessionsWithDifferences" :key="s.cash_session_id" color="error" variant="tonal" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center justify-space-between mb-2">
                  <div class="text-body-2 font-weight-bold">{{ s.register_name }}</div>
                  <v-chip color="error" size="x-small" variant="flat">Diferencia</v-chip>
                </div>
                <div class="text-caption text-grey mb-2">{{ s.location }} • {{ s.closed_by || s.opened_by }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Cierre:</span><span>{{ formatMoney(s.closing_amount) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Declarado:</span><span>{{ formatMoney(s.declared_amount) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Diferencia:</span><span class="font-weight-bold" :class="s.difference > 0 ? 'text-success' : 'text-error'">{{ s.difference > 0 ? '+' : '' }}{{ formatMoney(s.difference) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Ventas:</span><span>{{ formatMoney(s.sales_total) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="sessionsWithDifferences.length === 0" class="text-center pa-4 text-grey">Sin diferencias</div>
          </div>
        </v-card>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '@/i18n'
import { useTenant } from '@/composables/useTenant'
import reportsService from '@/services/reports.service'
import { formatMoney, formatDate, formatDateTime } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const { tenantId } = useTenant()
const { t } = useI18n()

const breadcrumbs = [
  { title: 'Reportes', to: '/reports', disabled: false },
  { title: 'Cajas', disabled: true }
]

const loading = ref(false)
const tab = ref('by-register')
const locations = ref([])
const locationFilter = ref(null)

const now = new Date()
const fromDate = ref(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10))
const toDate = ref(now.toISOString().substring(0, 10))

const sessions = ref([])
const byCashRegister = ref([])

const totalSalesCount = computed(() => sessions.value.reduce((s, x) => s + (x.sales_count || 0), 0))
const totalSalesAmount = computed(() => sessions.value.reduce((s, x) => s + (x.sales_total || 0), 0))
const sessionsWithDiff = computed(() => sessions.value.filter(s => s.has_difference).length)
const sessionsWithDifferences = computed(() => sessions.value.filter(s => s.has_difference))
const isFromAccounting = computed(() => String(route.query.from || '') === 'accounting')

const loadSessions = async () => {
  if (!tenantId.value) return
  const fd = fromDate.value + 'T00:00:00'
  const td = toDate.value + 'T23:59:59'
  const r = await reportsService.getCashSessionsReport(tenantId.value, fd, td, locationFilter.value)
  if (r.success) sessions.value = r.data
}

const loadByCashRegister = async () => {
  if (!tenantId.value) return
  const fd = fromDate.value + 'T00:00:00'
  const td = toDate.value + 'T23:59:59'
  const r = await reportsService.getSalesByCashRegister(tenantId.value, fd, td, locationFilter.value)
  if (r.success) byCashRegister.value = r.data
}

const loadAll = async () => {
  loading.value = true
  try {
    await Promise.all([loadSessions(), loadByCashRegister()])
  } finally {
    loading.value = false
  }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const { default: locService } = await import('@/services/locations.service')
  const r = await locService.getLocations(tenantId.value, 1, 100)
  if (r.success) locations.value = r.data
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({
    path: '/accounting',
    query: { tab }
  })
}

onMounted(async () => {
  await loadLocations()
  loadAll()
})
</script>
