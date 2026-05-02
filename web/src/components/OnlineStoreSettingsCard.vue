<template>
  <v-card variant="outlined">
    <v-card-text>
      <div class="d-flex flex-wrap align-center ga-3 mb-4">
        <div>
          <div class="text-h6">Tienda online</div>
          <div class="text-body-2 text-medium-emphasis">
            Una tienda por tenant, checkout manual y stock online por variante y sede.
          </div>
        </div>
        <v-spacer />
        <v-btn
          color="primary"
          prepend-icon="mdi-content-save-outline"
          :loading="saving"
          :disabled="loading || saveBlocked"
          @click="saveAll"
        >
          Guardar tienda online
        </v-btn>
      </div>

      <v-alert v-if="saveBlocked" type="warning" variant="tonal" class="mb-4">
        La suscripción actual no permite cambios administrativos en esta sección.
      </v-alert>

      <v-alert v-if="notice" :type="noticeType" variant="tonal" class="mb-4">
        {{ notice }}
      </v-alert>

      <v-alert type="info" variant="tonal" class="mb-4">
        Recomendaciones para evitar pixelado:
        Header: mínimo 1600x600 px, ideal 1920x720 px, formato horizontal.
        Logo: mínimo 512x512 px, ideal 1024x1024 px, fondo limpio o transparente.
      </v-alert>

      <div v-if="loading" class="d-flex align-center ga-3 py-8 text-medium-emphasis">
        <v-progress-circular indeterminate size="22" color="primary" />
        Cargando configuración de tienda online...
      </div>

      <template v-else>
        <v-row>
          <v-col cols="12" md="6">
            <v-card variant="tonal" color="primary">
              <v-card-text>
                <div class="text-overline">Link de tienda</div>
                <div class="text-body-1 font-weight-medium text-break">
                  {{ publicStoreUrl || 'Define un slug para generar el link' }}
                </div>
                <div class="d-flex flex-wrap ga-2 mt-3">
                  <v-btn
                    size="small"
                    variant="flat"
                    color="primary"
                    :disabled="!publicStoreUrl"
                    @click="copyStoreUrl"
                  >
                    Copiar link
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="outlined"
                    color="primary"
                    :disabled="!publicStoreUrl"
                    :href="publicStoreUrl || undefined"
                    target="_blank"
                  >
                    Abrir tienda
                  </v-btn>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" md="6">
            <v-card variant="tonal" color="secondary">
              <v-card-text>
                <div class="text-overline">Catálogo publicado</div>
                <div class="text-h5">{{ publishedCount }}</div>
                <div class="text-body-2 mt-2">
                  {{ catalogRows.length }} variantes configuradas · {{ onlineEnabledLabel }}
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-divider class="my-6" />

        <div class="text-subtitle-1 font-weight-bold mb-3">Configuración general</div>
        <v-row>
          <v-col cols="12" md="4">
            <v-switch v-model="storeForm.is_enabled" color="primary" label="Habilitar tienda" hide-details />
          </v-col>
          <v-col cols="12" md="4">
            <v-switch v-model="storeForm.is_published" color="secondary" label="Publicar catálogo" hide-details />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model.number="storeForm.stock_buffer_units"
              type="number"
              min="0"
              label="Buffer operativo"
              variant="outlined"
              hint="Unidades que no se exponen online aunque existan en stock."
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="storeForm.slug"
              label="Slug público"
              variant="outlined"
              hint="Se usará en /s/tu-slug"
              persistent-hint
              @blur="normalizeSlugField"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="storeForm.location_id"
              :items="locationOptions"
              item-title="name"
              item-value="location_id"
              label="Sede de despacho"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="storeForm.sold_by_user_id"
              :items="userOptions"
              item-title="full_name"
              item-value="user_id"
              label="Responsable de venta"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="storeForm.manual_payment_method_id"
              :items="paymentMethodOptions"
              item-title="name"
              item-value="payment_method_id"
              label="Método contable del checkout"
              variant="outlined"
              hint="Se usará al confirmar pagos manuales y al registrar ventas aprobadas por Mercado Pago."
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="storeForm.landing_return_url"
              label="URL de retorno a landing"
              variant="outlined"
              hint="Botón Volver a la landing desde tienda, carrito y checkout."
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-switch
              v-model="storeForm.allow_manual_payment"
              color="primary"
              label="Aceptar pago manual"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-switch
              v-model="storeForm.allow_gateway_payment"
              color="secondary"
              label="Activar Mercado Pago"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="4">
            <div class="d-flex flex-column justify-center h-100">
              <div class="text-caption text-medium-emphasis mb-2">Estado de cobro</div>
              <div class="d-flex flex-wrap align-center ga-2">
                <v-chip :color="mercadoPagoStatusUi.color" variant="tonal">
                  {{ mercadoPagoStatusUi.label }}
                </v-chip>
                <span class="text-body-2 text-medium-emphasis">
                  {{ mercadoPagoStatusUi.shortMessage }}
                </span>
              </div>
            </div>
          </v-col>
        </v-row>

        <v-divider class="my-6" />

        <div class="text-subtitle-1 font-weight-bold mb-3">Credenciales Mercado Pago</div>
        <v-alert type="info" variant="tonal" class="mb-4">
          Cada tenant guarda sus propias credenciales de Mercado Pago. El access token se almacena en backend y no vuelve a mostrarse en texto plano.
        </v-alert>
        <v-row>
          <v-col cols="12" md="4">
            <v-select
              v-model="mercadoPagoForm.environment"
              :items="mercadoPagoEnvironmentOptions"
              item-title="title"
              item-value="value"
              label="Entorno Mercado Pago"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="8" class="d-flex flex-wrap align-center ga-3">
            <v-chip
              :color="mercadoPagoForm.has_access_token ? 'success' : 'warning'"
              variant="tonal"
            >
              {{ mercadoPagoForm.has_access_token ? `Token guardado ${mercadoPagoForm.access_token_hint || ''}` : 'Sin token guardado' }}
            </v-chip>
            <v-chip :color="mercadoPagoStatusUi.color" variant="outlined">
              {{ mercadoPagoStatusUi.label }}
            </v-chip>
          </v-col>
          <v-col cols="12">
            <v-alert :type="mercadoPagoStatusUi.alertType" variant="tonal">
              {{ mercadoPagoStatusUi.message }}
            </v-alert>
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="mercadoPagoForm.public_key"
              label="Public key"
              variant="outlined"
              hint="Ejemplo: TEST-... o APP_USR-... según la documentación de Mercado Pago."
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="mercadoPagoForm.account_email"
              label="Cuenta / email de Mercado Pago"
              variant="outlined"
              hint="Solo informativo para identificar a qué cuenta pertenece este tenant."
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="8">
            <v-text-field
              v-model="mercadoPagoForm.access_token"
              label="Access token"
              variant="outlined"
              type="password"
              autocomplete="new-password"
              hint="Déjalo vacío para conservar el token actual. Si pegas uno nuevo, reemplaza el anterior."
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-switch
              v-model="mercadoPagoForm.clear_access_token"
              color="error"
              label="Eliminar token guardado"
              hide-details
            />
          </v-col>
        </v-row>

        <v-divider class="my-6" />

        <div class="text-subtitle-1 font-weight-bold mb-3">Marca y branding</div>
        <div class="d-flex flex-wrap ga-2 mb-4">
          <v-btn
            variant="tonal"
            color="secondary"
            prepend-icon="mdi-palette-swatch-outline"
            :disabled="!storeForm.header_image_url && !storeForm.brand_logo_url"
            @click="inferPalette"
          >
            Inferir colores desde imágenes
          </v-btn>
        </div>
        <v-row>
          <v-col cols="12" md="6">
            <v-text-field v-model="storeForm.brand_name" label="Nombre de marca" variant="outlined" />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="storeForm.support_whatsapp" label="WhatsApp soporte" variant="outlined" />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="storeForm.brand_logo_url" label="URL logo marca" variant="outlined" />
            <div class="d-flex flex-wrap ga-2 mt-2">
              <v-btn size="small" variant="tonal" color="primary" @click="openAssetPicker('logo')">
                Subir logo
              </v-btn>
              <v-chip v-if="storeForm.brand_logo_url" size="small" variant="tonal">
                Logo cargado
              </v-chip>
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="storeForm.header_image_url" label="URL imagen header" variant="outlined" />
            <div class="d-flex flex-wrap ga-2 mt-2">
              <v-btn size="small" variant="tonal" color="secondary" @click="openAssetPicker('header')">
                Subir header
              </v-btn>
              <v-chip v-if="storeForm.header_image_url" size="small" variant="tonal">
                Header cargado
              </v-chip>
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="storeForm.button_text" label="Texto botón principal" variant="outlined" />
          </v-col>
          <v-col cols="12" md="6">
            <v-textarea
              v-model="storeForm.checkout_message"
              label="Mensaje de checkout"
              variant="outlined"
              rows="3"
              hint="Texto visible antes de confirmar la compra."
              persistent-hint
            />
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="6" sm="4" md="2" v-for="colorField in colorFields" :key="colorField.key">
            <v-text-field
              v-model="storeForm[colorField.key]"
              :label="colorField.label"
              type="color"
              variant="outlined"
              class="online-store-color-input"
            />
          </v-col>
        </v-row>

        <v-card class="mt-2" variant="outlined">
          <div class="online-store-preview" :style="previewStyles">
            <div class="online-store-preview__hero">
              <img
                v-if="storeForm.header_image_url"
                :src="storeForm.header_image_url"
                alt="Header tienda"
                class="online-store-preview__header"
              >
              <div class="online-store-preview__overlay">
                <img
                  v-if="storeForm.brand_logo_url"
                  :src="storeForm.brand_logo_url"
                  alt="Logo tienda"
                  class="online-store-preview__logo"
                >
                <div class="text-h5 font-weight-bold">{{ storeForm.brand_name || 'Tu marca' }}</div>
                <div class="text-body-2 mt-1">{{ storeForm.checkout_message || 'Tu tienda online con branding propio.' }}</div>
                <v-btn class="mt-4" :style="{ backgroundColor: storeForm.primary_color, color: '#fff' }">
                  {{ storeForm.button_text || 'Comprar ahora' }}
                </v-btn>
              </div>
            </div>
          </div>
        </v-card>

        <v-divider class="my-6" />

        <div class="d-flex flex-wrap align-center ga-3 mb-3">
          <div>
            <div class="text-subtitle-1 font-weight-bold">Catálogo online</div>
            <div class="text-body-2 text-medium-emphasis">
              Decide qué variantes se publican y cuánta parte del stock se expone online.
            </div>
          </div>
          <v-spacer />
          <v-text-field
            v-model="catalogSearch"
            label="Buscar variante"
            variant="outlined"
            density="compact"
            hide-details
            prepend-inner-icon="mdi-magnify"
            class="online-store-search"
          />
        </div>

        <v-alert
          v-if="!catalogRows.length"
          type="info"
          variant="tonal"
        >
          Aún no hay variantes activas para publicar. Crea productos o activa variantes primero.
        </v-alert>

        <div v-else class="online-store-catalog-grid">
          <v-card
            v-for="row in filteredCatalogRows"
            :key="row.variant_id"
            variant="outlined"
            class="online-store-catalog-card"
          >
            <v-card-text>
              <div class="d-flex justify-space-between ga-3 mb-2">
                <div>
                  <div class="text-body-1 font-weight-medium">{{ row.product_name }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ row.variant_name || 'Variante principal' }} · SKU {{ row.sku || '—' }}
                  </div>
                </div>
                <v-switch
                  v-model="row.is_published"
                  color="primary"
                  hide-details
                  inset
                />
              </div>

              <div class="text-body-2 mb-3">
                Precio base: <strong>{{ formatMoney(row.price || 0) }}</strong>
              </div>

              <v-row>
                <v-col cols="12" sm="4">
                  <v-select
                    v-model="row.stock_mode"
                    :items="stockModeOptions"
                    item-title="title"
                    item-value="value"
                    label="Modo stock"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field
                    v-model.number="row.stock_value"
                    type="number"
                    min="0"
                    :disabled="row.stock_mode === 'ALL'"
                    :label="row.stock_mode === 'PERCENT' ? '% stock' : 'Valor stock'"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field
                    v-model.number="row.sort_order"
                    type="number"
                    min="0"
                    label="Orden"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </div>

        <v-divider class="my-6" />

        <div class="d-flex flex-wrap align-center ga-3 mb-3">
          <div>
            <div class="text-subtitle-1 font-weight-bold">Pedidos manuales online</div>
            <div class="text-body-2 text-medium-emphasis">
              Revisa pagos pendientes, confirma la venta final o libera la reserva si rechazas el comprobante.
            </div>
          </div>
          <v-spacer />
          <v-btn
            variant="outlined"
            prepend-icon="mdi-refresh"
            :loading="ordersLoading"
            :disabled="loading"
            @click="refreshOrders"
          >
            Actualizar
          </v-btn>
        </div>

        <v-row class="mb-2">
          <v-col cols="12" md="4">
            <v-card variant="tonal" color="warning">
              <v-card-text>
                <div class="text-overline">Pendientes</div>
                <div class="text-h5">{{ pendingOrdersCount }}</div>
                <div class="text-body-2 mt-1">Pedidos esperando validación manual.</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" md="4">
            <v-card variant="tonal" color="info">
              <v-card-text>
                <div class="text-overline">Stock reservado</div>
                <div class="text-h5">{{ reservedUnitsLabel }}</div>
                <div class="text-body-2 mt-1">Unidades apartadas por pagos aún no confirmados.</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" md="4">
            <v-card variant="tonal" color="success">
              <v-card-text>
                <div class="text-overline">Confirmados</div>
                <div class="text-h5">{{ completedOrdersCount }}</div>
                <div class="text-body-2 mt-1">Pedidos ya convertidos a venta real del POS.</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-alert v-if="!storeForm.store_id" type="info" variant="tonal">
          Guarda primero la configuración general de la tienda para empezar a recibir pedidos online.
        </v-alert>

        <v-alert v-else-if="ordersLoading" type="info" variant="tonal">
          Cargando pedidos manuales...
        </v-alert>

        <v-alert v-else-if="!manualOrders.length" type="info" variant="tonal">
          Aún no hay pedidos manuales registrados en esta tienda.
        </v-alert>

        <v-table v-else density="comfortable" class="online-store-orders-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Total</th>
              <th>Reserva</th>
              <th>Creado</th>
              <th class="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in manualOrders" :key="order.online_order_id">
              <td>
                <div class="font-weight-medium">#{{ order.order_number }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ order.payment_reference || 'Sin referencia' }}
                </div>
              </td>
              <td>
                <div>{{ order.customer_name || 'Cliente no informado' }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ order.customer_phone || order.customer_email || 'Sin contacto' }}
                </div>
              </td>
              <td>
                <div class="d-flex flex-wrap ga-2">
                  <v-chip size="small" variant="tonal" :color="orderStatusColor(order)">
                    {{ orderStatusLabel(order) }}
                  </v-chip>
                  <v-chip size="small" variant="tonal" :color="paymentStatusColor(order.payment_status)">
                    {{ paymentStatusLabel(order.payment_status) }}
                  </v-chip>
                </div>
              </td>
              <td>{{ formatMoney(order.total) }}</td>
              <td>{{ formatReservationSummary(order) }}</td>
              <td>
                <div>{{ formatDateTime(order.created_at) }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ order.lines?.length || 0 }} líneas
                </div>
              </td>
              <td class="text-right">
                <div class="d-flex justify-end flex-wrap ga-2">
                  <v-btn
                    v-if="canReviewOrder(order)"
                    size="small"
                    color="success"
                    variant="tonal"
                    :loading="actionLoading && actionOrderId === order.online_order_id && actionMode === 'confirm'"
                    @click="openOrderAction(order, 'confirm')"
                  >
                    Confirmar pago
                  </v-btn>
                  <v-btn
                    v-if="canReviewOrder(order)"
                    size="small"
                    color="error"
                    variant="tonal"
                    :loading="actionLoading && actionOrderId === order.online_order_id && actionMode === 'reject'"
                    @click="openOrderAction(order, 'reject')"
                  >
                    Rechazar
                  </v-btn>
                  <v-chip v-if="order.sale_id" size="small" variant="outlined" color="success">
                    Venta {{ order.sale_id.slice(0, 8) }}
                  </v-chip>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>

      <input
        ref="logoInput"
        class="d-none"
        type="file"
        accept="image/*"
        @change="handleAssetSelected($event, 'logo')"
      >
      <input
        ref="headerInput"
        class="d-none"
        type="file"
        accept="image/*"
        @change="handleAssetSelected($event, 'header')"
      >

      <v-dialog v-model="orderActionDialog" max-width="620">
        <v-card>
          <v-card-title>
            {{ actionMode === 'confirm' ? 'Confirmar pago manual' : 'Rechazar pago manual' }}
          </v-card-title>
          <v-card-text v-if="selectedOrder">
            <div class="text-body-2 text-medium-emphasis mb-4">
              Pedido #{{ selectedOrder.order_number }} · {{ selectedOrder.customer_name || 'Cliente no informado' }}
            </div>

            <v-alert
              :type="actionMode === 'confirm' ? 'info' : 'warning'"
              variant="tonal"
              class="mb-4"
            >
              <template v-if="actionMode === 'confirm'">
                Al confirmar, se crea la venta real en el POS y la reserva de stock pasa a consumida.
              </template>
              <template v-else>
                Al rechazar, el pedido quedará cancelado y el stock reservado volverá a estar disponible en la tienda online.
              </template>
            </v-alert>

            <div class="mb-4">
              <div class="text-subtitle-2 mb-2">Resumen del pedido</div>
              <div class="text-body-2">
                Total: <strong>{{ formatMoney(selectedOrder.total) }}</strong> · Reserva: <strong>{{ formatReservationSummary(selectedOrder) }}</strong>
              </div>
            </div>

            <v-text-field
              v-if="actionMode === 'confirm'"
              v-model="orderActionReference"
              label="Referencia confirmada"
              variant="outlined"
              hint="Puedes ajustar la referencia final del pago antes de registrar la venta."
              persistent-hint
              class="mb-3"
            />

            <v-textarea
              v-model="orderActionNote"
              :label="actionMode === 'confirm' ? 'Nota de validación' : 'Motivo del rechazo'"
              variant="outlined"
              rows="4"
            />
          </v-card-text>
          <v-card-actions class="px-6 pb-5">
            <v-spacer />
            <v-btn variant="text" @click="closeOrderAction">Cancelar</v-btn>
            <v-btn
              :color="actionMode === 'confirm' ? 'success' : 'error'"
              variant="flat"
              :loading="actionLoading"
              @click="submitOrderAction"
            >
              {{ actionMode === 'confirm' ? 'Confirmar pago' : 'Rechazar pedido' }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useNotification } from '@/composables/useNotification'
