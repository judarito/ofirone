<template>
  <div class="ofir-page sales-page">
    <!-- Tabs -->
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="sales">Historial de Ventas</v-tab>
      <v-tab value="returns">Devoluciones</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- VENTAS -->
      <v-window-item value="sales">
        <!-- Filtros -->
        <v-card class="mb-4 sales-filter-card" elevation="1">
          <v-card-text>
            <v-row dense>
              <v-col cols="12" sm="6" md="3">
                <v-text-field
                  v-model="filters.from_date"
                  type="date"
                  label="Fecha desde"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @change="applyFilters"
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="6" md="3">
                <v-text-field
                  v-model="filters.to_date"
                  type="date"
                  label="Fecha hasta"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @change="applyFilters"
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="filters.location_id"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  :label="t('app.branch')"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                  @update:model-value="applyFilters"
                >
                  <template #prepend-inner>
                    <v-icon size="small">mdi-store</v-icon>
                  </template>
                </v-select>
              </v-col>
              <v-col cols="12" sm="6" md="3" class="d-flex align-center">
                <v-btn
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-refresh"
                  @click="applyFilters"
                  block
                >
                  Actualizar
                </v-btn>
              </v-col>
            </v-row>
            <v-row v-if="filters.from_date || filters.to_date || filters.location_id" dense class="mt-2">
              <v-col cols="12">
                <div class="text-caption text-grey d-flex align-center flex-wrap ga-2">
                  <span>Filtros activos:</span>
                  <v-chip v-if="filters.from_date" size="small" closable @click:close="filters.from_date = ''; applyFilters()">
                    Desde: {{ formatFilterDate(filters.from_date) }}
                  </v-chip>
                  <v-chip v-if="filters.to_date" size="small" closable @click:close="filters.to_date = ''; applyFilters()">
                    Hasta: {{ formatFilterDate(filters.to_date) }}
                  </v-chip>
                  <v-chip v-if="filters.location_id" size="small" closable @click:close="filters.location_id = null; applyFilters()">
                    Sede: {{ getLocationName(filters.location_id) }}
                  </v-chip>
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="error"
                    @click="clearFilters"
                  >
                    Limpiar todos
                  </v-btn>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <ListView
          title="Ventas"
          icon="mdi-receipt"
          :items="sales"
          :total-items="totalSales"
          :loading="loadingSales"
          :page-size="defaultPageSize"
          item-key="sale_id"
          title-field="sale_number"
          avatar-icon="mdi-receipt-text"
          avatar-color="green"
          empty-message="No hay ventas registradas"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          :clickable="true"
          @item-click="viewSale"
          @load-page="loadSales"
          @search="loadSales"
        >
          <template #title="{ item }">
            Venta #{{ item.sale_number }} — {{ item.location?.name || '' }}
          </template>
          <template #subtitle="{ item }">
            {{ formatDate(item.sold_at) }} — {{ item.sold_by_user?.full_name }} {{ item.customer ? '• Cliente: ' + item.customer.full_name : '' }}
          </template>
          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip :color="statusColor(item.status)" size="small" variant="flat">{{ statusLabel(item.status) }}</v-chip>
              <v-chip size="small" variant="tonal" prepend-icon="mdi-cash" color="success">Total: {{ formatMoney(item.total) }}</v-chip>
              <v-chip size="small" variant="tonal" prepend-icon="mdi-calculator" color="info">Impuestos: {{ formatMoney(item.tax_total) }}</v-chip>
              <!-- Badge FE -->
              <v-chip v-if="item.invoice_type === 'FE'" size="small" variant="flat"
                :color="feStatusColor(item.dian_status)" prepend-icon="mdi-file-certificate">
                FE · {{ feStatusLabel(item.dian_status) }}
              </v-chip>
              <v-chip v-else-if="item.invoice_type === 'FV'" size="small" variant="tonal" color="blue-grey" prepend-icon="mdi-receipt">
                Tiquete POS
              </v-chip>
            </div>
            <!-- Botones en móvil - debajo del contenido -->
            <div v-if="item.status === 'COMPLETED'" class="d-flex d-sm-none flex-wrap ga-2 mt-2">
              <v-btn size="small" color="primary" variant="text" prepend-icon="mdi-printer" @click.stop="handlePrintSale(item)" :loading="printing">Imprimir</v-btn>
              <v-btn size="small" color="warning" variant="tonal" @click.stop="openReturnDialog(item)">Devolver</v-btn>
              <v-btn size="small" color="error" variant="tonal" @click.stop="confirmVoid(item)">Anular</v-btn>
            </div>
          </template>
          <template #actions="{ item }">
            <!-- Botones en desktop - al lado derecho -->
            <div class="d-none d-sm-flex ga-1">
              <v-btn size="x-small" color="primary" variant="text" icon="mdi-printer" @click.stop="handlePrintSale(item)" :loading="printing" title="Imprimir Factura"></v-btn>
              <v-btn v-if="item.status === 'COMPLETED'" size="x-small" color="warning" variant="tonal" @click.stop="openReturnDialog(item)">Devolver</v-btn>
              <v-btn v-if="item.status === 'COMPLETED'" size="x-small" color="error" variant="tonal" @click.stop="confirmVoid(item)">Anular</v-btn>
            </div>
          </template>
        </ListView>
      </v-window-item>

      <!-- DEVOLUCIONES -->
      <v-window-item value="returns">
        <ListView
          title="Devoluciones"
          icon="mdi-undo"
          :items="returns"
          :total-items="totalReturns"
          :loading="loadingReturns"
          item-key="return_id"
          title-field="return_id"
          avatar-icon="mdi-undo-variant"
          avatar-color="orange"
          empty-message="No hay devoluciones"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          @load-page="loadReturns"
          @search="loadReturns"
        >
          <template #title="{ item }">
            Devolución de Venta #{{ item.sale?.sale_number }}
          </template>
          <template #subtitle="{ item }">
            {{ formatDate(item.created_at) }} — {{ item.created_by_user?.full_name }} — {{ item.reason || '' }}
          </template>
          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip :color="item.status === 'COMPLETED' ? 'warning' : 'error'" size="small" variant="flat">{{ item.status }}</v-chip>
              <v-chip size="small" variant="tonal" prepend-icon="mdi-cash-refund">{{ formatMoney(item.refund_total) }}</v-chip>
            </div>
          </template>
        </ListView>
      </v-window-item>
    </v-window>

    <!-- Dialog Detalle Venta -->
    <v-dialog v-model="detailDialog" max-width="700" scrollable>
      <v-card v-if="saleDetail">
        <v-card-title>Venta #{{ saleDetail.sale_number }}</v-card-title>
        <v-card-text>
          <div class="mb-3">
            <strong>Fecha:</strong> {{ formatDate(saleDetail.sold_at) }}<br>
            <strong>Vendedor:</strong> {{ saleDetail.sold_by_user?.full_name }}<br>
            <strong>Sede:</strong> {{ saleDetail.location?.name }}<br>
            <strong>Cliente:</strong> {{ saleDetail.customer?.full_name || 'Consumidor final' }}<br>
            <strong>Estado:</strong> <v-chip :color="statusColor(saleDetail.status)" size="x-small">{{ statusLabel(saleDetail.status) }}</v-chip>
          </div>

          <v-table density="compact">
            <thead><tr><th>Producto</th><th class="text-center">Cant.</th><th class="text-center">Devuelto</th><th class="text-right">Precio</th><th class="text-right">Total</th></tr></thead>
            <tbody>
              <tr v-for="line in saleDetail.sale_lines" :key="line.sale_line_id" :class="{ 'bg-red-lighten-5': line.returned_qty > 0 }">
                <td>
                  <v-icon v-if="line.returned_qty > 0" color="error" size="small" class="mr-1">mdi-undo-variant</v-icon>
                  {{ line.variant?.product?.name }} {{ line.variant?.variant_name ? '— ' + line.variant.variant_name : '' }}
                </td>
                <td class="text-center">{{ line.quantity }}</td>
                <td class="text-center">
                  <span v-if="line.returned_qty > 0" class="text-error font-weight-bold">{{ line.returned_qty }}</span>
                  <span v-else class="text-grey">—</span>
                </td>
                <td class="text-right">{{ formatMoney(line.unit_price) }}</td>
                <td class="text-right">{{ formatMoney(line.line_total) }}</td>
              </tr>
            </tbody>
          </v-table>

          <div class="mt-3 text-right">
            <div>Subtotal: {{ formatMoney(saleDetail.subtotal) }}</div>
            <div>Descuento: {{ formatMoney(saleDetail.discount_total) }}</div>
            <div>Impuestos: {{ formatMoney(saleDetail.tax_total) }}</div>
            <div class="text-h6 font-weight-bold">Total: {{ formatMoney(saleDetail.total) }}</div>
          </div>

          <v-divider class="my-3"></v-divider>
          <div class="text-subtitle-2 mb-1">Pagos:</div>
          <v-chip v-for="p in saleDetail.sale_payments" :key="p.sale_payment_id" size="small" variant="tonal" class="mr-1 mb-1">
            {{ p.payment_method?.name }}: {{ formatMoney(p.amount) }} {{ p.reference ? '(' + p.reference + ')' : '' }}
          </v-chip>

          <!-- Sección Facturación Electrónica -->
          <template v-if="saleDetail.invoice_type">
            <v-divider class="my-3"></v-divider>
            <div class="d-flex align-center mb-2">
              <v-icon start :color="saleDetail.invoice_type === 'FE' ? feStatusColor(saleDetail.dian_status) : 'blue-grey'" size="small">mdi-file-certificate</v-icon>
              <span class="text-subtitle-2">
                {{ saleDetail.invoice_type === 'FE' ? 'Factura Electrónica' : 'Tiquete POS (sin FE)' }}
              </span>
              <v-spacer></v-spacer>
              <v-chip v-if="saleDetail.invoice_type === 'FE'" size="x-small" variant="flat"
                :color="feStatusColor(saleDetail.dian_status)">
                {{ feStatusLabel(saleDetail.dian_status) }}
              </v-chip>
            </div>

            <template v-if="saleDetail.invoice_type === 'FE'">
              <v-row dense>
                <v-col cols="12" sm="6" v-if="saleDetail.dian_consecutive">
                  <div class="text-caption text-medium-emphasis">Consecutivo DIAN</div>
                  <div class="text-body-2 font-weight-medium">
                    {{ saleDetail.resolution?.prefix || '' }}{{ saleDetail.dian_consecutive }}
                  </div>
                </v-col>
                <v-col cols="12" sm="6" v-if="saleDetail.third_party">
                  <div class="text-caption text-medium-emphasis">Receptor fiscal</div>
                  <div class="text-body-2 font-weight-medium">{{ saleDetail.third_party.legal_name }}</div>
                  <div class="text-caption text-grey">
                    {{ saleDetail.third_party.document_type }} {{ saleDetail.third_party.document_number }}
                    {{ saleDetail.third_party.dv ? '-' + saleDetail.third_party.dv : '' }}
                  </div>
                </v-col>
                <v-col cols="12" v-if="saleDetail.cufe">
                  <div class="text-caption text-medium-emphasis">CUFE</div>
                  <div class="text-caption font-weight-medium text-mono" style="word-break:break-all">{{ saleDetail.cufe }}</div>
                </v-col>
                <v-col cols="12" v-if="saleDetail.dian_sent_at">
                  <div class="text-caption text-medium-emphasis">Enviado al proveedor</div>
                  <div class="text-body-2">{{ formatDate(saleDetail.dian_sent_at) }}</div>
                </v-col>
                <v-col cols="12" sm="6" v-if="saleDetail.email_sent_at">
                  <div class="text-caption text-medium-emphasis">Enviado al receptor</div>
                  <div class="text-body-2">{{ formatDate(saleDetail.email_sent_at) }}</div>
                </v-col>
              </v-row>

              <!-- QR de validación -->
              <div v-if="saleDetail.qr_url" class="mt-2 d-flex align-center ga-2">
                <v-btn size="small" variant="tonal" color="indigo" prepend-icon="mdi-qrcode"
                  :href="saleDetail.qr_url" target="_blank">Validar en DIAN</v-btn>
              </div>

              <!-- Alerta de rechazo -->
              <v-alert v-if="saleDetail.dian_status === 'REJECTED'" type="error" variant="tonal" density="compact" class="mt-3">
                <div class="font-weight-medium">Factura rechazada por DIAN</div>
                <div class="text-caption" v-if="saleDetail.dian_response?.message">{{ saleDetail.dian_response.message }}</div>
              </v-alert>

              <!-- Reenviar si no fue aceptada -->
              <div v-if="!saleDetail.dian_status || ['PENDING','ERROR','REJECTED'].includes(saleDetail.dian_status)" class="mt-2">
                <v-btn size="small" variant="tonal" color="orange" prepend-icon="mdi-send-clock"
                  :loading="retrying" @click="retryFE(saleDetail)">
                  Reintentar envío FE
                </v-btn>
              </div>
            </template>

            <!-- FV: explicación -->
            <v-alert v-else type="info" variant="tonal" density="compact">
              Esta venta se registró como tiquete POS. Para emitir FE a este cliente, asegúrate de que el tercero tenga activo
              <strong>Acepta Factura Electrónica</strong> y que la FE esté habilitada en Configuración.
            </v-alert>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-btn color="primary" prepend-icon="mdi-printer" :loading="printing" @click="handlePrintSale(saleDetail)">
            Imprimir Factura
          </v-btn>
          <v-spacer></v-spacer>
          <v-btn @click="detailDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Devolución -->
    <v-dialog v-model="returnDialog" max-width="700" scrollable>
      <v-card>
        <v-card-title class="pa-3">
          <v-icon start color="warning">mdi-undo</v-icon>
          Crear Devolución
        </v-card-title>
        <v-card-text v-if="returnSale" class="pa-3">
          <v-form ref="returnForm">
            <v-textarea 
              v-model="returnReason" 
              label="Motivo de devolución" 
              variant="outlined" 
              rows="2" 
              :rules="[rules.required]" 
              class="mb-3"
            ></v-textarea>
            
            <div class="text-subtitle-2 mb-2">Seleccione los productos a devolver:</div>
            
            <!-- Vista Desktop: Tabla -->
            <v-table density="comfortable" class="d-none d-sm-table" style="width: 100%;">
              <thead>
                <tr>
                  <th style="width: 50px;"></th>
                  <th>Producto</th>
                  <th class="text-center" style="width: 100px;">Vendida</th>
                  <th class="text-center" style="width: 120px;">Devolver</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in returnSale.sale_lines" :key="line.sale_line_id">
                  <td>
                    <v-checkbox-btn v-model="line.selected" hide-details density="compact"></v-checkbox-btn>
                  </td>
                  <td>
                    <div class="text-body-2">{{ line.variant?.product?.name }}</div>
                    <div class="text-caption text-grey">{{ line.variant?.variant_name || '' }}</div>
                  </td>
                  <td class="text-center">{{ line.quantity }}</td>
                  <td class="text-center">
                    <v-text-field 
                      v-model.number="line.return_qty" 
                      type="number" 
                      variant="outlined" 
                      density="compact" 
                      hide-details 
                      style="width:90px; margin: 0 auto;" 
                      :min="0" 
                      :max="getLineMaxReturnQty(line)" 
                      :disabled="!line.selected"
                    ></v-text-field>
                  </td>
                </tr>
              </tbody>
            </v-table>

            <!-- Vista Mobile: Cards -->
            <div class="d-sm-none">
              <v-card 
                v-for="line in returnSale.sale_lines" 
                :key="line.sale_line_id" 
                class="mb-2" 
                variant="outlined"
              >
                <v-card-text class="pa-3">
                  <div class="d-flex align-start mb-2">
                    <v-checkbox-btn 
                      v-model="line.selected" 
                      hide-details 
                      density="compact"
                      class="mr-2"
                    ></v-checkbox-btn>
                    <div style="flex: 1;">
                      <div class="text-body-2 font-weight-medium">{{ line.variant?.product?.name }}</div>
                      <div class="text-caption text-grey">{{ line.variant?.variant_name || '' }}</div>
                    </div>
                  </div>
                  <div class="d-flex justify-space-between align-center">
                    <div class="text-caption">
                      <span class="text-grey">Vendida:</span> 
                      <span class="font-weight-bold">{{ line.quantity }}</span>
                    </div>
                    <v-text-field 
                      v-model.number="line.return_qty" 
                      type="number" 
                      variant="outlined" 
                      density="compact" 
                      hide-details 
                      label="Devolver"
                      style="max-width: 100px;" 
                      :min="0" 
                      :max="getLineMaxReturnQty(line)" 
                      :disabled="!line.selected"
                    ></v-text-field>
                  </div>
                </v-card-text>
              </v-card>
            </div>

            <v-divider class="my-3"></v-divider>
            <div class="d-flex align-center mb-2">
              <div class="text-subtitle-2">Reembolso por método de pago</div>
              <v-spacer></v-spacer>
              <v-btn size="small" variant="text" color="primary" @click="distributeRefundsEqually">
                Auto distribuir
              </v-btn>
            </div>

            <v-alert type="info" variant="tonal" density="compact" class="mb-3">
              Total devolución: <strong>{{ formatMoney(getExpectedRefundTotal()) }}</strong>
              · Total reembolso: <strong>{{ formatMoney(getRefundsTotal()) }}</strong>
            </v-alert>

            <v-row
              v-for="(refund, idx) in returnRefunds"
              :key="`refund-${idx}`"
              dense
              class="mb-1"
            >
              <v-col cols="12" sm="5">
                <v-select
                  v-model="refund.payment_method_id"
                  :items="paymentMethods"
                  item-title="name"
                  item-value="payment_method_id"
                  label="Método"
                  density="compact"
                  variant="outlined"
                  hide-details
                ></v-select>
              </v-col>
              <v-col cols="12" sm="3">
                <v-text-field
                  v-model.number="refund.amount"
                  type="number"
                  min="0"
                  step="0.01"
                  label="Monto"
                  density="compact"
                  variant="outlined"
                  hide-details
                ></v-text-field>
              </v-col>
              <v-col cols="10" sm="3">
                <v-text-field
                  v-model="refund.reference"
                  label="Referencia"
                  density="compact"
                  variant="outlined"
                  hide-details
                ></v-text-field>
              </v-col>
              <v-col cols="2" sm="1" class="d-flex align-center justify-end">
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="returnRefunds.length <= 1"
                  @click="removeRefundLine(idx)"
                >
                  <v-icon>mdi-delete</v-icon>
                </v-btn>
              </v-col>
            </v-row>

            <v-btn size="small" variant="tonal" color="primary" @click="addRefundLine">
              <v-icon start size="small">mdi-plus</v-icon>
              Agregar método
            </v-btn>
          </v-form>
        </v-card-text>
        <v-card-actions class="pa-3">
          <v-spacer></v-spacer>
          <v-btn @click="returnDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="warning" :loading="processingReturn" @click="processReturn">Procesar Devolución</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Anular -->
    <v-dialog v-model="voidDialog" max-width="400">
      <v-card>
        <v-card-title><v-icon start color="error">mdi-cancel</v-icon>Anular Venta</v-card-title>
        <v-card-text>¿Anular la venta <strong>#{{ saleToVoid?.sale_number }}</strong> por {{ formatMoney(saleToVoid?.total) }}?</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="voidDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" :loading="voiding" @click="doVoidSale">Anular</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useAuth } from '@/composables/useAuth'
