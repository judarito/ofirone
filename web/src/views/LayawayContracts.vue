<template>
  <div>
    <!-- Filtros de estado -->
    <v-card flat class="mb-3">
      <v-card-text class="pa-2">
        <v-chip-group v-model="statusFilter" mandatory>
          <v-chip value="ALL" filter>Todos</v-chip>
          <v-chip value="ACTIVE" filter color="success">Activos</v-chip>
          <v-chip value="COMPLETED" filter color="primary">Completados</v-chip>
          <v-chip value="CANCELLED" filter color="error">Cancelados</v-chip>
          <v-chip value="EXPIRED" filter color="warning">Expirados</v-chip>
        </v-chip-group>
      </v-card-text>
    </v-card>

    <ListView
      title="Plan Separe"
      icon="mdi-calendar-clock"
      :items="contracts"
      :total-items="totalContracts"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="layaway_id"
      title-field="customer_name"
      avatar-icon="mdi-handshake"
      avatar-color="blue"
      empty-message="No hay contratos de plan separe"
      :creatable="canCreate"
      :editable="false"
      :deletable="false"
      :clickable="true"
      @item-click="viewDetail"
      @create="openCreateDialog"
      @load-page="loadContracts"
      @search="loadContracts"
    >
      <template #title="{ item }">
        {{ item.customer_name }} — {{ item.location_name }}
      </template>
      <template #subtitle="{ item }">
        Creado: {{ formatDate(item.created_at) }} 
        <span v-if="item.due_date"> • Vence: {{ formatDate(item.due_date) }}</span>
      </template>
      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip :color="getStatusColor(item.status)" size="small" variant="flat">
            {{ getStatusLabel(item.status) }}
          </v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-currency-usd" color="primary">
            Total: {{ formatMoney(item.total) }}
          </v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-calculator" color="info">
            Impuestos: {{ formatMoney(item.tax_total) }}
          </v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-cash-check" color="success">
            Pagado: {{ formatMoney(item.paid_total) }}
          </v-chip>
          <v-chip v-if="item.balance > 0" size="small" variant="tonal" prepend-icon="mdi-cash-remove" color="warning">
            Saldo: {{ formatMoney(item.balance) }}
          </v-chip>
          <v-chip v-if="item.sale_id" size="small" variant="tonal" prepend-icon="mdi-receipt" color="green">
            Facturado
          </v-chip>
        </div>
      </template>
    </ListView>

    <!-- Dialog: Crear contrato -->
    <v-dialog v-model="createDialog" max-width="900" scrollable persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon start color="blue">mdi-calendar-clock</v-icon>
          Nuevo Contrato Plan Separe
        </v-card-title>
        <v-card-text>
          <v-form ref="createForm">
            <v-row>
              <!-- Cliente (obligatorio) -->
              <v-col cols="12" md="6">
                <v-autocomplete
                  v-model="formData.customer_id"
                  :items="customerResults"
                  item-title="full_name"
                  item-value="customer_id"
                  label="Cliente *"
                  prepend-inner-icon="mdi-account"
                  variant="outlined"
                  density="compact"
                  :rules="[rules.required]"
                  clearable
                  :loading="searchingCustomer"
                  @update:search="searchCustomer"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props" :subtitle="item.raw.document || item.raw.phone || ''"></v-list-item>
                  </template>
                </v-autocomplete>
              </v-col>

              <!-- Sede -->
              <v-col cols="12" md="6">
                <v-select
                  v-model="formData.location_id"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  label="Sede *"
                  prepend-inner-icon="mdi-store"
                  variant="outlined"
                  density="compact"
                  :rules="[rules.required]"
                ></v-select>
              </v-col>

              <!-- Fecha límite -->
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="formData.due_date"
                  type="date"
                  label="Fecha límite (opcional)"
                  prepend-inner-icon="mdi-calendar"
                  variant="outlined"
                  density="compact"
                  :min="today"
                ></v-text-field>
              </v-col>

              <!-- Nota -->
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="formData.note"
                  label="Nota (opcional)"
                  prepend-inner-icon="mdi-note-text"
                  variant="outlined"
                  density="compact"
                ></v-text-field>
              </v-col>

              <!-- PRODUCTOS -->
              <v-col cols="12">
                <v-divider class="my-2"></v-divider>
                <div class="text-subtitle-2 mb-2">Productos</div>
                
                <!-- Búsqueda de productos -->
                <v-autocomplete
                  v-model="selectedVariant"
                  v-model:search="searchTerm"
                  :items="searchResults"
                  :loading="searchingProduct"
                  item-title="_displayName"
                  item-value="variant_id"
                  return-object
                  label="Buscar producto (código, SKU o nombre)"
                  prepend-inner-icon="mdi-barcode-scan"
                  variant="outlined"
                  density="compact"
                  hide-details
                  no-filter
                  clearable
                  :no-data-text="searchTerm && searchTerm.length >= 2 ? 'No se encontraron productos' : 'Escribe para buscar...'"
                  @update:search="debouncedSearch"
                  @update:model-value="addProduct"
                  class="mb-3"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props" :subtitle="'SKU: ' + item.raw.sku + ' | Stock: ' + (item.raw._stock ?? '—') + ' | ' + formatMoney(item.raw.price)">
                      <template #prepend>
                        <v-icon color="primary" size="small">mdi-package-variant</v-icon>
                      </template>
                    </v-list-item>
                  </template>
                </v-autocomplete>

                <!-- Tabla de productos agregados -->
                <v-table v-if="formData.items.length > 0" density="compact">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th class="text-center" style="width:100px">Cant.</th>
                      <th class="text-right" style="width:120px">Precio Unit.</th>
                      <th class="text-right" style="width:100px">Subtotal</th>
                      <th class="text-center" style="width:180px">Descuento</th>
                      <th class="text-right" style="width:120px">Total</th>
                      <th style="width:50px"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, i) in formData.items" :key="i">
                      <td>
                        <div class="text-body-2">
                          {{ item.productName }}
                          <v-chip v-if="item.price_includes_tax" size="x-small" color="primary" variant="tonal" class="ml-1">IVA incl.</v-chip>
                        </div>
                        <div class="text-caption text-grey">{{ item.variantName }} — {{ item.sku }}</div>
                      </td>
                      <td class="text-center">
                        <v-text-field v-model.number="item.qty" type="number" variant="outlined" density="compact" hide-details style="width:80px" min="1" @update:model-value="recalculateItem(item)"></v-text-field>
                      </td>
                      <td class="text-right">
                        <v-text-field v-model.number="item.unit_price" type="number" variant="outlined" density="compact" hide-details style="width:110px" min="0" @update:model-value="recalculateItem(item)"></v-text-field>
                      </td>
                      <td class="text-right text-grey">{{ formatMoney(item.qty * item.unit_price) }}</td>
                      <td class="text-center">
                        <div class="d-flex align-center gap-1">
                          <v-btn-toggle v-model="item.discount_type" mandatory density="compact" variant="outlined" divided style="height: 32px;">
                            <v-btn value="AMOUNT" size="x-small" @click="recalculateItem(item)">$</v-btn>
                            <v-btn value="PERCENT" size="x-small" @click="recalculateItem(item)">%</v-btn>
                          </v-btn-toggle>
                          <v-text-field v-model.number="item.discount" type="number" variant="outlined" density="compact" hide-details style="width:70px" min="0" :max="item.discount_type === 'PERCENT' ? 100 : undefined" @update:model-value="recalculateItem(item)"></v-text-field>
                        </div>
                      </td>
                      <td class="text-right font-weight-bold">{{ formatMoney(item.total) }}</td>
                      <td><v-btn icon="mdi-close" size="x-small" variant="text" color="error" @click="removeProduct(i)"></v-btn></td>
                    </tr>
                  </tbody>
                </v-table>
                <div v-else class="text-center text-grey py-4">
                  <v-icon size="36">mdi-package-variant-closed</v-icon>
                  <div>Agrega productos al contrato</div>
                </div>
              </v-col>

              <!-- TOTALES -->
              <v-col v-if="formData.items.length > 0" cols="12">
                <v-card variant="tonal" color="primary">
                  <v-card-text class="pa-3">
                    <div class="d-flex justify-space-between mb-1">
                      <span>Subtotal:</span><span>{{ formatMoney(contractTotals.subtotal) }}</span>
                    </div>
                    <div class="d-flex justify-space-between mb-1">
                      <span>Descuentos:</span><span>{{ formatMoney(contractTotals.discount) }}</span>
                    </div>
                    <div class="d-flex justify-space-between mb-1">
                      <span>Impuestos:</span><span>{{ formatMoney(contractTotals.tax) }}</span>
                    </div>
                    <v-divider class="my-2"></v-divider>
                    <div class="d-flex justify-space-between text-h6 font-weight-bold">
                      <span>TOTAL:</span><span>{{ formatMoney(contractTotals.total) }}</span>
                    </div>
                  </v-card-text>
                </v-card>
              </v-col>

              <!-- ABONO INICIAL -->
              <v-col cols="12">
                <v-divider class="my-2"></v-divider>
                <v-checkbox v-model="hasInitialPayment" label="Registrar abono inicial" hide-details density="compact"></v-checkbox>
              </v-col>

              <template v-if="hasInitialPayment">
                <v-col cols="12" md="6">
                  <v-select
                    v-model="initialPayment.payment_method_code"
                    :items="paymentMethods"
                    item-title="name"
                    item-value="code"
                    label="Método de pago *"
                    prepend-inner-icon="mdi-cash"
                    variant="outlined"
                    density="compact"
                    :rules="[rules.required]"
                  ></v-select>
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model.number="initialPayment.amount"
                    type="number"
                    label="Monto *"
                    prepend-inner-icon="mdi-currency-usd"
                    variant="outlined"
                    density="compact"
                    :rules="[rules.required, rules.positive]"
                    min="0"
                  ></v-text-field>
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="initialPayment.reference"
                    label="Referencia (opcional)"
                    prepend-inner-icon="mdi-tag"
                    variant="outlined"
                    density="compact"
                  ></v-text-field>
                </v-col>
              </template>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="closeCreateDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="creating" :disabled="formData.items.length === 0" @click="createContract">
            Crear Contrato
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAuth } from '@/composables/useAuth'
import ListView from '@/components/ListView.vue'
import layawayService from '@/services/layaway.service'
import productsService from '@/services/products.service'
import customersService from '@/services/customers.service'
import paymentMethodsService from '@/services/paymentMethods.service'
import locationsService from '@/services/locations.service'
import cashService from '@/services/cash.service'
import taxesService from '@/services/taxes.service'
import { calculateDiscount } from '@/utils/discountCalculator'
import { formatMoney, formatDate } from '@/utils/formatters'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const router = useRouter()
const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { userProfile, hasPermission } = useAuth()

