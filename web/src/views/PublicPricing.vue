<template>
  <div class="pricing-page">
    <section class="pricing-hero">
      <div class="pricing-hero__copy">
        <div class="pricing-eyebrow">OfirOne SaaS</div>
        <h1>Activa tu operación comercial en minutos.</h1>
        <p>
          Elige un plan, paga el primer periodo y creamos tu tenant automáticamente
          con usuario administrador, configuración base y suscripción activa.
        </p>
      </div>
      <div class="pricing-hero__panel">
        <span>Alta autónoma</span>
        <strong>Pago inicial con Mercado Pago</strong>
        <small>Renovación manual en esta primera fase.</small>
      </div>
    </section>

    <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-5">
      {{ errorMessage }}
    </v-alert>

    <div v-if="loading" class="d-flex align-center justify-center ga-3 py-16 text-medium-emphasis">
      <v-progress-circular indeterminate color="primary" />
      Cargando planes...
    </div>

    <template v-else>
      <section class="pricing-grid">
        <article
          v-for="plan in publicPlans"
          :key="plan.plan_id"
          class="pricing-card"
          :class="{ 'pricing-card--selected': selectedPlanPrice?.plan_price_id === getPrimaryPrice(plan)?.plan_price_id }"
        >
          <div class="pricing-card__head">
            <div>
              <div class="pricing-card__code">{{ plan.code }}</div>
              <h2>{{ plan.name }}</h2>
            </div>
            <v-chip v-if="plan.code === 'pro'" color="success" variant="flat" size="small">Popular</v-chip>
          </div>
          <p class="pricing-card__description">{{ plan.description || 'Plan comercial para operar OfirOne.' }}</p>
          <div class="pricing-card__price">
            <strong>{{ formatMoney(getPrimaryPrice(plan)?.amount) }}</strong>
            <span>/ {{ intervalLabel(getPrimaryPrice(plan)?.billing_interval) }}</span>
          </div>
          <ul>
            <li v-for="feature in visibleFeatures(plan)" :key="feature.feature_code">
              {{ feature.feature_name }}
            </li>
            <li v-for="limit in visibleLimits(plan)" :key="limit.limit_code">
              {{ limit.limit_name }}: {{ formatLimit(limit) }}
            </li>
          </ul>
          <v-btn
            class="pricing-card__button"
            block
            color="primary"
            variant="flat"
            :disabled="!getPrimaryPrice(plan)"
            @click="selectPlan(plan)"
          >
            Elegir {{ plan.name }}
          </v-btn>
        </article>
      </section>

      <section class="signup-section" ref="signupSection">
        <div class="signup-section__copy">
          <div class="pricing-eyebrow">Checkout de suscripción</div>
          <h2>{{ selectedPlan ? `Empezar con ${selectedPlan.name}` : 'Selecciona un plan' }}</h2>
          <p>
            Usaremos estos datos para crear la empresa y el usuario administrador.
            Después del pago recibirás un correo para crear tu contraseña.
          </p>
        </div>

        <v-card class="signup-card" variant="outlined">
          <v-card-text>
            <v-row>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.business_name" label="Nombre del negocio *" variant="outlined" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.legal_name" label="Razón social" variant="outlined" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.admin_full_name" label="Nombre del responsable *" variant="outlined" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.admin_email" label="Email administrador *" type="email" variant="outlined" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="form.phone" label="WhatsApp / teléfono" variant="outlined" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="form.tax_id" label="NIT / identificación" variant="outlined" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="form.address" label="Dirección" variant="outlined" />
              </v-col>
            </v-row>

            <div class="signup-summary">
              <span>Plan seleccionado</span>
              <strong>{{ selectedPlan?.name || 'Sin plan' }} · {{ formatMoney(selectedPlanPrice?.amount) }}</strong>
            </div>

            <v-btn
              class="mt-5"
              block
              color="primary"
              size="large"
              :loading="submitting"
              :disabled="!selectedPlanPrice"
              @click="submitSignup"
            >
              Pagar y crear mi cuenta
            </v-btn>
          </v-card-text>
        </v-card>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import subscriptionSignupService from '@/services/subscriptionSignup.service'

const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const plans = ref([])
const selectedPlan = ref(null)
const selectedPlanPrice = ref(null)
const signupSection = ref(null)

const form = reactive({
  business_name: '',
  legal_name: '',
  tax_id: '',
  admin_full_name: '',
  admin_email: '',
  phone: '',
  address: '',
})

const publicPlans = computed(() => plans.value.filter((plan) => getPrimaryPrice(plan)))

function getPrimaryPrice(plan) {
  const prices = Array.isArray(plan?.prices) ? plan.prices : []
  return prices.find((price) => price.billing_interval === 'monthly') || prices[0] || null
}

function visibleFeatures(plan) {
  return (plan?.features || []).filter((item) => item.is_enabled !== false).slice(0, 5)
}