import { usePrint } from '@/composables/usePrint'
import { useTenantSettings } from '@/composables/useTenantSettings'
import ListView from '@/components/ListView.vue'
import salesService from '@/services/sales.service'
import locationsService from '@/services/locations.service'
import paymentMethodsService from '@/services/paymentMethods.service'
import supabaseService from '@/services/supabase.service'
import electronicInvoicingService from '@/services/electronicInvoicing.service'
import { formatMoney, formatDateTimeFull as formatDate } from '@/utils/formatters'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { tenantId } = useTenant()
const { userProfile } = useAuth()
const { printing, printSaleTicket } = usePrint()
const { defaultPageSize, loadSettings, electronicInvoicingEnabled } = useTenantSettings()

const tab = ref('sales')
const sales = ref([])
const totalSales = ref(0)
const loadingSales = ref(false)
const returns = ref([])
const totalReturns = ref(0)
const loadingReturns = ref(false)

// Calcular últimos 7 días (desde hace 7 días hasta hoy)
const getLastWeekDates = () => {
  const today = new Date()
  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setDate(today.getDate() - 7)
  
  return {
    from: sevenDaysAgo.toISOString().split('T')[0],
    to: today.toISOString().split('T')[0]
  }
}

// Filtros de ventas
const lastWeekDates = getLastWeekDates()
const filters = ref({
  from_date: lastWeekDates.from, // Hace 7 días
  to_date: lastWeekDates.to,     // Hoy
  location_id: null
})
const locations = ref([])

