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
          <v-icon color="error">mdi-lock-check-outline</v-icon>
          Cierre Contable por Periodo
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
            color="primary"
            variant="tonal"
            prepend-icon="mdi-refresh"
            :loading="loadingClosures || loadingChecklist"
            @click="loadAll"
          >
            Refrescar
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-text-field v-model.number="period.year" type="number" label="Anio" variant="outlined" density="compact" hide-details />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model.number="period.month"
              :items="monthOptions"
              item-title="title"
              item-value="value"
              label="Mes"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field v-model="period.notes" label="Nota (opcional)" variant="outlined" density="compact" hide-details />
          </v-col>
        </v-row>

        <div class="d-flex align-center gap-2 mt-4">
          <v-btn
            color="error"
            prepend-icon="mdi-lock"
            :loading="closingPeriod"
            :disabled="!canCloseCurrentPeriod"
            @click="closeCurrentPeriod"
          >
            Cerrar periodo
          </v-btn>
          <v-btn
            color="warning"
            variant="tonal"
            prepend-icon="mdi-lock-open-variant"
            :loading="openingPeriod"
            :disabled="!canOpenCurrentPeriod"
            @click="openCurrentPeriod"
          >
            Abrir periodo
          </v-btn>
          <v-chip :color="currentPeriodStatus.color" size="small">
            Estado: {{ currentPeriodStatus.label }}
          </v-chip>
        </div>

        <v-alert
          v-if="openPeriodElsewhere"
          type="warning"
          variant="tonal"
          class="mt-4"
          density="comfortable"
        >
          Ya existe un periodo abierto ({{ openPeriodElsewhere.period_year }}-{{ String(openPeriodElsewhere.period_month).padStart(2, '0') }}).
          Solo puedes tener un periodo OPEN por tenant.
        </v-alert>

        <v-alert type="info" variant="tonal" class="mt-4" density="comfortable">
          Solo se puede contabilizar cuando el periodo existe y esta OPEN. Si no existe o esta CLOSED, el posteo se bloquea.
        </v-alert>
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Checklist previo al cierre</span>
        <v-chip size="small" color="primary">{{ closeChecks.length }} controles</v-chip>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="340">
          <thead>
            <tr>
              <th>Control</th>
              <th>Estado</th>
              <th class="text-right">Valor</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in closeChecks" :key="item.key">
              <td>{{ item.title }}</td>
              <td>
                <v-chip size="x-small" :color="getCheckColor(item.status)">
                  {{ item.status }}
                </v-chip>
              </td>
              <td class="text-right">{{ item.value ?? '-' }}</td>
              <td class="text-caption">{{ item.detail || '-' }}</td>
            </tr>
            <tr v-if="closeChecks.length === 0">
              <td colspan="4" class="text-center text-medium-emphasis py-6">Sin controles para el periodo seleccionado.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Checklist de cierre"
          icon="mdi-clipboard-check-outline"
          :items="paginatedCloseChecks"
          :total-items="closeChecks.length"
          :loading="loadingChecklist"
          :page-size="CHECKS_LIST_PAGE_SIZE"
          item-key="key"
          title-field="title"
          avatar-icon="mdi-clipboard-check-outline"
          avatar-color="primary"
          empty-message="Sin controles para el periodo seleccionado."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onChecksListPage"
        >
          <template #title="{ item }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <span class="font-weight-medium">{{ item.title }}</span>
              <v-chip size="x-small" :color="getCheckColor(item.status)">
                {{ item.status }}
              </v-chip>
            </div>
          </template>
          <template #content="{ item }">
            <div class="text-caption">Valor: {{ item.value ?? '-' }}</div>
            <div class="text-caption">{{ item.detail || '-' }}</div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>Historial de cierres</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="520">
          <thead>
            <tr>
              <th>Periodo</th>
              <th>Estado</th>
              <th>Cerrado</th>
              <th>Reabierto</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in closures" :key="item.closure_id">
              <td>
                <strong>{{ item.period_year }}-{{ String(item.period_month).padStart(2, '0') }}</strong>
              </td>
              <td>
                <v-chip size="x-small" :color="item.status === 'CLOSED' ? 'error' : 'success'">
                  {{ item.status === 'CLOSED' ? 'CERRADO' : 'ABIERTO' }}
                </v-chip>
              </td>
              <td>{{ formatDate(item.closed_at) || '-' }}</td>
              <td>{{ formatDate(item.reopened_at) || '-' }}</td>
              <td class="text-caption">{{ item.notes || '-' }}</td>
            </tr>
            <tr v-if="closures.length === 0">
              <td colspan="5" class="text-center text-medium-emphasis py-6">No hay cierres registrados.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Historial de cierres"
          icon="mdi-history"
          :items="paginatedClosures"
          :total-items="closures.length"
          :loading="loadingClosures"
          :page-size="CLOSURES_LIST_PAGE_SIZE"
          item-key="closure_id"
          title-field="period_year"
          avatar-icon="mdi-lock-check-outline"
          avatar-color="error"
          empty-message="No hay cierres registrados."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onClosuresListPage"
        >
          <template #title="{ item }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <strong>{{ item.period_year }}-{{ String(item.period_month).padStart(2, '0') }}</strong>
              <v-chip size="x-small" :color="item.status === 'CLOSED' ? 'error' : 'success'">
                {{ item.status === 'CLOSED' ? 'CERRADO' : 'ABIERTO' }}
              </v-chip>
            </div>
          </template>
          <template #content="{ item }">
            <div class="text-caption"><strong>Cerrado:</strong> {{ formatDate(item.closed_at) || '-' }}</div>
            <div class="text-caption"><strong>Reabierto:</strong> {{ formatDate(item.reopened_at) || '-' }}</div>
            <div class="text-caption"><strong>Notas:</strong> {{ item.notes || '-' }}</div>
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
import { formatDateTime as formatDate } from '@/utils/formatters'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { show } = useNotification()
const { viewMode, isTableView } = useAccountingViewMode()

