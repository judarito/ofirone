<template>
  <div class="pos-container ofir-page ofir-pos">
    <!-- Barra Superior POS -->
    <v-card ref="headerCard" flat class="mb-2 pos-header-card">
      <v-card-title class="d-flex flex-column flex-sm-row align-start align-sm-center pa-2">
        <div class="d-flex align-center mb-2 mb-sm-0">
          <v-icon class="mr-2">mdi-point-of-sale</v-icon>
          <span class="text-h6 d-none d-sm-inline">Punto de Venta</span>
          <span class="text-subtitle-1 d-sm-none">POS</span>
        </div>
        <v-spacer class="d-none d-sm-flex"></v-spacer>
        <div class="pos-header-actions">
          <v-btn
            class="pos-header-actions__charge"
            color="primary"
            prepend-icon="mdi-check-circle"
            :loading="processing"
            :disabled="cart.length === 0 || remaining > 0 || sessionExpired"
            @click="processSale"
          >
            Cobrar {{ formatMoney(totals.total) }}
          </v-btn>
          <v-btn
            class="pos-header-actions__clear"
            variant="tonal"
            color="error"
            prepend-icon="mdi-trash-can"
            :disabled="cart.length === 0"
            @click="clearSale"
          >
            Limpiar
          </v-btn>
          <v-chip
            v-if="currentSession"
            class="pos-header-status"
            :color="sessionExpired ? 'error' : 'success'"
            size="small"
            :prepend-icon="sessionExpired ? 'mdi-clock-alert' : 'mdi-cash-register'"
          >
            <span class="d-none d-sm-inline">{{ currentSession.cash_register?.name || 'Caja' }}{{ sessionExpired ? ' (⚠️ '+sessionAgeHours+'h)' : '' }}</span>
            <span class="d-sm-none">{{ currentSession.cash_register?.name?.substring(0, 10) || 'Caja' }}{{ sessionExpired ? ' !' : '' }}</span>
          </v-chip>
          <v-chip v-else class="pos-header-status" color="warning" size="small" prepend-icon="mdi-alert">
            <span class="d-none d-sm-inline">Sin caja abierta</span>
            <span class="d-sm-none">Sin caja</span>
          </v-chip>
        </div>
      </v-card-title>
    </v-card>

    <ContextHelpCard
      class="mb-3"
      context-key="pos"
    />

    <v-row no-gutters align="start" class="pos-main-row">
      <!-- Panel Izquierdo: Búsqueda de productos -->
      <v-col cols="12" md="7" class="pr-md-2">
        <v-card class="pos-panel">
          <v-card-text class="pa-2">
            <!-- Búsqueda con autocompletado -->
            <v-autocomplete
              ref="searchInput"
              v-model="selectedVariant"
              v-model:search="searchTerm"
              :items="searchResults"
              :loading="searchingProduct"
              item-title="_displayName"
              item-value="variant_id"
              return-object
              label="Buscar producto (código de barras, SKU o nombre)"
              prepend-inner-icon="mdi-barcode-scan"
              variant="outlined"
              density="compact"
              hide-details
              no-filter
              clearable
              autofocus
              :no-data-text="searchTerm && searchTerm.length >= 2 ? 'No se encontraron productos' : 'Escribe para buscar...'"
              @update:search="debouncedSearch"
              @update:model-value="onVariantSelected"
              @keydown.enter.prevent="searchByBarcode"
            >
              <template #item="{ props, item }">
                <v-list-item v-bind="props" :subtitle="'SKU: ' + item.raw.sku + ' | Stock: ' + (item.raw._stock ?? '—') + ' | ' + formatMoney(item.raw.price)">
                  <template #prepend>
                    <v-icon color="primary" size="small">mdi-package-variant</v-icon>
                  </template>
                </v-list-item>
              </template>
            </v-autocomplete>

            <v-textarea
              v-model="chatOrderText"
              label="Pedido por chat (IA)"
              placeholder="Ej: Hola, para Ana: 2 cocas 350 ml y 1 arroz diana 500 g, entrega hoy"
              prepend-inner-icon="mdi-chat-processing-outline"
              variant="outlined"
              density="compact"
              rows="2"
              auto-grow
              class="mt-2"
              hide-details="auto"
            ></v-textarea>

            <v-btn
              class="mt-2"
              block
              color="secondary"
              prepend-icon="mdi-creation"
              :loading="processingChatOrder"
              :disabled="processingChatOrder || !chatOrderText.trim()"
              @click="parseChatOrderWithAgent"
            >
              Convertir chat a venta (IA)
            </v-btn>

            <v-alert
              v-if="chatOrderSummary"
              class="mt-2"
              :type="chatOrderSummary.matchedCount > 0 && chatOrderSummary.reviewCount === 0 && chatOrderSummary.unmatchedCount === 0 ? 'success' : 'warning'"
              variant="tonal"
              density="compact"
            >
              <div class="text-body-2">
                Cargados: <strong>{{ chatOrderSummary.matchedCount }}</strong>
                <span class="ml-2">Sin match: <strong>{{ chatOrderSummary.unmatchedCount }}</strong></span>
                <span class="ml-2">Revisar: <strong>{{ chatOrderSummary.reviewCount || 0 }}</strong></span>
                <span class="ml-2">Parser: <strong>{{ chatOrderSummary.parserLabel }}</strong></span>
                <span class="ml-2">Confianza: <strong>{{ chatOrderSummary.confidencePercent }}%</strong></span>
                <span v-if="chatOrderSummary.customerSuggestion" class="ml-2">
                  Cliente sugerido: <strong>{{ chatOrderSummary.customerSuggestion.full_name }}</strong>
                </span>
                <span v-if="chatOrderSummary.cacheHit" class="ml-2">
                  (cache)
                </span>
              </div>
              <div v-if="chatOrderSummary.reviewLines?.length" class="text-body-2 mt-2">
                <strong>Sugerencias para revisar:</strong>
                <div
                  v-for="(reviewLine, index) in chatOrderSummary.reviewLines"
                  :key="`review-line-${index}`"
                  class="mt-1"
                >
                  {{ reviewLine.rawName }}:
                  <strong>{{ reviewLine.candidates.join(' / ') }}</strong>
                </div>
              </div>
              <div v-if="chatOrderSummary.unmatchedLines?.length" class="text-body-2 mt-2">
                <strong>No identificados:</strong>
                {{ chatOrderSummary.unmatchedLines.join(' / ') }}
              </div>
            </v-alert>
          </v-card-text>

          <!-- Líneas del carrito -->
          <v-divider></v-divider>
          
          <div v-if="cart.length > 0" class="pa-2">
            <ListView
              class="pos-cart-list"
              title="Items de venta"
              icon="mdi-cart-outline"
              :items="paginatedCart"
              :total-items="cart.length"
              :page-size="CART_LIST_PAGE_SIZE"
              item-key="variant_id"
              title-field="productName"
              empty-message="No hay items en la venta."
              :searchable="false"
              :show-create-button="false"
              :editable="false"
              :deletable="false"
              @load-page="onCartListPage"
            >
              <template #title="{ item: line }">
                <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
                  <div class="d-flex align-center ga-2 flex-wrap">
                    <span class="text-body-2 font-weight-medium">{{ line.productName }}</span>
                    <v-chip v-if="line.price_includes_tax" size="x-small" color="primary" variant="tonal">IVA incl.</v-chip>
                    <span class="text-caption text-medium-emphasis">{{ line.variantName || '-' }}</span>
                    <span class="text-caption text-medium-emphasis">SKU: {{ line.sku || '-' }}</span>
                  </div>
                  <span class="text-body-1 font-weight-bold">{{ formatMoney(line.line_total) }}</span>
                </div>
              </template>
              <template #content="{ item: line }">
                <div class="pos-cart-line-grid" :class="{ 'pos-cart-line-grid--admin': canManageDiscounts }">
                  <div class="pos-cart-field">
                    <div class="pos-cart-field__label">Cant.</div>
                    <v-text-field
                      v-model.number="line.quantity"
                      type="number"
                      variant="outlined"
                      density="compact"
                      hide-details
                      min="1"
                      class="pos-cart-input-qty"
                      @update:model-value="recalculate"
                    />
                  </div>
                  <div class="pos-cart-field">
                    <div class="pos-cart-field__label">Precio</div>
                    <div class="pos-cart-field__value">{{ formatMoney(line.unit_price) }}</div>
                  </div>
                  <div class="pos-cart-field">
                    <div class="pos-cart-field__label">Subtotal</div>
                    <div class="pos-cart-field__value">{{ formatMoney(getLineSubtotal(line)) }}</div>
                  </div>
                  <div v-if="canManageDiscounts" class="pos-cart-field">
                    <div class="pos-cart-field__label">Descuento</div>
                    <div class="d-flex align-center ga-2 pos-cart-discount-controls">
                      <v-btn-toggle v-model="line.discount_line_type" mandatory density="compact" variant="outlined" divided class="pos-cart-discount-type">
                        <v-btn value="AMOUNT" size="x-small" @click="recalculate">$</v-btn>
                        <v-btn value="PERCENT" size="x-small" @click="recalculate">%</v-btn>
                      </v-btn-toggle>
                      <v-text-field
                        v-model.number="line.discount_line"
                        type="number"
                        variant="outlined"
                        density="compact"
                        hide-details
                        min="0"
                        :max="line.discount_line_type === 'PERCENT' ? 100 : getLineSubtotal(line)"
                        class="pos-cart-discount-value"
                        @update:model-value="recalculate"
                      />
                    </div>
                  </div>
                </div>
              </template>
              <template #actions="{ item: line }">
                <v-btn
                  icon="mdi-close"
                  size="small"
                  variant="text"
                  color="error"
                  @click.stop="removeLineFromCart(line)"
                />
              </template>
            </ListView>
          </div>

          <v-card-text v-if="cart.length === 0" class="text-center text-grey py-8">
            <v-icon size="48">mdi-cart-outline</v-icon>
            <div>Agrega productos para iniciar la venta</div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Panel Derecho: Totales y Pago -->
      <v-col cols="12" md="5" class="pl-md-2 mt-2 mt-md-0 pos-summary-col">
        <v-card class="pos-panel pos-summary-card">
          <!-- Cliente -->
          <v-card-text class="pa-2">
            <v-autocomplete
              v-model="selectedCustomer"
              :items="customerResults"
              item-title="full_name"
              item-value="customer_id"
              return-object
              label="Cliente (opcional)"
              prepend-inner-icon="mdi-account"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              :loading="searchingCustomer"
              @update:search="searchCustomer"
            >
              <template #item="{ props, item }">
                <v-list-item v-bind="props" :subtitle="item.raw.document || item.raw.phone || ''"></v-list-item>
              </template>
            </v-autocomplete>

            <!-- Info de crédito del cliente -->
            <div v-if="selectedCustomer && customerCreditInfo" class="mt-2">
              <v-chip
                :color="availableCreditAmount > 0 ? 'success' : 'error'"
                size="small" variant="tonal"
                prepend-icon="mdi-account-credit-card"
              >
                Cupo disponible:
                {{ new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(availableCreditAmount) }}
              </v-chip>
            </div>
            <div v-else-if="selectedCustomer && hasCreditPayment && !customerCreditInfo" class="mt-2">
              <v-chip color="warning" size="small" variant="tonal" prepend-icon="mdi-alert">Sin cupo de crédito asignado</v-chip>
            </div>

            <!-- Receptor Fiscal: solo visible cuando FE está habilitada -->
            <v-autocomplete
              v-if="electronicInvoicingEnabled"
              v-model="selectedThirdParty"
              :items="thirdPartyResults"
              item-title="legal_name"
              item-value="third_party_id"
              return-object
              label="Receptor Fiscal (FE)"
              prepend-inner-icon="mdi-domain"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              class="mt-2"
              :loading="searchingThirdParty"
              @update:search="searchThirdParty"
            >
              <template #item="{ props, item }">
                <v-list-item
                  v-bind="props"
                  :subtitle="(item.raw.document_type || '') + ' ' + (item.raw.document_number || '') + (item.raw.dv ? '-' + item.raw.dv : '')"
                ></v-list-item>
              </template>
            </v-autocomplete>
          </v-card-text>

          <v-divider></v-divider>

          <!-- Ventas en espera -->
          <v-card-text class="pa-2">
            <div class="d-flex flex-column flex-sm-row ga-2 align-stretch align-sm-center justify-space-between mb-2">
              <div class="text-subtitle-2">Ventas en espera</div>
              <v-btn
                color="success"
                variant="tonal"
                size="small"
                prepend-icon="mdi-pause-circle-outline"
                :disabled="cart.length === 0"
                @click="saveSaleOnHold"
              >
                Guardar en espera
              </v-btn>
            </div>

            <div v-if="heldSales.length === 0" class="text-caption text-medium-emphasis">
              No hay ventas en espera.
            </div>

            <div v-else class="d-flex flex-column ga-2">
              <v-card
                v-for="held in heldSales"
                :key="held.id"
                variant="outlined"
                class="held-sale-card"
              >
                <v-card-text class="pa-2">
                  <div class="text-body-2 font-weight-bold">
                    {{ getHeldSaleCustomerLabel(held) }} · {{ getHeldSaleItemsCount(held) }} item(s)
                  </div>
                  <div class="text-caption text-medium-emphasis mb-2">
                    {{ formatHeldSaleDate(held.createdAt) }}
                  </div>
                  <div class="d-flex flex-wrap ga-2">
                    <v-btn
                      color="primary"
                      size="small"
                      variant="tonal"
                      @click="resumeHeldSale(held.id)"
                    >
                      Retomar
                    </v-btn>
                    <v-btn
                      color="error"
                      size="small"
                      variant="tonal"
                      @click="removeHeldSale(held.id)"
                    >
                      Quitar
                    </v-btn>
                  </div>
                </v-card-text>
              </v-card>
            </div>
          </v-card-text>

          <v-divider></v-divider>

          <!-- Botón Descuento Global -->
          <v-card-text v-if="canManageDiscounts && cart.length > 0" class="pa-2 pb-0">
            <div class="d-flex gap-1">
              <v-btn 
                size="small" 
                variant="tonal" 
                color="warning" 
                prepend-icon="mdi-percent" 
                @click="showGlobalDiscountDialog = true"
                :style="{ flex: 1 }"
              >
                {{ totals.discountGlobal > 0 ? 'Ajustar' : 'Aplicar' }} Descuento Global
              </v-btn>
              <v-btn 
                v-if="totals.discountGlobal > 0"
                size="small" 
                variant="text" 
                color="error" 
                icon="mdi-close"
                @click="removeGlobalDiscount"
              ></v-btn>
            </div>
          </v-card-text>

          <!-- Totales -->
          <v-card-text class="pa-3 totals-sticky">
            <div class="d-flex justify-space-between mb-1">
              <span>Subtotal:</span><span>{{ formatMoney(totals.subtotal) }}</span>
            </div>
            <div v-if="totals.discountLine > 0" class="d-flex justify-space-between mb-1 text-warning">
              <span>Desc. Línea:</span><span>-{{ formatMoney(totals.discountLine) }}</span>
            </div>
            <div v-if="totals.discountGlobal > 0" class="d-flex justify-space-between mb-1 text-warning">
              <span>Desc. Global:</span><span>-{{ formatMoney(totals.discountGlobal) }}</span>
            </div>
            <div v-if="totals.discount > 0 && totals.discountLine === 0 && totals.discountGlobal === 0" class="d-flex justify-space-between mb-1 text-warning">
              <span>Descuento:</span><span>-{{ formatMoney(totals.discount) }}</span>
            </div>
            <div class="d-flex justify-space-between mb-1">
              <span>{{ totals.taxLabel }}:</span><span>{{ formatMoney(totals.tax) }}</span>
            </div>
            <v-divider class="my-2"></v-divider>
            <div class="d-flex justify-space-between text-h5 font-weight-bold">
              <span>TOTAL:</span><span class="text-primary">{{ formatMoney(totals.total) }}</span>
            </div>
          </v-card-text>

          <v-divider></v-divider>

          <!-- Pagos -->
          <v-card-text class="pa-2 pa-sm-3">
            <div class="text-subtitle-2 mb-2">Formas de Pago</div>
            <div v-for="(payment, i) in payments" :key="i" class="mb-2">
              <div class="d-flex flex-column flex-sm-row ga-2 align-stretch align-sm-center">
                <v-select 
                  v-model="payment.method" 
                  :items="paymentMethods" 
                  item-title="name" 
                  item-value="code" 
                  variant="outlined" 
                  density="compact" 
                  hide-details
                  :style="{ 'max-width': $vuetify.display.smAndUp ? '160px' : '100%' }"
                ></v-select>
                <v-text-field 
                  v-model.number="payment.amount" 
                  type="number" 
                  variant="outlined" 
                  density="compact" 
                  hide-details 
                  prefix="$"
                  @update:model-value="recalcPayments"
                ></v-text-field>
                <v-btn 
                  icon="mdi-close" 
                  size="small" 
                  variant="text" 
                  color="error" 
                  @click="removePayment(i)" 
                  :disabled="payments.length <= 1"
                  class="align-self-center"
                ></v-btn>
              </div>
              <!-- Botones rápidos de pago (solo para efectivo) -->
              <div v-if="isPaymentCash(payment.method)" class="d-flex flex-wrap ga-1 mt-1">
                <v-btn size="x-small" variant="tonal" @click="setQuickAmount(i, 1000)">$1k</v-btn>
                <v-btn size="x-small" variant="tonal" @click="setQuickAmount(i, 2000)">$2k</v-btn>
                <v-btn size="x-small" variant="tonal" @click="setQuickAmount(i, 5000)">$5k</v-btn>
                <v-btn size="x-small" variant="tonal" @click="setQuickAmount(i, 10000)">$10k</v-btn>
                <v-btn size="x-small" variant="tonal" @click="setQuickAmount(i, 20000)">$20k</v-btn>
                <v-btn size="x-small" variant="tonal" @click="setQuickAmount(i, 50000)">$50k</v-btn>
                <v-btn size="x-small" variant="tonal" @click="setQuickAmount(i, 100000)">$100k</v-btn>
                <v-btn size="x-small" variant="tonal" color="primary" @click="setQuickAmount(i, totals.total)">Exacto</v-btn>
              </div>
            </div>
            <v-btn 
              size="small" 
              variant="tonal" 
              prepend-icon="mdi-plus" 
              @click="addPayment" 
              class="mb-2"
              :block="$vuetify.display.xs"
            >
              Agregar pago
            </v-btn>

            <div v-if="change > 0" class="d-flex justify-space-between text-h6 text-success mt-2">
              <span>Cambio:</span><span>{{ formatMoney(change) }}</span>
            </div>
            <div v-if="remaining > 0" class="d-flex justify-space-between text-body-1 text-error mt-2">
              <span>Falta:</span><span>{{ formatMoney(remaining) }}</span>
            </div>
          </v-card-text>

          <v-card-text class="pa-2 pa-sm-3">
            <v-text-field
              v-if="canSelectSaleDateTime"
              v-model="saleDateTimeInput"
              type="datetime-local"
              label="Fecha y hora de la venta"
              variant="outlined"
              density="compact"
              hide-details="auto"
              class="mb-2"
              :error-messages="saleDateTimeError ? [saleDateTimeError] : []"
            ></v-text-field>

            <v-textarea 
              v-model="saleNote" 
              label="Nota (opcional)" 
              variant="outlined" 
              rows="1" 
              density="compact" 
              hide-details
            ></v-textarea>

            <div class="text-caption text-medium-emphasis mt-2">
              <template v-if="canSelectSaleDateTime">
                Si no cambias este campo, la venta usará la fecha y hora actual al momento de cobrar.
                La retrofecha máxima permitida es de {{ posMaxBackdateHours }} hora(s).
              </template>
              <template v-else>
                La venta se registra con la fecha y hora actual al momento de cobrar. El POS no permite cambiarla manualmente.
              </template>
            </div>
          </v-card-text>

          <!-- Alerta sesión expirada -->
          <v-card-text v-if="sessionExpired" class="pa-2 pa-sm-3 pt-0">
            <v-alert type="error" variant="tonal" density="compact" prepend-icon="mdi-clock-alert">
              <strong>Sesión vencida ({{ sessionAgeHours }}h abierta).</strong>
              Cierra y reabre la caja para continuar vendiendo.
            </v-alert>
          </v-card-text>

        </v-card>
      </v-col>
    </v-row>

    <transition name="pos-floating-actions">
      <div
        v-if="showFloatingHeaderActions"
        class="pos-floating-actions"
      >
        <v-btn
          class="pos-floating-actions__charge"
          color="primary"
          prepend-icon="mdi-check-circle"
          :loading="processing"
          :disabled="cart.length === 0 || remaining > 0 || sessionExpired"
          @click="processSale"
        >
          Cobrar {{ formatMoney(totals.total) }}
        </v-btn>
        <v-btn
          class="pos-floating-actions__clear"
          variant="tonal"
          color="error"
          prepend-icon="mdi-trash-can"
          :disabled="cart.length === 0"
          @click="clearSale"
        >
          Limpiar
        </v-btn>
        <v-chip
          v-if="currentSession"
          class="pos-floating-actions__status"
          :color="sessionExpired ? 'error' : 'success'"
          size="small"
          :prepend-icon="sessionExpired ? 'mdi-clock-alert' : 'mdi-cash-register'"
        >
          {{ currentSession.cash_register?.name || 'Caja' }}
        </v-chip>
      </div>
    </transition>

    <!-- Dialog Descuento Global -->
    <v-dialog v-model="showGlobalDiscountDialog" max-width="400">
      <v-card>
        <v-card-title>Aplicar Descuento Global</v-card-title>
        <v-card-text>
          <v-radio-group v-model="globalDiscountType">
            <v-radio label="Porcentaje" value="percentage"></v-radio>
            <v-radio label="Monto Fijo" value="fixed"></v-radio>
          </v-radio-group>
          <v-text-field
            v-model.number="globalDiscountValue"
            type="number"
            :label="globalDiscountType === 'percentage' ? 'Porcentaje (%)' : 'Monto ($)'"
            variant="outlined"
            density="compact"
            min="0"
            :max="globalDiscountType === 'percentage' ? 100 : maxGlobalDiscountAmount"
            :prefix="globalDiscountType === 'fixed' ? '$' : ''"
            :suffix="globalDiscountType === 'percentage' ? '%' : ''"
          ></v-text-field>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="showGlobalDiscountDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="applyGlobalDiscount">Aplicar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useTenant } from '@/composables/useTenant'
