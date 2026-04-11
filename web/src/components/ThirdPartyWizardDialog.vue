<template>
  <v-dialog :model-value="modelValue" max-width="760" scrollable @update:model-value="emitToggle">
    <v-card class="third-party-wizard">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="primary">mdi-account-switch</v-icon>
        {{ isEditMode ? 'Editar Tercero Guiado' : 'Crear Tercero Guiado' }}
      </v-card-title>

      <v-card-subtitle class="pb-0">
        Empezamos por el rol, la identificación y el contacto. Lo fiscal y comercial queda disponible sin convertir esto en un formulario pesado.
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
            <div class="text-subtitle-1 font-weight-bold mb-2">{{ isEditMode ? '¿Qué tercero estás editando?' : '¿Qué tercero vas a crear?' }}</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              Escoge el rol principal y registra la identidad fiscal del tercero.
            </div>

            <v-row>
              <v-col
                v-for="typeOption in typeProfiles"
                :key="typeOption.id"
                cols="12"
                sm="4"
              >
                <v-card
                  class="profile-card h-100"
                  :class="{ 'profile-card--active': formData.type === typeOption.id }"
                  variant="outlined"
                  :disabled="Boolean(props.forcedType)"
                  @click="selectType(typeOption.id)"
                >
                  <v-card-text>
                    <div class="text-subtitle-2 font-weight-bold mb-2">{{ typeOption.title }}</div>
                    <div class="text-body-2 text-medium-emphasis">{{ typeOption.description }}</div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>

            <v-alert type="info" variant="tonal" class="mt-4">
              <template #text>
                <strong>Selección actual:</strong> {{ selectedType.title }}. {{ typeHelpText }}
              </template>
            </v-alert>

            <v-row class="mt-3">
              <v-col cols="12" sm="8">
                <v-text-field
                  v-model="formData.legal_name"
                  label="Razón social / nombre completo"
                  prepend-inner-icon="mdi-domain"
                  variant="outlined"
                  :rules="[rules.required]"
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model="formData.trade_name"
                  label="Nombre comercial"
                  prepend-inner-icon="mdi-tag"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="formData.document_type"
                  :items="documentTypeOptions"
                  item-title="label"
                  item-value="code"
                  label="Tipo de documento"
                  prepend-inner-icon="mdi-card-account-details"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="5">
                <v-text-field
                  v-model="formData.document_number"
                  label="Número de documento"
                  prepend-inner-icon="mdi-numeric"
                  variant="outlined"
                  :rules="[rules.required]"
                />
              </v-col>
              <v-col cols="12" sm="3">
                <v-text-field
                  v-model="formData.dv"
                  label="DV"
                  prepend-inner-icon="mdi-shield-check"
                  variant="outlined"
                />
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item :value="2">
            <div class="text-subtitle-1 font-weight-bold mb-2">Contacto y ubicación</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              Solo lo necesario para poder ubicar y usar este tercero en operación.
            </div>

            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.phone"
                  label="Teléfono"
                  prepend-inner-icon="mdi-phone"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.email"
                  label="Correo electrónico"
                  prepend-inner-icon="mdi-email-outline"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.fiscal_email"
                  label="Correo fiscal / facturación"
                  prepend-inner-icon="mdi-email"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.department"
                  label="Departamento"
                  prepend-inner-icon="mdi-map"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.city"
                  label="Ciudad / municipio"
                  prepend-inner-icon="mdi-city"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.city_code"
                  label="Código DANE"
                  prepend-inner-icon="mdi-numeric"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12">
                <v-textarea
                  v-model="formData.address_text"
                  label="Dirección"
                  prepend-inner-icon="mdi-map-marker"
                  rows="2"
                  auto-grow
                  variant="outlined"
                />
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item :value="3">
            <div class="text-subtitle-1 font-weight-bold mb-2">Resumen y ajustes</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              El tercero ya queda usable con lo anterior. Aquí dejas activos solo los ajustes comerciales y fiscales que sí apliquen.
            </div>

            <v-card variant="tonal" color="primary" class="mt-2">
              <v-card-text class="text-body-2">
                <div><strong>Resumen:</strong> {{ selectedType.title }}</div>
                <div>Nombre: {{ formData.legal_name || 'Pendiente' }}</div>
                <div>Documento: {{ [formData.document_type, formData.document_number].filter(Boolean).join(' ') || 'Pendiente' }}</div>
                <div>Contacto: {{ summaryContact }}</div>
                <div>Estado: {{ formData.is_active ? 'Activo' : 'Inactivo' }}</div>
              </v-card-text>
            </v-card>

            <div class="d-flex justify-end mt-3">
              <v-btn
                variant="text"
                color="secondary"
                :prepend-icon="showAdvancedOptions ? 'mdi-chevron-up' : 'mdi-tune-variant'"
                @click="showAdvancedOptions = !showAdvancedOptions"
              >
                {{ showAdvancedOptions ? 'Ocultar ajustes especiales' : 'Necesito configuración fiscal o comercial' }}
              </v-btn>
            </div>

            <v-expand-transition>
              <v-card v-if="showAdvancedOptions" variant="outlined" class="mt-2">
                <v-card-text>
                  <div class="text-subtitle-2 font-weight-bold mb-1">Ajustes avanzados</div>
                  <div class="text-body-2 text-medium-emphasis mb-4">
                    Usa esto cuando el tercero necesite crédito, términos de pago o datos de facturación electrónica.
                  </div>

                  <v-row>
                    <v-col cols="12" sm="4">
                      <v-text-field
                        v-model.number="formData.max_credit_amount"
                        label="Cupo de crédito"
                        prepend-inner-icon="mdi-cash"
                        variant="outlined"
                        type="number"
                      />
                    </v-col>
                    <v-col cols="12" sm="4">
                      <v-text-field
                        v-model.number="formData.default_payment_terms"
                        label="Días de pago"
                        prepend-inner-icon="mdi-calendar-clock"
                        variant="outlined"
                        type="number"
                      />
                    </v-col>
                    <v-col cols="12" sm="4">
                      <v-text-field
                        v-model="formData.default_currency"
                        label="Moneda"
                        prepend-inner-icon="mdi-currency-usd"
                        variant="outlined"
                      />
                    </v-col>
                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="formData.tax_regime"
                        :items="taxRegimeOptions"
                        item-title="title"
                        item-value="value"
                        label="Régimen tributario"
                        prepend-inner-icon="mdi-bank"
                        variant="outlined"
                        clearable
                      />
                    </v-col>
                    <v-col cols="12" sm="6">
                      <v-text-field
                        v-model="formData.ciiu_code"
                        label="Código CIIU"
                        prepend-inner-icon="mdi-briefcase"
                        variant="outlined"
                      />
                    </v-col>
                    <v-col cols="12" sm="6">
                      <v-switch
                        v-model="formData.is_responsible_for_iva"
                        label="Responsable de IVA"
                        color="primary"
                        inset
                      />
                    </v-col>
                    <v-col cols="12" sm="6">
                      <v-switch
                        v-model="formData.obligated_accounting"
                        label="Obligado a llevar contabilidad"
                        color="primary"
                        inset
                      />
                    </v-col>
                    <v-col cols="12" sm="6">
                      <v-switch
                        v-model="formData.electronic_invoicing_enabled"
                        label="Acepta factura electrónica"
                        color="indigo"
                        inset
                      />
                    </v-col>
                    <v-col cols="12" sm="6">
                      <v-switch
                        v-model="formData.is_active"
                        label="Activo"
                        color="success"
                        inset
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
          {{ isEditMode ? 'Guardar cambios' : 'Crear tercero' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import thirdPartiesService from '@/services/thirdParties.service'
import {
  DOCUMENT_TYPE_CODES,
  TAX_REGIME_OPTIONS_WEB,
} from '../../../shared/constants/thirdParty'
import {
  THIRD_PARTY_WIZARD_TYPES,
  buildInitialThirdPartyDraft,
  buildThirdPartyDraftFromExisting,
  buildThirdPartyPayloadForSave,
  getThirdPartyTypeHelpText,
  getThirdPartyWizardType,
  sanitizeThirdPartyDraft,
} from '../../../shared/utils/thirdPartyWizard'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  tenantId: { type: String, default: '' },
  mode: { type: String, default: 'create' },
  initialThirdParty: { type: Object, default: null },
  forcedType: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'saved'])

