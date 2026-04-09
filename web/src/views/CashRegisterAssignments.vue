<template>
  <div>
    <v-card>
      <v-card-text>
        <ListView
          title="Asignación de Cajas a Cajeros"
          icon="mdi-cash-register"
          :items="assignments"
          :total-items="assignments.length"
          :loading="false"
          :page-size="defaultPageSize"
          item-key="assignment_id"
          title-field="user_name"
          subtitle-field="cash_register_name"
          avatar-icon="mdi-account-cash"
          avatar-color="primary"
          empty-message="Sin asignaciones"
          create-button-text="Asignar Caja"
          :editable="false"
          :deletable="false"
          :client-side="true"
          :table-columns="assignmentTableColumns"
          :search-fields="['user_name', 'cash_register_name', 'location_name']"
          view-storage-key="cash-register-assignments"
          @create="openAssignDialog"
        >
          <template #filters>
            <v-row>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="filters.userId"
                  :items="users"
                  item-title="full_name"
                  item-value="user_id"
                  label="Filtrar por Cajero"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="loadAssignments"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="filters.locationId"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  label="Filtrar por Sede"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="loadAssignments"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="filters.isActive"
                  :items="[{text:'Todas',value:null},{text:'Activas',value:true},{text:'Inactivas',value:false}]"
                  item-title="text"
                  item-value="value"
                  label="Estado"
                  variant="outlined"
                  density="compact"
                  @update:model-value="loadAssignments"
                ></v-select>
              </v-col>
            </v-row>
          </template>

          <template #subtitle="{ item }">
            {{ [item.cash_register_name, item.location_name].filter(Boolean).join(' • ') }}
          </template>

          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip :color="item.is_active ? 'success' : 'grey'" size="small" variant="flat">
                {{ item.is_active ? 'Activa' : 'Inactiva' }}
              </v-chip>
              <v-chip size="small" variant="tonal">
                Asignado: {{ formatDate(item.assigned_at) }}
              </v-chip>
            </div>
          </template>

          <template #table-cell-cash_register_name="{ item }">
            {{ item.cash_register_name }}
          </template>

          <template #table-cell-location_name="{ item }">
            {{ item.location_name }}
          </template>

          <template #table-cell-is_active="{ item }">
            <v-chip :color="item.is_active ? 'success' : 'grey'" size="small" variant="flat">
              {{ item.is_active ? 'Activa' : 'Inactiva' }}
            </v-chip>
          </template>

          <template #table-cell-assigned_at="{ item }">
            {{ formatDate(item.assigned_at) }}
          </template>

          <template #actions="{ item }">
            <v-btn
              v-if="item.is_active"
              icon="mdi-close"
              size="small"
              variant="text"
              color="error"
              @click.stop="deactivateAssignment(item)"
            ></v-btn>
            <v-btn
              v-else
              icon="mdi-check"
              size="small"
              variant="text"
              color="success"
              @click.stop="activateAssignment(item)"
            ></v-btn>
          </template>
        </ListView>
      </v-card-text>
    </v-card>

    <!-- Dialog: Asignar caja -->
    <v-dialog v-model="assignDialog" max-width="500">
      <v-card>
        <v-card-title>Asignar Caja a Cajero</v-card-title>
        <v-card-text>
          <v-select
            v-model="newAssignment.userId"
            :items="users"
            item-title="full_name"
            item-value="user_id"
            label="Cajero *"
            variant="outlined"
            density="compact"
            class="mb-3"
          ></v-select>

          <v-select
            v-model="newAssignment.cashRegisterId"
            :items="cashRegisters"
            item-title="display"
            item-value="cash_register_id"
            label="Caja *"
            variant="outlined"
            density="compact"
            class="mb-3"
          ></v-select>

          <v-textarea
            v-model="newAssignment.note"
            label="Nota (opcional)"
            variant="outlined"
            density="compact"
            rows="2"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="assignDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="saveAssignment" :loading="saving">Asignar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import ListView from '@/components/ListView.vue'