const detailDialog = ref(false)
const returnDialog = ref(false)
const voidDialog = ref(false)
const saleDetail = ref(null)
const returnSale = ref(null)
const returnReason = ref('')
const paymentMethods = ref([])
const returnRefunds = ref([{ payment_method_id: null, amount: 0, reference: '' }])
const saleToVoid = ref(null)
const processing = ref(false)
const processingReturn = ref(false)
const voiding = ref(false)
const returnForm = ref(null)
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')
const rules = { required: v => !!v || 'Campo requerido' }

const statusColor = (s) => ({ COMPLETED: 'success', VOIDED: 'error', RETURNED: 'warning', PARTIAL_RETURN: 'orange' }[s] || 'grey')
const statusLabel = (s) => ({ COMPLETED: 'Completada', VOIDED: 'Anulada', RETURNED: 'Devuelta', PARTIAL_RETURN: 'Dev. Parcial' }[s] || s)

const feStatusColor = (s) => ({ ACCEPTED: 'success', PROCESSING: 'blue', PENDING: 'grey', REJECTED: 'error', ERROR: 'orange' }[s] || 'grey')
const feStatusLabel = (s) => ({ ACCEPTED: 'Aceptada DIAN', PROCESSING: 'Procesando', PENDING: 'Pendiente', REJECTED: 'Rechazada', ERROR: 'Error envío' }[s] || (s ? s : 'Sin enviar'))

