<template>
  <div class="storefront" :style="themeStyles" data-testid="public-storefront-page">
    <div class="storefront__shell">
      <section class="storefront__hero">
        <div
          v-if="store?.header_image_url"
          class="storefront__hero-media"
          :style="{ backgroundImage: `url(${store.header_image_url})` }"
        ></div>
        <div class="storefront__hero-backdrop"></div>
        <div class="storefront__hero-content">
          <div class="storefront__hero-head">
            <div class="storefront__brand-wrap">
              <div v-if="store?.brand_logo_url" class="storefront__logo-frame">
                <img
                  :src="store.brand_logo_url"
                  alt="Logo tienda"
                  class="storefront__brand-logo"
                >
              </div>
              <div class="storefront__brand-copy">
                <div class="storefront__eyebrow">Tienda online</div>
                <h1 class="storefront__title">{{ store?.brand_name || 'Tienda' }}</h1>
                <div class="storefront__meta">
                  <span>{{ store?.location_name || 'Catálogo público' }}</span>
                  <span v-if="categoryOptions.length">{{ categoryOptions.length }} categorías</span>
                  <span>{{ products.length }} productos</span>
                </div>
              </div>
            </div>

            <div class="storefront__hero-actions">
              <v-btn
                class="storefront__hero-btn"
                variant="flat"
                color="primary"
                @click="goToSection('cart')"
              >
                Carrito ({{ cartItemsCount }})
              </v-btn>
              <v-btn
                v-if="effectiveReturnUrl"
                class="storefront__hero-btn"
                variant="outlined"
                :href="effectiveReturnUrl"
              >
                Volver a tu landing
              </v-btn>
            </div>
          </div>

          <div class="storefront__hero-body">
            <p class="storefront__hero-text">
              {{ store?.checkout_message || 'Explora el catálogo, filtra por categoría y arma tu pedido sin salir de la experiencia de marca.' }}
            </p>
            <div class="storefront__stats">
              <div class="storefront__stat">
                <span class="storefront__stat-label">Stock visible</span>
                <strong>{{ inStockCount }}</strong>
              </div>
              <div class="storefront__stat">
                <span class="storefront__stat-label">Ticket actual</span>
                <strong>{{ formatMoney(cartTotal) }}</strong>
              </div>
              <div class="storefront__stat">
                <span class="storefront__stat-label">Checkout</span>
                <strong>{{ checkoutHeroLabel }}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div v-if="loading" class="d-flex align-center justify-center ga-3 py-16 text-medium-emphasis">
        <v-progress-circular indeterminate color="primary" />
        Cargando tienda...
      </div>

      <v-alert v-else-if="errorMessage" type="error" variant="tonal" class="mt-6">
        {{ errorMessage }}
      </v-alert>

      <template v-else>
        <v-alert v-if="successOrder" type="success" variant="tonal" class="mt-6">
          <div class="font-weight-bold">Pedido recibido</div>
          <div class="mt-2">
            Pedido #{{ successOrder.order_number }} · Pago pendiente de confirmación
          </div>
          <div class="mt-2">
            Total: <strong>{{ formatMoney(successOrder.total) }}</strong>
          </div>
          <div class="mt-2">
            {{ successOrder.message || successOrderMessage }}
          </div>
          <div class="d-flex flex-wrap ga-2 mt-4">
            <v-btn color="primary" variant="flat" @click="goToSection('catalog')">
              Seguir comprando
            </v-btn>
            <v-btn
              variant="outlined"
              :to="`/pedido/${successOrder.online_order_id}`"
            >
              Ver estado del pedido
            </v-btn>
            <v-btn v-if="effectiveReturnUrl" variant="outlined" :href="effectiveReturnUrl">
              Volver a la landing
            </v-btn>
          </div>
        </v-alert>

        <section class="storefront__toolbar">
          <div class="storefront__toolbar-left">
            <div class="storefront__toolbar-title">Explora la tienda</div>
            <div class="storefront__toolbar-subtitle">
              Busca por nombre, SKU o variante y filtra por categoría.
            </div>
          </div>

          <div class="storefront__toolbar-right">
            <v-text-field
              v-model="searchTerm"
              label="Buscar producto"
              variant="outlined"
              density="comfortable"
              hide-details
              prepend-inner-icon="mdi-magnify"
              class="storefront__search"
            />
            <v-select
              v-model="sortMode"
              :items="sortOptions"
              label="Ordenar"
              variant="outlined"
              density="comfortable"
              hide-details
              class="storefront__sort"
            />
          </div>
        </section>

        <section class="storefront__filters">
          <button
            type="button"
            class="storefront__filter-chip"
            :class="{ 'storefront__filter-chip--active': selectedCategory === 'ALL' }"
            @click="selectedCategory = 'ALL'"
          >
            Todas
          </button>
          <button
            v-for="category in categoryOptions"
            :key="category"
            type="button"
            class="storefront__filter-chip"
            :class="{ 'storefront__filter-chip--active': selectedCategory === category }"
            @click="selectedCategory = category"
          >
            {{ category }}
          </button>
          <button
            type="button"
            class="storefront__filter-chip storefront__filter-chip--utility"
            :class="{ 'storefront__filter-chip--active': onlyInStock }"
            @click="onlyInStock = !onlyInStock"
          >
            Solo disponibles
          </button>
        </section>

        <section v-if="currentSection === 'catalog'" class="mt-6">
          <div class="storefront__section-head">
            <div>
              <div class="storefront__section-title">Productos disponibles</div>
              <div class="storefront__section-copy">
                {{ filteredProducts.length }} resultados
                <span v-if="selectedCategory !== 'ALL'">en {{ selectedCategory }}</span>
                <span v-if="normalizedSearch"> para "{{ normalizedSearch }}"</span>
              </div>
            </div>
            <div class="storefront__section-actions">
              <v-btn variant="outlined" @click="goToSection('cart')">
                Ver carrito
              </v-btn>
            </div>
          </div>

          <v-alert v-if="!products.length" type="info" variant="tonal">
            Esta tienda todavía no tiene productos publicados.
          </v-alert>

          <v-alert v-else-if="!filteredProducts.length" type="info" variant="tonal">
            No encontramos productos con esos filtros. Prueba otra búsqueda o vuelve a “Todas”.
          </v-alert>

          <div v-else class="storefront__grid">
            <v-card
              v-for="product in filteredProducts"
              :key="product.variant_id"
              class="storefront__card"
              variant="outlined"
            >
              <div
                class="storefront__card-media"
                :class="{ 'storefront__card-media--placeholder': !product.image_url }"
                :style="product.image_url ? { backgroundImage: `url(${product.image_url})` } : fallbackMediaStyle(product)"
              >
                <div class="storefront__card-media-overlay"></div>
                <div v-if="!product.image_url" class="storefront__card-media-copy">
                  <span class="storefront__card-media-kicker">{{ product.category_name || 'Producto' }}</span>
                  <strong>{{ product.display_name }}</strong>
                </div>
              </div>
              <v-card-text class="storefront__card-body">
                <div class="storefront__card-topline">
                  <span class="storefront__sku">SKU {{ product.sku || '—' }}</span>
                  <span v-if="product.category_name" class="storefront__category-pill">
                    {{ product.category_name }}
                  </span>
                </div>

                <div class="storefront__card-title">{{ product.display_name }}</div>
                <div v-if="product.variant_name" class="storefront__card-variant">
                  {{ product.variant_name }}
                </div>
                <div v-if="product.display_description" class="storefront__card-description">
                  {{ product.display_description }}
                </div>

                <div class="storefront__card-footer">
                  <div class="storefront__price-block">
                    <div class="storefront__price-label">Precio final</div>
                    <div class="storefront__price-value">{{ formatMoney(product.final_price) }}</div>
                  </div>
                  <div
                    class="storefront__availability"
                    :class="Number(product.available || 0) > 0 ? 'storefront__availability--ok' : 'storefront__availability--empty'"
                  >
                    {{ Number(product.available || 0) > 0 ? `${formatQty(product.available)} disponibles` : 'Agotado' }}
                  </div>
                </div>

                <div class="storefront__stepper">
                  <button
                    type="button"
                    class="storefront__stepper-btn storefront__stepper-btn--muted"
                    :disabled="getCartQuantity(product.variant_id) <= 0"
                    @click="decrementProduct(product.variant_id)"
                  >
                    -
                  </button>
                  <div class="storefront__stepper-value">
                    {{ getCartQuantity(product.variant_id) }}
                  </div>
                  <button
                    type="button"
                    class="storefront__stepper-btn storefront__stepper-btn--primary"
                    :disabled="getCartQuantity(product.variant_id) >= Number(product.available || 0)"
                    @click="incrementProduct(product)"
                  >
                    +
                  </button>
                </div>
                <a
                  v-if="whatsappPhone"
                  class="storefront__product-whatsapp"
                  :href="buildProductWhatsappUrl(product)"
                  target="_blank"
                  rel="noreferrer"
                >
                  Consultar por WhatsApp
                </a>
              </v-card-text>
            </v-card>
          </div>
        </section>

        <section v-if="currentSection === 'cart'" class="mt-8">
          <div class="storefront__section-head">
            <div>
              <div class="storefront__section-title">Carrito</div>
              <div class="storefront__section-copy">
                Ajusta cantidades y luego pasa al checkout para elegir cómo pagar.
              </div>
            </div>
            <div class="storefront__section-actions">
              <v-btn variant="outlined" @click="goToSection('catalog')">
                Seguir comprando
              </v-btn>
              <v-btn color="primary" variant="flat" :disabled="cart.length === 0" @click="goToSection('checkout')">
                Ir al checkout
              </v-btn>
            </div>
          </div>

          <v-alert v-if="cart.length === 0" type="info" variant="tonal">
            Tu carrito está vacío.
          </v-alert>

          <div v-else class="storefront__list">
            <v-card v-for="item in cart" :key="item.variant_id" variant="outlined" class="storefront__list-card">
              <v-card-text class="storefront__list-card-body">
                <div class="storefront__list-copy">
                  <div class="storefront__list-title">{{ item.display_name }}</div>
                  <div class="storefront__list-meta">
                    <span>{{ item.variant_name || 'Variante principal' }}</span>
                    <span>SKU {{ item.sku || '—' }}</span>
                    <span v-if="item.category_name">{{ item.category_name }}</span>
                  </div>
                  <div class="storefront__list-price">
                    Precio final: <strong>{{ formatMoney(item.final_price) }}</strong>
                  </div>
                </div>

                <div class="storefront__list-actions">
                  <div class="storefront__stepper">
                    <button type="button" class="storefront__stepper-btn storefront__stepper-btn--muted" @click="decrementProduct(item.variant_id)">
                      -
                    </button>
                    <div class="storefront__stepper-value">{{ item.qty }}</div>
                    <button
                      type="button"
                      class="storefront__stepper-btn storefront__stepper-btn--primary"
                      :disabled="item.qty >= Number(item.available || 0)"
                      @click="incrementProduct(item)"
                    >
                      +
                    </button>
                  </div>
                  <button type="button" class="storefront__remove-btn" @click="removeFromCart(item.variant_id)">
                    Quitar
                  </button>
                </div>
              </v-card-text>
            </v-card>
          </div>

          <v-card v-if="cart.length > 0" class="mt-6 storefront__summary-card" variant="tonal">
            <v-card-text class="storefront__summary-card-body">
              <div>
                <div class="storefront__price-label">Total del carrito</div>
                <div class="storefront__summary-total">{{ formatMoney(cartTotal) }}</div>
              </div>
              <v-btn color="primary" variant="flat" size="large" @click="goToSection('checkout')">
                Continuar al checkout
              </v-btn>
            </v-card-text>
          </v-card>
        </section>

        <section v-if="currentSection === 'checkout'" class="mt-8">
          <div class="storefront__section-head">
            <div>
              <div class="storefront__section-title">Checkout</div>
              <div class="storefront__section-copy">
                Elige cómo quieres pagar y termina tu compra sin salir del flujo de la tienda.
              </div>
            </div>
            <div class="storefront__section-actions">
              <v-btn variant="outlined" @click="goToSection('cart')">
                Volver al carrito
              </v-btn>
            </div>
          </div>

          <v-alert v-if="cart.length === 0" type="warning" variant="tonal" class="mb-4">
            Agrega productos antes de continuar al checkout.
          </v-alert>

          <v-row v-else>
            <v-col cols="12" md="7">
              <div class="storefront__payment-rail mb-4">
                <div>
                  <div class="storefront__payment-rail-label">Primero elige cómo pagar</div>
                  <div class="storefront__payment-rail-copy">
                    Ajustamos los campos del checkout según tu método.
                  </div>
                </div>
                <div class="storefront__payment-rail-actions">
                  <button
                    v-if="manualPaymentEnabled"
                    type="button"
                    class="storefront__payment-pill"
                    :class="{ 'storefront__payment-pill--active': checkoutForm.payment_mode === 'MANUAL' }"
                    @click="checkoutForm.payment_mode = 'MANUAL'"
                  >
                    Manual
                  </button>
                  <button
                    v-if="gatewayPaymentVisible"
                    type="button"
                    class="storefront__payment-pill"
                    :class="{
                      'storefront__payment-pill--active': checkoutForm.payment_mode === 'GATEWAY',
                      'storefront__payment-pill--disabled': !gatewayPaymentEnabled,
                    }"
                    :disabled="!gatewayPaymentEnabled"
                    @click="gatewayPaymentEnabled ? checkoutForm.payment_mode = 'GATEWAY' : null"
                  >
                    Mercado Pago
                  </button>
                </div>
              </div>

              <v-card variant="outlined" class="storefront__checkout-card">
                <v-card-text>
                  <div class="mb-4">
                    <div class="text-subtitle-2 mb-2">Método de pago</div>
                    <div class="storefront__payment-modes">
                      <button
                        v-if="manualPaymentEnabled"
                        type="button"
                        class="storefront__payment-mode"
                        :class="{ 'storefront__payment-mode--active': checkoutForm.payment_mode === 'MANUAL' }"
                        @click="checkoutForm.payment_mode = 'MANUAL'"
                      >
                        <strong>Pago manual</strong>
                        <span>Transferencia, consignación o soporte manual.</span>
                      </button>
                      <button
                        v-if="gatewayPaymentVisible"
                        type="button"
                        class="storefront__payment-mode"
                        :class="{
                          'storefront__payment-mode--active': checkoutForm.payment_mode === 'GATEWAY',
                          'storefront__payment-mode--disabled': !gatewayPaymentEnabled,
                        }"
                        :disabled="!gatewayPaymentEnabled"
                        @click="gatewayPaymentEnabled ? checkoutForm.payment_mode = 'GATEWAY' : null"
                      >
                        <strong>Mercado Pago</strong>
                        <span>{{ gatewayPaymentEnabled ? 'Tarjeta, PSE y medios compatibles en Checkout Pro.' : 'Próximamente' }}</span>
                      </button>
                    </div>
                  </div>

                  <v-text-field
                    v-model="checkoutForm.customer_name"
                    label="Nombre del cliente *"
                    variant="outlined"
                    class="mb-3"
                  />
                  <v-text-field
                    v-model="checkoutForm.customer_phone"
                    label="Teléfono / WhatsApp *"
                    variant="outlined"
                    class="mb-3"
                  />
                  <v-text-field
                    v-model="checkoutForm.customer_email"
                    label="Email para confirmación"
                    variant="outlined"
                    class="mb-3"
                    hint="Te enviaremos el estado de la compra a este correo si lo escribes."
                    persistent-hint
                  />
                  <v-text-field
                    v-if="checkoutForm.payment_mode === 'MANUAL'"
                    v-model="checkoutForm.payment_reference"
                    label="Referencia del pago manual"
                    variant="outlined"
                    class="mb-3"
                    hint="Ej: número de transferencia, comprobante o referencia interna."
                    persistent-hint
                  />
                  <v-alert
                    v-else-if="checkoutForm.payment_mode === 'GATEWAY'"
                    type="info"
                    variant="tonal"
                    class="mb-3"
                  >
                    Te vamos a redirigir a Mercado Pago para terminar el cobro. Allí verás los medios disponibles para esta tienda.
                  </v-alert>
                  <div v-if="checkoutForm.payment_mode === 'MANUAL'" class="mb-3">
                    <div class="text-subtitle-2 mb-2">Comprobante de pago</div>
                    <div class="text-body-2 text-medium-emphasis mb-2">
                      Puedes adjuntar una imagen o PDF del soporte para acelerar la validación.
                    </div>
                    <div class="d-flex flex-wrap ga-2 align-center">
                      <v-btn
                        variant="tonal"
                        color="primary"
                        :loading="uploadingProof"
                        @click="paymentProofInput?.click()"
                      >
                        {{ checkoutForm.payment_proof_url ? 'Cambiar comprobante' : 'Adjuntar comprobante' }}
                      </v-btn>
                      <v-chip v-if="paymentProofFileName" size="small" variant="tonal">
                        {{ paymentProofFileName }}
                      </v-chip>
                      <a
                        v-if="checkoutForm.payment_proof_url"
                        :href="checkoutForm.payment_proof_url"
                        target="_blank"
                        rel="noreferrer"
                        class="storefront__proof-link"
                      >
                        Ver archivo
                      </a>
                    </div>
                  </div>
                  <v-textarea
                    v-model="checkoutForm.delivery_address"
                    label="Dirección de entrega"
                    variant="outlined"
                    rows="2"
                    class="mb-3"
                    hint="Si aplica, escribe la dirección donde debes recibir el pedido."
                    persistent-hint
                  />
                  <v-textarea
                    v-model="checkoutForm.customer_note"
                    label="Nota del cliente"
                    variant="outlined"
                    rows="3"
                  />
                </v-card-text>
              </v-card>
            </v-col>

            <v-col cols="12" md="5">
              <v-card variant="tonal" class="storefront__checkout-summary">
                <v-card-text>
                  <div class="storefront__section-title storefront__section-title--small">Resumen</div>
                  <div class="storefront__checkout-list">
                    <div v-for="item in cart" :key="item.variant_id" class="storefront__checkout-item">
                      <span>{{ item.qty }} x {{ item.display_name }}</span>
                      <strong>{{ formatMoney(item.final_price * item.qty) }}</strong>
                    </div>
                  </div>
                  <v-divider class="my-4" />
                  <div class="storefront__checkout-total">
                    <span>Total</span>
                    <strong>{{ formatMoney(cartTotal) }}</strong>
                  </div>

                  <div v-if="store?.checkout_message" class="storefront__checkout-copy">
                    {{ store.checkout_message }}
                  </div>

                  <div class="storefront__checkout-assurance">
                    <span>{{ checkoutAssurance.primary }}</span>
                    <strong>{{ checkoutAssurance.secondary }}</strong>
                  </div>

                  <v-btn
                    class="mt-5"
                    block
                    color="primary"
                    size="large"
                    :loading="submitting"
                    :disabled="cart.length === 0"
                    @click="submitCheckout"
                  >
                    {{ checkoutSubmitLabel }}
                  </v-btn>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </section>

        <aside v-if="currentSection === 'catalog' && cart.length > 0" class="storefront__floating-cart">
          <div>
            <div class="storefront__floating-label">Carrito activo</div>
            <div class="storefront__floating-total">{{ formatMoney(cartTotal) }}</div>
          </div>
          <v-btn color="primary" variant="flat" @click="goToSection('cart')">
            Abrir
          </v-btn>
        </aside>

        <a
          v-if="whatsappPhone"
          class="storefront__whatsapp-fab"
          :class="{ 'storefront__whatsapp-fab--with-cart': currentSection === 'catalog' && cart.length > 0 }"
          :href="storeWhatsappUrl"
          target="_blank"
          rel="noreferrer"
        >
          <v-icon size="20">mdi-whatsapp</v-icon>
          <span>Preguntar</span>
        </a>
      </template>
      <input
        ref="paymentProofInput"
        class="d-none"
        type="file"
        accept="image/*,.pdf,application/pdf"
        @change="handlePaymentProofSelected"
      >
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import onlineStoreService from '@/services/onlineStore.service'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const store = ref(null)
const products = ref([])
const successOrder = ref(null)
const searchTerm = ref('')
const selectedCategory = ref('ALL')
const sortMode = ref('featured')
const onlyInStock = ref(false)
const cartState = ref([])
const uploadingProof = ref(false)
const paymentProofInput = ref(null)
const paymentProofFileName = ref('')

