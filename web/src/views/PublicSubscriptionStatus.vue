<template>
  <div class="subscription-status">
    <div class="subscription-status__shell">
      <div v-if="loading" class="d-flex align-center justify-center ga-3 py-16 text-medium-emphasis">
        <v-progress-circular indeterminate color="primary" />
        Consultando suscripción...
      </div>

      <v-alert v-else-if="errorMessage" type="error" variant="tonal">
        {{ errorMessage }}
      </v-alert>

      <template v-else-if="signup">
        <section class="subscription-status__hero">
          <div class="subscription-status__eyebrow">OfirOne</div>
          <h1>{{ heroTitle }}</h1>
          <p>{{ heroMessage }}</p>
          <div class="subscription-status__chips">
            <v-chip :color="statusMeta.color" variant="flat">{{ statusMeta.label }}</v-chip>
            <v-chip color="primary" variant="tonal">{{ signup.plan_name }}</v-chip>
            <v-chip color="success" variant="tonal">{{ formatMoney(signup.total) }}</v-chip>
          </div>
        </section>

        <v-card class="subscription-status__card" variant="outlined">
          <v-card-text>
            <div class="subscription-status__timeline">
              <div
                v-for="step in timeline"
                :key="step.key"
                class="subscription-status__step"
                :class="`subscription-status__step--${step.state}`"
              >
                <div class="subscription-status__dot">
                  <v-icon size="16">{{ step.icon }}</v-icon>
                </div>
                <div>
                  <strong>{{ step.label }}</strong>
                  <span>{{ step.copy }}</span>
                </div>
              </div>
            </div>

            <v-alert v-if="signup.error_message" type="warning" variant="tonal" class="mt-5">
              {{ signup.error_message }}
            </v-alert>

            <div class="subscription-status__actions">
              <v-btn
                v-if="showContinuePayment"
                :href="signup.payment_url"
                color="primary"
                variant="flat"
              >
                Continuar pago
              </v-btn>
              <v-btn
                v-if="signup.status === 'PROVISIONED'"
                to="/login"
                color="primary"
                variant="flat"
              >
                Ir al login
              </v-btn>
              <v-btn variant="outlined" to="/planes">
                Ver planes
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import subscriptionSignupService from '@/services/subscriptionSignup.service'

const route = useRoute()
const loading = ref(true)
const errorMessage = ref('')
const signup = ref(null)

const statusMeta = computed(() => {
  const status = String(signup.value?.status || '').toUpperCase()
  if (status === 'PROVISIONED') return { label: 'Cuenta creada', color: 'success' }
  if (status === 'PAID' || status === 'PROVISIONING') return { label: 'Pago confirmado', color: 'info' }
  if (status === 'FAILED' && paymentWasApproved.value) return { label: 'Pago aprobado, en revisión', color: 'warning' }
  if (status === 'FAILED') return { label: 'Requiere revisión', color: 'warning' }
  if (status === 'CANCELLED') return { label: 'Cancelado', color: 'error' }
  return { label: 'Pago pendiente', color: 'warning' }
})

const paymentWasApproved = computed(() => {
  const status = String(signup.value?.status || '').toUpperCase()
  return ['PAID', 'PROVISIONING', 'PROVISIONED'].includes(status)
    || Boolean(signup.value?.paid_at)
    || String(route.query.mp_status || '').toLowerCase() === 'success'
})

const heroTitle = computed(() => {
  const status = String(signup.value?.status || '').toUpperCase()
  if (status === 'PROVISIONED') return 'Tu cuenta ya está lista'
  if (status === 'PAID' || status === 'PROVISIONING') return 'Pago recibido, creando tu cuenta'
  if (status === 'FAILED' && paymentWasApproved.value) return 'Pago recibido, necesitamos revisar tu cuenta'
  if (route.query.mp_status === 'success') return 'Recibimos la aprobación del pago'
  if (route.query.mp_status === 'failure') return 'El pago no quedó aprobado'
  return 'Estamos esperando el pago'
})

const heroMessage = computed(() => {
  const status = String(signup.value?.status || '').toUpperCase()
  if (status === 'PROVISIONED') return 'Te enviamos un correo para crear tu contraseña e ingresar como administrador.'
  if (status === 'PAID' || status === 'PROVISIONING') return 'Estamos aprovisionando el tenant y preparando el acceso administrador.'
  if (status === 'FAILED' && paymentWasApproved.value) return 'El cobro ya fue recibido, pero la creación automática de la cuenta necesita revisión. No realices otro pago.'
  if (route.query.mp_status === 'success') return 'Mercado Pago regresó como exitoso. El webhook terminará de validar y crear la cuenta.'
  if (route.query.mp_status === 'failure') return 'Puedes reintentar el pago si la preferencia sigue activa.'
  return 'Cuando Mercado Pago confirme el cobro, crearemos tu tenant automáticamente.'
})

