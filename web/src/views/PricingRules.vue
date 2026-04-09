<template>
  <div>
    <v-card flat class="mb-3">
      <v-card-text class="pa-2 d-flex justify-end" style="gap: 8px; flex-wrap: wrap;">
        <v-btn
          color="deep-purple"
          prepend-icon="mdi-brain"
          variant="tonal"
          :loading="loadingPricingAI"
          @click="openPricingAIDialog"
        >
          Sugerencias IA de Precio
        </v-btn>
      </v-card-text>
    </v-card>

    <v-card flat class="mb-3">
      <v-card-text class="pa-2">
        <v-row dense>
          <v-col cols="12" md="3">
            <v-select
              v-model="scopeFilter"
              :items="scopeOptions"
              item-title="title"
              item-value="value"
              label="Alcance"
              density="compact"
              variant="outlined"
              clearable
              hide-details
              @update:model-value="applyFilters"
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="statusFilter"
              :items="statusOptions"
              item-title="label"
              item-value="value"
              label="Estado"
              density="compact"
              variant="outlined"
              hide-details
              @update:model-value="applyFilters"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <ListView
      title="Politicas de Precio"
      icon="mdi-tag-multiple"
      :items="rules"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="pricing_rule_id"
      title-field="scope"
      avatar-icon="mdi-cash-multiple"
      avatar-color="green"
      empty-message="No hay politicas de precio configuradas"
      create-button-text="Nueva Politica"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="confirmDelete"
      @load-page="loadRules"
      @search="loadRules"
    >
      <template #title="{ item }">
        {{ getScopeLabel(item.scope) }} - {{ item.pricing_method === 'MARKUP' ? `Markup ${item.markup_percentage}%` : 'Precio Fijo' }}
      </template>
      <template #subtitle="{ item }">
        <span v-if="item.scope === 'TENANT'">Aplica a todo el negocio</span>
        <span v-else-if="item.scope === 'LOCATION'">Sede: {{ item.location?.name }}</span>
        <span v-else-if="item.scope === 'CATEGORY'">Categoria: {{ item.category?.name }}</span>
        <span v-else-if="item.scope === 'PRODUCT'">Producto: {{ item.product?.name }}</span>
        <span v-else-if="item.scope === 'VARIANT'">Variante: {{ item.variant?.sku }} - {{ item.variant?.variant_name }}</span>
      </template>
      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip :color="item.is_active ? 'success' : 'error'" size="small" variant="flat">
            {{ item.is_active ? 'Activo' : 'Inactivo' }}
          </v-chip>
          <v-chip size="small" variant="tonal" color="info">
            Prioridad: {{ item.priority }}
          </v-chip>
          <v-chip v-if="item.price_rounding !== 'NONE'" size="small" variant="tonal" color="orange">
            Redondeo: {{ getRoundingLabel(item.price_rounding) }}
          </v-chip>
        </div>
      </template>
    </ListView>

    <v-dialog v-model="dialog" max-width="600" persistent>
      <v-card>
        <v-card-title>
          <v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
          {{ isEditing ? 'Editar Politica' : 'Nueva Politica de Precio' }}
        </v-card-title>
        <v-card-text>
          <v-form ref="form">
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="formData.scope"
                  :items="scopeOptions"
                  item-title="title"
                  item-value="value"
                  label="Alcance *"
                  prepend-inner-icon="mdi-target"
                  variant="outlined"
                  :rules="[rulesValidation.required]"
                  :disabled="isEditing"
                  @update:model-value="onScopeChange"
                />
              </v-col>

              <v-col cols="12" md="6">
                <v-text-field
                  v-model.number="formData.priority"
                  label="Prioridad"
                  prepend-inner-icon="mdi-sort-numeric-ascending"
                  variant="outlined"
                  type="number"
                  hint="Mayor numero = mayor prioridad"
                  persistent-hint
                />
              </v-col>

              <v-col v-if="formData.scope === 'LOCATION'" cols="12">
                <v-select
                  v-model="formData.location_id"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  label="Sede *"
                  prepend-inner-icon="mdi-store"
                  variant="outlined"
                  :rules="[rulesValidation.required]"
                  :disabled="isEditing"
                />
              </v-col>

              <v-col v-if="formData.scope === 'CATEGORY'" cols="12">
                <v-autocomplete
                  v-model="formData.category_id"
                  :items="categories"
                  item-title="name"
                  item-value="category_id"
                  label="Categoria *"
                  prepend-inner-icon="mdi-shape"
                  variant="outlined"
                  :rules="[rulesValidation.required]"
                  :loading="loadingCategories"
                  :disabled="isEditing"
                />
              </v-col>

              <v-col v-if="formData.scope === 'PRODUCT'" cols="12">
                <v-autocomplete
                  v-model="formData.product_id"
                  :items="products"
                  item-title="name"
                  item-value="product_id"
                  label="Producto *"
                  prepend-inner-icon="mdi-package-variant"
                  variant="outlined"
                  :rules="[rulesValidation.required]"
                  :loading="loadingProducts"
                  :disabled="isEditing"
                  @update:search="searchProducts"
                />
              </v-col>

              <v-col v-if="formData.scope === 'VARIANT'" cols="12">
                <v-autocomplete
                  v-model="formData.variant_id"
                  :items="variants"
                  item-value="variant_id"
                  label="Variante *"
                  prepend-inner-icon="mdi-tag"
                  variant="outlined"
                  :rules="[rulesValidation.required]"
                  :loading="loadingVariants"
                  :disabled="isEditing"
                  @update:search="searchVariants"
                >
                  <template #item="{ props, item }">
                    <v-list-item
                      v-bind="props"
                      :title="`${item.raw.sku} - ${item.raw.variant_name || 'Default'}`"
                      :subtitle="item.raw.product?.name"
                    />
                  </template>
                  <template #selection="{ item }">
                    {{ item.raw.sku }} - {{ item.raw.variant_name || 'Default' }}
                  </template>
                </v-autocomplete>
              </v-col>

              <v-col cols="12">
                <v-divider class="my-2" />
                <div class="text-subtitle-2 mb-3">Configuracion de Precio</div>
              </v-col>

              <v-col cols="12">
                <v-select
                  v-model="formData.pricing_method"
                  :items="pricingMethods"
                  item-title="label"
                  item-value="value"
                  label="Metodo de Precio *"
                  prepend-inner-icon="mdi-calculator"
                  variant="outlined"
                  :rules="[rulesValidation.required]"
                  hint="MARKUP: automatico con margen. FIXED: manual"
                  persistent-hint
                />
              </v-col>

              <v-col v-if="formData.pricing_method === 'MARKUP'" cols="12" md="6">
                <v-text-field
                  v-model.number="formData.markup_percentage"
                  label="% Ganancia (Markup) *"
                  prepend-inner-icon="mdi-percent"
                  variant="outlined"
                  type="number"
                  min="0"
                  suffix="%"
                  :rules="[rulesValidation.required, rulesValidation.positive]"
                  hint="Porcentaje de ganancia sobre costo"
                  persistent-hint
                />
              </v-col>

              <v-col v-if="formData.pricing_method === 'MARKUP'" cols="12" md="6">
                <v-select
                  v-model="formData.price_rounding"
                  :items="roundingOptions"
                  item-title="label"
                  item-value="value"
                  label="Redondeo"
                  prepend-inner-icon="mdi-circle-outline"
                  variant="outlined"
                />
              </v-col>

              <v-col v-if="formData.pricing_method === 'MARKUP' && formData.price_rounding !== 'NONE'" cols="12">
                <v-text-field
                  v-model.number="formData.rounding_to"
                  label="Redondear a multiplo de"
                  prepend-inner-icon="mdi-numeric"
                  variant="outlined"
                  type="number"
                  min="1"
                  :rules="[rulesValidation.required, rulesValidation.positive]"
                />
              </v-col>

              <v-col cols="12">
                <v-switch v-model="formData.is_active" :label="t('common.active')" color="success" hide-details />
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false" :disabled="saving">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="save" :loading="saving">{{ t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Confirmar Eliminacion</v-card-title>
        <v-card-text>¿Esta seguro de eliminar esta politica de precio?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="deleteDialog = false" :disabled="deleting">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="doDelete" :loading="deleting">{{ t('common.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="pricingAIDialog" max-width="1100" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <div>
            <v-icon start color="deep-purple">mdi-brain</v-icon>
            Sugerencias IA de Precio
          </div>
          <v-btn
            variant="text"
            color="deep-purple"
            prepend-icon="mdi-refresh"
            :loading="loadingPricingAI"
            @click="loadPricingAI(true)"
          >
            Actualizar
          </v-btn>
        </v-card-title>
        <v-card-text>
          <v-row dense class="mb-2">
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="pricingAIConfig.targetMargin"
                label="Margen objetivo (%)"
                type="number"
                density="compact"
                variant="outlined"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="pricingAIConfig.minMargin"
                label="Margen minimo (%)"
                type="number"
                density="compact"
                variant="outlined"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="pricingAIConfig.maxItems"
                label="Maximo productos"
                type="number"
                density="compact"
                variant="outlined"
              />
            </v-col>
          </v-row>

          <v-alert v-if="loadingPricingAI" type="info" variant="tonal" class="mb-3">
            Analizando margenes, rotacion y stock...
          </v-alert>

          <template v-if="pricingAIResult && !loadingPricingAI">
            <v-row dense class="mb-3">
              <v-col cols="12" md="3">
                <v-chip color="deep-purple" variant="tonal">Sugerencias: {{ pricingAIResult.summary?.total_suggestions || 0 }}</v-chip>
              </v-col>
              <v-col cols="12" md="3">
                <v-chip color="success" variant="tonal">Subir: {{ pricingAIResult.summary?.increase_count || 0 }}</v-chip>
              </v-col>
              <v-col cols="12" md="3">
                <v-chip color="warning" variant="tonal">Bajar: {{ pricingAIResult.summary?.decrease_count || 0 }}</v-chip>
              </v-col>
              <v-col cols="12" md="3">
                <v-chip color="info" variant="tonal">Delta prom: {{ pricingAIResult.summary?.avg_delta_pct || 0 }}%</v-chip>
              </v-col>
            </v-row>

            <v-row dense class="mb-3" v-if="pricingAIResult.insights?.length">
              <v-col cols="12" md="6" v-for="(insight, idx) in pricingAIResult.insights" :key="`ins-${idx}`">
                <v-alert :type="insight.level === 'high' ? 'warning' : 'info'" variant="tonal">
                  <div class="font-weight-bold">{{ insight.title }}</div>
                  <div class="text-body-2">{{ insight.detail }}</div>
                </v-alert>
              </v-col>
            </v-row>

            <v-list lines="two" class="rounded border">
              <v-list-item v-for="item in pricingAIResult.suggestions" :key="item.variant_id">
                <template #title>
                  <div class="d-flex align-center justify-space-between" style="gap: 8px; flex-wrap: wrap;">
                    <span>{{ item.product_name }}{{ item.variant_name ? ` - ${item.variant_name}` : '' }}</span>
                    <v-chip :color="item.action === 'INCREASE' ? 'success' : 'warning'" size="small" variant="flat">
                      {{ item.action === 'INCREASE' ? 'Subir' : 'Bajar' }}
                    </v-chip>
                  </div>
                </template>
                <template #subtitle>
                  <div class="d-flex flex-wrap ga-2 mt-1">
                    <v-chip size="x-small" variant="tonal">SKU: {{ item.sku }}</v-chip>
                    <v-chip size="x-small" variant="tonal" color="primary">Costo: {{ item.current_cost }}</v-chip>
                    <v-chip size="x-small" variant="tonal" color="info">Actual: {{ item.current_price }}</v-chip>
                    <v-chip size="x-small" variant="tonal" color="deep-purple">Sugerido: {{ item.suggested_price }}</v-chip>
                    <v-chip size="x-small" variant="tonal" color="orange">Delta: {{ item.delta_pct }}%</v-chip>
                    <v-chip size="x-small" variant="tonal" color="teal">Vendidos 30d: {{ item.sold_last_30d }}</v-chip>
                    <v-chip size="x-small" variant="tonal" color="indigo">Cobertura est.: {{ item.days_of_stock_remaining ?? 'N/A' }}d</v-chip>
                  </div>
                  <div class="text-caption mt-1">{{ item.reason }}</div><div class="text-caption text-medium-emphasis">{{ item.stock_days_note }}</div>
                </template>
              </v-list-item>
            </v-list>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="pricingAIDialog = false">{{ t('common.close') }}</v-btn>
          <v-btn color="deep-purple" @click="loadPricingAI(true)" :loading="loadingPricingAI">Recalcular</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="3000">
      {{ snackbarMessage }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import ListView from '@/components/ListView.vue'
import pricingRulesService from '@/services/pricingRules.service'
import categoriesService from '@/services/categories.service'
import productsService from '@/services/products.service'
import aiPricingAdvisorService from '@/services/ai-pricing-advisor.service'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()

const rules = ref([])
const totalItems = ref(0)
const loading = ref(false)
const dialog = ref(false)
const deleteDialog = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const deleting = ref(false)
const form = ref(null)
const itemToDelete = ref(null)
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

const scopeFilter = ref(null)
const statusFilter = ref(null)

const locations = ref([])
const categories = ref([])
const products = ref([])
const variants = ref([])
const loadingCategories = ref(false)
const loadingProducts = ref(false)
const loadingVariants = ref(false)

const pricingAIDialog = ref(false)
const loadingPricingAI = ref(false)
const pricingAIResult = ref(null)
const pricingAIConfig = ref({
  targetMargin: 35,
  minMargin: 15,
  maxItems: 80
})

const statusOptions = [
  { label: 'Todos', value: null },
  { label: 'Activos', value: true },
  { label: 'Inactivos', value: false }
]

const formData = ref({
  pricing_rule_id: null,
  scope: 'TENANT',
  location_id: null,
  category_id: null,
  product_id: null,
  variant_id: null,
  pricing_method: 'MARKUP',
  markup_percentage: 20,
  price_rounding: 'NONE',
  rounding_to: 1,
  priority: 0,
  is_active: true
})

const scopeOptions = [
  { title: 'Global (Tenant)', value: 'TENANT' },
  { title: 'Por Sede', value: 'LOCATION' },
  { title: 'Por Categoria', value: 'CATEGORY' },
  { title: 'Por Producto', value: 'PRODUCT' },
  { title: 'Por Variante', value: 'VARIANT' }
]

const pricingMethods = [
  { label: 'MARKUP - Precio automatico con margen', value: 'MARKUP' },
  { label: 'FIXED - Precio manual', value: 'FIXED' }
]

const roundingOptions = [
  { label: 'Sin redondeo', value: 'NONE' },
  { label: 'Redondear hacia arriba', value: 'UP' },
  { label: 'Redondear hacia abajo', value: 'DOWN' },
  { label: 'Redondear al mas cercano', value: 'NEAREST' }
]

const rulesValidation = {
  required: (v) => (v !== null && v !== undefined && v !== '') || 'Campo requerido',
  positive: (v) => Number(v) >= 0 || 'Debe ser >= 0'
}

const getScopeLabel = (scope) => {
  const opt = scopeOptions.find((o) => o.value === scope)
  return opt ? opt.title : scope
}

const getRoundingLabel = (rounding) => {
  const opt = roundingOptions.find((o) => o.value === rounding)
  return opt ? opt.label : rounding
}

const loadRules = async ({ page, pageSize, tenantId: tid }) => {
  if (!tid) return
  loading.value = true
  try {
    const filters = { scope: scopeFilter.value, is_active: statusFilter.value }
    const r = await pricingRulesService.getPricingRules(tid, page, pageSize, filters)
    if (r.success) {
      rules.value = r.data
      totalItems.value = r.total
    } else {
      showMsg('Error al cargar politicas', 'error')
    }
  } finally {
    loading.value = false
  }
}

const applyFilters = () => {
  loadRules({ page: 1, pageSize: defaultPageSize.value, tenantId: tenantId.value })
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const r = await pricingRulesService.getLocations(tenantId.value)
  if (r.success) locations.value = r.data
}

const loadCategories = async () => {
  if (!tenantId.value) return
  loadingCategories.value = true
  const r = await categoriesService.getAllCategories(tenantId.value)
  if (r.success) categories.value = r.data
  loadingCategories.value = false
}

const searchProducts = async (search) => {
  if (!search || search.length < 2 || !tenantId.value) return
  loadingProducts.value = true
  const r = await productsService.getProducts(tenantId.value, 1, 50, search)
  if (r.success) products.value = r.data
  loadingProducts.value = false
}

const searchVariants = async (search) => {
  if (!search || search.length < 2 || !tenantId.value) return
  loadingVariants.value = true
  const r = await productsService.searchVariants(tenantId.value, search)
  if (r.success) variants.value = r.data
  loadingVariants.value = false
}

const onScopeChange = () => {
  formData.value.location_id = null
  formData.value.category_id = null
  formData.value.product_id = null
  formData.value.variant_id = null
}

const openCreateDialog = () => {
  isEditing.value = false
  formData.value = {
    pricing_rule_id: null,
    scope: 'TENANT',
    location_id: null,
    category_id: null,
    product_id: null,
    variant_id: null,
    pricing_method: 'MARKUP',
    markup_percentage: 20,
    price_rounding: 'NONE',
    rounding_to: 1,
    priority: 0,
    is_active: true
  }
  loadLocations()
  loadCategories()
  dialog.value = true
}

const openEditDialog = (item) => {
  isEditing.value = true
  formData.value = { ...item }
  loadLocations()
  loadCategories()
  dialog.value = true
}

const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid || !tenantId.value) return

  saving.value = true
  try {
    const r = isEditing.value
      ? await pricingRulesService.updatePricingRule(tenantId.value, formData.value.pricing_rule_id, formData.value)
      : await pricingRulesService.createPricingRule(tenantId.value, formData.value)

    if (r.success) {
      showMsg('Politica guardada')
      dialog.value = false
      loadRules({ page: 1, pageSize: defaultPageSize.value, tenantId: tenantId.value })
    } else {
      showMsg(r.error || 'Error al guardar', 'error')
    }
  } finally {
    saving.value = false
  }
}

const confirmDelete = (item) => {
  itemToDelete.value = item
  deleteDialog.value = true
}

const doDelete = async () => {
  if (!itemToDelete.value || !tenantId.value) return
  deleting.value = true
  try {
    const r = await pricingRulesService.deletePricingRule(tenantId.value, itemToDelete.value.pricing_rule_id)
    if (r.success) {
      showMsg('Politica eliminada')
      deleteDialog.value = false
      loadRules({ page: 1, pageSize: defaultPageSize.value, tenantId: tenantId.value })
    } else {
      showMsg(r.error, 'error')
    }
  } finally {
    deleting.value = false
  }
}

const openPricingAIDialog = async () => {
  pricingAIDialog.value = true
  await loadPricingAI(false)
}

const loadPricingAI = async (forceRefresh = false) => {
  if (!tenantId.value || !aiPricingAdvisorService.isAvailable()) return

  loadingPricingAI.value = true
  try {
    const result = await aiPricingAdvisorService.getPricingSuggestions(tenantId.value, {
      targetMargin: pricingAIConfig.value.targetMargin,
      minMargin: pricingAIConfig.value.minMargin,
      maxItems: pricingAIConfig.value.maxItems,
      forceRefresh
    })
    pricingAIResult.value = result
  } catch (error) {
    showMsg(`Error generando sugerencias IA: ${error.message}`, 'error')
  } finally {
    loadingPricingAI.value = false
  }
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = msg
  snackbarColor.value = color
  snackbar.value = true
}

onMounted(async () => {
  await loadSettings()
  await loadLocations()
})
</script>




