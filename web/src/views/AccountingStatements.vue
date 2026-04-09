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
          <v-icon color="success">mdi-finance</v-icon>
          Estados Financieros
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
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="loadStatements">
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
            <v-btn color="primary" variant="tonal" block @click="loadStatements">Aplicar periodo</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Ingresos</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(incomeStatement.income || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Costos + Gastos</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney((incomeStatement.cost || 0) + (incomeStatement.expense || 0)) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Utilidad neta</div>
            <div class="text-h6 font-weight-bold" :class="Number(incomeStatement.net_profit || 0) < 0 ? 'text-error' : 'text-success'">
              {{ formatMoney(incomeStatement.net_profit || 0) }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Cuadre balance</div>
            <v-chip size="small" :color="isBalanceSheetBalanced ? 'success' : 'warning'">
              {{ isBalanceSheetBalanced ? 'Cuadrado' : 'Revisar' }}
            </v-chip>
            <div class="text-caption mt-2">
              A: {{ formatMoney(balanceSheet.assets || 0) }}<br>
              P+PN: {{ formatMoney(balanceSheet.liabilities_plus_equity || 0) }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card class="mb-4">
      <v-card-title>Estado de resultados (detalle)</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="360">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Nombre</th>
              <th>Seccion</th>
              <th class="text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in incomeRows" :key="row.key">
              <td><code>{{ row.account_code }}</code></td>
              <td>{{ row.account_name }}</td>
              <td>
                <v-chip size="x-small" :color="row.section === 'INCOME' ? 'success' : 'warning'">
                  {{ row.sectionLabel }}
                </v-chip>
              </td>
              <td class="text-right">{{ formatMoney(row.signed_amount || 0) }}</td>
            </tr>
            <tr v-if="incomeRows.length === 0">
              <td colspan="4" class="text-center text-medium-emphasis py-6">Sin movimientos para el periodo.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Estado de resultados"
          icon="mdi-chart-line"
          :items="paginatedIncomeRows"
          :total-items="incomeRows.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="key"
          title-field="account_name"
          avatar-icon="mdi-chart-line"
          avatar-color="success"
          empty-message="Sin movimientos para el periodo."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onIncomeListPage"
        >
          <template #title="{ item: row }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <code>{{ row.account_code }}</code>
                <span class="ml-2 font-weight-medium">{{ row.account_name }}</span>
              </div>
              <v-chip size="x-small" :color="row.section === 'INCOME' ? 'success' : 'warning'">
                {{ row.sectionLabel }}
              </v-chip>
            </div>
          </template>
          <template #content="{ item: row }">
            <div class="text-caption">Valor: {{ formatMoney(row.signed_amount || 0) }}</div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>Balance general (detalle)</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="360">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Nombre</th>
              <th>Seccion</th>
              <th class="text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in balanceRows" :key="row.key">
              <td><code>{{ row.account_code }}</code></td>
              <td>{{ row.account_name }}</td>
              <td>
                <v-chip size="x-small" :color="getBalanceSectionColor(row.section)">
                  {{ row.sectionLabel }}
                </v-chip>
              </td>
              <td class="text-right">{{ formatMoney(row.signed_amount || 0) }}</td>
            </tr>
            <tr v-if="balanceRows.length === 0">
              <td colspan="4" class="text-center text-medium-emphasis py-6">Sin movimientos para el periodo.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Balance general"
          icon="mdi-scale-balance"
          :items="paginatedBalanceRows"
          :total-items="balanceRows.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="key"
          title-field="account_name"
          avatar-icon="mdi-scale-balance"
          avatar-color="indigo"
          empty-message="Sin movimientos para el periodo."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onBalanceListPage"
        >
          <template #title="{ item: row }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <code>{{ row.account_code }}</code>
                <span class="ml-2 font-weight-medium">{{ row.account_name }}</span>
              </div>
              <v-chip size="x-small" :color="getBalanceSectionColor(row.section)">
                {{ row.sectionLabel }}
              </v-chip>
            </div>
          </template>
          <template #content="{ item: row }">
            <div class="text-caption">Saldo: {{ formatMoney(row.signed_amount || 0) }}</div>
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
import { formatMoney } from '@/utils/formatters'

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
const statementData = ref({
  income_statement: {
    income: 0,
    cost: 0,
    expense: 0,
    net_profit: 0,
    details: { income: [], cost: [], expense: [] }
  },
  balance_sheet: {
    assets: 0,
    liabilities: 0,
    equity: 0,
    retained_earnings_current: 0,
    liabilities_plus_equity: 0,
    details: { assets: [], liabilities: [], equity: [] }
  }
})

const LIST_PAGE_SIZE = 10
const incomeListPage = ref(1)
const balanceListPage = ref(1)

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Estados financieros', disabled: true }
])

const incomeStatement = computed(() => statementData.value?.income_statement || {})
const balanceSheet = computed(() => statementData.value?.balance_sheet || {})

const incomeRows = computed(() => {
  const rows = []
  const addRows = (items, section, sectionLabel) => {
    ;(items || []).forEach((item, index) => {
      rows.push({
        ...item,
        section,
        sectionLabel,
        key: `${section}-${item.account_code || 'NO_CODE'}-${index}`
      })
    })
  }

  addRows(incomeStatement.value.details?.income || [], 'INCOME', 'Ingresos')
  addRows(incomeStatement.value.details?.cost || [], 'COST', 'Costos')
  addRows(incomeStatement.value.details?.expense || [], 'EXPENSE', 'Gastos')

  return rows
})

const balanceRows = computed(() => {
  const rows = []
  const addRows = (items, section, sectionLabel) => {
    ;(items || []).forEach((item, index) => {
      rows.push({
        ...item,
        section,
        sectionLabel,
        key: `${section}-${item.account_code || 'NO_CODE'}-${index}`
      })
    })
  }

  addRows(balanceSheet.value.details?.assets || [], 'ASSET', 'Activos')
  addRows(balanceSheet.value.details?.liabilities || [], 'LIABILITY', 'Pasivos')
  addRows(balanceSheet.value.details?.equity || [], 'EQUITY', 'Patrimonio')

  return rows
})

const incomeTotalPages = computed(() => Math.max(1, Math.ceil(incomeRows.value.length / LIST_PAGE_SIZE)))
const paginatedIncomeRows = computed(() => {
  const start = (incomeListPage.value - 1) * LIST_PAGE_SIZE
  return incomeRows.value.slice(start, start + LIST_PAGE_SIZE)
})

const balanceTotalPages = computed(() => Math.max(1, Math.ceil(balanceRows.value.length / LIST_PAGE_SIZE)))
const paginatedBalanceRows = computed(() => {
  const start = (balanceListPage.value - 1) * LIST_PAGE_SIZE
  return balanceRows.value.slice(start, start + LIST_PAGE_SIZE)
})

const isBalanceSheetBalanced = computed(() => {
  const assets = Number(balanceSheet.value.assets || 0)
  const liabilitiesPlusEquity = Number(balanceSheet.value.liabilities_plus_equity || 0)
  return Math.abs(assets - liabilitiesPlusEquity) < 1
})

const getBalanceSectionColor = (section) => {
  if (section === 'ASSET') return 'success'
  if (section === 'LIABILITY') return 'warning'
  return 'indigo'
}

const onIncomeListPage = ({ page }) => {
  incomeListPage.value = Number(page || 1)
}

const onBalanceListPage = ({ page }) => {
  balanceListPage.value = Number(page || 1)
}

const loadStatements = async () => {
  if (!tenantId.value) return

  loading.value = true
  try {
    const result = await accountingService.getFinancialStatements(tenantId.value, filters.value)
    if (!result.success) {
      show(result.error || 'No se pudieron cargar estados financieros.', 'error')
      return
    }

    statementData.value = result.data || statementData.value
  } finally {
    loading.value = false
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({ path: '/accounting', query: { tab } })
}

watch(() => incomeRows.value.length, () => {
  incomeListPage.value = 1
})

watch(() => balanceRows.value.length, () => {
  balanceListPage.value = 1
})

watch(incomeTotalPages, (total) => {
  if (incomeListPage.value > total) incomeListPage.value = total
})

watch(balanceTotalPages, (total) => {
  if (balanceListPage.value > total) balanceListPage.value = total
})

onMounted(loadStatements)
</script>