const retrying = ref(false)
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const getLineMaxReturnQty = (line) => {
  const soldQty = Number(line.quantity) || 0
  const returnedQty = Number(line.returned_qty) || 0
  return Math.max(0, soldQty - returnedQty)
}

const getSelectedReturnLines = () => {
  if (!returnSale.value?.sale_lines) return []
  return returnSale.value.sale_lines
    .filter(l => l.selected && Number(l.return_qty) > 0)
    .map(l => ({
      sale_line_id: l.sale_line_id,
      qty: Number(l.return_qty)
    }))
}

const getExpectedRefundTotal = () => {
  if (!returnSale.value?.sale_lines) return 0
  return round2(
    returnSale.value.sale_lines
      .filter(l => l.selected && Number(l.return_qty) > 0)
      .reduce((sum, l) => {
        const lineQty = Number(l.quantity) || 0
        if (lineQty <= 0) return sum
        const lineTotal = Number(l.line_total) || 0
        const perUnitTotal = lineTotal / lineQty
        return sum + (perUnitTotal * (Number(l.return_qty) || 0))
      }, 0)
  )
}

const getRefundsTotal = () => round2(
  returnRefunds.value.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
)

const addRefundLine = () => {
  returnRefunds.value.push({ payment_method_id: null, amount: 0, reference: '' })
}

