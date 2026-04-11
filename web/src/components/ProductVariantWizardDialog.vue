<template>
  <v-dialog :model-value="modelValue" max-width="680" scrollable @update:model-value="emitToggle">
    <v-card class="variant-wizard">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="primary">mdi-shape-plus</v-icon>
        {{ isEditing ? 'Editar Variante Guiada' : 'Crear Variante Guiada' }}
      </v-card-title>

      <v-card-subtitle class="pb-0">
        La variante sigue el mismo lenguaje del producto: identidad, precio y control operativo sin ruido innecesario.
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
            <div class="text-subtitle-1 font-weight-bold mb-2">Identidad de la variante</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              Define cómo reconocerás esta variante dentro del producto <strong>{{ product?.name || 'actual' }}</strong>.
            </div>

            <div class="d-flex ga-2 align-end mb-2">
              <v-text-field
                v-model="formData.sku"
                label="SKU"
                prepend-inner-icon="mdi-barcode"
                variant="outlined"
                :rules="[rules.required]"
                hint="Código único para ventas, compras e inventario"
                persistent-hint
                style="flex: 1"
              />
              <v-tooltip text="Generar SKU automático" location="top">
                <template #activator="{ props: tooltipProps }">
                  <v-btn
                    v-bind="tooltipProps"
                    icon="mdi-auto-fix"
                    color="primary"
                    variant="tonal"
                    @click="autoGenerateSku"
                    :disabled="!product?.name"
                  />
                </template>
              </v-tooltip>
            </div>

            <v-text-field
              v-model="formData.variant_name"
              label="Nombre de la variante"
              prepend-inner-icon="mdi-tag-outline"
              variant="outlined"
              hint="Ej: Azul M, 500 ml, Caja x12"
              persistent-hint
            />
          </v-window-item>

          <v-window-item :value="2">
            <div class="text-subtitle-1 font-weight-bold mb-2">Precio y costo</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              Lo mínimo para que esta variante quede lista para operación.
            </div>

            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model.number="formData.cost"
                  label="Costo"
                  prepend-inner-icon="mdi-cash-minus"
                  variant="outlined"
                  type="number"
                  :rules="[rules.required, rules.positive]"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model.number="formData.price"
                  label="Precio"
                  prepend-inner-icon="mdi-cash-plus"
                  variant="outlined"
                  type="number"
                  :rules="[rules.required, rules.positive]"
                />
              </v-col>
              <v-col cols="12">
                <v-switch
                  v-model="formData.price_includes_tax"
                  label="El precio ya incluye impuesto"
                  color="primary"
                  inset
                />
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item :value="3">
            <div class="text-subtitle-1 font-weight-bold mb-2">Control operativo</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              Solo mostramos lo que realmente aplica según la configuración del producto.
            </div>

            <v-alert
              v-if="!canTrackInventory"
              type="info"
              variant="tonal"
              class="mb-3"
            >
              Este producto no controla inventario en este momento, así que la variante no necesita alerta mínima ni sobreventa.
            </v-alert>

            <v-row>
              <v-col v-if="canTrackInventory" cols="12" sm="6">
                <v-text-field
                  v-model.number="formData.min_stock"
                  label="Alerta mínima de stock"
                  prepend-inner-icon="mdi-alert-outline"
                  variant="outlined"
                  type="number"
                  hint="0 = sin alerta mínima"
                  persistent-hint
                />
              </v-col>
              <v-col v-if="canTrackInventory" cols="12" sm="6">
                <v-switch
                  v-model="formData.allow_backorder"
                  label="Permitir sobreventa"
                  color="warning"
                  inset
                />
              </v-col>
              <v-col v-if="canRequireExpiration" cols="12" sm="6">
                <v-select
                  v-model="formData.requires_expiration"
                  :items="expirationOptions"
                  item-title="title"
                  item-value="value"
                  label="Control de vencimiento"
                  prepend-inner-icon="mdi-calendar-clock"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-switch
                  v-model="formData.is_active"
                  label="Variante activa"
                  color="success"
                  inset
                />
              </v-col>
            </v-row>

            <v-card variant="tonal" color="primary" class="mt-2">
              <v-card-text class="text-body-2">
                <div><strong>Resumen:</strong> {{ formData.variant_name || 'Variante sin nombre específico' }}</div>
                <div>SKU: {{ formData.sku || 'Pendiente' }}</div>
                <div>Inventario: {{ canTrackInventory ? 'Controlado' : 'No aplica' }}</div>
                <div v-if="canTrackInventory">Alerta mínima: {{ minimumAlertSummary }}</div>
                <div>Estado: {{ formData.is_active ? 'Activa' : 'Inactiva' }}</div>
              </v-card-text>
            </v-card>

            <div class="d-flex justify-end mt-3">
              <v-btn
                variant="text"
                color="secondary"
                :prepend-icon="showAdvancedOptions ? 'mdi-chevron-up' : 'mdi-tune-variant'"
                @click="showAdvancedOptions = !showAdvancedOptions"
              >
                {{ showAdvancedOptions ? 'Ocultar ajustes especiales' : 'Necesito más detalle' }}
              </v-btn>
            </div>

            <v-expand-transition>
              <v-card v-if="showAdvancedOptions" variant="outlined" class="mt-2">
                <v-card-text>
                  <div class="text-subtitle-2 font-weight-bold mb-1">Facturación y códigos</div>
                  <div class="text-body-2 text-medium-emphasis mb-4">
                    Completa esto solo si tu operación o facturación electrónica lo necesita.
                  </div>

                  <v-row>
                    <v-col cols="12">
                      <v-autocomplete
                        v-model="formData.unit_id"
                        :items="units"
                        item-title="display_name"
                        item-value="unit_id"
                        label="Unidad de medida DIAN"
                        prepend-inner-icon="mdi-ruler"
                        variant="outlined"
                        clearable
                      />
                    </v-col>
                    <v-col cols="12" sm="8">
                      <v-text-field
                        v-model="formData.standard_code"
                        label="Código estándar"
                        prepend-inner-icon="mdi-barcode"
                        variant="outlined"
                      />
                    </v-col>
                    <v-col cols="12" sm="4">
                      <v-select
                        v-model="formData.standard_code_type"
                        :items="codeTypeOptions"
                        item-title="title"
                        item-value="value"
                        label="Tipo de código"
                        variant="outlined"
                      />
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>
            </v-expand-transition>
          </v-window-item>
        </v-window>
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" @click="emitToggle(false)">Cancelar</v-btn>
        <v-spacer />
        <v-btn v-if="step > 1" variant="text" @click="step -= 1">Atrás</v-btn>
        <v-btn v-if="step < 3" color="primary" variant="tonal" @click="goNext">Continuar</v-btn>
        <v-btn v-else color="primary" :loading="saving" @click="submit">
          {{ isEditing ? 'Guardar variante' : 'Crear variante' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import productsService from '@/services/products.service'
import { humanizeAppError } from '@/utils/appErrors'
import { generateSeedVariantSku } from '../../../shared/utils/productCreationWizard'
import {
  buildInitialVariantDraft,
  buildVariantPayloadForSave,
  getVariantMinimumAlertSummary,
} from '../../../shared/utils/productVariantWizard'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  tenantId: { type: String, default: '' },
  product: { type: Object, default: null },
  variant: { type: Object, default: null },
  units: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const rules = {
  required: (value) => Boolean(String(value || '').trim()) || 'Campo requerido',
  positive: (value) => Number(value || 0) >= 0 || 'Debe ser >= 0',
}

const codeTypeOptions = [
  { title: 'UNSPSC', value: 'UNSPSC' },
  { title: 'EAN', value: 'EAN' },
  { title: 'GTIN', value: 'GTIN' },
  { title: 'Fabricante', value: 'PARTNUM' },
]

const expirationOptions = [
  { title: 'Heredar del producto', value: null },
  { title: 'Sí requiere', value: true },
  { title: 'No requiere', value: false },
]

const wizardSteps = [
  { value: 1, label: 'Identidad' },
  { value: 2, label: 'Precio' },
  { value: 3, label: 'Operación' },
]

const buildVariantContext = () => ({
  track_inventory: props.product?.track_inventory === true,
  can_require_expiration: props.product?.inventory_behavior === 'RESELL' || props.product?.inventory_behavior === 'MANUFACTURED',
})

const buildFormFromProps = () => buildInitialVariantDraft({
  product_id: props.product?.product_id || null,
  ...props.variant,
}, buildVariantContext())

const step = ref(1)
const saving = ref(false)
const errorMessage = ref('')
const showAdvancedOptions = ref(false)
const formData = ref(buildFormFromProps())

const isEditing = computed(() => Boolean(props.variant?.variant_id))
const canTrackInventory = computed(() => buildVariantContext().track_inventory)
const canRequireExpiration = computed(() => buildVariantContext().can_require_expiration)
const minimumAlertSummary = computed(() => getVariantMinimumAlertSummary(formData.value, buildVariantContext()))

const resetWizard = () => {
  step.value = 1
  saving.value = false
  errorMessage.value = ''
  showAdvancedOptions.value = false
  formData.value = buildFormFromProps()
}

watch(
  () => [props.modelValue, props.variant, props.product],
  (state) => {
    if (state[0]) resetWizard()
  },
)

const emitToggle = (value) => {
  emit('update:modelValue', value)
}

const autoGenerateSku = () => {
  formData.value.sku = generateSeedVariantSku(
    props.product?.name || 'PRODUCTO',
    formData.value.variant_name || 'VARIANTE',
  )
}

const goNext = () => {
  errorMessage.value = ''
  if (step.value === 1 && !String(formData.value.sku || '').trim()) {
    errorMessage.value = 'El SKU es obligatorio.'
    return
  }
  if (step.value < 3) step.value += 1
}

const submit = async () => {
  errorMessage.value = ''
  if (!props.tenantId || !props.product?.product_id) {
    errorMessage.value = 'Falta contexto del producto para guardar la variante.'
    return
  }

  const payload = buildVariantPayloadForSave(formData.value, buildVariantContext())
  if (!payload.sku) {
    errorMessage.value = 'El SKU es obligatorio.'
    step.value = 1
    return
  }

  saving.value = true
  try {
    const response = isEditing.value
      ? await productsService.updateVariant(props.tenantId, props.variant.variant_id, payload)
      : await productsService.createVariant(props.tenantId, {
          ...payload,
          product_id: props.product.product_id,
        })

    if (!response.success) {
      errorMessage.value = humanizeAppError(response.error, { defaultMessage: 'No se pudo guardar la variante.' })
      return
    }

    emit('saved', {
      variant: response.data,
      message: isEditing.value ? 'Variante actualizada correctamente.' : 'Variante creada correctamente.',
    })
    emitToggle(false)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.variant-wizard :deep(.v-field) {
  border-radius: 12px;
}
</style>
