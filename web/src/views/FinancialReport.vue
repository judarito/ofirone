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
        <v-icon start color="teal">mdi-finance</v-icon>
        {{ t('reports.financialTitle') }}
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
            <v-btn color="teal" prepend-icon="mdi-magnify" @click="loadAll" :loading="loading">{{ t('reports.query') }}</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Estado de Resultados -->
    <v-card class="mb-4" v-if="financials">
      <v-card-title class="d-flex align-center">
        <v-icon start color="teal">mdi-bank</v-icon>
        Estado de Resultados
        <v-spacer></v-spacer>
        <v-chip color="teal" variant="tonal">{{ financials.sales_count }} ventas</v-chip>
      </v-card-title>
      <v-card-text>
        <v-row>
          <!-- Columna Izquierda: P&L -->
          <v-col cols="12" md="6">
            <v-list density="compact">
              <v-list-item>
                <template #prepend><v-icon color="green">mdi-plus-circle</v-icon></template>
                <v-list-item-title>Ingresos Brutos por Ventas</v-list-item-title>
                <template #append><span class="text-success font-weight-bold text-body-1">{{ formatMoney(financials.gross_revenue) }}</span></template>
              </v-list-item>
              <v-divider inset></v-divider>
              <v-list-item>
                <template #prepend><v-icon color="orange">mdi-minus-circle-outline</v-icon></template>
                <v-list-item-title>(-) Impuestos</v-list-item-title>
                <template #append><span class="text-orange">{{ formatMoney(financials.tax_total) }}</span></template>
              </v-list-item>
              <v-list-item>
                <template #prepend><v-icon color="orange">mdi-minus-circle-outline</v-icon></template>
                <v-list-item-title>(-) Descuentos otorgados</v-list-item-title>
                <template #append><span class="text-orange">{{ formatMoney(financials.discount_total) }}</span></template>
              </v-list-item>
              <v-divider></v-divider>
              <v-list-item class="bg-teal-lighten-5">
                <template #prepend><v-icon color="teal">mdi-equal</v-icon></template>
                <v-list-item-title class="font-weight-bold">Ingresos Netos por Ventas</v-list-item-title>
                <template #append><span class="text-teal font-weight-bold text-body-1">{{ formatMoney(financials.net_revenue) }}</span></template>
              </v-list-item>
              <v-divider></v-divider>
              <v-list-item>
                <template #prepend><v-icon color="deep-orange">mdi-minus-circle</v-icon></template>
                <v-list-item-title>(-) Costo de Ventas (COGS)</v-list-item-title>
                <template #append><span class="text-deep-orange font-weight-bold">{{ formatMoney(financials.cogs) }}</span></template>
              </v-list-item>
              <v-divider></v-divider>
              <v-list-item class="bg-green-lighten-5">
                <template #prepend><v-icon color="green">mdi-equal</v-icon></template>
                <v-list-item-title class="font-weight-bold">Utilidad Bruta</v-list-item-title>
                <template #append>
                  <div class="text-right">
                    <div class="text-success font-weight-bold text-body-1">{{ formatMoney(financials.gross_profit) }}</div>
                    <div class="text-caption text-grey">Margen: {{ financials.gross_margin }}%</div>
                  </div>
                </template>
              </v-list-item>
              <v-list-item>
                <template #prepend><v-icon color="red">mdi-minus-circle</v-icon></template>
                <v-list-item-title>(-) Gastos Operativos</v-list-item-title>
                <template #append><span class="text-error">{{ formatMoney(financials.operating_expenses) }}</span></template>
              </v-list-item>
              <v-list-item v-if="financials.other_income > 0">
                <template #prepend><v-icon color="blue">mdi-plus-circle-outline</v-icon></template>
                <v-list-item-title>(+) Otros Ingresos</v-list-item-title>
                <template #append><span class="text-blue">{{ formatMoney(financials.other_income) }}</span></template>
              </v-list-item>
              <v-divider></v-divider>
              <v-list-item :class="financials.net_profit >= 0 ? 'bg-green-lighten-5' : 'bg-red-lighten-5'">
                <template #prepend><v-icon :color="financials.net_profit >= 0 ? 'success' : 'error'">mdi-equal</v-icon></template>
                <v-list-item-title class="font-weight-bold text-body-1">Utilidad Neta</v-list-item-title>
                <template #append>
                  <div class="text-right">
                    <div class="font-weight-bold text-h6" :class="financials.net_profit >= 0 ? 'text-success' : 'text-error'">
                      {{ formatMoney(financials.net_profit) }}
                    </div>
                    <div class="text-caption text-grey">Margen Neto: {{ financials.net_margin }}%</div>
                  </div>
                </template>
              </v-list-item>
            </v-list>
          </v-col>

          <!-- Columna Derecha: KPIs visuales -->
          <v-col cols="12" md="6">
            <v-row>
              <v-col cols="6">
                <v-card color="teal" variant="tonal" class="text-center pa-3">
                  <div class="text-h5 font-weight-bold">{{ financials.gross_margin }}%</div>
                  <div class="text-caption">Margen Bruto</div>
                  <v-progress-linear :model-value="financials.gross_margin" color="teal" height="8" rounded class="mt-2"></v-progress-linear>
                </v-card>
              </v-col>
              <v-col cols="6">
                <v-card :color="financials.net_margin >= 0 ? 'green' : 'red'" variant="tonal" class="text-center pa-3">
                  <div class="text-h5 font-weight-bold">{{ financials.net_margin }}%</div>
                  <div class="text-caption">Margen Neto</div>
                  <v-progress-linear :model-value="Math.abs(financials.net_margin)" :color="financials.net_margin >= 0 ? 'green' : 'red'" height="8" rounded class="mt-2"></v-progress-linear>
                </v-card>
              </v-col>
              <v-col cols="6">
                <v-card color="green" variant="tonal" class="text-center pa-3">
                  <div class="text-h6 font-weight-bold">{{ formatMoney(financials.gross_revenue) }}</div>
                  <div class="text-caption">Ingresos Brutos</div>
                </v-card>
              </v-col>
              <v-col cols="6">
                <v-card color="deep-orange" variant="tonal" class="text-center pa-3">
                  <div class="text-h6 font-weight-bold">{{ formatMoney(financials.cogs) }}</div>
                  <div class="text-caption">Costo de Ventas</div>
                </v-card>
              </v-col>
              <v-col cols="6">
                <v-card color="red" variant="tonal" class="text-center pa-3">
                  <div class="text-h6 font-weight-bold">{{ formatMoney(financials.operating_expenses) }}</div>
                  <div class="text-caption">Gastos Operativos</div>
                </v-card>
              </v-col>
              <v-col cols="6">
                <v-card :color="financials.net_profit >= 0 ? 'success' : 'error'" variant="tonal" class="text-center pa-3">
                  <div class="text-h6 font-weight-bold">{{ formatMoney(financials.net_profit) }}</div>
                  <div class="text-caption">Utilidad Neta</div>
                </v-card>
              </v-col>
            </v-row>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Flujo de Efectivo -->
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start color="teal">mdi-cash-flow</v-icon>
        Flujo de Efectivo por Día
        <v-spacer></v-spacer>
        <v-btn size="small" variant="tonal" color="teal" prepend-icon="mdi-refresh" @click="loadCashFlow" :loading="loadingCashFlow">{{ t('common.update') }}</v-btn>
      </v-card-title>

      <!-- Resumen flujo -->
      <v-card-text v-if="cashFlow.length > 0">
        <v-row dense class="mb-2">
          <v-col cols="6" sm="3">
            <div class="text-caption text-grey">Total Ingresos Ventas</div>
            <div class="text-h6 text-success font-weight-bold">{{ formatMoney(totalFlowIncome) }}</div>
          </v-col>
          <v-col cols="6" sm="3">
            <div class="text-caption text-grey">Total Gastos</div>
            <div class="text-h6 text-error font-weight-bold">{{ formatMoney(totalFlowExpenses) }}</div>
          </v-col>
          <v-col cols="6" sm="3">
            <div class="text-caption text-grey">Otros Ingresos Caja</div>
            <div class="text-h6 text-blue font-weight-bold">{{ formatMoney(totalOtherIncome) }}</div>
          </v-col>
          <v-col cols="6" sm="3">
            <div class="text-caption text-grey">Flujo Neto</div>
            <div class="text-h6 font-weight-bold" :class="totalNetFlow >= 0 ? 'text-success' : 'text-error'">{{ formatMoney(totalNetFlow) }}</div>
          </v-col>
        </v-row>
      </v-card-text>

      <!-- Desktop table -->
      <v-table density="comfortable" class="d-none d-sm-table w-100">
        <thead>
          <tr>
            <th>Fecha</th>
            <th class="text-right">Ingresos Ventas</th>
            <th class="text-right">Otros Ingresos</th>
            <th class="text-right">Gastos</th>
            <th class="text-right">Flujo Neto</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in cashFlow" :key="day.date">
            <td>{{ day.date }}</td>
            <td class="text-right text-success">{{ formatMoney(day.ingresos_ventas) }}</td>
            <td class="text-right text-blue">{{ formatMoney(day.otros_ingresos) }}</td>
            <td class="text-right text-error">{{ formatMoney(day.gastos) }}</td>
            <td class="text-right font-weight-bold" :class="day.neto >= 0 ? 'text-success' : 'text-error'">
              {{ day.neto >= 0 ? '+' : '' }}{{ formatMoney(day.neto) }}
            </td>
          </tr>
          <!-- Totales -->
          <tr v-if="cashFlow.length > 0" class="font-weight-bold bg-grey-lighten-4">
            <td>TOTAL</td>
            <td class="text-right text-success">{{ formatMoney(totalFlowIncome) }}</td>
            <td class="text-right text-blue">{{ formatMoney(totalOtherIncome) }}</td>
            <td class="text-right text-error">{{ formatMoney(totalFlowExpenses) }}</td>
            <td class="text-right" :class="totalNetFlow >= 0 ? 'text-success' : 'text-error'">
              {{ totalNetFlow >= 0 ? '+' : '' }}{{ formatMoney(totalNetFlow) }}
            </td>
          </tr>
          <tr v-if="cashFlow.length === 0">
            <td colspan="5" class="text-center text-grey pa-4">Sin datos de flujo de efectivo</td>
          </tr>
        </tbody>
      </v-table>

      <!-- Mobile -->
      <div class="d-sm-none pa-2">
        <v-card v-for="day in cashFlow" :key="day.date" variant="outlined" class="mb-2">
          <v-card-text>
            <div class="text-body-2 font-weight-bold mb-2">{{ day.date }}</div>
            <v-divider class="my-2"></v-divider>
            <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Ventas:</span><span class="text-success">{{ formatMoney(day.ingresos_ventas) }}</span></div>
            <div class="d-flex justify-space-between text-caption mb-1" v-if="day.otros_ingresos > 0"><span class="text-grey">Otros Ingresos:</span><span class="text-blue">{{ formatMoney(day.otros_ingresos) }}</span></div>
            <div class="d-flex justify-space-between text-caption mb-1" v-if="day.gastos > 0"><span class="text-grey">Gastos:</span><span class="text-error">{{ formatMoney(day.gastos) }}</span></div>
            <v-divider class="my-2"></v-divider>
            <div class="d-flex justify-space-between text-caption"><span class="text-grey font-weight-bold">Flujo Neto:</span><span class="font-weight-bold" :class="day.neto >= 0 ? 'text-success' : 'text-error'">{{ day.neto >= 0 ? '+' : '' }}{{ formatMoney(day.neto) }}</span></div>
          </v-card-text>
        </v-card>
        <div v-if="cashFlow.length === 0" class="text-center text-grey pa-4">Sin datos</div>
      </div>
    </v-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '@/i18n'
