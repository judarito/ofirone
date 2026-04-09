<template>
  <div>
    <!-- Sesión activa -->
    <v-card v-if="hasOpenSession && currentCashSession" color="success" variant="tonal" class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon start>mdi-cash-register</v-icon>
        Sesión de Caja Activa
        <v-spacer></v-spacer>
        <v-btn color="error" variant="elevated" prepend-icon="mdi-cash-lock" @click="openCloseDialog">
          Cerrar Caja
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" sm="6">
            <div class="text-caption text-grey">Caja</div>
            <div class="text-h6">{{ currentCashSession.cash_register?.name }}</div>
          </v-col>
          <v-col cols="12" sm="6">
            <div class="text-caption text-grey">Sede</div>
            <div class="text-h6">{{ currentCashSession.cash_register?.location?.name }}</div>
          </v-col>
          <v-col cols="12" sm="4">
            <div class="text-caption text-grey">Apertura</div>
            <div class="text-body-1">{{ formatDateTime(currentCashSession.opened_at) }}</div>
          </v-col>
          <v-col cols="12" sm="4">
            <div class="text-caption text-grey">Monto Inicial</div>
            <div class="text-body-1 font-weight-bold">{{ formatMoney(currentCashSession.opening_amount) }}</div>
          </v-col>
          <v-col cols="12" sm="4">
            <div class="text-caption text-grey">Duración</div>
            <div class="text-body-1">{{ getDuration(currentCashSession.opened_at) }}</div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Sin sesión: abrir caja -->
    <v-card v-else-if="assignedCount > 0">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-cash-register</v-icon>
        Abrir Caja
      </v-card-title>
      <v-card-text>
        <v-alert v-if="assignedCount === 1" type="info" variant="tonal" class="mb-4">
          Tienes asignada 1 caja. Ingresa el monto de apertura para comenzar.
        </v-alert>
        <v-alert v-else type="info" variant="tonal" class="mb-4">
          Tienes {{ assignedCount }} cajas asignadas. Selecciona una para abrir tu turno.
        </v-alert>

        <v-select
          v-if="assignedCount > 1"
          v-model="selectedCashRegister"
          :items="assignedRegisters"
          item-title="display"
          item-value="cash_register_id"
          label="Selecciona tu caja"
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="mdi-cash-register"
          class="mb-4"
        >
          <template v-slot:item="{ props, item }">
            <v-list-item v-bind="props">
              <template v-slot:prepend>
                <v-icon>mdi-cash-register</v-icon>
              </template>
              <template v-slot:subtitle>
                {{ item.raw.location_name }}
              </template>
            </v-list-item>
          </template>
        </v-select>

        <v-text-field
          v-model.number="openingAmount"
          type="number"
          label="Monto de Apertura"
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="mdi-cash"
          hint="Dinero en efectivo con el que inicias"
          persistent-hint
          min="0"
          step="1000"
        ></v-text-field>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          size="large"
          prepend-icon="mdi-cash-register"
          @click="handleOpenSession"
          :loading="opening"
          :disabled="!canOpen"
        >
          Abrir Caja
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Sin cajas asignadas -->
    <v-card v-else>
      <v-card-text>
        <v-alert type="warning" variant="tonal">
          <div class="text-h6 mb-2">Sin Cajas Asignadas</div>
          <p>No tienes cajas asignadas. Contacta a un administrador para que te asigne una caja registradora.</p>
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- Dialog: Cerrar caja -->
    <v-dialog v-model="closeDialog" max-width="600" persistent>
      <v-card>
        <v-card-title class="bg-error text-white">
          <v-icon start>mdi-cash-lock</v-icon>
          Cerrar Caja
        </v-card-title>
        <v-card-text class="pt-4">
          <v-alert type="info" variant="tonal" class="mb-4">
            Cuenta todo el efectivo en la caja y registra el monto total.
          </v-alert>

          <v-text-field
            v-model.number="countedAmount"
            type="number"
            label="Efectivo Contado *"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-cash"
            hint="Total de efectivo físico en la caja"
            persistent-hint
            min="0"
            step="1000"
            autofocus
          ></v-text-field>

          <v-alert v-if="currentCashSession" type="warning" variant="tonal" class="mt-4">
            <div class="text-caption">Monto Esperado (calculado)</div>
            <div class="text-h6">{{ formatMoney(currentCashSession.opening_amount) }}</div>
            <div class="text-caption mt-2">Basado en: apertura + ventas en efectivo + abonos + ingresos - gastos</div>
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn @click="closeDialog = false" :disabled="closing">Cancelar</v-btn>
          <v-spacer></v-spacer>
          <v-btn color="error" @click="handleCloseSession" :loading="closing" :disabled="!countedAmount">
            Cerrar Caja
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useCashSession } from '@/composables/useCashSession'
import { useNotification } from '@/composables/useNotification'
import { useRouter } from 'vue-router'

const router = useRouter()
const { showSuccess, showError } = useNotification()
const {
  currentCashSession,
  assignedRegisters,
  hasOpenSession,
  assignedCount,
  singleRegisterId,
  loadPOSContext,
  openSession,
  closeSession
} = useCashSession()

const selectedCashRegister = ref(null)
const openingAmount = ref(0)
const opening = ref(false)

const closeDialog = ref(false)
const countedAmount = ref(0)
const closing = ref(false)

const formatMoney = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v || 0)
const formatDateTime = (d) => d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : ''

const getDuration = (startDate) => {
  if (!startDate) return '-'
  const start = new Date(startDate)
  const now = new Date()
  const diff = now - start
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

const canOpen = computed(() => {
  if (assignedCount.value === 1) return openingAmount.value >= 0
  return selectedCashRegister.value && openingAmount.value >= 0
})

const handleOpenSession = async () => {
  const cashRegisterId = assignedCount.value === 1 
    ? singleRegisterId.value 
    : selectedCashRegister.value

  if (!cashRegisterId) {
    showError('Selecciona una caja')
    return
  }

  opening.value = true
  try {
    const r = await openSession(cashRegisterId, openingAmount.value)
    if (r.success) {
      showSuccess('Caja abierta correctamente')
      // Redirigir al POS
      router.push('/pos')
    } else {
      showError(r.error || 'Error al abrir caja')
    }
  } finally {
    opening.value = false
  }
}

const openCloseDialog = () => {
  countedAmount.value = 0
  closeDialog.value = true
}

const handleCloseSession = async () => {
  if (!countedAmount.value && countedAmount.value !== 0) {
    showError('Ingresa el monto contado')
    return
  }

  closing.value = true
  try {
    const r = await closeSession(countedAmount.value)
    if (r.success) {
      showSuccess('Caja cerrada correctamente')
      closeDialog.value = false
      router.push('/cash-sessions')
    } else {
      showError(r.error || 'Error al cerrar caja')
    }
  } finally {
    closing.value = false
  }
}

onMounted(async () => {
  await loadPOSContext()
  
  // Si solo tiene 1 caja, pre-seleccionarla
  if (assignedCount.value === 1 && singleRegisterId.value) {
    selectedCashRegister.value = singleRegisterId.value
  }

  // Preparar display para dropdown
  if (assignedRegisters.value.length > 0) {
    assignedRegisters.value.forEach(reg => {
      reg.display = `${reg.cash_register_name} - ${reg.location_name}`
    })
  }
})
</script>
