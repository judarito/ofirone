<template>
  <div>
    <!-- Breadcrumb -->
    <v-breadcrumbs :items="breadcrumbs" class="pa-0 mb-4">
      <template #divider><v-icon>mdi-chevron-right</v-icon></template>
    </v-breadcrumbs>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon start color="green">mdi-package-variant-closed</v-icon>
        {{ t('reports.inventoryTitle') }}
      </v-card-title>
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="4">
            <v-select v-model="locationFilter" :items="locations" item-title="name" item-value="location_id" :label="t('app.branch')" variant="outlined" density="compact" hide-details clearable></v-select>
          </v-col>
          <v-col cols="12" sm="4">
            <v-btn color="primary" prepend-icon="mdi-refresh" @click="loadAll" :loading="loading">{{ t('reports.query') }}</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- KPIs de inventario -->
    <v-row class="mb-4" v-if="inventoryValue">
      <v-col cols="6" sm="3">
        <v-card color="green" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(inventoryValue.summary?.total_value) }}</div>
            <div class="text-caption">Valor Total Inventario</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card color="blue" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ inventoryValue.summary?.total_units?.toFixed(0) }}</div>
            <div class="text-caption">Unidades Totales</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card color="orange" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ noMovementProducts.length }}</div>
            <div class="text-caption">Sin Movimiento (30d)</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="3">
        <v-card color="red" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ expiringProducts.length }}</div>
            <div class="text-caption">Próximos a Vencer</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-tabs v-model="tab" color="green" class="mb-4">
      <v-tab value="value">Valor del Inventario</v-tab>
      <v-tab value="by-location">Por Ubicación</v-tab>
      <v-tab value="low-stock">
        <v-badge v-if="stockAlertsCount > 0" :content="stockAlertsCount" color="error">
          Stock Bajo
        </v-badge>
        <span v-else>Stock Bajo</span>
      </v-tab>
      <v-tab value="no-movement">
        <v-badge v-if="noMovementProducts.length > 0" :content="noMovementProducts.length" color="warning">
          Sin Movimiento
        </v-badge>
        <span v-else>Sin Movimiento</span>
      </v-tab>
      <v-tab value="expiring">
        <v-badge v-if="expiringProducts.length > 0" :content="expiringProducts.length" color="error">
          Próximos a Vencer
        </v-badge>
        <span v-else>Próximos a Vencer</span>
      </v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- Valor del Inventario -->
      <v-window-item value="value">
        <!-- Por categoría -->
        <v-card class="mb-4" v-if="inventoryValue?.by_category?.length">
          <v-card-title>
            <v-icon start>mdi-tag-multiple</v-icon>
            Valor por Categoría
          </v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Categoría</th>
                <th class="text-right">Unidades</th>
                <th class="text-right">Valor</th>
                <th class="text-right">% del Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cat in inventoryValue.by_category" :key="cat.category">
                <td><v-chip size="small" color="green" variant="tonal">{{ cat.category }}</v-chip></td>
                <td class="text-right">{{ cat.units.toFixed(0) }}</td>
                <td class="text-right font-weight-bold">{{ formatMoney(cat.value) }}</td>
                <td class="text-right">
                  <v-progress-linear
                    :model-value="(inventoryValue?.summary?.total_value || 0) > 0 ? (cat.value / (inventoryValue?.summary?.total_value || 1) * 100) : 0"
                    color="green"
                    height="16"
                    rounded
                  >
                    <template #default="{ value }">
                      <span class="text-caption text-white font-weight-bold">{{ value.toFixed(1) }}%</span>
                    </template>
                  </v-progress-linear>
                </td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="cat in inventoryValue.by_category" :key="cat.category" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="d-flex justify-space-between align-center mb-2">
                  <v-chip size="small" color="green" variant="tonal">{{ cat.category }}</v-chip>
                  <span class="font-weight-bold">{{ formatMoney(cat.value) }}</span>
                </div>
                <v-progress-linear
                  :model-value="(inventoryValue?.summary?.total_value || 0) > 0 ? (cat.value / (inventoryValue?.summary?.total_value || 1) * 100) : 0"
                  color="green" height="12" rounded class="mb-2"
                ></v-progress-linear>
                <div class="text-caption text-grey">{{ cat.units.toFixed(0) }} unidades</div>
              </v-card-text>
            </v-card>
          </div>
        </v-card>

        <!-- Detalle de productos -->
        <v-card>
          <v-card-title>Detalle por Producto (Top 100 por valor)</v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Producto</th><th>SKU</th><th>Categoría</th><th>Sede</th>
                <th class="text-right">Stock</th><th class="text-right">Disponible</th>
                <th class="text-right">Costo Unit.</th><th class="text-right">Valor Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in inventoryValue?.data?.slice(0, 100)" :key="`${item.sku}-${item.location}`">
                <td>
                  <div class="text-body-2">{{ item.product_name }}</div>
                  <div class="text-caption text-grey">{{ item.variant_name }}</div>
                </td>
                <td>{{ item.sku }}</td>
                <td>{{ item.category }}</td>
                <td>{{ item.location }}</td>
                <td class="text-right">{{ item.on_hand }}</td>
                <td class="text-right"><v-chip :color="item.available <= 0 ? 'error' : 'success'" size="small" variant="tonal">{{ item.available }}</v-chip></td>
                <td class="text-right text-grey">{{ formatMoney(item.unit_cost) }}</td>
                <td class="text-right font-weight-bold">{{ formatMoney(item.total_value) }}</td>
              </tr>
              <tr v-if="!inventoryValue?.data?.length">
                <td colspan="8" class="text-center text-grey pa-4">Sin datos</td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="item in inventoryValue?.data?.slice(0, 50)" :key="`${item.sku}-${item.location}`" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="text-body-2 font-weight-bold mb-1">{{ item.product_name }}</div>
                <div class="text-caption text-grey mb-2">SKU: {{ item.sku }} • {{ item.location }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Stock:</span><span>{{ item.on_hand }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Disponible:</span><v-chip :color="item.available <= 0 ? 'error' : 'success'" size="x-small">{{ item.available }}</v-chip></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Costo Unit.:</span><span>{{ formatMoney(item.unit_cost) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Valor Total:</span><span class="font-weight-bold">{{ formatMoney(item.total_value) }}</span></div>
              </v-card-text>
            </v-card>
          </div>
        </v-card>
      </v-window-item>

      <!-- Por Ubicación -->
      <v-window-item value="by-location">
        <v-card>
          <v-card-title><v-icon start>mdi-map-marker</v-icon>Inventario por Sede/Ubicación</v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Sede</th>
                <th class="text-right">SKUs</th>
                <th class="text-right">Unidades</th>
                <th class="text-right">Valor Total</th>
                <th class="text-right">% del Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="loc in inventoryByLocation" :key="loc.location">
                <td class="font-weight-bold">{{ loc.location }}</td>
                <td class="text-right">{{ loc.skus }}</td>
                <td class="text-right">{{ loc.units.toFixed(0) }}</td>
                <td class="text-right font-weight-bold">{{ formatMoney(loc.value) }}</td>
                <td class="text-right">
                  <v-progress-linear
                    :model-value="totalLocValue > 0 ? (loc.value / totalLocValue * 100) : 0"
                    color="green" height="14" rounded
                  >
                    <template #default="{ value }">
                      <span class="text-caption text-white">{{ value.toFixed(1) }}%</span>
                    </template>
                  </v-progress-linear>
                </td>
              </tr>
              <tr v-if="inventoryByLocation.length === 0">
                <td colspan="5" class="text-center text-grey pa-4">Sin datos</td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="loc in inventoryByLocation" :key="loc.location" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="text-body-1 font-weight-bold mb-2">{{ loc.location }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">SKUs:</span><span>{{ loc.skus }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Unidades:</span><span>{{ loc.units.toFixed(0) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Valor:</span><span class="font-weight-bold">{{ formatMoney(loc.value) }}</span></div>
              </v-card-text>
            </v-card>
          </div>
        </v-card>
      </v-window-item>

      <!-- Stock Bajo -->
      <v-window-item value="low-stock">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon start color="warning">mdi-alert</v-icon>
            Alertas de Stock
            <v-spacer></v-spacer>
            <v-select v-model="alertLevelFilter" :items="alertLevelOptions" item-title="label" item-value="value" label="Nivel" variant="outlined" density="compact" hide-details clearable style="max-width: 200px;" class="mr-2"></v-select>
            <v-btn size="small" color="primary" prepend-icon="mdi-refresh" @click="loadStockAlerts" :loading="loadingAlerts">Recargar</v-btn>
          </v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Nivel</th><th>Producto</th><th>SKU</th><th>Sede</th>
                <th class="text-right">Stock</th><th class="text-right">Disponible</th><th class="text-right">Mínimo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredStockAlerts" :key="`${item.location_id}-${item.variant_id}`">
                <td><v-chip :color="alertColor(item.alert_level)" size="small" variant="flat">{{ alertLabel(item.alert_level) }}</v-chip></td>
                <td><div class="text-body-2">{{ item.product_name }}</div><div class="text-caption text-grey">{{ item.variant_name }}</div></td>
                <td>{{ item.sku }}</td>
                <td>{{ item.location_name }}</td>
                <td class="text-right"><v-chip :color="item.on_hand <= 0 ? 'error' : 'grey'" size="small" variant="tonal">{{ item.on_hand }}</v-chip></td>
                <td class="text-right"><v-chip :color="item.available <= 0 ? 'error' : item.available <= item.min_stock ? 'warning' : 'success'" size="small" variant="tonal">{{ item.available }}</v-chip></td>
                <td class="text-right font-weight-bold">{{ item.min_stock }}</td>
              </tr>
              <tr v-if="filteredStockAlerts.length === 0">
                <td colspan="7" class="text-center pa-6">
                  <v-icon size="large" color="success">mdi-check-circle</v-icon>
                  <div class="mt-2 text-grey">No hay alertas de stock</div>
                </td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="item in filteredStockAlerts" :key="`${item.location_id}-${item.variant_id}`" :color="alertColor(item.alert_level)" variant="tonal" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center mb-2">
                  <v-chip :color="alertColor(item.alert_level)" size="small" variant="flat" class="mr-2">{{ alertLabel(item.alert_level) }}</v-chip>
                </div>
                <div class="text-body-2 font-weight-bold mb-1">{{ item.product_name }}</div>
                <div class="text-caption text-grey mb-2">{{ item.sku }} • {{ item.location_name }}</div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Stock:</span><span>{{ item.on_hand }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Disponible:</span><span>{{ item.available }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Mínimo:</span><span class="font-weight-bold">{{ item.min_stock }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="filteredStockAlerts.length === 0" class="text-center pa-4 text-grey">No hay alertas</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Sin Movimiento -->
      <v-window-item value="no-movement">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon start color="orange">mdi-sleep</v-icon>
            Productos sin Movimiento
            <v-spacer></v-spacer>
            <v-select
              v-model="noMovementDays"
              :items="[{ label: '30 días', value: 30 }, { label: '60 días', value: 60 }, { label: '90 días', value: 90 }]"
              item-title="label" item-value="value"
              label="Período"
              variant="outlined" density="compact" hide-details
              style="max-width: 150px;" class="mr-2"
            ></v-select>
            <v-btn size="small" color="primary" prepend-icon="mdi-refresh" @click="loadNoMovement" :loading="loadingNoMovement">{{ t('common.update') }}</v-btn>
          </v-card-title>
          <v-card-subtitle class="pb-2">
            Productos con stock disponible que no han tenido movimientos de inventario en los últimos {{ noMovementDays }} días.
            Valor inmovilizado: <strong>{{ formatMoney(totalFrozenValue) }}</strong>
          </v-card-subtitle>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Producto</th><th>SKU</th><th>Categoría</th><th>Sede</th>
                <th class="text-right">Stock</th><th class="text-right">Costo Unit.</th><th class="text-right">Valor Inmovilizado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in noMovementProducts" :key="`${item.sku}-${item.location}`">
                <td>
                  <div class="text-body-2">{{ item.product_name }}</div>
                  <div class="text-caption text-grey">{{ item.variant_name }}</div>
                </td>
                <td>{{ item.sku }}</td>
                <td>{{ item.category }}</td>
                <td>{{ item.location }}</td>
                <td class="text-right">{{ item.on_hand }}</td>
                <td class="text-right text-grey">{{ formatMoney(item.unit_cost) }}</td>
                <td class="text-right font-weight-bold text-warning">{{ formatMoney(item.frozen_value) }}</td>
              </tr>
              <tr v-if="noMovementProducts.length === 0">
                <td colspan="7" class="text-center pa-6">
                  <v-icon size="large" color="success">mdi-check-circle</v-icon>
                  <div class="mt-2 text-grey">Todos los productos tienen movimientos recientes</div>
                </td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="item in noMovementProducts" :key="`${item.sku}-${item.location}`" color="orange" variant="tonal" class="mb-2">
              <v-card-text>
                <div class="text-body-2 font-weight-bold mb-1">{{ item.product_name }}</div>
                <div class="text-caption text-grey mb-2">SKU: {{ item.sku }} • {{ item.location }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Categoría:</span><span>{{ item.category }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Stock:</span><span>{{ item.on_hand }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Valor Inmovilizado:</span><span class="font-weight-bold">{{ formatMoney(item.frozen_value) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="noMovementProducts.length === 0" class="text-center pa-4 text-grey">Sin productos inmovilizados</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Próximos a Vencer -->
      <v-window-item value="expiring">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon start color="red">mdi-calendar-clock</v-icon>
            Próximos a Vencer
            <v-spacer></v-spacer>
            <v-select
              v-model="expiringDays"
              :items="[{ label: '30 días', value: 30 }, { label: '60 días', value: 60 }, { label: '90 días', value: 90 }]"
              item-title="label" item-value="value"
              label="Horizonte"
              variant="outlined" density="compact" hide-details
              style="max-width: 150px;" class="mr-2"
            ></v-select>
            <v-btn size="small" color="primary" prepend-icon="mdi-refresh" @click="loadExpiring" :loading="loadingExpiring">{{ t('common.update') }}</v-btn>
          </v-card-title>
          <v-card-subtitle class="pb-2">
            Lotes que vencen en los próximos {{ expiringDays }} días.
            Valor en riesgo: <strong class="text-error">{{ formatMoney(totalAtRisk) }}</strong>
          </v-card-subtitle>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Estado</th><th>Producto</th><th>Lote</th><th>Sede</th>
                <th class="text-right">Días</th><th class="text-right">Cantidad</th><th class="text-right">Valor en Riesgo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in expiringProducts" :key="item.batch_number">
                <td>
                  <v-chip :color="expiryColor(item.status)" size="small" variant="flat">
                    {{ expiryLabel(item.status) }}
                  </v-chip>
                </td>
                <td>
                  <div class="text-body-2">{{ item.product_name }}</div>
                  <div class="text-caption text-grey">{{ item.variant_name }}</div>
                </td>
                <td>{{ item.batch_number }}</td>
                <td>{{ item.location }}</td>
                <td class="text-right">
                  <v-chip :color="item.days_to_expiry < 0 ? 'error' : item.days_to_expiry <= 7 ? 'error' : item.days_to_expiry <= 30 ? 'warning' : 'orange'" size="small" variant="tonal">
                    {{ item.days_to_expiry < 0 ? 'Vencido' : item.days_to_expiry + 'd' }}
                  </v-chip>
                </td>
                <td class="text-right">{{ item.quantity }}</td>
                <td class="text-right font-weight-bold text-error">{{ formatMoney(item.at_risk_value) }}</td>
              </tr>
              <tr v-if="expiringProducts.length === 0">
                <td colspan="7" class="text-center pa-6">
                  <v-icon size="large" color="success">mdi-check-circle</v-icon>
                  <div class="mt-2 text-grey">No hay productos próximos a vencer</div>
                </td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="item in expiringProducts" :key="item.batch_number" :color="expiryColor(item.status)" variant="tonal" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center justify-space-between mb-2">
                  <v-chip :color="expiryColor(item.status)" size="small" variant="flat">{{ expiryLabel(item.status) }}</v-chip>
                  <v-chip :color="item.days_to_expiry < 0 ? 'error' : 'warning'" size="small">
                    {{ item.days_to_expiry < 0 ? 'Vencido' : item.days_to_expiry + ' días' }}
                  </v-chip>
                </div>
                <div class="text-body-2 font-weight-bold mb-1">{{ item.product_name }}</div>
                <div class="text-caption text-grey mb-2">Lote: {{ item.batch_number }} • {{ item.location }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Vence:</span><span>{{ item.expiration_date }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Cantidad:</span><span>{{ item.quantity }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Valor en Riesgo:</span><span class="font-weight-bold text-error">{{ formatMoney(item.at_risk_value) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="expiringProducts.length === 0" class="text-center pa-4 text-grey">No hay productos por vencer</div>
          </div>
        </v-card>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from '@/i18n'
import { useTenant } from '@/composables/useTenant'
import reportsService from '@/services/reports.service'
import inventoryService from '@/services/inventory.service'
import { formatMoney } from '@/utils/formatters'

const { tenantId } = useTenant()
const { t } = useI18n()

const breadcrumbs = [
  { title: 'Reportes', to: '/reports', disabled: false },
  { title: 'Inventario', disabled: true }
]

const loading = ref(false)
const tab = ref('value')
const locations = ref([])
const locationFilter = ref(null)

const inventoryValue = ref(null)
const inventoryByLocation = ref([])

const noMovementProducts = ref([])
const noMovementDays = ref(30)
const loadingNoMovement = ref(false)

const expiringProducts = ref([])
const expiringDays = ref(90)
const loadingExpiring = ref(false)

const stockAlerts = ref([])
const loadingAlerts = ref(false)
const alertLevelFilter = ref(null)
const alertLevelOptions = [
  { label: 'Sin stock', value: 'OUT_OF_STOCK' },
  { label: 'Stock bajo', value: 'LOW_STOCK' },
  { label: 'Sin disponible', value: 'NO_AVAILABLE' },
  { label: 'Disponible bajo', value: 'LOW_AVAILABLE' }
]

const filteredStockAlerts = computed(() => {
  if (!alertLevelFilter.value) return stockAlerts.value
  return stockAlerts.value.filter(i => i.alert_level === alertLevelFilter.value)
})
const stockAlertsCount = computed(() => stockAlerts.value.length)
const totalLocValue = computed(() => inventoryByLocation.value.reduce((s, l) => s + l.value, 0))
const totalFrozenValue = computed(() => noMovementProducts.value.reduce((s, p) => s + p.frozen_value, 0))
const totalAtRisk = computed(() => expiringProducts.value.reduce((s, p) => s + p.at_risk_value, 0))

const alertColor = (level) => ({ OUT_OF_STOCK: 'error', LOW_STOCK: 'warning', NO_AVAILABLE: 'error', LOW_AVAILABLE: 'orange' }[level] || 'grey')
const alertLabel = (level) => ({ OUT_OF_STOCK: 'Sin stock', LOW_STOCK: 'Stock bajo', NO_AVAILABLE: 'Sin disponible', LOW_AVAILABLE: 'Disponible bajo' }[level] || level)
const expiryColor = (status) => ({ EXPIRED: 'error', CRITICAL: 'error', WARNING: 'warning', NEAR: 'orange' }[status] || 'grey')
const expiryLabel = (status) => ({ EXPIRED: 'Vencido', CRITICAL: 'Crítico (≤7d)', WARNING: 'Advertencia (≤30d)', NEAR: 'Próximo' }[status] || status)

const loadInventoryValue = async () => {
  if (!tenantId.value) return
  const r = await reportsService.getInventoryValue(tenantId.value, locationFilter.value)
  if (r.success) inventoryValue.value = r
}

const loadByLocation = async () => {
  if (!tenantId.value) return
  const r = await reportsService.getInventoryByLocation(tenantId.value)
  if (r.success) inventoryByLocation.value = r.data
}

const loadStockAlerts = async () => {
  if (!tenantId.value) return
  loadingAlerts.value = true
  try {
    const r = await inventoryService.getStockAlerts(tenantId.value, { location_id: locationFilter.value || undefined })
    if (r.success) stockAlerts.value = r.data
  } finally { loadingAlerts.value = false }
}

const loadNoMovement = async () => {
  if (!tenantId.value) return
  loadingNoMovement.value = true
  try {
    const r = await reportsService.getProductsWithNoMovement(tenantId.value, noMovementDays.value, locationFilter.value)
    if (r.success) noMovementProducts.value = r.data
  } finally { loadingNoMovement.value = false }
}

const loadExpiring = async () => {
  if (!tenantId.value) return
  loadingExpiring.value = true
  try {
    const r = await reportsService.getProductsExpiringSoon(tenantId.value, expiringDays.value, locationFilter.value)
    if (r.success) expiringProducts.value = r.data
  } finally { loadingExpiring.value = false }
}

const loadAll = async () => {
  loading.value = true
  try {
    await Promise.all([
      loadInventoryValue(),
      loadByLocation(),
      loadStockAlerts(),
      loadNoMovement(),
      loadExpiring()
    ])
  } finally { loading.value = false }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const { default: locService } = await import('@/services/locations.service')
  const r = await locService.getLocations(tenantId.value, 1, 100)
  if (r.success) locations.value = r.data
}

watch(noMovementDays, loadNoMovement)
watch(expiringDays, loadExpiring)

onMounted(async () => {
  await loadLocations()
  loadAll()
})
</script>
