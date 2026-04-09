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
          <v-icon color="primary">mdi-notebook-edit-outline</v-icon>
          Asientos Manuales
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
          <v-btn color="secondary" prepend-icon="mdi-plus" @click="openCreateDialog">
            Nuevo asiento
          </v-btn>
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="loadData">
            Refrescar
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-text-field
              v-model="filters.date_from"
              label="Desde"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field
              v-model="filters.date_to"
              label="Hasta"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="filters.status"
              :items="statusOptions"
              item-title="title"
              item-value="value"
              label="Estado"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-btn color="primary" variant="tonal" block @click="loadEntries">Aplicar filtro</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Asientos registrados</span>
        <v-chip size="small" color="primary">{{ entries.length }} total</v-chip>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="isTableView" class="pa-0">
        <v-table density="comfortable" fixed-header height="560">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Descripcion</th>
              <th class="text-right">Debito</th>
              <th class="text-right">Credito</th>
              <th>Estado</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.entry_id">
              <td>
                <strong>{{ entry.entry_number || '-' }}</strong>
                <div class="text-caption text-medium-emphasis">{{ (entry.lines || []).length }} lineas</div>
              </td>
              <td>{{ formatDate(entry.entry_date) || '-' }}</td>
              <td class="text-caption">{{ entry.description || '-' }}</td>
              <td class="text-right">{{ formatMoney(getEntryTotals(entry).debit) }}</td>
              <td class="text-right">{{ formatMoney(getEntryTotals(entry).credit) }}</td>
              <td>
                <v-chip size="x-small" :color="getStatusColor(entry.status)">
                  {{ entry.status || '-' }}
                </v-chip>
              </td>
              <td>
                <div class="d-flex align-center ga-2">
                  <v-btn
                    v-if="entry.status === 'DRAFT'"
                    size="x-small"
                    color="success"
                    variant="tonal"
                    :loading="postingEntryId === entry.entry_id"
                    @click="postEntry(entry)"
                  >
                    Postear
                  </v-btn>
                  <v-btn
                    v-if="entry.status === 'DRAFT'"
                    size="x-small"
                    color="error"
                    variant="tonal"
                    :loading="voidingEntryId === entry.entry_id"
                    @click="voidEntry(entry)"
                  >
                    Anular
                  </v-btn>
                  <span v-if="entry.status !== 'DRAFT'">-</span>
                </div>
              </td>
            </tr>
            <tr v-if="entries.length === 0">
              <td colspan="7" class="text-center text-medium-emphasis py-6">No hay asientos manuales para el filtro.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>
        <ListView
          title="Asientos manuales"
          icon="mdi-notebook-edit-outline"
          :items="paginatedEntries"
          :total-items="entries.length"
          :loading="loading"
          :page-size="LIST_PAGE_SIZE"
          item-key="entry_id"
          title-field="entry_number"
          avatar-icon="mdi-notebook-edit-outline"
          avatar-color="primary"
          empty-message="No hay asientos manuales para el filtro."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="onEntriesListPage"
        >
          <template #title="{ item: entry }">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
              <div>
                <strong>#{{ entry.entry_number || 'DRAFT' }}</strong>
                <span class="ml-2 text-caption">{{ formatDate(entry.entry_date) || '-' }}</span>
              </div>
              <v-chip size="x-small" :color="getStatusColor(entry.status)">
                {{ entry.status || '-' }}
              </v-chip>
            </div>
          </template>
          <template #content="{ item: entry }">
            <div class="text-caption">{{ entry.description || '-' }}</div>
            <div class="text-caption mt-1">
              Lineas: {{ (entry.lines || []).length }} |
              Debito: {{ formatMoney(getEntryTotals(entry).debit) }} |
              Credito: {{ formatMoney(getEntryTotals(entry).credit) }}
            </div>
          </template>
          <template #actions="{ item: entry }">
            <div class="d-flex align-center ga-2">
              <v-btn
                v-if="entry.status === 'DRAFT'"
                size="small"
                color="success"
                variant="tonal"
                :loading="postingEntryId === entry.entry_id"
                @click.stop="postEntry(entry)"
              >
                Postear
              </v-btn>
              <v-btn
                v-if="entry.status === 'DRAFT'"
                size="small"
                color="error"
                variant="tonal"
                :loading="voidingEntryId === entry.entry_id"
                @click.stop="voidEntry(entry)"
              >
                Anular
              </v-btn>
            </div>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <v-dialog v-model="showCreateDialog" max-width="1080">
      <v-card>
        <v-card-title>Nuevo asiento manual</v-card-title>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" sm="4">
              <v-text-field
                v-model="newEntry.entry_date"
                type="date"
                label="Fecha"
                variant="outlined"
                density="compact"
              />
            </v-col>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="newEntry.description"
                label="Descripcion"
                variant="outlined"
                density="compact"
                placeholder="Asiento manual"
              />
            </v-col>
          </v-row>

          <v-divider class="my-2" />

          <v-row>
            <v-col cols="12">
              <div class="text-subtitle-2 mb-2">Lineas del asiento</div>
            </v-col>
            <v-col cols="12" v-for="(line, index) in newEntry.lines" :key="`line-${index}`">
              <v-card variant="outlined" class="pa-3">
                <v-row>
                  <v-col cols="12" md="4">
                    <v-select
                      v-model="line.account_id"
                      :items="accountOptions"
                      item-title="label"
                      item-value="account_id"
                      label="Cuenta"
                      variant="outlined"
                      density="compact"
                    />
                  </v-col>
                  <v-col cols="12" md="2">
                    <v-text-field
                      v-model.number="line.debit_amount"
                      type="number"
                      min="0"
                      step="0.01"
                      label="Debito"
                      variant="outlined"
                      density="compact"
                    />
                  </v-col>
                  <v-col cols="12" md="2">
                    <v-text-field
                      v-model.number="line.credit_amount"
                      type="number"
                      min="0"
                      step="0.01"
                      label="Credito"
                      variant="outlined"
                      density="compact"
                    />
                  </v-col>
                  <v-col cols="12" md="3">
                    <v-text-field
                      v-model="line.description"
                      label="Detalle linea"
                      variant="outlined"
                      density="compact"
                    />
                  </v-col>
                  <v-col cols="12" md="1" class="d-flex align-center justify-end">
                    <v-btn
                      icon="mdi-delete"
                      color="error"
                      variant="text"
                      :disabled="newEntry.lines.length <= 2"
                      @click="removeLine(index)"
                    />
                  </v-col>
                </v-row>
              </v-card>
            </v-col>
          </v-row>

          <div class="d-flex align-center justify-space-between mt-3 flex-wrap ga-2">
            <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus" @click="addLine">
              Agregar linea
            </v-btn>
            <div class="d-flex align-center ga-2">
              <v-chip size="small" color="primary">Debito: {{ formatMoney(newEntryTotals.debit) }}</v-chip>
              <v-chip size="small" color="secondary">Credito: {{ formatMoney(newEntryTotals.credit) }}</v-chip>
              <v-chip size="small" :color="isNewEntryBalanced ? 'success' : 'error'">
                {{ isNewEntryBalanced ? 'Balanceado' : 'No balanceado' }}
              </v-chip>
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreateDialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="creatingEntry" :disabled="!canCreateEntry" @click="createEntry">
            Guardar borrador
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
import { formatDate, formatMoney } from '@/utils/formatters'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { show } = useNotification()
const { viewMode, isTableView } = useAccountingViewMode()