import { useTenant } from '@/composables/useTenant'
import { useAuth } from '@/composables/useAuth'
import { useTenantSettings } from '@/composables/useTenantSettings'
import cashAssignmentService from '@/services/cashAssignment.service'
import { getAllUsers } from '@/services/users.service'
import cashService from '@/services/cash.service'
import locationsService from '@/services/locations.service'
import { useNotification } from '@/composables/useNotification'
import { formatDateTime as formatDate } from '@/utils/formatters'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { tenantId } = useTenant()
const { defaultPageSize } = useTenantSettings()
const { userProfile } = useAuth()
const { showSuccess, showError } = useNotification()

const assignments = ref([])
const users = ref([])
const cashRegisters = ref([])
const locations = ref([])
const filters = ref({ userId: null, locationId: null, isActive: true })
const assignmentTableColumns = [
  { title: 'Caja', key: 'cash_register_name', width: '180px' },
  { title: 'Sede', key: 'location_name', width: '160px' },
  { title: 'Estado', key: 'is_active', width: '120px' },
  { title: 'Asignado', key: 'assigned_at', width: '180px' }
]

const assignDialog = ref(false)
const saving = ref(false)
const newAssignment = ref({ userId: null, cashRegisterId: null, note: null })

const loadAssignments = async (page = 1, pageSize = null) => {
  if (!tenantId.value) return
  const ps = pageSize ?? defaultPageSize.value
  try {
    const r = await cashAssignmentService.getAllAssignments(tenantId.value, page, ps, filters.value)
    if (r.success) {
      assignments.value = r.data
    } else {
      console.error('Error loading assignments:', r.error)
      showError(r.error || 'Error al cargar asignaciones')
    }
  } catch (error) {
    console.error('Exception loading assignments:', error)
    showError('Error al cargar asignaciones')
  }
}

const loadUsers = async () => {
  if (!tenantId.value) return
  try {
    const result = await getAllUsers(tenantId.value)
    users.value = result.filter(u => u.is_active)
  } catch (error) {
    console.error('Error loading users:', error)
    showError('Error al cargar usuarios')
  }
}

const loadCashRegisters = async () => {
  if (!tenantId.value) return
  try {
    const r = await cashService.getCashRegisters(tenantId.value, 1, 100, '')
    if (r.success) {
      cashRegisters.value = r.data.map(cr => ({
        ...cr,
        display: `${cr.name} (${cr.location?.name || 'Sin sede'})`
      }))
    } else {
      showError('Error al cargar cajas registradoras')
    }
  } catch (error) {
    showError('Error al cargar cajas registradoras')
  }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const r = await locationsService.getLocations(tenantId.value, 1, 100)
  if (r.success) locations.value = r.data
}

const openAssignDialog = () => {
  newAssignment.value = { userId: null, cashRegisterId: null, note: null }
  assignDialog.value = true
}

const saveAssignment = async () => {
  if (!newAssignment.value.userId || !newAssignment.value.cashRegisterId) {
    showError('Seleccione cajero y caja')
    return
  }

  saving.value = true
  try {
    const r = await cashAssignmentService.assignCashRegisterToUser(
      tenantId.value,
      newAssignment.value.cashRegisterId,
      newAssignment.value.userId,
      userProfile.value.user_id,
      true,
      newAssignment.value.note
    )

    if (r.success) {
      showSuccess('Caja asignada correctamente')
      assignDialog.value = false
      loadAssignments()
    } else {
      showError(r.error || 'Error al asignar caja')
    }
  } finally {
    saving.value = false
  }
}

const deactivateAssignment = async (item) => {
  const r = await cashAssignmentService.assignCashRegisterToUser(
    tenantId.value,
    item.cash_register_id,
    item.user_id,
    userProfile.value.user_id,
    false,
    'Desactivada'
  )

  if (r.success) {
    showSuccess('Asignación desactivada')
    loadAssignments()
  } else {
    showError(r.error || 'Error al desactivar')
  }
}

const activateAssignment = async (item) => {
  const r = await cashAssignmentService.assignCashRegisterToUser(
    tenantId.value,
    item.cash_register_id,
    item.user_id,
    userProfile.value.user_id,
    true,
    'Reactivada'
  )

  if (r.success) {
    showSuccess('Asignación activada')
    loadAssignments()
  } else {
    showError(r.error || 'Error al activar')
  }
}

onMounted(async () => {
  await Promise.all([loadUsers(), loadCashRegisters(), loadLocations()])
  loadAssignments()
})
</script>
