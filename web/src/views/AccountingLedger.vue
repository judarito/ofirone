<template>
  <div>
    <div class="mb-3">
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
      <v-card-title class="d-flex align-center flex-wrap gap-2">
        <v-icon start color="indigo">mdi-book-multiple</v-icon>
        Libro Mayor
      </v-card-title>
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="4" md="3">
            <v-select
              v-model="filters.account_id"
              :items="accountOptions"
              item-title="label"
              item-value="account_id"
              label="Cuenta contable"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="2">
            <v-text-field v-model="filters.date_from" type="date" label="Desde" variant="outlined" density="compact" hide-details />
          </v-col>
          <v-col cols="12" sm="2">
            <v-text-field v-model="filters.date_to" type="date" label="Hasta" variant="outlined" density="compact" hide-details />
          </v-col>
          <v-col cols="12" sm="2">
            <v-select
              v-model="filters.status"
              :items="statusOptions"
              item-title="title"
              item-value="value"
              label="Estado"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-btn color="primary" prepend-icon="mdi-magnify" :loading="loading" @click="loadLedger">
              Consultar
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row class="mb-4" v-if="ledger">
      <v-col cols="12" sm="6" md="3">
        <v-card variant="tonal" color="blue">
          <v-card-text class="text-center">
            <div class="text-caption">Saldo Inicial</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(ledger.opening_balance) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card variant="tonal" color="green">
          <v-card-text class="text-center">
            <div class="text-caption">Débitos Período</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(ledger.total_debit) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card variant="tonal" color="orange">
          <v-card-text class="text-center">
            <div class="text-caption">Créditos Período</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(ledger.total_credit) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card variant="tonal" color="indigo">
          <v-card-text class="text-center">
            <div class="text-caption">Saldo Final</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(ledger.closing_balance) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card>
      <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
        <span>
          {{ selectedAccountLabel || 'Movimientos del Mayor' }}
          <v-chip v-if="ledger?.account" size="x-small" color="indigo" class="ml-2">
            Naturaleza: {{ ledger.account.natural_side }}
          </v-chip>
        </span>
        <div class="d-flex align-center gap-2 flex-wrap">
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
          <v-btn
            color="success"
            variant="tonal"
            prepend-icon="mdi-file-excel"
            :disabled="!ledger || ledger.movements.length === 0"
            :loading="exportingXlsx"
            @click="exportXlsx"
          >
            XLSX
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-file-delimited"
            :disabled="!ledger || ledger.movements.length === 0"
            :loading="exportingCsv"
            @click="exportCsv"
          >
            CSV
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="560">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Asiento</th>
              <th>Módulo</th>
              <th>Descripción</th>
              <th class="text-right">Débito</th>
              <th class="text-right">Crédito</th>
              <th class="text-right">Movimiento</th>
              <th class="text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in ledger?.movements || []" :key="line.line_id">
              <td>{{ formatDate(line.entry_date) }}</td>
              <td>#{{ line.entry_number }} · L{{ line.line_number }}</td>
              <td>{{ line.source_module }}</td>
              <td>{{ line.line_description || line.entry_description || '-' }}</td>
              <td class="text-right">{{ formatMoney(line.debit_amount) }}</td>
              <td class="text-right">{{ formatMoney(line.credit_amount) }}</td>
              <td class="text-right" :class="line.delta >= 0 ? 'text-success' : 'text-error'">
                {{ line.delta >= 0 ? '+' : '' }}{{ formatMoney(line.delta) }}
              </td>
              <td class="text-right font-weight-bold">{{ formatMoney(line.running_balance) }}</td>
            </tr>
            <tr v-if="!ledger || ledger.movements.length === 0">
              <td colspan="8" class="text-center text-medium-emphasis py-8">
                Selecciona una cuenta y consulta para ver el libro mayor.
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Movimientos del Mayor"
          icon="mdi-book-multiple"
          :items="paginatedLedgerMovements"
          :total-items="ledgerMovements.length"
          :loading="loading"
          :page-size="LEDGER_LIST_PAGE_SIZE"
          item-key="line_id"
          title-field="entry_number"
          avatar-icon="mdi-book-account-outline"
          avatar-color="indigo"
          empty-message="Selecciona una cuenta y consulta para ver el libro mayor."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onLedgerListPage"
        >
          <template #title="{ item: line }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <strong>{{ formatDate(line.entry_date) }}</strong>
                <span class="ml-2">#{{ line.entry_number }} · L{{ line.line_number }}</span>
              </div>
              <v-chip size="x-small" color="primary">{{ line.source_module }}</v-chip>
            </div>
          </template>
          <template #content="{ item: line }">
            <div class="text-caption">{{ line.line_description || line.entry_description || '-' }}</div>
            <div class="text-caption mt-1">
              <strong>Débito:</strong> {{ formatMoney(line.debit_amount) }} |
              <strong>Crédito:</strong> {{ formatMoney(line.credit_amount) }}
            </div>
            <div class="text-caption mt-1">
              <strong>Movimiento:</strong>
              <span :class="line.delta >= 0 ? 'text-success' : 'text-error'">
                {{ line.delta >= 0 ? '+' : '' }}{{ formatMoney(line.delta) }}
              </span>
              |
              <strong>Saldo:</strong> {{ formatMoney(line.running_balance) }}
            </div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { utils, writeFileXLSX } from 'xlsx'
