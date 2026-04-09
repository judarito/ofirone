<template>
  <div>
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="batches">
        <v-icon start>mdi-barcode</v-icon>
        Lotes
      </v-tab>
      <v-tab value="alerts">
        <v-icon start>mdi-alert-circle</v-icon>
        Alertas
        <v-badge v-if="criticalAlerts > 0" :content="criticalAlerts" color="error" class="ml-2"></v-badge>
      </v-tab>
      <v-tab value="reports">
        <v-icon start>mdi-chart-line</v-icon>
        Reportes
      </v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- LOTES -->
      <v-window-item value="batches">
        <v-card flat>
          <v-card-title class="d-flex align-center flex-wrap ga-2">
            <v-icon start color="blue">mdi-barcode</v-icon>
            Gestión de Lotes
            <v-spacer></v-spacer>
            <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
              Nuevo Lote (Ajuste Manual)
            </v-btn>
          </v-card-title>

          <!-- Nota informativa -->
          <v-alert type="info" variant="tonal" class="mx-4 mt-2" density="compact">
            <strong>💡 Sugerencia</strong>: Los lotes de productos nuevos se crean automáticamente al registrar compras.
            <router-link to="/purchases" class="ml-1">Ir a Compras</router-link>
            <div class="text-caption mt-1">
              Esta pantalla es para consultar lotes existentes y hacer ajustes manuales si es necesario.
            </div>
          </v-alert>

          <!-- Filtros -->
          <v-card-text>
            <ListView
              title="Gestion de Lotes"
              icon="mdi-barcode"
              :items="batches"
              :total-items="totalBatches"
              :loading="loading"
              :page-size="pageSize"
              item-key="batch_id"
              title-field="productLabel"
              subtitle-field="batch_number"
              avatar-icon="mdi-package-variant-closed"
              avatar-color="info"
              empty-message="No hay lotes registrados"
              create-button-text="Nuevo Lote"
              :editable="false"
              :deletable="false"
              :table-columns="batchTableColumns"
              view-storage-key="batch-management-lots"
              @create="openCreateDialog"
              @load-page="loadBatches"
              @search="loadBatches"
            >
              <template #filters>
                <v-row dense>
                  <v-col cols="12" sm="6">
                    <v-select
                      v-model="filterLocation"
                      :items="locations"
                      item-title="name"
                      item-value="location_id"
                      :label="t('app.branch')"
                      variant="outlined"
                      density="compact"
                      clearable
                      @update:model-value="refreshBatches"
                    ></v-select>
                  </v-col>
                  <v-col cols="12" sm="6">
                    <v-select
                      v-model="filterAlertLevel"
                      :items="alertLevels"
                      item-title="title"
                      item-value="value"
                      label="Estado"
                      variant="outlined"
                      density="compact"
                      clearable
                      @update:model-value="refreshBatches"
                    ></v-select>
                  </v-col>
                </v-row>
              </template>

              <template #title="{ item }">
                {{ item.variant?.product?.name || 'Sin producto' }}
              </template>

              <template #subtitle="{ item }">
                {{ [item.variant?.variant_name, item.variant?.sku ? `SKU: ${item.variant.sku}` : null, item.batch_number].filter(Boolean).join(' • ') }}
              </template>

              <template #content="{ item }">
                <div class="mt-2 d-flex flex-wrap ga-2">
                  <v-chip size="small" variant="tonal">{{ item.location?.name || 'Sin sede' }}</v-chip>
                  <v-chip v-if="item.physical_location" size="small" variant="outlined">
                    {{ item.physical_location }}
                  </v-chip>
                  <v-chip :color="getAlertColor(item)" size="small">
                    {{ getAlertLabel(item) }}
                  </v-chip>
                  <v-chip size="small" variant="tonal">
                    Stock: {{ item.on_hand }} / Disp.: {{ item.on_hand - item.reserved }}
                  </v-chip>
                </div>
              </template>

              <template #table-cell-batch_number="{ item }">
                {{ item.batch_number }}
              </template>

              <template #table-cell-location_name="{ item }">
                {{ item.location?.name || '—' }}
              </template>

              <template #table-cell-physical_location="{ item }">
                <v-chip v-if="item.physical_location" size="small" variant="outlined">
                  {{ item.physical_location }}
                </v-chip>
                <span v-else class="text-medium-emphasis">-</span>
              </template>

              <template #table-cell-expiration_date="{ item }">
                <div v-if="item.expiration_date">
                  {{ formatDate(item.expiration_date) }}
                  <div class="text-caption" :class="getDaysColor(item)">
                    {{ formatDaysToExpiry(item) }}
                  </div>
                </div>
                <span v-else class="text-medium-emphasis">Sin vencimiento</span>
              </template>

              <template #table-cell-stock="{ item }">
                <div class="text-right">
                  <strong>{{ item.on_hand }}</strong>
                  <span v-if="item.reserved > 0" class="text-grey text-caption ml-1">
                    ({{ item.reserved }} reserv.)
                  </span>
                </div>
                <div class="text-caption text-grey text-right">
                  {{ item.on_hand - item.reserved }} disponible
                </div>
              </template>

              <template #table-cell-alert_level="{ item }">
                <v-chip :color="getAlertColor(item)" size="small">
                  {{ getAlertLabel(item) }}
                </v-chip>
              </template>

              <template #actions="{ item }">
                <v-btn
                  icon="mdi-pencil"
                  variant="text"
                  size="small"
                  @click.stop="openEditDialog(item)"
                ></v-btn>
                <v-btn
                  icon="mdi-eye"
                  variant="text"
                  size="small"
                  @click.stop="viewTraceability(item)"
                ></v-btn>
              </template>
            </ListView>
          </v-card-text>
        </v-card>
      </v-window-item>

      <!-- ALERTAS -->
      <v-window-item value="alerts">
        <ExpirationAlerts :tenant-id="tenantId" ref="alertsComponent" />
      </v-window-item>

      <!-- REPORTES -->
      <v-window-item value="reports">
        <v-card flat>
          <v-card-title>
            <v-icon start color="teal">mdi-chart-line</v-icon>
            Reportes de Vencimiento
          </v-card-title>
          <v-card-text>
            <v-row>
              <!-- Dashboard por sede -->
              <v-col cols="12" md="6" lg="4" v-for="location in dashboardData" :key="location.location_id">
                <v-card variant="outlined">
                  <v-card-title class="text-subtitle-1">
                    {{ location.location_name }}
                  </v-card-title>
                  <v-card-text>
                    <div class="d-flex justify-space-between mb-2">
                      <span class="text-error">Vencidos:</span>
                      <strong>{{ location.expired_count || 0 }}</strong>
                    </div>
                    <div class="d-flex justify-space-between mb-2">
                      <span class="text-orange">Críticos:</span>
                      <strong>{{ location.critical_count || 0 }}</strong>
                    </div>
                    <div class="d-flex justify-space-between mb-2">
                      <span class="text-warning">Advertencia:</span>
                      <strong>{{ location.warning_count || 0 }}</strong>
                    </div>
                    <v-divider class="my-2"></v-divider>
                    <div class="d-flex justify-space-between">
                      <span class="font-weight-bold">Valor en Riesgo:</span>
                      <strong class="text-error">{{ formatMoney(location.total_value_at_risk) }}</strong>
                    </div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>

            <!-- Top productos en riesgo -->
            <v-row class="mt-4">
              <v-col cols="12">
                <v-card variant="outlined">
                  <v-card-title>Top 10 Productos en Riesgo</v-card-title>
                  <v-table density="compact">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Producto</th>
                        <th>Vence en</th>
                        <th class="text-right">Lotes</th>
                        <th class="text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in topAtRisk" :key="item.variant_id">
                        <td>{{ item.sku }}</td>
                        <td>{{ item.product_name }}</td>
                        <td :class="item.days_to_expiry < 7 ? 'text-error' : 'text-warning'">
                          {{ item.days_to_expiry }} día(s)
                        </td>
                        <td class="text-right">{{ item.batches_count }}</td>
                        <td class="text-right font-weight-bold">{{ formatMoney(item.total_value) }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </v-card>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-window-item>
    </v-window>

    <!-- Dialog Crear/Editar Lote -->
    <v-dialog v-model="dialog" max-width="700" scrollable>
      <v-card>
        <v-card-title>
          {{ isEditing ? 'Editar Lote' : 'Nuevo Lote' }}
        </v-card-title>
        <v-card-text>
          <v-form ref="form">
            <v-row>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="formData.location_id"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  label="Sede *"
                  variant="outlined"
                  :rules="[v => !!v || 'Requerido']"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="6">
                <v-autocomplete
                  v-model="formData.variant_id"
                  :items="variants"
                  :item-title="v => `${v.sku} - ${v.product?.name}`"
                  item-value="variant_id"
                  label="Producto/Variante *"
                  variant="outlined"
                  :rules="[v => !!v || 'Requerido']"
                  @update:model-value="checkRequiresExpiration"
                ></v-autocomplete>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.batch_number"
                  label="Número de Lote *"
                  variant="outlined"
                  :rules="[v => !!v || 'Requerido']"
                >
                  <template #append>
                    <v-btn
                      icon="mdi-refresh"
                      size="small"
                      variant="text"
                      @click="generateBatchNumber"
                    ></v-btn>
                  </template>
                </v-text-field>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.expiration_date"
                  label="Fecha de Vencimiento"
                  type="date"
                  variant="outlined"
                  :rules="requiresExpiration ? [v => !!v || 'Requerido'] : []"
                  :hint="requiresExpiration ? 'Requerido para este producto' : 'Opcional'"
                  persistent-hint
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.on_hand"
                  label="Cantidad *"
                  type="number"
                  variant="outlined"
                  :rules="[v => v > 0 || 'Debe ser mayor a 0']"
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.unit_cost"
                  label="Costo Unitario *"
                  type="number"
                  variant="outlined"
                  prefix="$"
                  :rules="[v => v >= 0 || 'Debe ser mayor o igual a 0']"
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model="formData.physical_location"
                  label="Ubicación Física"
                  variant="outlined"
                  placeholder="Ej: NEVERA-2"
                  hint="Opcional"
                  persistent-hint
                ></v-text-field>
              </v-col>
              <v-col cols="12">
                <v-textarea
                  v-model="formData.notes"
                  label="Notas"
                  variant="outlined"
                  rows="2"
                ></v-textarea>
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="saveBatch">{{ t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import ListView from '@/components/ListView.vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import batchesService from '@/services/batches.service'
import locationsService from '@/services/locations.service'
import productsService from '@/services/products.service'
import ExpirationAlerts from '@/components/ExpirationAlerts.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const tab = ref('batches')

// Current tenant
const { tenantId } = useTenant()

// State
const loading = ref(false)
const batches = ref([])
const locations = ref([])
const variants = ref([])
const dashboardData = ref([])
const topAtRisk = ref([])
const { defaultPageSize: pageSize } = useTenantSettings()
const totalBatches = ref(0)
const criticalAlerts = ref(0)

// Filtros
const filterLocation = ref(null)
const filterAlertLevel = ref(null)
const batchListState = ref({ page: 1, pageSize: pageSize.value || 10, search: '' })

const alertLevels = [
  { title: 'Vencidos', value: 'EXPIRED' },
  { title: 'Críticos', value: 'CRITICAL' },
  { title: 'Advertencia', value: 'WARNING' },
  { title: 'OK', value: 'OK' }
]

const batchTableColumns = [
  { title: 'Lote', key: 'batch_number', width: '150px' },
  { title: 'Sede', key: 'location_name', width: '150px' },
  { title: 'Ubicacion', key: 'physical_location', width: '140px' },
  { title: 'Vencimiento', key: 'expiration_date', width: '180px' },
  { title: 'Stock', key: 'stock', align: 'right', width: '150px' },
  { title: 'Estado', key: 'alert_level', width: '130px' }
]

// Dialog
const dialog = ref(false)
const isEditing = ref(false)
const form = ref(null)
const formData = ref({
  location_id: null,
  variant_id: null,
  batch_number: '',
  expiration_date: null,
  on_hand: 0,
  unit_cost: 0,
  physical_location: '',
  notes: ''
})
const requiresExpiration = ref(false)

// Methods
async function loadBatches(params = {}) {
  if (!tenantId.value) return
  const nextState = typeof params === 'number'
    ? { ...batchListState.value, page: params }
    : { ...batchListState.value, ...params }

  batchListState.value = {
    page: nextState.page || 1,
    pageSize: nextState.pageSize || pageSize.value || 10,
    search: nextState.search || ''
  }

  loading.value = true
  try {
    const result = await batchesService.getBatches(tenantId.value, batchListState.value.page, batchListState.value.pageSize, {
      location_id: filterLocation.value,
      batch_number: batchListState.value.search,
      alert_level: filterAlertLevel.value,
      hasStock: true
    })
    if (result.success) {
      batches.value = result.data.map((batch) => ({
        ...batch,
        productLabel: batch.variant?.product?.name || 'Sin producto'
      }))
      totalBatches.value = result.total
    }
  } finally {
    loading.value = false
  }
}

function refreshBatches() {
  loadBatches({ page: 1, search: batchListState.value.search })
}

async function loadLocations() {
  if (!tenantId.value) return
  const result = await locationsService.getLocations(tenantId.value)
  if (result.success) locations.value = result.data
}

async function loadVariants() {
  if (!tenantId.value) return
  const result = await productsService.getActiveVariants(tenantId.value)
  if (result.success) variants.value = result.data
}

async function loadDashboard() {
  if (!tenantId.value) return
  const result = await batchesService.getExpirationDashboard(tenantId.value)
  if (result.success) dashboardData.value = result.data
}

async function loadTopAtRisk() {
  if (!tenantId.value) return
  const result = await batchesService.getTopAtRiskProducts(tenantId.value, null, 10)
  if (result.success) topAtRisk.value = result.data
}

async function loadCriticalCount() {
  if (!tenantId.value) return
  const result = await batchesService.getExpiringProducts(tenantId.value, { alert_level: 'CRITICAL' })
  if (result.success) criticalAlerts.value = result.data.length
}

function openCreateDialog() {
  isEditing.value = false
  formData.value = {
    location_id: null,
    variant_id: null,
    batch_number: '',
    expiration_date: null,
    on_hand: 0,
    unit_cost: 0,
    physical_location: '',
    notes: ''
  }
  dialog.value = true
}

function openEditDialog(batch) {
  isEditing.value = true
  formData.value = { ...batch }
  dialog.value = true
}

async function checkRequiresExpiration() {
  if (!formData.value.variant_id) return
  const variant = variants.value.find(v => v.variant_id === formData.value.variant_id)
  requiresExpiration.value = variant?.product?.requires_expiration || false
}

async function generateBatchNumber() {
  if (!tenantId.value) return
  if (!formData.value.variant_id) {
    alert('Selecciona primero un producto/variante')
    return
  }
  const result = await batchesService.generateBatchNumber(tenantId.value, formData.value.variant_id)
  if (result.success) formData.value.batch_number = result.batchNumber
}

async function saveBatch() {
  if (!tenantId.value) return
  const validation = await form.value?.validate()
  if (!validation?.valid) return

  try {
    const result = isEditing.value
      ? await batchesService.updateBatch(formData.value.batch_id, formData.value)
      : await batchesService.createBatch(tenantId.value, formData.value)

    if (result.success) {
      dialog.value = false
      await loadBatches()
      await loadCriticalCount()
    } else {
      alert('Error: ' + result.error)
    }
  } catch (error) {
    console.error('Error saving batch:', error)
    alert('Error al guardar el lote')
  }
}

function viewTraceability(batch) {
  // TODO: Implementar vista de trazabilidad
  alert(`Trazabilidad del lote ${batch.batch_number}`)
}

function getAlertColor(batch) {
  const level = batchesService.getAlertLevel(batch.expiration_date)
  const colors = {
    EXPIRED: 'error',
    CRITICAL: 'error',
    WARNING: 'warning',
    OK: 'success'
  }
  return colors[level] || 'grey'
}

function getAlertLabel(batch) {
  const level = batchesService.getAlertLevel(batch.expiration_date)
  const labels = {
    EXPIRED: 'Vencido',
    CRITICAL: 'Crítico',
    WARNING: 'Advertencia',
    OK: 'OK'
  }
  return labels[level] || '-'
}

function getDaysColor(batch) {
  if (!batch.expiration_date) return ''
  const today = new Date()
  const expDate = new Date(batch.expiration_date)
  const days = Math.floor((expDate - today) / (1000 * 60 * 60 * 24))
  
  if (days < 0) return 'text-error font-weight-bold'
  if (days <= 7) return 'text-error font-weight-bold'
  if (days <= 30) return 'text-warning'
  return ''
}

function formatDaysToExpiry(batch) {
  if (!batch.expiration_date) return ''
  const today = new Date()
  const expDate = new Date(batch.expiration_date)
  const days = Math.floor((expDate - today) / (1000 * 60 * 60 * 24))
  return batchesService.formatDaysToExpiry(days)
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('es-CO')
}

function formatMoney(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0
  }).format(amount || 0)
}

// Lifecycle
onMounted(async () => {
  if (!tenantId.value) return
  
  await Promise.all([
    loadLocations(),
    loadVariants(),
    loadBatches(),
    loadCriticalCount()
  ])
  
  // Cargar datos de reportes cuando se muestre esa pestaña
  if (tab.value === 'reports') {
    await loadDashboard()
    await loadTopAtRisk()
  }
})
</script>