function visibleLimits(plan) {
  return (plan?.limits || []).slice(0, 3)
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function intervalLabel(value) {
  if (value === 'annual') return 'año'
  if (value === 'quarterly') return 'trimestre'
  if (value === 'semiannual') return 'semestre'
  return 'mes'
}

function formatLimit(limit) {
  const value = Number(limit?.limit_value || 0)
  if (value >= 999999) return 'sin límite práctico'
  return `${value.toLocaleString('es-CO')} ${limit?.limit_unit || ''}`.trim()
}

function selectPlan(plan) {
  selectedPlan.value = plan
  selectedPlanPrice.value = getPrimaryPrice(plan)
  requestAnimationFrame(() => {
    signupSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function validateForm() {
  if (!selectedPlanPrice.value?.plan_price_id) return 'Selecciona un plan para continuar.'
  if (!form.business_name.trim()) return 'Escribe el nombre del negocio.'
  if (!form.admin_full_name.trim()) return 'Escribe el nombre del responsable.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email.trim())) return 'Escribe un email válido.'
  return ''
}

async function submitSignup() {
  const validation = validateForm()
  if (validation) {
    errorMessage.value = validation
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    const result = await subscriptionSignupService.createPreference({
      ...form,
      plan_price_id: selectedPlanPrice.value.plan_price_id,
      origin: window.location.origin,
    })
    if (!result.success) throw new Error(result.error || 'No se pudo iniciar el pago.')

    const paymentUrl = String(result.data?.preference?.payment_url || '').trim()
    if (!paymentUrl) throw new Error('Mercado Pago no devolvió una URL de pago válida.')
    window.location.href = paymentUrl
  } catch (error) {
    errorMessage.value = error.message || 'No se pudo iniciar el pago.'
  } finally {
    submitting.value = false
  }
}

async function loadPlans() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await subscriptionSignupService.listPublicPlans()
    if (!result.success) throw new Error(result.error || 'No se pudieron cargar los planes.')
    plans.value = result.data || []
    if (publicPlans.value.length > 0 && !selectedPlan.value) {
      const pro = publicPlans.value.find((plan) => plan.code === 'pro')
      selectedPlan.value = pro || publicPlans.value[0]
      selectedPlanPrice.value = getPrimaryPrice(selectedPlan.value)
    }
  } catch (error) {
    errorMessage.value = error.message || 'No se pudieron cargar los planes.'
  } finally {
    loading.value = false
  }
}

loadPlans()
</script>

<style scoped>
.pricing-page {
  min-height: 100vh;
  padding: clamp(18px, 2.4vw, 34px) clamp(16px, 3vw, 44px) 80px;
  color: #111827;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.16), transparent 28%),
    radial-gradient(circle at 82% 8%, rgba(16, 185, 129, 0.14), transparent 22%),
    linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
}

.pricing-hero,
.signup-section {
  width: min(1480px, 100%);
  margin: 0 auto;
}

.pricing-hero {
  min-height: 280px;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
  gap: 24px;
  align-items: stretch;
}

.pricing-hero__copy,
.pricing-hero__panel,
.signup-card {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.10);
  backdrop-filter: blur(14px);
}

.pricing-hero__copy {
  padding: clamp(28px, 5vw, 54px);
}

.pricing-eyebrow,
.pricing-card__code,
.pricing-hero__panel span,
.signup-summary span {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.76rem;
  color: #2563eb;
  font-weight: 900;
}

.pricing-hero h1 {
  margin: 10px 0 14px;
  max-width: 920px;
  font-size: clamp(2.6rem, 5.8vw, 5rem);
  line-height: 0.94;
  letter-spacing: -0.07em;
}

.pricing-hero p,
.signup-section__copy p,
.pricing-card p {
  color: #475569;
  line-height: 1.65;
}

.pricing-hero__panel {
  padding: 28px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: #0f172a;
  color: #fff;
}

.pricing-hero__panel strong {
  margin-top: 10px;
  font-size: 2rem;
  line-height: 1;
}

.pricing-hero__panel small {
  margin-top: 16px;
  color: #cbd5e1;
}

.pricing-grid {
  width: min(1480px, 100%);
  margin: 28px auto 34px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(18px, 2vw, 28px);
  align-items: stretch;
}

.pricing-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
  padding: clamp(22px, 2.4vw, 32px);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
}

.pricing-card--selected {
  border-color: #2563eb;
  box-shadow: 0 24px 54px rgba(37, 99, 235, 0.18);
}

.pricing-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.pricing-card h2 {
  margin: 4px 0 0;
  font-size: clamp(1.9rem, 2.4vw, 2.45rem);
  letter-spacing: -0.05em;
}

.pricing-card__price strong {
  font-size: clamp(2rem, 2.8vw, 2.8rem);
  letter-spacing: -0.05em;
}

.pricing-card__price span {
  color: #64748b;
}

.pricing-card ul {
  margin: 0;
  padding-left: 18px;
  color: #334155;
  line-height: 1.75;
  flex: 1;
}

.pricing-card__description {
  min-height: 58px;
}

.pricing-card__button {
  flex: 0 0 auto;
  min-height: 46px;
  height: 46px;
  border-radius: 10px;
  letter-spacing: 0.16em;
}

.signup-section {
  display: grid;
  grid-template-columns: minmax(320px, 0.62fr) minmax(0, 1.38fr);
  gap: 22px;
  align-items: start;
  padding-top: 10px;
}

.signup-section__copy h2 {
  margin: 8px 0 10px;
  font-size: clamp(2rem, 4vw, 3.5rem);
  line-height: 0.96;
  letter-spacing: -0.06em;
}

.signup-card {
  overflow: hidden;
}

.signup-summary {
  margin-top: 8px;
  padding: 16px;
  border-radius: 20px;
  background: #eff6ff;
  display: grid;
  gap: 4px;
}

.signup-summary strong {
  font-size: 1.1rem;
}

@media (max-width: 820px) {
  .pricing-hero,
  .signup-section {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1080px) {
  .pricing-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .pricing-page {
    padding-inline: 14px;
  }

  .pricing-grid {
    grid-template-columns: 1fr;
  }

  .pricing-card__description {
    min-height: 0;
  }
}
</style>
