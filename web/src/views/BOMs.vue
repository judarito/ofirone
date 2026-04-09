<template>
  <div>
    <ListView
      title="Listas de Materiales (BOMs)"
      icon="mdi-file-tree"
      :items="boms"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="bom_id"
      title-field="bom_name"
      avatar-icon="mdi-file-tree"
      avatar-color="primary"
      empty-message="No hay listas de materiales registradas"
      create-button-text="Nueva BOM"
      @create="openCreateBOM"
      @edit="openEditBOM"
      @delete="confirmDelete"
      @load-page="loadBOMs"
      @search="loadBOMs"
    >
      <template #filters>
        <v-row dense>
          <v-col cols="12" sm="6" md="4">
            <v-select
              v-model="filters.type"
              :items="typeOptions"
              :label="t('common.type')"
              variant="outlined"
              density="compact"
              clearable
              @update:model-value="loadBOMs(1)"
            ></v-select>
          </v-col>
        </v-row>
      </template>

      <template #subtitle="{ item }">
        <span v-if="item.product">
          <v-icon size="small">mdi-package-variant</v-icon>
          Producto: {{ item.product.name }}
        </span>
        <span v-else-if="item.variant">
          <v-icon size="small">mdi-package-variant-closed</v-icon>
          Variante: {{ item.variant.sku }} - {{ item.variant.variant_name }}
        </span>
      </template>

      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip size="small" variant="tonal" color="primary" prepend-icon="mdi-puzzle">
            {{ item.bom_components?.length || 0 }} componente(s)
          </v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-counter">
            Versión {{ item.version || 1 }}
          </v-chip>
          <v-chip v-if="item.is_active" size="small" variant="flat" color="success">
            Activo
          </v-chip>
          <v-chip v-else size="small" variant="flat" color="error">
            Inactivo
          </v-chip>
        </div>
        <div v-if="item.notes" class="mt-2 text-caption text-medium-emphasis">
          {{ item.notes }}
        </div>
      </template>

      <template #actions="{ item }">
        <div class="d-flex flex-wrap ga-1">
          <v-tooltip text="Ver componentes" location="top">
            <template #activator="{ props }">
              <v-btn
                icon="mdi-eye"
                variant="text"
                size="small"
                color="info"
                v-bind="props"
                @click.stop="openDetailDialog(item)"
              ></v-btn>
            </template>
          </v-tooltip>

          <v-tooltip text="Editar BOM" location="top">
            <template #activator="{ props }">
              <v-btn
                icon="mdi-pencil"
                variant="text"
                size="small"
                color="primary"
                v-bind="props"
                @click.stop="openEditBOM(item)"
              ></v-btn>
            </template>
          </v-tooltip>

          <v-tooltip text="Eliminar BOM" location="top">
            <template #activator="{ props }">
              <v-btn
                icon="mdi-delete"
                variant="text"
                size="small"
                color="error"
                v-bind="props"
                @click.stop="confirmDelete(item)"
              ></v-btn>
            </template>
          </v-tooltip>
        </div>
      </template>
    </ListView>

    <!-- Dialog de Detalles -->
    <v-dialog v-model="detailDialog" max-width="800">
      <v-card v-if="selectedBOM">
        <v-card-title class="d-flex align-center">
          <v-icon start color="primary">mdi-file-tree</v-icon>
          <span>{{ selectedBOM.bom_name }}</span>
          <v-spacer></v-spacer>
          <v-btn icon="mdi-close" variant="text" @click="detailDialog = false"></v-btn>
        </v-card-title>

        <v-card-subtitle>
          <span v-if="selectedBOM.product">
            Producto: {{ selectedBOM.product.name }}
          </span>
          <span v-else-if="selectedBOM.variant">
            Variante: {{ selectedBOM.variant.sku }} - {{ selectedBOM.variant.variant_name }}
          </span>
        </v-card-subtitle>

        <v-divider></v-divider>

        <v-card-text>
          <div class="mb-4">
            <div class="text-h6 mb-2">Información General</div>
            <v-row dense>
              <v-col cols="6">
                <div class="text-caption text-medium-emphasis">Versión</div>
                <div>{{ selectedBOM.version || 1 }}</div>
              </v-col>
              <v-col cols="6">
                <div class="text-caption text-medium-emphasis">Estado</div>
                <v-chip size="small" :color="selectedBOM.is_active ? 'success' : 'error'">
                  {{ selectedBOM.is_active ? 'Activo' : 'Inactivo' }}
                </v-chip>
              </v-col>
              <v-col v-if="selectedBOM.notes" cols="12" class="mt-2">
                <div class="text-caption text-medium-emphasis">Notas</div>
                <div>{{ selectedBOM.notes }}</div>
              </v-col>
            </v-row>
          </div>

          <div>
            <div class="text-h6 mb-2">Componentes</div>
            <v-table density="compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Componente</th>
                  <th class="text-right">Cantidad</th>
                  <th class="text-right">Desperdicio</th>
                  <th class="text-center">Opcional</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="comp in selectedBOM.bom_components" :key="comp.component_id">
                  <td>{{ comp.component_variant?.sku }}</td>
                  <td>{{ comp.component_variant?.variant_name }}</td>
                  <td class="text-right">{{ comp.quantity_required }} {{ comp.unit?.name || comp.unit?.code || '' }}</td>
                  <td class="text-right">{{ comp.waste_percentage || 0 }}%</td>
                  <td class="text-center">
                    <v-icon v-if="comp.is_optional" color="success" size="small">mdi-check</v-icon>
                    <v-icon v-else color="error" size="small">mdi-close</v-icon>
                  </td>
                </tr>
              </tbody>
            </v-table>
            <div v-if="!selectedBOM.bom_components || selectedBOM.bom_components.length === 0" 
                 class="text-center py-4 text-medium-emphasis">
              No hay componentes definidos
            </div>
          </div>

          <div v-if="bomCost" class="mt-4 pa-3 bg-surface-variant rounded">
            <div class="d-flex justify-space-between align-center">
              <span class="text-subtitle-1 font-weight-bold">Costo Total</span>
              <span class="text-h6 text-primary">${{ bomCost.toFixed(2) }}</span>
            </div>
          </div>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" @click="detailDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog de Confirmación de Eliminación -->
    <v-dialog v-model="deleteDialog" max-width="500">
      <v-card>
        <v-card-title class="text-h6">
          <v-icon start color="error">mdi-alert</v-icon>
          Confirmar Eliminación
        </v-card-title>
        <v-card-text>
          <p>¿Estás seguro de eliminar la BOM <strong>{{ bomToDelete?.bom_name }}</strong>?</p>
          <p class="text-error">Esta acción no se puede deshacer.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="grey" variant="text" @click="deleteDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="deleteBOM">{{ t('common.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- BOM Editor Modal -->
    <BOMEditor ref="bomEditor" @saved="onBOMSaved" @close="bomEditorClosed" />

    <!-- Snackbar -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
      {{ snackbar.message }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import ListView from '@/components/ListView.vue'
import BOMEditor from '@/components/BOMEditor.vue'
import manufacturingService from '@/services/manufacturing.service'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { tenantId } = useTenant()

// Estado
const boms = ref([])
const totalItems = ref(0)
const loading = ref(false)
const { defaultPageSize } = useTenantSettings()
const detailDialog = ref(false)
const deleteDialog = ref(false)
const selectedBOM = ref(null)
const bomToDelete = ref(null)
const bomEditor = ref(null)
const bomCost = ref(null)

// Filtros
const filters = ref({
  type: null
})

const typeOptions = [
  { title: 'Producto', value: 'product' },
  { title: 'Variante', value: 'variant' }
]

// Snackbar
const snackbar = ref({
  show: false,
  message: '',
  color: 'success'
})

const showMsg = (message, color = 'success') => {
  snackbar.value = { show: true, message, color }
}

// Métodos
const loadBOMs = async (pageOrParams = 1) => {
  // ListView puede pasar un objeto { page, pageSize, search } o solo el número de página
  let page = 1
  let pageSize = defaultPageSize.value
  let search = ''
  
  if (typeof pageOrParams === 'object' && pageOrParams !== null) {
    page = pageOrParams.page || 1
    pageSize = pageOrParams.pageSize || defaultPageSize.value
    search = pageOrParams.search || ''
  } else {
    page = pageOrParams || 1
  }
  
  if (!tenantId.value) return

  loading.value = true
  try {
    const result = await manufacturingService.getBOMs(tenantId.value, page, pageSize, search)
    
    if (result.success) {
      // Aplicar filtro de tipo si está seleccionado
      let filteredData = result.data
      if (filters.value.type === 'product') {
        filteredData = filteredData.filter(b => b.product_id !== null)
      } else if (filters.value.type === 'variant') {
        filteredData = filteredData.filter(b => b.variant_id !== null)
      }
      
      boms.value = filteredData
      totalItems.value = result.total || filteredData.length
    } else {
      showMsg(result.error || 'Error al cargar BOMs', 'error')
    }
  } catch (error) {
    console.error('Error loading BOMs:', error)
    showMsg('Error al cargar BOMs', 'error')
  } finally {
    loading.value = false
  }
}

const openDetailDialog = async (bom) => {
  selectedBOM.value = bom
  detailDialog.value = true
  
  // Calcular costo del BOM
  if (bom.bom_id) {
    const result = await manufacturingService.getBOMCost(tenantId.value, bom.bom_id, 1)
    if (result.success) {
      bomCost.value = result.data.total_cost
    }
  }
}

const openCreateBOM = () => {
  if (bomEditor.value) {
    bomEditor.value.open(null, null, null)
  }
}

const openEditBOM = async (bom) => {
  if (!bomEditor.value || !bom || !tenantId.value) return
  
  try {
    // Cargar el BOM completo con todos sus componentes
    const result = await manufacturingService.getBOMById(tenantId.value, bom.bom_id)
    
    if (result.success && result.data) {
      // Pasar el productId o variantId según corresponda
      bomEditor.value.open(result.data.product_id, result.data.variant_id, result.data)
    } else {
      showMsg(result.error || 'Error al cargar BOM', 'error')
    }
  } catch (error) {
    console.error('Error loading BOM for edit:', error)
    showMsg('Error al cargar BOM', 'error')
  }
}

const confirmDelete = (bom) => {
  bomToDelete.value = bom
  deleteDialog.value = true
}

const deleteBOM = async () => {
  if (!bomToDelete.value || !tenantId.value) return

  try {
    const result = await manufacturingService.deleteBOM(tenantId.value, bomToDelete.value.bom_id)
    
    if (result.success) {
      showMsg('BOM eliminada exitosamente', 'success')
      deleteDialog.value = false
      bomToDelete.value = null
      await loadBOMs()
    } else {
      showMsg(result.error || 'Error al eliminar BOM', 'error')
    }
  } catch (error) {
    console.error('Error deleting BOM:', error)
    showMsg('Error al eliminar BOM', 'error')
  }
}

const onBOMSaved = async () => {
  showMsg('BOM guardada exitosamente', 'success')
  await loadBOMs()
}

const bomEditorClosed = () => {
  // No hacer nada especial al cerrar el editor
}

// Ciclo de vida
onMounted(() => {
  loadBOMs()
})
</script>

<style scoped>
.bg-surface-variant {
  background-color: rgb(var(--v-theme-surface-variant));
}
</style>