const removeRefundLine = (index) => {
  if (returnRefunds.value.length <= 1) return
  returnRefunds.value.splice(index, 1)
}

const distributeRefundsEqually = () => {
  const expected = getExpectedRefundTotal()
  const count = returnRefunds.value.length
  if (count <= 0) return
  const base = round2(expected / count)
  let assigned = 0
  returnRefunds.value = returnRefunds.value.map((line, i) => {
    const amount = i === count - 1 ? round2(expected - assigned) : base
    assigned += amount
    return { ...line, amount }
  })
}
const retryFE = async (sale) => {
  retrying.value = true
  try {
    const r = await electronicInvoicingService.submitInvoice(sale.sale_id, tenantId.value, true)
    if (r.success) {
      showMsg(r.cufe ? '¡Factura electrónica aceptada!' : 'Enviada al proveedor, esperando respuesta', 'success')
      // Refrescar detalle
      const fresh = await salesService.getSaleById(tenantId.value, sale.sale_id)
      if (fresh.success) saleDetail.value = fresh.data
    } else {
      showMsg('Error: ' + r.error, 'error')
    }
  } finally { retrying.value = false }
}

const loadSales = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loadingSales.value = true
  try {
    // Preparar filtros para enviar al servicio
    const serviceFilters = {}
    
    if (filters.value.from_date) {
      // Agregar hora inicio del día (00:00:00)
      serviceFilters.from_date = `${filters.value.from_date}T00:00:00`
    }
    
    if (filters.value.to_date) {
      // Agregar hora fin del día (23:59:59)
      serviceFilters.to_date = `${filters.value.to_date}T23:59:59`
    }
    
    if (filters.value.location_id) {
      serviceFilters.location_id = filters.value.location_id
    }
    
    const r = await salesService.getSales(tid, page, pageSize, serviceFilters)
    if (r.success) { sales.value = r.data; totalSales.value = r.total }
  } finally { loadingSales.value = false }
}

