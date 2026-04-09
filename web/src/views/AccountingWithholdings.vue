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
        <span class="d-flex align-center gap-2">
          <v-icon color="warning">mdi-percent-outline</v-icon>
          Retenciones (CO)
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
            :loading="exportingXlsx"
            :disabled="(summary.items || []).length === 0"
            @click="exportSummaryXlsx"
          >
            XLSX
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-file-delimited"
            :loading="exportingCsv"
            :disabled="(summary.items || []).length === 0"
            @click="exportSummaryCsv"
          >
            CSV
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-text-field v-model="filters.date_from" type="date" label="Desde" variant="outlined" density="compact" hide-details />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field v-model="filters.date_to" type="date" label="Hasta" variant="outlined" density="compact" hide-details />
          </v-col>
          <v-col cols="12" sm="3">
            <v-btn color="primary" prepend-icon="mdi-calculator-variant" :loading="loadingSummary" @click="loadSummary">
              Calcular retenciones
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col cols="12" sm="4">
        <v-card variant="tonal" color="indigo">
          <v-card-text>
            <div class="text-caption">Base ventas</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.kpis?.sales_total || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="4">
        <v-card variant="tonal" color="blue">
          <v-card-text>
            <div class="text-caption">Base compras</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.kpis?.purchases_total || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="4">
        <v-card variant="tonal" color="warning">
          <v-card-text>
            <div class="text-caption">Retencion estimada total</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.kpis?.estimated_total || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card class="mb-4">
      <v-card-title>Estimacion por concepto</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="300">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Concepto</th>
              <th>Aplica</th>
              <th class="text-right">Tarifa %</th>
              <th class="text-right">Base</th>
              <th class="text-right">Base gravable</th>
              <th class="text-right">Retencion estimada</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in summary.items || []" :key="item.code">
              <td><code>{{ item.code }}</code></td>
              <td>{{ item.name }}</td>
              <td>{{ item.applies_to }}</td>
              <td class="text-right">{{ Number(item.rate || 0).toFixed(4) }}</td>
              <td class="text-right">{{ formatMoney(item.base_amount || 0) }}</td>
              <td class="text-right">{{ formatMoney(item.taxable_base || 0) }}</td>
              <td class="text-right font-weight-bold">{{ formatMoney(item.estimated_withholding || 0) }}</td>
            </tr>
            <tr v-if="(summary.items || []).length === 0">
              <td colspan="7" class="text-center text-medium-emphasis py-6">Sin datos para el periodo seleccionado.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Estimacion por concepto"
          icon="mdi-calculator-variant-outline"
          :items="paginatedSummaryItems"
          :total-items="summaryItems.length"
          :loading="loadingSummary"
          :page-size="SUMMARY_LIST_PAGE_SIZE"
          item-key="code"
          title-field="name"
          avatar-icon="mdi-percent-outline"
          avatar-color="primary"
          empty-message="Sin datos para el periodo seleccionado."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onSummaryListPage"
        >
          <template #title="{ item }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <code>{{ item.code }}</code>
                <span class="ml-2 font-weight-medium">{{ item.name }}</span>
              </div>
              <v-chip size="x-small" color="primary">{{ item.applies_to }}</v-chip>
            </div>
          </template>
          <template #content="{ item }">
            <div class="text-caption mt-1">Tarifa: {{ Number(item.rate || 0).toFixed(4) }}%</div>
            <div class="text-caption">Base: {{ formatMoney(item.base_amount || 0) }}</div>
            <div class="text-caption">Base gravable: {{ formatMoney(item.taxable_base || 0) }}</div>
            <div class="text-body-2 font-weight-bold mt-1">
              Retencion estimada: {{ formatMoney(item.estimated_withholding || 0) }}
            </div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
        <span>Configuracion de retenciones</span>
        <v-btn color="secondary" variant="tonal" prepend-icon="mdi-plus" @click="showAddDialog = true">
          Nuevo concepto
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="360">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Nombre</th>
              <th>Aplica</th>
              <th>Cuenta</th>
              <th class="text-right">Tarifa %</th>
              <th class="text-right">Base minima</th>
              <th>Activo</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cfg in configs" :key="cfg.config_id">
              <td style="min-width: 150px">
                <v-text-field v-model="cfg.code" density="compact" variant="outlined" hide-details />
              </td>
              <td style="min-width: 220px">
                <v-text-field v-model="cfg.name" density="compact" variant="outlined" hide-details />
              </td>
              <td style="min-width: 130px">
                <v-select
                  v-model="cfg.applies_to"
                  :items="appliesOptions"
                  item-title="title"
                  item-value="value"
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </td>
              <td style="min-width: 120px">
                <v-text-field v-model="cfg.account_code" density="compact" variant="outlined" hide-details />
              </td>
              <td class="text-right" style="min-width: 130px">
                <v-text-field v-model.number="cfg.rate" type="number" step="0.0001" density="compact" variant="outlined" hide-details />
              </td>
              <td class="text-right" style="min-width: 140px">
                <v-text-field v-model.number="cfg.base_threshold" type="number" step="0.01" density="compact" variant="outlined" hide-details />
              </td>
              <td>
                <v-switch v-model="cfg.is_active" color="primary" hide-details density="compact" />
              </td>
              <td>
                <v-btn color="primary" size="small" :loading="savingId === cfg.config_id" @click="saveConfig(cfg)">
                  Guardar
                </v-btn>
              </td>
            </tr>
            <tr v-if="configs.length === 0">
              <td colspan="8" class="text-center text-medium-emphasis py-6">No hay conceptos de retencion configurados.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Configuracion de retenciones"
          icon="mdi-tune-variant"
          :items="paginatedConfigs"
          :total-items="configs.length"
          :loading="loadingConfigs"
          :page-size="CONFIGS_LIST_PAGE_SIZE"
          item-key="config_id"
          title-field="name"
          avatar-icon="mdi-percent-box"
          avatar-color="warning"
          empty-message="No hay conceptos de retencion configurados."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onConfigsListPage"
        >
          <template #title="{ item: cfg }">
            <div class="d-flex align-center justify-space-between w-100 flex-wrap ga-2">
              <div>
                <code>{{ cfg.code || 'SIN-COD' }}</code>
                <span class="ml-2">{{ cfg.name || 'Sin nombre' }}</span>
              </div>
              <div class="d-flex align-center ga-2">
                <v-chip size="x-small" color="primary">{{ cfg.applies_to }}</v-chip>
                <v-chip size="x-small" :color="cfg.is_active ? 'success' : 'grey'">
                  {{ cfg.is_active ? 'Activo' : 'Inactivo' }}
                </v-chip>
              </div>
            </div>
          </template>
          <template #content="{ item: cfg }">
            <v-row class="mt-1">
              <v-col cols="12" md="3">
                <v-text-field v-model="cfg.code" label="Codigo" density="compact" variant="outlined" hide-details />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="cfg.name" label="Nombre" density="compact" variant="outlined" hide-details />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="cfg.applies_to"
                  :items="appliesOptions"
                  item-title="title"
                  item-value="value"
                  label="Aplica"
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model="cfg.account_code" label="Cuenta pasivo" density="compact" variant="outlined" hide-details />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model.number="cfg.rate" label="Tarifa %" type="number" step="0.0001" density="compact" variant="outlined" hide-details />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model.number="cfg.base_threshold" label="Base minima" type="number" step="0.01" density="compact" variant="outlined" hide-details />
              </v-col>
              <v-col cols="12" md="2">
                <v-switch v-model="cfg.is_active" color="primary" label="Activo" hide-details density="compact" />
              </v-col>
            </v-row>
          </template>
          <template #actions="{ item: cfg }">
            <v-btn color="primary" :loading="savingId === cfg.config_id" @click.stop="saveConfig(cfg)">
              Guardar
            </v-btn>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-dialog v-model="showAddDialog" max-width="640">
      <v-card>
        <v-card-title>Nuevo concepto de retencion</v-card-title>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field v-model="newConfig.code" label="Codigo" variant="outlined" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="newConfig.name" label="Nombre" variant="outlined" />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="newConfig.applies_to"
                :items="appliesOptions"
                item-title="title"
                item-value="value"
                label="Aplica"
                variant="outlined"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model.number="newConfig.rate" type="number" step="0.0001" label="Tarifa %" variant="outlined" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model.number="newConfig.base_threshold" type="number" step="0.01" label="Base minima" variant="outlined" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="newConfig.account_code" label="Cuenta pasivo" variant="outlined" />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch v-model="newConfig.is_active" label="Activo" color="primary" />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showAddDialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="savingNew" @click="createConfig">Crear</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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

