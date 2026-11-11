<template>
  <div class="ai-insights-page ofir-page" data-testid="ai-insights-page">
    <v-card class="ai-insights-hero mb-4" elevation="0">
      <v-card-text class="pa-5 pa-md-6">
        <div class="d-flex flex-column flex-lg-row justify-space-between ga-5">
          <div class="ai-insights-hero__copy">
            <div class="text-overline text-primary font-weight-bold mb-2">Centro IA</div>
            <h1 class="text-h4 font-weight-black mb-3">
              Consultas operativas y atajos accionables
            </h1>
            <p class="text-body-1 text-medium-emphasis mb-4">
              Trajimos a web una capa compacta del Centro IA para consultar ventas, inventario,
              compras, caja, cartera y produccion sin depender del modo offline de mobile.
            </p>

            <div class="d-flex flex-wrap ga-2">
              <v-chip color="primary" variant="flat">{{ quickActions.length }} atajos</v-chip>
              <v-chip color="secondary" variant="tonal"
                >{{ selectedDomains.length || 'Todos' }} dominios activos</v-chip
              >
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
      <v-col v-for="action in quickActions" :key="action.id" cols="12" sm="6" lg="4">
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

    <v-card class="mb-4">
      <v-card-title class="d-flex flex-wrap align-center justify-space-between ga-3">
        <div>
          <div class="text-h6">Telemetría IA</div>
          <div class="text-caption text-medium-emphasis">
            Uso local capturado en este navegador.
          </div>
        </div>
        <div class="d-flex flex-wrap ga-2">
          <v-btn
            variant="outlined"
            color="primary"
            prepend-icon="mdi-refresh"
            @click="refreshTelemetry"
          >
            Actualizar
          </v-btn>
          <v-btn
            variant="text"
            color="error"
            prepend-icon="mdi-delete-outline"
            @click="clearTelemetry"
          >
            Limpiar local
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">Cloud Avoidance</div>
              <div class="text-h5 font-weight-black">
                {{ formatPercent(telemetrySummary.cloud_avoidance_rate) }}
              </div>
              <div class="text-caption">
                {{ telemetrySummary.non_cloud_events }} sin cloud de
                {{ telemetrySummary.total_events }}
              </div>
            </v-sheet>
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">Costo estimado</div>
              <div class="text-h5 font-weight-black">
                {{ formatMoney(telemetrySummary.total_cost) }}
              </div>
              <div class="text-caption">Eventos locales recientes</div>
            </v-sheet>
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">Latencia p95</div>
              <div class="text-h5 font-weight-black">
                {{ formatMs(telemetrySummary.latency_p95_ms) }}
              </div>
              <div class="text-caption">Todas las fuentes</div>
            </v-sheet>
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">Errores</div>
              <div class="text-h5 font-weight-black">
                {{ formatPercent(telemetrySummary.error_rate) }}
              </div>
              <div class="text-caption">
                {{ telemetrySummary.errors_by_model.reduce((sum, item) => sum + item.count, 0) }}
                eventos
              </div>
            </v-sheet>
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">OCR imagen cloud</div>
              <div class="text-h5 font-weight-black">
                {{ formatPercent(telemetrySummary.ocr_image_cloud_rate) }}
              </div>
              <div class="text-caption">
                {{ telemetrySummary.ocr_image_cloud_events }} cloud de
                {{ telemetrySummary.ocr_image_events }}
              </div>
            </v-sheet>
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">Costo últimos 7 días</div>
              <div class="text-h5 font-weight-black">
                {{ formatMoney(telemetrySummary.cost_last_7_days) }}
              </div>
              <div class="text-caption">Resumen agregado en servidor</div>
            </v-sheet>
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">Costo últimos 30 días</div>
              <div class="text-h5 font-weight-black">
                {{ formatMoney(telemetrySummary.cost_last_30_days) }}
              </div>
              <div class="text-caption">Resumen agregado en servidor</div>
            </v-sheet>
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <v-sheet class="ai-telemetry-metric pa-4" rounded="lg">
              <div class="text-caption text-medium-emphasis">Correcciones manuales</div>
              <div class="text-h5 font-weight-black">{{ telemetrySummary.corrected_events }}</div>
              <div class="text-caption">Resultados IA corregidos</div>
            </v-sheet>
          </v-col>
        </v-row>

        <v-alert v-if="!telemetryEvents.length" type="info" variant="tonal" class="mt-4">
          Aun no hay eventos locales. Ejecuta una consulta o un flujo IA para poblar este panel.
        </v-alert>

        <v-alert
          v-if="telemetryEvents.length && telemetryRemoteError"
          type="warning"
          variant="tonal"
          class="mt-4"
        >
          {{ telemetryRemoteError }} Se muestran eventos locales disponibles.
        </v-alert>

        <template v-if="telemetryEvents.length">
          <v-row class="mt-1">
            <v-col cols="12" md="3">
              <div class="text-subtitle-2 font-weight-bold mb-2">Fuentes de resolución</div>
              <div class="d-flex flex-column ga-2">
                <div v-for="source in telemetrySummary.by_source" :key="source.key">
                  <div class="d-flex justify-space-between text-caption mb-1">
                    <span>{{ sourceLabel(source.key) }}</span>
                    <span>{{ formatPercent(source.percent) }}</span>
                  </div>
                  <v-progress-linear
                    :model-value="source.percent"
                    color="primary"
                    height="8"
                    rounded
                  />
                </div>
              </div>
            </v-col>
            <v-col cols="12" md="3">
              <div class="text-subtitle-2 font-weight-bold mb-2">Top funcionalidades</div>
              <v-list density="compact" class="bg-transparent pa-0">
                <v-list-item
                  v-for="item in telemetrySummary.by_feature.slice(0, 5)"
                  :key="item.key"
                  class="px-0"
                >
                  <v-list-item-title class="text-wrap">{{
                    featureLabel(item.key)
                  }}</v-list-item-title>
                  <v-list-item-subtitle
                    >{{ item.count }} eventos · {{ item.cloud }} cloud ·
                    {{ item.errors }} errores</v-list-item-subtitle
                  >
                </v-list-item>
              </v-list>
            </v-col>
            <v-col cols="12" md="3">
              <div class="text-subtitle-2 font-weight-bold mb-2">Errores por modelo</div>
              <v-list
                v-if="telemetrySummary.errors_by_model.length"
                density="compact"
                class="bg-transparent pa-0"
              >
                <v-list-item
                  v-for="item in telemetrySummary.errors_by_model.slice(0, 5)"
                  :key="item.key"
                  class="px-0"
                >
                  <v-list-item-title class="text-wrap">{{ item.key }}</v-list-item-title>
                  <v-list-item-subtitle>{{ item.count }} errores</v-list-item-subtitle>
                </v-list-item>
              </v-list>
              <div v-else class="text-body-2 text-medium-emphasis">Sin errores registrados.</div>
            </v-col>
            <v-col cols="12" md="3">
              <div class="text-subtitle-2 font-weight-bold mb-2">Fallbacks a cloud</div>
              <v-list
                v-if="telemetrySummary.fallbacks_to_cloud.length"
                density="compact"
                class="bg-transparent pa-0"
              >
                <v-list-item
                  v-for="item in telemetrySummary.fallbacks_to_cloud.slice(0, 5)"
                  :key="item.key"
                  class="px-0"
                >
                  <v-list-item-title class="text-wrap">{{
                    fallbackLabel(item.key)
                  }}</v-list-item-title>
                  <v-list-item-subtitle>{{ item.count }} eventos</v-list-item-subtitle>
                </v-list-item>
              </v-list>
              <div v-else class="text-body-2 text-medium-emphasis">Sin fallbacks registrados.</div>
            </v-col>
          </v-row>

          <div class="text-subtitle-2 font-weight-bold mt-4 mb-2">Ultimos eventos</div>
          <v-table density="compact" class="ai-telemetry-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Funcionalidad</th>
                <th>Fuente</th>
                <th>Modelo</th>
                <th>Latencia</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in telemetrySummary.latest_events.slice(0, 8)" :key="event.id">
                <td>{{ formatTime(event.timestamp) }}</td>
                <td>{{ featureLabel(event.feature) }}</td>
                <td>{{ sourceLabel(event.resolution_source) }}</td>
                <td>{{ event.model || event.engine || '-' }}</td>
                <td>{{ formatMs(event.latency_ms) }}</td>
                <td>
                  <v-chip
                    size="x-small"
                    :color="event.success && !event.error ? 'success' : 'error'"
                    variant="tonal"
                  >
                    {{ event.success && !event.error ? 'OK' : 'Error' }}
                  </v-chip>
                </td>
              </tr>
            </tbody>
          </v-table>
        </template>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title class="d-flex flex-wrap align-center justify-space-between ga-3">
        <div>
          <div class="text-h6">Agente operativo</div>
          <div class="text-caption text-medium-emphasis">
            Consulta libre con filtros por dominio.
          </div>
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
          <v-btn variant="outlined" color="secondary" :disabled="loading" @click="clearResult">
            Limpiar
          </v-btn>
        </div>

        <v-alert v-if="error" type="error" variant="tonal" class="mt-4">
          {{ error }}
        </v-alert>

        <v-card v-if="result" class="mt-4" variant="outlined">
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
            <div class="text-body-1 mb-4" style="white-space: pre-wrap">{{ result.answer }}</div>

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

            <v-alert v-if="result.clarifyingQuestion" type="info" variant="tonal" class="mb-4">
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
import { computed, onMounted, ref } from 'vue';
import { useTenant } from '@/composables/useTenant';
import { useNotification } from '@/composables/useNotification';
import { askOpsRagAgent } from '@/services/opsRagAgent.service';
import {
  buildAITelemetrySummary,
  clearAITelemetryEvents,
  getAITelemetryEvents,
  isRemoteAITelemetryEnabled,
  getRemoteAICostSummary,
  getRemoteAITelemetryEvents,
} from '@/services/aiTelemetry.service';
import {
  AI_INSIGHT_QUICK_ACTIONS,
  OPS_DOMAIN_OPTIONS,
  normalizeOpsInsightResult,
} from '@/utils/aiInsightsCenter';
import {
  buildQuickActionExecution,
  toggleDomainSelection,
  validateOpsAgentRequest,
} from '@/utils/aiInsightsViewModel';