const loadReturns = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loadingReturns.value = true
  try {
    const r = await salesService.getReturns(tid, page, pageSize)
    if (r.success) { returns.value = r.data; totalReturns.value = r.total }
  } finally { loadingReturns.value = false }
}

const viewSale = async (item) => {
  const r = await salesService.getSaleById(tenantId.value, item.sale_id)
  if (r.success) { 
    // Cargar cantidades devueltas para cada línea
    const { data: returnLines } = await supabaseService.client
      .from('sale_return_lines')
      .select('sale_line_id, quantity, return:return_id!inner(status)')
      .eq('return.status', 'COMPLETED')
      .in('sale_line_id', r.data.sale_lines.map(l => l.sale_line_id))
    
    // Agrupar cantidades devueltas por sale_line_id
    const returnedQtys = {}
    ;(returnLines || []).forEach(rl => {
      returnedQtys[rl.sale_line_id] = (returnedQtys[rl.sale_line_id] || 0) + parseFloat(rl.quantity)
    })
    
    // Agregar cantidad devuelta a cada línea
    r.data.sale_lines.forEach(line => {
      line.returned_qty = returnedQtys[line.sale_line_id] || 0
    })
    
    saleDetail.value = r.data
    detailDialog.value = true
  }
  else showMsg('Error al cargar detalle', 'error')
}