import onlineStoreService, { slugify } from '@/services/onlineStore.service'
import locationsService from '@/services/locations.service'
import paymentMethodsService from '@/services/paymentMethods.service'
import productsService from '@/services/products.service'
import { getAllUsers } from '@/services/users.service'

const props = defineProps({
  tenantId: {
    type: String,
    default: '',
  },
  saveBlocked: {
    type: Boolean,
    default: false,
  },
})

const { snackbar, snackbarColor, snackbarMessage } = useNotification()

const loading = ref(false)
const saving = ref(false)
const notice = ref('')
const noticeType = ref('info')
const imageWarnings = ref({
  logo: '',
  header: '',
})
const storeForm = ref(onlineStoreService.getEmptyStoreConfig())
const catalogRows = ref([])
const locationOptions = ref([])
const userOptions = ref([])
const paymentMethodOptions = ref([])
const mercadoPagoForm = ref(onlineStoreService.getEmptyMercadoPagoConfig())
const catalogSearch = ref('')
const logoInput = ref(null)
const headerInput = ref(null)
const manualOrders = ref([])
const ordersLoading = ref(false)
const actionLoading = ref(false)
const actionOrderId = ref('')
const actionMode = ref('confirm')
const orderActionDialog = ref(false)
const selectedOrder = ref(null)
const orderActionReference = ref('')
const orderActionNote = ref('')

