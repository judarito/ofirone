<template>
  <v-dialog :model-value="modelValue" max-width="760" scrollable @update:model-value="handleDialogToggle">
    <v-card class="product-wizard">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="primary">mdi-map-marker-path</v-icon>
        {{ isEditMode ? 'Editar Producto Guiado' : 'Crear Producto Guiado' }}
      </v-card-title>

      <v-card-subtitle class="pb-0">
        {{ isEditMode
          ? 'Mantenemos la misma guía del alta para que editar no se sienta como otro sistema distinto.'
          : 'Menos decisiones técnicas al inicio. Primero definimos qué tipo de producto estás creando y luego te pedimos solo lo mínimo.' }}
      </v-card-subtitle>

      <v-card-text>
        <div class="d-flex flex-wrap ga-2 mb-4">
          <v-chip
            v-for="wizardStep in wizardSteps"
            :key="wizardStep.value"
            :color="step >= wizardStep.value ? 'primary' : 'grey'"
            :variant="step === wizardStep.value ? 'flat' : 'tonal'"
            size="small"
          >
            {{ wizardStep.value }}. {{ wizardStep.label }}
          </v-chip>
        </div>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <v-window v-model="step">
          <v-window-item :value="1">
            <div class="text-subtitle-1 font-weight-bold mb-3">Datos básicos</div>
            <v-row>
              <v-col cols="12" sm="8">
                <v-text-field
                  v-model="formData.name"
                  label="Nombre del producto"
                  prepend-inner-icon="mdi-text"
                  variant="outlined"
                  :rules="[rules.required]"
                  hint="Ej: Camiseta básica, Tela antifluido, Servicio de confección"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="formData.category_id"
                  :items="categories"
                  item-title="name"
                  item-value="category_id"
                  label="Categoría"
                  prepend-inner-icon="mdi-shape"
                  variant="outlined"
                  clearable
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-autocomplete
                  v-model="formData.unit_id"
                  :items="units"
                  item-title="display_name"
                  item-value="unit_id"
                  label="Unidad de medida"
                  prepend-inner-icon="mdi-ruler"
                  variant="outlined"
                  clearable
                />
              </v-col>
              <v-col cols="12">
                <v-textarea
                  v-model="formData.description"
                  label="Descripción"
                  prepend-inner-icon="mdi-text-long"
                  variant="outlined"
                  rows="2"
                  auto-grow
                />
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item :value="2">
            <div class="text-subtitle-1 font-weight-bold mb-2">{{ isEditMode ? '¿Qué estás editando?' : '¿Qué vas a crear?' }}</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              Escoge el uso principal. El wizard deduce automáticamente si lleva una sola variante, si sirve como componente y cómo se comporta en inventario.
            </div>

            <v-row>
              <v-col
                v-for="profile in profiles"
                :key="profile.id"
                cols="12"
                sm="6"
              >
                <v-card
                  class="profile-card h-100"
                  :class="{ 'profile-card--active': formData.product_profile === profile.id }"
                  variant="outlined"
                  @click="selectProfile(profile.id)"
                >
                  <v-card-text>
                    <div class="d-flex align-center ga-2 mb-2">
                      <v-icon :color="formData.product_profile === profile.id ? 'primary' : 'grey'">
                        {{ profile.icon }}
                      </v-icon>
                      <div class="text-subtitle-2 font-weight-bold">{{ profile.title }}</div>
                    </div>
                    <div class="text-body-2 text-medium-emphasis">{{ profile.description }}</div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>

            <v-alert type="info" variant="tonal" class="mt-4">
              <template #text>
                <strong>Selección actual:</strong> {{ selectedProfile.title }}.
                {{ profileSummary }}
              </template>
            </v-alert>
          </v-window-item>

          <v-window-item :value="3">
            <div class="text-subtitle-1 font-weight-bold mb-2">{{ isEditMode ? 'Configuración actual' : 'Configuración mínima' }}</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              {{ isEditMode
                ? 'Ajusta lo esencial sin salirte del flujo guiado. Lo más especializado queda como complemento.'
                : 'Solo pedimos lo necesario para dejar el producto creado con una base operativa clara.' }}
            </div>

            <v-row v-if="shouldCreateSeedVariant">
              <v-col cols="12">
                <v-alert type="info" variant="tonal" class="mb-2">
                  El producto se creará primero y luego le agregaremos su primera variante para que no quede incompleto.
                </v-alert>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.seed_variant_name"
                  label="Nombre de la primera variante"
                  prepend-inner-icon="mdi-tag-outline"
                  variant="outlined"
                  hint="Ej: Azul M, Negra 38, 500 ml"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.seed_variant_sku"
                  label="SKU inicial (opcional)"
                  prepend-inner-icon="mdi-barcode"
                  variant="outlined"
                  hint="Si lo dejas vacío, lo generamos automáticamente"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.seed_variant_cost"
                  label="Costo"
                  prepend-inner-icon="mdi-cash-minus"
                  variant="outlined"
                  type="number"
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.seed_variant_price"
                  label="Precio"
                  prepend-inner-icon="mdi-cash-plus"
                  variant="outlined"
                  type="number"
                />
              </v-col>
              <v-col v-if="tracksInventory" cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.seed_variant_min_stock"
                  label="Alerta mínima de stock"
                  prepend-inner-icon="mdi-alert-outline"
                  variant="outlined"
                  type="number"
                  hint="0 = sin alerta mínima. El inventario se sigue controlando para este perfil."
                  persistent-hint
                />
              </v-col>
            </v-row>

            <v-row v-else-if="previewDraft.variant_mode === 'single'">
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.base_cost"
                  label="Costo base"
                  prepend-inner-icon="mdi-cash-minus"
                  variant="outlined"
                  type="number"
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.base_price"
                  label="Precio base"
                  prepend-inner-icon="mdi-cash-plus"
                  variant="outlined"
                  type="number"
                />
              </v-col>
              <v-col v-if="tracksInventory" cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.base_min_stock"
                  label="Alerta mínima de stock"
                  prepend-inner-icon="mdi-alert-outline"
                  variant="outlined"
                  type="number"
                  hint="0 = sin alerta mínima. El inventario se sigue controlando para este perfil."
                  persistent-hint
                />
              </v-col>
            </v-row>
            <v-alert
              v-else
              type="info"
              variant="tonal"
              class="mb-3"
            >
              <template #text>
                Este producto maneja varias variantes. Los precios, SKUs y alertas mínimas se ajustan desde cada variante.
              </template>
            </v-alert>

            <v-card variant="tonal" color="primary" class="mt-2">
              <v-card-text class="text-body-2">
                <div><strong>Resumen:</strong> {{ selectedProfile.title }}</div>
                <div>Variantes: {{ shouldCreateSeedVariant ? 'Con primera variante guiada' : (previewDraft.variant_mode === 'multiple' ? 'Múltiples variantes existentes' : 'Variante única predeterminada') }}</div>
                <div>Inventario: {{ tracksInventory ? 'Controlado' : 'No aplica' }}</div>
                <div v-if="tracksInventory">Alerta mínima: {{ minimumAlertSummary }}</div>
                <div v-if="previewDraft.is_component">Uso: Se utilizará como componente de otros productos</div>
                <div>Comportamiento: {{ behaviorLabel }}</div>
              </v-card-text>
            </v-card>

            <div class="d-flex justify-end mt-3">
              <v-btn
                variant="text"
                color="secondary"
                :prepend-icon="showAdvancedOptions ? 'mdi-chevron-up' : 'mdi-tune-variant'"
                @click="showAdvancedOptions = !showAdvancedOptions"
              >
                {{ showAdvancedOptions ? 'Ocultar ajustes especiales' : 'Necesito una configuración especial' }}
              </v-btn>
            </div>

            <v-expand-transition>
              <v-card v-if="showAdvancedOptions" variant="outlined" class="mt-2">
                <v-card-text>
                  <div class="text-subtitle-2 font-weight-bold mb-1">Opciones avanzadas</div>
                  <div class="text-body-2 text-medium-emphasis mb-4">
                    Úsalas solo si necesitas salirte del perfil elegido. Aquí puedes sobreescribir las decisiones automáticas del wizard.
                  </div>

                  <v-row>
                    <v-col cols="12" sm="6">
                      <div class="text-caption font-weight-bold mb-2">Presentación del producto</div>
                      <v-btn-toggle v-model="formData.variant_mode" mandatory color="primary" class="w-100">
                        <v-btn value="single" class="flex-1">Variante única</v-btn>
                        <v-btn value="multiple" class="flex-1">Con variantes</v-btn>
                      </v-btn-toggle>
                    </v-col>
                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="formData.inventory_behavior"
                        :items="inventoryBehaviorOptions"
                        item-title="title"
                        item-value="value"
                        label="Comportamiento de inventario"
                        prepend-inner-icon="mdi-cube-outline"
                        variant="outlined"
                      />
                    </v-col>
                    <v-col v-if="formData.inventory_behavior === 'MANUFACTURED'" cols="12" sm="6">
                      <v-select
                        v-model="formData.production_type"
                        :items="productionTypeOptions"
                        item-title="title"
                        item-value="value"
                        label="Tipo de producción"
                        prepend-inner-icon="mdi-factory"
                        variant="outlined"
                      />
                    </v-col>
                    <v-col v-if="canToggleInventory" cols="12" sm="6">
                      <v-switch
                        v-model="formData.track_inventory"
                        label="Controlar inventario"
                        color="info"
                        inset
                      />
                    </v-col>
                    <v-col v-if="formData.inventory_behavior === 'RESELL'" cols="12" sm="6">
                      <v-switch
                        v-model="formData.is_component"
                        label="Es componente de otros productos"
                        color="purple"
                        inset
                      />
                    </v-col>
                    <v-col v-if="canControlExpiration" cols="12" sm="6">
                      <v-switch
                        v-model="formData.requires_expiration"
                        label="Requiere control de vencimiento"
                        color="warning"
                        inset
                      />
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>
            </v-expand-transition>

            <div v-if="isEditMode" class="mt-4">
              <slot
                name="supplementary"
                :draft="previewDraft"
                :product="initialProduct"
                :form-data="formData"
                :tracks-inventory="tracksInventory"
                :behavior-label="behaviorLabel"
              />
            </div>

          </v-window-item>
        </v-window>
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" @click="emitClose">Cancelar</v-btn>
        <v-spacer />
        <v-btn v-if="step > 1" variant="text" @click="step -= 1">Atrás</v-btn>
        <v-btn v-if="step < 3" color="primary" variant="tonal" @click="goNext">Continuar</v-btn>
        <v-btn v-else color="primary" :loading="saving" @click="submit">
          {{ isEditMode ? 'Guardar cambios' : 'Crear producto' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import productsService from '@/services/products.service'
import { humanizeAppError } from '@/utils/appErrors'
import {
  PRODUCT_CREATION_PROFILES,
  applyProductCreationProfile,
  buildProductDraftFromProduct,
  buildProductPayloadForSave,
  buildSeedVariantPayload,
  getProductCreationProfile,
  sanitizeProductDraft,
  shouldAllowExpirationControl,
  shouldAskSeedVariant,
  shouldTrackInventoryForDraft,
} from '../../../shared/utils/productCreationWizard'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  tenantId: { type: String, default: '' },
  categories: { type: Array, default: () => [] },
  units: { type: Array, default: () => [] },
  defaultProfileId: { type: String, default: 'sale_simple' },
  mode: { type: String, default: 'create' },
  initialProduct: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const productionTypeOptions = [
  { value: 'ON_DEMAND', title: 'Bajo demanda' },
  { value: 'TO_STOCK', title: 'Para stock' },
]

const inventoryBehaviorOptions = [
  { value: 'RESELL', title: 'Reventa' },
  { value: 'MANUFACTURED', title: 'Manufacturado' },
  { value: 'BUNDLE', title: 'Combo / Bundle' },
  { value: 'SERVICE', title: 'Servicio' },
]

const rules = {
  required: (value) => Boolean(String(value || '').trim()) || 'Campo requerido',
}

const profileIcons = {
  sale_simple: 'mdi-package-variant-closed',
  sale_variants: 'mdi-shape-plus',
  component: 'mdi-cog-outline',
  manufactured: 'mdi-factory',
  bundle: 'mdi-package-variant-closed-plus',
  service: 'mdi-hand-extended-outline',
}

const buildInitialForm = (profileId = 'sale_simple') => applyProductCreationProfile({
  name: '',
  description: '',
  category_id: null,
  unit_id: null,
  is_active: true,
  base_cost: 0,
  base_price: 0,
  base_min_stock: 0,
  requires_expiration: false,
  seed_variant_name: '',
  seed_variant_sku: '',
  seed_variant_cost: 0,
  seed_variant_price: 0,
  seed_variant_min_stock: 0,
}, profileId)
const buildFormFromProps = () => (
  props.mode === 'edit' && props.initialProduct
    ? buildProductDraftFromProduct(props.initialProduct)
    : buildInitialForm(props.defaultProfileId)
)

const step = ref(1)
const saving = ref(false)
const errorMessage = ref('')
const showAdvancedOptions = ref(false)
const formData = ref(buildFormFromProps())

const wizardSteps = [
  { value: 1, label: 'Básicos' },
  { value: 2, label: 'Tipo' },
  { value: 3, label: 'Configurar' },
]

const profiles = PRODUCT_CREATION_PROFILES.map((profile) => ({
  ...profile,
  icon: profileIcons[profile.id] || 'mdi-package-variant',
}))

const isEditMode = computed(() => props.mode === 'edit')
const previewDraft = computed(() => sanitizeProductDraft(formData.value))
const selectedProfile = computed(() => getProductCreationProfile(formData.value.product_profile))
const needsSeedVariant = computed(() => shouldAskSeedVariant(formData.value))
const shouldCreateSeedVariant = computed(() => !isEditMode.value && needsSeedVariant.value)
const tracksInventory = computed(() => shouldTrackInventoryForDraft(formData.value))
const canControlExpiration = computed(() => shouldAllowExpirationControl(formData.value))
const canToggleInventory = computed(() => (
  formData.value.inventory_behavior === 'RESELL' || formData.value.inventory_behavior === 'MANUFACTURED'
))
const behaviorLabel = computed(() => (
  inventoryBehaviorOptions.find((option) => option.value === formData.value.inventory_behavior)?.title || 'Reventa'
))
const minimumAlertSummary = computed(() => {
  if (!tracksInventory.value) return 'No aplica'
  if (previewDraft.value.variant_mode === 'multiple' && !shouldCreateSeedVariant.value) {
    return 'Se gestiona por variante'
  }
  const threshold = shouldCreateSeedVariant.value
    ? Number(previewDraft.value.seed_variant_min_stock || 0)
    : Number(previewDraft.value.base_min_stock || 0)
  return threshold > 0 ? `Activa desde ${threshold}` : 'Sin alerta mínima'
})
const profileSummary = computed(() => {
  if (selectedProfile.value.id === 'sale_variants') {
    return 'Crearemos el producto y su primera variante inicial.'
  }
  if (selectedProfile.value.id === 'component') {
    return 'Se guardará como insumo físico para uso en manufactura.'
  }
  if (selectedProfile.value.id === 'manufactured') {
    return 'Quedará listo como producto fabricado y luego podrás configurar su BOM.'
  }
  if (selectedProfile.value.id === 'bundle') {
    return 'Se guardará como combo comercial sin stock directo.'
  }
  if (selectedProfile.value.id === 'service') {
    return 'No manejará stock ni vencimiento.'
  }
  return 'Se creará con una variante predeterminada y configuración de venta simple.'
})

const resetWizard = () => {
  step.value = 1
  saving.value = false
  errorMessage.value = ''
  showAdvancedOptions.value = false
  formData.value = buildFormFromProps()
}

watch(
  () => [props.modelValue, props.initialProduct, props.defaultProfileId, props.mode],
  (state) => {
    if (state[0]) resetWizard()
  },
)

const emitClose = () => {
  emit('update:modelValue', false)
}

const handleDialogToggle = (value) => {
  emit('update:modelValue', value)
}

const selectProfile = (profileId) => {
  formData.value = applyProductCreationProfile(formData.value, profileId)
}

const goNext = () => {
  errorMessage.value = ''
  if (step.value === 1 && !String(formData.value.name || '').trim()) {
    errorMessage.value = 'El nombre del producto es obligatorio.'
    return
  }
  if (step.value < 3) step.value += 1
}

const submit = async () => {
  errorMessage.value = ''
  if (!props.tenantId) {
    errorMessage.value = 'No hay tenant activo para crear el producto.'
    return
  }

  const payload = buildProductPayloadForSave(formData.value)
  if (!payload.name) {
    errorMessage.value = 'El nombre del producto es obligatorio.'
    step.value = 1
    return
  }

  saving.value = true
  try {
    let savedProductId = props.initialProduct?.product_id || formData.value.product_id
    let fallbackProduct = props.initialProduct
    let message = 'Producto actualizado correctamente.'
    let color = 'success'

    if (isEditMode.value) {
      const updated = await productsService.updateProduct(
        props.tenantId,
        props.initialProduct?.product_id || formData.value.product_id,
        payload,
      )
      if (!updated.success) {
        errorMessage.value = humanizeAppError(updated.error, { defaultMessage: 'No se pudo actualizar el producto.' })
        return
      }
    } else {
      const created = await productsService.createProduct(props.tenantId, payload)
      if (!created.success) {
        errorMessage.value = humanizeAppError(created.error, { defaultMessage: 'No se pudo crear el producto.' })
        return
      }

      savedProductId = created.data.product_id
      fallbackProduct = created.data
      message = shouldCreateSeedVariant.value
        ? 'Producto creado con su primera variante.'
        : 'Producto creado correctamente.'

      if (shouldCreateSeedVariant.value) {
        const firstVariant = buildSeedVariantPayload(formData.value)
        const defaultVariant = Array.isArray(created.data?.product_variants)
          ? created.data.product_variants[0]
          : null
        const variantResult = defaultVariant?.variant_id
          ? await productsService.updateVariant(props.tenantId, defaultVariant.variant_id, firstVariant)
          : await productsService.createVariant(props.tenantId, {
              ...firstVariant,
              product_id: created.data.product_id,
            })

        if (!variantResult.success) {
          message = 'Producto creado, pero no se pudo crear la primera variante. Revísalo desde edición.'
          color = 'warning'
        }
      }
    }

    const productResult = await productsService.getProductById(props.tenantId, savedProductId)
    emit('saved', {
      product: productResult.success ? productResult.data : fallbackProduct,
      message,
      color,
    })
    emitClose()
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.product-wizard :deep(.v-field) {
  border-radius: 12px;
}

.profile-card {
  cursor: pointer;
  border-radius: 18px;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.profile-card:hover {
  transform: translateY(-1px);
}

.profile-card--active {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.18);
}
</style>
