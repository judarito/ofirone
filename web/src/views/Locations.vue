<template>
  <div>
    <ListView
      :title="t('locations.title')"
      icon="mdi-store"
      :items="locations"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="location_id"
      title-field="name"
      avatar-icon="mdi-map-marker"
      avatar-color="primary"
      :empty-message="t('locations.empty')"
      :create-button-text="t('locations.new')"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="confirmDelete"
      @load-page="loadLocations"
      @search="loadLocations"
    >
      <!-- Slot personalizado para el contenido -->
      <template #content="{ item }">
        <div class="mt-2 d-flex align-center gap-2">
          <v-chip
            v-if="item.address"
            size="small"
            variant="tonal"
            prepend-icon="mdi-map-marker"
          >
            {{ item.address }}
          </v-chip>

          <v-chip
            :color="item.type === 'STORE' ? 'primary' : 'secondary'"
            size="small"
            variant="tonal"
            :prepend-icon="item.type === 'STORE' ? 'mdi-store' : 'mdi-warehouse'"
          >
            {{ item.type === 'STORE' ? t('locations.store') : t('locations.warehouse') }}
          </v-chip>

          <v-chip
            :color="item.is_active ? 'success' : 'error'"
            size="small"
            variant="flat"
          >
            {{ item.is_active ? t('common.active') : t('common.inactive') }}
          </v-chip>
        </div>
      </template>
    </ListView>

    <!-- Dialog Crear/Editar -->
    <v-dialog v-model="dialog" max-width="600">
      <v-card>
        <v-card-title>
          <v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
          {{ isEditing ? t('locations.edit') : t('locations.new') }}
        </v-card-title>

        <v-card-text>
          <v-form ref="form" @submit.prevent="saveLocation">
            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.name"
                  :label="t('common.name')"
                  prepend-inner-icon="mdi-text"
                  variant="outlined"
                  :rules="[rules.required]"
                ></v-text-field>
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="formData.type"
                  :label="t('common.type')"
                  prepend-inner-icon="mdi-format-list-bulleted-type"
                  variant="outlined"
                  :items="locationTypes"
                  :rules="[rules.required]"
                ></v-select>
              </v-col>

              <v-col cols="12">
                <v-textarea
                  v-model="formData.address"
                  :label="t('common.address')"
                  prepend-inner-icon="mdi-map-marker"
                  variant="outlined"
                  rows="2"
                  auto-grow
                ></v-textarea>
              </v-col>

              <v-col cols="12" sm="6">
                <v-switch
                  v-model="formData.is_active"
                  :label="t('common.active')"
                  color="success"
                  hide-details
                ></v-switch>
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="closeDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            @click="saveLocation"
          >
            {{ isEditing ? t('common.update') : t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Confirmación Eliminar -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title class="text-h5">
          <v-icon start color="error">mdi-alert</v-icon>
          {{ t('common.confirmDelete') }}
        </v-card-title>

        <v-card-text>
          {{ t('locations.deleteQuestionPrefix') }}
          <strong>{{ itemToDelete?.name }}</strong>?
          {{ t('common.irreversibleAction') }}
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="error"
            :loading="deleting"
            @click="deleteLocation"
          >
            {{ t('common.delete') }}
          </v-btn>
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

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import locationsService from '@/services/locations.service'

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { t } = useI18n()

const locations = ref([])
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

const formData = ref({
  location_id: null,
  name: '',
  type: 'STORE',
  address: '',
  is_active: true
})

const locationTypes = computed(() => [
  { title: t('locations.store'), value: 'STORE' },
  { title: t('locations.warehouse'), value: 'WAREHOUSE' }
])

const rules = {
  required: value => !!value || t('common.requiredField')
}

const loadLocations = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return

  loading.value = true
  try {
    const result = await locationsService.getLocations(
      tid,
      page,
      pageSize,
      search
    )

    if (result.success) {
      locations.value = result.data
      totalItems.value = result.total
    } else {
      showMessage(t('locations.loadError'), 'error')
    }
  } catch (error) {
    showMessage(t('locations.loadError'), 'error')
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  isEditing.value = false
  formData.value = {
    location_id: null,
    name: '',
    type: 'STORE',
    address: '',
    is_active: true
  }
  dialog.value = true
}

const openEditDialog = (item) => {
  isEditing.value = true
  formData.value = { ...item }
  dialog.value = true
}

const closeDialog = () => {
  dialog.value = false
  if (form.value) {
    form.value.reset()
  }
}

const saveLocation = async () => {
  const { valid } = await form.value.validate()
  if (!valid) return

  if (!tenantId.value) {
    showMessage(t('common.tenantMissing'), 'error')
    return
  }

  saving.value = true
  try {
    let result

    if (isEditing.value) {
      result = await locationsService.updateLocation(
        tenantId.value,
        formData.value.location_id,
        formData.value
      )
    } else {
      result = await locationsService.createLocation(
        tenantId.value,
        formData.value
      )
    }

    if (result.success) {
      showMessage(
        isEditing.value
          ? t('locations.updated')
          : t('locations.created'),
        'success'
      )
      closeDialog()
      loadLocations({
        page: 1,
        pageSize: defaultPageSize.value,
        search: '',
        tenantId: tenantId.value
      })
    } else {
      showMessage(result.error || t('common.saveError'), 'error')
    }
  } catch (error) {
    showMessage(t('locations.saveSpecificError'), 'error')
  } finally {
    saving.value = false
  }
}

const confirmDelete = (item) => {
  itemToDelete.value = item
  deleteDialog.value = true
}

const deleteLocation = async () => {
  if (!itemToDelete.value || !tenantId.value) return

  deleting.value = true
  try {
    const result = await locationsService.deleteLocation(
      tenantId.value,
      itemToDelete.value.location_id
    )

    if (result.success) {
      showMessage(t('locations.deleted'), 'success')
      deleteDialog.value = false
      loadLocations({
        page: 1,
        pageSize: defaultPageSize.value,
        search: '',
        tenantId: tenantId.value
      })
    } else {
      showMessage(result.error || t('common.deleteError'), 'error')
    }
  } catch (error) {
    showMessage(t('locations.deleteSpecificError'), 'error')
  } finally {
    deleting.value = false
  }
}

const showMessage = (message, color = 'success') => {
  snackbarMessage.value = message
  snackbarColor.value = color
  snackbar.value = true
}

onMounted(async () => {
  await loadSettings()
})
</script>

<style scoped>
.gap-2 {
  gap: 8px;
}
</style>