const period = accountingService.getDefaultPeriod()
const filters = ref({
  date_from: period.date_from,
  date_to: period.date_to,
  status: 'ALL'
})

const statusOptions = [
  { title: 'Todos', value: 'ALL' },
  { title: 'Borrador', value: 'DRAFT' },
  { title: 'Posteado', value: 'POSTED' },
  { title: 'Anulado', value: 'VOIDED' }
]

const loading = ref(false)
const creatingEntry = ref(false)
const postingEntryId = ref(null)
const voidingEntryId = ref(null)
const showCreateDialog = ref(false)

const entries = ref([])
const accounts = ref([])
const entriesListPage = ref(1)
const LIST_PAGE_SIZE = 8

const newEntry = ref({
  entry_date: new Date().toISOString().substring(0, 10),
  description: '',
  lines: [
    { account_id: null, debit_amount: 0, credit_amount: 0, description: '' },
    { account_id: null, debit_amount: 0, credit_amount: 0, description: '' }
  ]
})

const breadcrumbs = computed(() => [
  { title: 'Contabilidad', to: '/accounting', disabled: false },
  { title: 'Asientos manuales', disabled: true }
])

const entriesTotalPages = computed(() => Math.max(1, Math.ceil(entries.value.length / LIST_PAGE_SIZE)))
const paginatedEntries = computed(() => {
  const start = (entriesListPage.value - 1) * LIST_PAGE_SIZE
  return entries.value.slice(start, start + LIST_PAGE_SIZE)
})

const accountOptions = computed(() => {
  return (accounts.value || []).map((account) => ({
    ...account,
    label: `${account.code} - ${account.name}`
  }))
})

const newEntryTotals = computed(() => {
  return (newEntry.value.lines || []).reduce((acc, line) => {
    acc.debit += Number(line.debit_amount || 0)
    acc.credit += Number(line.credit_amount || 0)
    return acc
  }, { debit: 0, credit: 0 })
})