const cartStorageKey = computed(() => `ofirone:storefront:cart:${route.params.slug || 'store'}`)

const checkoutForm = ref({
  customer_name: '',
  customer_phone: '',
  customer_email: '',
  payment_mode: 'MANUAL',
  payment_reference: '',
  payment_proof_url: '',
  customer_note: '',
  delivery_address: '',
})

const themeStyles = computed(() => ({
  '--store-primary': store.value?.primary_color || '#1e63b7',
  '--store-secondary': store.value?.secondary_color || '#4ca53c',
  '--store-accent': store.value?.accent_color || '#f59e0b',
  '--store-background': store.value?.background_color || '#f4f1ea',
  '--store-surface': store.value?.surface_color || '#fffdf8',
  '--store-text': store.value?.text_color || '#111827',
}))

const currentSection = computed(() => {
  if (route.name === 'PublicStoreCart') return 'cart'
  if (route.name === 'PublicStoreCheckout') return 'checkout'
  return 'catalog'
})

const normalizedSearch = computed(() => String(searchTerm.value || '').trim().toLowerCase())

const sortOptions = [
  { title: 'Recomendados', value: 'featured' },
  { title: 'Nombre A-Z', value: 'name_asc' },
  { title: 'Menor precio', value: 'price_asc' },
  { title: 'Mayor precio', value: 'price_desc' },
  { title: 'Más stock', value: 'stock_desc' },
]

