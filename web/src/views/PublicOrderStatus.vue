<template>
  <div class="order-status" data-testid="public-order-status-page">
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
          <v-chip :color="displayOrderStatus.color" variant="flat" size="small">
            {{ displayOrderStatus.label }}
          </v-chip>
          <v-chip :color="displayPaymentStatus.color" variant="tonal" size="small">
            {{ displayPaymentStatus.label }}
          </v-chip>
        </div>

        <v-alert
          v-if="route.query.mp_status === 'success'"
          type="success"
          variant="tonal"
          class="mt-4"
        >
          <div class="font-weight-medium">{{ gatewayReturnTitle }}</div>
          <div class="text-body-2 mt-1">{{ gatewayReturnMessage }}</div>
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

        <v-card variant="outlined" class="order-status__card order-status__timeline-card mt-6">
          <v-card-text>
            <div class="order-status__timeline-title">Seguimiento del pedido</div>
            <div class="order-status__timeline">
              <div
                v-for="step in orderTimeline"
                :key="step.key"
                class="order-status__timeline-step"
                :class="{
                  'order-status__timeline-step--done': step.state === 'done',
                  'order-status__timeline-step--active': step.state === 'active',
                  'order-status__timeline-step--blocked': step.state === 'blocked',
                }"
              >
                <div class="order-status__timeline-dot">
                  <v-icon size="16">{{ step.icon }}</v-icon>
                </div>
                <div>
                  <div class="order-status__timeline-label">{{ step.label }}</div>
                  <div class="order-status__timeline-copy">{{ step.copy }}</div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>

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
          <v-btn
            v-if="whatsappPhone"
            :href="orderWhatsappUrl"
            target="_blank"
            rel="noreferrer"
            color="success"
            variant="tonal"
            prepend-icon="mdi-whatsapp"
          >
            Contactar tienda
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
import onlineStoreService from '@/services/onlineStore.service'

const route = useRoute()

const loading = ref(true)
const order = ref(null)
const errorMessage = ref('')
const syncingGateway = ref(false)
const gatewaySyncAttempts = ref(0)
const gatewaySyncMessage = ref('')
const storeContact = ref(null)

const GATEWAY_SYNC_DELAYS_MS = [0, 1200, 2500, 4500, 7000]

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
  const queryStatus = String(route.query.mp_status || '').trim().toLowerCase()
  const gatewayStatus = String(order.value?.mercado_pago_status || '').trim().toLowerCase()
  const orderStatus = String(order.value?.status || '').trim().toUpperCase()
  const shouldBlockRetry = ['success', 'pending'].includes(queryStatus)
    || ['approved', 'authorized', 'in_process', 'pending'].includes(gatewayStatus)
    || orderStatus === 'PROCESSING'

  return Boolean(
    !shouldBlockRetry
    &&
    order.value?.payment_mode === 'GATEWAY'
    && order.value?.status === 'PENDING'
    && order.value?.payment_status === 'PENDING'
    && order.value?.payment_link
    && !isOrderExpired(order.value?.expires_at),
  )
})

const paymentFlowSnapshot = computed(() => {
  const queryStatus = String(route.query.mp_status || '').trim().toLowerCase()
  const orderStatus = String(order.value?.status || '').trim().toUpperCase()
  const paymentStatus = String(order.value?.payment_status || '').trim().toUpperCase()

  if (queryStatus === 'success' && paymentStatus !== 'PAID') {
    return {
      order: { label: 'Validando pago', color: 'info' },
      payment: { label: 'Aprobación recibida', color: 'success' },
    }
  }

  if (queryStatus === 'pending' && paymentStatus !== 'PAID') {
    return {
      order: { label: 'Esperando confirmación', color: 'info' },
      payment: { label: 'Pago en revisión', color: 'warning' },
    }
  }

  if (queryStatus === 'failure' && paymentStatus !== 'PAID' && orderStatus !== 'COMPLETED') {
    return {
      order: { label: 'Pago no completado', color: 'warning' },
      payment: { label: 'Inténtalo de nuevo', color: 'warning' },
    }
  }

  return {
    order: { label: orderStatusLabel(orderStatus), color: orderStatusColor(orderStatus) },
    payment: { label: paymentStatusLabel(paymentStatus), color: paymentStatusColor(paymentStatus) },
  }
})

const displayOrderStatus = computed(() => paymentFlowSnapshot.value.order)
const displayPaymentStatus = computed(() => paymentFlowSnapshot.value.payment)
const whatsappPhone = computed(() => normalizeWhatsappPhone(storeContact.value?.support_whatsapp))
const orderWhatsappUrl = computed(() => {
  const message = [
    `Hola, quiero consultar por mi pedido #${order.value?.order_number || ''}.`,
    `Total: ${formatMoney(order.value?.total)}.`,
    `Estado de pago: ${paymentStatusLabel(String(order.value?.payment_status || '').toUpperCase())}.`,
  ].join(' ')
  return buildWhatsappUrl(message)
})