const canCreate = hasPermission('LAYAWAY.CREATE')

const statusFilter = ref('ALL')
const contracts = ref([])
const totalContracts = ref(0)
const loading = ref(false)
const createDialog = ref(false)
const creating = ref(false)
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

const createForm = ref(null)
const hasInitialPayment = ref(false)
const locations = ref([])
const paymentMethods = ref([])
const currentSession = ref(null)

// Cliente
const customerResults = ref([])
const searchingCustomer = ref(false)

// Productos
const searchTerm = ref('')
const searchResults = ref([])
const selectedVariant = ref(null)
const searchingProduct = ref(false)
let searchTimeout = null

const today = computed(() => new Date().toISOString().split('T')[0])

const formData = ref({
  customer_id: null,
  location_id: null,
  due_date: null,
  note: '',
  items: []
})

const initialPayment = ref({
  payment_method_code: '',
  amount: 0,
  reference: ''
})

const contractTotals = computed(() => {
  let subtotal = 0, discount = 0, tax = 0
  formData.value.items.forEach(item => {
    const base = item.qty * item.unit_price
    subtotal += base
    // Calcular descuento según tipo
    const discountAmount = calculateDiscount(
      base,
      item.discount || 0,
      item.discount_type || 'AMOUNT'
    )
    discount += discountAmount
    // Impuesto simplificado al 19% sobre base - descuento
    const taxBase = base - discountAmount
    tax += taxBase * 0.19
  })
  return {
    subtotal: Math.round(subtotal),
    discount: Math.round(discount),
    tax: Math.round(tax),
    total: Math.round(subtotal - discount + tax)
  }
})