const colorFields = [
  { key: 'primary_color', label: 'Primario' },
  { key: 'secondary_color', label: 'Secundario' },
  { key: 'accent_color', label: 'Acento' },
  { key: 'background_color', label: 'Fondo' },
  { key: 'surface_color', label: 'Superficie' },
  { key: 'text_color', label: 'Texto' },
]

const stockModeOptions = [
  { title: 'Todo disponible', value: 'ALL' },
  { title: 'Cantidad fija', value: 'FIXED' },
  { title: 'Porcentaje', value: 'PERCENT' },
]

const mercadoPagoEnvironmentOptions = [
  { title: 'Pruebas / Sandbox', value: 'sandbox' },
  { title: 'Producción', value: 'production' },
]

const onlineEnabledLabel = computed(() => {
  if (storeForm.value.is_published) return 'publicada'
  if (storeForm.value.is_enabled) return 'habilitada sin publicar'
  return 'desactivada'
})

const publishedCount = computed(() => catalogRows.value.filter((row) => row.is_published).length)
const pendingOrdersCount = computed(() => manualOrders.value.filter((order) => canReviewOrder(order)).length)
const completedOrdersCount = computed(() => manualOrders.value.filter((order) => order.status === 'COMPLETED' && order.payment_status === 'PAID').length)
const reservedUnits = computed(() => manualOrders.value
  .filter((order) => canReviewOrder(order))
  .reduce((sum, order) => sum + order.reservations
    .filter((reservation) => reservation.status === 'ACTIVE')
    .reduce((orderSum, reservation) => orderSum + Number(reservation.reserved_qty || 0), 0), 0))
