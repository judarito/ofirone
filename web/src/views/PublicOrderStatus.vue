<template>
  <div class="order-status">
    <div class="order-status__container">
      <div v-if="loading" class="d-flex align-center justify-center ga-3 py-16 text-medium-emphasis">
        <v-progress-circular indeterminate color="primary" />
        Cargando pedido...
      </div>

      <template v-else-if="order">
        <div class="order-status__header">
          <div class="order-status__store">{{ order.store_name }}</div>
          <h1 class="order-status__title">Pedido #{{ order.order_number }}</h1>
          <div class="order-status__date">{{ formatDate(order.created_at) }}</div>
        </div>

        <div class="order-status__badges">
          <v-chip :color="orderStatusColor(order.status)" variant="flat" size="small">
            {{ orderStatusLabel(order.status) }}
          </v-chip>
          <v-chip :color="paymentStatusColor(order.payment_status)" variant="tonal" size="small">
            {{ paymentStatusLabel(order.payment_status) }}
          </v-chip>
        </div>

        <v-alert
          v-if="route.query.mp_status === 'success'"
          type="success"
          variant="tonal"
          class="mt-4"
        >
          Mercado Pago devolvió tu compra como aprobada. Estamos validando el pago y actualizando el pedido.
        </v-alert>

        <v-alert
          v-else-if="route.query.mp_status === 'pending'"
          type="info"
          variant="tonal"
          class="mt-4"
        >
          El pago sigue pendiente. Puedes revisar este estado en unos segundos o continuar el checkout si aún está abierto.
        </v-alert>

        <v-alert
          v-else-if="route.query.mp_status === 'failure'"
          type="warning"
          variant="tonal"
          class="mt-4"
        >
          El pago no quedó aprobado. Si el link sigue activo puedes intentarlo otra vez desde este pedido.
        </v-alert>

        <v-card variant="outlined" class="order-status__card mt-6">
          <v-card-title class="text-body-1 font-weight-bold px-4 pt-4">Productos</v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="(line, i) in order.lines"
              :key="i"
              :subtitle="line.sku ? `SKU: ${line.sku}` : undefined"
            >
              <template #title>
                <span class="text-body-2">
                  {{ line.quantity }} × {{ line.product_name }}
                  <span v-if="line.variant_name" class="text-medium-emphasis"> — {{ line.variant_name }}</span>
                </span>
              </template>
              <template #append>
                <span class="text-body-2 font-weight-medium">{{ formatMoney(line.line_total) }}</span>
              </template>
            </v-list-item>
          </v-list>
          <v-divider />
          <div class="d-flex justify-space-between align-center px-4 py-3">
            <span class="text-body-2 text-medium-emphasis">Total</span>
            <strong>{{ formatMoney(order.total) }}</strong>
          </div>
        </v-card>

        <v-card v-if="order.delivery_address || order.customer_note || order.payment_proof_url" variant="outlined" class="order-status__card mt-4">
          <v-card-text>
            <div v-if="order.delivery_address" class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">Dirección de entrega</div>
              <div class="text-body-2">{{ order.delivery_address }}</div>
            </div>
            <div v-if="order.customer_note" class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">Nota del cliente</div>
              <div class="text-body-2">{{ order.customer_note }}</div>
            </div>
            <div v-if="order.payment_proof_url">
              <div class="text-caption text-medium-emphasis mb-1">Comprobante de pago</div>
              <a :href="order.payment_proof_url" target="_blank" rel="noreferrer" class="order-status__proof-link">
                Ver comprobante adjunto
              </a>
            </div>
          </v-card-text>
        </v-card>

        <div class="mt-6 d-flex flex-wrap ga-3">
          <v-btn
            v-if="showContinuePayment"
            :href="order.payment_link"
            color="primary"
            variant="flat"
          >
            Continuar pago
          </v-btn>
          <v-btn
            v-if="order.store_slug"
            :to="`/s/${order.store_slug}`"
            :color="showContinuePayment ? undefined : 'primary'"
            :variant="showContinuePayment ? 'outlined' : 'flat'"
          >
            Ir a la tienda
          </v-btn>
        </div>
      </template>

      <v-alert v-else type="error" variant="tonal" class="mt-6">
        {{ errorMessage || 'No encontramos el pedido solicitado.' }}
      </v-alert>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '@/plugins/supabase'

const route = useRoute()

const loading = ref(true)
const order = ref(null)
const errorMessage = ref('')

const STATUS_LABELS = {
  PENDING: 'Pendiente',
  PROCESSING: 'En proceso',
  COMPLETED: 'Confirmado',
  CANCELLED: 'Cancelado',
}

const STATUS_COLORS = {
  PENDING: 'warning',
  PROCESSING: 'info',
  COMPLETED: 'success',
  CANCELLED: 'error',
}

const PAYMENT_LABELS = {
  PENDING: 'Pago pendiente',
  PAID: 'Pagado',
  FAILED: 'Pago fallido',
  REFUNDED: 'Reembolsado',
}

const PAYMENT_COLORS = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'error',
  REFUNDED: 'info',
}

function isOrderExpired(value) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return false
  return timestamp <= Date.now()
}

const showContinuePayment = computed(() => {
  return Boolean(
    order.value?.payment_mode === 'GATEWAY'
    && order.value?.payment_status === 'PENDING'
    && order.value?.payment_link
    && !isOrderExpired(order.value?.expires_at),
  )
})

function orderStatusLabel(status) {
  return STATUS_LABELS[status] || status
}

function orderStatusColor(status) {
  return STATUS_COLORS[status] || 'default'
}

function paymentStatusLabel(status) {
  return PAYMENT_LABELS[status] || status
}

function paymentStatusColor(status) {
  return PAYMENT_COLORS[status] || 'default'
}

function formatMoney(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(amount || 0))
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(dateStr))
}

async function loadOrder() {
  const orderId = route.params.orderId
  if (!orderId) {
    errorMessage.value = 'No se especificó el ID del pedido.'
    loading.value = false
    return
  }

  try {
    const { data, error } = await supabase.rpc('fn_get_public_order_status', {
      p_order_id: orderId,
    })
    if (error) throw error
    if (data?.error) {
      errorMessage.value = data.error
    } else {
      order.value = {
        ...data,
        lines: Array.isArray(data.lines) ? data.lines : [],
      }
    }
  } catch (err) {
    errorMessage.value = err?.message || 'No se pudo cargar el pedido.'
  } finally {
    loading.value = false
  }
}

onMounted(loadOrder)
</script>

<style scoped>
.order-status {
  min-height: 100vh;
  background: #f8fafc;
  padding: 24px 16px 64px;
}

.order-status__container {
  max-width: 640px;
  margin: 0 auto;
}

.order-status__header {
  margin-bottom: 16px;
}

.order-status__store {
  font-size: 0.8rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.order-status__title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 4px;
}

.order-status__date {
  font-size: 0.85rem;
  color: #64748b;
}

.order-status__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.order-status__card {
  border-radius: 8px;
}

.order-status__proof-link {
  font-size: 0.85rem;
  color: #1e63b7;
  text-decoration: none;
}

.order-status__proof-link:hover {
  text-decoration: underline;
}
</style>