const now = new Date()
const period = ref({
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  notes: ''
})

const loadingClosures = ref(false)
const loadingChecklist = ref(false)
const closingPeriod = ref(false)
const openingPeriod = ref(false)
const closures = ref([])
const checklist = ref({ period: {}, checks: [] })
const closuresListPage = ref(1)
const checksListPage = ref(1)
const CLOSURES_LIST_PAGE_SIZE = 8
const CHECKS_LIST_PAGE_SIZE = 6

const monthOptions = [
  { value: 1, title: '01 - Enero' },
  { value: 2, title: '02 - Febrero' },
  { value: 3, title: '03 - Marzo' },
  { value: 4, title: '04 - Abril' },
  { value: 5, title: '05 - Mayo' },
  { value: 6, title: '06 - Junio' },
  { value: 7, title: '07 - Julio' },
  { value: 8, title: '08 - Agosto' },
  { value: 9, title: '09 - Septiembre' },
  { value: 10, title: '10 - Octubre' },
  { value: 11, title: '11 - Noviembre' },
  { value: 12, title: '12 - Diciembre' }
]

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Cierre Contable', disabled: true }
])

const currentPeriodStatus = computed(() => {
  const found = closures.value.find((item) =>
    Number(item.period_year) === Number(period.value.year) &&
    Number(item.period_month) === Number(period.value.month)
  )

  if (!found) {
    return { code: 'MISSING', label: 'NO CREADO', color: 'grey' }
  }
  if (found.status === 'CLOSED') {
    return { code: 'CLOSED', label: 'CERRADO', color: 'error' }
  }
  return { code: 'OPEN', label: 'ABIERTO', color: 'success' }
})

const openPeriodElsewhere = computed(() => {
  return closures.value.find((item) =>
    item.status === 'OPEN' &&
    (
      Number(item.period_year) !== Number(period.value.year) ||
      Number(item.period_month) !== Number(period.value.month)
    )
  ) || null
})