import { useAuth } from '@/composables/useAuth'
import { useTenantSettings } from '@/composables/useTenantSettings'

const { t } = useI18n()

import productsService from '@/services/products.service'
import customersService from '@/services/customers.service'
import thirdPartiesService from '@/services/thirdParties.service'
import {
  analyzeChatOrderText,
  matchChatLinesToCatalog,
  findBestCustomerMatch,
  suggestCatalogMatchesFromChatText
} from '@/services/chatOrderAgent.service'
import salesService from '@/services/sales.service'
import cashService from '@/services/cash.service'
import paymentMethodsService from '@/services/paymentMethods.service'
import taxesService from '@/services/taxes.service'
import electronicInvoicingService from '@/services/electronicInvoicing.service'
import creditService from '@/services/credit.service'
import ListView from '@/components/ListView.vue'
import ContextHelpCard from '@/components/ContextHelpCard.vue'
import { formatMoney } from '@/utils/formatters'
import { applyLineTaxes } from '@/utils/taxCalculator'
import { humanizeAppError } from '@/utils/appErrors'
import {
  allocateGlobalDiscountAcrossLines,
  buildSalePayloadLines,
  getCartLineTotalDiscountAmount,
  getDocumentLineSubtotal,
  getMaxGlobalDiscountAmount,
  normalizeCartLineDiscount,
  summarizeCartTotals,
  validateCartDiscounts as validateCartDiscountsShared,
} from '@/utils/saleCalculator'
import { useI18n } from '@/i18n'

