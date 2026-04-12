<template>
  <div class="ai-insights-page ofir-page">
    <v-card class="ai-insights-hero mb-4" elevation="0">
      <v-card-text class="pa-5 pa-md-6">
        <div class="d-flex flex-column flex-lg-row justify-space-between ga-5">
          <div class="ai-insights-hero__copy">
            <div class="text-overline text-primary font-weight-bold mb-2">Centro IA</div>
            <h1 class="text-h4 font-weight-black mb-3">Consultas operativas y atajos accionables</h1>
            <p class="text-body-1 text-medium-emphasis mb-4">
              Trajimos a web una capa compacta del Centro IA para consultar ventas, inventario, compras, caja, cartera y produccion sin depender del modo offline de mobile.
            </p>

            <div class="d-flex flex-wrap ga-2">
              <v-chip color="primary" variant="flat">{{ quickActions.length }} atajos</v-chip>
              <v-chip color="secondary" variant="tonal">{{ selectedDomains.length || 'Todos' }} dominios activos</v-chip>
              <v-chip color="success" variant="tonal">Agente operativo Supabase</v-chip>
            </div>
          </div>

          <v-sheet class="ai-insights-hero__side pa-4" rounded="xl">
            <div class="text-subtitle-1 font-weight-bold mb-2">Consultas sugeridas</div>
            <div class="d-flex flex-column ga-2">
              <v-btn
                v-for="item in suggestedQuestions"
                :key="item"
                variant="text"
                color="primary"
                class="justify-start text-none"
                @click="applySuggestedQuestion(item)"
              >
                {{ item }}
              </v-btn>
            </div>
          </v-sheet>
        </div>
      </v-card-text>
    </v-card>

    <v-row class="mb-2">
      <v-col
        v-for="action in quickActions"
        :key="action.id"
        cols="12"
        sm="6"
        lg="4"
      >
        <v-card class="h-100 ai-insights-card" variant="outlined">
          <v-card-text>
            <div class="d-flex align-center justify-space-between ga-3 mb-3">
              <v-avatar :color="action.color" variant="tonal" size="42">
                <v-icon>{{ action.icon }}</v-icon>
              </v-avatar>
              <v-chip size="small" variant="outlined">{{ action.domains.join(', ') }}</v-chip>
            </div>
            <div class="text-h6 mb-1">{{ action.title }}</div>
            <div class="text-body-2 text-medium-emphasis mb-4">{{ action.subtitle }}</div>
            <v-btn
              block
              :color="action.color"
              variant="tonal"
              :loading="loading && activeActionId === action.id"
              @click="runQuickAction(action)"
            >
              Ejecutar
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card>
      <v-card-title class="d-flex flex-wrap align-center justify-space-between ga-3">
        <div>
          <div class="text-h6">Agente operativo</div>
          <div class="text-caption text-medium-emphasis">Consulta libre con filtros por dominio.</div>
        </div>
        <div class="d-flex flex-wrap ga-2">
          <v-chip
            v-for="domain in domainOptions"
            :key="domain.id"
            :color="selectedDomains.includes(domain.id) ? 'primary' : 'grey'"
            :variant="selectedDomains.includes(domain.id) ? 'flat' : 'outlined'"
            @click="toggleDomain(domain.id)"
          >
            {{ domain.label }}
          </v-chip>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-textarea
          v-model="queryText"
          label="Pregunta operativa"
          variant="outlined"
          rows="4"
          auto-grow
          placeholder="Ej: resume stock en riesgo y que deberiamos comprar esta semana"
        />

        <div class="d-flex flex-wrap ga-2">
          <v-btn
            color="primary"
            prepend-icon="mdi-robot-outline"
            :loading="loading"
            @click="runQuery()"
          >
            Consultar IA
          </v-btn>
          <v-btn
            variant="outlined"
            color="secondary"
            :disabled="loading"
            @click="clearResult"
          >
            Limpiar
          </v-btn>
        </div>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mt-4"
        >
          {{ error }}
        </v-alert>

        <v-card
          v-if="result"
          class="mt-4"
          variant="outlined"
        >
          <v-card-text>
            <div class="d-flex flex-wrap align-center ga-2 mb-3">
              <v-chip color="success" variant="tonal" size="small" v-if="result.confidence != null">
                Confianza {{ Math.round(result.confidence * 100) }}%
              </v-chip>
              <v-chip color="secondary" variant="tonal" size="small" v-if="result.model">
                {{ result.model }}
              </v-chip>
              <v-chip color="info" variant="tonal" size="small" v-if="result.cacheHit">
                Cache
              </v-chip>
            </div>

            <div class="text-subtitle-1 font-weight-bold mb-2">Respuesta</div>
            <div class="text-body-1 mb-4" style="white-space: pre-wrap;">{{ result.answer }}</div>

            <div v-if="result.summary" class="mb-4">
              <div class="text-subtitle-2 font-weight-bold mb-1">Resumen</div>
              <div class="text-body-2 text-medium-emphasis">{{ result.summary }}</div>
            </div>

            <div v-if="result.suggestedActions.length" class="mb-4">
              <div class="text-subtitle-2 font-weight-bold mb-1">Acciones sugeridas</div>
              <v-list density="compact" class="bg-transparent pa-0">
                <v-list-item v-for="item in result.suggestedActions" :key="item" class="px-0">
                  <template #prepend>
                    <v-icon color="primary" size="18">mdi-arrow-right-circle-outline</v-icon>
                  </template>
                  <v-list-item-title class="text-wrap">{{ item }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </div>

            <v-alert
              v-if="result.clarifyingQuestion"
              type="info"
              variant="tonal"
              class="mb-4"
            >
              {{ result.clarifyingQuestion }}
            </v-alert>

            <div v-if="result.retrievalErrors.length" class="text-caption text-warning">
              Contextos con advertencia: {{ result.retrievalErrors.join(' | ') }}
            </div>
          </v-card-text>
        </v-card>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useNotification } from '@/composables/useNotification'