const timeline = computed(() => {
  const status = String(signup.value?.status || '').toUpperCase()
  const paid = paymentWasApproved.value
  const provisioned = status === 'PROVISIONED'
  const failed = status === 'FAILED'
  const provisionFailed = failed && paid

  return [
    {
      key: 'request',
      icon: 'mdi-file-document-check',
      label: 'Solicitud recibida',
      copy: `Registramos ${signup.value?.business_name || 'tu negocio'} con el plan ${signup.value?.plan_name || ''}.`,
      state: 'done',
    },
    {
      key: 'payment',
      icon: paid ? 'mdi-credit-card-check' : failed ? 'mdi-alert-circle' : 'mdi-timer-sand',
      label: paid ? 'Pago confirmado' : failed ? 'Pago con error' : 'Pago pendiente',
      copy: paid ? 'Mercado Pago confirmó el primer periodo.' : 'Aún esperamos confirmación del cobro.',
      state: paid ? 'done' : failed ? 'blocked' : 'active',
    },
    {
      key: 'provision',
      icon: provisioned ? 'mdi-domain-plus' : provisionFailed ? 'mdi-alert-circle' : 'mdi-cog-clockwise',
      label: provisioned ? 'Tenant aprovisionado' : provisionFailed ? 'Creación de cuenta en revisión' : 'Creación de cuenta',
      copy: provisioned ? 'La empresa y el usuario administrador ya existen.' : provisionFailed ? 'El pago está aprobado, pero necesitamos revisar el acceso administrador.' : 'Se ejecuta automáticamente después del pago.',
      state: provisioned ? 'done' : provisionFailed ? 'blocked' : paid ? 'active' : 'pending',
    },
    {
      key: 'access',
      icon: 'mdi-email-fast',
      label: 'Acceso enviado',
      copy: provisioned ? 'Revisa tu correo para crear contraseña.' : 'Lo enviaremos cuando la cuenta quede lista.',
      state: provisioned ? 'done' : 'pending',
    },
  ]
})

const showContinuePayment = computed(() => {
  return ['PENDING_PAYMENT', 'FAILED'].includes(String(signup.value?.status || '').toUpperCase())
    && !paymentWasApproved.value
    && Boolean(signup.value?.payment_url)
})

function formatMoney(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

async function loadStatus() {
  loading.value = true
  errorMessage.value = ''
  const signupId = String(route.params.signupId || '').trim()
  try {
    const result = await subscriptionSignupService.getSignupStatus(signupId)
    if (!result.success) throw new Error(result.error || 'No se pudo consultar la suscripción.')
    signup.value = result.data
  } catch (error) {
    errorMessage.value = error.message || 'No se pudo consultar la suscripción.'
  } finally {
    loading.value = false
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollAfterGatewayReturn() {
  const queryStatus = String(route.query.mp_status || '').toLowerCase()
  if (!['success', 'pending'].includes(queryStatus)) return

  for (const delay of [1500, 2500, 4500, 7000]) {
    if (['PROVISIONED', 'FAILED'].includes(String(signup.value?.status || '').toUpperCase())) break
    await sleep(delay)
    await loadStatus()
  }
}

onMounted(async () => {
  await loadStatus()
  await pollAfterGatewayReturn()
})
</script>

<style scoped>
.subscription-status {
  min-height: 100vh;
  padding: 28px 16px 80px;
  color: #111827;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.14), transparent 28%),
    radial-gradient(circle at 82% 12%, rgba(16, 185, 129, 0.14), transparent 20%),
    linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
}

.subscription-status__shell {
  width: min(720px, 100%);
  margin: 0 auto;
}

.subscription-status__hero,
.subscription-status__card {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.10);
  backdrop-filter: blur(14px);
}

.subscription-status__hero {
  padding: 32px;
  margin-bottom: 20px;
}

.subscription-status__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.76rem;
  color: #2563eb;
  font-weight: 900;
}

.subscription-status__hero h1 {
  margin: 8px 0 10px;
  font-size: clamp(2.2rem, 6vw, 4rem);
  line-height: 0.95;
  letter-spacing: -0.06em;
}

.subscription-status__hero p {
  color: #475569;
  line-height: 1.6;
}

.subscription-status__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.subscription-status__timeline {
  display: grid;
}

.subscription-status__step {
  position: relative;
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 12px;
  padding-bottom: 20px;
}

.subscription-status__step:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 19px;
  top: 40px;
  bottom: 0;
  width: 2px;
  background: #dbe4f0;
}

.subscription-status__dot {
  position: relative;
  z-index: 1;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #eef2f7;
  color: #64748b;
  border: 1px solid #dbe4f0;
}

.subscription-status__step strong {
  display: block;
}

.subscription-status__step span {
  display: block;
  margin-top: 3px;
  color: #64748b;
  line-height: 1.45;
}

.subscription-status__step--done .subscription-status__dot {
  color: #047857;
  background: #d1fae5;
  border-color: #a7f3d0;
}

.subscription-status__step--active .subscription-status__dot {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #bfdbfe;
}

.subscription-status__step--blocked .subscription-status__dot {
  color: #b91c1c;
  background: #fee2e2;
  border-color: #fecaca;
}

.subscription-status__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}
</style>