const { tenantId } = useTenant()
const { userProfile } = useAuth()
const {
  maxDiscountWithoutAuth,
  applyRounding,
  electronicInvoicingEnabled,
  cashSessionMaxHours,
  posAllowManualSaleDatetime,
  posMaxBackdateHours
} = useTenantSettings()
const POS_HOLD_SALES_STORAGE_PREFIX = 'ofirone_pos_hold_sales'
const MAX_HOLD_SALES = 20

const searchTerm = ref('')
const searchResults = ref([])
const cart = ref([])
const cartListPage = ref(1)
const CART_LIST_PAGE_SIZE = 8
const selectedCustomer = ref(null)
const customerResults = ref([])
const searchingCustomer = ref(false)
const customerCreditInfo = ref(null)
const chatOrderText = ref('')
const processingChatOrder = ref(false)
const chatOrderSummary = ref(null)
const heldSales = ref([])
const CUSTOMER_AUTOLOAD_MIN_SCORE = 0.82
const saleDateTime = ref('')
const saleDateTimeTouched = ref(false)

// Cargar info de crédito cuando cambie el cliente
watch(selectedCustomer, async (customer) => {
  if (!customer?.customer_id) { customerCreditInfo.value = null; return }
  const r = await creditService.getCreditAccount(tenantId.value, customer.customer_id)
  customerCreditInfo.value = r.success ? r.data : null
})
// Receptor fiscal FE (third_parties)
const selectedThirdParty = ref(null)
const thirdPartyResults  = ref([])
const searchingThirdParty = ref(false)
const payments = ref([{ method: '', amount: 0 }])
const paymentMethods = ref([])
const currentSession = ref(null)
const processing = ref(false)
const saleNote = ref('')
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