const handlePrintSale = async (item) => {
  // Si se pasa un item, cargar sus detalles primero
  let saleData = item && item.sale_id !== saleDetail.value?.sale_id ? null : saleDetail.value
  
  if (!saleData && item) {
    const r = await salesService.getSaleById(tenantId.value, item.sale_id)
    if (r.success) {
      saleData = r.data
    } else {
      showMsg('Error al cargar venta', 'error')
      return
    }
  } else if (!saleData) {
    return
  }
  
  // Obtener datos del tenant
  const { data: tenant } = await supabaseService.client
    .from('tenants')
    .select('*')
    .eq('tenant_id', tenantId.value)
    .single()
  
  printSaleTicket(saleData, tenant)
}

const openReturnDialog = async (item) => {
  const r = await salesService.getSaleById(tenantId.value, item.sale_id)
  if (r.success) {
    const saleLineIds = r.data.sale_lines.map(l => l.sale_line_id)
    const { data: returnLines } = await supabaseService.client
      .from('sale_return_lines')
      .select('sale_line_id, quantity, return:return_id!inner(status)')
      .eq('return.status', 'COMPLETED')
      .in('sale_line_id', saleLineIds)

    const returnedQtyByLine = {}
    ;(returnLines || []).forEach(rl => {
      returnedQtyByLine[rl.sale_line_id] = (returnedQtyByLine[rl.sale_line_id] || 0) + (Number(rl.quantity) || 0)
    })

    r.data.sale_lines.forEach(l => {
      l.returned_qty = returnedQtyByLine[l.sale_line_id] || 0
      l.selected = false
      l.return_qty = getLineMaxReturnQty(l)
    })

    returnSale.value = r.data
    returnReason.value = ''
    returnRefunds.value = [{ payment_method_id: null, amount: 0, reference: '' }]
    const pmR = await paymentMethodsService.getPaymentMethodsForDropdown(tenantId.value, 1, 100)
    paymentMethods.value = pmR.success ? (pmR.data || []).filter(pm => pm.code !== 'CREDITO') : []
    if (paymentMethods.value.length > 0) {
      returnRefunds.value[0].payment_method_id = paymentMethods.value[0].payment_method_id
    }
    returnDialog.value = true
  }
}