const loadingSummary = ref(false)
const loadingConfigs = ref(false)
const exportingXlsx = ref(false)
const exportingCsv = ref(false)
const savingId = ref(null)
const savingNew = ref(false)
const showAddDialog = ref(false)

const summary = ref({ kpis: {}, items: [] })
const configs = ref([])
const summaryListPage = ref(1)
const configsListPage = ref(1)
const SUMMARY_LIST_PAGE_SIZE = 6
const CONFIGS_LIST_PAGE_SIZE = 6

const appliesOptions = [
  { title: 'Compras', value: 'PURCHASES' },
  { title: 'Ventas', value: 'SALES' },
  { title: 'Ambos', value: 'BOTH' }
]

const newConfig = ref({
  code: '',
  name: '',
  applies_to: 'PURCHASES',
  rate: 0,
  base_threshold: 0,
  account_code: '236540',
  is_active: true
})

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Retenciones', disabled: true }
])

const summaryItems = computed(() => summary.value?.items || [])
const summaryTotalPages = computed(() => Math.max(1, Math.ceil(summaryItems.value.length / SUMMARY_LIST_PAGE_SIZE)))
const paginatedSummaryItems = computed(() => {
  const start = (summaryListPage.value - 1) * SUMMARY_LIST_PAGE_SIZE
  return summaryItems.value.slice(start, start + SUMMARY_LIST_PAGE_SIZE)
})