// Sesión expirada (configurable via parámetros de empresa)
const sessionAgeHours = computed(() => {
  if (!currentSession.value?.opened_at) return 0
  return Math.floor((Date.now() - new Date(currentSession.value.opened_at)) / 3600000)
})
const sessionExpired = computed(() => sessionAgeHours.value >= cashSessionMaxHours.value)

// ─── Crédito ──────────────────────────────────────────────────────────────
const hasCreditPayment = computed(() => payments.value.some(p => p.method === 'CREDITO'))
const creditPaymentAmount = computed(() =>
  payments.value.filter(p => p.method === 'CREDITO').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
)
const availableCreditAmount = computed(() => creditService.availableCredit(customerCreditInfo.value))
const creditError = computed(() => {
  if (!hasCreditPayment.value) return null
  if (!selectedCustomer.value) return 'Selecciona un cliente para venta a crédito'
  if (!customerCreditInfo.value || !customerCreditInfo.value.is_active) return 'Este cliente no tiene cupo de crédito activo'
  if (creditPaymentAmount.value > availableCreditAmount.value)
    return `Cupo insuficiente. Disponible: ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(availableCreditAmount.value)}`
  return null
})

// Descuentos en POS
const showGlobalDiscountDialog = ref(false)
const globalDiscountType = ref('percentage')
const globalDiscountValue = ref(0)

let searchTimeout = null
const searchInput = ref(null)
const headerCard = ref(null)
const selectedVariant = ref(null)
const searchingProduct = ref(false)
const showFloatingHeaderActions = ref(false)

// Descuentos en POS: permitidos para administrador y gerente.
const canManageDiscounts = computed(() => {
  const roles = userProfile.value?.roles?.map((role) => role.name) || []
  return roles.includes('ADMINISTRADOR') || roles.includes('GERENTE')
})
const canSelectSaleDateTime = computed(() => canManageDiscounts.value && posAllowManualSaleDatetime.value)
const getLineSubtotal = (line) => getDocumentLineSubtotal(line, {
  quantityField: 'quantity',
  unitPriceField: 'unit_price',
})

const normalizeLineDiscountValue = (line, options = {}) => {
  if (!line) return { valid: true, adjusted: false, error: null }

  const validation = normalizeCartLineDiscount(line)
  line.discount_line = validation.sanitizedValue

  if (validation.valid) {
    return { valid: true, adjusted: false, error: null }
  }

  if (!options.silent && validation.adjusted) {
    const targetLabel = validation.discountType === 'PERCENT'
      ? 'El descuento porcentual no puede ser mayor a 100%'
      : 'El descuento de la línea no puede ser mayor al valor del producto'
    showMsg(targetLabel, 'warning')
  }

  return {
    valid: false,
    adjusted: validation.adjusted,
    error: validation.error || null,
  }
}

const allocateGlobalDiscountAcrossCart = async (requestedDiscountAmount) => {
  const allocation = allocateGlobalDiscountAcrossLines(cart.value, requestedDiscountAmount)

  if (allocation.invoiceBase <= 0 || allocation.appliedAmount <= 0) {
    await Promise.all(allocation.allocations.map(async ({ line, amount }) => {
      line.discount_global = amount
      await recalculateTaxes(line)
    }))
    return {
      appliedAmount: 0,
      invoiceBase: allocation.invoiceBase,
      capped: requestedDiscountAmount > 0,
    }
  }

  await Promise.all(allocation.allocations.map(async ({ line, amount }) => {
    line.discount_global = amount
    await recalculateTaxes(line)
  }))

  return {
    appliedAmount: allocation.appliedAmount,
    invoiceBase: allocation.invoiceBase,
    capped: allocation.capped,
  }
}

const validateCartDiscounts = () => {
  cart.value.forEach((line) => normalizeLineDiscountValue(line, { silent: true }))
  return validateCartDiscountsShared(cart.value)
}

const getCurrentSaleDateTimeLocal = () => {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const year = now.getFullYear()
  const month = pad(now.getMonth() + 1)
  const day = pad(now.getDate())
  const hours = pad(now.getHours())
  const minutes = pad(now.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

const parseSaleDateTimeValue = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const selectedSaleDate = computed(() => {
  if (!canSelectSaleDateTime.value) return null
  const sourceValue = saleDateTimeTouched.value ? saleDateTime.value : getCurrentSaleDateTimeLocal()
  return parseSaleDateTimeValue(sourceValue)
})

const saleDateTimeInput = computed({
  get: () => (saleDateTimeTouched.value ? saleDateTime.value : getCurrentSaleDateTimeLocal()),
  set: (value) => {
    saleDateTimeTouched.value = true
    saleDateTime.value = value
  }
})

const saleDateTimeError = computed(() => {
  if (!canSelectSaleDateTime.value) return ''

  const selected = selectedSaleDate.value
  if (!selected) return 'Selecciona una fecha/hora válida'

  const now = new Date()
  if (selected.getTime() > now.getTime()) {
    return 'La fecha/hora de venta no puede estar en el futuro'
  }

  const maxBackMs = Number(posMaxBackdateHours.value || 24) * 60 * 60 * 1000
  if ((now.getTime() - selected.getTime()) > maxBackMs) {
    return `La retrofecha máxima permitida es de ${posMaxBackdateHours.value} hora(s)`
  }

  if (currentSession.value?.opened_at) {
    const sessionOpenedAt = new Date(currentSession.value.opened_at)
    if (!Number.isNaN(sessionOpenedAt.getTime()) && selected.getTime() < sessionOpenedAt.getTime()) {
      return 'La fecha/hora de venta no puede ser anterior a la apertura de la caja'
    }
  }

  return ''
})

const holdSalesStorageKey = computed(() => {
  if (!tenantId.value || !userProfile.value?.user_id) return null
  return `${POS_HOLD_SALES_STORAGE_PREFIX}:${tenantId.value}:${userProfile.value.user_id}`
})

const updateFloatingHeaderActions = () => {
  if (typeof window === 'undefined') return
  const headerElement = headerCard.value?.$el || headerCard.value
  if (!headerElement) {
    showFloatingHeaderActions.value = false
    return
  }

  const rect = headerElement.getBoundingClientRect()
  showFloatingHeaderActions.value = rect.bottom < 16
}

const totals = computed(() => {
  return summarizeCartTotals(cart.value, { applyRounding })
})

const maxGlobalDiscountAmount = computed(() => getMaxGlobalDiscountAmount(cart.value))

const cartTotalPages = computed(() => Math.max(1, Math.ceil(cart.value.length / CART_LIST_PAGE_SIZE)))
const paginatedCart = computed(() => {
  const start = (cartListPage.value - 1) * CART_LIST_PAGE_SIZE
  return cart.value.slice(start, start + CART_LIST_PAGE_SIZE)
})

const onCartListPage = ({ page }) => {
  cartListPage.value = Number(page || 1)
}

const paidTotal = computed(() => payments.value.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0))
const change = computed(() => Math.max(0, paidTotal.value - totals.value.total))
const remaining = computed(() => Math.max(0, totals.value.total - paidTotal.value))

// Autocompletado con debounce
const debouncedSearch = (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val || val.length < 2) { searchResults.value = []; return }
  searchTimeout = setTimeout(() => fetchSuggestions(val), 350)
}

const fetchSuggestions = async (query) => {
  if (!query || !tenantId.value) return
  searchingProduct.value = true
  try {
    const locationId = currentSession.value?.cash_register?.location_id || null
    const r = await productsService.searchVariants(tenantId.value, query, 20, locationId)
    if (r.success) {
      searchResults.value = r.data.map(v => ({
        ...v,
        _displayName: `${v.product?.name || ''}${v.variant_name ? ' — ' + v.variant_name : ''} (${v.sku})${v.stock_on_hand !== undefined ? ` [Stock: ${v.stock_available || 0}]` : ''}`,
        _stock: v.stock_on_hand ?? null
      }))
    }
  } finally {
    searchingProduct.value = false
  }
}

