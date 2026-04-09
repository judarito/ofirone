<template>
  <div>
    <ListView
      :title="t('users.title')"
      icon="mdi-account-group"
      :items="users"
      :total-items="totalUsers"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="user_id"
      title-field="full_name"
      avatar-icon="mdi-account"
      avatar-color="primary"
      :empty-message="t('users.empty')"
      :create-button-text="t('users.new')"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="null"
      @load-page="loadUsers"
      @search="loadUsers"
      :deletable="false"
    >
      <template #subtitle="{ item }">
        {{ item.email }}
      </template>
      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip
            v-for="role in item.roles"
            :key="role.role_id"
            size="small"
            color="primary"
            variant="tonal"
          >
            {{ role.name }}
          </v-chip>
          <v-chip v-if="!item.roles || item.roles.length === 0" size="small" color="grey">
            {{ t('users.noRoles') }}
          </v-chip>
          <v-chip :color="item.is_active ? 'success' : 'error'" size="small">
            {{ item.is_active ? t('common.active') : t('common.inactive') }}
          </v-chip>
        </div>
      </template>
      <template #actions="{ item }">
        <div class="d-flex ga-1">
          <v-btn
            icon="mdi-lock-reset"
            size="small"
            variant="text"
            @click.stop="openPasswordDialog(item)"
            :title="t('users.changePassword')"
          ></v-btn>
          <v-btn
            :icon="item.is_active ? 'mdi-account-off' : 'mdi-account-check'"
            size="small"
            variant="text"
            :color="item.is_active ? 'error' : 'success'"
            @click.stop="toggleUserStatus(item)"
            :title="item.is_active ? t('users.deactivate') : t('users.activate')"
          ></v-btn>
        </div>
      </template>
    </ListView>

    <!-- Dialog para crear/editar usuario -->
    <v-dialog v-model="dialog" max-width="600px" persistent>
      <v-card>
        <v-card-title>
          <span class="text-h5">
            <v-icon class="mr-2">{{ isEdit ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
            {{ isEdit ? t('users.edit') : t('users.new') }}
          </span>
        </v-card-title>

        <v-card-text>
          <v-form ref="formRef" v-model="formValid">
            <v-text-field
              v-model="form.email"
              :label="t('settings.email')"
              prepend-inner-icon="mdi-email"
              variant="outlined"
              type="email"
              :rules="[rules.required, rules.email]"
              :disabled="isEdit"
              :hint="isEdit ? t('users.emailImmutable') : ''"
              persistent-hint
            ></v-text-field>

            <v-text-field
              v-if="!isEdit"
              v-model="form.password"
              :label="t('login.password')"
              prepend-inner-icon="mdi-lock"
              variant="outlined"
              :type="showPassword ? 'text' : 'password'"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              :rules="[rules.required, rules.minLength]"
              @click:append-inner="showPassword = !showPassword"
            ></v-text-field>

            <v-text-field
              v-model="form.full_name"
              :label="t('users.fullName')"
              prepend-inner-icon="mdi-account"
              variant="outlined"
              :rules="[rules.required]"
            ></v-text-field>

            <v-select
              v-model="form.roleIds"
              :items="availableRoles"
              item-title="name"
              item-value="role_id"
              :label="t('users.roles')"
              prepend-inner-icon="mdi-shield-account"
              variant="outlined"
              multiple
              chips
              closable-chips
              :rules="[rules.atLeastOne]"
            >
              <template #chip="{ item, props }">
                <v-chip v-bind="props" color="primary">
                  {{ item.title }}
                </v-chip>
              </template>
            </v-select>

            <v-switch
              v-model="form.is_active"
              :label="t('users.activeUser')"
              color="primary"
              hide-details
            ></v-switch>
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="closeDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            variant="elevated"
            :loading="saving"
            :disabled="!formValid"
            @click="saveUser"
          >
            {{ isEdit ? t('common.save') : t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog para cambiar contraseña -->
    <v-dialog v-model="passwordDialog" max-width="500px" persistent>
      <v-card>
        <v-card-title>
          <span class="text-h5">
            <v-icon class="mr-2">mdi-lock-reset</v-icon>
            {{ t('users.changePassword') }}
          </span>
        </v-card-title>

        <v-card-text>
          <v-alert type="info" variant="tonal" class="mb-4">
            {{ t('users.changePasswordFor') }} <strong>{{ selectedUser?.email }}</strong>
          </v-alert>

          <v-form ref="passwordFormRef" v-model="passwordFormValid">
            <v-text-field
              v-model="passwordForm.newPassword"
              :label="t('login.newPassword')"
              prepend-inner-icon="mdi-lock"
              variant="outlined"
              :type="showNewPassword ? 'text' : 'password'"
              :append-inner-icon="showNewPassword ? 'mdi-eye-off' : 'mdi-eye'"
              :rules="[rules.required, rules.minLength]"
              @click:append-inner="showNewPassword = !showNewPassword"
            ></v-text-field>

            <v-text-field
              v-model="passwordForm.confirmPassword"
              :label="t('login.confirmPassword')"
              prepend-inner-icon="mdi-lock-check"
              variant="outlined"
              :type="showConfirmPassword ? 'text' : 'password'"
              :append-inner-icon="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
              :rules="[rules.required, rules.passwordMatch]"
              @click:append-inner="showConfirmPassword = !showConfirmPassword"
            ></v-text-field>
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="closePasswordDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            variant="elevated"
            :loading="savingPassword"
            :disabled="!passwordFormValid"
            @click="changePassword"
          >
            {{ t('users.changePassword') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar para notificaciones -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
      {{ snackbarText }}
      <template #actions>
        <v-btn variant="text" @click="snackbar = false">{{ t('common.close') }}</v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import {
  getUsers,
  getAllUsers,
  createUser,
  updateUser,
  changeUserPassword,
  getRoles
} from '@/services/users.service'

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { t } = useI18n()

// Estado
const users = ref([])
const totalUsers = ref(0)
const availableRoles = ref([])
const loading = ref(false)
const dialog = ref(false)
const passwordDialog = ref(false)
const isEdit = ref(false)
const formValid = ref(false)
const passwordFormValid = ref(false)
const saving = ref(false)
const savingPassword = ref(false)
const showPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const formRef = ref(null)
const passwordFormRef = ref(null)
const selectedUser = ref(null)

// Snackbar
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

// Formularios
const form = ref({
  email: '',
  password: '',
  full_name: '',
  roleIds: [],
  is_active: true
})

const passwordForm = ref({
  newPassword: '',
  confirmPassword: ''
})

// Reglas de validación
const rules = {
  required: v => !!v || t('users.fieldRequired'),
  email: v => /.+@.+\..+/.test(v) || t('login.invalidEmail'),
  minLength: v => (v && v.length >= 6) || t('users.minLength'),
  atLeastOne: v => (v && v.length > 0) || t('users.selectAtLeastOneRole'),
  passwordMatch: v => v === passwordForm.value.newPassword || t('login.passwordMismatch')
}

// Métodos
async function loadUsers({ page, pageSize, search, tenantId: tid }) {
  if (!tid) return
  loading.value = true
  try {
    const result = await getUsers(tid, page, pageSize, search)
    if (result.success) {
      users.value = result.data
      totalUsers.value = result.total
    } else {
      showMessage(t('users.loadError'), 'error')
    }
  } catch (error) {
    showMessage(t('users.loadError'), 'error')
  } finally {
    loading.value = false
  }
}

async function loadRoles() {
  if (!tenantId.value) return
  try {
    availableRoles.value = await getRoles(tenantId.value)
  } catch (error) {
    showMessage(t('roles.loadError'), 'error')
  }
}

function openCreateDialog() {
  isEdit.value = false
  form.value = {
    email: '',
    password: '',
    full_name: '',
    roleIds: [],
    is_active: true
  }
  dialog.value = true
}

function openEditDialog(user) {
  isEdit.value = true
  selectedUser.value = user
  form.value = {
    user_id: user.user_id,
    email: user.email,
    password: '',
    full_name: user.full_name,
    roleIds: user.roles.map(r => r.role_id),
    is_active: user.is_active
  }
  dialog.value = true
}

function closeDialog() {
  dialog.value = false
  formRef.value?.resetValidation()
  selectedUser.value = null
}

async function saveUser() {
  if (!formValid.value || !tenantId.value) return

  saving.value = true
  try {
    if (isEdit.value) {
      await updateUser(tenantId.value, form.value.user_id, {
        full_name: form.value.full_name,
        is_active: form.value.is_active,
        roleIds: form.value.roleIds
      })
      showMessage(t('users.updatedSuccessfully'), 'success')
    } else {
      await createUser({
        email: form.value.email,
        password: form.value.password,
        full_name: form.value.full_name,
        roleIds: form.value.roleIds,
        is_active: form.value.is_active
      })
      showMessage(t('users.createdSuccessfully'), 'success')
    }

    closeDialog()
    // Recargar la lista
    await loadUsers({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
  } catch (error) {
    showMessage(error.message || t('users.saveError'), 'error')
  } finally {
    saving.value = false
  }
}

function openPasswordDialog(user) {
  selectedUser.value = user
  passwordForm.value = {
    newPassword: '',
    confirmPassword: ''
  }
  passwordDialog.value = true
}

function closePasswordDialog() {
  passwordDialog.value = false
  passwordFormRef.value?.resetValidation()
  selectedUser.value = null
}

async function changePassword() {
  if (!passwordFormValid.value) return

  savingPassword.value = true
  try {
    await changeUserPassword(
      selectedUser.value.auth_user_id,
      passwordForm.value.newPassword
    )
    showMessage(t('users.passwordUpdatedSuccessfully'), 'success')
    closePasswordDialog()
  } catch (error) {
    showMessage(error.message || t('users.changePasswordError'), 'error')
  } finally {
    savingPassword.value = false
  }
}

async function toggleUserStatus(user) {
  if (!tenantId.value) return
  try {
    await updateUser(tenantId.value, user.user_id, {
      full_name: user.full_name,
      is_active: !user.is_active,
      roleIds: user.roles.map(r => r.role_id)
    })
    showMessage(
      t(!user.is_active ? 'users.activatedSuccessfully' : 'users.deactivatedSuccessfully'),
      'success'
    )
    // Recargar la lista
    await loadUsers({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
  } catch (error) {
    showMessage(t('users.changeStatusError'), 'error')
  }
}

function showMessage(text, color = 'success') {
  snackbarText.value = text
  snackbarColor.value = color
  snackbar.value = true
}

// Lifecycle
onMounted(async () => {
  await loadSettings()
  await loadRoles()
})
</script>
