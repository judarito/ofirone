<template>
  <div class="ofir-page superadmin-billing-page">
    <v-card class="mb-4" variant="tonal" color="indigo">
      <v-card-text class="d-flex align-center justify-space-between flex-wrap ga-3">
        <div>
          <div class="text-h6 font-weight-bold d-flex align-center ga-2">
            <v-icon size="30">mdi-credit-card-cog</v-icon>
            Billing y Monetización
          </div>
          <div class="text-body-2 text-medium-emphasis">
            Configuración global de planes, suscripciones y cumplimiento comercial por tenant.
          </div>
        </div>
        <v-btn color="indigo" variant="elevated" prepend-icon="mdi-refresh" :loading="loadingAny" @click="refreshAll">
          Actualizar
        </v-btn>
      </v-card-text>
    </v-card>

    <v-tabs v-model="activeTab" color="indigo" class="mb-4">
      <v-tab value="plans">
        <v-icon start>mdi-shape-outline</v-icon>
        Planes
      </v-tab>
      <v-tab value="subscriptions">
        <v-icon start>mdi-office-building-cog</v-icon>
        Suscripciones
      </v-tab>
    </v-tabs>

    <v-window v-model="activeTab">
      <v-window-item value="plans">
        <ListView
          title="Catálogo de planes"
          icon="mdi-shape-outline"
          :items="plans"
          :total-items="plans.length"
          :loading="loadingPlans"
          :page-size="12"
          item-key="plan_id"
          title-field="name"
          subtitle-field="description"
          :clickable="true"
          :deletable="false"
          avatar-icon="mdi-shape"
          avatar-color="indigo"
          empty-message="No hay planes configurados"
          :client-side="true"
          :search-fields="['name', 'code', 'description']"
          :table-columns="planTableColumns"
          view-storage-key="superadmin-billing-plans"
          create-button-text="Nuevo plan"
          @create="openPlanDialog()"
          @edit="openPlanDialog"
          @item-click="openPlanDialog"
        >
          <template #subtitle="{ item }">
            <span class="text-caption text-medium-emphasis">{{ item.code }}</span>
            <span v-if="item.description"> • {{ item.description }}</span>
          </template>

          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip size="small" variant="tonal" color="indigo">
                {{ item.prices?.length || 0 }} precios
              </v-chip>
              <v-chip size="small" variant="tonal" color="success">
                {{ enabledFeaturesCount(item) }} features activas
              </v-chip>
              <v-chip size="small" variant="tonal" color="warning">
                {{ item.limits?.length || 0 }} límites
              </v-chip>
              <v-chip :color="item.is_public ? 'primary' : 'grey'" size="small" variant="flat">
                {{ item.is_public ? 'Público' : 'Interno' }}
              </v-chip>
              <v-chip :color="item.is_active ? 'success' : 'error'" size="small" variant="flat">
                {{ item.is_active ? 'Activo' : 'Inactivo' }}
              </v-chip>
            </div>
          </template>

          <template #table-cell-code="{ item }">
            <code class="text-caption">{{ item.code }}</code>
          </template>

          <template #table-cell-prices_summary="{ item }">
            <span class="text-caption text-medium-emphasis">{{ formatPlanPrices(item) }}</span>
          </template>

          <template #table-cell-features_count="{ item }">
            {{ enabledFeaturesCount(item) }}
          </template>

          <template #table-cell-limits_count="{ item }">
            {{ item.limits?.length || 0 }}
          </template>

          <template #table-cell-is_active="{ item }">
            <v-chip :color="item.is_active ? 'success' : 'error'" size="x-small">
              {{ item.is_active ? 'Activo' : 'Inactivo' }}
            </v-chip>
          </template>
        </ListView>
      </v-window-item>

      <v-window-item value="subscriptions">
        <ListView
          title="Estado comercial por tenant"
          icon="mdi-office-building-cog"
          :items="tenantSummaries"
          :total-items="tenantSummaries.length"
          :loading="loadingSummaries"
          :page-size="12"
          item-key="tenant_id"
          title-field="tenant_name"
          subtitle-field="tenant_email"
          avatar-icon="mdi-domain"
          avatar-color="indigo"
          empty-message="No hay tenants disponibles"
          :client-side="true"
          :clickable="true"
          :search-fields="['tenant_name', 'tenant_email', 'plan_name', 'plan_code', 'status_label']"
          :table-columns="summaryTableColumns"
          view-storage-key="superadmin-billing-tenants"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @item-click="openTenantDialog"
        >
          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip :color="getStatusColor(item.status)" size="small" variant="flat">
                {{ item.status_label || 'Sin suscripción' }}
              </v-chip>
              <v-chip v-if="item.plan_name" size="small" variant="tonal" color="primary">
                {{ item.plan_name }}
              </v-chip>
              <v-chip v-if="Number.isFinite(item.days_to_expiry)" size="small" variant="tonal" :color="getDaysColor(item.days_to_expiry)">
                {{ getDaysLabel(item.days_to_expiry) }}
              </v-chip>
              <v-chip :color="item.can_operate_sales ? 'success' : 'error'" size="small" variant="outlined">
                Ventas {{ item.can_operate_sales ? 'OK' : 'Bloq.' }}
              </v-chip>
              <v-chip :color="item.can_operate_admin ? 'success' : 'warning'" size="small" variant="outlined">
                Admin {{ item.can_operate_admin ? 'OK' : 'Bloq.' }}
              </v-chip>
            </div>
            <div v-if="item.banner_message" class="text-caption text-medium-emphasis mt-2">
              {{ item.banner_message }}
            </div>
          </template>

          <template #table-cell-plan_name="{ item }">
            <span>{{ item.plan_name || 'Sin plan' }}</span>
          </template>

          <template #table-cell-status_label="{ item }">
            <v-chip :color="getStatusColor(item.status)" size="x-small">
              {{ item.status_label || 'Sin estado' }}
            </v-chip>
          </template>

          <template #table-cell-expiration_date="{ item }">
            <span class="text-caption text-medium-emphasis">{{ formatDate(item.expiration_date) }}</span>
          </template>

          <template #table-cell-days_to_expiry="{ item }">
            <span class="text-caption text-medium-emphasis">{{ getDaysLabel(item.days_to_expiry) }}</span>
          </template>
        </ListView>
      </v-window-item>
    </v-window>

    <v-dialog v-model="planDialog" max-width="1080" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between ga-3">
          <span class="d-flex align-center ga-2">
            <v-icon color="indigo">mdi-shape-plus</v-icon>
            {{ planForm.plan_id ? 'Editar plan' : 'Nuevo plan' }}
          </span>
          <v-btn icon="mdi-close" variant="text" @click="planDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field v-model="planForm.code" label="Código" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="planForm.name" label="Nombre" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model.number="planForm.sort_order" type="number" label="Orden" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="planForm.description" label="Descripción" rows="2" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="4">
              <v-switch v-model="planForm.is_public" label="Plan público" color="primary" hide-details />
            </v-col>
            <v-col cols="12" md="4">
              <v-switch v-model="planForm.is_active" label="Plan activo" color="success" hide-details />
            </v-col>
            <v-col cols="12" md="4">
              <v-switch v-model="planForm.is_custom" label="Plan personalizado" color="warning" hide-details />
            </v-col>
          </v-row>

          <v-divider class="my-4" />
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="text-subtitle-1 font-weight-bold">Precios</div>
            <v-btn size="small" variant="tonal" color="indigo" prepend-icon="mdi-plus" @click="addPriceRow">
              Agregar precio
            </v-btn>
          </div>
          <v-row v-for="(price, index) in planForm.prices" :key="`price-${index}`" class="mb-2">
            <v-col cols="12" md="2">
              <v-select
                v-model="price.billing_interval"
                :items="billingIntervalOptions"
                item-title="title"
                item-value="value"
                label="Periodo"
                variant="outlined"
                density="compact"
              />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field v-model="price.currency_code" label="Moneda" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field v-model.number="price.amount" type="number" label="Valor" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field v-model.number="price.trial_days" type="number" label="Trial días" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field v-model.number="price.grace_days" type="number" label="Gracia días" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="1">
              <v-switch v-model="price.is_active" label="Act." color="success" hide-details inset />
            </v-col>
            <v-col cols="12" md="1" class="d-flex align-center justify-end">
              <v-btn icon="mdi-delete" color="error" size="small" variant="text" @click="removePriceRow(index)" />
            </v-col>
          </v-row>

          <v-divider class="my-4" />
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="text-subtitle-1 font-weight-bold">Features</div>
            <v-btn size="small" variant="tonal" color="indigo" prepend-icon="mdi-plus" @click="addFeatureRow">
              Agregar feature
            </v-btn>
          </div>
          <v-row v-for="(feature, index) in planForm.features" :key="`feature-${index}`" class="mb-2">
            <v-col cols="12" md="4">
              <v-text-field v-model="feature.feature_code" label="Código feature" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="feature.feature_name" label="Nombre feature" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="1">
              <v-switch v-model="feature.is_enabled" label="On" color="success" hide-details inset />
            </v-col>
            <v-col cols="12" md="1" class="d-flex align-center justify-end">
              <v-btn icon="mdi-delete" color="error" size="small" variant="text" @click="removeFeatureRow(index)" />
            </v-col>
          </v-row>

          <v-divider class="my-4" />
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="text-subtitle-1 font-weight-bold">Límites</div>
            <v-btn size="small" variant="tonal" color="indigo" prepend-icon="mdi-plus" @click="addLimitRow">
              Agregar límite
            </v-btn>
          </div>
          <v-row v-for="(limit, index) in planForm.limits" :key="`limit-${index}`" class="mb-2">
            <v-col cols="12" md="4">
              <v-text-field v-model="limit.limit_code" label="Código límite" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="limit.limit_name" label="Nombre límite" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field v-model.number="limit.limit_value" type="number" label="Valor" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="1">
              <v-text-field v-model="limit.limit_unit" label="Unidad" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="12" md="1" class="d-flex align-center justify-end">
              <v-btn icon="mdi-delete" color="error" size="small" variant="text" @click="removeLimitRow(index)" />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="px-6 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="planDialog = false">Cancelar</v-btn>
          <v-btn color="indigo" variant="elevated" :loading="savingPlan" @click="savePlan">
            Guardar plan
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="tenantDialog" max-width="1160" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between ga-3">
          <span class="d-flex align-center ga-2">
            <v-icon color="indigo">mdi-office-building-cog</v-icon>
            {{ selectedTenantSummary?.tenant_name || 'Tenant' }}
          </span>
          <v-btn icon="mdi-close" variant="text" @click="tenantDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" md="5">
              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1">Estado actual</v-card-title>
                <v-divider />
                <v-card-text v-if="selectedTenantSummary">
                  <div class="d-flex flex-wrap ga-2 mb-3">
                    <v-chip :color="getStatusColor(selectedTenantSummary.status)" size="small" variant="flat">
                      {{ selectedTenantSummary.status_label || 'Sin suscripción' }}
                    </v-chip>
                    <v-chip v-if="selectedTenantSummary.plan_name" color="primary" size="small" variant="tonal">
                      {{ selectedTenantSummary.plan_name }}
                    </v-chip>
                  </div>

                  <div class="text-body-2 mb-2"><strong>Email:</strong> {{ selectedTenantSummary.tenant_email || '—' }}</div>
                  <div class="text-body-2 mb-2"><strong>Vigencia:</strong> {{ formatDate(selectedTenantSummary.expiration_date) }}</div>
                  <div class="text-body-2 mb-2"><strong>Días restantes:</strong> {{ getDaysLabel(selectedTenantSummary.days_to_expiry) }}</div>
                  <div class="text-body-2 mb-2"><strong>Ventas:</strong> {{ selectedTenantSummary.can_operate_sales ? 'Permitidas' : 'Bloqueadas' }}</div>
                  <div class="text-body-2 mb-2"><strong>Admin:</strong> {{ selectedTenantSummary.can_operate_admin ? 'Permitida' : 'Bloqueada' }}</div>
                  <v-alert v-if="selectedTenantSummary.banner_message" type="info" variant="tonal" class="mt-3">
                    {{ selectedTenantSummary.banner_message }}
                  </v-alert>
                </v-card-text>
              </v-card>

              <v-card variant="outlined" class="mb-4">
                <v-card-title class="text-subtitle-1">Asignar o cambiar plan</v-card-title>
                <v-divider />
                <v-card-text>
                  <v-select
                    v-model="assignmentForm.plan_price_id"
                    :items="availablePlanPriceOptions"
                    item-title="label"
                    item-value="value"
                    label="Precio / periodicidad"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-select
                    v-model="assignmentForm.status"
                    :items="subscriptionStatusOptions"
                    item-title="title"
                    item-value="value"
                    label="Estado inicial"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-select
                    v-model="assignmentForm.renewal_mode"
                    :items="renewalModeOptions"
                    item-title="title"
                    item-value="value"
                    label="Renovación"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-text-field
                    v-model="assignmentForm.start_at"
                    type="datetime-local"
                    label="Inicio"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-text-field
                    v-if="assignmentForm.status === 'trialing'"
                    v-model="assignmentForm.trial_end_at"
                    type="datetime-local"
                    label="Fin trial"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-text-field
                    v-else
                    v-model="assignmentForm.current_period_end"
                    type="datetime-local"
                    label="Fin de vigencia"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-textarea v-model="assignmentForm.note" rows="2" label="Nota" variant="outlined" density="compact" />
                </v-card-text>
                <v-card-actions class="px-4 pb-4">
                  <v-spacer />
                  <v-btn color="indigo" variant="elevated" :loading="savingAssignment" @click="assignPlan">
                    Aplicar plan
                  </v-btn>
                </v-card-actions>
              </v-card>

              <v-card variant="outlined">
                <v-card-title class="text-subtitle-1">Cambiar estado</v-card-title>
                <v-divider />
                <v-card-text>
                  <v-select
                    v-model="statusForm.status"
                    :items="subscriptionStatusOptions"
                    item-title="title"
                    item-value="value"
                    label="Nuevo estado"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-text-field
                    v-if="statusForm.status === 'grace_period'"
                    v-model="statusForm.grace_end_at"
                    type="datetime-local"
                    label="Fin de gracia"
                    variant="outlined"
                    density="compact"
                    class="mb-3"
                  />
                  <v-textarea v-model="statusForm.note" rows="2" label="Nota" variant="outlined" density="compact" />
                </v-card-text>
                <v-card-actions class="px-4 pb-4">
                  <v-spacer />
                  <v-btn
                    color="warning"
                    variant="elevated"
                    :disabled="!selectedTenantSummary?.subscription_id"
                    :loading="savingStatus"
                    @click="updateStatus"
                  >
                    Actualizar estado
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>

            <v-col cols="12" md="7">
              <ListView
                title="Historial de suscripciones"
                icon="mdi-history"
                :items="subscriptionHistory"
                :total-items="subscriptionHistory.length"
                :loading="loadingHistory"
                :page-size="8"
                item-key="subscription_id"
                title-field="status"
                avatar-icon="mdi-history"
                avatar-color="indigo"
                empty-message="Sin historial registrado"
                :show-create-button="false"
                :editable="false"
                :deletable="false"
                :client-side="true"
                :table-columns="historyTableColumns"
                view-storage-key="superadmin-billing-history"
              >
                <template #title="{ item }">
                  {{ item.plan?.name || item.plan?.code || 'Plan sin nombre' }}
                </template>
                <template #subtitle="{ item }">
                  {{ getStatusLabel(item.status) }} • {{ formatDate(item.current_period_end || item.trial_end_at || item.created_at) }}
                </template>
                <template #content="{ item }">
                  <div class="mt-2 d-flex flex-wrap ga-2">
                    <v-chip size="small" :color="getStatusColor(item.status)" variant="flat">
                      {{ getStatusLabel(item.status) }}
                    </v-chip>
                    <v-chip size="small" variant="tonal">{{ item.plan_price?.billing_interval || '—' }}</v-chip>
                    <v-chip size="small" variant="tonal" color="primary">{{ formatMoney(item.plan_price?.amount || 0) }}</v-chip>
                  </div>
                </template>
                <template #table-cell-status="{ item }">
                  <v-chip size="x-small" :color="getStatusColor(item.status)">
                    {{ getStatusLabel(item.status) }}
                  </v-chip>
                </template>
                <template #table-cell-plan_name="{ item }">
                  {{ item.plan?.name || item.plan?.code || 'Sin plan' }}
                </template>
                <template #table-cell-created_at="{ item }">
                  <span class="text-caption text-medium-emphasis">{{ formatDate(item.created_at) }}</span>
                </template>
                <template #table-cell-current_period_end="{ item }">
                  <span class="text-caption text-medium-emphasis">{{ formatDate(item.current_period_end || item.trial_end_at) }}</span>
                </template>
              </ListView>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import ListView from '@/components/ListView.vue'