// Enter directo: buscar por barcode/SKU exacto (pistola de código de barras)
const searchByBarcode = async () => {
  if (!searchTerm.value || !tenantId.value) return
  const exact = await productsService.findVariantByBarcode(tenantId.value, searchTerm.value)
  if (exact.success) {
    addToCart(exact.data)
    clearSearch()
  }
}

// Cuando selecciona un item del dropdown
const onVariantSelected = (variant) => {
  if (!variant) return
  addToCart(variant)
  // Limpiar con nextTick para que Vuetify termine su ciclo interno primero
  nextTick(() => {
    clearSearch()
  })
}

const clearSearch = () => {
  selectedVariant.value = null
  searchTerm.value = ''
  searchResults.value = []
  // Forzar blur y focus para resetear el estado interno del autocomplete
  if (searchInput.value) {
    searchInput.value.blur()
    setTimeout(() => {
      searchInput.value?.focus()
    }, 50)
  }
}

const addToCart = async (variant, quantity = 1) => {
  const qty = Math.max(1, Math.round(Number(quantity || 1)))
  const existing = cart.value.find(l => l.variant_id === variant.variant_id)
  if (existing) {
    existing.quantity += qty
    await recalculateTaxes(existing)
    // Forzar actualización reactiva
    cart.value = [...cart.value]
  } else {
    const newLine = {
      variant_id: variant.variant_id,
      sku: variant.sku,
      productName: variant.product?.name || '',
      variantName: variant.variant_name || '',
      quantity: qty,
      unit_price: parseFloat(variant.price) || 0,
      unit_cost: parseFloat(variant.cost) || 0,
      price_includes_tax: variant.price_includes_tax || false, // 🆕 NUEVO
      discount_line: 0,
      discount_line_type: 'AMOUNT',
      discount_global: 0,
      discount: 0,
      discount_type: 'AMOUNT',
      base_amount: 0, // 🆕 NUEVO: Base gravable
      tax_amount: 0,
      tax_rate: 0,
      tax_code: null,
      tax_name: null,
      line_total: parseFloat(variant.price) || 0
    }
    
    // Calcular impuestos ANTES de agregar al carrito
    await recalculateTaxes(newLine)
    cart.value.push(newLine)
  }
  // Auto-llenar primer pago
  if (payments.value.length === 1) payments.value[0].amount = totals.value.total
}