import { useTenant } from '@/composables/useTenant'
import reportsService from '@/services/reports.service'
import { formatMoney } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const { tenantId } = useTenant()
const { t } = useI18n()

const breadcrumbs = [
  { title: 'Reportes', to: '/reports', disabled: false },
  { title: 'Financiero', disabled: true }
]

const loading = ref(false)
const loadingCashFlow = ref(false)
const locations = ref([])
const locationFilter = ref(null)

const now = new Date()
const fromDate = ref(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10))
const toDate = ref(now.toISOString().substring(0, 10))

const financials = ref(null)
const cashFlow = ref([])

const totalFlowIncome = computed(() => cashFlow.value.reduce((s, d) => s + d.ingresos_ventas, 0))
const totalFlowExpenses = computed(() => cashFlow.value.reduce((s, d) => s + d.gastos, 0))
const totalOtherIncome = computed(() => cashFlow.value.reduce((s, d) => s + d.otros_ingresos, 0))
const totalNetFlow = computed(() => cashFlow.value.reduce((s, d) => s + d.neto, 0))
const isFromAccounting = computed(() => String(route.query.from || '') === 'accounting')

const loadFinancials = async () => {
  if (!tenantId.value) return
  const fd = fromDate.value + 'T00:00:00'
  const td = toDate.value + 'T23:59:59'
  const r = await reportsService.getFinancialSummary(tenantId.value, fd, td, locationFilter.value)
  if (r.success) financials.value = r.data
}

const loadCashFlow = async () => {
  if (!tenantId.value) return
  loadingCashFlow.value = true
  try {
    const fd = fromDate.value + 'T00:00:00'
    const td = toDate.value + 'T23:59:59'
    const r = await reportsService.getCashFlowByDay(tenantId.value, fd, td, locationFilter.value)
    if (r.success) cashFlow.value = r.data
  } finally {
    loadingCashFlow.value = false
  }
}

const loadAll = async () => {
  loading.value = true
  try {
    await Promise.all([loadFinancials(), loadCashFlow()])
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