const { tenantId } = useTenant();
const { show } = useNotification();

const quickActions = AI_INSIGHT_QUICK_ACTIONS;
const domainOptions = OPS_DOMAIN_OPTIONS;
const suggestedQuestions = [
  'Que productos estan en mayor riesgo de quiebre hoy',
  'Resume ventas y ticket promedio de los ultimos dias',
  'Que compras deberiamos priorizar esta semana',
];

const queryText = ref('');
const selectedDomains = ref([]);
const loading = ref(false);
const error = ref('');
const result = ref(null);
const activeActionId = ref('');
const telemetryEvents = ref([]);
const telemetryRemoteError = ref('');
const serverCostSummary = ref(null);
const remoteTelemetryEnabled = isRemoteAITelemetryEnabled();
const telemetrySummary = computed(() => {
  const summary = buildAITelemetrySummary(telemetryEvents.value);
  const server = serverCostSummary.value;
  if (!server) return summary;
  return {
    ...summary,
    total_cost: Number(server.total_cost ?? summary.total_cost),
    cost_last_7_days: Number(server.cost_last_7_days ?? summary.cost_last_7_days),
    cost_last_30_days: Number(server.cost_last_30_days ?? summary.cost_last_30_days),
    cost_by_day: server.cost_by_day?.length ? server.cost_by_day : summary.cost_by_day,
  };
});