const processReturn = async () => {
  const { valid } = await returnForm.value.validate()
  if (!valid || !returnSale.value) return
  const lines = getSelectedReturnLines()
  if (lines.length === 0) { showMsg('Seleccione al menos un producto', 'error'); return }
  const invalidQty = lines.find(l => {
    const sourceLine = returnSale.value.sale_lines.find(s => s.sale_line_id === l.sale_line_id)
    return !sourceLine || l.qty > getLineMaxReturnQty(sourceLine)
  })
  if (invalidQty) {
    showMsg('Una o más cantidades superan el saldo pendiente por devolver', 'error')
    return
  }

  const expectedRefund = getExpectedRefundTotal()
  if (expectedRefund <= 0) {
    showMsg('El total de devolución debe ser mayor que 0', 'error')
    return
  }

  const refunds = returnRefunds.value
    .filter(r => r.payment_method_id && Number(r.amount) > 0)
    .map(r => ({
      payment_method_id: r.payment_method_id,
      amount: round2(r.amount),
      reference: r.reference || null
    }))

  if (refunds.length === 0) {
    showMsg('Registra al menos un método de reembolso', 'error')
    return
  }

  const refundsTotal = round2(refunds.reduce((sum, r) => sum + Number(r.amount), 0))
  if (Math.abs(refundsTotal - expectedRefund) > 0.01) {
    showMsg(`El reembolso (${formatMoney(refundsTotal)}) debe cuadrar con la devolución (${formatMoney(expectedRefund)})`, 'error')
    return
  }

  processingReturn.value = true
  try {
    const r = await salesService.createReturn(tenantId.value, {
      sale_id: returnSale.value.sale_id,
      created_by: userProfile.value?.user_id,
      reason: returnReason.value,
      lines,
      refunds
    })
    if (r.success) { showMsg('Devolución procesada'); returnDialog.value = false; loadSales({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error || 'Error', 'error')
  } finally { processingReturn.value = false }
}

const confirmVoid = (item) => { saleToVoid.value = item; voidDialog.value = true }
const doVoidSale = async () => {
  if (!saleToVoid.value) return
  voiding.value = true
  try {
    const r = await salesService.voidSale(tenantId.value, saleToVoid.value.sale_id)
    if (r.success) { showMsg('Venta anulada'); voidDialog.value = false; loadSales({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error, 'error')
  } finally { voiding.value = false }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  // Obtener todas las sedes (sin paginación) para el filtro
  const r = await locationsService.getLocations(tenantId.value, 1, 1000)
  if (r.success) {
    locations.value = r.data
  }
}

const applyFilters = () => {
  // Recargar primera página con filtros actuales
  loadSales({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
}

const clearFilters = () => {
  const lastWeekDates = getLastWeekDates()
  filters.value = {
    from_date: lastWeekDates.from,
    to_date: lastWeekDates.to,
    location_id: null
  }
  applyFilters()
}

const formatFilterDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })
}

const getLocationName = (locationId) => {
  const location = locations.value.find(l => l.location_id === locationId)
  return location?.name || ''
}

onMounted(async () => {
  await loadSettings()
  await loadLocations()
})


const showMsg = (msg, color = 'success') => { snackbarMessage.value = msg; snackbarColor.value = color; snackbar.value = true }
</script>

<style scoped>
.sales-filter-card {
  border: 1px solid rgba(95, 131, 236, 0.2);
}

.sales-page :deep(.v-field) {
  border-radius: 12px;
}
</style>
