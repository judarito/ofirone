<template>
  <v-card elevation="2" :loading="loading">
    <v-card-title class="d-flex align-center">
      <v-icon color="deep-purple" size="large" class="mr-2">
        mdi-chart-timeline-variant
      </v-icon>
      Pronóstico de Ventas (IA)
      <v-spacer></v-spacer>
      <v-chip v-if="forecast && forecast.from_cache" color="blue" size="small" variant="flat" class="mr-2">
        <v-icon start size="small">mdi-cached</v-icon>
        Caché
      </v-chip>
      <v-chip v-if="forecast && !forecast.is_fallback" color="success" size="small" variant="flat" class="mr-2">
        <v-icon start size="small">mdi-robot</v-icon>
        AI
      </v-chip>
      <v-tooltip text="Forzar actualización (consultar API nuevamente)">
        <template v-slot:activator="{ props }">
          <v-btn 
            v-bind="props" 
            icon="mdi-refresh" 
            size="small" 
            variant="text"
            @click="refreshForecast"
            :loading="loading"
          ></v-btn>
        </template>
      </v-tooltip>
    </v-card-title>

    <v-card-text v-if="error">
      <v-alert type="warning" variant="tonal">
        {{ error }}
      </v-alert>
    </v-card-text>

    <v-card-text v-else-if="!forecast">
      <v-skeleton-loader type="article"></v-skeleton-loader>
    </v-card-text>

    <v-card-text v-else>
      <!-- Pronósticos principales -->
      <v-row dense>
        <!-- HOY -->
        <v-col cols="12" md="4">
          <v-card variant="tonal" color="success">
            <v-card-text>
              <div class="text-overline">HOY</div>
              <div class="text-h5 font-weight-bold">
                ${{ formatNumber(forecast.daily_forecast?.predicted_sales || 0) }}
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ forecast.daily_forecast?.day_name || '' }}
              </div>
              <v-progress-linear
                :model-value="(forecast.daily_forecast?.confidence || 0) * 100"
                :color="getConfidenceColor(forecast.daily_forecast?.confidence || 0)"
                height="6"
                rounded
                class="mt-2"
              ></v-progress-linear>
              <div class="text-caption text-right mt-1">
                Confianza: {{ ((forecast.daily_forecast?.confidence || 0) * 100).toFixed(0) }}%
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- SEMANA -->
        <v-col cols="12" md="4">
          <v-card variant="tonal" color="info">
            <v-card-text>
              <div class="text-overline">ESTA SEMANA</div>
              <div class="text-h5 font-weight-bold">
                ${{ formatNumber(forecast.weekly_forecast?.predicted_total || 0) }}
              </div>
              <div class="text-caption text-medium-emphasis">
                Próximos 7 días
              </div>
              <v-progress-linear
                :model-value="(forecast.weekly_forecast?.confidence || 0) * 100"
                :color="getConfidenceColor(forecast.weekly_forecast?.confidence || 0)"
                height="6"
                rounded
                class="mt-2"
              ></v-progress-linear>
              <div class="text-caption text-right mt-1">
                Confianza: {{ ((forecast.weekly_forecast?.confidence || 0) * 100).toFixed(0) }}%
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- MES -->
        <v-col cols="12" md="4">
          <v-card variant="tonal" color="deep-purple">
            <v-card-text>
              <div class="text-overline">ESTE MES</div>
              <div class="text-h5 font-weight-bold">
                ${{ formatNumber(forecast.monthly_forecast?.predicted_total || 0) }}
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ forecast.monthly_forecast?.days_remaining || 0 }} días restantes
              </div>
              <v-progress-linear
                :model-value="(forecast.monthly_forecast?.confidence || 0) * 100"
                :color="getConfidenceColor(forecast.monthly_forecast?.confidence || 0)"
                height="6"
                rounded
                class="mt-2"
              ></v-progress-linear>
              <div class="text-caption text-right mt-1">
                Confianza: {{ ((forecast.monthly_forecast?.confidence || 0) * 100).toFixed(0) }}%
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Razonamiento de la IA -->
      <v-expansion-panels v-if="forecast.daily_forecast?.reasoning" class="mt-4">
        <v-expansion-panel>
          <v-expansion-panel-title>
            <div class="d-flex align-center">
              <v-icon color="deep-purple" class="mr-2">mdi-brain</v-icon>
              <strong>Análisis de IA</strong>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <div class="text-body-2">{{ forecast.daily_forecast.reasoning }}</div>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <!-- Insights clave -->
        <v-expansion-panel v-if="forecast.key_insights && forecast.key_insights.length > 0">
          <v-expansion-panel-title>
            <div class="d-flex align-center">
              <v-icon color="info" class="mr-2">mdi-lightbulb-on</v-icon>
              <strong>Insights Clave ({{ forecast.key_insights.length }})</strong>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-list density="compact">
              <v-list-item
                v-for="(insight, idx) in forecast.key_insights"
                :key="idx"
                :prepend-icon="getInsightIcon(insight.type)"
                :class="'border-l-md border-' + getImpactColor(insight.impact)"
              >
                <v-list-item-title class="font-weight-bold">{{ insight.title }}</v-list-item-title>
                <v-list-item-subtitle>{{ insight.description }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <!-- Recomendaciones -->
        <v-expansion-panel v-if="forecast.recommendations && forecast.recommendations.length > 0">
          <v-expansion-panel-title>
            <div class="d-flex align-center">
              <v-icon color="success" class="mr-2">mdi-list-status</v-icon>
              <strong>Recomendaciones ({{ forecast.recommendations.length }})</strong>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-list density="compact">
              <v-list-item
                v-for="(rec, idx) in forecast.recommendations"
                :key="idx"
                :prepend-icon="getRecommendationIcon(rec.category)"
              >
                <template #append>
                  <v-chip
                    :color="getPriorityColor(rec.priority)"
                    size="x-small"
                    variant="flat"
                  >
                    {{ rec.priority }}
                  </v-chip>
                </template>
                <v-list-item-title class="font-weight-bold">{{ rec.title }}</v-list-item-title>
                <v-list-item-subtitle>{{ rec.description }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <!-- Desglose semanal (mini gráfico) -->
      <v-card
        v-if="forecast.weekly_forecast?.daily_breakdown && forecast.weekly_forecast.daily_breakdown.length > 0"
        variant="outlined"
        class="mt-4"
      >
        <v-card-subtitle>Desglose Semanal</v-card-subtitle>
        <v-card-text>
          <div class="d-flex justify-space-between align-end" style="height: 80px;">
            <div
              v-for="(day, idx) in forecast.weekly_forecast.daily_breakdown"
              :key="idx"
              class="text-center"
              style="flex: 1;"
            >
              <div
                :style="{
                  height: getBarHeight(day.predicted_sales, forecast.weekly_forecast.daily_breakdown) + 'px',
                  backgroundColor: 'rgb(103, 58, 183, 0.7)',
                  borderRadius: '4px 4px 0 0',
                  marginBottom: '4px'
                }"
              ></div>
              <div class="text-caption">{{ getDayAbbr(day.day) }}</div>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Metadatos -->
      <div class="text-caption text-medium-emphasis mt-4">
        <v-icon size="small">mdi-clock-outline</v-icon>
        Generado: {{ formatDate(forecast.generated_at) }} 
        <span v-if="forecast.data_points" class="ml-2">
          | <v-icon size="small">mdi-database</v-icon> {{ forecast.data_points }} días analizados
        </span>
        <span v-if="forecast.historical_avg" class="ml-2">
          | Promedio histórico: ${{ formatNumber(forecast.historical_avg) }}/día
        </span>
      </div>
    </v-card-text>

    <v-card-actions>
      <v-btn
        variant="text"
        color="deep-purple"
        @click="refreshForecast"
        :loading="loading"
        :disabled="loading"
      >
        <v-icon start>mdi-refresh</v-icon>
        Actualizar
      </v-btn>
      <v-spacer></v-spacer>
      <v-tooltip text="Pronóstico generado con IA analizando patrones históricos">
        <template #activator="{ props }">
          <v-icon v-bind="props" color="grey">mdi-information-outline</v-icon>
        </template>
      </v-tooltip>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import salesService from '@/services/sales.service'

const { tenantId } = useTenant()
const { aiForecastDaysBack, loadSettings } = useTenantSettings()

const forecast = ref(null)
const loading = ref(false)
const error = ref(null)

onMounted(async () => {
  await loadSettings()
  loadForecast()
})

const loadForecast = async (forceRefresh = false) => {
  if (!tenantId.value) {
    error.value = 'No se pudo determinar el tenant'
    return
  }

  loading.value = true
  error.value = null

  try {
    const result = await salesService.generateSalesForecast(
      tenantId.value,
      null, // null = todas las sedes del tenant
      { 
        daysBack: aiForecastDaysBack.value,
        forceRefresh
      }
    )

    if (!result.success) {
      throw new Error(result.error)
    }

    forecast.value = result.data
  } catch (err) {
    console.error('Error cargando pronóstico:', err)
    error.value = err.message || 'Error al cargar el pronóstico'
  } finally {
    loading.value = false
  }
}

const refreshForecast = () => {
  loadForecast(true)
}

const formatNumber = (value) => {
  return Math.round(value).toLocaleString()
}

const formatDate = (isoDate) => {
  if (!isoDate) return 'N/A'
  return new Date(isoDate).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getConfidenceColor = (confidence) => {
  if (confidence >= 0.8) return 'success'
  if (confidence >= 0.6) return 'info'
  if (confidence >= 0.4) return 'warning'
  return 'error'
}

const getInsightIcon = (type) => {
  const icons = {
    trend: 'mdi-chart-line',
    pattern: 'mdi-sine-wave',
    anomaly: 'mdi-alert-circle',
    info: 'mdi-information'
  }
  return icons[type] || 'mdi-circle-small'
}

const getImpactColor = (impact) => {
  const colors = {
    high: 'error',
    medium: 'warning',
    low: 'info'
  }
  return colors[impact] || 'grey'
}

const getRecommendationIcon = (category) => {
  const icons = {
    staffing: 'mdi-account-group',
    inventory: 'mdi-package-variant',
    marketing: 'mdi-bullhorn',
    operations: 'mdi-cog'
  }
  return icons[category] || 'mdi-check-circle'
}

const getPriorityColor = (priority) => {
  const colors = {
    high: 'error',
    medium: 'warning',
    low: 'info'
  }
  return colors[priority] || 'grey'
}

const getDayAbbr = (dayName) => {
  if (!dayName) return ''
  const abbrs = {
    'Domingo': 'Dom',
    'Lunes': 'Lun',
    'Martes': 'Mar',
    'Miércoles': 'Mié',
    'Jueves': 'Jue',
    'Viernes': 'Vie',
    'Sábado': 'Sáb'
  }
  return abbrs[dayName] || dayName.substring(0, 3)
}

const getBarHeight = (value, allDays) => {
  if (!allDays || allDays.length === 0) return 0
  const max = Math.max(...allDays.map(d => d.predicted_sales || 0))
  if (max === 0) return 0
  return Math.max(10, (value / max) * 60) // Min 10px, max 60px
}
</script>

<style scoped>
.border-l-md {
  border-left: 4px solid;
}
</style>