import tenantBillingService, { getBillingStatusLabel } from '@/services/tenantBilling.service'
import { useNotification } from '@/composables/useNotification'

const { showSuccess, showError } = useNotification()

const activeTab = ref('plans')
const loadingPlans = ref(false)
const loadingSummaries = ref(false)
const loadingHistory = ref(false)
const savingPlan = ref(false)
const savingAssignment = ref(false)
const savingStatus = ref(false)

const plans = ref([])
const tenantSummaries = ref([])
const subscriptionHistory = ref([])
const selectedTenantSummary = ref(null)

const planDialog = ref(false)
const tenantDialog = ref(false)

const billingIntervalOptions = [
  { title: 'Mensual', value: 'monthly' },
  { title: 'Trimestral', value: 'quarterly' },
  { title: 'Semestral', value: 'semiannual' },
  { title: 'Anual', value: 'annual' },
]

const subscriptionStatusOptions = [
  { title: 'En prueba', value: 'trialing' },
  { title: 'Activo', value: 'active' },
  { title: 'Pendiente de activación', value: 'pending_activation' },
  { title: 'Vencido', value: 'past_due' },
  { title: 'En gracia', value: 'grace_period' },
  { title: 'Suspendido', value: 'suspended' },
  { title: 'Cancelado', value: 'canceled' },
  { title: 'Expirado', value: 'expired' },
]