const orderTimeline = computed(() => {
  const orderStatus = String(order.value?.status || '').trim().toUpperCase()
  const paymentStatus = String(order.value?.payment_status || '').trim().toUpperCase()
  const queryStatus = String(route.query.mp_status || '').trim().toLowerCase()
  const gatewayReturnedSuccess = queryStatus === 'success'
  const paymentIsConfirmed = paymentStatus === 'PAID'
  const paymentIsFailed = paymentStatus === 'FAILED' || orderStatus === 'CANCELLED'
  const waitingGatewayValidation = gatewayReturnedSuccess && !paymentIsConfirmed && !paymentIsFailed
  const preparing = paymentIsConfirmed || orderStatus === 'PROCESSING'
  const completed = orderStatus === 'COMPLETED' && paymentIsConfirmed

  return [
    {
      key: 'received',
      icon: 'mdi-receipt-text-check',
      label: 'Pedido recibido',
      copy: 'La tienda ya tiene el resumen de tu compra.',
      state: 'done',
    },
    {
      key: 'payment',
      icon: paymentIsFailed ? 'mdi-alert-circle' : paymentIsConfirmed ? 'mdi-credit-card-check' : 'mdi-timer-sand',
      label: paymentIsConfirmed ? 'Pago confirmado' : paymentIsFailed ? 'Pago no aprobado' : 'Pago en validación',
      copy: paymentIsConfirmed
        ? 'El pago quedó aprobado y no necesitas pagarlo de nuevo.'
        : paymentIsFailed
          ? 'El pago fue rechazado o el pedido fue cancelado.'
          : waitingGatewayValidation
            ? 'Mercado Pago devolvió aprobación; estamos sincronizando el pedido.'
            : 'La tienda o la pasarela todavía están validando el pago.',
      state: paymentIsConfirmed ? 'done' : paymentIsFailed ? 'blocked' : 'active',
    },
    {
      key: 'preparing',
      icon: 'mdi-package-variant-closed',
      label: 'Preparación',
      copy: preparing ? 'La compra puede avanzar a despacho o entrega.' : 'Se activa cuando el pago esté confirmado.',
      state: completed ? 'done' : preparing ? 'active' : 'pending',
    },
    {
      key: 'completed',
      icon: 'mdi-check-decagram',
      label: 'Finalizado',
      copy: completed ? 'El pedido quedó confirmado por la tienda.' : 'Aparecerá como finalizado cuando la tienda lo cierre.',
      state: completed ? 'done' : 'pending',
    },
  ]
})

const gatewayReturnTitle = computed(() => {
  if (order.value?.payment_status === 'PAID') return 'Pago confirmado'
  if (syncingGateway.value) return 'Validando pago con Mercado Pago'
  return 'Aprobación recibida'
})

const gatewayReturnMessage = computed(() => {
  if (order.value?.payment_status === 'PAID') {
    return 'El pago fue validado y el pedido ya quedó actualizado.'
  }

  if (gatewaySyncMessage.value) return gatewaySyncMessage.value

  return 'Mercado Pago devolvió tu compra como aprobada. Estamos validando el pago y actualizando el pedido.'
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

function normalizeWhatsappPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('57') && digits.length >= 12) return digits
  if (digits.length === 10) return `57${digits}`
  return digits
}