const featureLabels = {
  purchase_advisor: 'Asesor de compras',
  sales_forecast: 'Pronostico de ventas',
  ops_rag_agent: 'Agente operativo',
  product_photo_parser: 'Foto de producto',
  invoice_ocr_text: 'OCR factura texto',
  invoice_ocr_image: 'OCR factura imagen',
  command_engine_sale: 'Command Engine POS',
  command_engine_report: 'Command Engine reportes',
};

const sourceLabels = {
  local_cache: 'Cache local',
  deterministic_parser: 'Parser deterministico',
  local_llm: 'IA local',
  cloud_llm: 'IA cloud',
  manual_resolution: 'Manual',
  unknown: 'Sin clasificar',
};

const fallbackLabels = {
  diagnostic_cloud_first: 'Diagnostico cloud-first',
  native_unavailable: 'OCR nativo no disponible',
  native_empty_text: 'OCR nativo sin texto',
  native_too_short: 'OCR nativo muy corto',
  native_too_noisy: 'OCR nativo ruidoso',
  native_low_score: 'OCR nativo baja calidad',
  native_failed: 'OCR nativo fallido',
};

const formatPercent = (value) => `${Number(value || 0).toFixed(0)}%`;
const formatMs = (value) => `${Math.round(Number(value || 0))} ms`;
const formatMoney = (value) => `$${Number(value || 0).toFixed(4)}`;
const featureLabel = (value) => featureLabels[value] || value || 'Sin clasificar';
const sourceLabel = (value) => sourceLabels[value] || value || 'Sin clasificar';
const fallbackLabel = (value) => fallbackLabels[value] || value || 'Sin clasificar';
const formatTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-CO', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function mergeTelemetryEvents(localEvents, remoteEvents) {
  const events = [...(remoteEvents || []), ...(localEvents || [])];
  const seen = new Set();
  return events.filter((event) => {
    if (!event?.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

const loadServerCostSummary = async () => {
  if (!remoteTelemetryEnabled || !tenantId.value) {
    serverCostSummary.value = null;
    return;
  }
  const result = await getRemoteAICostSummary({ tenantId: tenantId.value, days: 30 });
  serverCostSummary.value = result.success ? result.data : null;
};

const refreshTelemetry = async () => {
  const localEvents = getAITelemetryEvents();
  telemetryRemoteError.value = '';

  if (!remoteTelemetryEnabled || !tenantId.value) {
    serverCostSummary.value = null;
    telemetryEvents.value = localEvents;
    return;
  }

  const remote = await getRemoteAITelemetryEvents({ tenantId: tenantId.value });
  if (!remote.success) {
    telemetryRemoteError.value = remote.error || 'No se pudo cargar telemetria remota.';
    telemetryEvents.value = localEvents;
    return;
  }

  telemetryEvents.value = mergeTelemetryEvents(localEvents, remote.data);
  void loadServerCostSummary();
};

const clearTelemetry = () => {
  clearAITelemetryEvents();
  void refreshTelemetry();
  show('Telemetria IA local limpiada', 'success');
};

const toggleDomain = (domainId) => {
  selectedDomains.value = toggleDomainSelection(selectedDomains.value, domainId);
};

const applySuggestedQuestion = (question) => {
  queryText.value = question;
};

const clearResult = () => {
  error.value = '';
  result.value = null;
  activeActionId.value = '';
};

const runQuery = async (payload = {}) => {
  const validation = validateOpsAgentRequest({
    tenantId: tenantId.value,
    query: payload.query || queryText.value,
  });
  if (!validation.valid) {
    error.value = validation.error;
    return;
  }
  const text = validation.data.query;

  loading.value = true;
  error.value = '';
  try {
    const response = await askOpsRagAgent({
      tenantId: tenantId.value,
      query: text,
      domains: Array.isArray(payload.domains) ? payload.domains : selectedDomains.value,
    });
    if (!response.success || !response?.data) {
      error.value = response.error || 'No se pudo consultar el agente operativo.';
      result.value = null;
      return;
    }

    queryText.value = text;
    result.value = normalizeOpsInsightResult(response.data);
    void refreshTelemetry();
  } finally {
    loading.value = false;
    activeActionId.value = '';
  }
};

const runQuickAction = async (action) => {
  const execution = buildQuickActionExecution(action);
  activeActionId.value = execution.activeActionId;
  selectedDomains.value = execution.domains;
  queryText.value = execution.query;
  await runQuery({
    query: execution.query,
    domains: execution.domains,
  });
  if (!error.value) {
    show(`${action.title} ejecutado`, 'success');
  }
};

onMounted(() => {
  void refreshTelemetry();
});
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

.ai-telemetry-metric {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: 112px;
}

.ai-telemetry-table {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}
</style>