import { useTenant } from '@/composables/useTenant'
import { useNotification } from '@/composables/useNotification'
import { useAccountingViewMode } from '@/composables/useAccountingViewMode'
import accountingService from '@/services/accounting.service'
import ListView from '@/components/ListView.vue'
import { formatMoney, formatDate } from '@/utils/formatters'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { show } = useNotification()
const { viewMode, isTableView } = useAccountingViewMode()

const period = accountingService.getDefaultPeriod()
const loading = ref(false)
const loadingAccounts = ref(false)
const exportingXlsx = ref(false)
const exportingCsv = ref(false)

const filters = ref({
  account_id: null,
  date_from: period.date_from,
  date_to: period.date_to,
  status: 'POSTED'
})

const statusOptions = [
  { title: 'POSTED', value: 'POSTED' },
  { title: 'Todos', value: 'ALL' }
]

const accounts = ref([])
const ledger = ref(null)
const ledgerListPage = ref(1)
const LEDGER_LIST_PAGE_SIZE = 12

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Libro Mayor', disabled: true }
])

const accountOptions = computed(() => {
  return accounts.value.map((account) => ({
    ...account,
    label: `${account.code} - ${account.name}`
  }))
})

const selectedAccountLabel = computed(() => {
  const selected = accountOptions.value.find((account) => account.account_id === filters.value.account_id)
  return selected?.label || ''
})

const ledgerMovements = computed(() => ledger.value?.movements || [])
const ledgerListTotalPages = computed(() => Math.max(1, Math.ceil(ledgerMovements.value.length / LEDGER_LIST_PAGE_SIZE)))
const paginatedLedgerMovements = computed(() => {
  const start = (ledgerListPage.value - 1) * LEDGER_LIST_PAGE_SIZE
  return ledgerMovements.value.slice(start, start + LEDGER_LIST_PAGE_SIZE)
})

const onLedgerListPage = ({ page }) => {
  ledgerListPage.value = Number(page || 1)
}

const sanitizeForExport = (value) => {
  if (value === null || value === undefined) return ''
  const str = String(value)
  return /^[=+\-@]/.test(str) ? `'${str}` : str
}

const buildExportRows = () => {
  return (ledger.value?.movements || []).map((line) => ({
    Fecha: line.entry_date,
    Asiento: line.entry_number,
    Linea: line.line_number,
    CuentaCodigo: sanitizeForExport(ledger.value?.account?.code || ''),
    CuentaNombre: sanitizeForExport(ledger.value?.account?.name || ''),
    Modulo: sanitizeForExport(line.source_module || ''),
    Descripcion: sanitizeForExport(line.line_description || line.entry_description || ''),
    Debito: Number(line.debit_amount || 0),
    Credito: Number(line.credit_amount || 0),
    Movimiento: Number(line.delta || 0),
    Saldo: Number(line.running_balance || 0)
  }))
}

const toCsvValue = (value) => {
  const str = String(value ?? '')
  const escaped = str.replaceAll('"', '""')
  return `"${escaped}"`
}

const downloadCsv = (rows, filename) => {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.map(toCsvValue).join(','),
    ...rows.map((row) => headers.map((key) => toCsvValue(row[key])).join(','))
  ].join('\n')

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const loadAccounts = async () => {
  if (!tenantId.value) return
  loadingAccounts.value = true
  try {
    const result = await accountingService.getAccounts(tenantId.value, { onlyPostable: true, limit: 2000 })
    if (!result.success) {
      show(result.error || 'No se pudo cargar el plan de cuentas.', 'error')
      return
    }

    accounts.value = result.data || []
    if (!filters.value.account_id && accounts.value.length > 0) {
      filters.value.account_id = accounts.value[0].account_id
    }
  } finally {
    loadingAccounts.value = false
  }
}

const loadLedger = async () => {
  if (!tenantId.value) return
  if (!filters.value.account_id) {
    show('Selecciona una cuenta para consultar el mayor.', 'warning')
    return
  }

  loading.value = true
  try {
    const result = await accountingService.getLedgerReport(tenantId.value, {
      ...filters.value,
      limit: 3500
    })

    if (!result.success) {
      show(result.error || 'No se pudo cargar el libro mayor.', 'error')
      return
    }

    ledger.value = result.data
  } finally {
    loading.value = false
  }
}

const exportXlsx = async () => {
  if (!ledger.value || ledger.value.movements.length === 0) return
  exportingXlsx.value = true
  try {
    const rows = buildExportRows()
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'LibroMayor')

    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const accountCode = ledger.value?.account?.code || 'cuenta'
    writeFileXLSX(wb, `libro_mayor_${accountCode}_${y}${m}${d}.xlsx`)
  } catch (error) {
    show(error.message || 'No se pudo exportar XLSX.', 'error')
  } finally {
    exportingXlsx.value = false
  }
}

const exportCsv = async () => {
  if (!ledger.value || ledger.value.movements.length === 0) return
  exportingCsv.value = true
  try {
    const rows = buildExportRows()
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const accountCode = ledger.value?.account?.code || 'cuenta'
    downloadCsv(rows, `libro_mayor_${accountCode}_${y}${m}${d}.csv`)
  } catch (error) {
    show(error.message || 'No se pudo exportar CSV.', 'error')
  } finally {
    exportingCsv.value = false
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({ path: '/accounting', query: { tab } })
}

watch(() => ledgerMovements.value.length, () => {
  ledgerListPage.value = 1
})

watch(ledgerListTotalPages, (total) => {
  if (ledgerListPage.value > total) ledgerListPage.value = total
})

onMounted(async () => {
  await loadAccounts()
  if (filters.value.account_id) {
    await loadLedger()
  }
})
</script>