const rules = {
  required: v => !!v || 'Campo requerido',
  positive: v => v > 0 || 'Debe ser mayor a 0'
}

const getStatusColor = (status) => ({
  ACTIVE: 'success',
  COMPLETED: 'primary',
  CANCELLED: 'error',
  EXPIRED: 'warning'
}[status] || 'grey')

const getStatusLabel = (status) => ({
  ACTIVE: 'Activo',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado'
}[status] || status)

const loadContracts = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  loading.value = true
  try {
    const status = statusFilter.value === 'ALL' ? null : statusFilter.value
    const r = await layawayService.getLayawayContracts(tid, page, pageSize, status)
    if (r.success) {
      contracts.value = r.data
      totalContracts.value = r.total
    }
  } finally {
    loading.value = false
  }
}

const viewDetail = (item) => {
  router.push({ name: 'LayawayDetail', params: { id: item.layaway_id } })
}

// ===== CREAR CONTRATO =====
const openCreateDialog = () => {
  formData.value = {
    customer_id: null,
    location_id: locations.value[0]?.location_id || null,
    due_date: null,
    note: '',
    items: []
  }
  initialPayment.value = {
    payment_method_code: paymentMethods.value[0]?.code || '',
    amount: 0,
    reference: ''
  }
  hasInitialPayment.value = false
  createDialog.value = true
}