const canCloseCurrentPeriod = computed(() => currentPeriodStatus.value.code === 'OPEN')
const canOpenCurrentPeriod = computed(() => currentPeriodStatus.value.code !== 'OPEN' && !openPeriodElsewhere.value)
const closuresTotalPages = computed(() => Math.max(1, Math.ceil(closures.value.length / CLOSURES_LIST_PAGE_SIZE)))
const paginatedClosures = computed(() => {
  const start = (closuresListPage.value - 1) * CLOSURES_LIST_PAGE_SIZE
  return closures.value.slice(start, start + CLOSURES_LIST_PAGE_SIZE)
})
const closeChecks = computed(() => checklist.value?.checks || [])
const checksTotalPages = computed(() => Math.max(1, Math.ceil(closeChecks.value.length / CHECKS_LIST_PAGE_SIZE)))
const paginatedCloseChecks = computed(() => {
  const start = (checksListPage.value - 1) * CHECKS_LIST_PAGE_SIZE
  return closeChecks.value.slice(start, start + CHECKS_LIST_PAGE_SIZE)
})

const getCheckColor = (status) => {
  if (status === 'PASS') return 'success'
  if (status === 'WARN') return 'warning'
  if (status === 'INFO') return 'primary'
  return 'grey'
}

const buildPeriodRange = (year, month) => {
  const safeYear = Number(year || now.getFullYear())
  const safeMonth = Math.min(12, Math.max(1, Number(month || (now.getMonth() + 1))))
  const dateFrom = `${safeYear}-${String(safeMonth).padStart(2, '0')}-01`
  const lastDay = new Date(safeYear, safeMonth, 0).getDate()
  const dateTo = `${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { date_from: dateFrom, date_to: dateTo }
}

const loadClosures = async () => {
  if (!tenantId.value) return
  loadingClosures.value = true
  try {
    const result = await accountingService.getPeriodClosures(tenantId.value, {
      limit: 60
    })

    if (!result.success) {
      show(result.error || 'No se pudo cargar historial de cierres.', 'error')
      return
    }

    closures.value = result.data || []
  } finally {
    loadingClosures.value = false
  }
}

const loadChecklist = async () => {
  if (!tenantId.value) return
  loadingChecklist.value = true
  try {
    const periodRange = buildPeriodRange(period.value.year, period.value.month)
    const result = await accountingService.getCloseChecklist(tenantId.value, periodRange)
    if (!result.success) {
      show(result.error || 'No se pudo cargar checklist de cierre.', 'error')
      return
    }
    checklist.value = result.data || { period: periodRange, checks: [] }
  } finally {
    loadingChecklist.value = false
  }
}

const loadAll = async () => {
  await Promise.all([loadClosures(), loadChecklist()])
}

const closeCurrentPeriod = async () => {
  if (!tenantId.value) return
  closingPeriod.value = true
  try {
    const result = await accountingService.closePeriod(tenantId.value, {
      year: period.value.year,
      month: period.value.month,
      notes: period.value.notes || null
    })

    if (!result.success) {
      show(result.error || 'No se pudo cerrar el periodo.', 'error')
      return
    }

    show('Periodo cerrado correctamente.', 'success')
    await loadAll()
  } finally {
    closingPeriod.value = false
  }
}

const openCurrentPeriod = async () => {
  if (!tenantId.value) return
  openingPeriod.value = true
  try {
    const result = await accountingService.reopenPeriod(tenantId.value, {
      year: period.value.year,
      month: period.value.month,
      notes: period.value.notes || null
    })

    if (!result.success) {
      show(result.error || 'No se pudo abrir el periodo.', 'error')
      return
    }

    show('Periodo abierto correctamente.', 'success')
    await loadAll()
  } finally {
    openingPeriod.value = false
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({ path: '/accounting', query: { tab } })
}

const onClosuresListPage = ({ page }) => {
  closuresListPage.value = Number(page || 1)
}

const onChecksListPage = ({ page }) => {
  checksListPage.value = Number(page || 1)
}

watch(() => closures.value.length, () => {
  closuresListPage.value = 1
})

watch(() => closeChecks.value.length, () => {
  checksListPage.value = 1
})

watch(closuresTotalPages, (total) => {
  if (closuresListPage.value > total) closuresListPage.value = total
})

watch(checksTotalPages, (total) => {
  if (checksListPage.value > total) checksListPage.value = total
})

watch(
  () => [period.value.year, period.value.month],
  () => {
    loadChecklist()
  }
)

onMounted(loadAll)
</script>