const reservedUnitsLabel = computed(() => formatQty(reservedUnits.value))

const filteredCatalogRows = computed(() => {
  const search = String(catalogSearch.value || '').trim().toLowerCase()
  if (!search) return catalogRows.value
  return catalogRows.value.filter((row) => {
    return [
      row.product_name,
      row.variant_name,
      row.sku,
    ].some((value) => String(value || '').toLowerCase().includes(search))
  })
})

const publicStoreUrl = computed(() => {
  if (!storeForm.value.slug) return ''
  if (typeof window === 'undefined') return `/s/${storeForm.value.slug}`
  return `${window.location.origin}/s/${storeForm.value.slug}`
})

const previewStyles = computed(() => ({
  '--preview-primary': storeForm.value.primary_color,
  '--preview-secondary': storeForm.value.secondary_color,
  '--preview-accent': storeForm.value.accent_color,
  '--preview-background': storeForm.value.background_color,
  '--preview-surface': storeForm.value.surface_color,
  '--preview-text': storeForm.value.text_color,
}))

const mercadoPagoHasPublicKey = computed(() => String(mercadoPagoForm.value.public_key || '').trim().length > 0)
const mercadoPagoWillKeepToken = computed(() => {
  if (mercadoPagoForm.value.clear_access_token) return false
  return mercadoPagoForm.value.has_access_token || String(mercadoPagoForm.value.access_token || '').trim().length > 0
})
const mercadoPagoCredentialsReady = computed(() => mercadoPagoHasPublicKey.value && mercadoPagoWillKeepToken.value)
const mercadoPagoStatusUi = computed(() => buildMercadoPagoStatusUi({
  allowGatewayPayment: storeForm.value.allow_gateway_payment,
  environment: mercadoPagoForm.value.environment,
  credentialsReady: mercadoPagoCredentialsReady.value,
}))

