<template>
  <div>
    <!-- Breadcrumb -->
    <v-breadcrumbs :items="breadcrumbs" class="pa-0 mb-4">
      <template #divider><v-icon>mdi-chevron-right</v-icon></template>
    </v-breadcrumbs>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon start color="purple">mdi-factory</v-icon>
        {{ t('reports.productionTitle') }}
      </v-card-title>
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-text-field v-model="fromDate" type="date" :label="t('reports.from')" variant="outlined" density="compact" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field v-model="toDate" type="date" :label="t('reports.to')" variant="outlined" density="compact" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="3">
            <v-select v-model="locationFilter" :items="locations" item-title="name" item-value="location_id" :label="t('app.branch')" variant="outlined" density="compact" hide-details clearable></v-select>
          </v-col>
          <v-col cols="12" sm="3">
            <v-btn color="purple" prepend-icon="mdi-magnify" @click="loadAll" :loading="loading">{{ t('reports.query') }}</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- KPIs producción -->
    <v-row class="mb-4" v-if="orders.length > 0">
      <v-col cols="6" sm="3">
        <v-card color="purple" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ completedOrders }}</div>
            <div class="text-caption">Órdenes Completadas</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card color="blue" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ totalProduced?.toFixed(0) }}</div>
            <div class="text-caption">Unidades Producidas</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card color="orange" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(totalProductionCost) }}</div>
            <div class="text-caption">Costo Total Producción</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card :color="avgYield >= 95 ? 'success' : avgYield >= 80 ? 'warning' : 'error'" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ avgYield?.toFixed(1) }}%</div>
            <div class="text-caption">Eficiencia Promedio</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-tabs v-model="tab" color="purple" class="mb-4">
      <v-tab value="orders">Órdenes de Producción</v-tab>
      <v-tab value="components">Componentes Más Usados</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- Órdenes de Producción -->
      <v-window-item value="orders">
        <v-card>
          <v-card-title class="d-flex align-center">
            Órdenes de Manufactura
            <v-spacer></v-spacer>
            <v-btn-toggle v-model="statusFilter" density="compact">
              <v-btn value="ALL" size="small">Todas</v-btn>
              <v-btn value="COMPLETED" size="small" color="success">Completadas</v-btn>
              <v-btn value="IN_PROGRESS" size="small" color="info">En Proceso</v-btn>
            </v-btn-toggle>
          </v-card-title>

          <!-- Desktop -->
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Orden</th><th>Producto</th><th>Estado</th>
                <th class="text-right">Cant.</th><th class="text-right">Yield %</th>
                <th class="text-right">Costo Teórico</th><th class="text-right">Costo Real</th>
                <th class="text-right">Variación</th><th class="text-right">Costo Unit.</th><th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in filteredOrders" :key="order.production_order_id">
                <td>
                  <div class="text-body-2 font-weight-bold">{{ order.order_number }}</div>
                  <div class="text-caption text-grey">{{ order.location_name }}</div>
                </td>
                <td>
                  <div class="text-body-2">{{ order.product_name }}</div>
                  <div class="text-caption text-grey">{{ order.sku }}</div>
                </td>
                <td>
                  <v-chip :color="order.status === 'COMPLETED' ? 'success' : order.status === 'IN_PROGRESS' ? 'info' : 'grey'" size="small" variant="flat">
                    {{ statusLabel(order.status) }}
                  </v-chip>
                </td>
                <td class="text-right">{{ order.quantity_produced }} / {{ order.quantity_planned }}</td>
                <td class="text-right">
                  <v-chip :color="order.yield_percentage >= 95 ? 'success' : order.yield_percentage >= 80 ? 'warning' : 'error'" size="small" variant="tonal">
                    {{ order.yield_percentage }}%
                  </v-chip>
                </td>
                <td class="text-right text-grey">{{ formatMoney(order.costo_teorico_total) }}</td>
                <td class="text-right font-weight-bold">{{ formatMoney(order.costo_real_total) }}</td>
                <td class="text-right" :class="order.variacion_costo >= 0 ? 'text-error' : 'text-success'">
                  {{ order.variacion_costo >= 0 ? '+' : '' }}{{ formatMoney(order.variacion_costo) }}
                </td>
                <td class="text-right">{{ formatMoney(order.costo_unitario_real) }}</td>
                <td>{{ formatDate(order.fecha_fin_real || order.fecha_creacion) }}</td>
              </tr>
              <tr v-if="filteredOrders.length === 0">
                <td colspan="10" class="text-center text-grey pa-6">
                  <v-icon size="large">mdi-factory</v-icon>
                  <div class="mt-2">No hay órdenes en el período seleccionado</div>
                </td>
              </tr>
            </tbody>
          </v-table>

          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="order in filteredOrders" :key="order.production_order_id" :color="order.status === 'COMPLETED' ? 'success' : 'info'" variant="tonal" class="mb-3">
              <v-card-text>
                <div class="d-flex align-center justify-space-between mb-2">
                  <div class="text-body-2 font-weight-bold">{{ order.order_number }}</div>
                  <v-chip :color="order.status === 'COMPLETED' ? 'success' : 'info'" size="small" variant="flat">{{ statusLabel(order.status) }}</v-chip>
                </div>
                <div class="text-body-2 mb-1">{{ order.product_name }}</div>
                <div class="text-caption text-grey mb-2">SKU: {{ order.sku }} • {{ order.location_name }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Cantidad:</span><span>{{ order.quantity_produced }} / {{ order.quantity_planned }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Yield:</span><v-chip :color="order.yield_percentage >= 95 ? 'success' : order.yield_percentage >= 80 ? 'warning' : 'error'" size="x-small">{{ order.yield_percentage }}%</v-chip></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Costo Real:</span><span class="font-weight-bold">{{ formatMoney(order.costo_real_total) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Variación:</span><span :class="order.variacion_costo >= 0 ? 'text-error' : 'text-success'">{{ order.variacion_costo >= 0 ? '+' : '' }}{{ formatMoney(order.variacion_costo) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Costo Unitario:</span><span class="font-weight-bold">{{ formatMoney(order.costo_unitario_real) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="filteredOrders.length === 0" class="text-center pa-4 text-grey">No hay órdenes</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Componentes Más Usados -->
      <v-window-item value="components">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon start color="purple">mdi-cog-transfer</v-icon>
            Componentes Más Utilizados en Producción
            <v-spacer></v-spacer>
            <v-btn size="small" variant="tonal" color="purple" prepend-icon="mdi-refresh" @click="loadComponents" :loading="loadingComponents">Recargar</v-btn>
          </v-card-title>
          <v-card-subtitle class="pb-2">Insumos y materias primas consumidas en órdenes de manufactura ON_DEMAND en el período.</v-card-subtitle>

          <!-- Desktop -->
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>#</th><th>Componente</th><th>SKU</th>
                <th class="text-right">Usos</th>
                <th class="text-right">Cantidad Total</th>
                <th class="text-right">Costo Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(comp, i) in topComponents" :key="comp.variant_id">
                <td>{{ i + 1 }}</td>
                <td>
                  <div class="text-body-2">{{ comp.product_name }}</div>
                  <div class="text-caption text-grey">{{ comp.variant_name }}</div>
                </td>
                <td>{{ comp.sku }}</td>
                <td class="text-right">{{ comp.uses }}</td>
                <td class="text-right font-weight-bold">{{ comp.total_qty }}</td>
                <td class="text-right">{{ formatMoney(comp.total_cost) }}</td>
              </tr>
              <tr v-if="topComponents.length === 0">
                <td colspan="6" class="text-center text-grey pa-6">
                  <v-icon size="large">mdi-cog</v-icon>
                  <div class="mt-2">Sin datos de componentes en el período</div>
                </td>
              </tr>
            </tbody>
          </v-table>

          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="(comp, i) in topComponents" :key="comp.variant_id" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center mb-2">
                  <v-chip size="x-small" color="purple" class="mr-2">{{ i + 1 }}</v-chip>
                  <div class="flex-grow-1">
                    <div class="text-body-2 font-weight-bold">{{ comp.product_name }}</div>
                    <div class="text-caption text-grey">SKU: {{ comp.sku }}</div>
                  </div>
                </div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Usos:</span><span>{{ comp.uses }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Cantidad Total:</span><span class="font-weight-bold">{{ comp.total_qty }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Costo Total:</span><span>{{ formatMoney(comp.total_cost) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="topComponents.length === 0" class="text-center pa-4 text-grey">Sin componentes</div>
          </div>
        </v-card>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from '@/i18n'
import { useTenant } from '@/composables/useTenant'
import reportsService from '@/services/reports.service'
import { formatMoney, formatDate } from '@/utils/formatters'

const { tenantId } = useTenant()
const { t } = useI18n()

const breadcrumbs = [
  { title: 'Reportes', to: '/reports', disabled: false },
  { title: 'Producción', disabled: true }
]

const loading = ref(false)
const tab = ref('orders')
const locations = ref([])
const locationFilter = ref(null)
const statusFilter = ref('ALL')

const now = new Date()
const fromDate = ref(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10))
const toDate = ref(now.toISOString().substring(0, 10))

const orders = ref([])
const topComponents = ref([])
const loadingComponents = ref(false)

const filteredOrders = computed(() => {
  if (statusFilter.value === 'ALL') return orders.value
  return orders.value.filter(o => o.status === statusFilter.value)
})

const completedOrders = computed(() => orders.value.filter(o => o.status === 'COMPLETED').length)
const totalProduced = computed(() => orders.value.reduce((s, o) => s + (parseFloat(o.quantity_produced) || 0), 0))
const totalProductionCost = computed(() => orders.value.reduce((s, o) => s + (parseFloat(o.costo_real_total) || 0), 0))
const avgYield = computed(() => {
  const completed = orders.value.filter(o => o.status === 'COMPLETED')
  if (!completed.length) return 0
  return completed.reduce((s, o) => s + (parseFloat(o.yield_percentage) || 0), 0) / completed.length
})

const statusLabel = (s) => ({ COMPLETED: 'Completada', IN_PROGRESS: 'En Proceso', PLANNED: 'Planeada', CANCELLED: 'Cancelada' }[s] || s)

const loadOrders = async () => {
  if (!tenantId.value) return
  const fd = fromDate.value + 'T00:00:00'
  const td = toDate.value + 'T23:59:59'
  const r = await reportsService.getProductionCostReport(tenantId.value, fd, td, locationFilter.value)
  if (r.success) orders.value = r.data
}

const loadComponents = async () => {
  if (!tenantId.value) return
  loadingComponents.value = true
  try {
    const fd = fromDate.value + 'T00:00:00'
    const td = toDate.value + 'T23:59:59'
    const r = await reportsService.getTopBomComponents(tenantId.value, fd, td, locationFilter.value)
    if (r.success) topComponents.value = r.data
  } finally {
    loadingComponents.value = false
  }
}

const loadAll = async () => {
  loading.value = true
  try {
    await Promise.all([loadOrders(), loadComponents()])
  } finally {
    loading.value = false
  }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const { default: locService } = await import('@/services/locations.service')
  const r = await locService.getLocations(tenantId.value, 1, 100)
  if (r.success) locations.value = r.data
}

onMounted(async () => {
  await loadLocations()
  loadAll()
})
</script>
