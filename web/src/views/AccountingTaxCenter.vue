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
          <v-icon color="warning">mdi-receipt-text-check-outline</v-icon>
          Centro Tributario
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
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="loadTaxCenter">
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
            <v-btn color="primary" variant="tonal" block @click="loadTaxCenter">Aplicar periodo</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">IVA generado</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(taxCenter.iva?.generated || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Base compras referencia</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(taxCenter.iva?.purchases_base_reference || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Retenciones estimadas</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(withholdingKpis.estimated_total || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="3">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">IVA por pagar estimado</div>
            <div class="text-h6 font-weight-bold">{{ formatMoney(taxCenter.iva?.payable_estimated || 0) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card class="mb-4">
      <v-card-title>Retenciones por concepto</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="340">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Concepto</th>
              <th>Aplica a</th>
              <th class="text-right">Tarifa</th>
              <th class="text-right">Base</th>
              <th class="text-right">Estimado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in withholdingItems" :key="item.code">
              <td><code>{{ item.code }}</code></td>
              <td>{{ item.name }}</td>
              <td>{{ item.applies_to }}</td>
              <td class="text-right">{{ Number(item.rate || 0).toFixed(4) }}%</td>
              <td class="text-right">{{ formatMoney(item.taxable_base || 0) }}</td>
              <td class="text-right">{{ formatMoney(item.estimated_withholding || 0) }}</td>
            </tr>
            <tr v-if="withholdingItems.length === 0">
              <td colspan="6" class="text-center text-medium-emphasis py-6">Sin configuraciones de retencion para el periodo.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Retenciones"
          icon="mdi-percent-outline"
          :items="paginatedWithholdingItems"
          :total-items="withholdingItems.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="code"
          title-field="name"
          avatar-icon="mdi-percent-outline"
          avatar-color="warning"
          empty-message="Sin configuraciones de retencion para el periodo."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onWithholdingListPage"
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
            <div class="text-caption">Tarifa: {{ Number(item.rate || 0).toFixed(4) }}%</div>
            <div class="text-caption">Base: {{ formatMoney(item.taxable_base || 0) }}</div>
            <div class="text-caption">Estimado: {{ formatMoney(item.estimated_withholding || 0) }}</div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>Vista previa exogena (operaciones por tercero)</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="360">
          <thead>
            <tr>
              <th>Tercero</th>
              <th class="text-right">Ventas</th>
              <th class="text-right">Compras</th>
              <th class="text-right">Total</th>
              <th class="text-right">Operaciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in exogenaRows" :key="row.counterparty_id">
              <td><code>{{ row.counterparty_id }}</code></td>
              <td class="text-right">{{ formatMoney(row.sales_total || 0) }}</td>
              <td class="text-right">{{ formatMoney(row.purchases_total || 0) }}</td>
              <td class="text-right">{{ formatMoney(row.grand_total || 0) }}</td>
              <td class="text-right">{{ row.operations_count || 0 }}</td>
            </tr>
            <tr v-if="exogenaRows.length === 0">
              <td colspan="5" class="text-center text-medium-emphasis py-6">Sin operaciones para vista exogena.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Vista previa exogena"
          icon="mdi-file-chart-outline"
          :items="paginatedExogenaRows"
          :total-items="exogenaRows.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="counterparty_id"
          title-field="counterparty_id"
          avatar-icon="mdi-file-chart-outline"
          avatar-color="indigo"
          empty-message="Sin operaciones para vista exogena."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onExogenaListPage"
        >
          <template #title="{ item }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <code>{{ item.counterparty_id }}</code>
              <v-chip size="x-small" color="primary">Ops: {{ item.operations_count || 0 }}</v-chip>
            </div>
          </template>
          <template #content="{ item }">
            <div class="text-caption">Ventas: {{ formatMoney(item.sales_total || 0) }}</div>
            <div class="text-caption">Compras: {{ formatMoney(item.purchases_total || 0) }}</div>
            <div class="text-caption font-weight-medium">Total: {{ formatMoney(item.grand_total || 0) }}</div>
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
const taxCenter = ref({
  iva: {
    generated: 0,
    deductible_estimated: 0,
    purchases_base_reference: 0,
    payable_estimated: 0
  },
  withholdings: { kpis: {}, items: [] },
  exogena_preview: []
})

const LIST_PAGE_SIZE = 8
const withholdingListPage = ref(1)
const exogenaListPage = ref(1)

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Centro tributario', disabled: true }
])

const withholdingItems = computed(() => taxCenter.value?.withholdings?.items || [])
const withholdingKpis = computed(() => taxCenter.value?.withholdings?.kpis || {})
const exogenaRows = computed(() => taxCenter.value?.exogena_preview || [])

const withholdingTotalPages = computed(() => Math.max(1, Math.ceil(withholdingItems.value.length / LIST_PAGE_SIZE)))
const paginatedWithholdingItems = computed(() => {
  const start = (withholdingListPage.value - 1) * LIST_PAGE_SIZE
  return withholdingItems.value.slice(start, start + LIST_PAGE_SIZE)
})

const exogenaTotalPages = computed(() => Math.max(1, Math.ceil(exogenaRows.value.length / LIST_PAGE_SIZE)))
const paginatedExogenaRows = computed(() => {
  const start = (exogenaListPage.value - 1) * LIST_PAGE_SIZE
  return exogenaRows.value.slice(start, start + LIST_PAGE_SIZE)
})

const onWithholdingListPage = ({ page }) => {
  withholdingListPage.value = Number(page || 1)
}

const onExogenaListPage = ({ page }) => {
  exogenaListPage.value = Number(page || 1)
}

const loadTaxCenter = async () => {
  if (!tenantId.value) return

  loading.value = true
  try {
    const result = await accountingService.getTaxCenterData(tenantId.value, filters.value)
    if (!result.success) {
      show(result.error || 'No se pudo cargar centro tributario.', 'error')
      return
    }

    taxCenter.value = result.data || taxCenter.value
  } finally {
    loading.value = false
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({ path: '/accounting', query: { tab } })
}

watch(() => withholdingItems.value.length, () => {
  withholdingListPage.value = 1
})

watch(() => exogenaRows.value.length, () => {
  exogenaListPage.value = 1
})

watch(withholdingTotalPages, (total) => {
  if (withholdingListPage.value > total) withholdingListPage.value = total
})

watch(exogenaTotalPages, (total) => {
  if (exogenaListPage.value > total) exogenaListPage.value = total
})

onMounted(loadTaxCenter)
</script>