function buildMercadoPagoStatusUi({ allowGatewayPayment, environment, credentialsReady }) {
  if (!allowGatewayPayment) {
    return {
      label: 'Desactivado',
      color: 'default',
      alertType: 'info',
      shortMessage: 'Mercado Pago no se ofrecerá en checkout.',
      message: 'Activa Mercado Pago cuando quieras ofrecer cobro online con pasarela. Mientras tanto, la tienda seguirá usando solo pago manual.',
      storeGatewayStatus: 'DISABLED',
      credentialsEnabled: false,
    }
  }

  if (!credentialsReady) {
    return {
      label: 'Faltan credenciales',
      color: 'warning',
      alertType: 'warning',
      shortMessage: 'Completa public key y token.',
      message: 'Mercado Pago está activado para esta tienda, pero todavía faltan credenciales válidas. La pasarela quedará en espera hasta que haya public key y access token disponibles.',
      storeGatewayStatus: 'COMING_SOON',
      credentialsEnabled: false,
    }
  }

  if (environment === 'production') {
    return {
      label: 'Listo para producción',
      color: 'success',
      alertType: 'success',
      shortMessage: 'La tienda ya puede cobrar en vivo.',
      message: 'La configuración quedó completa para cobrar con Mercado Pago en producción. Revisa que la cuenta del tenant sea la correcta antes de publicar.',
      storeGatewayStatus: 'ENABLED',
      credentialsEnabled: true,
    }
  }

  return {
    label: 'Listo para pruebas',
    color: 'success',
    alertType: 'success',
    shortMessage: 'La tienda ya puede probar checkout sandbox.',
    message: 'La configuración quedó completa para pruebas sandbox. Usa buyer test users y tarjetas de prueba para validar el flujo antes de pasar a producción.',
    storeGatewayStatus: 'ENABLED',
    credentialsEnabled: true,
  }
}

