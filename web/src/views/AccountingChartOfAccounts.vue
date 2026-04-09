<template>
  <div>
    <div class="mb-3">
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-arrow-left" @click="goBackToAccounting">
        Volver a Contabilidad
      </v-btn>
    </div>

    <v-breadcrumbs :items="breadcrumbs" class="pa-0 mb-4">
      <template #divider><v-icon>mdi-chevron-right</v-icon></template>
    </v-breadcrumbs>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
        <span class="d-flex align-center ga-2">
          <v-icon color="indigo">mdi-file-tree-outline</v-icon>
          Plan de Cuentas
        </span>
        <div class="d-flex align-center ga-2 flex-wrap">
          <v-btn-toggle
            v-model="viewMode"
            mandatory
            color="primary"
            density="comfortable"
            variant="outlined"
          >
            <v-btn value="LIST" size="small" prepend-icon="mdi-view-list">Lista</v-btn>
            <v-btn value="TABLE" size="small" prepend-icon="mdi-table">Tabla</v-btn>
          </v-btn-toggle>
          <v-btn color="secondary" prepend-icon="mdi-plus" @click="createAccountDialog">
            Nueva cuenta
          </v-btn>
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="loadAccounts">
            Refrescar
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-switch
              v-model="filters.includeInactive"
              density="compact"
              hide-details
              color="primary"
              label="Incluir inactivas"
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="filters.accountType"
              :items="accountTypeFilterOptions"
              item-title="title"
              item-value="value"
              label="Tipo"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="filters.onlyPostable"
              :items="postableFilterOptions"
              item-title="title"
              item-value="value"
              label="Posteable"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field
              v-model="filters.search"
              label="Buscar codigo o nombre"
              variant="outlined"
              density="compact"
              hide-details
              prepend-inner-icon="mdi-magnify"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Cuentas contables</span>
        <v-chip size="small" color="indigo">{{ filteredAccounts.length }} cuentas</v-chip>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="580">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Nombre</th>
              <th>Clase</th>
              <th>Tipo</th>
              <th>Naturaleza</th>
              <th>Posteable</th>
              <th>Estado</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in filteredAccounts" :key="account.account_id">
              <td><code>{{ account.code }}</code></td>
              <td class="text-caption">{{ account.name }}</td>
              <td>{{ account.account_class }}</td>
              <td>{{ account.account_type }}</td>
              <td>{{ account.natural_side }}</td>
              <td>
                <v-chip size="x-small" :color="account.is_postable ? 'success' : 'grey'">
                  {{ account.is_postable ? 'SI' : 'NO' }}
                </v-chip>
              </td>
              <td>
                <v-chip size="x-small" :color="account.is_active ? 'success' : 'warning'">
                  {{ account.is_active ? 'ACTIVA' : 'INACTIVA' }}
                </v-chip>
              </td>
              <td>
                <div class="d-flex align-center ga-2">
                  <v-btn size="x-small" color="primary" variant="tonal" @click="editAccountDialog(account)">
                    Editar
                  </v-btn>
                  <v-btn
                    size="x-small"
                    :color="account.is_active ? 'warning' : 'success'"
                    variant="tonal"
                    :loading="togglingAccountId === account.account_id"
                    @click="toggleActive(account)"
                  >
                    {{ account.is_active ? 'Inactivar' : 'Activar' }}
                  </v-btn>
                </div>
              </td>
            </tr>
            <tr v-if="filteredAccounts.length === 0">
              <td colspan="8" class="text-center text-medium-emphasis py-6">No hay cuentas para los filtros seleccionados.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Plan de cuentas"
          icon="mdi-file-tree-outline"
          :items="paginatedAccounts"
          :total-items="filteredAccounts.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="account_id"
          title-field="name"
          avatar-icon="mdi-file-tree-outline"
          avatar-color="indigo"
          empty-message="No hay cuentas para los filtros seleccionados."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onAccountsListPage"
        >
          <template #title="{ item: account }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <code>{{ account.code }}</code>
                <span class="ml-2 font-weight-medium">{{ account.name }}</span>
              </div>
              <div class="d-flex align-center ga-1">
                <v-chip size="x-small" color="primary">{{ account.account_type }}</v-chip>
                <v-chip size="x-small" :color="account.is_active ? 'success' : 'warning'">
                  {{ account.is_active ? 'ACTIVA' : 'INACTIVA' }}
                </v-chip>
              </div>
            </div>
          </template>
          <template #content="{ item: account }">
            <div class="text-caption">Clase: {{ account.account_class }} | Naturaleza: {{ account.natural_side }}</div>
            <div class="text-caption">Posteable: {{ account.is_postable ? 'SI' : 'NO' }}</div>
          </template>
          <template #actions="{ item: account }">
            <div class="d-flex align-center ga-2">
              <v-btn size="small" color="primary" variant="tonal" @click.stop="editAccountDialog(account)">
                Editar
              </v-btn>
              <v-btn
                size="small"
                :color="account.is_active ? 'warning' : 'success'"
                variant="tonal"
                :loading="togglingAccountId === account.account_id"
                @click.stop="toggleActive(account)"
              >
                {{ account.is_active ? 'Inactivar' : 'Activar' }}
              </v-btn>
            </div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-dialog v-model="showDialog" max-width="880">
      <v-card>
        <v-card-title>{{ editingAccount ? 'Editar cuenta' : 'Nueva cuenta' }}</v-card-title>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" sm="4">
              <v-text-field v-model="form.code" label="Codigo" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" sm="8">
              <v-text-field v-model="form.name" label="Nombre" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field v-model="form.account_class" label="Clase" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select
                v-model="form.account_type"
                :items="accountTypeOptions"
                item-title="title"
                item-value="value"
                label="Tipo"
                variant="outlined"
                density="compact"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select
                v-model="form.natural_side"
                :items="naturalSideOptions"
                item-title="title"
                item-value="value"
                label="Naturaleza"
                variant="outlined"
                density="compact"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="form.parent_account_id"
                :items="parentAccountOptions"
                item-title="label"
                item-value="account_id"
                label="Cuenta padre"
                variant="outlined"
                density="compact"
                clearable
              />
            </v-col>
            <v-col cols="12" sm="3">
              <v-switch v-model="form.is_postable" color="primary" density="compact" label="Posteable" hide-details />
            </v-col>
            <v-col cols="12" sm="3">
              <v-switch v-model="form.is_active" color="primary" density="compact" label="Activa" hide-details />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="saving" :disabled="!canSave" @click="saveAccount">
            Guardar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTenant } from '@/composables/useTenant'
