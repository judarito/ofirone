<template>
  <div>
    <ListView
      :title="t('categories.title')"
      icon="mdi-shape"
      :items="categories"
      :total-items="totalItems"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="category_id"
      title-field="name"
      avatar-icon="mdi-tag"
      avatar-color="deep-purple"
      :empty-message="t('categories.empty')"
      :create-button-text="t('categories.new')"
      @create="openCreateDialog"
      @edit="openEditDialog"
      @delete="confirmDelete"
      @load-page="loadCategories"
      @search="loadCategories"
    >
      <template #subtitle="{ item }">
        {{ item.parent ? `${t('categories.subcategoryOf')} ${item.parent.name}` : t('categories.mainCategory') }}
      </template>
    </ListView>

    <v-dialog v-model="dialog" max-width="500">
      <v-card>
        <v-card-title>
          <v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
          {{ isEditing ? t('categories.edit') : t('categories.new') }}
        </v-card-title>
        <v-card-text>
          <v-form ref="form" @submit.prevent="save">
            <v-text-field v-model="formData.name" :label="t('common.name')" prepend-inner-icon="mdi-text" variant="outlined" :rules="[rules.required]" class="mb-2"></v-text-field>
            <v-select v-model="formData.parent_category_id" :label="t('categories.parentOptional')" prepend-inner-icon="mdi-file-tree" variant="outlined" :items="parentOptions" item-title="name" item-value="category_id" clearable></v-select>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ isEditing ? t('common.update') : t('common.create') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title><v-icon start color="error">mdi-alert</v-icon>{{ t('common.confirmDelete') }}</v-card-title>
        <v-card-text>{{ t('categories.deleteQuestion') }} <strong>{{ itemToDelete?.name }}</strong>?</v-card-text>
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
import { ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useI18n } from '@/i18n'
import ListView from '@/components/ListView.vue'
import categoriesService from '@/services/categories.service'

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { t } = useI18n()
const categories = ref([])
const totalItems = ref(0)
const loading = ref(false)
const dialog = ref(false)
const deleteDialog = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const deleting = ref(false)
const form = ref(null)
const itemToDelete = ref(null)
const parentOptions = ref([])
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')
const formData = ref({ category_id: null, name: '', parent_category_id: null })
const rules = { required: v => !!v || t('common.requiredField') }

const loadCategories = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loading.value = true
  try {
    const r = await categoriesService.getCategories(tid, page, pageSize, search)
    if (r.success) { categories.value = r.data; totalItems.value = r.total }
    else showMsg(t('categories.loadError'), 'error')
  } finally { loading.value = false }
}

const loadParents = async () => {
  if (!tenantId.value) return
  const r = await categoriesService.getAllCategories(tenantId.value)
  if (r.success) parentOptions.value = r.data
}

const openCreateDialog = () => { isEditing.value = false; formData.value = { category_id: null, name: '', parent_category_id: null }; loadParents(); dialog.value = true }
const openEditDialog = (item) => { isEditing.value = true; formData.value = { ...item, parent_category_id: item.parent_category_id }; loadParents(); dialog.value = true }
const confirmDelete = (item) => { itemToDelete.value = item; deleteDialog.value = true }

const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid || !tenantId.value) return
  saving.value = true
  try {
    const r = isEditing.value
      ? await categoriesService.updateCategory(tenantId.value, formData.value.category_id, formData.value)
      : await categoriesService.createCategory(tenantId.value, formData.value)
    if (r.success) { showMsg(isEditing.value ? t('categories.updated') : t('categories.created')); dialog.value = false; loadCategories({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error || t('common.saveError'), 'error')
  } finally { saving.value = false }
}

const doDelete = async () => {
  if (!itemToDelete.value || !tenantId.value) return
  deleting.value = true
  try {
    const r = await categoriesService.deleteCategory(tenantId.value, itemToDelete.value.category_id)
    if (r.success) { showMsg(t('categories.deleted')); deleteDialog.value = false; loadCategories({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error || t('common.deleteError'), 'error')
  } finally { deleting.value = false }
}

onMounted(async () => {
  await loadSettings()
})

const showMsg = (msg, color = 'success') => { snackbarMessage.value = msg; snackbarColor.value = color; snackbar.value = true }
</script>