function showMsg(message, color = 'success') {
  snackbarMessage.value = message
  snackbarColor.value = color
  snackbar.value = true
}

function getImageRecommendation(type) {
  if (type === 'logo') {
    return {
      minWidth: 512,
      minHeight: 512,
      label: 'logo',
      recommendation: 'Usa mínimo 512x512 px; ideal 1024x1024 px.',
    }
  }
  return {
    minWidth: 1600,
    minHeight: 600,
    label: 'header',
    recommendation: 'Usa mínimo 1600x600 px; ideal 1920x720 px.',
  }
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  })
}

function formatQty(value) {
  const qty = Number(value || 0)
  return Number.isInteger(qty) ? qty.toString() : qty.toFixed(3)
}

function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function paymentStatusLabel(status) {
  if (status === 'PAID') return 'Pago confirmado'
  if (status === 'FAILED') return 'Pago rechazado'
  if (status === 'REFUNDED') return 'Reembolsado'
  return 'Pago pendiente'
}

function paymentStatusColor(status) {
  if (status === 'PAID') return 'success'
  if (status === 'FAILED') return 'error'
  if (status === 'REFUNDED') return 'info'
  return 'warning'
}

function orderStatusLabel(order) {
  if (order.status === 'COMPLETED') return 'Venta creada'
  if (order.status === 'CANCELLED') return 'Cancelado'
  if (order.status === 'FAILED') return 'Falló'
  if (order.status === 'PROCESSING') return 'En revisión'
  return 'Pendiente'
}

function orderStatusColor(order) {
  if (order.status === 'COMPLETED') return 'success'
  if (order.status === 'CANCELLED' || order.status === 'FAILED') return 'error'
  if (order.status === 'PROCESSING') return 'info'
  return 'warning'
}

function canReviewOrder(order) {
  return order?.payment_mode === 'MANUAL'
    && order?.payment_status === 'PENDING'
    && ['PENDING', 'PROCESSING'].includes(order?.status)
    && !order?.sale_id
}

function formatReservationSummary(order) {
  const activeQty = (order?.reservations || [])
    .filter((reservation) => reservation.status === 'ACTIVE')
    .reduce((sum, reservation) => sum + Number(reservation.reserved_qty || 0), 0)

  if (activeQty > 0) return `${formatQty(activeQty)} uds reservadas`
  if (order?.status === 'COMPLETED') return 'Consumida'
  if (order?.status === 'CANCELLED') return 'Liberada'
  return 'Sin reserva'
}

function normalizeSlugField() {
  storeForm.value.slug = slugify(storeForm.value.slug || storeForm.value.brand_name)
}

function mergeCatalog(variants = [], catalog = []) {
  const byVariant = new Map((catalog || []).map((row) => [row.variant_id, row]))
  return (variants || []).map((variant, index) => {
    const existing = byVariant.get(variant.variant_id)
    return {
      variant_id: variant.variant_id,
      product_name: variant.product?.name || 'Producto',
      variant_name: variant.variant_name || '',
      sku: variant.sku || '',
      price: Number(variant.price || 0),
      is_published: existing?.is_published === true,
      stock_mode: existing?.stock_mode || 'ALL',
      stock_value: existing?.stock_value ?? null,
      sort_order: existing?.sort_order ?? index + 1,
      custom_title: existing?.custom_title || '',
      custom_description: existing?.custom_description || '',
    }
  })
}