import { useNotification } from '@/composables/useNotification'
import { useAccountingViewMode } from '@/composables/useAccountingViewMode'
import accountingService from '@/services/accounting.service'
import ListView from '@/components/ListView.vue'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { show } = useNotification()
const { viewMode, isTableView } = useAccountingViewMode()

const loading = ref(false)
const saving = ref(false)
const togglingAccountId = ref(null)

const accounts = ref([])
const showDialog = ref(false)
const editingAccount = ref(null)

const LIST_PAGE_SIZE = 10
const accountsListPage = ref(1)

const filters = ref({
  includeInactive: false,
  accountType: 'ALL',
  onlyPostable: 'ALL',
  search: ''
})

const accountTypeOptions = [
  { title: 'ASSET', value: 'ASSET' },
  { title: 'LIABILITY', value: 'LIABILITY' },
  { title: 'EQUITY', value: 'EQUITY' },
  { title: 'INCOME', value: 'INCOME' },
  { title: 'COST', value: 'COST' },
  { title: 'EXPENSE', value: 'EXPENSE' },
  { title: 'ORDER', value: 'ORDER' }
]

const naturalSideOptions = [
  { title: 'DEBIT', value: 'DEBIT' },
  { title: 'CREDIT', value: 'CREDIT' }
]

const accountTypeFilterOptions = [
  { title: 'Todos', value: 'ALL' },
  ...accountTypeOptions
]

const postableFilterOptions = [
  { title: 'Todos', value: 'ALL' },
  { title: 'Solo posteables', value: 'YES' },
  { title: 'No posteables', value: 'NO' }
]

const form = ref({
  account_id: null,
  code: '',
  name: '',
  account_class: '',
  account_type: 'ASSET',
  natural_side: 'DEBIT',
  parent_account_id: null,
  is_postable: true,
  is_active: true,
  is_system: false
})

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Plan de cuentas', disabled: true }
])