const closeCreateDialog = () => {
  createDialog.value = false
  searchTerm.value = ''
  searchResults.value = []
}

const searchCustomer = async (search) => {
  if (!search || search.length < 2 || !tenantId.value) return
  searchingCustomer.value = true
  const r = await customersService.searchCustomers(tenantId.value, search)
  customerResults.value = r.success ? r.data : []
  searchingCustomer.value = false
}

// Productos
const debouncedSearch = (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val || val.length < 2) { searchResults.value = []; return }
  searchTimeout = setTimeout(() => fetchSuggestions(val), 350)
}

const fetchSuggestions = async (query) => {
  if (!query || !tenantId.value || !formData.value.location_id) return
  searchingProduct.value = true
  try {
    const r = await productsService.searchVariants(tenantId.value, query)
    if (r.success) {
      // Enriquecer con stock disponible
      searchResults.value = await Promise.all(r.data.map(async v => {
        const stockR = await layawayService.getStockAvailable(tenantId.value, formData.value.location_id, v.variant_id)
        const available = stockR.success ? stockR.data.available : 0
        return {
          ...v,
          _displayName: `${v.product?.name || ''}${v.variant_name ? ' — ' + v.variant_name : ''} (${v.sku})`,
          _stock: available
        }
      }))
    }
  } finally {
    searchingProduct.value = false
  }
}

const addProduct = async (variant) => {
  if (!variant) return
  
  const existing = formData.value.items.find(i => i.variant_id === variant.variant_id)
  if (existing) {
    showMsg('Producto ya agregado', 'warning')
    selectedVariant.value = null
    searchTerm.value = ''
    return
  }

  const item = {
    variant_id: variant.variant_id,
    sku: variant.sku,
    productName: variant.product?.name || '',
    variantName: variant.variant_name || '',
    qty: 1,
    unit_price: parseFloat(variant.price) || 0,
    price_includes_tax: variant.price_includes_tax || false, // 🆕 NUEVO
    discount: 0,
    discount_type: 'AMOUNT',
    base_amount: 0, // 🆕 NUEVO: Base gravable
    tax_amount: 0, // 🆕 NUEVO
    tax_rate: 0, // 🆕 NUEVO
    total: parseFloat(variant.price) || 0
  }
  
  // 🆕 NUEVO: Calcular impuestos antes de agregar
  await recalculateItem(item)
  
  formData.value.items.push(item)
  selectedVariant.value = null
  searchTerm.value = ''
  searchResults.value = []
}

const removeProduct = (index) => {
  formData.value.items.splice(index, 1)
}