async function loadData() {
  if (!props.tenantId) return

  loading.value = true
  notice.value = ''

  try {
    const [storeRes, mpConfigRes, locationsRes, usersRes, paymentMethodsRes, variantsRes] = await Promise.all([
      onlineStoreService.getStoreConfig(props.tenantId, { forceRefresh: true }),
      onlineStoreService.getMercadoPagoConfig(props.tenantId),
      locationsService.getActiveLocations(props.tenantId),
      getAllUsers(props.tenantId),
      paymentMethodsService.getPaymentMethodsForDropdown(props.tenantId),
      productsService.getActiveVariants(props.tenantId, 1000),
    ])

    if (!storeRes.success) throw new Error(storeRes.error || 'No se pudo cargar la tienda online.')

    storeForm.value = {
      ...onlineStoreService.getEmptyStoreConfig(),
      ...storeRes.data,
    }
    mercadoPagoForm.value = {
      ...onlineStoreService.getEmptyMercadoPagoConfig(),
      ...(mpConfigRes.success ? (mpConfigRes.data || {}) : {}),
      access_token: '',
      clear_access_token: false,
    }
    storeForm.value.gateway_status = buildMercadoPagoStatusUi({
      allowGatewayPayment: storeForm.value.allow_gateway_payment,
      environment: mercadoPagoForm.value.environment,
      credentialsReady: Boolean(mercadoPagoForm.value.public_key) && Boolean(mercadoPagoForm.value.has_access_token),
    }).storeGatewayStatus

    locationOptions.value = locationsRes.success ? (locationsRes.data || []) : []
    userOptions.value = Array.isArray(usersRes) ? usersRes.filter((item) => item.is_active !== false) : []
    paymentMethodOptions.value = paymentMethodsRes.success ? (paymentMethodsRes.data || []) : []

    const [catalogRes, ordersRes] = storeForm.value.store_id
      ? await Promise.all([
        onlineStoreService.getCatalog(props.tenantId, storeForm.value.store_id, { forceRefresh: true }),
        onlineStoreService.getManualOrders(props.tenantId, storeForm.value.store_id, { forceRefresh: true }),
      ])
      : [{ success: true, data: [] }, { success: true, data: [] }]

    catalogRows.value = mergeCatalog(
      variantsRes.success ? (variantsRes.data || []) : [],
      catalogRes.success ? (catalogRes.data || []) : [],
    )
    manualOrders.value = ordersRes.success ? (ordersRes.data || []) : []
  } catch (error) {
    noticeType.value = 'error'
    notice.value = error.message || 'No se pudo cargar la tienda online.'
  } finally {
    loading.value = false
  }
}

async function refreshOrders() {
  if (!props.tenantId || !storeForm.value.store_id) {
    manualOrders.value = []
    return
  }

  ordersLoading.value = true
  try {
    const result = await onlineStoreService.getManualOrders(props.tenantId, storeForm.value.store_id, { forceRefresh: true })
    if (!result.success) throw new Error(result.error || 'No se pudieron cargar los pedidos manuales.')
    manualOrders.value = result.data || []
  } catch (error) {
    showMsg(error.message || 'No se pudieron cargar los pedidos manuales.', 'error')
  } finally {
    ordersLoading.value = false
  }
}

async function saveAll() {
  if (props.saveBlocked) return
  if (!props.tenantId) return

  saving.value = true
  normalizeSlugField()

  try {
    const mpRes = await onlineStoreService.saveMercadoPagoConfig(props.tenantId, {
      ...mercadoPagoForm.value,
      is_enabled: mercadoPagoStatusUi.value.credentialsEnabled,
    })
    if (!mpRes.success) throw new Error(mpRes.error || 'No se pudieron guardar las credenciales de Mercado Pago.')
    mercadoPagoForm.value = {
      ...onlineStoreService.getEmptyMercadoPagoConfig(),
      ...(mpRes.data || {}),
      access_token: '',
      clear_access_token: false,
    }

    const nextGatewayStatus = buildMercadoPagoStatusUi({
      allowGatewayPayment: storeForm.value.allow_gateway_payment,
      environment: mercadoPagoForm.value.environment,
      credentialsReady: Boolean(mercadoPagoForm.value.public_key) && Boolean(mercadoPagoForm.value.has_access_token),
    }).storeGatewayStatus

    const storeRes = await onlineStoreService.saveStoreConfig(props.tenantId, {
      ...storeForm.value,
      gateway_status: nextGatewayStatus,
    })
    if (!storeRes.success) throw new Error(storeRes.error || 'No se pudo guardar la configuración general.')

    storeForm.value = {
      ...storeForm.value,
      ...storeRes.data,
      gateway_status: nextGatewayStatus,
    }

    const catalogRes = await onlineStoreService.saveCatalogItems(
      props.tenantId,
      storeForm.value.store_id,
      catalogRows.value,
    )
    if (!catalogRes.success) throw new Error(catalogRes.error || 'No se pudo guardar el catálogo online.')

    noticeType.value = 'success'
    notice.value = 'La tienda online quedó guardada.'
    showMsg('Tienda online guardada exitosamente')
    await loadData()
  } catch (error) {
    noticeType.value = 'error'
    notice.value = error.message || 'No se pudo guardar la tienda online.'
    showMsg(error.message || 'No se pudo guardar la tienda online.', 'error')
  } finally {
    saving.value = false
  }
}

