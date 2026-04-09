<template>
  <div>
    <ListView
      :title="t('paymentMethods.title')"
      icon="mdi-credit-card"
      :items="paymentMethods"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="payment_method_id"
      title-field="name"
      subtitle-field="code"
      avatar-icon="mdi-cash"
      avatar-color="success"
      :empty-message="t('paymentMethods.empty')"
      :create-button-text="t('paymentMethods.new')"
      :creatable="canManage"
      :editable="canManage"
      :deletable="canManage"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="confirmDelete"
      @load-page="loadPaymentMethods"
      @search="loadPaymentMethods"
    >
      <!-- Slot personalizado para el contenido -->
      <template #content="{ item }">
        <div class="mt-2 d-flex align-center ga-2">
          <v-chip
            :color="item.is_active ? 'success' : 'error'"
            size="small"
            variant="flat"
          >
            {{ item.is_active ? t('common.active') : t('common.inactive') }}
          </v-chip>
          <v-chip size="small" variant="tonal" color="blue" prepend-icon="mdi-sort-numeric-ascending">
            {{ t('paymentMethods.order') }}: {{ item.sort_order ?? 0 }}
          </v-chip>
        </div>
      </template>
    </ListView>

    <!-- Dialog Crear/Editar -->
    <v-dialog v-model="dialog" max-width="500">
      <v-card>
        <v-card-title>
          <v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
          {{ isEditing ? t('paymentMethods.edit') : t('paymentMethods.new') }}
        </v-card-title>

        <v-card-text>
          <v-form ref="form" @submit.prevent="savePaymentMethod">
            <v-text-field
              v-model="formData.code"
              :label="t('common.code')"
              prepend-inner-icon="mdi-barcode"
              variant="outlined"
              :rules="[rules.required, rules.code]"
              :disabled="isEditing"
              :hint="t('paymentMethods.codeHint')"
              persistent-hint
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model="formData.name"
              :label="t('common.name')"
              prepend-inner-icon="mdi-text"
              variant="outlined"
              :rules="[rules.required]"
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model.number="formData.sort_order"
              :label="t('paymentMethods.sortOrder')"
              prepend-inner-icon="mdi-sort-numeric-ascending"
              variant="outlined"
              type="number"
              :min="0"
              density="compact"
              :hint="t('paymentMethods.sortOrderHint')"
              persistent-hint
              class="mb-3"
            ></v-text-field>

            <v-switch
              v-model="formData.is_active"
              :label="t('common.active')"
              color="success"
              hide-details
            ></v-switch>
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="closeDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            @click="savePaymentMethod"
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
          {{ t('paymentMethods.deleteQuestionPrefix') }}
          <strong>{{ itemToDelete?.name }}</strong>?
          {{ t('common.irreversibleAction') }}
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="error"
            :loading="deleting"
            @click="deletePaymentMethod"
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
import { ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAuth } from '@/composables/useAuth'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import paymentMethodsService from '@/services/paymentMethods.service'

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { hasPermission } = useAuth()
const { t } = useI18n()

const canManage = hasPermission('SETTINGS.PAYMENT_METHODS.MANAGE')

const paymentMethods = ref([])
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
  payment_method_id: null,
  code: '',
  name: '',
  is_active: true,
  sort_order: 0
})

const rules = {
  required: value => !!value || t('common.requiredField'),
  code: value => {
    if (!value) return true
    return /^[A-Z_]+$/.test(value) || t('paymentMethods.codeRule')
  }
}

const loadPaymentMethods = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return

  loading.value = true
  try {
    const result = await paymentMethodsService.getPaymentMethods(
      tid,
      page,
      pageSize,
      search
    )

    if (result.success) {
      paymentMethods.value = result.data
      totalItems.value = result.total
    } else {
      showMessage(t('paymentMethods.loadError'), 'error')
    }
  } catch (error) {
    showMessage(t('paymentMethods.loadError'), 'error')
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  isEditing.value = false
  formData.value = {
    payment_method_id: null,
    code: '',
    name: '',
    is_active: true,
    sort_order: 0
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

const savePaymentMethod = async () => {
  const { valid } = await form.value.validate()
  if (!valid) return

  if (!tenantId.value) {
    showMessage(t('common.tenantMissing'), 'error')
    return
  }

  // Verificar si el código ya existe
  if (!isEditing.value || formData.value.code !== formData.value.original_code) {
    const exists = await paymentMethodsService.checkCodeExists(
      tenantId.value,
      formData.value.code,
      isEditing.value ? formData.value.payment_method_id : null
    )

    if (exists) {
      showMessage(t('paymentMethods.codeExists'), 'error')
      return
    }
  }

  saving.value = true
  try {
    let result

    if (isEditing.value) {
      result = await paymentMethodsService.updatePaymentMethod(
        tenantId.value,
        formData.value.payment_method_id,
        formData.value
      )
    } else {
      result = await paymentMethodsService.createPaymentMethod(
        tenantId.value,
        formData.value
      )
    }

    if (result.success) {
      showMessage(
        isEditing.value
          ? t('paymentMethods.updated')
          : t('paymentMethods.created'),
        'success'
      )
      closeDialog()
      loadPaymentMethods({
        page: 1,
        pageSize: defaultPageSize.value,
        search: '',
        tenantId: tenantId.value
      })
    } else {
      showMessage(result.error || t('common.saveError'), 'error')
    }
  } catch (error) {
    showMessage(t('paymentMethods.saveSpecificError'), 'error')
  } finally {
    saving.value = false
  }
}

const confirmDelete = (item) => {
  itemToDelete.value = item
  deleteDialog.value = true
}

const deletePaymentMethod = async () => {
  if (!itemToDelete.value || !tenantId.value) return

  deleting.value = true
  try {
    const result = await paymentMethodsService.deletePaymentMethod(
      tenantId.value,
      itemToDelete.value.payment_method_id
    )

    if (result.success) {
      showMessage(t('paymentMethods.deleted'), 'success')
      deleteDialog.value = false
      loadPaymentMethods({
        page: 1,
        pageSize: defaultPageSize.value,
        search: '',
        tenantId: tenantId.value
      })
    } else {
      showMessage(result.error || t('common.deleteError'), 'error')
    }
  } catch (error) {
    showMessage(t('paymentMethods.deleteSpecificError'), 'error')
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
