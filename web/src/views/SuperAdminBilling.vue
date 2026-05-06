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
      <v-tab value="public-signups">
        <v-icon start>mdi-store-plus</v-icon>
        Altas públicas
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

      <v-window-item value="public-signups">
        <v-card variant="outlined" class="mb-4">
          <v-card-text>
            <div class="d-flex align-center justify-space-between flex-wrap ga-3">
              <div>
                <div class="text-subtitle-1 font-weight-bold">Consola de altas públicas</div>
                <div class="text-body-2 text-medium-emphasis">
                  Filtra solicitudes, revisa errores y ejecuta acciones operativas sin entrar a base de datos.
                </div>
              </div>
              <v-select
                v-model="publicSignupStatusFilter"
                :items="publicSignupStatusFilterOptions"
                item-title="title"
                item-value="value"
                label="Estado"
                variant="outlined"
                density="compact"
                hide-details
                style="max-width: 260px;"
              />
            </div>
            <div class="d-flex flex-wrap ga-2 mt-4">
              <v-chip
                v-for="stat in publicSignupStats"
                :key="stat.status"
                :color="stat.color"
                variant="tonal"
                size="small"
                @click="publicSignupStatusFilter = stat.status"
              >
                {{ stat.label }}: {{ stat.count }}
              </v-chip>
            </div>
          </v-card-text>
        </v-card>

        <ListView
          title="Altas públicas SaaS"
          icon="mdi-store-plus"
          :items="filteredPublicSignups"
          :total-items="filteredPublicSignups.length"
          :loading="loadingPublicSignups"
          :page-size="12"
          item-key="signup_id"
          title-field="business_name"
          subtitle-field="admin_email"
          avatar-icon="mdi-store-plus"
          avatar-color="indigo"
          empty-message="No hay solicitudes públicas registradas"
          :client-side="true"
          :clickable="true"
          :search-fields="['business_name', 'admin_email', 'tax_id', 'plan_name', 'status', 'mercado_pago_payment_id', 'error_message']"
          :table-columns="publicSignupTableColumns"
          view-storage-key="superadmin-public-subscription-signups"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @item-click="openPublicSignupDialog"
        >
          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip :color="getPublicSignupStatusColor(item.status)" size="small" variant="flat">
                {{ getPublicSignupStatusLabel(item.status) }}
              </v-chip>
              <v-chip v-if="item.plan_name" color="primary" size="small" variant="tonal">
                {{ item.plan_name }}
              </v-chip>
              <v-chip v-if="item.paid_at" color="success" size="small" variant="tonal">
                Pago recibido
              </v-chip>
              <v-chip v-if="item.tenant_id" color="success" size="small" variant="outlined">
                Tenant creado
              </v-chip>
              <v-chip v-if="item.mercado_pago_payment_id" color="blue" size="small" variant="tonal">
                MP {{ item.mercado_pago_payment_id }}
              </v-chip>
              <v-chip v-if="item.events_count" color="grey" size="small" variant="outlined">
                {{ item.events_count }} eventos
              </v-chip>
            </div>
            <div v-if="item.last_event_message" class="text-caption text-medium-emphasis mt-2">
              Último evento: {{ item.last_event_message }}
            </div>
            <v-alert v-if="item.error_message" type="warning" variant="tonal" density="compact" class="mt-3">
              {{ item.error_message }}
            </v-alert>
          </template>

          <template #table-cell-status="{ item }">
            <v-chip :color="getPublicSignupStatusColor(item.status)" size="x-small">
              {{ getPublicSignupStatusLabel(item.status) }}
            </v-chip>
          </template>

          <template #table-cell-total="{ item }">
            {{ formatMoney(item.total) }}
          </template>

          <template #table-cell-created_at="{ item }">
            <span class="text-caption text-medium-emphasis">{{ formatDateTime(item.created_at) }}</span>
          </template>

          <template #table-cell-paid_at="{ item }">
            <span class="text-caption text-medium-emphasis">{{ item.paid_at ? formatDateTime(item.paid_at) : 'Sin pago' }}</span>
          </template>

          <template #actions="{ item }">
            <div class="d-flex justify-end flex-wrap ga-1">
              <v-btn
                icon="mdi-eye"
                variant="text"
                size="small"
                color="primary"
                @click.stop="openPublicSignupDialog(item)"
              />
              <v-btn
                v-if="item.payment_url && !item.paid_at && item.status === 'PENDING_PAYMENT'"
                :href="item.payment_url"
                target="_blank"
                rel="noopener"
                icon="mdi-open-in-new"
                variant="text"
                size="small"
                color="primary"
              />
              <v-btn
                v-if="canProvisionPublicSignup(item)"
                icon="mdi-account-cog"
                variant="text"
                size="small"
                color="success"
                :loading="provisioningSignupId === item.signup_id"
                @click.stop="provisionPublicSignup(item)"
              />
              <v-btn
                v-if="canRetryPublicSignup(item)"
                icon="mdi-refresh"
                variant="text"
                size="small"
                color="info"
                :loading="retryingSignupId === item.signup_id"
                @click.stop="retryPublicSignup(item)"
              />
              <v-btn
                v-if="canResendAccessPublicSignup(item)"
                icon="mdi-email-sync-outline"
                variant="text"
                size="small"
                color="success"
                :loading="actionSignupId === item.signup_id && actionDialogAction === 'resend_access'"
                @click.stop="openPublicSignupActionDialog(item, 'resend_access')"
              />
              <v-btn
                v-if="canMarkReviewedPublicSignup(item)"
                icon="mdi-check-decagram-outline"
                variant="text"
                size="small"
                color="warning"
                :loading="actionSignupId === item.signup_id && actionDialogAction === 'mark_reviewed'"
                @click.stop="openPublicSignupActionDialog(item, 'mark_reviewed')"
              />
              <v-btn
                v-if="canCancelPublicSignup(item)"
                icon="mdi-cancel"
                variant="text"
                size="small"
                color="error"
                :loading="actionSignupId === item.signup_id && actionDialogAction === 'cancel'"
                @click.stop="openPublicSignupActionDialog(item, 'cancel')"
              />
            </div>
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

    <v-dialog v-model="publicSignupDialog" max-width="980" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between ga-3">
          <span class="d-flex align-center ga-2">
            <v-icon color="indigo">mdi-store-plus</v-icon>
            {{ selectedPublicSignup?.business_name || 'Alta pública' }}
          </span>
          <v-btn icon="mdi-close" variant="text" @click="publicSignupDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-row v-if="selectedPublicSignup">
            <v-col cols="12" md="5">
              <v-card variant="outlined">
                <v-card-title class="text-subtitle-1">Resumen</v-card-title>
                <v-divider />
                <v-card-text>
                  <div class="d-flex flex-wrap ga-2 mb-3">
                    <v-chip :color="getPublicSignupStatusColor(selectedPublicSignup.status)" size="small" variant="flat">
                      {{ getPublicSignupStatusLabel(selectedPublicSignup.status) }}
                    </v-chip>
                    <v-chip color="primary" size="small" variant="tonal">{{ selectedPublicSignup.plan_name }}</v-chip>
                  </div>
                  <div class="text-body-2 mb-2"><strong>Email:</strong> {{ selectedPublicSignup.admin_email }}</div>
                  <div class="text-body-2 mb-2"><strong>Responsable:</strong> {{ selectedPublicSignup.admin_full_name }}</div>
                  <div class="text-body-2 mb-2"><strong>NIT:</strong> {{ selectedPublicSignup.tax_id || '—' }}</div>
                  <div class="text-body-2 mb-2"><strong>Total:</strong> {{ formatMoney(selectedPublicSignup.total) }}</div>
                  <div class="text-body-2 mb-2"><strong>Pago:</strong> {{ selectedPublicSignup.paid_at ? formatDateTime(selectedPublicSignup.paid_at) : 'Sin pago' }}</div>
                  <div class="text-body-2 mb-2"><strong>Tenant:</strong> {{ selectedPublicSignup.tenant_id || 'Sin tenant' }}</div>
                  <v-alert v-if="selectedPublicSignup.error_message" type="warning" variant="tonal" class="mt-3">
                    {{ selectedPublicSignup.error_message }}
                  </v-alert>
                </v-card-text>
                <v-card-actions class="px-4 pb-4">
                  <v-btn
                    v-if="canProvisionPublicSignup(selectedPublicSignup)"
                    color="success"
                    variant="elevated"
                    prepend-icon="mdi-account-cog"
                    :loading="provisioningSignupId === selectedPublicSignup.signup_id"
                    @click="provisionPublicSignup(selectedPublicSignup)"
                  >
                    Aprovisionar
                  </v-btn>
                  <v-btn
                    v-if="canRetryPublicSignup(selectedPublicSignup)"
                    color="info"
                    variant="tonal"
                    prepend-icon="mdi-refresh"
                    :loading="retryingSignupId === selectedPublicSignup.signup_id"
                    @click="retryPublicSignup(selectedPublicSignup)"
                  >
                    Revalidar MP
                  </v-btn>
                  <v-btn
                    v-if="canResendAccessPublicSignup(selectedPublicSignup)"
                    color="success"
                    variant="tonal"
                    prepend-icon="mdi-email-sync-outline"
                    :loading="actionSignupId === selectedPublicSignup.signup_id && actionDialogAction === 'resend_access'"
                    @click="openPublicSignupActionDialog(selectedPublicSignup, 'resend_access')"
                  >
                    Reenviar acceso
                  </v-btn>
                  <v-btn
                    v-if="canMarkReviewedPublicSignup(selectedPublicSignup)"
                    color="warning"
                    variant="tonal"
                    prepend-icon="mdi-check-decagram-outline"
                    :loading="actionSignupId === selectedPublicSignup.signup_id && actionDialogAction === 'mark_reviewed'"
                    @click="openPublicSignupActionDialog(selectedPublicSignup, 'mark_reviewed')"
                  >
                    Marcar revisada
                  </v-btn>
                  <v-btn
                    v-if="canCancelPublicSignup(selectedPublicSignup)"
                    color="error"
                    variant="tonal"
                    prepend-icon="mdi-cancel"
                    :loading="actionSignupId === selectedPublicSignup.signup_id && actionDialogAction === 'cancel'"
                    @click="openPublicSignupActionDialog(selectedPublicSignup, 'cancel')"
                  >
                    Cancelar
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>

            <v-col cols="12" md="7">
              <v-card variant="outlined">
                <v-card-title class="text-subtitle-1 d-flex align-center justify-space-between">
                  Timeline técnico
                  <v-btn icon="mdi-refresh" variant="text" size="small" :loading="loadingPublicSignupEvents" @click="loadPublicSignupEvents(selectedPublicSignup.signup_id)" />
                </v-card-title>
                <v-divider />
                <v-card-text>
                  <div v-if="loadingPublicSignupEvents" class="d-flex align-center ga-2 text-medium-emphasis py-4">
                    <v-progress-circular indeterminate size="20" />
                    Cargando eventos...
                  </div>
                  <div v-else-if="publicSignupEvents.length === 0" class="text-medium-emphasis py-4">
                    Sin eventos registrados todavía.
                  </div>
                  <v-timeline v-else density="compact" side="end">
                    <v-timeline-item
                      v-for="event in publicSignupEvents"
                      :key="event.event_id"
                      :dot-color="getEventStatusColor(event.event_status)"
                      size="small"
                    >
                      <div class="text-subtitle-2">{{ event.event_type }}</div>
                      <div class="text-caption text-medium-emphasis">{{ formatDateTime(event.created_at) }} · {{ event.event_source }}</div>
                      <div v-if="event.message" class="text-body-2 mt-1">{{ event.message }}</div>
                    </v-timeline-item>
                  </v-timeline>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="publicSignupActionDialog" max-width="560">
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between ga-3">
          <span class="d-flex align-center ga-2">
            <v-icon :color="publicSignupActionMeta.color">{{ publicSignupActionMeta.icon }}</v-icon>
            {{ publicSignupActionMeta.title }}
          </span>
          <v-btn icon="mdi-close" variant="text" @click="publicSignupActionDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-alert :type="publicSignupActionMeta.alertType" variant="tonal" class="mb-4">
            {{ publicSignupActionMeta.description }}
          </v-alert>
          <div class="text-body-2 mb-3">
            <strong>Solicitud:</strong> {{ actionPublicSignup?.business_name || '—' }} · {{ actionPublicSignup?.admin_email || '—' }}
          </div>
          <v-textarea
            v-model="publicSignupActionNote"
            label="Nota interna"
            variant="outlined"
            rows="3"
            auto-grow
            :placeholder="publicSignupActionMeta.placeholder"
          />
        </v-card-text>
        <v-card-actions class="px-6 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="publicSignupActionDialog = false">Cerrar</v-btn>
          <v-btn
            :color="publicSignupActionMeta.color"
            variant="elevated"
            :loading="Boolean(actionSignupId)"
            @click="confirmPublicSignupAction"
          >
            Confirmar
          </v-btn>
        </v-card-actions>
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
const loadingPublicSignups = ref(false)
const savingPlan = ref(false)
const savingAssignment = ref(false)
const savingStatus = ref(false)
const retryingSignupId = ref(null)
const provisioningSignupId = ref(null)
const actionSignupId = ref(null)
const actionDialogAction = ref('')
const loadingPublicSignupEvents = ref(false)

