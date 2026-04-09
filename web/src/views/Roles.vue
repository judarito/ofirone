<template>
  <div>
    <!-- Banner: solo lectura para administradores de tenant -->
    <v-alert
      v-if="!isSuperAdmin"
      type="info"
      variant="tonal"
      icon="mdi-shield-lock-outline"
      class="mb-4"
      border="start"
    >
      <v-alert-title>Configuración gestionada por Superadmin</v-alert-title>
      {{ t('roles.superadminManagedLine1') }}
      {{ t('roles.superadminManagedLine2') }} <strong>{{ t('roles.readOnly') }}</strong>.
    </v-alert>

    <ListView
      :title="t('roles.title')"
      icon="mdi-shield-account"
      :items="roles"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="role_id"
      title-field="name"
      avatar-icon="mdi-account-key"
      avatar-color="red-darken-1"
      :empty-message="t('roles.empty')"
      :create-button-text="isSuperAdmin ? t('roles.new') : undefined"
      :hide-actions="!isSuperAdmin"
      @create="isSuperAdmin ? openCreateDialog() : undefined"
      @edit="isSuperAdmin ? openEditDialog($event) : undefined"
      @delete="isSuperAdmin ? confirmDelete($event) : undefined"
      @load-page="loadRoles"
      @search="loadRoles"
    >
      <template #subtitle="{ item }">
        {{ item.role_permissions?.length || 0 }} {{ t('roles.permissionsAssigned') }}
      </template>
    </ListView>

    <!-- Dialog Crear/Editar Rol -->
    <v-dialog v-model="dialog" max-width="600" scrollable>
      <v-card>
        <v-card-title><v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>{{ isEditing ? t('roles.edit') : t('roles.new') }}</v-card-title>
        <v-card-text>
          <v-form ref="form" @submit.prevent="save">
            <v-text-field v-model="formData.name" :label="t('roles.roleName')" prepend-inner-icon="mdi-account-key" variant="outlined" :rules="[rules.required]" class="mb-4"></v-text-field>

            <!-- Permisos -->
            <div v-if="isEditing" class="text-subtitle-1 font-weight-bold mb-2">{{ t('roles.permissions') }}</div>
            <div v-if="isEditing">
              <div v-for="group in permissionGroups" :key="group.name" class="mb-3">
                <div class="text-subtitle-2 text-grey-darken-1 mb-1">{{ group.name }}</div>
                <v-checkbox
                  v-for="perm in group.permissions"
                  :key="perm.permission_id"
                  v-model="selectedPermissions"
                  :value="perm.permission_id"
                  :label="`${perm.code} — ${perm.description || ''}`"
                  density="compact"
                  hide-details
                ></v-checkbox>
              </div>
            </div>
            <div v-if="!isEditing" class="text-body-2 text-grey">{{ t('roles.saveToAssignPermissions') }}</div>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ isEditing ? t('common.save') : t('common.create') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title><v-icon start color="error">mdi-alert</v-icon>{{ t('common.confirmDelete') }}</v-card-title>
        <v-card-text>{{ t('roles.deleteQuestion') }} <strong>{{ itemToDelete?.name }}</strong>?</v-card-text>
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
import { ref, computed, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useSuperAdmin } from '@/composables/useSuperAdmin'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import rolesService from '@/services/roles.service'

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { isSuperAdmin } = useSuperAdmin()
const { t } = useI18n()
const roles = ref([])
const totalItems = ref(0)
const loading = ref(false)
const dialog = ref(false)
const deleteDialog = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const deleting = ref(false)
const form = ref(null)
const itemToDelete = ref(null)
const allPermissions = ref([])
const selectedPermissions = ref([])
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')
const formData = ref({ role_id: null, name: '' })
const rules = { required: v => !!v || t('common.requiredField') }

const permissionGroups = computed(() => {
  const groups = {}
  allPermissions.value.forEach(p => {
    const module = p.code.split('.')[0] || t('roles.generalModule')
    if (!groups[module]) groups[module] = []
    groups[module].push(p)
  })
  return Object.entries(groups).map(([name, permissions]) => ({ name, permissions }))
})

const loadRoles = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loading.value = true
  try {
    const r = await rolesService.getRoles(tid, page, pageSize, search)
    if (r.success) { roles.value = r.data; totalItems.value = r.total }
    else showMsg(t('roles.loadError'), 'error')
  } finally { loading.value = false }
}

const loadPermissions = async () => {
  const r = await rolesService.getAllPermissions()
  if (r.success) allPermissions.value = r.data
}

const openCreateDialog = () => {
  isEditing.value = false
  formData.value = { role_id: null, name: '' }
  selectedPermissions.value = []
  dialog.value = true
}

const openEditDialog = async (item) => {
  if (!tenantId.value) return
  isEditing.value = true
  formData.value = { role_id: item.role_id, name: item.name }
  await loadPermissions()
  const rp = await rolesService.getRolePermissions(tenantId.value, item.role_id)
  selectedPermissions.value = rp.success ? rp.data : []
  dialog.value = true
}

const confirmDelete = (item) => { itemToDelete.value = item; deleteDialog.value = true }

const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid || !tenantId.value) return
  saving.value = true
  try {
    let r
    if (isEditing.value) {
      r = await rolesService.updateRole(tenantId.value, formData.value.role_id, formData.value)
      if (r.success) {
        await rolesService.setRolePermissions(tenantId.value, formData.value.role_id, selectedPermissions.value)
      }
    } else {
      r = await rolesService.createRole(tenantId.value, formData.value)
    }
    if (r.success) { showMsg(isEditing.value ? t('roles.updated') : t('roles.created')); dialog.value = false; loadRoles({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error || t('common.saveError'), 'error')
  } finally { saving.value = false }
}

const doDelete = async () => {
  if (!itemToDelete.value || !tenantId.value) return
  deleting.value = true
  try {
    const r = await rolesService.deleteRole(tenantId.value, itemToDelete.value.role_id)
    if (r.success) { showMsg(t('roles.deleted')); deleteDialog.value = false; loadRoles({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error, 'error')
  } finally { deleting.value = false }
}

const showMsg = (msg, color = 'success') => { snackbarMessage.value = msg; snackbarColor.value = color; snackbar.value = true }

onMounted(async () => {
  await loadSettings()
})
</script>