const configsTotalPages = computed(() => Math.max(1, Math.ceil(configs.value.length / CONFIGS_LIST_PAGE_SIZE)))
const paginatedConfigs = computed(() => {
  const start = (configsListPage.value - 1) * CONFIGS_LIST_PAGE_SIZE
  return configs.value.slice(start, start + CONFIGS_LIST_PAGE_SIZE)
})

const onSummaryListPage = ({ page }) => {
  summaryListPage.value = Number(page || 1)
}

const onConfigsListPage = ({ page }) => {
  configsListPage.value = Number(page || 1)
}

const sanitizeForExport = (value) => {
  if (value === null || value === undefined) return ''
  const str = String(value)
  return /^[=+\-@]/.test(str) ? `'${str}` : str
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

const buildExportRows = () => {
  return (summary.value.items || []).map((item) => ({
    Codigo: sanitizeForExport(item.code || ''),
    Concepto: sanitizeForExport(item.name || ''),
    Aplica: sanitizeForExport(item.applies_to || ''),
    Tarifa: Number(item.rate || 0),
    Base: Number(item.base_amount || 0),
    BaseGravable: Number(item.taxable_base || 0),
    RetencionEstimada: Number(item.estimated_withholding || 0)
  }))
}

const getDateSuffix = () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

const loadSummary = async () => {
  if (!tenantId.value) return
  loadingSummary.value = true
  try {
    const result = await accountingService.getWithholdingSummary(tenantId.value, filters.value)
    if (!result.success) {
      show(result.error || 'No se pudo calcular retenciones.', 'error')
      return
    }
    summary.value = result.data || { kpis: {}, items: [] }
  } finally {
    loadingSummary.value = false
  }
}

const loadConfigs = async () => {
  if (!tenantId.value) return
  loadingConfigs.value = true
  try {
    const result = await accountingService.getWithholdingConfigs(tenantId.value)
    if (!result.success) {
      show(result.error || 'No se pudo cargar configuracion de retenciones.', 'error')
      return
    }
    configs.value = result.data || []
  } finally {
    loadingConfigs.value = false
  }
}

const saveConfig = async (cfg) => {
  if (!tenantId.value) return
  savingId.value = cfg.config_id
  try {
    const result = await accountingService.saveWithholdingConfig(tenantId.value, cfg)
    if (!result.success) {
      show(result.error || 'No se pudo guardar el concepto.', 'error')
      return
    }
    show('Concepto guardado.', 'success')
    await Promise.all([loadConfigs(), loadSummary()])
  } finally {
    savingId.value = null
  }
}

const createConfig = async () => {
  if (!tenantId.value) return
  savingNew.value = true
  try {
    const result = await accountingService.saveWithholdingConfig(tenantId.value, newConfig.value)
    if (!result.success) {
      show(result.error || 'No se pudo crear el concepto.', 'error')
      return
    }

    show('Concepto creado.', 'success')
    showAddDialog.value = false
    newConfig.value = {
      code: '',
      name: '',
      applies_to: 'PURCHASES',
      rate: 0,
      base_threshold: 0,
      account_code: '236540',
      is_active: true
    }
    await Promise.all([loadConfigs(), loadSummary()])
  } finally {
    savingNew.value = false
  }
}

const exportSummaryXlsx = async () => {
  exportingXlsx.value = true
  try {
    const rows = buildExportRows()
    if (!rows.length) return

    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Retenciones')
    writeFileXLSX(wb, `retenciones_${getDateSuffix()}.xlsx`)
  } catch (error) {
    show(error.message || 'No se pudo exportar XLSX.', 'error')
  } finally {
    exportingXlsx.value = false
  }
}

const exportSummaryCsv = async () => {
  exportingCsv.value = true
  try {
    const rows = buildExportRows()
    if (!rows.length) return
    downloadCsv(rows, `retenciones_${getDateSuffix()}.csv`)
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

watch(() => summaryItems.value.length, () => {
  summaryListPage.value = 1
})

watch(() => configs.value.length, () => {
  configsListPage.value = 1
})

watch(summaryTotalPages, (total) => {
  if (summaryListPage.value > total) summaryListPage.value = total
})

watch(configsTotalPages, (total) => {
  if (configsListPage.value > total) configsListPage.value = total
})

onMounted(async () => {
  await Promise.all([loadConfigs(), loadSummary()])
})
</script>