const renewalModeOptions = [
  { title: 'Manual', value: 'manual' },
  { title: 'Automática', value: 'auto' },
]

const planTableColumns = [
  { title: 'Código', key: 'code', width: '130px' },
  { title: 'Precios', key: 'prices_summary', width: '220px' },
  { title: 'Features', key: 'features_count', width: '110px' },
  { title: 'Límites', key: 'limits_count', width: '110px' },
  { title: 'Activo', key: 'is_active', width: '110px' },
]

const summaryTableColumns = [
  { title: 'Plan', key: 'plan_name', width: '180px' },
  { title: 'Estado', key: 'status_label', width: '140px' },
  { title: 'Vigencia', key: 'expiration_date', width: '160px' },
  { title: 'Días', key: 'days_to_expiry', width: '100px' },
]

const historyTableColumns = [
  { title: 'Estado', key: 'status', width: '140px' },
  { title: 'Plan', key: 'plan_name', width: '180px' },
  { title: 'Creado', key: 'created_at', width: '160px' },
  { title: 'Fin', key: 'current_period_end', width: '160px' },
]

const createEmptyPlanForm = () => ({
  plan_id: null,
  code: '',
  name: '',
  description: '',
  is_public: true,
  is_active: true,
  is_custom: false,
  sort_order: 0,
  prices: [],
  features: [],
  limits: [],
})