const buildChatCatalogSearchTerms = (chatText, lineItems = []) => {
  const rawTerms = []

  for (const line of Array.isArray(lineItems) ? lineItems : []) {
    if (line?.sku) rawTerms.push(String(line.sku))
    if (line?.raw_name) rawTerms.push(String(line.raw_name))
    if (line?.raw_name && line?.unit_hint) rawTerms.push(`${line.raw_name} ${line.unit_hint}`)
  }

  const rawSegments = String(chatText || '')
    .split(/[\n,;]+/)
    .map((segment) => String(segment || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  rawTerms.push(...rawSegments)

  return [...new Set(
    rawTerms
      .map((term) => String(term || '').trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((term) => term.length >= 2)
  )].slice(0, 12)
}

const listCatalogForChatMatching = async (lineItems = []) => {
  const searchTerms = buildChatCatalogSearchTerms(chatOrderText.value, lineItems)
  if (!searchTerms.length) {
    return { success: false, error: 'No pude extraer términos útiles del chat para buscar en el catálogo.', data: [] }
  }

  return productsService.getVariantsForChatMatching(tenantId.value, searchTerms, {
    perTermLimit: 14,
    maxItems: 180
  })
}

const recalculateTaxes = async (line) => {
  if (!tenantId.value || !line.variant_id) return

  const taxResult = await taxesService.getTaxInfoForVariant(tenantId.value, line.variant_id)
  normalizeLineDiscountValue(line)

  const subtotal = getLineSubtotal(line)
  const discountAmount = getCartLineTotalDiscountAmount(line)

  // Actualizar campo discount para compatibilidad con backend
  line.discount = discountAmount
  line.discount_type = 'AMOUNT' // Siempre enviar como AMOUNT porque ya está calculado

  const priceAfterDiscount = subtotal - discountAmount
  applyLineTaxes(line, taxResult, priceAfterDiscount)
}

const removeFromCart = (i) => { cart.value.splice(i, 1); recalcPayments() }
const removeLineFromCart = (line) => {
  const index = cart.value.indexOf(line)
  if (index < 0) return
  removeFromCart(index)
}

const recalculate = async () => {
  await Promise.all(cart.value.map((line) => recalculateTaxes(line)))
  recalcPayments()
}

const recalcPayments = () => {
  if (payments.value.length === 1) payments.value[0].amount = totals.value.total
}

// Aplicar descuento global
const applyGlobalDiscount = async () => {
  if (!canManageDiscounts.value) {
    showMsg('Solo administradores o gerentes pueden aplicar descuentos', 'error')
    return
  }
  
  if (!globalDiscountValue.value || globalDiscountValue.value <= 0) {
    showMsg('Ingrese un valor válido de descuento', 'warning')
    return
  }
  
  // Validar límite de descuento sin autorización
  if (globalDiscountType.value === 'percentage') {
    if (globalDiscountValue.value > maxDiscountWithoutAuth.value) {
      showMsg(`El descuento máximo permitido es ${maxDiscountWithoutAuth.value}%. Requiere autorización superior.`, 'error')
      return
    }
  }
  
  // Calcular subtotal actual (después de descuentos de línea)
  const totalBeforeGlobalDiscount = getMaxGlobalDiscountAmount(cart.value)

  if (totalBeforeGlobalDiscount <= 0) {
    showMsg('No hay base disponible para aplicar descuento en esta factura', 'warning')
    return
  }

  let requestedDiscountAmount = 0

  if (globalDiscountType.value === 'percentage') {
    if (globalDiscountValue.value > 100) {
      showMsg('El porcentaje no puede ser mayor a 100%', 'error')
      return
    }

    // Aplicar porcentaje sobre el subtotal después de descuentos de línea
    requestedDiscountAmount = totalBeforeGlobalDiscount * (globalDiscountValue.value / 100)
  } else {
    requestedDiscountAmount = globalDiscountValue.value
  }

  if (requestedDiscountAmount > totalBeforeGlobalDiscount) {
    showMsg('El descuento global no puede ser mayor al valor de la factura', 'error')
    return
  }

  await allocateGlobalDiscountAcrossCart(requestedDiscountAmount)
  
  // Forzar actualización reactiva
  cart.value = [...cart.value]
  
  showGlobalDiscountDialog.value = false
  globalDiscountValue.value = 0
  showMsg('Descuento aplicado correctamente')
}

// Remover descuento global
const removeGlobalDiscount = async () => {
  await Promise.all(cart.value.map(async (line) => {
    line.discount_global = 0
    await recalculateTaxes(line)
  }))
  cart.value = [...cart.value]
  showMsg('Descuento global removido')
}

const parseChatOrderWithAgent = async () => {
  chatOrderSummary.value = null
  if (!tenantId.value) {
    showMsg('Tenant inválido para conversión de chat.', 'error')
    return
  }

  if (!chatOrderText.value.trim()) {
    showMsg('Pega o escribe el pedido del chat.', 'warning')
    return
  }

  processingChatOrder.value = true
  let shouldClearChatInput = false
  try {
    let aiResult = await analyzeChatOrderText({
      tenantId: tenantId.value,
      chatText: chatOrderText.value
    })

    let catalogResult = await listCatalogForChatMatching(aiResult.success ? aiResult.data?.line_items : [])

    if (aiResult.success && aiResult.data?.cache_hit) {
      const cachedAttempt = matchChatLinesToCatalog(aiResult.data.line_items, catalogResult.data)
      if (cachedAttempt.matched.length === 0) {
        const refreshedResult = await analyzeChatOrderText({
          tenantId: tenantId.value,
          chatText: chatOrderText.value,
          forceCloud: true,
          forceRefresh: true
        })

        if (refreshedResult.success) {
          aiResult = refreshedResult
          catalogResult = await listCatalogForChatMatching(aiResult.data?.line_items || [])
        }
      }
    }

    if (!aiResult.success) {
      if (!catalogResult.success || !catalogResult.data?.length) {
        showMsg(aiResult.error || catalogResult.error || 'No fue posible convertir el chat.', 'error')
        return
      }

      const rawSuggestions = suggestCatalogMatchesFromChatText(chatOrderText.value, catalogResult.data)
      if (rawSuggestions.length > 0) {
        chatOrderSummary.value = {
          matchedCount: 0,
          unmatchedCount: 0,
          reviewCount: rawSuggestions.length,
          confidencePercent: 0,
          customerSuggestion: null,
          customerAutoloaded: false,
          notes: null,
          cacheHit: false,
          parserLabel: 'Fallback local',
          reviewLines: rawSuggestions.map((entry) => ({
            rawName: entry.line?.raw_name || 'Item sin nombre',
            candidates: (entry.candidates || []).map((candidate) => {
              const productName = candidate.variant?.product?.name || 'Producto'
              const variantName = candidate.variant?.variant_name ? ` ${candidate.variant.variant_name}` : ''
              const sku = candidate.variant?.sku ? ` [${candidate.variant.sku}]` : ''
              return `${productName}${variantName}${sku}`
            })
          })),
          unmatchedLines: []
        }
        showMsg('El parser no produjo ítems válidos, pero encontré sugerencias desde el texto del chat.', 'warning')
        return
      }

      showMsg(aiResult.error || 'No fue posible convertir el chat.', 'error')
      return
    }

    if (!catalogResult.success || !catalogResult.data?.length) {
      showMsg(catalogResult.error || 'No encontré un catálogo operativo para hacer matching del chat.', 'error')
      return
    }

    const { matched, review, unmatched } = matchChatLinesToCatalog(aiResult.data.line_items, catalogResult.data)

    const customerName = String(aiResult?.data?.order?.customer_name || '').trim()
    let customerSuggestion = null
    let customerAutoloaded = false
    if (customerName.length >= 2) {
      const customerLookup = await customersService.searchCustomers(tenantId.value, customerName, 20)
      const customerList = customerLookup.success ? customerLookup.data || [] : []
      const bestCustomer = findBestCustomerMatch(customerName, customerList)
      if (bestCustomer?.customer) {
        customerSuggestion = bestCustomer.customer
        if (!selectedCustomer.value?.customer_id && Number(bestCustomer.score || 0) >= CUSTOMER_AUTOLOAD_MIN_SCORE) {
          selectedCustomer.value = bestCustomer.customer
          customerAutoloaded = true
        } else if (!selectedCustomer.value?.customer_id && customerList.length) {
          customerResults.value = customerList.slice(0, 6)
        }
      } else if (!selectedCustomer.value?.customer_id && customerList.length) {
        customerResults.value = customerList.slice(0, 6)
      }
    }

    const reviewLines = (review || []).map((entry) => ({
      rawName: entry.line?.raw_name || 'Item sin nombre',
      candidates: (entry.candidates || []).map((candidate) => {
        const productName = candidate.variant?.product?.name || 'Producto'
        const variantName = candidate.variant?.variant_name ? ` ${candidate.variant.variant_name}` : ''
        const sku = candidate.variant?.sku ? ` [${candidate.variant.sku}]` : ''
        return `${productName}${variantName}${sku}`
      })
    }))

    const unmatchedLines = (unmatched || []).map((entry) => entry?.raw_name || entry?.name).filter(Boolean)
    const parserName = aiResult?.data?.parser === 'deterministic' ? 'Local' : 'Cloud IA'

    if (!matched.length) {
      chatOrderSummary.value = {
        matchedCount: 0,
        unmatchedCount: unmatched.length,
        reviewCount: review.length,
        confidencePercent: Math.round(Number(aiResult?.data?.order?.confidence || 0) * 100),
        customerSuggestion,
        customerAutoloaded,
        notes: aiResult?.data?.order?.notes || null,
        cacheHit: Boolean(aiResult?.data?.cache_hit),
        parserLabel: parserName,
        reviewLines,
        unmatchedLines
      }
      showMsg(
        review.length > 0
          ? 'Se encontraron sugerencias, pero no hubo coincidencias suficientemente confiables para cargar al carrito.'
          : 'No se encontraron coincidencias confiables en tu catálogo.',
        'warning'
      )
      return
    }

    for (const item of matched) {
      await addToCart(item.variant, item.line.quantity || 1)
    }
    shouldClearChatInput = true

    const aiNotes = String(aiResult?.data?.order?.notes || '').trim()
    if (aiNotes) {
      const currentNote = String(saleNote.value || '').trim()
      if (!currentNote) saleNote.value = aiNotes
      else if (!currentNote.includes(aiNotes)) saleNote.value = `${currentNote}\n${aiNotes}`
    }

    chatOrderSummary.value = {
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      reviewCount: review.length,
      confidencePercent: Math.round(Number(aiResult?.data?.order?.confidence || 0) * 100),
      customerSuggestion,
      customerAutoloaded,
      notes: aiResult?.data?.order?.notes || null,
      cacheHit: Boolean(aiResult?.data?.cache_hit),
      parserLabel: parserName,
      reviewLines,
      unmatchedLines
    }

    showMsg(
      `Chat convertido: ${matched.length} item(s) cargados` +
      `${review.length ? `, ${review.length} para revisar` : ''}` +
      `${unmatched.length ? `, ${unmatched.length} sin match` : ''}` +
      `${aiResult?.data?.cache_hit ? ' (cache)' : ''}.`
    )
  } finally {
    processingChatOrder.value = false
    if (shouldClearChatInput) {
      chatOrderText.value = ''
    }
  }
}

// Cliente
const searchCustomer = async (search) => {
  if (!search || search.length < 2 || !tenantId.value) return
  searchingCustomer.value = true
  const r = await customersService.searchCustomers(tenantId.value, search)
  customerResults.value = r.success ? r.data : []
  searchingCustomer.value = false
}

// Receptor Fiscal (FE) - busca en third_parties (clientes / ambos)
const searchThirdParty = async (search) => {
  if (!search || search.length < 2) return
  searchingThirdParty.value = true
  try {
    const data = await thirdPartiesService.list({ search, type: 'customer', limit: 15 })
    thirdPartyResults.value = data
  } catch { thirdPartyResults.value = [] }
  searchingThirdParty.value = false
}

// Pagos
const isPaymentCash = (methodCode) => {
  // Verifica si el método de pago es efectivo
  // Soporta: CASH, EFECTIVO, EFE, CASH_COP, etc.
  const code = (methodCode || '').toUpperCase()
  return code === 'CASH' || code === 'EFECTIVO' || code.includes('EFECT') || code.includes('EFE')
}

const setQuickAmount = (index, amount) => {
  if (payments.value[index]) {
    payments.value[index].amount = amount
    // Forzar actualización reactiva
    payments.value = [...payments.value]
  }
}

const addPayment = () => { payments.value.push({ method: paymentMethods.value[0]?.code || '', amount: remaining.value }) }
const removePayment = (i) => { payments.value.splice(i, 1) }

const readHeldSalesFromStorage = () => {
  if (typeof window === 'undefined') {
    heldSales.value = []
    return
  }
  const key = holdSalesStorageKey.value
  if (!key) {
    heldSales.value = []
    return
  }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      heldSales.value = []
      return
    }
    const parsed = JSON.parse(raw)
    heldSales.value = Array.isArray(parsed) ? parsed : []
  } catch {
    heldSales.value = []
  }
}

const persistHeldSales = () => {
  if (typeof window === 'undefined') return
  const key = holdSalesStorageKey.value
  if (!key) return
  localStorage.setItem(key, JSON.stringify(heldSales.value))
}

const formatHeldSaleDate = (isoValue) => {
  if (!isoValue) return ''
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date)
}

const getHeldSaleCustomerLabel = (held) => {
  return held?.customer?.full_name || 'Consumidor final'
}

const getHeldSaleItemsCount = (held) => {
  if (typeof held?.itemsCount === 'number') return held.itemsCount
  return (held?.cart || []).reduce((sum, line) => sum + (Number(line?.quantity) || 0), 0)
}

const buildVariantLabel = (line) => {
  if (!line) return null
  const productName = String(line.productName || '').trim()
  const variantName = String(line.variantName || '').trim()
  const sku = String(line.sku || '').trim()

  const name = [productName, variantName].filter(Boolean).join(' — ')
  if (name && sku) return `${name} (${sku})`
  if (name) return name
  if (sku) return sku
  return null
}

const humanizeSaleError = (message) => {
  const variantLabels = new Map(
    cart.value
      .filter((line) => line?.variant_id)
      .map((line) => [String(line.variant_id).toLowerCase(), buildVariantLabel(line)])
  )

  return humanizeAppError(message, {
    defaultMessage: 'Error al procesar venta',
    idLabels: variantLabels,
  })
}