const wizardSteps = [
  { value: 1, label: 'Identidad' },
  { value: 2, label: 'Contacto' },
  { value: 3, label: 'Ajustes' },
]

const rules = {
  required: (value) => Boolean(String(value || '').trim()) || 'Campo requerido',
}

const documentTypeOptions = DOCUMENT_TYPE_CODES.map((code) => ({ code, label: code }))
const taxRegimeOptions = TAX_REGIME_OPTIONS_WEB
const typeProfiles = THIRD_PARTY_WIZARD_TYPES

const isEditMode = computed(() => props.mode === 'edit')
const buildFormFromProps = () => (
  isEditMode.value && props.initialThirdParty
    ? buildThirdPartyDraftFromExisting(props.initialThirdParty, { forcedType: props.forcedType })
    : buildInitialThirdPartyDraft(props.forcedType)
)

const step = ref(1)
const saving = ref(false)
const errorMessage = ref('')
const showAdvancedOptions = ref(false)
const formData = ref(buildFormFromProps())

const previewDraft = computed(() => sanitizeThirdPartyDraft(formData.value, { forcedType: props.forcedType }))
const selectedType = computed(() => getThirdPartyWizardType(formData.value.type, props.forcedType))
const typeHelpText = computed(() => getThirdPartyTypeHelpText(formData.value.type, props.forcedType))
const summaryContact = computed(() => (
  [previewDraft.value.phone, previewDraft.value.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'
))

const resetWizard = () => {
  step.value = 1
  saving.value = false
  errorMessage.value = ''
  showAdvancedOptions.value = false
  formData.value = buildFormFromProps()
}

watch(
  () => [props.modelValue, props.initialThirdParty, props.mode, props.forcedType],
  (state) => {
    if (state[0]) resetWizard()
  },
)

const emitToggle = (value) => {
  emit('update:modelValue', value)
}

const selectType = (type) => {
  if (props.forcedType) return
  formData.value = sanitizeThirdPartyDraft({
    ...formData.value,
    type,
  }, { forcedType: props.forcedType })
}

const goNext = () => {
  errorMessage.value = ''
  if (!String(formData.value.legal_name || '').trim() || !String(formData.value.document_number || '').trim()) {
    errorMessage.value = 'Nombre y documento son obligatorios.'
    return
  }
  if (step.value < 3) step.value += 1
}

const submit = async () => {
  errorMessage.value = ''
  if (!props.tenantId) {
    errorMessage.value = 'No hay tenant activo para guardar el tercero.'
    return
  }

  const payload = buildThirdPartyPayloadForSave(formData.value, {
    tenantId: props.tenantId,
    forcedType: props.forcedType,
  })

  if (!payload.legal_name || !payload.document_number) {
    errorMessage.value = 'Nombre y documento son obligatorios.'
    step.value = 1
    return
  }

  saving.value = true
  try {
    if (isEditMode.value) {
      await thirdPartiesService.update(props.initialThirdParty.third_party_id, payload)
    } else {
      await thirdPartiesService.create(payload)
    }

    emit('saved', {
      message: isEditMode.value ? 'Tercero actualizado correctamente.' : 'Tercero creado correctamente.',
    })
    emitToggle(false)
  } catch (error) {
    console.error('third-party wizard save error', error)
    errorMessage.value = 'No se pudo guardar el tercero.'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.third-party-wizard :deep(.v-field) {
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