const planForm = ref(createEmptyPlanForm())

const createAssignmentForm = () => ({
  plan_price_id: null,
  status: 'active',
  renewal_mode: 'manual',
  start_at: toDateTimeLocal(new Date()),
  trial_end_at: '',
  current_period_end: '',
  note: '',
})

const assignmentForm = ref(createAssignmentForm())

const createStatusForm = () => ({
  status: 'active',
  grace_end_at: '',
  note: '',
})

const statusForm = ref(createStatusForm())

const loadingAny = computed(() => loadingPlans.value || loadingSummaries.value || loadingHistory.value || savingPlan.value || savingAssignment.value || savingStatus.value)

const availablePlanPriceOptions = computed(() => {
  return plans.value.flatMap((plan) => (plan.prices || []).map((price) => ({
    value: price.plan_price_id,
    label: `${plan.name} · ${intervalLabel(price.billing_interval)} · ${formatMoney(price.amount)} ${price.currency_code || 'COP'}`,
  })))
})

function toDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
  return local.toISOString().slice(0, 16)
}

function intervalLabel(interval) {
  return billingIntervalOptions.find((item) => item.value === interval)?.title || interval || '—'
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha inválida'
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getStatusLabel(status) {
  return getBillingStatusLabel(status)
}

function getStatusColor(status) {
  switch (status) {
    case 'active': return 'success'
    case 'trialing': return 'info'
    case 'pending_activation': return 'warning'
    case 'past_due': return 'error'
    case 'grace_period': return 'deep-orange'
    case 'suspended': return 'error'
    case 'canceled': return 'grey'
    case 'expired': return 'grey-darken-1'
    default: return 'grey'
  }
}

function getDaysColor(days) {
  if (!Number.isFinite(days)) return 'grey'
  if (days < 0) return 'error'
  if (days <= 3) return 'warning'
  return 'success'
}

function getDaysLabel(days) {
  if (!Number.isFinite(days)) return 'Sin dato'
  if (days < 0) return `Venció hace ${Math.abs(days)} día(s)`
  if (days === 0) return 'Vence hoy'
  return `${days} día(s)`
}

function enabledFeaturesCount(plan) {
  return (plan.features || []).filter((item) => item.is_enabled).length
}

function formatPlanPrices(plan) {
  const firstThree = (plan.prices || []).slice(0, 3).map((price) => `${intervalLabel(price.billing_interval)} ${formatMoney(price.amount)}`)
  return firstThree.length > 0 ? firstThree.join(' · ') : 'Sin precios'
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

async function loadPlans(options = {}) {
  loadingPlans.value = true
  try {
    const result = await tenantBillingService.getBillingPlans(options)
    if (result.success) {
      plans.value = result.data
    } else {
      showError(result.error || 'No fue posible cargar los planes')
    }
  } finally {
    loadingPlans.value = false
  }
}

async function loadSummaries(options = {}) {
  loadingSummaries.value = true
  try {
    const result = await tenantBillingService.listTenantBillingSummaries(options)
    if (result.success) {
      tenantSummaries.value = result.data
    } else {
      showError(result.error || 'No fue posible cargar las suscripciones')
    }
  } finally {
    loadingSummaries.value = false
  }
}

async function loadHistory(tenantId) {
  if (!tenantId) {
    subscriptionHistory.value = []
    return
  }

  loadingHistory.value = true
  try {
    const result = await tenantBillingService.getTenantSubscriptionHistory(tenantId)
    if (result.success) {
      subscriptionHistory.value = result.data
    } else {
      subscriptionHistory.value = []
      showError(result.error || 'No fue posible cargar el historial')
    }
  } finally {
    loadingHistory.value = false
  }
}

async function refreshAll() {
  await Promise.all([
    loadPlans({ forceRefresh: true }),
    loadSummaries({ forceRefresh: true }),
  ])

  if (selectedTenantSummary.value?.tenant_id) {
    await loadHistory(selectedTenantSummary.value.tenant_id)
  }
}

function openPlanDialog(plan = null) {
  planForm.value = plan ? clone(plan) : createEmptyPlanForm()
  planDialog.value = true
}

function addPriceRow() {
  planForm.value.prices.push({
    billing_interval: 'monthly',
    currency_code: 'COP',
    amount: 0,
    setup_fee: 0,
    trial_days: 0,
    grace_days: 0,
    auto_renew_default: false,
    is_active: true,
  })
}

function removePriceRow(index) {
  planForm.value.prices.splice(index, 1)
}

function addFeatureRow() {
  planForm.value.features.push({
    feature_code: '',
    feature_name: '',
    is_enabled: true,
  })
}

function removeFeatureRow(index) {
  planForm.value.features.splice(index, 1)
}

function addLimitRow() {
  planForm.value.limits.push({
    limit_code: '',
    limit_name: '',
    limit_value: 0,
    limit_unit: 'count',
  })
}

function removeLimitRow(index) {
  planForm.value.limits.splice(index, 1)
}

async function savePlan() {
  if (!planForm.value.code || !planForm.value.name) {
    showError('El plan requiere código y nombre')
    return
  }

  savingPlan.value = true
  try {
    const result = await tenantBillingService.saveBillingPlan(planForm.value)
    if (!result.success) {
      showError(result.error || 'No fue posible guardar el plan')
      return
    }

    showSuccess('Plan guardado correctamente')
    planDialog.value = false
    await loadPlans({ forceRefresh: true })
  } finally {
    savingPlan.value = false
  }
}

async function openTenantDialog(item) {
  selectedTenantSummary.value = item
  assignmentForm.value = createAssignmentForm()
  statusForm.value = createStatusForm()
  statusForm.value.status = item?.status || 'active'
  tenantDialog.value = true
  await loadHistory(item.tenant_id)
}

async function assignPlan() {
  if (!selectedTenantSummary.value?.tenant_id || !assignmentForm.value.plan_price_id) {
    showError('Selecciona un precio para asignar el plan')
    return
  }

  savingAssignment.value = true
  try {
    const result = await tenantBillingService.assignTenantPlan({
      tenant_id: selectedTenantSummary.value.tenant_id,
      plan_price_id: assignmentForm.value.plan_price_id,
      status: assignmentForm.value.status,
      renewal_mode: assignmentForm.value.renewal_mode,
      start_at: assignmentForm.value.start_at ? new Date(assignmentForm.value.start_at).toISOString() : new Date().toISOString(),
      trial_end_at: assignmentForm.value.trial_end_at ? new Date(assignmentForm.value.trial_end_at).toISOString() : null,
      current_period_end: assignmentForm.value.current_period_end ? new Date(assignmentForm.value.current_period_end).toISOString() : null,
      note: assignmentForm.value.note,
    })

    if (!result.success) {
      showError(result.error || 'No fue posible asignar el plan')
      return
    }

    showSuccess('Plan asignado correctamente')
    await loadSummaries({ forceRefresh: true })
    selectedTenantSummary.value = tenantSummaries.value.find((entry) => entry.tenant_id === selectedTenantSummary.value.tenant_id) || selectedTenantSummary.value
    await loadHistory(selectedTenantSummary.value.tenant_id)
  } finally {
    savingAssignment.value = false
  }
}

async function updateStatus() {
  if (!selectedTenantSummary.value?.subscription_id) {
    showError('El tenant no tiene una suscripción abierta para actualizar')
    return
  }

  savingStatus.value = true
  try {
    const result = await tenantBillingService.updateSubscriptionStatus({
      subscription_id: selectedTenantSummary.value.subscription_id,
      tenant_id: selectedTenantSummary.value.tenant_id,
      status: statusForm.value.status,
      grace_end_at: statusForm.value.grace_end_at ? new Date(statusForm.value.grace_end_at).toISOString() : null,
      note: statusForm.value.note,
    })

    if (!result.success) {
      showError(result.error || 'No fue posible actualizar el estado')
      return
    }

    showSuccess('Estado actualizado correctamente')
    await loadSummaries({ forceRefresh: true })
    selectedTenantSummary.value = tenantSummaries.value.find((entry) => entry.tenant_id === selectedTenantSummary.value.tenant_id) || selectedTenantSummary.value
    await loadHistory(selectedTenantSummary.value.tenant_id)
  } finally {
    savingStatus.value = false
  }
}

onMounted(async () => {
  await refreshAll()
})
</script>