function openOrderAction(order, mode) {
  selectedOrder.value = order
  actionMode.value = mode
  actionOrderId.value = order?.online_order_id || ''
  orderActionReference.value = order?.payment_reference || ''
  orderActionNote.value = ''
  orderActionDialog.value = true
}

function closeOrderAction() {
  orderActionDialog.value = false
  selectedOrder.value = null
  actionOrderId.value = ''
  orderActionReference.value = ''
  orderActionNote.value = ''
  actionMode.value = 'confirm'
}

async function submitOrderAction() {
  if (!selectedOrder.value?.online_order_id) return

  actionLoading.value = true
  actionOrderId.value = selectedOrder.value.online_order_id
  try {
    const result = actionMode.value === 'confirm'
      ? await onlineStoreService.confirmManualOrder(selectedOrder.value.online_order_id, {
        payment_reference: orderActionReference.value,
        payment_note: orderActionNote.value,
      })
      : await onlineStoreService.rejectManualOrder(selectedOrder.value.online_order_id, {
        reason: orderActionNote.value,
      })

    if (!result.success) {
      throw new Error(result.error || 'No se pudo procesar el pedido.')
    }

    showMsg(actionMode.value === 'confirm' ? 'Pago confirmado y venta creada en POS.' : 'Pedido rechazado y stock liberado.')
    closeOrderAction()
    await refreshOrders()
  } catch (error) {
    showMsg(error.message || 'No se pudo procesar el pedido.', 'error')
  } finally {
    actionLoading.value = false
    actionOrderId.value = ''
  }
}

function openAssetPicker(type) {
  if (type === 'logo') {
    logoInput.value?.click()
    return
  }
  headerInput.value?.click()
}

async function handleAssetSelected(event, type) {
  const file = event?.target?.files?.[0]
  event.target.value = ''
  if (!file || !props.tenantId) return

  const dimensionRes = await onlineStoreService.getImageDimensions(file)
  if (dimensionRes.success) {
    const recommendation = getImageRecommendation(type)
    const { width, height } = dimensionRes.data
    if (width < recommendation.minWidth || height < recommendation.minHeight) {
      imageWarnings.value[type] = `La imagen de ${recommendation.label} mide ${width}x${height}px. ${recommendation.recommendation}`
      noticeType.value = 'warning'
      notice.value = imageWarnings.value[type]
    } else {
      imageWarnings.value[type] = ''
    }
  }

  const uploadRes = await onlineStoreService.uploadBrandAsset(props.tenantId, file, type)
  if (!uploadRes.success) {
    showMsg(uploadRes.error || 'No se pudo subir la imagen.', 'error')
    return
  }

  if (type === 'logo') {
    storeForm.value.brand_logo_url = uploadRes.data.public_url
  } else {
    storeForm.value.header_image_url = uploadRes.data.public_url
  }
  showMsg('Imagen subida correctamente')
}

async function inferPalette() {
  const result = await onlineStoreService.inferPaletteFromBranding({
    headerImageUrl: storeForm.value.header_image_url,
    logoUrl: storeForm.value.brand_logo_url,
  })

  if (!result.success) {
    showMsg(result.error || 'No se pudieron inferir colores.', 'error')
    return
  }

  Object.assign(storeForm.value, result.data)
  noticeType.value = 'success'
  notice.value = 'Se sugirieron colores automáticamente a partir del header y/o logo. Puedes ajustarlos manualmente antes de guardar.'
  showMsg('Paleta sugerida aplicada')
}

async function copyStoreUrl() {
  if (!publicStoreUrl.value) return
  try {
    await navigator.clipboard.writeText(publicStoreUrl.value)
    showMsg('Link de la tienda copiado')
  } catch (_error) {
    showMsg('No se pudo copiar el link automáticamente.', 'warning')
  }
}

watch(() => props.tenantId, loadData, { immediate: true })
</script>

<style scoped>
.online-store-search {
  min-width: 260px;
}

.online-store-preview {
  background: var(--preview-background);
  color: var(--preview-text);
  border-radius: 20px;
  overflow: hidden;
}

.online-store-preview__hero {
  position: relative;
  min-height: 260px;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--preview-primary) 55%, white) 0%, transparent 45%),
    linear-gradient(135deg, var(--preview-surface) 0%, var(--preview-background) 100%);
}

.online-store-preview__header {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.online-store-preview__overlay {
  position: relative;
  z-index: 1;
  min-height: 260px;
  padding: 28px;
  backdrop-filter: blur(4px);
  background: linear-gradient(135deg, rgb(15 23 42 / 0.20), rgb(15 23 42 / 0.45));
  color: white;
}

.online-store-preview__logo {
  width: 72px;
  height: 72px;
  object-fit: contain;
  border-radius: 18px;
  background: white;
  padding: 8px;
  margin-bottom: 16px;
}

.online-store-catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.online-store-catalog-card {
  height: 100%;
}

.online-store-orders-table {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  overflow: hidden;
}

.online-store-color-input :deep(input[type="color"]) {
  min-height: 44px;
  padding: 4px;
}
</style>
