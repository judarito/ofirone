<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon start color="amber">mdi-alert-circle-outline</v-icon>
      Alertas de Vencimiento
      <v-spacer></v-spacer>
      <v-chip v-if="criticalCount > 0" color="error" size="small" class="mr-2">
        {{ criticalCount }} crítico(s)
      </v-chip>
      <v-chip v-if="warningCount > 0" color="warning" size="small">
        {{ warningCount }} aviso(s)
      </v-chip>
    </v-card-title>

    <v-card-text v-if="loading" class="text-center">
      <v-progress-circular indeterminate color="primary"></v-progress-circular>
    </v-card-text>

    <v-card-text v-else>
      <!-- Filtros -->
      <v-row dense class="mb-3">
        <v-col cols="12" sm="6">
          <v-select
            v-model="filterLevel"
            :items="alertLevels"
            label="Nivel de alerta"
            variant="outlined"
            density="compact"
            clearable
            @update:model-value="loadAlerts"
          ></v-select>
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="filterLocation"
            :items="locations"
            item-title="name"
            item-value="location_id"
            label="Sede"
            variant="outlined"
            density="compact"
            clearable
            @update:model-value="loadAlerts"
          ></v-select>
        </v-col>
      </v-row>

      <!-- Lista de Alertas -->
      <v-list v-if="alerts.length > 0">
        <template v-for="(alert, index) in alerts" :key="alert.batch_id">
          <v-divider v-if="index > 0"></v-divider>
          <v-list-item>
            <template #prepend>
              <v-avatar :color="getAlertColor(alert.alert_level)">
                <v-icon :icon="getAlertIcon(alert.alert_level)"></v-icon>
              </v-avatar>
            </template>

            <v-list-item-title>
              {{ alert.product_name }}
              <v-chip v-if="alert.variant_name" size="x-small" class="ml-1">
                {{ alert.variant_name }}
              </v-chip>
            </v-list-item-title>
            
            <v-list-item-subtitle>
              <div class="d-flex flex-wrap ga-2 mt-1">
                <span><strong>Lote:</strong> {{ alert.batch_number }}</span>
                <span>•</span>
                <span><strong>Vence:</strong> {{ formatDate(alert.expiration_date) }}</span>
                <span>•</span>
                <span :class="getDaysColor(alert.days_to_expiry)">
                  <strong>{{ formatDaysToExpiry(alert.days_to_expiry) }}</strong>
                </span>
              </div>
              <div class="mt-1">
                <span class="text-grey">{{ alert.location_name }}</span>
                <span v-if="alert.physical_location" class="ml-2">
                  <v-icon size="x-small">mdi-map-marker</v-icon>
                  {{ alert.physical_location }}
                </span>
                <span class="ml-2">
                  <v-icon size="x-small">mdi-cube</v-icon>
                  {{ alert.available }} unidades
                </span>
                <span class="ml-2 text-grey">
                  Valor: {{ formatMoney(alert.value_at_cost) }}
                </span>
              </div>
            </v-list-item-subtitle>

            <template #append>
              <v-btn
                icon="mdi-information"
                variant="text"
                size="small"
                @click="showDetails(alert)"
              ></v-btn>
            </template>
          </v-list-item>
        </template>
      </v-list>

      <v-alert v-else type="info" variant="tonal" class="mt-2">
        No hay productos próximos a vencer
      </v-alert>
    </v-card-text>

    <!-- Dialog de detalles -->
    <v-dialog v-model="detailsDialog" max-width="500">
      <v-card v-if="selectedAlert">
        <v-card-title>
          <v-icon :color="getAlertColor(selectedAlert.alert_level)" start>
            {{ getAlertIcon(selectedAlert.alert_level) }}
          </v-icon>
          Detalle de Alerta
        </v-card-title>
        <v-card-text>
          <v-list density="compact">
            <v-list-item>
              <v-list-item-title>Producto</v-list-item-title>
              <v-list-item-subtitle>{{ selectedAlert.product_name }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item v-if="selectedAlert.variant_name">
              <v-list-item-title>Variante</v-list-item-title>
              <v-list-item-subtitle>{{ selectedAlert.variant_name }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title>SKU</v-list-item-title>
              <v-list-item-subtitle>{{ selectedAlert.sku }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title>Número de Lote</v-list-item-title>
              <v-list-item-subtitle>{{ selectedAlert.batch_number }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title>Fecha de Vencimiento</v-list-item-title>
              <v-list-item-subtitle>{{ formatDate(selectedAlert.expiration_date) }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title>Días para Vencer</v-list-item-title>
              <v-list-item-subtitle :class="getDaysColor(selectedAlert.days_to_expiry)">
                {{ formatDaysToExpiry(selectedAlert.days_to_expiry) }}
              </v-list-item-subtitle>
            </v-list-item>
            <v-divider class="my-2"></v-divider>
            <v-list-item>
              <v-list-item-title>Sede</v-list-item-title>
              <v-list-item-subtitle>{{ selectedAlert.location_name }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item v-if="selectedAlert.physical_location">
              <v-list-item-title>Ubicación Física</v-list-item-title>
              <v-list-item-subtitle>{{ selectedAlert.physical_location }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title>Stock Disponible</v-list-item-title>
              <v-list-item-subtitle>{{ selectedAlert.available }} unidades</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title>Valor en Inventario</v-list-item-title>
              <v-list-item-subtitle>{{ formatMoney(selectedAlert.value_at_cost) }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="detailsDialog = false">Cerrar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup>
import {ref, computed, onMounted } from 'vue'
import batchesService from '@/services/batches.service'
import locationsService from '@/services/locations.service'

// Props
const props = defineProps({
  tenantId: {
    type: String,
    required: true
  },
  autoRefresh: {
    type: Boolean,
    default: false
  },
  refreshInterval: {
    type: Number,
    default: 60000 // 1 minuto
  }
})

// State
const loading = ref(false)
const alerts = ref([])
const locations = ref([])
const filterLevel = ref(null)
const filterLocation = ref(null)
const detailsDialog = ref(false)
const selectedAlert = ref(null)

const alertLevels = [
  { title: 'Vencidos', value: 'EXPIRED' },
  { title: 'Críticos (< 7 días)', value: 'CRITICAL' },
  { title: 'Advertencia (< 30 días)', value: 'WARNING' }
]

// Computed
const criticalCount = computed(() => 
  alerts.value.filter(a => a.alert_level === 'EXPIRED' || a.alert_level === 'CRITICAL').length
)

const warningCount = computed(() => 
  alerts.value.filter(a => a.alert_level === 'WARNING').length
)

// Methods
async function loadAlerts() {
  loading.value = true
  try {
    const result = await batchesService.getExpiringProducts(props.tenantId, {
      location_id: filterLocation.value,
      alert_level: filterLevel.value
    })
    if (result.success) {
      alerts.value = result.data
    }
  } catch (error) {
    console.error('Error loading alerts:', error)
  } finally {
    loading.value = false
  }
}

async function loadLocations() {
  const result = await locationsService.getLocations(props.tenantId)
  if (result.success) {
    locations.value = result.data
  }
}

function showDetails(alert) {
  selectedAlert.value = alert
  detailsDialog.value = true
}

function getAlertColor(level) {
  const colors = {
    EXPIRED: 'error',
    CRITICAL: 'error',
    WARNING: 'warning',
    OK: 'success'
  }
  return colors[level] || 'grey'
}

function getAlertIcon(level) {
  const icons = {
    EXPIRED: 'mdi-alert-octagon',
    CRITICAL: 'mdi-alert',
    WARNING: 'mdi-alert-outline',
    OK: 'mdi-check-circle'
  }
  return icons[level] || 'mdi-information'
}

function getDaysColor(days) {
  if (days < 0) return 'text-error font-weight-bold'
  if (days <= 7) return 'text-error font-weight-bold'
  if (days <= 30) return 'text-warning font-weight-bold'
  return ''
}

function formatDaysToExpiry(days) {
  if (days < 0) return `Vencido hace ${Math.abs(days)} día(s)`
  if (days === 0) return 'Vence HOY'
  if (days === 1) return 'Vence MAÑANA'
  return `${days} día(s)`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatMoney(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount || 0)
}

// Lifecycle
onMounted(async () => {
  await loadLocations()
  await loadAlerts()

  // Auto-refresh
  if (props.autoRefresh) {
    setInterval(loadAlerts, props.refreshInterval)
  }
})

// Expose for parent
defineExpose({
  refresh: loadAlerts
})
</script>