function buildWhatsappUrl(message) {
  if (!whatsappPhone.value) return '#'
  return `https://wa.me/${whatsappPhone.value}?text=${encodeURIComponent(message)}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function queryValue(value) {
  if (Array.isArray(value)) return value[0]
  return value
}

function isOrderPaid() {
  return String(order.value?.payment_status || '').trim().toUpperCase() === 'PAID'
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

async function loadStoreContact() {
  const slug = String(order.value?.store_slug || '').trim()
  if (!slug) {
    storeContact.value = null
    return
  }

  const result = await onlineStoreService.getPublicStore(slug)
  storeContact.value = result.success ? result.data : null
}

async function revalidateGatewayOrderIfNeeded() {
  const orderId = String(route.params.orderId || '').trim()
  const queryStatus = String(route.query.mp_status || '').trim().toLowerCase()
  if (!orderId || !['success', 'pending'].includes(queryStatus)) return
  if (isOrderPaid()) return

  syncingGateway.value = true
  gatewaySyncMessage.value = queryStatus === 'success'
    ? 'Recibimos el retorno exitoso. Estamos confirmando el pago directamente con Mercado Pago.'
    : 'Estamos consultando si Mercado Pago ya actualizó el estado del pago.'

  try {
    for (let index = 0; index < GATEWAY_SYNC_DELAYS_MS.length; index += 1) {
      const delay = GATEWAY_SYNC_DELAYS_MS[index]
      if (delay > 0) await sleep(delay)
      if (isOrderPaid()) break

      gatewaySyncAttempts.value = index + 1
      gatewaySyncMessage.value = `Validando pago con Mercado Pago... intento ${gatewaySyncAttempts.value} de ${GATEWAY_SYNC_DELAYS_MS.length}.`

      const result = await onlineStoreService.syncGatewayOrder(orderId, {
        payment_id: queryValue(route.query.payment_id) || queryValue(route.query.collection_id) || queryValue(route.query.id),
        collection_id: queryValue(route.query.collection_id),
        preference_id: queryValue(route.query.preference_id),
      })

      await loadOrder()
      if (result?.success && isOrderPaid()) {
        gatewaySyncMessage.value = 'Pago confirmado. El pedido ya quedó actualizado.'
        break
      }

      if (isOrderPaid()) {
        gatewaySyncMessage.value = 'Pago confirmado. El pedido ya quedó actualizado.'
        break
      }
    }

    if (!isOrderPaid()) {
      gatewaySyncMessage.value = 'Mercado Pago recibió el retorno, pero todavía no entrega la confirmación final. Puedes dejar esta pantalla abierta o revisar de nuevo en unos segundos.'
    }
  } catch (error) {
    gatewaySyncMessage.value = error?.message || 'No pudimos validar el pago automáticamente. El equipo de la tienda podrá revalidarlo desde ventas online.'
  } finally {
    syncingGateway.value = false
  }
}

onMounted(async () => {
  await loadOrder()
  await loadStoreContact()
  await revalidateGatewayOrderIfNeeded()
  if (!isOrderPaid()) await loadOrder()
})
</script>

<style scoped>
.order-status {
  min-height: 100vh;
  color: #0f172a;
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.10) 0%, transparent 26%),
    radial-gradient(circle at 85% 8%, rgba(245, 158, 11, 0.08) 0%, transparent 18%),
    linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
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
  color: #0f172a;
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
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(12px);
}

.order-status__card :deep(.v-card-title),
.order-status__card :deep(.v-card-text),
.order-status__card :deep(.v-list-item-title),
.order-status__card :deep(.v-list-item-subtitle),
.order-status__card :deep(.v-list-item__append),
.order-status__card :deep(.v-list),
.order-status__card :deep(.v-divider),
.order-status__card :deep(strong),
.order-status__card :deep(span),
.order-status__card :deep(div) {
  color: #0f172a;
}

.order-status__card :deep(.v-list) {
  background: transparent;
}

.order-status__card :deep(.v-list-item) {
  border-radius: 14px;
}

.order-status__card :deep(.v-list-item + .v-list-item) {
  margin-top: 4px;
}

.order-status__card :deep(.text-medium-emphasis),
.order-status__card :deep(.v-list-item-subtitle),
.order-status__card :deep(.text-caption) {
  color: #64748b !important;
}

.order-status__card :deep(.v-card-title) {
  color: #0f172a !important;
}

.order-status__card :deep(.v-divider) {
  opacity: 1;
  border-color: rgba(148, 163, 184, 0.18);
}

.order-status__proof-link {
  font-size: 0.85rem;
  color: #1e63b7;
  text-decoration: none;
}

.order-status__proof-link:hover {
  text-decoration: underline;
}

.order-status__timeline-card {
  overflow: hidden;
}

.order-status__timeline-title {
  margin-bottom: 16px;
  font-weight: 800;
  color: #0f172a;
}

.order-status__timeline {
  display: grid;
  gap: 0;
}

.order-status__timeline-step {
  position: relative;
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 12px;
  padding: 0 0 18px;
}

.order-status__timeline-step:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 18px;
  top: 38px;
  bottom: 0;
  width: 2px;
  background: #dbe4f0;
}

.order-status__timeline-dot {
  position: relative;
  z-index: 1;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  background: #eef2f7;
  border: 1px solid #dbe4f0;
}

.order-status__timeline-label {
  font-weight: 800;
  color: #0f172a;
}

.order-status__timeline-copy {
  margin-top: 3px;
  font-size: 0.88rem;
  color: #64748b;
  line-height: 1.45;
}

.order-status__timeline-step--done .order-status__timeline-dot {
  color: #047857;
  background: #d1fae5;
  border-color: #a7f3d0;
}

.order-status__timeline-step--active .order-status__timeline-dot {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #bfdbfe;
}

.order-status__timeline-step--blocked .order-status__timeline-dot {
  color: #b91c1c;
  background: #fee2e2;
  border-color: #fecaca;
}

.order-status__timeline-step--done:not(:last-child)::after {
  background: #a7f3d0;
}
</style>
