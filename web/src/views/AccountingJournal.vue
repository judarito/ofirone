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
        <v-icon start color="primary">mdi-book-open-variant</v-icon>
        Libro Diario
      </v-card-title>
      <v-card-text>
        <v-row class="ga-2" align="center">
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
          <v-col cols="12" sm="2">
            <v-select
              v-model="filters.source_module"
              :items="moduleOptions"
              item-title="title"
              item-value="value"
              label="Módulo"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field
              v-model="filters.search"
              label="Buscar asiento/cuenta"
              variant="outlined"
              density="compact"
              hide-details
              prepend-inner-icon="mdi-magnify"
            />
          </v-col>
          <v-col cols="12" sm="1">
            <v-btn color="primary" prepend-icon="mdi-magnify" :loading="loading" @click="loadJournal">
              Ver
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col cols="6" sm="3">
        <v-card variant="tonal" color="blue">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ summary.lines }}</div>
            <div class="text-caption">Líneas</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card variant="tonal" color="indigo">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ summary.entries }}</div>
            <div class="text-caption">Asientos</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card variant="tonal" color="green">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.debit) }}</div>
            <div class="text-caption">Débitos</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card variant="tonal" :color="summary.balanced ? 'success' : 'error'">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.credit) }}</div>
            <div class="text-caption">Créditos</div>
            <v-chip size="x-small" class="mt-1" :color="summary.balanced ? 'success' : 'error'">
              {{ summary.balanced ? 'Cuadrado' : 'Descuadrado' }}
            </v-chip>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card>
      <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
        <span>Detalle del Diario</span>
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
            :disabled="journalLines.length === 0"
            :loading="exportingXlsx"
            @click="exportXlsx"
          >
            XLSX
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-file-delimited"
            :disabled="journalLines.length === 0"
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
              <th>Cuenta</th>
              <th>Descripción</th>
              <th class="text-right">Débito</th>
              <th class="text-right">Crédito</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in journalLines" :key="line.line_id">
              <td>{{ formatDate(line.entry_date) }}</td>
              <td>#{{ line.entry_number }} · L{{ line.line_number }}</td>
              <td>{{ line.source_module }}</td>
              <td>
                <code>{{ line.account_code }}</code>
                <div class="text-caption text-medium-emphasis">{{ line.account_name }}</div>
              </td>
              <td>
                <div>{{ line.line_description || line.entry_description || '-' }}</div>
                <div class="text-caption text-medium-emphasis">{{ line.source_event || '-' }}</div>
              </td>
              <td class="text-right">{{ formatMoney(line.debit_amount) }}</td>
              <td class="text-right">{{ formatMoney(line.credit_amount) }}</td>
              <td>
                <v-chip
                  size="x-small"
                  :color="line.entry_status === 'POSTED' ? 'success' : (line.entry_status === 'VOIDED' ? 'error' : 'warning')"
                >
                  {{ line.entry_status }}
                </v-chip>
              </td>
            </tr>
            <tr v-if="journalLines.length === 0">
              <td colspan="8" class="text-center text-medium-emphasis py-8">
                No hay movimientos para el filtro seleccionado.
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Detalle del Diario"
          icon="mdi-book-open-variant"
          :items="paginatedJournalLines"
          :total-items="journalLines.length"
          :loading="loading"
          :page-size="JOURNAL_LIST_PAGE_SIZE"
          item-key="line_id"
          title-field="entry_number"
          avatar-icon="mdi-book-open-page-variant"
          avatar-color="primary"
          empty-message="No hay movimientos para el filtro seleccionado."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onJournalListPage"
        >
          <template #title="{ item: line }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <strong>#{{ line.entry_number }} · L{{ line.line_number }}</strong>
                <span class="ml-2">{{ formatDate(line.entry_date) }}</span>
              </div>
              <v-chip
                size="x-small"
                :color="line.entry_status === 'POSTED' ? 'success' : (line.entry_status === 'VOIDED' ? 'error' : 'warning')"
              >
                {{ line.entry_status }}
              </v-chip>
            </div>
          </template>
          <template #content="{ item: line }">
            <div class="text-caption mt-1"><strong>Módulo:</strong> {{ line.source_module }}</div>
            <div class="text-caption">
              <strong>Cuenta:</strong> <code>{{ line.account_code }}</code>
              <span class="ml-1">{{ line.account_name }}</span>
            </div>
            <div class="text-caption">{{ line.line_description || line.entry_description || '-' }}</div>
            <div class="text-caption text-medium-emphasis">{{ line.source_event || '-' }}</div>
            <div class="text-caption mt-1">
              <strong>Débito:</strong> {{ formatMoney(line.debit_amount) }} |
              <strong>Crédito:</strong> {{ formatMoney(line.credit_amount) }}
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
const exportingXlsx = ref(false)
const exportingCsv = ref(false)