const saveSaleOnHold = () => {
  if (cart.value.length === 0) return

  const snapshot = {
    id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    customer: selectedCustomer.value ? { ...selectedCustomer.value } : null,
    thirdParty: selectedThirdParty.value ? { ...selectedThirdParty.value } : null,
    cart: cart.value.map(line => ({ ...line })),
    payments: payments.value.map(payment => ({
      method: payment.method,
      amount: Number(payment.amount) || 0
    })),
    saleDateTime: saleDateTimeTouched.value ? saleDateTime.value : '',
    saleNote: saleNote.value || '',
    itemsCount: cart.value.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
  }

  const nextHeldSales = [snapshot, ...heldSales.value]
  heldSales.value = nextHeldSales.slice(0, MAX_HOLD_SALES)
  persistHeldSales()
  clearSale()
  showMsg('Venta guardada en espera', 'success')
}

const removeHeldSale = (heldSaleId) => {
  heldSales.value = heldSales.value.filter(held => held.id !== heldSaleId)
  persistHeldSales()
  showMsg('Venta en espera eliminada', 'info')
}

const resumeHeldSale = async (heldSaleId) => {
  const held = heldSales.value.find(item => item.id === heldSaleId)
  if (!held) return

  if (cart.value.length > 0) {
    const confirmReplace = window.confirm('Hay una venta en curso. ¿Deseas reemplazarla con la venta en espera?')
    if (!confirmReplace) return
  }

  cart.value = (held.cart || []).map(line => ({ ...line }))
  selectedCustomer.value = held.customer ? { ...held.customer } : null
  selectedThirdParty.value = held.thirdParty ? { ...held.thirdParty } : null
  payments.value = (held.payments && held.payments.length)
    ? held.payments.map(payment => ({ method: payment.method, amount: Number(payment.amount) || 0 }))
    : [{ method: paymentMethods.value[0]?.code || '', amount: 0 }]
  saleDateTimeTouched.value = Boolean(held.saleDateTime)
  saleDateTime.value = held.saleDateTime || ''
  saleNote.value = held.saleNote || ''
  chatOrderText.value = ''
  chatOrderSummary.value = null

  heldSales.value = heldSales.value.filter(item => item.id !== heldSaleId)
  persistHeldSales()

  await recalculate()
  showMsg('Venta en espera cargada', 'success')
}

watch(holdSalesStorageKey, () => {
  readHeldSalesFromStorage()
}, { immediate: true })

// Procesar venta
const processSale = async () => {
  if (cart.value.length === 0 || remaining.value > 0) return
  if (!tenantId.value || !userProfile.value) return

  // Validar pagos a crédito
  if (creditError.value) {
    showMsg(creditError.value, 'error')
    return
  }

  // Validar que haya una caja abierta
  if (!currentSession.value) {
    snackbarMessage.value = 'Debe abrir una caja antes de realizar ventas'
    snackbarColor.value = 'error'
    snackbar.value = true
    return
  }

  if (sessionExpired.value) {
    snackbarMessage.value = `La sesión lleva ${sessionAgeHours.value}h abierta. Cierra y reabre la caja.`
    snackbarColor.value = 'error'
    snackbar.value = true
    return
  }

  if (saleDateTimeError.value) {
    showMsg(saleDateTimeError.value, 'error')
    return
  }

  const discountsValidation = validateCartDiscounts()
  if (!discountsValidation.valid) {
    showMsg(discountsValidation.error, 'error')
    return
  }

  processing.value = true
  try {
    const lines = buildSalePayloadLines(cart.value)

    // Ajustar pagos: si hay cambio, reducir el monto del último pago al total exacto
    const adjustedPayments = [...payments.value]
    if (change.value > 0 && adjustedPayments.length > 0) {
      // Reducir el último pago en el monto del cambio
      const lastPayment = adjustedPayments[adjustedPayments.length - 1]
      lastPayment.amount = lastPayment.amount - change.value
    }

    const paymentsList = adjustedPayments.map(p => ({
      payment_method_code: p.method,
      amount: p.amount,
      reference: null
    }))

    const r = await salesService.createSale(tenantId.value, {
      location_id: currentSession.value?.cash_register?.location_id || null,
      cash_session_id: currentSession.value?.cash_session_id || null,
      customer_id:     selectedCustomer.value?.customer_id     || null,
      third_party_id:  selectedThirdParty.value?.third_party_id || null,
      sold_by: userProfile.value.user_id,
      sold_at: selectedSaleDate.value ? selectedSaleDate.value.toISOString() : null,
      lines,
      payments: paymentsList,
      note: saleNote.value || null
    })

    if (r.success) {
      showMsg('¡Venta registrada exitosamente!')

      // ── Registrar movimiento de crédito si aplica ────────────────
      if (hasCreditPayment.value && customerCreditInfo.value && r.data?.sale_id) {
        creditService.registerCreditSale(
          tenantId.value,
          customerCreditInfo.value.credit_account_id,
          r.data.sale_id,
          creditPaymentAmount.value,
          userProfile.value.user_id
        ).catch(err => console.warn('Error registrando crédito:', err))
      }

      // ── Facturación Electrónica (dual mode: fire-and-forget) ────────
      if (r.data?.sale_id) {
        const saleId = r.data.sale_id
        const feEnabled = electronicInvoicingEnabled.value
        // No bloquear el flujo POS; lanzar en background
        electronicInvoicingService.submitInvoice(saleId, tenantId.value, feEnabled)
          .then(feResult => {
            if (!feResult.success) {
              console.warn('Aviso FE:', feResult.error)
              // Mostrar aviso suave al cajero sin bloquear
              showMsg('Venta registrada. Aviso FE: ' + feResult.error, 'warning')
            } else if (feResult.mode === 'fe' && feResult.cufe) {
              showMsg('\u00a1Factura electrónica enviada al proveedor!', 'success')
            }
          })
          .catch(err => console.error('Error FE:', err))
      }
      // ─────────────────────────────────────────────────────────────
      clearSale()
    } else {
      showMsg(r.error, 'error')
    }
  } catch (error) {
    showMsg('Error al procesar venta', 'error')
  } finally {
    processing.value = false
  }
}

const clearSale = () => {
  cart.value = []
  selectedCustomer.value = null
  selectedThirdParty.value = null
  payments.value = [{ method: paymentMethods.value[0]?.code || '', amount: 0 }]
  saleDateTime.value = ''
  saleDateTimeTouched.value = false
  saleNote.value = ''
  chatOrderText.value = ''
  chatOrderSummary.value = null
  searchTerm.value = ''
  searchResults.value = []
}

watch(() => cart.value.length, () => {
  cartListPage.value = 1
})

watch(cartTotalPages, (total) => {
  if (cartListPage.value > total) cartListPage.value = total
})

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = color === 'error' ? humanizeSaleError(msg) : msg
  snackbarColor.value = color
  snackbar.value = true
}

// Inicialización
onMounted(async () => {
  if (!tenantId.value) return
  // Cargar métodos de pago (excluyendo LAYAWAY)
  const pm = await paymentMethodsService.getPaymentMethodsForDropdown(tenantId.value, 1, 100)
  if (pm.success) {
    paymentMethods.value = pm.data
    // Inicializar con el primer método disponible
    if (pm.data.length > 0) {
      payments.value = [{ method: pm.data[0].code, amount: 0 }]
    }
  }

  // Buscar sesión abierta del usuario
  // IMPORTANTE: Cajeros solo deben usar SU PROPIA sesión
  const regs = await cashService.getAllCashRegisters(tenantId.value)
  if (regs.success) {
    for (const reg of regs.data) {
      const s = await cashService.getOpenSession(tenantId.value, reg.cash_register_id)
      if (s.success && s.data) {
        // Verificar que la sesión pertenezca al usuario actual
        if (s.data.opened_by === userProfile.value?.user_id) {
          currentSession.value = { ...s.data, cash_register: reg }
          break
        }
      }
    }
    
    // Si no encontró su propia sesión, avisar al usuario
    if (!currentSession.value) {
      console.warn('⚠️ No hay sesión de caja abierta para este usuario')
    }
  }

  // Atajos de teclado
  window.addEventListener('keydown', handleKeyboardShortcuts)
  window.addEventListener('scroll', updateFloatingHeaderActions, { passive: true })
  window.addEventListener('resize', updateFloatingHeaderActions, { passive: true })
  nextTick(() => updateFloatingHeaderActions())
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboardShortcuts)
  window.removeEventListener('scroll', updateFloatingHeaderActions)
  window.removeEventListener('resize', updateFloatingHeaderActions)
})