const filteredAccounts = computed(() => {
  const search = String(filters.value.search || '').trim().toLowerCase()

  return (accounts.value || []).filter((account) => {
    if (!filters.value.includeInactive && !account.is_active) return false
    if (filters.value.accountType !== 'ALL' && account.account_type !== filters.value.accountType) return false
    if (filters.value.onlyPostable === 'YES' && !account.is_postable) return false
    if (filters.value.onlyPostable === 'NO' && account.is_postable) return false

    if (!search) return true
    const text = `${account.code || ''} ${account.name || ''} ${account.account_class || ''}`.toLowerCase()
    return text.includes(search)
  })
})

const accountsTotalPages = computed(() => Math.max(1, Math.ceil(filteredAccounts.value.length / LIST_PAGE_SIZE)))
const paginatedAccounts = computed(() => {
  const start = (accountsListPage.value - 1) * LIST_PAGE_SIZE
  return filteredAccounts.value.slice(start, start + LIST_PAGE_SIZE)
})

const parentAccountOptions = computed(() => {
  const currentId = editingAccount.value?.account_id || form.value.account_id
  return (accounts.value || [])
    .filter((account) => account.account_id !== currentId)
    .map((account) => ({
      ...account,
      label: `${account.code} - ${account.name}`
    }))
})

const canSave = computed(() => {
  return Boolean(
    String(form.value.code || '').trim() &&
    String(form.value.name || '').trim() &&
    String(form.value.account_class || '').trim() &&
    String(form.value.account_type || '').trim() &&
    String(form.value.natural_side || '').trim()
  )
})

const onAccountsListPage = ({ page }) => {
  accountsListPage.value = Number(page || 1)
}

const loadAccounts = async () => {
  if (!tenantId.value) return

  loading.value = true
  try {
    const result = await accountingService.getChartOfAccounts(tenantId.value, {
      includeInactive: true
    })

    if (!result.success) {
      show(result.error || 'No se pudo cargar el plan de cuentas.', 'error')
      return
    }

    accounts.value = result.data || []
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  form.value = {
    account_id: null,
    code: '',
    name: '',
    account_class: '',
    account_type: 'ASSET',
    natural_side: 'DEBIT',
    parent_account_id: null,
    is_postable: true,
    is_active: true,
    is_system: false
  }
}

const createAccountDialog = () => {
  editingAccount.value = null
  resetForm()
  showDialog.value = true
}

const editAccountDialog = (account) => {
  editingAccount.value = account
  form.value = {
    account_id: account.account_id,
    code: account.code || '',
    name: account.name || '',
    account_class: account.account_class || '',
    account_type: account.account_type || 'ASSET',
    natural_side: account.natural_side || 'DEBIT',
    parent_account_id: account.parent_account_id || null,
    is_postable: account.is_postable !== false,
    is_active: account.is_active !== false,
    is_system: Boolean(account.is_system)
  }
  showDialog.value = true
}

const saveAccount = async () => {
  if (!tenantId.value || !canSave.value) return

  saving.value = true
  try {
    const payload = {
      ...form.value,
      code: String(form.value.code || '').trim(),
      name: String(form.value.name || '').trim(),
      account_class: String(form.value.account_class || '').trim(),
      account_type: String(form.value.account_type || '').trim().toUpperCase(),
      natural_side: String(form.value.natural_side || '').trim().toUpperCase()
    }

    const result = await accountingService.saveAccount(tenantId.value, payload)
    if (!result.success) {
      show(result.error || 'No se pudo guardar la cuenta.', 'error')
      return
    }

    show('Cuenta guardada.', 'success')
    showDialog.value = false
    await loadAccounts()
  } finally {
    saving.value = false
  }
}

const toggleActive = async (account) => {
  if (!tenantId.value || !account?.account_id) return

  togglingAccountId.value = account.account_id
  try {
    const result = await accountingService.toggleAccountActive(
      tenantId.value,
      account.account_id,
      !Boolean(account.is_active)
    )

    if (!result.success) {
      show(result.error || 'No se pudo cambiar estado de la cuenta.', 'error')
      return
    }

    show(account.is_active ? 'Cuenta inactivada.' : 'Cuenta activada.', 'success')
    await loadAccounts()
  } finally {
    togglingAccountId.value = null
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({ path: '/accounting', query: { tab } })
}

watch(() => filteredAccounts.value.length, () => {
  accountsListPage.value = 1
})

watch(accountsTotalPages, (total) => {
  if (accountsListPage.value > total) accountsListPage.value = total
})

onMounted(loadAccounts)
</script>