import { askOpsRagAgent } from '@/services/opsRagAgent.service'
import {
  AI_INSIGHT_QUICK_ACTIONS,
  OPS_DOMAIN_OPTIONS,
  normalizeOpsInsightResult,
} from '@/utils/aiInsightsCenter'
import {
  buildQuickActionExecution,
  toggleDomainSelection,
  validateOpsAgentRequest,
} from '@/utils/aiInsightsViewModel'

const { tenantId } = useTenant()
const { show } = useNotification()

const quickActions = AI_INSIGHT_QUICK_ACTIONS
const domainOptions = OPS_DOMAIN_OPTIONS
const suggestedQuestions = [
  'Que productos estan en mayor riesgo de quiebre hoy',
  'Resume ventas y ticket promedio de los ultimos dias',
  'Que compras deberiamos priorizar esta semana',
]

const queryText = ref('')
const selectedDomains = ref([])
const loading = ref(false)
const error = ref('')
const result = ref(null)
const activeActionId = ref('')

const toggleDomain = (domainId) => {
  selectedDomains.value = toggleDomainSelection(selectedDomains.value, domainId)
}

const applySuggestedQuestion = (question) => {
  queryText.value = question
}

const clearResult = () => {
  error.value = ''
  result.value = null
  activeActionId.value = ''
}

const runQuery = async (payload = {}) => {
  const validation = validateOpsAgentRequest({
    tenantId: tenantId.value,
    query: payload.query || queryText.value,
  })
  if (!validation.valid) {
    error.value = validation.error
    return
  }
  const text = validation.data.query

  loading.value = true
  error.value = ''
  try {
    const response = await askOpsRagAgent({
      tenantId: tenantId.value,
      query: text,
      domains: Array.isArray(payload.domains) ? payload.domains : selectedDomains.value,
    })
    if (!response.success || !response?.data) {
      error.value = response.error || 'No se pudo consultar el agente operativo.'
      result.value = null
      return
    }

    queryText.value = text
    result.value = normalizeOpsInsightResult(response.data)
  } finally {
    loading.value = false
    activeActionId.value = ''
  }
}

const runQuickAction = async (action) => {
  const execution = buildQuickActionExecution(action)
  activeActionId.value = execution.activeActionId
  selectedDomains.value = execution.domains
  queryText.value = execution.query
  await runQuery({
    query: execution.query,
    domains: execution.domains,
  })
  if (!error.value) {
    show(`${action.title} ejecutado`, 'success')
  }
}
</script>

<style scoped>
.ai-insights-hero {
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.14), transparent 42%),
    radial-gradient(circle at bottom right, rgba(20, 184, 166, 0.16), transparent 38%),
    linear-gradient(135deg, rgba(10, 18, 34, 0.98), rgba(19, 39, 73, 0.96));
  color: white;
  border-radius: 24px;
}

.ai-insights-hero__copy {
  max-width: 760px;
}

.ai-insights-hero__side {
  min-width: 280px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.ai-insights-card {
  border-radius: 18px;
}
</style>