const categoryOptions = computed(() => {
  return [...new Set(
    products.value
      .map((item) => String(item.category_name || '').trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b))
})

const filteredProducts = computed(() => {
  const filtered = products.value.filter((product) => {
    const matchesCategory = selectedCategory.value === 'ALL'
      || String(product.category_name || '').trim() === selectedCategory.value

    const haystack = [
      product.display_name,
      product.product_name,
      product.variant_name,
      product.sku,
      product.category_name,
      product.display_description,
    ].join(' ').toLowerCase()

    const matchesSearch = !normalizedSearch.value || haystack.includes(normalizedSearch.value)
    const matchesStock = !onlyInStock.value || Number(product.available || 0) > 0
    return matchesCategory && matchesSearch && matchesStock
  })

  return [...filtered].sort((a, b) => {
    if (sortMode.value === 'name_asc') {
      return String(a.display_name || '').localeCompare(String(b.display_name || ''))
    }
    if (sortMode.value === 'price_asc') {
      return Number(a.final_price || 0) - Number(b.final_price || 0)
    }
    if (sortMode.value === 'price_desc') {
      return Number(b.final_price || 0) - Number(a.final_price || 0)
    }
    if (sortMode.value === 'stock_desc') {
      return Number(b.available || 0) - Number(a.available || 0)
    }
    return 0
  })
})

const inStockCount = computed(() => products.value.filter((item) => Number(item.available || 0) > 0).length)

const effectiveReturnUrl = computed(() => {
  const explicit = String(route.query.return_url || '').trim()
  const candidate = explicit || String(store.value?.landing_return_url || '').trim()
  if (!candidate) return ''
  try {
    const url = new URL(candidate, window.location.origin)
    if (!/^https?:$/.test(url.protocol)) return ''
    return url.toString()
  } catch (_error) {
    return ''
  }
})

const cart = computed(() => {
  const currentProducts = new Map(products.value.map((item) => [item.variant_id, item]))
  return cartState.value
    .map((item) => {
      const product = currentProducts.get(item.variant_id)
      if (!product) return null
      const maxQty = Number(product.available || 0)
      const qty = Math.max(0, Math.min(Number(item.qty || 0), maxQty))
      if (qty <= 0) return null
      return { ...product, qty }
    })
    .filter(Boolean)
})

const cartItemsCount = computed(() => cart.value.reduce((sum, item) => sum + Number(item.qty || 0), 0))
const cartTotal = computed(() => cart.value.reduce((sum, item) => sum + (Number(item.final_price || 0) * Number(item.qty || 0)), 0))
const manualPaymentEnabled = computed(() => store.value?.allow_manual_payment !== false)
const gatewayPaymentVisible = computed(() => store.value?.allow_gateway_payment === true || store.value?.gateway_status === 'ENABLED')
const gatewayPaymentEnabled = computed(() => store.value?.allow_gateway_payment === true && store.value?.gateway_status === 'ENABLED')
const checkoutSubmitLabel = computed(() => checkoutForm.value.payment_mode === 'GATEWAY' ? 'Pagar con Mercado Pago' : 'Confirmar compra')
const checkoutAssurance = computed(() => {
  if (checkoutForm.value.payment_mode === 'GATEWAY') {
    return {
      primary: 'Pago protegido por Mercado Pago',
      secondary: 'La tienda confirma el pedido cuando la pasarela apruebe el cobro.',
    }
  }

  return {
    primary: 'Pedido sujeto a validación manual',
    secondary: 'Reservamos el stock mientras el comercio revisa tu soporte.',
  }
})

const whatsappPhone = computed(() => normalizeWhatsappPhone(store.value?.support_whatsapp))
const storeWhatsappUrl = computed(() => {
  const storeName = store.value?.brand_name || 'la tienda'
  const message = `Hola, quiero consultar por la tienda online ${storeName}.`
  return buildWhatsappUrl(message)
})
const checkoutHeroLabel = computed(() => {
  if (manualPaymentEnabled.value && gatewayPaymentEnabled.value) return 'Manual o pasarela'
  if (gatewayPaymentEnabled.value) return 'Pasarela Mercado Pago'
  if (manualPaymentEnabled.value) return 'Pago manual con validación'
  return 'Checkout online'
})
const successOrderMessage = computed(() => {
  if (manualPaymentEnabled.value && !gatewayPaymentEnabled.value) {
    return 'Reservamos el stock mientras el comercio valida tu pago manual.'
  }
  return 'Reservamos tu stock y dejaremos el pedido listo mientras el pago termina de confirmarse.'
})

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

function buildProductWhatsappUrl(product) {
  const parts = [
    `Hola, quiero consultar por este producto: ${product.display_name || product.product_name || 'Producto'}.`,
    product.variant_name ? `Variante: ${product.variant_name}.` : '',
    product.sku ? `SKU: ${product.sku}.` : '',
    `Precio: ${formatMoney(product.final_price)}.`,
  ].filter(Boolean)
  return buildWhatsappUrl(parts.join(' '))
}

function getFriendlyCheckoutError(error) {
  const raw = String(error || '').trim()
  const normalized = raw.toLowerCase()

  if (!raw) {
    return 'No pudimos registrar la compra. Intenta de nuevo en unos segundos.'
  }

  if (normalized.includes('stock online insuficiente')) {
    return 'Algunos productos ya no tienen la cantidad disponible que viste en pantalla. Revisa el carrito y vuelve a intentarlo.'
  }

  if (normalized.includes('stock insuficiente para variante') || normalized.includes('stock insuficiente para')) {
    return 'No hay suficiente inventario para completar la compra en este momento.'
  }

  if (normalized.includes('no está publicada en la tienda')) {
    return 'Uno de los productos ya no está disponible en esta tienda online.'
  }

  if (normalized.includes('no está lista para vender')) {
    return 'La tienda todavía no está lista para recibir pedidos. Intenta de nuevo más tarde o contacta al negocio.'
  }

  if (normalized.includes('cash session')) {
    return 'La compra no pudo registrarse por una validación operativa interna. Intenta de nuevo en unos minutos.'
  }

  if (normalized.includes('pendiente de confirmación') || normalized.includes('stock_reserved')) {
    return 'Tu pedido ya quedó recibido. Si no ves el mensaje final, actualiza la página y verifica con el comercio.'
  }

  if (
    normalized.includes('payment method not found') ||
    normalized.includes('método de pago') ||
    normalized.includes('metodo de pago')
  ) {
    return 'La tienda no tiene un método de pago online correctamente configurado todavía.'
  }

  if (
    normalized.includes('credenciales activas de mercado pago') ||
    normalized.includes('credenciales de mercado pago')
  ) {
    return 'Esta tienda todavía no tiene Mercado Pago configurado para cobrar. Pídele al negocio que revise Tienda online > Credenciales Mercado Pago.'
  }

  if (normalized.includes('variant not found') || normalized.includes('ya no está disponible para venta')) {
    return 'Uno de los productos cambió o dejó de estar disponible. Actualiza la tienda y vuelve a intentarlo.'
  }

  return raw
}

function fallbackMediaStyle(product) {
  const base = product?.category_name || product?.display_name || 'Producto'
  const hueSeed = [...String(base)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360
  const secondaryHue = (hueSeed + 42) % 360
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${hueSeed} 58% 52%) 0%, hsl(${secondaryHue} 64% 38%) 100%)`,
  }
}

function saveCart(nextCart) {
  const sanitized = (Array.isArray(nextCart) ? nextCart : [])
    .map((item) => ({
      variant_id: item.variant_id,
      qty: Number(item.qty || 0),
    }))
    .filter((item) => item.variant_id && item.qty > 0)

  cartState.value = sanitized
  localStorage.setItem(cartStorageKey.value, JSON.stringify(sanitized))
}

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(cartStorageKey.value)
    if (!raw) {
      cartState.value = []
      return
    }

    const parsed = JSON.parse(raw)
    cartState.value = Array.isArray(parsed)
      ? parsed
          .map((item) => ({
            variant_id: item?.variant_id,
            qty: Number(item?.qty || 0),
          }))
          .filter((item) => item.variant_id && item.qty > 0)
      : []
  } catch (_error) {
    cartState.value = []
  }
}

function getCartQuantity(variantId) {
  return cart.value.find((item) => item.variant_id === variantId)?.qty || 0
}

function incrementProduct(product) {
  const current = cart.value.map((item) => ({ variant_id: item.variant_id, qty: item.qty }))
  const existing = current.find((item) => item.variant_id === product.variant_id)
  if (existing) {
    existing.qty = Math.min(existing.qty + 1, Number(product.available || 0))
  } else {
    current.push({ variant_id: product.variant_id, qty: 1 })
  }
  saveCart(current.filter((item) => item.qty > 0))
}

function decrementProduct(variantId) {
  const current = cart.value
    .map((item) => ({ variant_id: item.variant_id, qty: item.qty }))
    .map((item) => item.variant_id === variantId ? { ...item, qty: Math.max(0, item.qty - 1) } : item)
    .filter((item) => item.qty > 0)
  saveCart(current)
}

function removeFromCart(variantId) {
  saveCart(cart.value.filter((item) => item.variant_id !== variantId).map((item) => ({
    variant_id: item.variant_id,
    qty: item.qty,
  })))
}

function goToSection(section) {
  const slug = route.params.slug
  if (section === 'cart') {
    router.push({ name: 'PublicStoreCart', params: { slug }, query: route.query })
    return
  }
  if (section === 'checkout') {
    router.push({ name: 'PublicStoreCheckout', params: { slug }, query: route.query })
    return
  }
  router.push({ name: 'PublicStoreCatalog', params: { slug }, query: route.query })
}

async function loadStorefront() {
  const slug = String(route.params.slug || '').trim()
  if (!slug) return

  loading.value = true
  errorMessage.value = ''

  try {
    const [storeRes, productsRes] = await Promise.all([
      onlineStoreService.getPublicStore(slug),
      onlineStoreService.getPublicCatalog(slug),
    ])

    if (!storeRes.success || !storeRes.data) {
      throw new Error(storeRes.error || 'La tienda no está disponible.')
    }
    if (!productsRes.success) {
      throw new Error(productsRes.error || 'No se pudo cargar el catálogo.')
    }

    store.value = storeRes.data
    products.value = productsRes.data || []
    if (checkoutForm.value.payment_mode === 'GATEWAY' && !gatewayPaymentEnabled.value) {
      checkoutForm.value.payment_mode = manualPaymentEnabled.value ? 'MANUAL' : 'GATEWAY'
    }
    if (checkoutForm.value.payment_mode === 'MANUAL' && !manualPaymentEnabled.value && gatewayPaymentEnabled.value) {
      checkoutForm.value.payment_mode = 'GATEWAY'
    }
    saveCart(cartState.value)
  } catch (error) {
    errorMessage.value = error.message || 'No se pudo cargar la tienda.'
  } finally {
    loading.value = false
  }
}

async function submitCheckout() {
  if (!checkoutForm.value.customer_name.trim()) {
    errorMessage.value = 'Escribe el nombre del cliente para continuar.'
    return
  }
  if (!checkoutForm.value.customer_phone.trim()) {
    errorMessage.value = 'Escribe un teléfono o WhatsApp para continuar.'
    return
  }
  if (cart.value.length === 0) {
    errorMessage.value = 'El carrito está vacío.'
    return
  }

  submitting.value = true
  errorMessage.value = ''

  try {
    const payload = {
      ...checkoutForm.value,
      landing_return_url: effectiveReturnUrl.value || store.value?.landing_return_url || null,
      lines: cart.value.map((item) => ({
        variant_id: item.variant_id,
        qty: item.qty,
      })),
    }

    if (checkoutForm.value.payment_mode === 'GATEWAY') {
      if (!gatewayPaymentEnabled.value) {
        throw new Error('La pasarela todavía no está disponible en esta tienda.')
      }

      const result = await onlineStoreService.createGatewayPreference(String(route.params.slug || ''), {
        ...payload,
        origin: window.location.origin,
      })
      if (!result.success) throw new Error(result.error || 'No se pudo iniciar el checkout con Mercado Pago.')

      saveCart([])
      paymentProofFileName.value = ''
      checkoutForm.value.payment_reference = ''
      checkoutForm.value.payment_proof_url = ''
      checkoutForm.value.customer_note = ''
      checkoutForm.value.delivery_address = ''

      const paymentUrl = String(result.data?.preference?.payment_url || '').trim()
      if (!paymentUrl) {
        throw new Error('Mercado Pago no devolvió una URL de pago válida.')
      }

      window.location.href = paymentUrl
      return
    }

    const result = await onlineStoreService.createManualOrder(String(route.params.slug || ''), payload)
    if (!result.success) throw new Error(result.error || 'No se pudo registrar la compra.')

    successOrder.value = result.data
    saveCart([])
    paymentProofFileName.value = ''
    checkoutForm.value.payment_reference = ''
    checkoutForm.value.payment_proof_url = ''
    checkoutForm.value.customer_note = ''
    checkoutForm.value.delivery_address = ''
    await loadStorefront()
    goToSection('catalog')
  } catch (error) {
    errorMessage.value = getFriendlyCheckoutError(error?.message || error)
  } finally {
    submitting.value = false
  }
}

async function handlePaymentProofSelected(event) {
  const file = event?.target?.files?.[0]
  event.target.value = ''
  if (!file) return

  uploadingProof.value = true
  errorMessage.value = ''
  try {
    const result = await onlineStoreService.uploadPaymentProof(String(route.params.slug || ''), file)
    if (!result.success) throw new Error(result.error || 'No se pudo subir el comprobante.')
    checkoutForm.value.payment_proof_url = result.data.public_url
    paymentProofFileName.value = file.name
  } catch (error) {
    errorMessage.value = String(error?.message || error || 'No se pudo subir el comprobante.')
  } finally {
    uploadingProof.value = false
  }
}

watch(categoryOptions, (options) => {
  if (selectedCategory.value !== 'ALL' && !options.includes(selectedCategory.value)) {
    selectedCategory.value = 'ALL'
  }
})

watch(() => checkoutForm.value.payment_mode, (mode) => {
  if (mode !== 'MANUAL') {
    checkoutForm.value.payment_reference = ''
    checkoutForm.value.payment_proof_url = ''
    paymentProofFileName.value = ''
  }
})

watch(() => route.params.slug, () => {
  successOrder.value = null
  searchTerm.value = ''
  selectedCategory.value = 'ALL'
  loadCartFromStorage()
  loadStorefront()
}, { immediate: true })
</script>

<style scoped>
.storefront {
  min-height: 100vh;
  color: var(--store-text);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--store-primary) 16%, white) 0%, transparent 30%),
    radial-gradient(circle at 85% 12%, color-mix(in srgb, var(--store-secondary) 18%, white) 0%, transparent 22%),
    linear-gradient(180deg, color-mix(in srgb, var(--store-background) 84%, white) 0%, var(--store-background) 100%);
}

.storefront__shell {
  width: min(90vw, 1600px);
  margin: 0 auto;
  padding: 28px 18px 96px;
}

@media (max-width: 900px) {
  .storefront__shell {
    width: 100%;
  }
}

.storefront__hero {
  position: relative;
  min-height: 390px;
  overflow: hidden;
  border-radius: 34px;
  background: #0f172a;
  box-shadow: 0 36px 90px rgb(15 23 42 / 0.18);
  isolation: isolate;
}

.storefront__hero-media {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  z-index: 0;
}

.storefront__hero-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(110deg, rgb(8 15 30 / 0.92) 0%, rgb(8 15 30 / 0.84) 38%, rgb(8 15 30 / 0.24) 76%, rgb(8 15 30 / 0.10) 100%),
    radial-gradient(circle at top left, color-mix(in srgb, var(--store-primary) 38%, transparent) 0%, transparent 42%);
}

.storefront__hero-content {
  position: relative;
  z-index: 1;
  min-height: 390px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: white;
}

.storefront__hero-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.storefront__brand-wrap {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.storefront__logo-frame {
  width: 86px;
  height: 86px;
  border-radius: 24px;
  background: rgb(255 255 255 / 0.96);
  padding: 10px;
  box-shadow: 0 18px 40px rgb(15 23 42 / 0.28);
}

.storefront__brand-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.storefront__eyebrow {
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-size: 0.78rem;
  font-weight: 700;
  opacity: 0.86;
}

.storefront__title {
  margin: 10px 0 8px;
  font-size: clamp(2.8rem, 5vw, 4.6rem);
  line-height: 0.94;
  letter-spacing: -0.04em;
  font-weight: 900;
}

.storefront__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  opacity: 0.86;
  align-items: center;
}

.storefront__meta span {
  position: relative;
  padding-right: 14px;
  white-space: nowrap;
}

.storefront__meta span:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 50%;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.7);
  transform: translateY(-50%);
}

.storefront__hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.storefront__hero-btn {
  backdrop-filter: blur(8px);
}

.storefront__hero-body {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  align-items: flex-end;
}

.storefront__hero-text {
  max-width: 620px;
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.65;
  color: rgb(255 255 255 / 0.88);
}

.storefront__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 10px;
  min-width: min(100%, 420px);
}

.storefront__stat {
  padding: 14px 16px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 20px;
  background: rgb(255 255 255 / 0.08);
  backdrop-filter: blur(8px);
}

.storefront__stat strong {
  display: block;
  margin-top: 8px;
  font-size: 1rem;
}

.storefront__stat-label {
  display: block;
  font-size: 0.77rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.76;
}

.storefront__toolbar {
  margin-top: 28px;
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.storefront__toolbar-title {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.storefront__toolbar-subtitle {
  margin-top: 4px;
  color: color-mix(in srgb, var(--store-text) 62%, white);
}

.storefront__toolbar-right {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.storefront__search {
  min-width: 320px;
}

.storefront__sort {
  min-width: 190px;
}

.storefront__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.storefront__filter-chip {
  border: 1px solid color-mix(in srgb, var(--store-text) 14%, white);
  border-radius: 999px;
  background: color-mix(in srgb, var(--store-surface) 84%, white);
  color: var(--store-text);
  padding: 10px 16px;
  font-weight: 700;
  transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
}

.storefront__filter-chip:hover {
  transform: translateY(-1px);
}

.storefront__filter-chip--active {
  background: color-mix(in srgb, var(--store-primary) 16%, white);
  border-color: color-mix(in srgb, var(--store-primary) 42%, white);
}

.storefront__filter-chip--utility {
  border-style: dashed;
}

.storefront__section-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 22px;
}

.storefront__section-title {
  font-size: 2rem;
  line-height: 1;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.storefront__section-title--small {
  font-size: 1.3rem;
}

.storefront__section-copy {
  margin-top: 8px;
  color: color-mix(in srgb, var(--store-text) 60%, white);
}

.storefront__section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.storefront__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
}

.storefront__card {
  border-radius: 28px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--store-surface) 90%, white) 0%, color-mix(in srgb, var(--store-background) 68%, white) 100%);
  box-shadow: 0 14px 30px rgb(15 23 42 / 0.06);
  overflow: hidden;
}

.storefront__card-media {
  position: relative;
  height: 220px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.storefront__card-media--placeholder {
  display: flex;
  align-items: flex-end;
}

.storefront__card-media-overlay {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgb(15 23 42 / 0.06) 0%, rgb(15 23 42 / 0.12) 44%, rgb(15 23 42 / 0.64) 100%);
}

.storefront__card-media-copy {
  position: relative;
  z-index: 1;
  padding: 18px;
  color: white;
  display: grid;
  gap: 6px;
}

.storefront__card-media-copy strong {
  font-size: 1.15rem;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

.storefront__card-media-kicker {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  opacity: 0.78;
}

.storefront__card-body {
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.storefront__card-topline {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.storefront__sku {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: color-mix(in srgb, var(--store-text) 45%, white);
}

.storefront__category-pill {
  padding: 7px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--store-secondary) 14%, white);
  color: color-mix(in srgb, var(--store-secondary) 84%, black);
  font-size: 0.77rem;
  font-weight: 800;
}

.storefront__card-title {
  margin-top: 18px;
  font-size: 1.75rem;
  line-height: 1.02;
  letter-spacing: -0.05em;
  font-weight: 900;
}

.storefront__card-variant {
  margin-top: 10px;
  font-weight: 700;
  color: color-mix(in srgb, var(--store-text) 58%, white);
}

.storefront__card-description {
  margin-top: 14px;
  color: color-mix(in srgb, var(--store-text) 68%, white);
  line-height: 1.55;
}

.storefront__card-footer {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.storefront__price-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.storefront__price-label {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: color-mix(in srgb, var(--store-text) 46%, white);
}

.storefront__price-value {
  font-size: 1.9rem;
  line-height: 1;
  font-weight: 900;
  letter-spacing: -0.05em;
}

.storefront__availability {
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 800;
}

.storefront__availability--ok {
  background: color-mix(in srgb, var(--store-secondary) 14%, white);
  color: color-mix(in srgb, var(--store-secondary) 82%, black);
}

.storefront__availability--empty {
  background: color-mix(in srgb, #dc2626 16%, white);
  color: #b91c1c;
}

.storefront__stepper {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 22px;
}

.storefront__stepper-btn {
  width: 48px;
  height: 48px;
  border-radius: 18px;
  border: none;
  font-size: 1.8rem;
  line-height: 1;
  font-weight: 500;
  transition: transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
}

.storefront__stepper-btn:disabled {
  opacity: 0.45;
}

.storefront__stepper-btn:not(:disabled):hover {
  transform: translateY(-1px);
}

.storefront__stepper-btn--muted {
  background: color-mix(in srgb, var(--store-text) 8%, white);
  color: color-mix(in srgb, var(--store-text) 72%, white);
}

.storefront__stepper-btn--primary {
  background: linear-gradient(135deg, var(--store-primary) 0%, color-mix(in srgb, var(--store-primary) 60%, var(--store-secondary)) 100%);
  color: white;
  box-shadow: 0 14px 24px color-mix(in srgb, var(--store-primary) 26%, transparent);
}

.storefront__stepper-value {
  min-width: 52px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: color-mix(in srgb, var(--store-text) 7%, white);
  font-weight: 900;
}

.storefront__list {
  display: grid;
  gap: 14px;
}

.storefront__list-card {
  border-radius: 24px;
}

.storefront__list-card-body {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
}

.storefront__list-title {
  font-size: 1.28rem;
  font-weight: 800;
}

.storefront__list-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: color-mix(in srgb, var(--store-text) 58%, white);
}

.storefront__list-price {
  margin-top: 10px;
}

.storefront__list-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.storefront__remove-btn {
  border: none;
  background: transparent;
  color: #b91c1c;
  font-weight: 800;
}

.storefront__summary-card,
.storefront__checkout-card,
.storefront__checkout-summary {
  border-radius: 26px;
}

.storefront__payment-rail {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--store-primary) 18%, white);
  border-radius: 24px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--store-primary) 12%, white) 0%, color-mix(in srgb, var(--store-surface) 90%, white) 100%);
  box-shadow: 0 18px 34px rgb(15 23 42 / 0.06);
}

.storefront__payment-rail-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 900;
  color: color-mix(in srgb, var(--store-primary) 78%, black);
}

.storefront__payment-rail-copy {
  margin-top: 4px;
  color: color-mix(in srgb, var(--store-text) 62%, white);
}

.storefront__payment-rail-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.storefront__payment-pill {
  border: 1px solid color-mix(in srgb, var(--store-text) 14%, white);
  border-radius: 999px;
  background: white;
  color: var(--store-text);
  padding: 10px 16px;
  font-weight: 900;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.storefront__payment-pill:not(:disabled):hover {
  transform: translateY(-1px);
}

.storefront__payment-pill--active {
  color: white;
  border-color: var(--store-primary);
  background: linear-gradient(135deg, var(--store-primary), color-mix(in srgb, var(--store-primary) 60%, var(--store-secondary)));
  box-shadow: 0 14px 24px color-mix(in srgb, var(--store-primary) 22%, transparent);
}

.storefront__payment-pill--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.storefront__summary-card-body {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
}

.storefront__summary-total {
  margin-top: 6px;
  font-size: 2.2rem;
  line-height: 1;
  font-weight: 900;
  letter-spacing: -0.05em;
}

.storefront__checkout-list {
  display: grid;
  gap: 12px;
}

.storefront__checkout-item,
.storefront__checkout-total {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.storefront__checkout-total strong {
  font-size: 1.4rem;
}

.storefront__checkout-copy {
  margin-top: 16px;
  color: color-mix(in srgb, var(--store-text) 62%, white);
  line-height: 1.55;
}

.storefront__checkout-assurance {
  margin-top: 16px;
  padding: 14px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--store-secondary) 12%, white);
  color: color-mix(in srgb, var(--store-text) 78%, white);
  display: grid;
  gap: 4px;
}

.storefront__checkout-assurance span {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 900;
  color: color-mix(in srgb, var(--store-secondary) 80%, black);
}

.storefront__checkout-assurance strong {
  font-size: 0.95rem;
}

.storefront__payment-modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.storefront__payment-mode {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--store-primary) 18%, transparent);
  background: white;
  color: var(--store-text);
  text-align: left;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.storefront__payment-mode--active {
  border-color: var(--store-primary);
  box-shadow: 0 16px 36px color-mix(in srgb, var(--store-primary) 16%, transparent);
}

.storefront__payment-mode--disabled {
  opacity: 0.58;
  cursor: not-allowed;
  background: color-mix(in srgb, var(--store-surface) 86%, white);
}

.storefront__proof-link {
  color: var(--store-primary);
  font-weight: 600;
  text-decoration: none;
}

.storefront__proof-link:hover {
  text-decoration: underline;
}

.storefront__product-whatsapp {
  display: inline-flex;
  margin-top: 14px;
  color: #047857;
  font-weight: 800;
  text-decoration: none;
}

.storefront__product-whatsapp:hover {
  text-decoration: underline;
}

.storefront__floating-cart {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 20;
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 16px 18px;
  border-radius: 22px;
  background: rgb(15 23 42 / 0.92);
  color: white;
  box-shadow: 0 24px 50px rgb(15 23 42 / 0.28);
  backdrop-filter: blur(12px);
}

.storefront__floating-label {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.76;
}

.storefront__floating-total {
  margin-top: 4px;
  font-size: 1.25rem;
  font-weight: 900;
}

.storefront__whatsapp-fab {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 21;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 16px;
  border-radius: 999px;
  background: #16a34a;
  color: white;
  font-weight: 900;
  text-decoration: none;
  box-shadow: 0 18px 38px rgb(22 163 74 / 0.3);
}

.storefront__whatsapp-fab--with-cart {
  bottom: 104px;
}

@media (max-width: 900px) {
  .storefront__stats {
    grid-template-columns: 1fr;
    min-width: 100%;
  }
}

@media (max-width: 720px) {
  .storefront__shell {
    padding: 14px 12px 96px;
  }

  .storefront__hero {
    min-height: 330px;
    border-radius: 26px;
  }

  .storefront__hero-content {
    min-height: 330px;
    padding: 18px;
  }

  .storefront__title {
    font-size: 2.5rem;
  }

  .storefront__search {
    min-width: 100%;
  }

  .storefront__sort {
    min-width: 100%;
  }

  .storefront__toolbar-right {
    width: 100%;
  }

  .storefront__grid {
    grid-template-columns: 1fr;
  }

  .storefront__payment-modes {
    grid-template-columns: 1fr;
  }

  .storefront__floating-cart {
    left: 12px;
    right: 12px;
    bottom: 12px;
    justify-content: space-between;
  }

  .storefront__whatsapp-fab {
    right: 14px;
    bottom: 14px;
  }

  .storefront__whatsapp-fab--with-cart {
    bottom: 92px;
  }
}
</style>
