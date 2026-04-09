<template>
  <div>
    <div class="mb-3">
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-arrow-left" @click="goBackToAccounting">
        Volver a Contabilidad
      </v-btn>
    </div>

    <v-breadcrumbs :items="breadcrumbs" class="pa-0 mb-4">
      <template #divider><v-icon>mdi-chevron-right</v-icon></template>
    </v-breadcrumbs>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
        <span class="d-flex align-center ga-2">
          <v-icon color="teal">mdi-bank-check</v-icon>
          Conciliacion Caja y Bancos
        </span>
        <div class="d-flex align-center ga-2 flex-wrap">
          <v-btn-toggle
            v-model="viewMode"
            mandatory
            color="primary"
            density="comfortable"
            variant="outlined"
          >
            <v-btn value="LIST" size="small" prepend-icon="mdi-view-list">Lista</v-btn>
            <v-btn value="TABLE" size="small" prepend-icon="mdi-table">Tabla</v-btn>
          </v-btn-toggle>
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="loadSnapshot">
            Refrescar
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="filters.date_from"
              label="Desde"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="filters.date_to"
              label="Hasta"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-btn color="primary" variant="tonal" block @click="loadSnapshot">Aplicar periodo</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Sesiones cerradas</div>
            <div class="text-h6 font-weight-bold">{{ kpis.sessions_closed || 0 }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Caja contada</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(kpis.cash_counted_total || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Saldo contable caja/bancos</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(kpis.ledger_cash_balance || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Brecha conciliacion</div>
            <div class="text-h6 font-weight-bold" :class="Number(kpis.reconciliation_gap || 0) === 0 ? 'text-success' : 'text-error'">
              {{ formatMoney(kpis.reconciliation_gap || 0) }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card class="mb-4">
      <v-card-title>Cuentas de caja/bancos (contabilidad)</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="320">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Nombre</th>
              <th class="text-right">Saldo cierre</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ledgerRows" :key="row.account_id">
              <td><code>{{ row.account_code }}</code></td>
              <td>{{ row.account_name }}</td>
              <td class="text-right">{{ formatMoney(row.closing_balance || 0) }}</td>
            </tr>
            <tr v-if="ledgerRows.length === 0">
              <td colspan="3" class="text-center text-medium-emphasis py-6">No hay cuentas contables conciliables en el periodo.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Cuentas conciliables"
          icon="mdi-bank-outline"
          :items="paginatedLedgerRows"
          :total-items="ledgerRows.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="account_id"
          title-field="account_name"
          avatar-icon="mdi-bank-outline"
          avatar-color="teal"
          empty-message="No hay cuentas contables conciliables en el periodo."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onLedgerListPage"
        >
          <template #title="{ item }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <code>{{ item.account_code }}</code>
                <span class="ml-2 font-weight-medium">{{ item.account_name }}</span>
              </div>
              <v-chip size="x-small" color="primary">{{ formatMoney(item.closing_balance || 0) }}</v-chip>
            </div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>Sesiones de caja cerradas</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="360">
          <thead>
            <tr>
              <th>Apertura</th>
              <th>Cierre</th>
              <th class="text-right">Esperado</th>
              <th class="text-right">Contado</th>
              <th class="text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in cashSessions" :key="row.cash_session_id">
              <td>{{ formatDateTime(row.opened_at) || '-' }}</td>
              <td>{{ formatDateTime(row.closed_at) || '-' }}</td>
              <td class="text-right">{{ formatMoney(row.closing_amount_expected || 0) }}</td>
              <td class="text-right">{{ formatMoney(row.closing_amount_counted || 0) }}</td>
              <td class="text-right" :class="Number(row.difference || 0) === 0 ? 'text-success' : 'text-error'">
                {{ formatMoney(row.difference || 0) }}
              </td>
            </tr>
            <tr v-if="cashSessions.length === 0">
              <td colspan="5" class="text-center text-medium-emphasis py-6">No hay sesiones cerradas para el periodo.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Sesiones cerradas"
          icon="mdi-cash-register"
          :items="paginatedCashSessions"
          :total-items="cashSessions.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="cash_session_id"
          title-field="cash_session_id"
          avatar-icon="mdi-cash-register"
          avatar-color="primary"
          empty-message="No hay sesiones cerradas para el periodo."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onCashSessionsListPage"
        >
          <template #title="{ item }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <strong>{{ formatDateTime(item.opened_at) || '-' }}</strong>
                <span class="ml-2 text-caption">-> {{ formatDateTime(item.closed_at) || '-' }}</span>
              </div>
              <v-chip size="x-small" :color="Number(item.difference || 0) === 0 ? 'success' : 'error'">
                Dif: {{ formatMoney(item.difference || 0) }}
              </v-chip>
            </div>
          </template>
          <template #content="{ item }">
            <div class="text-caption">Esperado: {{ formatMoney(item.closing_amount_expected || 0) }}</div>
            <div class="text-caption">Contado: {{ formatMoney(item.closing_amount_counted || 0) }}</div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTenant } from '@/composables/useTenant'
import { useNotification } from '@/composables/useNotification'
import { useAccountingViewMode } from '@/composables/useAccountingViewMode'
import accountingService from '@/services/accounting.service'
import ListView from '@/components/ListView.vue'
import { formatDateTime, formatMoney } from '@/utils/formatters'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { show } = useNotification()
const { viewMode, isTableView } = useAccountingViewMode()

const period = accountingService.getDefaultPeriod()
const filters = ref({
  date_from: period.date_from,
  date_to: period.date_to
})

const loading = ref(false)
const snapshot = ref({
  cash_sessions: [],
  ledger_cash_accounts: [],
  kpis: {
    sessions_closed: 0,
    cash_expected_total: 0,
    cash_counted_total: 0,
    cash_difference_total: 0,
    ledger_cash_balance: 0,
    reconciliation_gap: 0
  }
})

const LIST_PAGE_SIZE = 8
const ledgerListPage = ref(1)
const cashSessionsListPage = ref(1)

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Conciliacion', disabled: true }
])

const kpis = computed(() => snapshot.value?.kpis || {})
const ledgerRows = computed(() => snapshot.value?.ledger_cash_accounts || [])
const cashSessions = computed(() => snapshot.value?.cash_sessions || [])

const ledgerTotalPages = computed(() => Math.max(1, Math.ceil(ledgerRows.value.length / LIST_PAGE_SIZE)))
const paginatedLedgerRows = computed(() => {
  const start = (ledgerListPage.value - 1) * LIST_PAGE_SIZE
  return ledgerRows.value.slice(start, start + LIST_PAGE_SIZE)
})

const cashSessionsTotalPages = computed(() => Math.max(1, Math.ceil(cashSessions.value.length / LIST_PAGE_SIZE)))
const paginatedCashSessions = computed(() => {
  const start = (cashSessionsListPage.value - 1) * LIST_PAGE_SIZE
  return cashSessions.value.slice(start, start + LIST_PAGE_SIZE)
})

const onLedgerListPage = ({ page }) => {
  ledgerListPage.value = Number(page || 1)
}

const onCashSessionsListPage = ({ page }) => {
  cashSessionsListPage.value = Number(page || 1)
}

const loadSnapshot = async () => {
  if (!tenantId.value) return

  loading.value = true
  try {
    const result = await accountingService.getReconciliationSnapshot(tenantId.value, filters.value)
    if (!result.success) {
      show(result.error || 'No se pudo cargar conciliacion.', 'error')
      return
    }

    snapshot.value = result.data || snapshot.value
  } finally {
    loading.value = false
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({ path: '/accounting', query: { tab } })
}

watch(() => ledgerRows.value.length, () => {
  ledgerListPage.value = 1
})

watch(() => cashSessions.value.length, () => {
  cashSessionsListPage.value = 1
})

watch(ledgerTotalPages, (total) => {
  if (ledgerListPage.value > total) ledgerListPage.value = total
})

watch(cashSessionsTotalPages, (total) => {
  if (cashSessionsListPage.value > total) cashSessionsListPage.value = total
})

onMounted(loadSnapshot)
</script>
