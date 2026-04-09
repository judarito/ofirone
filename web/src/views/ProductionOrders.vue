<template>
  <div>
    <ListView
      title="Órdenes de Producción"
      icon="mdi-factory"
      :items="orders"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="production_order_id"
      title-field="order_number"
      avatar-icon="mdi-factory"
      :avatar-color="getStatusColor"
      empty-message="No hay órdenes de producción registradas"
      create-button-text="Nueva Orden"
      @create="openCreateDialog"
      @edit="openDetailDialog"
      @load-page="loadOrders"
      @search="loadOrders"
      :hide-delete="true"
    >
      <template #filters>
        <v-row dense>
          <v-col cols="12" sm="6" md="3">
            <v-select
              v-model="filters.status"
              :items="statusOptions"
              label="Estado"
              variant="outlined"
              density="compact"
              clearable
              @update:model-value="loadOrders(1)"
            ></v-select>
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-select
              v-model="filters.location_id"
              :items="locationOptions"
              item-title="name"
              item-value="location_id"
              label="Ubicación"
              variant="outlined"
              density="compact"
              clearable
              @update:model-value="loadOrders(1)"
            ></v-select>
          </v-col>
        </v-row>
      </template>

      <template #subtitle="{ item }">
        {{ item.bom?.bom_name }} - {{ item.bom?.product?.name || item.bom?.variant?.variant_name }}
      </template>

      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip :color="getStatusColor(item)" size="small" variant="flat">
            {{ getStatusLabel(item.status) }}
          </v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-package-variant">
            Cantidad: {{ item.quantity_planned }}
          </v-chip>
          <v-chip v-if="item.quantity_produced" size="small" variant="tonal" color="success" prepend-icon="mdi-check-circle">
            Producido: {{ item.quantity_produced }}
          </v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-map-marker">
            {{ item.location?.name }}
          </v-chip>
          <v-chip v-if="item.scheduled_start" size="small" variant="tonal" prepend-icon="mdi-calendar-clock">
            {{ formatDate(item.scheduled_start) }}
          </v-chip>
        </div>
      </template>

      <template #actions="{ item }">
        <div class="d-flex flex-column flex-sm-row ga-1">
          <v-tooltip v-if="item.status === 'PENDING'" text="Iniciar producción" location="top">
            <template #activator="{ props }">
              <v-btn
                icon="mdi-play-circle"
                variant="text"
                size="small"
                color="success"
                v-bind="props"
                @click.stop="startOrder(item)"
              ></v-btn>
            </template>
          </v-tooltip>
          
          <v-tooltip v-if="item.status === 'IN_PROGRESS'" text="Completar producción" location="top">
            <template #activator="{ props }">
              <v-btn
                icon="mdi-check-circle"
                variant="text"
                size="small"
                color="primary"
                v-bind="props"
                @click.stop="openCompleteDialog(item)"
              ></v-btn>
            </template>
          </v-tooltip>

          <v-tooltip text="Ver detalles" location="top">
            <template #activator="{ props }">
              <v-btn
                icon="mdi-eye"
                variant="text"
                size="small"
                v-bind="props"
                @click.stop="openDetailDialog(item)"
              ></v-btn>
            </template>
          </v-tooltip>

          <v-tooltip v-if="['PENDING', 'IN_PROGRESS'].includes(item.status)" text="Cancelar" location="top">
            <template #activator="{ props }">
              <v-btn
                icon="mdi-close-circle"
                variant="text"
                size="small"
                color="error"
                v-bind="props"
                @click.stop="confirmCancel(item)"
              ></v-btn>
            </template>
          </v-tooltip>
        </div>
      </template>
    </ListView>

    <!-- Dialog Crear Orden -->
    <v-dialog v-model="createDialog" max-width="600" scrollable>
      <v-card>
        <v-card-title>
          <v-icon start>mdi-plus</v-icon>
          Nueva Orden de Producción
        </v-card-title>
        <v-card-text>
          <v-form ref="createForm" @submit.prevent="createOrder">
            <v-row>
              <v-col cols="12">
                <v-select
                  v-model="createFormData.location_id"
                  :items="locationOptions"
                  item-title="name"
                  item-value="location_id"
                  label="Ubicación"
                  prepend-inner-icon="mdi-map-marker"
                  variant="outlined"
                  :rules="[rules.required]"
                ></v-select>
              </v-col>

              <v-col cols="12">
                <v-autocomplete
                  v-model="createFormData.bom_id"
                  :items="bomOptions"
                  item-title="display_name"
                  item-value="bom_id"
                  label="BOM (Bill of Materials)"
                  prepend-inner-icon="mdi-file-tree"
                  variant="outlined"
                  :rules="[rules.required]"
                  @update:model-value="onBOMSelected"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props">
                      <template #title>{{ item.raw.display_name }}</template>
                      <template #subtitle>
                        {{ item.raw.components_count }} componentes | Costo: ${{ (item.raw.estimated_cost || 0).toLocaleString() }}
                      </template>
                    </v-list-item>
                  </template>
                </v-autocomplete>
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model.number="createFormData.quantity"
                  label="Cantidad a Producir"
                  type="number"
                  step="1"
                  min="1"
                  prepend-inner-icon="mdi-package-variant"
                  variant="outlined"
                  :rules="[rules.required, rules.positive]"
                ></v-text-field>
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="createFormData.scheduled_start"
                  label="Fecha Programada"
                  type="datetime-local"
                  prepend-inner-icon="mdi-calendar-clock"
                  variant="outlined"
                ></v-text-field>
              </v-col>

              <v-col cols="12">
                <v-textarea
                  v-model="createFormData.notes"
                  label="Notas"
                  prepend-inner-icon="mdi-note-text"
                  variant="outlined"
                  rows="2"
                ></v-textarea>
              </v-col>

              <!-- Preview de disponibilidad de componentes -->
              <v-col v-if="componentAvailability.length > 0" cols="12">
                <v-alert type="info" variant="tonal" density="compact">
                  <div class="text-subtitle-2 mb-2">Disponibilidad de Componentes:</div>
                  <div v-for="comp in componentAvailability" :key="comp.component_variant_id" class="d-flex justify-space-between">
                    <span class="text-caption">{{ comp.component_name }}</span>
                    <v-chip
                      :color="comp.is_sufficient ? 'success' : 'error'"
                      size="x-small"
                      variant="flat"
                    >
                      {{ comp.available_quantity }} / {{ comp.required_quantity }}
                    </v-chip>
                  </div>
                </v-alert>
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="closeCreateDialog">{{ t('common.cancel') }}</v-btn>
          <v-spacer></v-spacer>
          <v-btn
            color="primary"
            variant="flat"
            :loading="saving"
            :disabled="!canCreateOrder"
            @click="createOrder"
          >
            Crear Orden
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Completar Producción -->
    <v-dialog v-model="completeDialog" max-width="500">
      <v-card>
        <v-card-title>
          <v-icon start color="success">mdi-check-circle</v-icon>
          Completar Producción
        </v-card-title>
        <v-card-text>
          <v-form ref="completeForm">
            <v-row>
              <v-col cols="12">
                <v-text-field
                  v-model.number="completeFormData.quantity_produced"
                  label="Cantidad Producida"
                  type="number"
                  step="0.01"
                  min="0"
                  :max="selectedOrder?.quantity_planned"
                  prepend-inner-icon="mdi-package-variant-closed"
                  variant="outlined"
                  :rules="[rules.required, rules.positive]"
                  :hint="`Cantidad planeada: ${selectedOrder?.quantity_planned || 0}`"
                  persistent-hint
                ></v-text-field>
              </v-col>

              <v-col v-if="selectedOrder?.bom?.product?.requires_expiration" cols="12">
                <v-text-field
                  v-model="completeFormData.expiration_date"
                  label="Fecha de Vencimiento"
                  type="date"
                  prepend-inner-icon="mdi-calendar-alert"
                  variant="outlined"
                  hint="Producto requiere control de vencimiento"
                  persistent-hint
                ></v-text-field>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="completeFormData.physical_location"
                  label="Ubicación Física"
                  prepend-inner-icon="mdi-warehouse"
                  variant="outlined"
                  hint="Ej: Estantería A3, Refrigerador 2"
                  persistent-hint
                ></v-text-field>
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="closeCompleteDialog">{{ t('common.cancel') }}</v-btn>
          <v-spacer></v-spacer>
          <v-btn
            color="success"
            variant="flat"
            :loading="saving"
            @click="completeProduction"
          >
            Completar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Detalle -->
    <v-dialog v-model="detailDialog" max-width="800" scrollable>
      <v-card v-if="selectedOrder">
        <v-card-title>
          <v-icon start>mdi-factory</v-icon>
          Orden #{{ selectedOrder.order_number }}
          <v-spacer></v-spacer>
          <v-chip :color="getStatusColor(selectedOrder)" size="small">
            {{ getStatusLabel(selectedOrder.status) }}
          </v-chip>
        </v-card-title>

        <v-card-text>
          <!-- Información general -->
          <v-row dense>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Producto/BOM:</div>
              <div class="text-body-1 font-weight-medium">
                {{ selectedOrder.bom?.bom_name }}
              </div>
              <div class="text-caption">
                {{ selectedOrder.bom?.product?.name || selectedOrder.bom?.variant?.variant_name }}
              </div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Ubicación:</div>
              <div class="text-body-1">{{ selectedOrder.location?.name }}</div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Cantidad Planeada:</div>
              <div class="text-body-1 font-weight-bold">{{ selectedOrder.quantity_planned }}</div>
            </v-col>

            <v-col v-if="selectedOrder.quantity_produced" cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Cantidad Producida:</div>
              <div class="text-body-1 font-weight-bold text-success">{{ selectedOrder.quantity_produced }}</div>
            </v-col>

            <v-col v-if="selectedOrder.scheduled_start" cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Programada:</div>
              <div class="text-body-2">{{ formatDateTime(selectedOrder.scheduled_start) }}</div>
            </v-col>

            <v-col v-if="selectedOrder.started_at" cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Iniciada:</div>
              <div class="text-body-2">{{ formatDateTime(selectedOrder.started_at) }}</div>
            </v-col>

            <v-col v-if="selectedOrder.completed_at" cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Completada:</div>
              <div class="text-body-2">{{ formatDateTime(selectedOrder.completed_at) }}</div>
            </v-col>

            <v-col v-if="selectedOrder.notes" cols="12">
              <div class="text-caption text-medium-emphasis">Notas:</div>
              <div class="text-body-2">{{ selectedOrder.notes }}</div>
            </v-col>
          </v-row>

          <v-divider class="my-4"></v-divider>

          <!-- Componentes -->
          <div class="text-subtitle-1 mb-2">
            <v-icon start>mdi-format-list-bulleted</v-icon>
            Componentes
          </div>

          <v-table v-if="selectedOrder.production_order_lines?.length > 0" density="compact">
            <thead>
              <tr>
                <th>Componente</th>
                <th class="text-right">Planeado</th>
                <th class="text-right">Consumido</th>
                <th class="text-right">Costo Unit.</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in selectedOrder.production_order_lines" :key="line.line_id">
                <td>{{ line.component_variant?.variant_name || line.component_variant?.sku }}</td>
                <td class="text-right">{{ line.quantity_required || 0 }}</td>
                <td class="text-right">{{ line.quantity_consumed || 0 }}</td>
                <td class="text-right">${{ (line.unit_cost || 0).toLocaleString() }}</td>
                <td class="text-right font-weight-bold">
                  ${{ ((line.quantity_consumed || 0) * (line.unit_cost || 0)).toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>

        <v-card-actions>
          <v-btn variant="text" @click="closeDetailDialog">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Diálogo confirmación iniciar producción -->
    <v-dialog v-model="confirmStartDialog" max-width="400">
      <v-card>
        <v-card-title class="text-h6">Confirmar</v-card-title>
        <v-card-text>
          ¿Iniciar producción de la orden #{{ orderToStart?.order_number }}?
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="confirmStartDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" @click="doStartProduction">Iniciar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Diálogo confirmación cancelar orden -->
    <v-dialog v-model="confirmCancelDialog" max-width="400">
      <v-card>
        <v-card-title class="text-h6">Confirmar</v-card-title>
        <v-card-text>
          ¿Cancelar la orden #{{ orderToCancel?.order_number }}?
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="confirmCancelDialog = false">No</v-btn>
          <v-btn color="error" variant="flat" @click="doCancelOrder">Sí, Cancelar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar para mensajes -->
    <v-snackbar
      v-model="snackbar"
      :color="snackbarColor"
      :timeout="3000"
    >
      {{ snackbarMessage }}
    </v-snackbar>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAuth } from '@/composables/useAuth'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import manufacturingService from '@/services/manufacturing.service'
import locationsService from '@/services/locations.service'
import { humanizeAppError } from '@/utils/appErrors'

export default {
  name: 'ProductionOrders',
  components: { ListView },

  setup() {
    const { t } = useI18n()
    const { tenantId } = useTenant()
    const { defaultPageSize } = useTenantSettings()
    const { userProfile } = useAuth()
    const loading = ref(false)
    const saving = ref(false)
    const orders = ref([])
    const totalItems = ref(0)

    const createDialog = ref(false)
    const completeDialog = ref(false)
    const detailDialog = ref(false)
    const confirmStartDialog = ref(false)
    const confirmCancelDialog = ref(false)

    const createForm = ref(null)
    const completeForm = ref(null)

    const locationOptions = ref([])
    const bomOptions = ref([])
    const componentAvailability = ref([])
    const selectedOrder = ref(null)
    const orderToStart = ref(null)
    const orderToCancel = ref(null)

    const filters = ref({
      status: null,
      location_id: null
    })

    const createFormData = ref({
      location_id: null,
      bom_id: null,
      quantity: 1,
      scheduled_start: null,
      notes: ''
    })

    const completeFormData = ref({
      quantity_produced: 0,
      expiration_date: null,
      physical_location: ''
    })

    // Snackbar
    const snackbar = ref(false)
    const snackbarMessage = ref('')
    const snackbarColor = ref('success')

    const statusOptions = [
      { value: 'PENDING', title: 'Pendiente' },
      { value: 'IN_PROGRESS', title: 'En Progreso' },
      { value: 'COMPLETED', title: 'Completada' },
      { value: 'CANCELLED', title: 'Cancelada' }
    ]

    const rules = {
      required: value => !!value || 'Campo requerido',
      positive: value => value > 0 || 'Debe ser mayor a 0'
    }

    const currentUser = computed(() => userProfile.value)

    const canCreateOrder = computed(() => {
      return createFormData.value.bom_id && 
             createFormData.value.location_id && 
             createFormData.value.quantity > 0 &&
             componentAvailability.value.every(c => c.is_sufficient)
    })

    const getStatusColor = (item) => {
      const colors = {
        PENDING: 'warning',
        IN_PROGRESS: 'info',
        COMPLETED: 'success',
        CANCELLED: 'error'
      }
      return colors[item.status] || 'grey'
    }

    const getStatusLabel = (status) => {
      const labels = {
        PENDING: 'Pendiente',
        IN_PROGRESS: 'En Progreso',
        COMPLETED: 'Completada',
        CANCELLED: 'Cancelada'
      }
      return labels[status] || status
    }

    const formatDate = (dateString) => {
      if (!dateString) return ''
      return new Date(dateString).toLocaleDateString('es-CO')
    }

    const formatDateTime = (dateString) => {
      if (!dateString) return ''
      return new Date(dateString).toLocaleString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    // Método para mostrar mensajes
    const showMsg = (message, color = 'success') => {
      snackbarMessage.value = color === 'error'
        ? humanizeAppError(message, { defaultMessage: 'Ocurrió un error en producción.' })
        : message
      snackbarColor.value = color
      snackbar.value = true
    }

    const loadOrders = async (page = 1) => {
      loading.value = true
      try {
        const result = await manufacturingService.getProductionOrders(
          tenantId.value,
          page,
          defaultPageSize,
          filters.value
        )

        if (result.success) {
          orders.value = result.data
          totalItems.value = result.total
        }
      } catch (error) {
        console.error('Error loading production orders:', error)
      } finally {
        loading.value = false
      }
    }

    const loadLocations = async () => {
      try {
        const result = await locationsService.getLocations(tenantId.value, 1, 100, '')
        if (result.success) {
          locationOptions.value = result.data.filter(l => l.is_active)
        }
      } catch (error) {
        console.error('Error loading locations:', error)
      }
    }

    const loadBOMs = async () => {
      try {
        const result = await manufacturingService.getBOMs(tenantId.value, 1, 1000, '')
        if (result.success) {
          bomOptions.value = result.data.map(bom => ({
            bom_id: bom.bom_id,
            display_name: `${bom.bom_name} - ${bom.product?.name || bom.variant?.variant_name}`,
            components_count: bom.bom_components?.length || 0,
            estimated_cost: bom.bom_components?.reduce((sum, c) => 
              sum + (c.quantity_required * (c.component_variant?.cost || 0)), 0
            ) || 0
          }))
        }
      } catch (error) {
        console.error('Error loading BOMs:', error)
      }
    }

    const onBOMSelected = async () => {
      if (!createFormData.value.bom_id || !createFormData.value.location_id) return

      try {
        const result = await manufacturingService.validateBOMAvailability(
          tenantId.value,
          createFormData.value.bom_id,
          createFormData.value.quantity,
          createFormData.value.location_id
        )

        if (result.success) {
          componentAvailability.value = result.data.map(c => ({
            component_variant_id: c.component_variant_id,
            component_name: c.component_name || 'Sin nombre',
            required_quantity: c.required_quantity,
            available_quantity: c.available_quantity,
            is_sufficient: c.is_sufficient
          }))
        }
      } catch (error) {
        console.error('Error validating BOM availability:', error)
      }
    }

    const openCreateDialog = async () => {
      await loadBOMs()
      await loadLocations()
      createFormData.value = {
        location_id: null,
        bom_id: null,
        quantity: 1,
        scheduled_start: null,
        notes: ''
      }
      componentAvailability.value = []
      createDialog.value = true
    }

    const closeCreateDialog = () => {
      createDialog.value = false
      if (createForm.value) createForm.value.reset()
    }

    const createOrder = async () => {
      const { valid } = await createForm.value.validate()
      if (!valid || !canCreateOrder.value) return

      saving.value = true
      try {
        const result = await manufacturingService.createProductionOrder(
          tenantId.value,
          createFormData.value.location_id,
          createFormData.value.bom_id,
          createFormData.value.quantity,
          currentUser.value?.user_id,
          createFormData.value.scheduled_start,
          createFormData.value.notes
        )

        if (result.success) {
          closeCreateDialog()
          loadOrders()
          showMsg('Orden de producción creada exitosamente', 'success')
        } else {
          showMsg('Error al crear orden: ' + result.error, 'error')
        }
      } catch (error) {
        console.error('Error creating production order:', error)
        showMsg('Error al crear orden: ' + error.message, 'error')
      } finally {
        saving.value = false
      }
    }

    const startOrder = (order) => {
      orderToStart.value = order
      confirmStartDialog.value = true
    }

    const doStartProduction = async () => {
      if (!orderToStart.value) return

      confirmStartDialog.value = false

      try {
        const result = await manufacturingService.startProduction(
          tenantId.value,
          orderToStart.value.production_order_id,
          currentUser.value?.user_id
        )

        if (result.success) {
          loadOrders()
          showMsg('Producción iniciada exitosamente', 'success')
        } else {
          showMsg('Error al iniciar producción: ' + result.error, 'error')
        }
      } catch (error) {
        console.error('Error starting production:', error)
        showMsg('Error al iniciar producción: ' + error.message, 'error')
      }
    }

    const openCompleteDialog = (order) => {
      selectedOrder.value = order
      completeFormData.value = {
        quantity_produced: order.quantity_planned,
        expiration_date: null,
        physical_location: ''
      }
      completeDialog.value = true
    }

    const closeCompleteDialog = () => {
      completeDialog.value = false
      selectedOrder.value = null
    }

    const completeProduction = async () => {
      const { valid } = await completeForm.value.validate()
      if (!valid) return

      saving.value = true
      try {
        const result = await manufacturingService.completeProduction(
          tenantId.value,
          selectedOrder.value.production_order_id,
          completeFormData.value.quantity_produced,
          currentUser.value?.user_id,
          completeFormData.value.expiration_date,
          completeFormData.value.physical_location
        )

        if (result.success) {
          closeCompleteDialog()
          loadOrders()
          showMsg('Producción completada exitosamente', 'success')
        } else {
          showMsg('Error al completar producción: ' + result.error, 'error')
        }
      } catch (error) {
        console.error('Error completing production:', error)
        showMsg('Error al completar producción: ' + error.message, 'error')
      } finally {
        saving.value = false
      }
    }

    const confirmCancel = (order) => {
      orderToCancel.value = order
      confirmCancelDialog.value = true
    }

    const doCancelOrder = async () => {
      if (!orderToCancel.value) return

      confirmCancelDialog.value = false

      try {
        const result = await manufacturingService.cancelProductionOrder(
          tenantId.value,
          orderToCancel.value.production_order_id
        )

        if (result.success) {
          loadOrders()
          showMsg('Orden cancelada exitosamente', 'success')
        } else {
          showMsg('Error al cancelar orden: ' + result.error, 'error')
        }
      } catch (error) {
        console.error('Error cancelling order:', error)
        showMsg('Error al cancelar orden: ' + error.message, 'error')
      }
    }

    const openDetailDialog = async (order) => {
      try {
        const result = await manufacturingService.getProductionOrderById(
          tenantId.value,
          order.production_order_id
        )

        if (result.success) {
          selectedOrder.value = result.data
          detailDialog.value = true
        }
      } catch (error) {
        console.error('Error loading order details:', error)
      }
    }

    const closeDetailDialog = () => {
      detailDialog.value = false
      selectedOrder.value = null
    }

    onMounted(() => {
      loadOrders()
      loadLocations()
    })

    return {
      t,
      loading,
      saving,
      orders,
      totalItems,
      defaultPageSize,
      createDialog,
      completeDialog,
      detailDialog,
      confirmStartDialog,
      confirmCancelDialog,
      createForm,
      completeForm,
      locationOptions,
      bomOptions,
      componentAvailability,
      selectedOrder,
      orderToStart,
      orderToCancel,
      filters,
      createFormData,
      completeFormData,
      statusOptions,
      rules,
      canCreateOrder,
      snackbar,
      snackbarMessage,
      snackbarColor,
      showMsg,
      getStatusColor,
      getStatusLabel,
      formatDate,
      formatDateTime,
      loadOrders,
      openCreateDialog,
      closeCreateDialog,
      createOrder,
      onBOMSelected,
      startOrder,
      doStartProduction,
      openCompleteDialog,
      closeCompleteDialog,
      completeProduction,
      confirmCancel,
      doCancelOrder,
      openDetailDialog,
      closeDetailDialog
    }
  }
}
</script>
