<template>
  <div>
    <ListView
      :title="t('cashRegisters.title')"
      icon="mdi-desktop-classic"
      :items="registers"
      :total-items="totalRegisters"
      :loading="loadingRegisters"
      :page-size="defaultPageSize"
      item-key="cash_register_id"
      title-field="name"
      avatar-icon="mdi-desktop-classic"
      avatar-color="brown"
      :empty-message="t('cashRegisters.empty')"
      :create-button-text="t('cashRegisters.new')"
      :creatable="canManage"
      :editable="canManage"
      :deletable="canManage"
      @create="openRegisterDialog"
      @edit="openEditRegisterDialog"
      @delete="confirmDeleteRegister"
      @load-page="loadRegisters"
      @search="loadRegisters"
    >
      <template #subtitle="{ item }">
        {{ t('app.branch') }}: {{ item.location?.name || t('cashRegisters.noBranch') }}
      </template>
      <template #content="{ item }">
        <v-chip :color="item.is_active ? 'success' : 'error'" size="small" variant="flat" class="mt-2">
          {{ item.is_active ? t('common.active') : t('common.inactive') }}
        </v-chip>
      </template>
    </ListView>

    <!-- Dialog Caja Registradora -->
    <v-dialog v-model="registerDialog" max-width="500">
      <v-card>
        <v-card-title><v-icon start>{{ editingRegister ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>{{ editingRegister ? t('cashRegisters.edit') : t('cashRegisters.new') }}</v-card-title>
        <v-card-text>
          <v-form ref="registerForm">
            <v-text-field v-model="registerData.name" :label="t('common.name')" prepend-inner-icon="mdi-text" variant="outlined" :rules="[rules.required]" class="mb-2"></v-text-field>
            <v-select v-model="registerData.location_id" :label="t('app.branch')" prepend-inner-icon="mdi-store" variant="outlined" :items="locationOptions" item-title="name" item-value="location_id" :rules="[rules.required]" class="mb-2"></v-select>
            <v-switch v-model="registerData.is_active" :label="t('common.active')" color="success" hide-details></v-switch>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="registerDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="savingRegister" @click="saveRegister">{{ editingRegister ? t('common.update') : t('common.create') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteRegisterDialog" max-width="400">
      <v-card>
        <v-card-title><v-icon start color="error">mdi-alert</v-icon>{{ t('common.confirmDelete') }}</v-card-title>
        <v-card-text>{{ t('cashRegisters.deleteQuestion') }} <strong>{{ registerToDelete?.name }}</strong>?</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteRegisterDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" :loading="deletingRegister" @click="doDeleteRegister">{{ t('common.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAuth } from '@/composables/useAuth'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import cashService from '@/services/cash.service'
import locationsService from '@/services/locations.service'

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { hasPermission } = useAuth()
const { t } = useI18n()

const canManage = hasPermission('CASH.REGISTER.MANAGE')

const registers = ref([])
const totalRegisters = ref(0)
const loadingRegisters = ref(false)
const registerDialog = ref(false)
const deleteRegisterDialog = ref(false)
const editingRegister = ref(false)
const savingRegister = ref(false)
const deletingRegister = ref(false)
const registerToDelete = ref(null)
const registerForm = ref(null)
const registerData = ref({ cash_register_id: null, name: '', location_id: null, is_active: true })
const locationOptions = ref([])

const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

const rules = {
  required: v => (v !== '' && v !== null && v !== undefined) || t('common.requiredField')
}

const showMsg = (msg, color = 'success') => { snackbarMessage.value = msg; snackbarColor.value = color; snackbar.value = true }

const loadRegisters = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loadingRegisters.value = true
  try {
    const r = await cashService.getCashRegisters(tid, page, pageSize, search)
    if (r.success) { registers.value = r.data; totalRegisters.value = r.total }
  } finally { loadingRegisters.value = false }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const r = await locationsService.getLocations(tenantId.value, 1, 100)
  if (r.success) locationOptions.value = r.data
}

const openRegisterDialog = () => {
  registerData.value = { cash_register_id: null, name: '', location_id: null, is_active: true }
  editingRegister.value = false
  registerDialog.value = true
}

const openEditRegisterDialog = (item) => {
  registerData.value = { ...item }
  editingRegister.value = true
  registerDialog.value = true
}

const saveRegister = async () => {
  const { valid } = await registerForm.value.validate()
  if (!valid || !tenantId.value) return
  savingRegister.value = true
  try {
    let r
    if (editingRegister.value) {
      r = await cashService.updateCashRegister(tenantId.value, registerData.value.cash_register_id, registerData.value)
    } else {
      r = await cashService.createCashRegister(tenantId.value, registerData.value)
    }
    if (r.success) { showMsg(editingRegister.value ? t('cashRegisters.updated') : t('cashRegisters.created')); registerDialog.value = false; loadRegisters({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error, 'error')
  } finally { savingRegister.value = false }
}

const confirmDeleteRegister = (item) => { registerToDelete.value = item; deleteRegisterDialog.value = true }

const doDeleteRegister = async () => {
  if (!registerToDelete.value) return
  deletingRegister.value = true
  try {
    const r = await cashService.deleteCashRegister(tenantId.value, registerToDelete.value.cash_register_id)
    if (r.success) { showMsg(t('cashRegisters.deleted')); deleteRegisterDialog.value = false; loadRegisters({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error, 'error')
  } finally { deletingRegister.value = false }
}

onMounted(async () => {
  await loadSettings()
  loadLocations()
})
</script>
