<template>
  <div>
    <!-- Filtros -->
    <v-card flat class="mb-3">
      <v-card-text class="pa-2">
        <v-row dense>
          <v-col cols="12" md="3">
            <v-select
              v-model="scopeFilter"
              :items="scopeOptions"
              label="Alcance"
              density="compact"
              variant="outlined"
              clearable
              hide-details
              @update:model-value="applyFilters"
            ></v-select>
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="taxFilter"
              :items="availableTaxes"
              item-title="name"
              item-value="tax_id"
              label="Impuesto"
              density="compact"
              variant="outlined"
              clearable
              hide-details
              @update:model-value="applyFilters"
            ></v-select>
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="statusFilter"
              :items="[{label: 'Todos', value: null}, {label: 'Activos', value: true}, {label: 'Inactivos', value: false}]"
              item-title="label"
              item-value="value"
              label="Estado"
              density="compact"
              variant="outlined"
              hide-details
              @update:model-value="applyFilters"
            ></v-select>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <ListView
      title="Reglas de Impuestos"
      icon="mdi-file-tree"
      :items="rules"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="tax_rule_id"
      title-field="scope"
      avatar-icon="mdi-gavel"
      avatar-color="purple"
      empty-message="No hay reglas de impuestos configuradas"
      create-button-text="Nueva Regla"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="confirmDelete"
      @load-page="loadRules"
      @search="loadRules"
    >
      <template #title="{ item }">
        {{ getScopeLabel(item.scope) }} — {{ item.tax?.name }} ({{ (item.tax?.rate * 100).toFixed(2) }}%)
      </template>
      <template #subtitle="{ item }">
        <span v-if="item.scope === 'TENANT'">Aplica a todo el tenant</span>
        <span v-else-if="item.scope === 'CATEGORY'">Categoría: {{ item.category?.name }}</span>
        <span v-else-if="item.scope === 'PRODUCT'">Producto: {{ item.product?.name }}</span>
        <span v-else-if="item.scope === 'VARIANT'">Variante: {{ item.variant?.sku }} — {{ item.variant?.variant_name }}</span>
      </template>
      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip :color="item.is_active ? 'success' : 'error'" size="small" variant="flat">
            {{ item.is_active ? 'Activo' : 'Inactivo' }}
          </v-chip>
          <v-chip size="small" variant="tonal" color="info">
            Prioridad: {{ item.priority }}
          </v-chip>
          <v-chip v-if="!item.tax?.is_active" size="small" variant="tonal" color="warning">
            Impuesto Inactivo
          </v-chip>
        </div>
      </template>
    </ListView>

    <!-- Dialog: Crear/Editar -->
    <v-dialog v-model="dialog" max-width="600" persistent>
      <v-card>
        <v-card-title>
          <v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
          {{ isEditing ? 'Editar Regla' : 'Nueva Regla de Impuesto' }}
        </v-card-title>
        <v-card-text>
          <v-form ref="form">
            <v-row>
              <!-- Impuesto -->
              <v-col cols="12">
                <v-select
                  v-model="formData.tax_id"
                  :items="availableTaxes"
                  item-title="name"
                  item-value="tax_id"
                  label="Impuesto *"
                  prepend-inner-icon="mdi-percent"
                  variant="outlined"
                  :rules="[rules.required]"
                  :disabled="isEditing"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props" :subtitle="`${item.raw.code} - ${(item.raw.rate * 100).toFixed(2)}%`"></v-list-item>
                  </template>
                </v-select>
              </v-col>

              <!-- Alcance -->
              <v-col cols="12" md="6">
                <v-select
                  v-model="formData.scope"
                  :items="scopeOptions"
                  label="Alcance *"
                  prepend-inner-icon="mdi-target"
                  variant="outlined"
                  :rules="[rules.required]"
                  :disabled="isEditing"
                  @update:model-value="onScopeChange"
                ></v-select>
              </v-col>

              <!-- Prioridad -->
              <v-col cols="12" md="6">
                <v-text-field
                  v-model.number="formData.priority"
                  label="Prioridad"
                  prepend-inner-icon="mdi-sort-numeric-ascending"
                  variant="outlined"
                  type="number"
                  hint="Mayor número = mayor prioridad"
                  persistent-hint
                ></v-text-field>
              </v-col>

              <!-- Categoría (si aplica) -->
              <v-col v-if="formData.scope === 'CATEGORY'" cols="12">
                <v-autocomplete
                  v-model="formData.category_id"
                  :items="categories"
                  item-title="name"
                  item-value="category_id"
                  label="Categoría *"
                  prepend-inner-icon="mdi-shape"
                  variant="outlined"
                  :rules="[rules.required]"
                  :loading="loadingCategories"
                  :disabled="isEditing"
                ></v-autocomplete>
              </v-col>

              <!-- Producto (si aplica) -->
              <v-col v-if="formData.scope === 'PRODUCT'" cols="12">
                <v-autocomplete
                  v-model="formData.product_id"
                  :items="products"
                  item-title="name"
                  item-value="product_id"
                  label="Producto *"
                  prepend-inner-icon="mdi-package-variant"
                  variant="outlined"
                  :rules="[rules_validation.required]"
                  :loading="loadingProducts"
                  :disabled="isEditing"
                  @update:search="searchProducts"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props" :title="item.raw.name" :subtitle="item.raw.category?.name || 'Sin categoría'"></v-list-item>
                  </template>
                </v-autocomplete>
              </v-col>

              <!-- Variante (si aplica) -->
              <v-col v-if="formData.scope === 'VARIANT'" cols="12">
                <v-autocomplete
                  v-model="formData.variant_id"
                  :items="variants"
                  item-value="variant_id"
                  label="Variante *"
                  prepend-inner-icon="mdi-tag"
                  variant="outlined"
                  :rules="[rules_validation.required]"
                  :loading="loadingVariants"
                  :disabled="isEditing"
                  @update:search="searchVariants"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props" :title="`${item.raw.sku} - ${item.raw.variant_name || 'Sin nombre'}`" :subtitle="item.raw.product?.name"></v-list-item>
                  </template>
                  <template #selection="{ item }">
                    {{ item.raw.sku }} - {{ item.raw.variant_name || 'Sin nombre' }}
                  </template>
                </v-autocomplete>
              </v-col>

              <!-- Estado -->
              <v-col cols="12">
                <v-switch
                  v-model="formData.is_active"
                  label="Regla activa"
                  color="success"
                  hide-details
                ></v-switch>
              </v-col>
            </v-row>
          </v-form>

          <!-- Info -->
          <v-alert v-if="formData.scope" type="info" variant="tonal" density="compact" class="mt-3">
            <div class="text-caption">
              <strong>Nivel de prioridad:</strong><br>
              VARIANT (más específico) > PRODUCT > CATEGORY > TENANT (por defecto)
            </div>
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="closeDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">
            {{ isEditing ? 'Actualizar' : 'Crear' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog: Confirmar eliminación -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title><v-icon start color="warning">mdi-alert</v-icon>Eliminar Regla</v-card-title>
        <v-card-text>¿Eliminar esta regla de impuesto? Esta acción no se puede deshacer.</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" :loading="deleting" @click="deleteItem">{{ t('common.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import ListView from '@/components/ListView.vue'
import taxRulesService from '@/services/taxRules.service'
import taxesService from '@/services/taxes.service'
import categoriesService from '@/services/categories.service'
import productsService from '@/services/products.service'
import supabaseService from '@/services/supabase.service'
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
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

const form = ref(null)
const itemToDelete = ref(null)

// Filtros
const scopeFilter = ref(null)
const taxFilter = ref(null)
const statusFilter = ref(null)

// Datos para formulario
const availableTaxes = ref([])
const categories = ref([])
const products = ref([])
const variants = ref([])
const loadingCategories = ref(false)
const loadingProducts = ref(false)
const loadingVariants = ref(false)

const scopeOptions = [
  { title: 'Tenant (Por defecto)', value: 'TENANT' },
  { title: 'Categoría', value: 'CATEGORY' },
  { title: 'Producto', value: 'PRODUCT' },
  { title: 'Variante', value: 'VARIANT' }
]

const formData = ref({
  tax_rule_id: null,
  tax_id: null,
  scope: 'TENANT',
  category_id: null,
  product_id: null,
  variant_id: null,
  priority: 0,
  is_active: true
})

const rules_validation = {
  required: v => !!v || 'Campo requerido'
}

const getScopeLabel = (scope) => {
  const labels = {
    'TENANT': 'Por Defecto',
    'CATEGORY': 'Categoría',
    'PRODUCT': 'Producto',
    'VARIANT': 'Variante'
  }
  return labels[scope] || scope
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = msg
  snackbarColor.value = color
  snackbar.value = true
}

const loadRules = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loading.value = true
  try {
    const filters = {}
    if (scopeFilter.value) filters.scope = scopeFilter.value
    if (taxFilter.value) filters.tax_id = taxFilter.value
    if (statusFilter.value !== null) filters.is_active = statusFilter.value

    const r = await taxRulesService.getAllRules(tid, page, pageSize, filters)
    if (r.success) {
      rules.value = r.data
      totalItems.value = r.total
    } else {
      showMsg('Error al cargar reglas', 'error')
    }
  } finally {
    loading.value = false
  }
}

const applyFilters = () => {
  loadRules({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
}

const loadTaxes = async () => {
  const r = await taxesService.getAllTaxes(tenantId.value)
  if (r.success) availableTaxes.value = r.data
}

const loadCategories = async () => {
  loadingCategories.value = true
  try {
    const r = await categoriesService.getAllCategories(tenantId.value)
    if (r.success) categories.value = r.data
  } finally {
    loadingCategories.value = false
  }
}

let productSearchTimeout = null
const searchProducts = async (search) => {
  if (!search || search.length < 2) return
  clearTimeout(productSearchTimeout)
  productSearchTimeout = setTimeout(async () => {
    loadingProducts.value = true
    try {
      const r = await productsService.getProducts(tenantId.value, 1, 20, search)
      if (r.success) products.value = r.data
    } finally {
      loadingProducts.value = false
    }
  }, 300)
}

let variantSearchTimeout = null
const searchVariants = async (search) => {
  if (!search || search.length < 2) return
  clearTimeout(variantSearchTimeout)
  variantSearchTimeout = setTimeout(async () => {
    loadingVariants.value = true
    try {
      const r = await productsService.searchVariants(tenantId.value, search, 20)
      if (r.success) variants.value = r.data
    } finally {
      loadingVariants.value = false
    }
  }, 300)
}

const onScopeChange = () => {
  formData.value.category_id = null
  formData.value.product_id = null
  formData.value.variant_id = null

  if (formData.value.scope === 'CATEGORY') {
    loadCategories()
  } else if (formData.value.scope === 'PRODUCT') {
    loadInitialProducts()
  } else if (formData.value.scope === 'VARIANT') {
    loadInitialVariants()
  }
}

const loadInitialProducts = async () => {
  loadingProducts.value = true
  try {
    const { data, error } = await supabaseService.client
      .from('products')
      .select(`
        product_id,
        name,
        is_active,
        category:category_id(category_id, name)
      `)
      .eq('tenant_id', tenantId.value)
      .eq('is_active', true)
      .limit(50)

    if (error) throw error
    products.value = data || []
  } catch (error) {
    console.error('Error cargando productos:', error)
    showMsg('Error al cargar productos', 'error')
  } finally {
    loadingProducts.value = false
  }
}

const loadInitialVariants = async () => {
  loadingVariants.value = true
  try {
    const { data, error } = await supabaseService.client
      .from('product_variants')
      .select(`
        variant_id,
        sku,
        variant_name,
        cost,
        price,
        is_active,
        product:product_id(product_id, name)
      `)
      .eq('tenant_id', tenantId.value)
      .eq('is_active', true)
      .limit(50)

    if (error) throw error
    variants.value = data || []
  } catch (error) {
    console.error('Error cargando variantes:', error)
    showMsg('Error al cargar variantes', 'error')
  } finally {
    loadingVariants.value = false
  }
}

const openCreateDialog = () => {
  isEditing.value = false
  formData.value = {
    tax_rule_id: null,
    tax_id: null,
    scope: 'TENANT',
    category_id: null,
    product_id: null,
    variant_id: null,
    priority: 0,
    is_active: true
  }
  dialog.value = true
}

const openEditDialog = (item) => {
  isEditing.value = true
  formData.value = {
    tax_rule_id: item.tax_rule_id,
    tax_id: item.tax_id,
    scope: item.scope,
    category_id: item.category_id,
    product_id: item.product_id,
    variant_id: item.variant_id,
    priority: item.priority,
    is_active: item.is_active
  }
  
  // Pre-cargar datos según el scope
  if (item.scope === 'CATEGORY') {
    loadCategories()
  } else if (item.scope === 'PRODUCT' && item.product) {
    products.value = [item.product]
  } else if (item.scope === 'VARIANT' && item.variant) {
    variants.value = [item.variant]
  }
  
  dialog.value = true
}

const closeDialog = () => {
  dialog.value = false
  form.value?.reset()
}

const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid) return

  saving.value = true
  try {
    const r = isEditing.value
      ? await taxRulesService.updateRule(tenantId.value, formData.value.tax_rule_id, formData.value)
      : await taxRulesService.createRule(tenantId.value, formData.value)

    if (r.success) {
      showMsg(isEditing.value ? 'Regla actualizada' : 'Regla creada')
      closeDialog()
      loadRules({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
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

const deleteItem = async () => {
  deleting.value = true
  try {
    const r = await taxRulesService.deleteRule(tenantId.value, itemToDelete.value.tax_rule_id)
    if (r.success) {
      showMsg('Regla eliminada')
      deleteDialog.value = false
      loadRules({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
    } else {
      showMsg(r.error || 'Error al eliminar', 'error')
    }
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  await loadSettings()
  loadTaxes()
})
</script>