// Atajos de teclado
const handleKeyboardShortcuts = (e) => {
  // Solo si no está en un input/textarea (excepto el search)
  const target = e.target
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
  const isSearchInput = target === searchInput.value?.$el?.querySelector('input')

  // F2: Focus en búsqueda
  if (e.key === 'F2') {
    e.preventDefault()
    searchInput.value?.focus()
    return
  }

  // F9: Cobrar (si está habilitado)
  if (e.key === 'F9') {
    e.preventDefault()
    if (cart.value.length > 0 && remaining.value === 0 && !processing.value) {
      processSale()
    }
    return
  }

  // F10: Limpiar venta
  if (e.key === 'F10') {
    e.preventDefault()
    if (cart.value.length > 0) {
      clearSale()
    }
    return
  }

  // Solo permitir shortcuts de montos si NO está en un input (excepto search)
  if (isInput && !isSearchInput) return

  // Ctrl+1-7: Botones rápidos de pago
  if (e.ctrlKey && ['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) {
    e.preventDefault()
    const amounts = [1000, 2000, 5000, 10000, 20000, 50000, 100000]
    const idx = parseInt(e.key) - 1
    setQuickAmount(0, amounts[idx])
    return
  }

  // Ctrl+E: Monto exacto
  if (e.ctrlKey && e.key.toLowerCase() === 'e') {
    e.preventDefault()
    setQuickAmount(0, totals.value.total)
    return
  }
}
</script>

<style scoped>
.pos-container {
  height: 100%;
}

.pos-main-row {
  align-items: flex-start;
}

.pos-header-card {
  position: sticky;
  top: calc(var(--v-layout-top, 64px) + 8px);
  z-index: 90;
  border: 1px solid rgba(94, 132, 244, 0.26);
  background: linear-gradient(115deg, rgba(12, 20, 41, 0.92), rgba(11, 18, 35, 0.86)) !important;
  backdrop-filter: blur(14px);
  box-shadow: 0 14px 28px rgba(6, 12, 26, 0.22);
}

.pos-panel {
  border: 1px solid rgba(94, 132, 244, 0.22);
  background: linear-gradient(145deg, rgba(14, 22, 43, 0.9), rgba(9, 16, 31, 0.92)) !important;
}

.pos-summary-col {
  display: flex;
  align-items: flex-start;
}

.pos-summary-card {
  width: 100%;
}

.pos-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.pos-header-actions__charge,
.pos-header-actions__clear {
  min-height: 38px;
}

.pos-header-actions__charge {
  min-width: 190px;
}

.pos-header-status {
  flex-shrink: 0;
}

:global(.ofir-shell--light) .pos-header-card {
  border-color: rgba(46, 92, 205, 0.2);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(242, 248, 255, 0.96)) !important;
  box-shadow: 0 12px 24px rgba(38, 76, 154, 0.12);
}

:global(.ofir-shell--light) .pos-panel {
  border-color: rgba(46, 92, 205, 0.16);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.97), rgba(246, 250, 255, 0.95)) !important;
}

.pos-container :deep(.v-field) {
  border-radius: 12px;
}

.pos-container :deep(.v-field__input) {
  font-weight: 500;
}

.pos-container :deep(.v-btn) {
  border-radius: 10px;
  letter-spacing: 0.3px;
  font-weight: 700;
}

.pos-container :deep(.v-table thead th) {
  font-size: 0.78rem;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.pos-container :deep(.v-table tbody tr:hover) {
  background: rgba(63, 105, 228, 0.11);
}

.cursor-pointer:hover {
  background-color: rgba(63, 105, 228, 0.11);
  cursor: pointer;
}

.held-sale-card {
  border-radius: 12px;
  border-color: rgba(98, 139, 255, 0.24) !important;
}

:global(.ofir-shell--dark) .held-sale-card {
  background: linear-gradient(130deg, rgba(14, 23, 45, 0.74), rgba(9, 17, 33, 0.7));
  border-color: rgba(98, 139, 255, 0.3) !important;
}

.pos-cart-list :deep(.ofir-list-view__title) {
  padding-top: 10px;
  padding-bottom: 10px;
}

.pos-cart-list :deep(.ofir-list-view__item) {
  padding-top: 8px;
  padding-bottom: 8px;
}

.pos-cart-line-grid {
  display: grid;
  grid-template-columns: minmax(86px, 110px) minmax(90px, 1fr) minmax(100px, 1fr);
  gap: 10px;
  align-items: end;
}

.pos-cart-line-grid--admin {
  grid-template-columns: minmax(86px, 110px) minmax(90px, 1fr) minmax(100px, 1fr) minmax(240px, 300px);
}

.pos-cart-field__label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.35px;
  opacity: 0.86;
  margin-bottom: 4px;
}

.pos-cart-field__value {
  font-size: 0.9rem;
  font-weight: 600;
}

.pos-cart-input-qty {
  max-width: 90px;
}

.pos-cart-discount-type {
  min-width: 76px;
  flex-shrink: 0;
}

.pos-cart-discount-controls {
  width: 100%;
}

.pos-cart-discount-value {
  flex: 1 1 140px;
  min-width: 140px;
  max-width: 170px;
}

.pos-floating-actions {
  position: fixed;
  top: auto;
  bottom: calc(var(--v-layout-bottom, 0px) + 16px);
  right: 20px;
  z-index: 120;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(96, 134, 255, 0.22);
  background: linear-gradient(145deg, rgba(9, 17, 33, 0.96), rgba(7, 14, 27, 0.94));
  backdrop-filter: blur(16px);
  box-shadow: 0 18px 36px rgba(2, 7, 20, 0.34);
}

.pos-floating-actions__charge {
  min-width: 180px;
}

.pos-floating-actions__status {
  flex-shrink: 0;
}

.pos-floating-actions-enter-active,
.pos-floating-actions-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.pos-floating-actions-enter-from,
.pos-floating-actions-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Total sticky en desktop */
@media (min-width: 960px) {
  .totals-sticky {
    position: relative;
    z-index: 1;
    box-shadow: 0 8px 16px rgba(16, 24, 40, 0.12);
    border: 1px solid rgba(88, 123, 223, 0.18);
    border-radius: 12px;
  }

  :global(.ofir-shell--dark) .totals-sticky {
    background: linear-gradient(130deg, rgba(14, 23, 46, 0.95), rgba(9, 16, 31, 0.92));
    box-shadow: 0 10px 22px rgba(4, 9, 21, 0.34);
    border-color: rgba(92, 128, 234, 0.28);
  }

  :global(.ofir-shell--light) .totals-sticky {
    background: rgba(var(--v-theme-surface), 0.94);
  }

  :global(.ofir-shell--light) .pos-floating-actions {
    border-color: rgba(46, 92, 205, 0.18);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(241, 247, 255, 0.95));
    box-shadow: 0 16px 30px rgba(35, 73, 146, 0.16);
  }
}

@media (max-width: 600px) {
  .pos-floating-actions {
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
    padding: 10px;
  }

  .pos-floating-actions__charge,
  .pos-floating-actions__clear {
    width: 100%;
    min-width: 0;
  }

  .pos-floating-actions__status {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .held-sale-card :deep(.v-btn) {
    flex: 1;
  }

  .pos-header-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    justify-content: stretch;
  }

  .pos-header-status {
    order: -1;
    justify-self: start;
  }

  .pos-header-actions__charge,
  .pos-header-actions__clear {
    width: 100%;
    min-width: 0;
  }
}

@media (max-width: 959px) {
  .pos-floating-actions {
    left: 16px;
    right: 16px;
    bottom: 16px;
    justify-content: space-between;
  }

  .pos-floating-actions__charge,
  .pos-floating-actions__clear {
    flex: 1 1 0;
    min-width: 0;
  }

  .pos-cart-line-grid,
  .pos-cart-line-grid--admin {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pos-cart-line-grid--admin .pos-cart-field:last-child {
    grid-column: 1 / -1;
  }

  .pos-cart-discount-value {
    max-width: none;
  }

  .pos-header-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-content: stretch;
    align-items: center;
  }

  .pos-header-actions__charge,
  .pos-header-actions__clear {
    flex: 1 1 0;
    min-width: 0;
  }

  .pos-header-status {
    grid-column: 1 / -1;
    order: -1;
    justify-self: start;
  }
}
</style>