const plans = ref([])
const tenantSummaries = ref([])
const subscriptionHistory = ref([])
const publicSignups = ref([])
const publicSignupEvents = ref([])
const selectedTenantSummary = ref(null)
const selectedPublicSignup = ref(null)
const publicSignupStatusFilter = ref('ALL')
const publicSignupActionDialog = ref(false)
const actionPublicSignup = ref(null)
const publicSignupActionNote = ref('')

const planDialog = ref(false)
const tenantDialog = ref(false)
const publicSignupDialog = ref(false)

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

const publicSignupTableColumns = [
  { title: 'Estado', key: 'status', width: '150px' },
  { title: 'Plan', key: 'plan_name', width: '150px' },
  { title: 'Total', key: 'total', width: '120px' },
  { title: 'Creado', key: 'created_at', width: '170px' },
  { title: 'Pago', key: 'paid_at', width: '170px' },
]

const publicSignupStatusFilterOptions = [
  { title: 'Todos', value: 'ALL' },
  { title: 'Pago pendiente', value: 'PENDING_PAYMENT' },
  { title: 'Pagado', value: 'PAID' },
  { title: 'Aprovisionando', value: 'PROVISIONING' },
  { title: 'Aprovisionado', value: 'PROVISIONED' },
  { title: 'Revisión requerida', value: 'FAILED' },
  { title: 'Cancelado', value: 'CANCELLED' },
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

const loadingAny = computed(() => loadingPlans.value || loadingSummaries.value || loadingHistory.value || loadingPublicSignups.value || loadingPublicSignupEvents.value || savingPlan.value || savingAssignment.value || savingStatus.value || Boolean(retryingSignupId.value) || Boolean(provisioningSignupId.value) || Boolean(actionSignupId.value))

const availablePlanPriceOptions = computed(() => {
  return plans.value.flatMap((plan) => (plan.prices || []).map((price) => ({
    value: price.plan_price_id,
    label: `${plan.name} · ${intervalLabel(price.billing_interval)} · ${formatMoney(price.amount)} ${price.currency_code || 'COP'}`,
  })))
})

const filteredPublicSignups = computed(() => {
  const status = String(publicSignupStatusFilter.value || 'ALL').toUpperCase()
  if (status === 'ALL') return publicSignups.value
  return publicSignups.value.filter((item) => String(item.status || '').toUpperCase() === status)
})

const publicSignupStats = computed(() => {
  return publicSignupStatusFilterOptions.map((option) => {
    const status = String(option.value || '').toUpperCase()
    const count = status === 'ALL'
      ? publicSignups.value.length
      : publicSignups.value.filter((item) => String(item.status || '').toUpperCase() === status).length
    return {
      status: option.value,
      label: option.title,
      count,
      color: status === 'ALL' ? 'indigo' : getPublicSignupStatusColor(status),
    }
  })
})

const publicSignupActionMeta = computed(() => {
  switch (actionDialogAction.value) {
    case 'resend_access':
      return {
        title: 'Reenviar acceso',
        icon: 'mdi-email-sync-outline',
        color: 'success',
        alertType: 'info',
        description: 'Se generará un nuevo enlace de recuperación y se enviará al email administrador. Esta acción sí envía un correo.',
        placeholder: 'Ej: Cliente pidió nuevo acceso por WhatsApp.',
      }
    case 'mark_reviewed':
      return {
        title: 'Marcar revisada',
        icon: 'mdi-check-decagram-outline',
        color: 'warning',
        alertType: 'warning',
        description: 'No cambia el estado del pago ni crea tenant. Solo deja trazabilidad de que soporte revisó esta solicitud.',
        placeholder: 'Ej: Se confirmó que el error requiere email administrador diferente.',
      }
    case 'cancel':
      return {
        title: 'Cancelar solicitud',
        icon: 'mdi-cancel',
        color: 'error',
        alertType: 'error',
        description: 'La solicitud quedará cancelada y no podrá aprovisionarse desde esta consola. No elimina datos ni revierte pagos.',
        placeholder: 'Ej: Solicitud duplicada creada por el cliente.',
      }
    default:
      return {
        title: 'Acción',
        icon: 'mdi-cog',
        color: 'primary',
        alertType: 'info',
        description: 'Confirma la acción operativa.',
        placeholder: 'Nota interna',
      }
  }
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

function formatDateTime(value) {
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha inválida'
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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

function getPublicSignupStatusLabel(status) {
  switch (String(status || '').toUpperCase()) {
    case 'PENDING_PAYMENT': return 'Pago pendiente'
    case 'PAID': return 'Pagado'
    case 'PROVISIONING': return 'Aprovisionando'
    case 'PROVISIONED': return 'Aprovisionado'
    case 'FAILED': return 'Revisión requerida'
    case 'CANCELLED': return 'Cancelado'
    default: return 'Sin estado'
  }
}

function getPublicSignupStatusColor(status) {
  switch (String(status || '').toUpperCase()) {
    case 'PROVISIONED': return 'success'
    case 'PAID':
    case 'PROVISIONING': return 'info'
    case 'PENDING_PAYMENT': return 'warning'
    case 'FAILED': return 'error'
    case 'CANCELLED': return 'grey'
    default: return 'grey'
  }
}

function getEventStatusColor(status) {
  switch (String(status || '').toLowerCase()) {
    case 'success': return 'success'
    case 'warning': return 'warning'
    case 'error': return 'error'
    default: return 'info'
  }
}

function canProvisionPublicSignup(item) {
  if (!item?.signup_id || item.tenant_id || String(item.status || '').toUpperCase() === 'PROVISIONED') return false
  return Boolean(item.paid_at) || ['PAID', 'PROVISIONING', 'FAILED'].includes(String(item.status || '').toUpperCase())
}

function canRetryPublicSignup(item) {
  if (!item?.signup_id) return false
  const status = String(item.status || '').toUpperCase()
  return !item.tenant_id && (status === 'FAILED' || status === 'PAID' || status === 'PROVISIONING')
}

function canResendAccessPublicSignup(item) {
  if (!item?.signup_id) return false
  return Boolean(item.tenant_id) || String(item.status || '').toUpperCase() === 'PROVISIONED'
}

function canMarkReviewedPublicSignup(item) {
  if (!item?.signup_id) return false
  return ['FAILED', 'PAID', 'PROVISIONING'].includes(String(item.status || '').toUpperCase())
}

function canCancelPublicSignup(item) {
  if (!item?.signup_id || item.tenant_id) return false
  return ['PENDING_PAYMENT', 'FAILED', 'PAID'].includes(String(item.status || '').toUpperCase())
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

async function loadPublicSignups(options = {}) {
  loadingPublicSignups.value = true
  try {
    const result = await tenantBillingService.listPublicSubscriptionSignups(options)
    if (result.success) {
      publicSignups.value = result.data
    } else {
      showError(result.error || 'No fue posible cargar las altas públicas')
    }
  } finally {
    loadingPublicSignups.value = false
  }
}

async function loadPublicSignupEvents(signupId) {
  if (!signupId) {
    publicSignupEvents.value = []
    return
  }

  loadingPublicSignupEvents.value = true
  try {
    const result = await tenantBillingService.listPublicSubscriptionSignupEvents(signupId)
    if (result.success) {
      publicSignupEvents.value = result.data
    } else {
      publicSignupEvents.value = []
      showError(result.error || 'No fue posible cargar los eventos del alta')
    }
  } finally {
    loadingPublicSignupEvents.value = false
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
    loadPublicSignups({ forceRefresh: true }),
  ])

  if (selectedTenantSummary.value?.tenant_id) {
    await loadHistory(selectedTenantSummary.value.tenant_id)
  }
}

async function retryPublicSignup(item) {
  if (!item?.signup_id) return

  retryingSignupId.value = item.signup_id
  try {
    const result = await tenantBillingService.retryPublicSubscriptionSignup(item.signup_id)
    if (!result.success) {
      showError(result.error || 'No fue posible reintentar el alta pública')
      return
    }

    showSuccess('Reintento enviado correctamente')
    await Promise.all([
      loadPublicSignups({ forceRefresh: true }),
      loadSummaries({ forceRefresh: true }),
    ])
  } finally {
    retryingSignupId.value = null
  }
}

async function provisionPublicSignup(item) {
  if (!item?.signup_id) return

  provisioningSignupId.value = item.signup_id
  try {
    const result = await tenantBillingService.provisionPublicSubscriptionSignup(item.signup_id)
    if (!result.success) {
      showError(result.error || 'No fue posible aprovisionar el alta pública')
      return
    }

    showSuccess('Aprovisionamiento ejecutado correctamente')
    await Promise.all([
      loadPublicSignups({ forceRefresh: true }),
      loadSummaries({ forceRefresh: true }),
      loadPublicSignupEvents(item.signup_id),
    ])
    selectedPublicSignup.value = publicSignups.value.find((entry) => entry.signup_id === item.signup_id) || selectedPublicSignup.value
  } finally {
    provisioningSignupId.value = null
  }
}

function openPublicSignupActionDialog(item, action) {
  actionPublicSignup.value = item
  actionDialogAction.value = action
  publicSignupActionNote.value = ''
  publicSignupActionDialog.value = true
}

async function confirmPublicSignupAction() {
  if (!actionPublicSignup.value?.signup_id || !actionDialogAction.value) return

  const signupId = actionPublicSignup.value.signup_id
  actionSignupId.value = signupId
  try {
    let result
    if (actionDialogAction.value === 'resend_access') {
      result = await tenantBillingService.resendPublicSubscriptionSignupAccess(signupId, publicSignupActionNote.value)
    } else if (actionDialogAction.value === 'mark_reviewed') {
      result = await tenantBillingService.markPublicSubscriptionSignupReviewed(signupId, publicSignupActionNote.value)
    } else if (actionDialogAction.value === 'cancel') {
      result = await tenantBillingService.cancelPublicSubscriptionSignup(signupId, publicSignupActionNote.value)
    } else {
      showError('Acción no soportada')
      return
    }

    if (!result.success) {
      showError(result.error || 'No fue posible ejecutar la acción')
      return
    }

    const successMessage = {
      resend_access: 'Correo de acceso reenviado',
      mark_reviewed: 'Solicitud marcada como revisada',
      cancel: 'Solicitud cancelada',
    }[actionDialogAction.value] || 'Acción ejecutada'

    showSuccess(successMessage)
    publicSignupActionDialog.value = false
    await Promise.all([
      loadPublicSignups({ forceRefresh: true }),
      loadSummaries({ forceRefresh: true }),
      loadPublicSignupEvents(signupId),
    ])
    selectedPublicSignup.value = publicSignups.value.find((entry) => entry.signup_id === signupId) || selectedPublicSignup.value
  } finally {
    actionSignupId.value = null
  }
}

async function openPublicSignupDialog(item) {
  selectedPublicSignup.value = item
  publicSignupEvents.value = []
  publicSignupDialog.value = true
  await loadPublicSignupEvents(item.signup_id)
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
