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
          <v-icon color="deep-purple">mdi-robot-outline</v-icon>
          Control Interno IA
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
          <v-btn color="secondary" prepend-icon="mdi-robot-outline" :loading="analyzingAI" :disabled="anomalies.length === 0" @click="analyzeWithAI">
            Analisis IA
          </v-btn>
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="loadAnomalies">
            Refrescar
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-text-field
              v-model="filters.date_from"
              label="Desde"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field
              v-model="filters.date_to"
              label="Hasta"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="2">
            <v-text-field
              v-model.number="filters.limit"
              label="Muestra"
              type="number"
              min="100"
              max="5000"
              step="100"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-btn color="primary" variant="tonal" block @click="loadAnomalies">Deteccion estadistica</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col cols="12" md="4">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Tamano de muestra</div>
            <div class="text-h6 font-weight-bold">{{ sampleSize }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Anomalias detectadas</div>
            <div class="text-h6 font-weight-bold">{{ anomalies.length }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card variant="outlined" class="h-100">
          <v-card-text>
            <div class="text-caption text-medium-emphasis">Nivel de riesgo IA</div>
            <v-chip size="small" :color="riskLevelColor">{{ aiInsights?.risk_level || 'N/A' }}</v-chip>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card class="mb-4" v-if="aiInsights">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="secondary">mdi-lightbulb-on-outline</v-icon>
        Hallazgos IA
      </v-card-title>
      <v-divider />
      <v-card-text>
        <div class="mb-3"><strong>Resumen:</strong> {{ aiInsights.summary || '-' }}</div>
        <div class="mb-2"><strong>Top hallazgos:</strong></div>
        <v-list density="compact" lines="one">
          <v-list-item v-for="(item, idx) in (aiInsights.top_findings || [])" :key="`finding-${idx}`">
            <v-list-item-title class="text-body-2">{{ item.finding || '-' }}</v-list-item-title>
            <v-list-item-subtitle class="text-caption">{{ item.reason || '-' }} ({{ item.entry_number || '-' }})</v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <div class="mb-2 mt-2"><strong>Acciones recomendadas:</strong></div>
        <v-list density="compact" lines="one">
          <v-list-item v-for="(item, idx) in (aiInsights.recommended_actions || [])" :key="`action-${idx}`">
            <v-list-item-title class="text-body-2">{{ item }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>Anomalias detectadas</v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="560">
          <thead>
            <tr>
              <th>Asiento</th>
              <th>Fecha</th>
              <th>Cuenta</th>
              <th>Modulo</th>
              <th class="text-right">Debito</th>
              <th class="text-right">Credito</th>
              <th class="text-right">Magnitud</th>
              <th class="text-right">Z-Score</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in anomalies" :key="item._key">
              <td>#{{ item.entry_number || '-' }}</td>
              <td>{{ formatDate(item.entry_date) || '-' }}</td>
              <td>
                <code>{{ item.account_code || '-' }}</code>
                <div class="text-caption">{{ item.account_name || '-' }}</div>
              </td>
              <td>{{ item.source_module || '-' }}</td>
              <td class="text-right">{{ formatMoney(item.debit_amount || 0) }}</td>
              <td class="text-right">{{ formatMoney(item.credit_amount || 0) }}</td>
              <td class="text-right">{{ formatMoney(item.magnitude || 0) }}</td>
              <td class="text-right">{{ Number(item.z_score || 0).toFixed(2) }}</td>
            </tr>
            <tr v-if="anomalies.length === 0">
              <td colspan="8" class="text-center text-medium-emphasis py-6">Sin anomalias para el periodo.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Anomalias contables"
          icon="mdi-alert-decagram-outline"
          :items="paginatedAnomalies"
          :total-items="anomalies.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="_key"
          title-field="entry_number"
          avatar-icon="mdi-alert-decagram-outline"
          avatar-color="error"
          empty-message="Sin anomalias para el periodo."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onAnomaliesListPage"
        >
          <template #title="{ item }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <strong>#{{ item.entry_number || '-' }}</strong>
                <span class="ml-2">{{ formatDate(item.entry_date) || '-' }}</span>
              </div>
              <v-chip size="x-small" color="error">Z: {{ Number(item.z_score || 0).toFixed(2) }}</v-chip>
            </div>
          </template>
          <template #content="{ item }">
            <div class="text-caption">
              <code>{{ item.account_code || '-' }}</code> {{ item.account_name || '-' }} | {{ item.source_module || '-' }}
            </div>
            <div class="text-caption">Debito: {{ formatMoney(item.debit_amount || 0) }} | Credito: {{ formatMoney(item.credit_amount || 0) }}</div>
            <div class="text-caption font-weight-medium">Magnitud: {{ formatMoney(item.magnitude || 0) }}</div>
            <div class="text-caption">{{ item.line_description || '-' }}</div>
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
import { formatDate, formatMoney } from '@/utils/formatters'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { show } = useNotification()
const { viewMode, isTableView } = useAccountingViewMode()

const period = accountingService.getDefaultPeriod()
const filters = ref({
  date_from: period.date_from,
  date_to: period.date_to,
  limit: 2000
})

const loading = ref(false)
const analyzingAI = ref(false)

const sampleSize = ref(0)
const anomalies = ref([])
const aiInsights = ref(null)

const LIST_PAGE_SIZE = 8
const anomaliesListPage = ref(1)

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Control IA', disabled: true }
])

const anomaliesTotalPages = computed(() => Math.max(1, Math.ceil(anomalies.value.length / LIST_PAGE_SIZE)))
const paginatedAnomalies = computed(() => {
  const start = (anomaliesListPage.value - 1) * LIST_PAGE_SIZE
  return anomalies.value.slice(start, start + LIST_PAGE_SIZE)
})

const riskLevelColor = computed(() => {
  const level = String(aiInsights.value?.risk_level || '').toUpperCase()
  if (level === 'HIGH') return 'error'
  if (level === 'MEDIUM') return 'warning'
  if (level === 'LOW') return 'success'
  return 'grey'
})

const onAnomaliesListPage = ({ page }) => {
  anomaliesListPage.value = Number(page || 1)
}

const loadAnomalies = async () => {
  if (!tenantId.value) return

  loading.value = true
  aiInsights.value = null
  try {
    const result = await accountingService.detectAccountingAnomalies(tenantId.value, filters.value)
    if (!result.success) {
      show(result.error || 'No se pudieron detectar anomalias.', 'error')
      return
    }

    sampleSize.value = Number(result.data?.sample_size || 0)
    anomalies.value = (result.data?.anomalies || []).map((item, index) => ({
      ...item,
      _key: `${item.entry_id || 'entry'}-${item.account_code || 'account'}-${index}`
    }))
  } finally {
    loading.value = false
  }
}

const analyzeWithAI = async () => {
  if (!tenantId.value || anomalies.value.length === 0) return

  analyzingAI.value = true
  try {
    const result = await accountingService.requestAIAnomalyInsights({
      tenantId: tenantId.value,
      anomalies: anomalies.value
    })

    if (!result.success) {
      show(result.error || 'No se pudo ejecutar analisis IA.', 'error')
      return
    }

    aiInsights.value = result.data || null
    show('Analisis IA completado.', 'success')
  } finally {
    analyzingAI.value = false
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'ai')
  router.push({ path: '/accounting', query: { tab } })
}

watch(() => anomalies.value.length, () => {
  anomaliesListPage.value = 1
})

watch(anomaliesTotalPages, (total) => {
  if (anomaliesListPage.value > total) anomaliesListPage.value = total
})

onMounted(loadAnomalies)
</script>
