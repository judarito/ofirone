<template>
  <div class="fill-width">
    <ListView
      :title="t('units.title')"
      icon="mdi-ruler"
      avatar-color="cyan"
      :items="units"
      :total-items="totalItems"
      :loading="loading"
      :default-page-size="defaultPageSize"
      @load-page="loadUnits"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="confirmDelete"
      :create-text="t('units.new')"
    >
      <template #filters>
        <v-text-field
          v-model="searchQuery"
          :label="t('units.searchByCodeOrName')"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          style="max-width: 300px;"
          @update:model-value="debouncedSearch"
        ></v-text-field>
      </template>

      <template #subtitle="{ item }">
        <div class="d-flex align-center flex-wrap gap-2">
          <v-chip size="small" variant="flat" :color="item.is_system ? 'blue' : 'green'">
            <v-icon start size="small">{{ item.is_system ? 'mdi-cog' : 'mdi-account' }}</v-icon>
            {{ item.is_system ? t('units.system') : t('units.custom') }}
          </v-chip>
          <v-chip size="small" variant="outlined">
            {{ t('common.code') }}: <strong class="ml-1">{{ item.code }}</strong>
          </v-chip>
          <v-chip v-if="item.dian_code" size="small" variant="outlined" color="purple">
            DIAN: <strong class="ml-1">{{ item.dian_code }}</strong>
          </v-chip>
        </div>
      </template>

      <template #content="{ item }">
        <div class="text-caption text-grey" v-if="item.description">
          {{ item.description }}
        </div>
      </template>

      <template #actions="{ item }">
        <!-- Solo permitir editar/eliminar unidades del tenant (no sistema) -->
        <v-btn
          v-if="!item.is_system"
          icon="mdi-pencil"
          size="small"
          variant="text"
          color="primary"
          @click="openEditDialog(item)"
        ></v-btn>
        <v-btn
          v-if="!item.is_system"
          icon="mdi-delete"
          size="small"
          variant="text"
          color="error"
          @click="confirmDelete(item)"
        ></v-btn>
        <v-tooltip v-if="item.is_system" :text="t('units.systemNotEditable')" location="top">
          <template #activator="{ props }">
            <v-icon v-bind="props" color="blue-grey" size="small">mdi-lock</v-icon>
          </template>
        </v-tooltip>
      </template>
    </ListView>

    <!-- Dialog Crear/Editar -->
    <v-dialog v-model="formDialog" max-width="600" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon start :color="isEditing ? 'primary' : 'success'">
            {{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}
          </v-icon>
          {{ isEditing ? t('units.edit') : t('units.new') }}
        </v-card-title>

        <v-card-text>
          <v-form ref="unitForm" @submit.prevent="saveUnit">
            <v-text-field
              v-model="formData.code"
              :label="t('units.codeRequired')"
              :hint="t('units.codeHint')"
              variant="outlined"
              :rules="[rules.required, rules.maxLength(20)]"
              counter="20"
              @input="formData.code = formData.code.toUpperCase()"
            ></v-text-field>

            <v-text-field
              v-model="formData.dian_code"
              :label="t('units.dianCode')"
              :hint="t('units.dianCodeHint')"
              variant="outlined"
              :rules="[rules.maxLength(20)]"
              counter="20"
              @input="formData.dian_code = formData.dian_code ? formData.dian_code.toUpperCase() : ''"
            ></v-text-field>

            <v-text-field
              v-model="formData.name"
              :label="t('units.nameRequired')"
              :hint="t('units.nameHint')"
              variant="outlined"
              :rules="[rules.required, rules.maxLength(100)]"
              counter="100"
            ></v-text-field>

            <v-textarea
              v-model="formData.description"
              :label="t('units.description')"
              :hint="t('units.descriptionHint')"
              variant="outlined"
              rows="3"
              :rules="[rules.maxLength(500)]"
              counter="500"
            ></v-textarea>

            <v-switch
              v-model="formData.is_active"
              :label="t('units.activeUnit')"
              color="success"
              hide-details
              class="mb-2"
            ></v-switch>
          </v-form>

          <v-alert type="info" variant="tonal" class="mt-4" density="compact">
            <strong>{{ t('units.commonDianCodes') }}:</strong><br>
            • 94 = Unidad • 28 = Kilogramo • GRM = Gramo • LTR = Litro • MTR = Metro<br>
            {{ t('units.checkResolution') }} <a href="https://www.dian.gov.co" target="_blank">resolución 000042/2020 DIAN</a> {{ t('units.forMoreCodes') }}.
          </v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="formDialog = false" :disabled="saving">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            @click="saveUnit"
            :loading="saving"
            prepend-icon="mdi-content-save"
          >
            {{ t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Eliminar -->
    <v-dialog v-model="deleteDialog" max-width="500">
      <v-card>
        <v-card-title class="d-flex align-center text-error">
          <v-icon start color="error">mdi-alert-circle</v-icon>
          {{ t('common.confirmDelete') }}
        </v-card-title>

        <v-card-text>
          <p>{{ t('units.deleteQuestion') }} <strong>{{ unitToDelete?.name }}</strong> ({{ unitToDelete?.code }})?</p>
          
          <v-alert v-if="usageInfo && usageInfo.total > 0" type="error" variant="tonal" class="mt-4">
            <strong>⚠️ {{ t('units.inUse') }}:</strong>
            <ul class="ml-4 mt-2">
              <li v-if="usageInfo.products > 0">{{ usageInfo.products }} producto(s)</li>
              <li v-if="usageInfo.variants > 0">{{ usageInfo.variants }} variante(s)</li>
              <li v-if="usageInfo.bom_components > 0">{{ usageInfo.bom_components }} componente(s) BOM</li>
            </ul>
            <p class="mt-2">{{ t('units.cannotDeleteInUse') }}</p>
          </v-alert>

          <v-alert v-else-if="!checkingUsage" type="warning" variant="tonal" class="mt-4">
            {{ t('common.irreversibleAction') }}
          </v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="deleteDialog = false" :disabled="deleting">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="error"
            variant="flat"
            @click="deleteUnit"
            :loading="deleting || checkingUsage"
            :disabled="usageInfo && usageInfo.total > 0"
            prepend-icon="mdi-delete"
          >
            {{ t('common.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
      {{ snackbarMessage }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import unitsOfMeasureService from '@/services/unitsOfMeasure.service'

const { tenantId } = useTenant()
const { t } = useI18n()

// Estado principal
const units = ref([])
const totalItems = ref(0)
const loading = ref(false)
const { defaultPageSize } = useTenantSettings()
const searchQuery = ref('')

// Dialogs
const formDialog = ref(false)
const deleteDialog = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const deleting = ref(false)
const checkingUsage = ref(false)

// Formulario
const unitForm = ref(null)
const formData = ref({
  unit_id: null,
  code: '',
  dian_code: '',
  name: '',
  description: '',
  is_active: true
})

// Eliminar
const unitToDelete = ref(null)
const usageInfo = ref(null)

// Snackbar
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

// Reglas de validación
const rules = {
  required: v => !!v || t('common.requiredField'),
  maxLength: max => v => (v && v.length <= max) || t('units.maxChars', { max })
}

// Cargar unidades
const loadUnits = async (params) => {
  if (!tenantId.value) return
  
  loading.value = true
  try {
    const page = typeof params === 'object' ? params.page || 1 : params || 1
    const pageSize = typeof params === 'object' ? params.pageSize || defaultPageSize.value : defaultPageSize.value
    const search = typeof params === 'object' ? params.search || '' : searchQuery.value || ''

    const result = await unitsOfMeasureService.getUnits(tenantId.value, page, pageSize, search)
    
    if (result.success) {
      units.value = result.data
      totalItems.value = result.total
    } else {
      showMsg(`${t('units.loadError')}: ${result.error}`, 'error')
    }
  } catch (error) {
    console.error('Error loadUnits:', error)
    showMsg(t('units.loadError'), 'error')
  } finally {
    loading.value = false
  }
}

// Búsqueda con debounce
let searchTimeout = null
const debouncedSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    loadUnits({ page: 1, pageSize: defaultPageSize.value, search: searchQuery.value })
  }, 500)
}

// Abrir dialog crear
const openCreateDialog = () => {
  isEditing.value = false
  formData.value = {
    unit_id: null,
    code: '',
    dian_code: '',
    name: '',
    description: '',
    is_active: true
  }
  unitForm.value?.resetValidation()
  formDialog.value = true
}

// Abrir dialog editar
const openEditDialog = (unit) => {
  if (unit.is_system) {
    showMsg(t('units.systemNotEditableAction'), 'warning')
    return
  }
  
  isEditing.value = true
  formData.value = {
    unit_id: unit.unit_id,
    code: unit.code,
    dian_code: unit.dian_code || '',
    name: unit.name,
    description: unit.description || '',
    is_active: unit.is_active
  }
  unitForm.value?.resetValidation()
  formDialog.value = true
}

// Guardar unidad
const saveUnit = async () => {
  const { valid } = await unitForm.value.validate()
  if (!valid || !tenantId.value) return

  saving.value = true
  try {
    let result
    if (isEditing.value) {
      result = await unitsOfMeasureService.updateUnit(
        tenantId.value,
        formData.value.unit_id,
        formData.value
      )
    } else {
      result = await unitsOfMeasureService.createUnit(tenantId.value, formData.value)
    }

    if (result.success) {
      showMsg(isEditing.value ? t('units.updated') : t('units.created'), 'success')
      formDialog.value = false
      await loadUnits()
    } else {
      showMsg(`Error: ${result.error}`, 'error')
    }
  } catch (error) {
    console.error('Error saveUnit:', error)
    showMsg(t('units.saveError'), 'error')
  } finally {
    saving.value = false
  }
}

// Confirmar eliminación
const confirmDelete = async (unit) => {
  if (unit.is_system) {
    showMsg(t('units.systemNotDeletableAction'), 'warning')
    return
  }

  unitToDelete.value = unit
  usageInfo.value = null
  deleteDialog.value = true

  // Verificar si está en uso
  checkingUsage.value = true
  try {
    const result = await unitsOfMeasureService.checkUnitUsage(unit.unit_id)
    if (result.success) {
      usageInfo.value = result.usage
    }
  } catch (error) {
    console.error('Error checking usage:', error)
  } finally {
    checkingUsage.value = false
  }
}

// Eliminar unidad
const deleteUnit = async () => {
  if (!unitToDelete.value || !tenantId.value) return

  deleting.value = true
  try {
    const result = await unitsOfMeasureService.deleteUnit(
      tenantId.value,
      unitToDelete.value.unit_id
    )

    if (result.success) {
      showMsg(t('units.deleted'), 'success')
      deleteDialog.value = false
      unitToDelete.value = null
      usageInfo.value = null
      await loadUnits()
    } else {
      showMsg(`Error: ${result.error}`, 'error')
    }
  } catch (error) {
    console.error('Error deleteUnit:', error)
    showMsg(t('units.deleteError'), 'error')
  } finally {
    deleting.value = false
  }
}

// Mostrar mensaje
const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = msg
  snackbarColor.value = color
  snackbar.value = true
}

// Montar componente
onMounted(() => {
  if (tenantId.value) {
    loadUnits()
  }
})
</script>

<style scoped>
.gap-2 {
  gap: 0.5rem;
}
</style>