const recalculateItem = async (item) => {
  if (!tenantId.value || !item.variant_id) return
  
  // 1. Calcular subtotal
  const subtotal = item.qty * item.unit_price
  
  // 2. Calcular descuento
  const discountAmount = calculateDiscount(
    subtotal,
    item.discount || 0,
    item.discount_type || 'AMOUNT'
  )
  
  // 3. Precio después de descuento
  const priceAfterDiscount = subtotal - discountAmount
  if (priceAfterDiscount < 0) {
    item.total = 0
    item.tax_amount = 0
    return
  }
  
  // 4. Obtener información del impuesto
  const taxResult = await taxesService.getTaxInfoForVariant(tenantId.value, item.variant_id)
  
  if (taxResult.success && taxResult.rate) {
    item.tax_rate = taxResult.rate
    
    // 5. 🆕 NUEVA LÓGICA: Calcular según si el precio incluye o no IVA
    if (item.price_includes_tax) {
      // IVA INCLUIDO: descomponer
      const total = priceAfterDiscount
      const base = total / (1 + item.tax_rate)
      const tax = total - base
      
      item.base_amount = Math.round(base)
      item.tax_amount = Math.round(tax)
      item.total = Math.round(total)
    } else {
      // IVA ADICIONAL: agregar
      const base = priceAfterDiscount
      const tax = base * item.tax_rate
      const total = base + tax
      
      item.base_amount = Math.round(base)
      item.tax_amount = Math.round(tax)
      item.total = Math.round(total)
    }
  } else {
    // Sin impuesto
    item.base_amount = Math.round(priceAfterDiscount)
    item.tax_amount = 0
    item.tax_rate = 0
    item.total = Math.round(priceAfterDiscount)
  }
}

const createContract = async () => {
  const { valid } = await createForm.value.validate()
  if (!valid || formData.value.items.length === 0) return

  // Validar que haya una caja abierta si hay abono inicial
  if (hasInitialPayment.value && initialPayment.value.amount > 0 && !currentSession.value) {
    snackbarMessage.value = 'Debe abrir una caja antes de registrar pagos'
    snackbarColor.value = 'error'
    snackbar.value = true
    return
  }

  creating.value = true
  try {
    const items = formData.value.items.map(i => ({
      variant_id: i.variant_id,
      qty: i.qty,
      unit_price: i.unit_price,
      discount: i.discount || 0,
      discount_type: i.discount_type || 'AMOUNT'
    }))

    const initial_payment = hasInitialPayment.value && initialPayment.value.amount > 0 ? {
      payment_method_code: initialPayment.value.payment_method_code,
      amount: initialPayment.value.amount,
      reference: initialPayment.value.reference || null,
      cash_session_id: currentSession.value?.cash_session_id || null
    } : null

    const r = await layawayService.createLayaway(tenantId.value, {
      location_id: formData.value.location_id,
      customer_id: formData.value.customer_id,
      created_by: userProfile.value.user_id,
      items,
      due_date: formData.value.due_date || null,
      note: formData.value.note || null,
      initial_payment,
      installments: null // Por ahora no se implementan cuotas en la UI
    })

    if (r.success) {
      showMsg('Contrato creado exitosamente')
      closeCreateDialog()
      loadContracts({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
    } else {
      showMsg(r.error, 'error')
    }
  } finally {
    creating.value = false
  }
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = msg
  snackbarColor.value = color
  snackbar.value = true
}

onMounted(async () => {
  if (!tenantId.value) return

  await loadSettings()

  // Cargar sedes activas
  const locR = await locationsService.getActiveLocations(tenantId.value)
  if (locR.success) locations.value = locR.data

  // Cargar métodos de pago (excluyendo LAYAWAY)
  const pmR = await paymentMethodsService.getPaymentMethodsForDropdown(tenantId.value, 1, 100)
  if (pmR.success) paymentMethods.value = pmR.data

  // Buscar sesión de caja abierta
  const regs = await cashService.getAllCashRegisters(tenantId.value)
  if (regs.success) {
    for (const reg of regs.data) {
      const s = await cashService.getOpenSession(tenantId.value, reg.cash_register_id)
      if (s.success && s.data) {
        currentSession.value = { ...s.data, cash_register: reg }
        break
      }
    }
  }
})
</script>
