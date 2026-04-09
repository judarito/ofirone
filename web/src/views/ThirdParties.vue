<template>
  <div>
    <ListView
      :title="t('thirdParties.title')"
      icon="mdi-account-multiple"
      :items="items"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="third_party_id"
      title-field="legal_name"
      avatar-icon="mdi-account"
      avatar-color="teal"
      :empty-message="t('thirdParties.empty')"
      :create-button-text="t('thirdParties.new')"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="confirmDelete"
      @load-page="load"
      @search="load"
    >
      <template #subtitle="{ item }">
        {{ [item.document_number ? item.document_number + (item.dv ? '-' + item.dv : '') : '', item.phone, item.email].filter(Boolean).join(' • ') || t('thirdParties.noContactData') }}
      </template>
      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip :color="item.is_active ? 'success' : 'error'" size="small" variant="flat">
            {{ item.is_active ? t('common.active') : t('common.inactive') }}
          </v-chip>
          <v-chip v-if="item.type === 'customer' || item.type === 'both'" size="small" variant="tonal" color="teal" prepend-icon="mdi-account">
            {{ t('app.customer') }}
          </v-chip>
          <v-chip v-if="item.type === 'supplier' || item.type === 'both'" size="small" variant="tonal" color="deep-orange" prepend-icon="mdi-truck">
            {{ t('app.provider') }}
          </v-chip>
          <v-chip v-if="item.max_credit_amount" size="small" variant="tonal" color="warning" prepend-icon="mdi-credit-card-clock">
            {{ t('app.limit') }}: {{ formatMoney(item.max_credit_amount) }}
          </v-chip>
        </div>
      </template>
    </ListView>

    <!-- Dialog Crear/Editar -->
    <v-dialog v-model="dialog" max-width="800" scrollable>
      <v-card>
        <v-card-title>
          <v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
          {{ isEditing ? t('thirdParties.edit') : t('thirdParties.new') }}
        </v-card-title>
        <v-card-text>
          <ThirdPartyForm ref="thirdPartyFormRef" :key="dialog + String(formData.third_party_id)" :model="formData" @save="save" @cancel="closeDialog" />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="closeDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="saving" @click="thirdPartyFormRef?.submit()">{{ isEditing ? t('common.update') : t('common.create') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title><v-icon start color="error">mdi-alert</v-icon>{{ t('common.confirmDelete') }}</v-card-title>
        <v-card-text>{{ t('thirdParties.deleteQuestion') }} <strong>{{ itemToDelete?.legal_name }}</strong>?</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">{{ t('common.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import thirdPartiesService from '@/services/thirdParties.service'
import ThirdPartyForm from '@/components/ThirdPartyForm.vue'
import { formatMoney } from '@/utils/formatters'

const { tenantId } = useTenant()
const { defaultPageSize } = useTenantSettings()
const { t } = useI18n()
const items = ref([])
const totalItems = ref(0)
const loading = ref(false)
const dialog = ref(false)
const deleteDialog = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const deleting = ref(false)
const formData = reactive({})
const itemToDelete = ref(null)
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')
const thirdPartyFormRef = ref(null)

async function load({ page = 1, pageSize = null, search = '' } = {}) {
  if (!tenantId.value) return
  loading.value = true
  try {
    // normalize pageSize (may be a Ref or number)
    const ps = Number(pageSize && pageSize.value !== undefined ? pageSize.value : pageSize ?? defaultPageSize.value) || 20
    const pg = Number(page) || 1
    const offset = (pg - 1) * ps
    const data = await thirdPartiesService.list({ search, limit: ps, offset })
    items.value = data || []
    // totalItems not provided by service.list; keep simple
  } catch (err) {
    console.error('Error cargando terceros', err)
    snackbarMessage.value = t('thirdParties.loadError')
    snackbarColor.value = 'error'
    snackbar.value = true
  } finally { loading.value = false }
}

function openCreateDialog() {
  isEditing.value = false
  Object.assign(formData, { third_party_id: null, tenant_id: tenantId.value, type: 'both', legal_name: '', document_number: '', dv: '', phone: '', email: '', address: null, max_credit_amount: null, is_active: true })
  dialog.value = true
}

function openEditDialog(item) {
  isEditing.value = true
  Object.assign(formData, item)
  dialog.value = true
}

async function save(payload) {
  try {
    saving.value = true
    // payload may be passed by child emission, otherwise use formData
    const dataToSave = payload && Object.keys(payload).length ? payload : formData
    if (isEditing.value && dataToSave.third_party_id) {
      await thirdPartiesService.update(dataToSave.third_party_id, dataToSave)
      snackbarMessage.value = t('thirdParties.updated')
    } else {
      await thirdPartiesService.create(dataToSave)
      snackbarMessage.value = t('thirdParties.created')
    }
    snackbarColor.value = 'success'
    snackbar.value = true
    dialog.value = false
    await load()
  } catch (err) {
    console.error('Error guardando tercero', err)
    snackbarMessage.value = t('thirdParties.saveError')
    snackbarColor.value = 'error'
    snackbar.value = true
  } finally { saving.value = false }
}

function confirmDelete(item) {
  itemToDelete.value = item
  deleteDialog.value = true
}

async function doDelete() {
  if (!itemToDelete.value) return
  deleting.value = true
  try {
    await thirdPartiesService.remove(itemToDelete.value.third_party_id, itemToDelete.value.tenant_id)
    snackbarMessage.value = t('thirdParties.deleted')
    snackbarColor.value = 'success'
    snackbar.value = true
    deleteDialog.value = false
    await load()
  } catch (err) {
    console.error('Error eliminando tercero', err)
    snackbarMessage.value = t('thirdParties.deleteError')
    snackbarColor.value = 'error'
    snackbar.value = true
  } finally { deleting.value = false }
}

function closeDialog() { dialog.value = false }

onMounted(() => { load() })
</script>