const isNewEntryBalanced = computed(() => {
  return Math.round(newEntryTotals.value.debit * 100) === Math.round(newEntryTotals.value.credit * 100)
})

const canCreateEntry = computed(() => {
  if (!newEntry.value.lines || newEntry.value.lines.length < 2) return false
  if (!isNewEntryBalanced.value) return false
  if (newEntryTotals.value.debit <= 0 || newEntryTotals.value.credit <= 0) return false

  return newEntry.value.lines.every((line) => {
    const debit = Number(line.debit_amount || 0)
    const credit = Number(line.credit_amount || 0)
    return Boolean(line.account_id) && ((debit > 0 && credit === 0) || (credit > 0 && debit === 0))
  })
})

const getStatusColor = (status) => {
  if (status === 'POSTED') return 'success'
  if (status === 'VOIDED') return 'error'
  return 'warning'
}

const getEntryTotals = (entry) => {
  return (entry.lines || []).reduce((acc, line) => {
    acc.debit += Number(line.debit_amount || 0)
    acc.credit += Number(line.credit_amount || 0)
    return acc
  }, { debit: 0, credit: 0 })
}

const resetNewEntry = () => {
  newEntry.value = {
    entry_date: new Date().toISOString().substring(0, 10),
    description: '',
    lines: [
      { account_id: null, debit_amount: 0, credit_amount: 0, description: '' },
      { account_id: null, debit_amount: 0, credit_amount: 0, description: '' }
    ]
  }
}

const addLine = () => {
  newEntry.value.lines.push({ account_id: null, debit_amount: 0, credit_amount: 0, description: '' })
}

const removeLine = (index) => {
  if (newEntry.value.lines.length <= 2) return
  newEntry.value.lines.splice(index, 1)
}

const onEntriesListPage = ({ page }) => {
  entriesListPage.value = Number(page || 1)
}

const loadAccounts = async () => {
  if (!tenantId.value) return
  const result = await accountingService.getAccounts(tenantId.value, { onlyPostable: true, limit: 4000 })
  if (!result.success) {
    show(result.error || 'No se pudo cargar catalogo de cuentas.', 'error')
    return
  }
  accounts.value = result.data || []
}

const loadEntries = async () => {
  if (!tenantId.value) return

  loading.value = true
  try {
    const result = await accountingService.getManualEntries(tenantId.value, {
      date_from: filters.value.date_from,
      date_to: filters.value.date_to,
      status: filters.value.status,
      limit: 1200
    })

    if (!result.success) {
      show(result.error || 'No se pudieron cargar asientos manuales.', 'error')
      return
    }

    entries.value = result.data?.entries || []
  } finally {
    loading.value = false
  }
}

const loadData = async () => {
  await Promise.all([loadAccounts(), loadEntries()])
}

const openCreateDialog = () => {
  resetNewEntry()
  showCreateDialog.value = true
}

const createEntry = async () => {
  if (!tenantId.value || !canCreateEntry.value) return

  creatingEntry.value = true
  try {
    const result = await accountingService.createManualEntry(tenantId.value, {
      entry_date: newEntry.value.entry_date,
      description: newEntry.value.description,
      lines: newEntry.value.lines
    })

    if (!result.success) {
      show(result.error || 'No se pudo crear el asiento manual.', 'error')
      return
    }

    show('Asiento manual creado en borrador.', 'success')
    showCreateDialog.value = false
    await loadEntries()
  } finally {
    creatingEntry.value = false
  }
}

const postEntry = async (entry) => {
  if (!tenantId.value || !entry?.entry_id) return

  postingEntryId.value = entry.entry_id
  try {
    const result = await accountingService.postEntry(tenantId.value, entry.entry_id)
    if (!result.success) {
      show(result.error || 'No se pudo postear el asiento.', 'error')
      return
    }

    show('Asiento posteado.', 'success')
    await loadEntries()
  } finally {
    postingEntryId.value = null
  }
}

const voidEntry = async (entry) => {
  if (!tenantId.value || !entry?.entry_id) return

  voidingEntryId.value = entry.entry_id
  try {
    const result = await accountingService.voidDraftEntry(tenantId.value, entry.entry_id, 'Anulacion manual desde UI')
    if (!result.success) {
      show(result.error || 'No se pudo anular el asiento.', 'error')
      return
    }

    show('Asiento anulado.', 'success')
    await loadEntries()
  } finally {
    voidingEntryId.value = null
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'dashboard')
  router.push({ path: '/accounting', query: { tab } })
}

watch(() => entries.value.length, () => {
  entriesListPage.value = 1
})

watch(entriesTotalPages, (total) => {
  if (entriesListPage.value > total) entriesListPage.value = total
})

onMounted(loadData)
</script>