const filters = ref({
  date_from: period.date_from,
  date_to: period.date_to,
  status: 'POSTED',
  source_module: 'ALL',
  search: ''
})

const statusOptions = [
  { title: 'Todos', value: 'ALL' },
  { title: 'POSTED', value: 'POSTED' },
  { title: 'DRAFT', value: 'DRAFT' },
  { title: 'VOIDED', value: 'VOIDED' }
]

const moduleOptions = [
  { title: 'Todos', value: 'ALL' },
  { title: 'POS', value: 'POS' },
  { title: 'PURCHASES', value: 'PURCHASES' },
  { title: 'MANUAL', value: 'MANUAL' },
  { title: 'ADJUSTMENT', value: 'ADJUSTMENT' }
]

const journalEntries = ref([])
const journalLines = ref([])
const journalTotals = ref({ debit: 0, credit: 0, balanced: true })
const journalListPage = ref(1)
const JOURNAL_LIST_PAGE_SIZE = 12

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Libro Diario', disabled: true }
])

const summary = computed(() => ({
  lines: journalLines.value.length,
  entries: journalEntries.value.length,
  debit: Number(journalTotals.value.debit || 0),
  credit: Number(journalTotals.value.credit || 0),
  balanced: Boolean(journalTotals.value.balanced)
}))

const journalListTotalPages = computed(() => Math.max(1, Math.ceil(journalLines.value.length / JOURNAL_LIST_PAGE_SIZE)))
const paginatedJournalLines = computed(() => {
  const start = (journalListPage.value - 1) * JOURNAL_LIST_PAGE_SIZE
  return journalLines.value.slice(start, start + JOURNAL_LIST_PAGE_SIZE)
})

const onJournalListPage = ({ page }) => {
  journalListPage.value = Number(page || 1)
}

const sanitizeForExport = (value) => {
  if (value === null || value === undefined) return ''
  const str = String(value)
  return /^[=+\-@]/.test(str) ? `'${str}` : str
}

const buildExportRows = () => {
  return journalLines.value.map((line) => ({
    Fecha: line.entry_date,
    Asiento: line.entry_number,
    Linea: line.line_number,
    Modulo: sanitizeForExport(line.source_module || ''),
    Evento: sanitizeForExport(line.source_event || ''),
    CuentaCodigo: sanitizeForExport(line.account_code || ''),
    CuentaNombre: sanitizeForExport(line.account_name || ''),
    DescripcionAsiento: sanitizeForExport(line.entry_description || ''),
    DescripcionLinea: sanitizeForExport(line.line_description || ''),
    Debito: Number(line.debit_amount || 0),
    Credito: Number(line.credit_amount || 0),
    Estado: sanitizeForExport(line.entry_status || '')
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

const loadJournal = async () => {
  if (!tenantId.value) return

  loading.value = true
  try {
    const result = await accountingService.getJournalEntries(tenantId.value, {
      ...filters.value,
      limit: 3000
    })

    if (!result.success) {
      show(result.error || 'No se pudo cargar el libro diario.', 'error')
      return
    }

    journalEntries.value = result.data?.entries || []
    journalLines.value = result.data?.lines || []
    journalTotals.value = result.data?.totals || { debit: 0, credit: 0, balanced: true }
  } finally {
    loading.value = false
  }
}

const exportXlsx = async () => {
  if (!journalLines.value.length) return
  exportingXlsx.value = true
  try {
    const rows = buildExportRows()
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'LibroDiario')

    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    writeFileXLSX(wb, `libro_diario_${y}${m}${d}.xlsx`)
  } catch (error) {
    show(error.message || 'No se pudo exportar XLSX.', 'error')
  } finally {
    exportingXlsx.value = false
  }
}

const exportCsv = async () => {
  if (!journalLines.value.length) return
  exportingCsv.value = true
  try {
    const rows = buildExportRows()
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    downloadCsv(rows, `libro_diario_${y}${m}${d}.csv`)
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

watch(() => journalLines.value.length, () => {
  journalListPage.value = 1
})

watch(journalListTotalPages, (total) => {
  if (journalListPage.value > total) journalListPage.value = total
})

onMounted(loadJournal)
</script>
