<template>
  <div class="ofir-page purchases-page">
    <!-- Botones de acciones - Responsive -->
    <v-row dense class="mb-3 purchases-actions">
      <v-col cols="12" sm="auto">
        <v-btn 
          color="primary" 
          prepend-icon="mdi-cart-plus" 
          @click="openCreateDialog"
          :block="isMobile"
        >
          Nueva Compra
        </v-btn>
      </v-col>
      <v-col cols="12" sm="auto">
        <v-btn
          color="indigo"
          prepend-icon="mdi-clipboard-list"
          variant="tonal"
          @click="openPurchaseOrdersDialog"
          :loading="loadingPurchaseOrders"
          :block="isMobile"
        >
          OC Pendientes
          <v-badge v-if="pendingPurchaseOrdersCount > 0" color="warning" :content="pendingPurchaseOrdersCount" inline></v-badge>
        </v-btn>
      </v-col>
      <v-col cols="12" sm="auto">
        <v-btn
          color="deep-orange"
          prepend-icon="mdi-file-document-multiple"
          variant="tonal"
          @click="openSupplierPayablesDialog"
          :loading="loadingSupplierPayablesBoard"
          :block="isMobile"
        >
          CxP Proveedores
          <v-badge v-if="supplierPayablesOpenCount > 0" color="error" :content="supplierPayablesOpenCount" inline></v-badge>
        </v-btn>
      </v-col>
      <v-col cols="12" sm="auto">
        <v-btn 
          color="purple" 
          prepend-icon="mdi-lightbulb-on" 
          variant="tonal" 
          @click="openSuggestionsDialog" 
          :loading="loadingSuggestions"
          :block="isMobile"
        >
          Sugerencias IA
          <v-badge v-if="criticalCount > 0" color="error" :content="criticalCount" inline></v-badge>
        </v-btn>
      </v-col>
      <v-col v-if="aiAvailable" cols="12" sm="auto">
        <v-btn 
          color="deep-purple" 
          prepend-icon="mdi-robot" 
          variant="elevated" 
          @click="openAIAnalysisDialog" 
          :loading="loadingAIAnalysis"
          :block="isMobile"
        >
          Análisis IA Avanzado
          <v-chip v-if="aiAnalysis" size="x-small" color="success" class="ml-2">✓</v-chip>
        </v-btn>
      </v-col>
    </v-row>

    <ContextHelpCard
      class="mb-4"
      context-key="purchases"
    />

    <ListView
      title="Compras"
      icon="mdi-cart-plus"
      :items="purchases"
      :total-items="totalPurchases"
      :loading="loading"
      :page-size="defaultPageSize"
      item-key="purchase_id"
      avatar-icon="mdi-truck-delivery"
      avatar-color="teal"
      empty-message="No hay compras registradas"
      :show-create-button="false"
      :editable="false"
      :deletable="false"
      :clickable="true"
      @load-page="loadPurchasesPage"
      @search="handleSearch"
      @item-click="viewPurchaseDetail"
    >
      <!-- Filtros personalizados -->
      <template #filters>
        <v-row dense>
          <v-col cols="12" sm="6" md="3">
            <v-select
              v-model="selectedLocation"
              :items="locations"
              item-title="name"
              item-value="location_id"
              :label="t('app.branch')"
              prepend-inner-icon="mdi-store"
              variant="outlined"
              density="compact"
              clearable
              hide-details
              @update:model-value="loadPurchases"
            ></v-select>
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-text-field
              v-model="dateFrom"
              label="Fecha desde"
              type="date"
              prepend-inner-icon="mdi-calendar"
              variant="outlined"
              density="compact"
              clearable
              hide-details
              @update:model-value="loadPurchases"
            ></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-text-field
              v-model="dateTo"
              label="Fecha hasta"
              type="date"
              prepend-inner-icon="mdi-calendar"
              variant="outlined"
              density="compact"
              clearable
              hide-details
              @update:model-value="loadPurchases"
            ></v-text-field>
          </v-col>
        </v-row>
      </template>

      <!-- Titulo del item -->
      <template #title="{ item }">
        {{ item.product_name }}{{ item.variant_name ? ' - ' + item.variant_name : '' }}
      </template>

      <!-- Subtitulo -->
      <template #subtitle="{ item }">
        {{ formatDate(item.purchased_at) }} � {{ item.purchased_by_name }} � {{ item.location_name }}
      </template>

      <!-- Contenido -->
      <template #content="{ item }">
        <div class="mt-2 d-flex flex-wrap ga-2">
          <v-chip size="small" variant="tonal" prepend-icon="mdi-barcode">SKU: {{ item.sku }}</v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-numeric" color="info">Cant: {{ item.quantity }}</v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-cash" color="primary">Costo: {{ formatMoney(item.unit_cost) }}</v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-currency-usd" color="success">Total: {{ formatMoney(item.line_total) }}</v-chip>
          <v-chip size="small" variant="tonal" prepend-icon="mdi-tag" color="orange">Precio: {{ formatMoney(item.current_price) }}</v-chip>
        </div>
        <div class="mt-2 text-caption text-grey">
          <v-icon size="small">mdi-cursor-default-click</v-icon>
          Haz clic para ver el detalle completo de la compra
        </div>
      </template>
    </ListView>

    <!-- Dialog CxP proveedores -->
    <v-dialog v-model="supplierPayablesDialog" max-width="1200" scrollable>
      <v-card class="purchase-modal supplier-payables-dialog">
        <v-card-title class="purchase-modal__header purchase-modal__header--orange supplier-payables-header">
          <v-icon start color="white">mdi-file-document-multiple</v-icon>
          <span class="text-white">Cuentas por Pagar a Proveedores</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-row dense class="mb-3 supplier-payables-filters">
            <v-col cols="12" md="4">
              <v-select
                v-model="supplierPayablesStatusFilter"
                :items="supplierPayablesStatusOptions"
                item-title="label"
                item-value="value"
                label="Estado"
                density="compact"
                variant="outlined"
                @update:model-value="applySupplierPayablesFilters"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="supplierPayablesDueFilter"
                :items="supplierPayablesDueOptions"
                item-title="label"
                item-value="value"
                label="Vencimiento"
                density="compact"
                variant="outlined"
                @update:model-value="applySupplierPayablesFilters"
              />
            </v-col>
            <v-col cols="12" md="4" class="d-flex align-center justify-end" style="gap: 8px; flex-wrap: wrap;">
              <v-btn
                color="success"
                variant="tonal"
                prepend-icon="mdi-cash-multiple"
                :disabled="selectedSupplierPayablesRows.length === 0"
                @click="openBulkSupplierPaymentDialog"
                class="mr-2"
              >
                Pagar seleccionadas
              </v-btn>
              <v-btn
                color="primary"
                variant="text"
                size="small"
                @click="toggleSelectAllSupplierPayables(!allSupplierPayablesSelected)"
              >
                {{ allSupplierPayablesSelected ? 'Limpiar selecci�n' : 'Seleccionar todas' }}
              </v-btn>
              <v-chip color="warning" variant="tonal" class="mr-2">
                Abiertas: {{ supplierPayablesOpenCount }}
              </v-chip>
              <v-chip color="error" variant="tonal">
                Vencidas: {{ supplierPayablesOverdueCount }}
              </v-chip>
            </v-col>
          </v-row>

          <ListView
            title="Listado CxP"
            icon="mdi-file-document-multiple"
            :items="supplierPayablesBoard"
            :total-items="supplierPayablesTotal"
            :loading="loadingSupplierPayablesBoard"
            :searchable="false"
            :page-size="supplierPayablesPageSize"
            item-key="payable_id"
            :show-create-button="false"
            :editable="false"
            :deletable="false"
            :clickable="false"
            empty-message="No hay cuentas por pagar para los filtros seleccionados"
            empty-icon="mdi-check-circle"
            @load-page="loadSupplierPayablesPage"
          >
            <template #avatar="{ item }">
              <div class="d-flex align-center justify-center" style="width: 32px;">
                <v-checkbox-btn
                  :model-value="supplierPayablesSelectedIds.includes(item.payable_id)"
                  :disabled="!isSupplierPayableSelectable(item)"
                  @update:model-value="val => toggleSupplierPayableSelection(item.payable_id, val)"
                />
              </div>
            </template>
            <template #title="{ item }">
              <div class="d-flex align-center justify-space-between flex-wrap" style="gap: 8px;">
                <span class="font-weight-bold text-body-1">{{ item.supplier_name || 'Proveedor' }}</span>
                <v-chip size="small" :color="payableStatusColor(item.status)" variant="tonal" class="text-no-wrap">
                  {{ payableStatusLabel(item.status) }}
                </v-chip>
              </div>
            </template>
            <template #subtitle="{ item }">
              {{ item.location_name || 'Sin sede' }} � Factura: {{ item.invoice_number || 'Sin numero' }}
            </template>
            <template #content="{ item }">
              <div class="mt-2 d-flex flex-wrap ga-2">
                <v-chip size="small" variant="tonal" color="error">Saldo: {{ formatMoney(item.balance) }}</v-chip>
                <v-chip size="small" variant="tonal" color="success">Pagado: {{ formatMoney(item.paid_amount) }}</v-chip>
                <v-chip size="small" variant="tonal">Vence: {{ item.due_date ? formatDate(item.due_date) : 'Sin fecha' }}</v-chip>
                <v-chip v-if="item.is_overdue" size="small" color="error" variant="flat">Vencida</v-chip>
                <v-chip v-else-if="item.days_to_due !== null" size="small" color="warning" variant="tonal">
                  En {{ item.days_to_due }} dias
                </v-chip>
              </div>
              <div class="mt-2 d-flex justify-end">
                <v-btn size="small" color="primary" variant="text" @click="openPurchaseDetailByPurchaseId(item.purchase_id)">
                  Ver compra
                </v-btn>
              </div>
            </template>
          </ListView>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="supplierPayablesDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="bulkSupplierPaymentDialog" max-width="620">
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--success">
          <v-icon start color="white">mdi-cash-multiple</v-icon>
          <span class="text-white">Pago masivo de CxP</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-alert type="info" variant="tonal" class="mb-3">
            Se registrar� un abono por el saldo total de cada cuenta seleccionada.
          </v-alert>

          <v-row dense>
            <v-col cols="12" md="6">
              <div class="text-caption text-grey">Cuentas seleccionadas</div>
              <div class="text-h6">{{ selectedSupplierPayablesRows.length }}</div>
            </v-col>
            <v-col cols="12" md="6" class="text-right">
              <div class="text-caption text-grey">Total a pagar</div>
              <div class="text-h6 text-success">{{ formatMoney(selectedSupplierPayablesTotal) }}</div>
            </v-col>
          </v-row>

          <v-text-field
            v-model="bulkSupplierPaymentForm.payment_method"
            label="M�todo de pago"
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-credit-card-outline"
            class="mt-3"
          />

          <v-textarea
            v-model="bulkSupplierPaymentForm.note"
            label="Nota (opcional)"
            variant="outlined"
            rows="2"
            auto-grow
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="bulkSupplierPaymentDialog = false" :disabled="savingBulkSupplierPayment">{{ t('common.cancel') }}</v-btn>
          <v-btn color="success" @click="confirmBulkSupplierPayment" :loading="savingBulkSupplierPayment">
            Confirmar pago masivo
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Sugerencias Inteligentes -->
    <v-dialog v-model="suggestionsDialog" max-width="1200" scrollable>
      <v-card class="purchase-modal purchase-suggestions-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--purple">
          <v-icon start color="white">mdi-lightbulb-on</v-icon>
          <span class="text-white">Sugerencias Inteligentes de Compra</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-alert v-if="loadingSuggestions" type="info" variant="tonal">
            Analizando inventario y patrones de venta...
          </v-alert>

          <v-tabs v-model="suggestionsTab" color="purple">
            <v-tab value="critical">Crítico ({{ suggestions.filter(s => s.priority === 1).length }})</v-tab>
            <v-tab value="high">Alto ({{ suggestions.filter(s => s.priority === 2).length }})</v-tab>
            <v-tab value="medium">Medio ({{ suggestions.filter(s => s.priority === 3).length }})</v-tab>
          </v-tabs>

          <v-window v-model="suggestionsTab" class="mt-4">
            <!-- CRÍTICO -->
            <v-window-item value="critical">
              <v-alert v-if="suggestions.filter(s => s.priority === 1).length === 0" type="success" variant="tonal" class="mb-4">
                ¡Excelente! No hay productos con prioridad crítica
              </v-alert>
              <v-card v-for="item in suggestions.filter(s => s.priority === 1)" :key="item.variant_id" variant="outlined" class="mb-2 purchase-suggestion-item">
                <v-card-text>
                  <v-row align="center">
                    <v-col cols="12" md="5">
                      <div class="text-h6">{{ item.product_name }}</div>
                      <div class="text-caption text-grey">{{ item.variant_name || 'Sin variante' }} • SKU: {{ item.sku }}</div>
                      <v-chip size="x-small" color="error" class="mt-1">{{ item.priority_label }}</v-chip>
                    </v-col>
                    <v-col cols="12" md="4">
                      <div class="text-body-2"><strong>Razón:</strong> {{ item.reason }}</div>
                      <div class="text-caption">Stock actual: <strong>{{ item.current_stock }}</strong></div>
                      <div class="text-caption">Demanda diaria: <strong>{{ item.avg_daily_demand }}</strong> unidades</div>
                      <div class="text-caption">Vendido (30d): <strong>{{ item.sold_last_30d }}</strong> unidades</div>
                    </v-col>
                    <v-col cols="12" md="3" class="text-right">
                      <div class="text-h6 text-primary">{{ item.suggested_order_qty }} unidades</div>
                      <div class="text-caption">Costo estimado: {{ formatMoney(item.estimated_cost) }}</div>
                      <v-btn size="small" color="primary" class="mt-2" @click="addSuggestionToCart(item)">
                        Agregar a Compra
                      </v-btn>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>
            </v-window-item>

            <!-- ALTO -->
            <v-window-item value="high">
              <v-alert v-if="suggestions.filter(s => s.priority === 2).length === 0" type="success" variant="tonal" class="mb-4">
                No hay productos con prioridad alta
              </v-alert>
              <v-card v-for="item in suggestions.filter(s => s.priority === 2)" :key="item.variant_id" variant="outlined" class="mb-2 purchase-suggestion-item">
                <v-card-text>
                  <v-row align="center">
                    <v-col cols="12" md="5">
                      <div class="text-h6">{{ item.product_name }}</div>
                      <div class="text-caption text-grey">{{ item.variant_name || 'Sin variante' }} • SKU: {{ item.sku }}</div>
                      <v-chip size="x-small" color="warning" class="mt-1">{{ item.priority_label }}</v-chip>
                    </v-col>
                    <v-col cols="12" md="4">
                      <div class="text-body-2"><strong>Razón:</strong> {{ item.reason }}</div>
                      <div class="text-caption">Stock actual: <strong>{{ item.current_stock }}</strong></div>
                      <div class="text-caption">Días de stock: <strong>{{ item.days_of_stock }}</strong></div>
                      <div class="text-caption">Demanda diaria: <strong>{{ item.avg_daily_demand }}</strong></div>
                    </v-col>
                    <v-col cols="12" md="3" class="text-right">
                      <div class="text-h6 text-primary">{{ item.suggested_order_qty }} unidades</div>
                      <div class="text-caption">Costo estimado: {{ formatMoney(item.estimated_cost) }}</div>
                      <v-btn size="small" color="primary" class="mt-2" @click="addSuggestionToCart(item)">
                        Agregar a Compra
                      </v-btn>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>
            </v-window-item>

            <!-- MEDIO -->
            <v-window-item value="medium">
              <v-alert v-if="suggestions.filter(s => s.priority === 3).length === 0" type="info" variant="tonal" class="mb-4">
                No hay productos con prioridad media
              </v-alert>
              <v-card v-for="item in suggestions.filter(s => s.priority === 3)" :key="item.variant_id" variant="outlined" class="mb-2 purchase-suggestion-item">
                <v-card-text>
                  <v-row align="center">
                    <v-col cols="12" md="5">
                      <div class="text-h6">{{ item.product_name }}</div>
                      <div class="text-caption text-grey">{{ item.variant_name || 'Sin variante' }} • SKU: {{ item.sku }}</div>
                      <v-chip size="x-small" color="info" class="mt-1">{{ item.priority_label }}</v-chip>
                    </v-col>
                    <v-col cols="12" md="4">
                      <div class="text-body-2"><strong>Razón:</strong> {{ item.reason }}</div>
                      <div class="text-caption">Stock actual: <strong>{{ item.current_stock }}</strong></div>
                      <div class="text-caption">Días de stock: <strong>{{ item.days_of_stock }}</strong></div>
                    </v-col>
                    <v-col cols="12" md="3" class="text-right">
                      <div class="text-h6 text-primary">{{ item.suggested_order_qty }} unidades</div>
                      <div class="text-caption">Costo estimado: {{ formatMoney(item.estimated_cost) }}</div>
                      <v-btn size="small" color="primary" class="mt-2" @click="addSuggestionToCart(item)">
                        Agregar a Compra
                      </v-btn>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>
            </v-window-item>
          </v-window>

          <!-- Resumen total -->
          <v-card v-if="suggestions.length > 0" color="purple" variant="tonal" class="mt-4 purchase-suggestions-summary">
            <v-card-text>
              <v-row>
                <v-col cols="12" md="3">
                  <div class="text-caption">Total productos sugeridos</div>
                  <div class="text-h5">{{ suggestions.length }}</div>
                </v-col>
                <v-col cols="12" md="3">
                  <div class="text-caption">Total unidades</div>
                  <div class="text-h5">{{ suggestions.reduce((sum, s) => sum + s.suggested_order_qty, 0) }}</div>
                </v-col>
                <v-col cols="12" md="3">
                  <div class="text-caption">Inversión estimada</div>
                  <div class="text-h5">{{ formatMoney(suggestions.reduce((sum, s) => sum + s.estimated_cost, 0)) }}</div>
                </v-col>
                <v-col cols="12" md="3" class="text-right">
                  <v-btn color="primary" prepend-icon="mdi-cart-plus" @click="createPurchaseFromSuggestions">
                    Crear Orden de Compra
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="suggestionsDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Análisis IA Avanzado -->
    <v-dialog v-model="aiAnalysisDialog" max-width="1400" scrollable>
      <v-card class="purchase-modal purchase-ai-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--deep-purple d-flex align-center">
          <v-icon start color="white">mdi-robot</v-icon>
          <span class="text-white">Análisis IA Avanzado - DeepSeek</span>
          <v-spacer></v-spacer>
          <v-chip v-if="aiAnalysis && aiAnalysis.from_cache" color="blue" size="small" variant="flat" class="mr-2">
            <v-icon start size="small">mdi-cached</v-icon>
            Caché
          </v-chip>
          <v-tooltip text="Forzar actualización (consultar API nuevamente)">
            <template v-slot:activator="{ props }">
              <v-btn 
                v-bind="props" 
                icon="mdi-refresh" 
                size="small" 
                variant="text"
                color="white"
                @click="refreshAIAnalysis"
                :loading="loadingAIAnalysis"
              ></v-btn>
            </template>
          </v-tooltip>
        </v-card-title>
        <v-card-text class="pa-4">
          <!-- Loading State -->
          <v-alert v-if="loadingAIAnalysis" type="info" variant="tonal" class="mb-4">
            <v-progress-linear indeterminate color="deep-purple"></v-progress-linear>
            <div class="mt-2">Analizando patrones de venta, tendencias y demanda con IA...</div>
            <div class="text-caption">Esto puede tomar 10-30 segundos</div>
          </v-alert>

          <!-- Error State -->
          <v-alert v-if="aiAnalysisError" type="error" variant="tonal" closable @click:close="aiAnalysisError = null" class="mb-4">
            {{ aiAnalysisError }}
          </v-alert>

          <!-- AI Analysis Results -->
          <div v-if="aiAnalysis && !loadingAIAnalysis">
            <!-- Resumen Ejecutivo -->
            <v-card color="deep-purple" variant="tonal" class="mb-4 purchase-ai-executive">
              <v-card-title>📊 Resumen Ejecutivo</v-card-title>
              <v-card-text>
                <v-row>
                  <v-col cols="12" md="3">
                    <v-card variant="elevated" class="purchase-ai-kpi">
                      <v-card-text class="text-center">
                        <div class="text-h3 text-error">{{ aiAnalysis.executive_summary.critical_products_count }}</div>
                        <div class="text-caption">Productos Críticos</div>
                      </v-card-text>
                    </v-card>
                  </v-col>
                  <v-col cols="12" md="3">
                    <v-card variant="elevated" class="purchase-ai-kpi">
                      <v-card-text class="text-center">
                        <div class="text-h3 text-success">{{ aiAnalysis.executive_summary.high_confidence_count }}</div>
                        <div class="text-caption">Alta Confianza IA</div>
                      </v-card-text>
                    </v-card>
                  </v-col>
                  <v-col cols="12" md="3">
                    <v-card variant="elevated" class="purchase-ai-kpi">
                      <v-card-text class="text-center">
                        <div class="text-h3 text-primary">{{ formatMoney(aiAnalysis.executive_summary.total_investment) }}</div>
                        <div class="text-caption">Inversión Estimada</div>
                      </v-card-text>
                    </v-card>
                  </v-col>
                  <v-col cols="12" md="3">
                    <v-card variant="elevated" color="purple" class="purchase-ai-kpi purchase-ai-kpi--highlight">
                      <v-card-text class="text-center text-white">
                        <v-icon size="large">mdi-lightbulb-on</v-icon>
                        <div class="text-caption mt-2">Recomendación Principal</div>
                      </v-card-text>
                    </v-card>
                  </v-col>
                </v-row>
                <v-alert type="info" variant="tonal" class="mt-4">
                  <strong>{{ aiAnalysis.executive_summary.recommendation }}</strong>
                </v-alert>
              </v-card-text>
            </v-card>

            <!-- Insights Estratégicos -->
            <v-card v-if="aiAnalysis.insights && aiAnalysis.insights.length > 0" class="mb-4 purchase-ai-section">
              <v-card-title>💡 Insights Estratégicos</v-card-title>
              <v-card-text>
                <v-expansion-panels>
                  <v-expansion-panel v-for="(insight, idx) in aiAnalysis.insights" :key="idx">
                    <v-expansion-panel-title>
                      <div class="d-flex align-center ga-2">
                        <v-icon 
                          :color="insight.type === 'opportunity' ? 'success' : insight.type === 'risk' ? 'warning' : 'info'"
                        >
                          {{ insight.type === 'opportunity' ? 'mdi-trending-up' : insight.type === 'risk' ? 'mdi-alert' : 'mdi-chart-line' }}
                        </v-icon>
                        <span>{{ insight.title }}</span>
                        <v-chip 
                          size="x-small" 
                          :color="insight.impact === 'high' ? 'error' : insight.impact === 'medium' ? 'warning' : 'info'"
                        >
                          {{ insight.impact }}
                        </v-chip>
                      </div>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      {{ insight.description }}
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-card-text>
            </v-card>

            <!-- Advertencias -->
            <v-card v-if="aiAnalysis.warnings && aiAnalysis.warnings.length > 0" class="mb-4 purchase-ai-section">
              <v-card-title>⚠️ Advertencias Importantes</v-card-title>
              <v-card-text>
                <v-alert
                  v-for="(warning, idx) in aiAnalysis.warnings"
                  :key="idx"
                  :type="warning.severity === 'critical' ? 'error' : 'warning'"
                  variant="tonal"
                  class="mb-2"
                >
                  <strong>{{ warning.product_name || 'General' }}:</strong> {{ warning.message }}
                </v-alert>
              </v-card-text>
            </v-card>

            <!-- Consejos de Optimización -->
            <v-card v-if="aiAnalysis.optimization_tips && aiAnalysis.optimization_tips.length > 0" class="mb-4 purchase-ai-section">
              <v-card-title>🎯 Consejos de Optimización</v-card-title>
              <v-card-text>
                <v-list>
                  <v-list-item
                    v-for="(tip, idx) in aiAnalysis.optimization_tips"
                    :key="idx"
                    prepend-icon="mdi-lightbulb-outline"
                  >
                    <v-list-item-title>{{ tip.title }}</v-list-item-title>
                    <v-list-item-subtitle>{{ tip.description }}</v-list-item-subtitle>
                    <template v-if="tip.expected_benefit" #append>
                      <v-chip size="small" color="success">{{ tip.expected_benefit }}</v-chip>
                    </template>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>

            <!-- Sugerencias Mejoradas con IA -->
            <v-card class="purchase-ai-section">
              <v-card-title>🤖 Sugerencias Mejoradas con IA</v-card-title>
              <v-card-text>
                <v-tabs v-model="aiSuggestionsTab" color="deep-purple">
                  <v-tab value="all">Todas ({{ aiAnalysis.suggestions.filter(s => s.has_ai_analysis).length }})</v-tab>
                  <v-tab value="critical">Críticas ({{ aiAnalysis.suggestions.filter(s => s.ai_priority === 1 || s.priority === 1).length }})</v-tab>
                  <v-tab value="high-confidence">Alta Confianza ({{ aiAnalysis.suggestions.filter(s => (s.ai_confidence || 0) > 0.8).length }})</v-tab>
                </v-tabs>

                <v-window v-model="aiSuggestionsTab" class="mt-4">
                  <!-- Todas -->
                  <v-window-item value="all">
                    <div v-if="aiAnalysis.suggestions.filter(s => s.has_ai_analysis).length === 0" class="text-center pa-4 text-grey">
                      No hay sugerencias con análisis IA
                    </div>
                    <v-card
                      v-for="item in aiAnalysis.suggestions.filter(s => s.has_ai_analysis).slice(0, 20)"
                      :key="item.variant_id"
                      variant="outlined"
                      class="mb-2 purchase-ai-suggestion-item"
                    >
                      <v-card-text>
                        <v-row align="center">
                          <v-col cols="12" md="4">
                            <div class="text-h6">{{ item.product_name }}</div>
                            <div class="text-caption text-grey">{{ item.variant_name || 'Sin variante' }} • SKU: {{ item.sku }}</div>
                            <div class="d-flex ga-1 mt-2">
                              <v-chip size="x-small" :color="getPriorityColor(item.ai_priority || item.priority)">
                                Prioridad: {{ item.ai_priority || item.priority }}
                              </v-chip>
                              <v-chip v-if="item.ai_confidence" size="x-small" :color="getConfidenceColor(item.ai_confidence)">
                                Confianza: {{ Math.round(item.ai_confidence * 100) }}%
                              </v-chip>
                            </div>
                          </v-col>
                          <v-col cols="12" md="5">
                            <div class="text-body-2 mb-2"><strong>Análisis IA:</strong></div>
                            <div class="text-caption">{{ item.ai_reasoning || item.reason }}</div>
                            <div v-if="item.ai_estimated_roi_days" class="text-caption mt-2">
                              <v-icon size="small" color="success">mdi-cash-fast</v-icon>
                              ROI estimado: {{ item.ai_estimated_roi_days }} días
                            </div>
                          </v-col>
                          <v-col cols="12" md="3" class="text-right">
                            <div class="text-caption text-grey">Sistema: {{ item.suggested_order_qty }}</div>
                            <div class="text-h6 text-deep-purple">IA: {{ item.ai_suggested_qty || item.suggested_order_qty }} unidades</div>
                            <div class="text-caption">{{ formatMoney((item.ai_suggested_qty || item.suggested_order_qty) * item.unit_cost) }}</div>
                            <v-btn size="small" color="deep-purple" class="mt-2" @click="addAISuggestionToCart(item)">
                              Agregar a Compra
                            </v-btn>
                          </v-col>
                        </v-row>
                      </v-card-text>
                    </v-card>
                  </v-window-item>

                  <!-- Críticas -->
                  <v-window-item value="critical">
                    <v-card
                      v-for="item in aiAnalysis.suggestions.filter(s => s.ai_priority === 1 || s.priority === 1)"
                      :key="item.variant_id"
                      variant="outlined"
                      class="mb-2 border-error purchase-ai-suggestion-item"
                    >
                      <v-card-text>
                        <v-row align="center">
                          <v-col cols="12" md="6">
                            <div class="text-h6">{{ item.product_name }}</div>
                            <div class="text-caption">{{ item.ai_reasoning || item.reason }}</div>
                          </v-col>
                          <v-col cols="12" md="3">
                            <div class="text-h6 text-error">{{ item.ai_suggested_qty || item.suggested_order_qty }} unidades</div>
                            <div class="text-caption">{{ formatMoney((item.ai_suggested_qty || item.suggested_order_qty) * item.unit_cost) }}</div>
                          </v-col>
                          <v-col cols="12" md="3" class="text-right">
                            <v-btn size="small" color="error" @click="addAISuggestionToCart(item)">
                              Agregar Urgente
                            </v-btn>
                          </v-col>
                        </v-row>
                      </v-card-text>
                    </v-card>
                  </v-window-item>

                  <!-- Alta Confianza -->
                  <v-window-item value="high-confidence">
                    <v-card
                      v-for="item in aiAnalysis.suggestions.filter(s => (s.ai_confidence || 0) > 0.8)"
                      :key="item.variant_id"
                      variant="outlined"
                      class="mb-2 purchase-ai-suggestion-item"
                    >
                      <v-card-text>
                        <v-row align="center">
                          <v-col cols="12" md="6">
                            <div class="text-h6">{{ item.product_name }}</div>
                            <div class="text-caption">{{ item.ai_reasoning || item.reason }}</div>
                            <v-chip size="x-small" color="success" class="mt-1">
                              Confianza: {{ Math.round(item.ai_confidence * 100) }}%
                            </v-chip>
                          </v-col>
                          <v-col cols="12" md="3">
                            <div class="text-h6 text-success">{{ item.ai_suggested_qty || item.suggested_order_qty }} unidades</div>
                          </v-col>
                          <v-col cols="12" md="3" class="text-right">
                            <v-btn size="small" color="success" @click="addAISuggestionToCart(item)">
                              Agregar
                            </v-btn>
                          </v-col>
                        </v-row>
                      </v-card-text>
                    </v-card>
                  </v-window-item>
                </v-window>
              </v-card-text>
            </v-card>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="aiAnalysis" color="deep-purple" prepend-icon="mdi-refresh" @click="refreshAIAnalysis">
            Actualizar Análisis
          </v-btn>
          <v-spacer></v-spacer>
          <v-btn @click="aiAnalysisDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Nueva Compra -->
    <v-dialog v-model="dialog" max-width="800" scrollable>
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header">
          <v-icon start>mdi-cart-plus</v-icon>
          Nueva Compra
        </v-card-title>
        <v-card-text>
          <v-form ref="form" @submit.prevent="savePurchase">
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="purchaseData.location_id"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  :label="t('app.branch')"
                  prepend-inner-icon="mdi-store"
                  variant="outlined"
                  :rules="[rules.required]"
                ></v-select>
              </v-col>
              <v-col cols="12" md="6">
                <v-autocomplete
                  v-model="purchaseData.supplier_id"
                  :items="suppliers"
                  item-title="legal_name"
                  item-value="third_party_id"
                  label="Proveedor"
                  prepend-inner-icon="mdi-truck"
                  variant="outlined"
                  clearable
                  :loading="suppliersLoading"
                  :no-data-text="'Sin proveedores'"
                  @update:search="loadSuppliers"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props" :subtitle="item.raw.document_number || ''">
                    </v-list-item>
                  </template>
                </v-autocomplete>
              </v-col>
              <v-col cols="12" md="12">
                <v-text-field
                  v-model="purchaseData.note"
                  label="Nota (opcional)"
                  prepend-inner-icon="mdi-note-text"
                  variant="outlined"
                ></v-text-field>
              </v-col>
            </v-row>

            <!-- Líneas de compra -->
            <v-divider class="my-4"></v-divider>
            <div class="d-flex align-center mb-2">
              <span class="text-subtitle-1 font-weight-bold">Productos</span>
              <v-spacer></v-spacer>
              <v-btn size="small" color="primary" prepend-icon="mdi-plus" variant="tonal" @click="addLine">Agregar</v-btn>
            </div>

            <v-card v-for="(line, i) in purchaseData.lines" :key="i" variant="outlined" class="mb-2">
              <v-card-text>
                <v-row dense>
                  <v-col cols="12" sm="6">
                    <v-autocomplete
                      v-model="line.variant_id"
                      :items="variants"
                      :loading="searchingVariants"
                      item-title="_displayName"
                      item-value="variant_id"
                      label="Producto"
                      prepend-inner-icon="mdi-package-variant"
                      variant="outlined"
                      density="compact"
                      :rules="[rules.required]"
                      @update:model-value="value => onVariantSelected(i, value)"
                      @update:search="searchVariants"
                    >
                      <template #item="{ props, item }">
                        <v-list-item v-bind="props" :subtitle="'SKU: ' + item.raw.sku">
                          <template #append>
                            <v-icon v-if="item.raw.requires_expiration" color="warning" size="small">mdi-calendar-alert</v-icon>
                          </template>
                        </v-list-item>
                      </template>
                    </v-autocomplete>
                  </v-col>
                  <v-col cols="12" sm="2">
                    <v-text-field
                      v-model.number="line.qty"
                      label="Cantidad"
                      type="number"
                      prepend-inner-icon="mdi-numeric"
                      variant="outlined"
                      density="compact"
                      min="1"
                      :rules="[rules.required, rules.positive]"
                    ></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="3">
                    <v-text-field
                      v-model.number="line.unit_cost"
                      label="Costo Unitario"
                      type="number"
                      prepend-inner-icon="mdi-cash"
                      variant="outlined"
                      density="compact"
                      min="0"
                      step="0.01"
                      :rules="[rules.required, rules.positive]"
                    ></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="1" class="d-flex align-center">
                    <v-btn icon="mdi-delete" size="small" color="error" variant="text" @click="removeLine(i)"></v-btn>
                  </v-col>

                  <!-- Campos de lote si el producto requiere vencimiento -->
                  <v-col v-if="line.requires_expiration" cols="12">
                    <v-alert type="warning" variant="tonal" density="compact" class="mb-2">
                      <v-icon start>mdi-calendar-alert</v-icon>
                      Este producto requiere control de vencimiento
                    </v-alert>
                  </v-col>
                  <v-col v-if="line.requires_expiration" cols="12" sm="4">
                    <v-text-field
                      v-model="line.batch_number"
                      label="Número de Lote"
                      prepend-inner-icon="mdi-barcode"
                      variant="outlined"
                      density="compact"
                      hint="Se generará automáticamente si se deja vacío"
                      persistent-hint
                    >
                      <template #append>
                        <v-btn 
                          icon="mdi-refresh" 
                          size="x-small" 
                          variant="text"
                          @click="generateBatchNumber(i)"
                        ></v-btn>
                      </template>
                    </v-text-field>
                  </v-col>
                  <v-col v-if="line.requires_expiration" cols="12" sm="4">
                    <v-text-field
                      v-model="line.expiration_date"
                      label="Fecha de Vencimiento *"
                      type="date"
                      prepend-inner-icon="mdi-calendar-clock"
                      variant="outlined"
                      density="compact"
                      :rules="line.requires_expiration ? [rules.required] : []"
                      :min="new Date().toISOString().split('T')[0]"
                    ></v-text-field>
                  </v-col>
                  <v-col v-if="line.requires_expiration" cols="12" sm="4">
                    <v-text-field
                      v-model="line.physical_location"
                      label="Ubicación Física"
                      prepend-inner-icon="mdi-map-marker"
                      variant="outlined"
                      density="compact"
                      placeholder="Ej: NEVERA-2, ESTANTE-A1"
                      hint="Opcional"
                      persistent-hint
                    ></v-text-field>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>

            <v-alert v-if="purchaseData.lines.length === 0" type="info" variant="tonal" class="mt-2">
              Agrega al menos un producto para registrar la compra
            </v-alert>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="indigo" variant="tonal" :loading="savingDraft" @click="savePurchaseOrder" :disabled="purchaseData.lines.length === 0">Guardar como OC</v-btn>
          <v-btn color="primary" :loading="saving" @click="savePurchase" :disabled="purchaseData.lines.length === 0">Guardar Compra</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog OC Pendientes -->
    <v-dialog v-model="purchaseOrdersDialog" max-width="1100" scrollable>
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--indigo">
          <v-icon start color="white">mdi-clipboard-list</v-icon>
          <span class="text-white">Ordenes de Compra Pendientes</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-alert v-if="loadingPurchaseOrders" type="info" variant="tonal">
            <v-progress-linear indeterminate></v-progress-linear>
            <div class="mt-2">Cargando ordenes pendientes...</div>
          </v-alert>

          <v-alert v-else-if="pendingPurchaseOrders.length === 0" type="info" variant="tonal">
            No hay ordenes de compra en borrador.
          </v-alert>

          <v-card
            v-for="order in pendingPurchaseOrders"
            :key="order.purchase_order_id"
            variant="outlined"
            class="mb-3"
          >
            <v-card-text>
              <v-row align="center" class="mb-2">
                <v-col cols="12" md="8">
                  <div class="text-subtitle-1 font-weight-bold">
                    OC {{ order.purchase_order_id.slice(0, 8) }}
                  </div>
                  <div class="text-caption text-grey">
                    {{ formatDate(order.created_at) }} • {{ order.location?.name || 'Sin sede' }} •
                    {{ order.supplier?.legal_name || 'Sin proveedor' }}
                  </div>
                  <div v-if="order.note" class="text-caption mt-1">
                    Nota: {{ order.note }}
                  </div>
                </v-col>
                <v-col cols="12" md="4" class="text-md-right">
                  <v-chip size="small" color="info" variant="tonal" class="mr-1">
                    {{ order.lines_count }} lineas
                  </v-chip>
                  <v-chip size="small" color="warning" variant="tonal" class="mr-1">
                    Pendientes: {{ order.pending_lines_count }}
                  </v-chip>
                  <v-chip size="small" color="success" variant="tonal">
                    {{ formatMoney(order.total || order.computed_total) }}
                  </v-chip>
                  <div class="mt-2">
                    <v-btn
                      color="primary"
                      size="small"
                      prepend-icon="mdi-check-circle"
                      :loading="receivingPurchaseOrderId === order.purchase_order_id"
                      @click="openReceiveConfirm(order)"
                    >
                      Recibir y pasar a inventario
                    </v-btn>
                  </div>
                </v-col>
              </v-row>

              <v-divider class="mb-2"></v-divider>

              <v-row
                v-for="line in order.lines"
                :key="line.purchase_order_line_id"
                dense
                class="py-1"
              >
                <v-col cols="12" md="6">
                  <div class="text-body-2">
                    {{ line.variant?.product?.name || 'Producto' }}{{ line.variant?.variant_name ? ' - ' + line.variant.variant_name : '' }}
                  </div>
                  <div class="text-caption text-grey">SKU: {{ line.variant?.sku || '-' }}</div>
                </v-col>
                <v-col cols="4" md="2" class="text-md-center">
                  <div class="text-caption text-grey">Cantidad</div>
                  <div class="text-body-2">{{ line.qty_ordered }}</div>
                </v-col>
                <v-col cols="4" md="2" class="text-md-center">
                  <div class="text-caption text-grey">Costo</div>
                  <div class="text-body-2">{{ formatMoney(line.unit_cost) }}</div>
                </v-col>
                <v-col cols="4" md="2" class="text-right">
                  <div class="text-caption text-grey">Subtotal</div>
                  <div class="text-body-2">{{ formatMoney(Number(line.qty_ordered) * Number(line.unit_cost)) }}</div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="tonal" color="indigo" prepend-icon="mdi-refresh" :loading="loadingPurchaseOrders" @click="loadPendingPurchaseOrders">
            Actualizar
          </v-btn>
          <v-spacer></v-spacer>
          <v-btn @click="purchaseOrdersDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="receiveConfirmDialog" max-width="460">
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--warning-soft">
          <v-icon start color="warning">mdi-alert</v-icon>
          Confirmar recepcion
        </v-card-title>
        <v-card-text>
          <div class="text-body-2">Define cantidades a recibir por linea.</div>
          <div class="text-body-2 mt-1">
            <strong>OC:</strong> {{ selectedPurchaseOrderToReceive?.purchase_order_id?.slice(0, 8) || '-' }}
          </div>
          <v-alert type="info" variant="tonal" density="compact" class="mt-3">
            Puedes recibir parcial. Solo se registran lineas con cantidad mayor a 0.
          </v-alert>

          <v-card v-for="line in receiveDraftLines" :key="line.purchase_order_line_id" variant="outlined" class="mt-2">
            <v-card-text class="py-2">
              <v-row dense align="center">
                <v-col cols="12" md="6">
                  <div class="text-body-2">
                    {{ line.product_name }}{{ line.variant_name ? ' - ' + line.variant_name : '' }}
                  </div>
                  <div class="text-caption text-grey">SKU: {{ line.sku || '-' }}</div>
                </v-col>
                <v-col cols="4" md="2" class="text-md-center">
                  <div class="text-caption text-grey">Ordenado</div>
                  <div class="text-body-2">{{ line.qty_ordered }}</div>
                </v-col>
                <v-col cols="4" md="2" class="text-md-center">
                  <div class="text-caption text-grey">Pendiente</div>
                  <div class="text-body-2">{{ line.qty_remaining }}</div>
                </v-col>
                <v-col cols="4" md="2">
                  <v-text-field
                    v-model.number="line.qty_to_receive"
                    type="number"
                    min="0"
                    :max="line.qty_remaining"
                    step="0.001"
                    label="Recibir"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="closeReceiveConfirm">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            prepend-icon="mdi-check-circle"
            :loading="receivingPurchaseOrderId === selectedPurchaseOrderToReceive?.purchase_order_id"
            @click="confirmReceivePurchaseOrder"
          >
            Confirmar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Detalle de Compra -->
    <v-dialog v-model="detailDialog" max-width="900" scrollable>
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--teal">
          <v-icon start color="white">mdi-truck-delivery</v-icon>
          <span class="text-white">Detalle de Compra</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-alert v-if="loadingDetail" type="info" variant="tonal">
            <v-progress-linear indeterminate></v-progress-linear>
            <div class="mt-2">Cargando detalle de compra...</div>
          </v-alert>

          <v-alert v-if="detailError" type="error" variant="tonal">
            {{ detailError }}
          </v-alert>

          <div v-if="purchaseDetail && !loadingDetail">
            <div class="d-flex justify-end mb-3">
              <v-btn color="warning" prepend-icon="mdi-undo" variant="tonal" @click="openReturnDialog">
                Devolver a proveedor
              </v-btn>
            </div>
            <!-- Información general -->
            <v-card variant="outlined" class="mb-4">
              <v-card-text>
                <v-row dense>
                  <v-col cols="12" md="6">
                    <div class="text-caption text-grey">Sede</div>
                    <div class="text-body-1">
                      <v-icon size="small" class="mr-1">mdi-store</v-icon>
                      {{ purchaseDetail.location_name }}
                    </div>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="text-caption text-grey">Proveedor</div>
                    <div class="text-body-1">
                      <v-icon size="small" class="mr-1">mdi-truck</v-icon>
                      <span v-if="purchaseDetail.supplier">
                        {{ purchaseDetail.supplier.legal_name }}
                        <span v-if="purchaseDetail.supplier.document_number" class="text-caption text-grey ml-1">
                          ({{ purchaseDetail.supplier.document_number }})
                        </span>
                      </span>
                      <span v-else class="text-grey font-italic">Sin proveedor</span>
                    </div>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="text-caption text-grey">Fecha</div>
                    <div class="text-body-1">
                      <v-icon size="small" class="mr-1">mdi-calendar</v-icon>
                      {{ formatDate(purchaseDetail.created_at) }}
                    </div>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="text-caption text-grey">Registrado por</div>
                    <div class="text-body-1">
                      <v-icon size="small" class="mr-1">mdi-account</v-icon>
                      {{ purchaseDetail.created_by_name }}
                    </div>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="text-caption text-grey">Productos</div>
                    <div class="text-body-1">
                      <v-icon size="small" class="mr-1">mdi-package-variant</v-icon>
                      {{ purchaseDetail.items_count }} {{ purchaseDetail.items_count === 1 ? 'producto' : 'productos' }}
                    </div>
                  </v-col>
                  <v-col v-if="purchaseDetail.note" cols="12">
                    <div class="text-caption text-grey">Nota</div>
                    <div class="text-body-2">
                      <v-icon size="small" class="mr-1">mdi-note-text</v-icon>
                      {{ purchaseDetail.note }}
                    </div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>

            <v-card variant="outlined" class="mb-4">
              <v-card-title class="text-subtitle-1 d-flex align-center">
                <v-icon start color="deep-orange">mdi-cash-clock</v-icon>
                Cuenta por pagar
              </v-card-title>
              <v-card-text>
                <v-alert v-if="loadingSupplierPayable" type="info" variant="tonal" density="compact">
                  Cargando cuenta por pagar...
                </v-alert>

                <template v-else-if="purchasePayable">
                  <v-row dense>
                    <v-col cols="12" md="3">
                      <div class="text-caption text-grey">Estado</div>
                      <v-chip size="small" :color="payableStatusColor(purchasePayable.status)" variant="tonal">
                        {{ payableStatusLabel(purchasePayable.status) }}
                      </v-chip>
                    </v-col>
                    <v-col cols="12" md="3">
                      <div class="text-caption text-grey">Total factura</div>
                      <div class="text-body-1 font-weight-bold">{{ formatMoney(purchasePayable.total_amount) }}</div>
                    </v-col>
                    <v-col cols="12" md="3">
                      <div class="text-caption text-grey">Abonado</div>
                      <div class="text-body-1 text-success">{{ formatMoney(purchasePayable.paid_amount) }}</div>
                    </v-col>
                    <v-col cols="12" md="3">
                      <div class="text-caption text-grey">Saldo</div>
                      <div class="text-body-1 text-error font-weight-bold">{{ formatMoney(purchasePayable.balance) }}</div>
                    </v-col>
                    <v-col cols="12" md="4">
                      <div class="text-caption text-grey">Factura proveedor</div>
                      <div class="text-body-2">{{ purchasePayable.invoice_number || 'Sin numero' }}</div>
                    </v-col>
                    <v-col cols="12" md="4">
                      <div class="text-caption text-grey">Vencimiento</div>
                      <div class="text-body-2">{{ purchasePayable.due_date ? formatDate(purchasePayable.due_date) : 'Sin fecha' }}</div>
                    </v-col>
                    <v-col cols="12" md="4" class="text-md-right">
                      <v-btn
                        color="deep-orange"
                        variant="tonal"
                        prepend-icon="mdi-cash-plus"
                        :disabled="purchasePayable.status === 'PAID' || purchasePayable.status === 'CANCELLED'"
                        @click="openSupplierPaymentDialog"
                      >
                        Registrar abono
                      </v-btn>
                    </v-col>
                  </v-row>

                  <v-divider class="my-3"></v-divider>

                  <div class="text-caption text-grey mb-1">Ultimos abonos</div>
                  <v-row v-if="purchasePayable.payments && purchasePayable.payments.length > 0" dense>
                    <v-col v-for="pay in purchasePayable.payments.slice(0, 5)" :key="pay.payable_payment_id" cols="12" md="6">
                      <v-card variant="tonal" color="deep-orange">
                        <v-card-text class="py-2">
                          <div class="d-flex justify-space-between">
                            <span class="text-body-2">{{ formatDate(pay.created_at) }}</span>
                            <span class="text-body-2 font-weight-bold">{{ formatMoney(pay.amount) }}</span>
                          </div>
                          <div class="text-caption">{{ pay.payment_method || 'Sin metodo' }} {{ pay.note ? '� ' + pay.note : '' }}</div>
                        </v-card-text>
                      </v-card>
                    </v-col>
                  </v-row>
                  <v-alert v-else type="info" variant="tonal" density="compact">
                    Sin abonos registrados.
                  </v-alert>
                </template>

                <template v-else>
                  <v-alert type="warning" variant="tonal" density="compact" class="mb-2">
                    Esta compra aun no tiene cuenta por pagar.
                  </v-alert>
                  <v-btn
                    color="deep-orange"
                    prepend-icon="mdi-plus-circle"
                    variant="tonal"
                    :disabled="!purchaseDetail?.supplier"
                    @click="openCreatePayableDialog"
                  >
                    Crear cuenta por pagar
                  </v-btn>
                </template>
              </v-card-text>
            </v-card>
            <!-- Líneas de la compra -->
            <div class="text-subtitle-1 font-weight-bold mb-2">Productos Comprados</div>
            <v-card v-for="(line, idx) in purchaseDetail.lines" :key="line.line_id" variant="outlined" class="mb-2">
              <v-card-text>
                <v-row align="center">
                  <v-col cols="12" md="5">
                    <div class="text-h6">{{ line.product_name }}</div>
                    <div class="text-caption text-grey">
                      {{ line.variant_name || 'Sin variante' }} • SKU: {{ line.sku }}
                    </div>
                  </v-col>
                  <v-col cols="4" md="2" class="text-center">
                    <div class="text-caption text-grey">Cantidad</div>
                    <div class="text-h6">{{ line.quantity }}</div>
                    <div class="text-caption text-warning">Dev: {{ line.returned_qty || 0 }}</div>
                  </v-col>
                  <v-col cols="4" md="2" class="text-center">
                    <div class="text-caption text-grey">Costo Unit.</div>
                    <div class="text-body-1">{{ formatMoney(line.unit_cost) }}</div>
                  </v-col>
                  <v-col cols="4" md="3" class="text-right">
                    <div class="text-caption text-grey">Subtotal</div>
                    <div class="text-h6 text-primary">{{ formatMoney(line.line_total) }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>

            <!-- Total -->
            <v-card color="teal" variant="flat" class="mt-4">
              <v-card-text>
                <v-row align="center">
                  <v-col cols="6">
                    <div class="text-h6 text-white">TOTAL</div>
                  </v-col>
                  <v-col cols="6" class="text-right">
                    <div class="text-h5 text-white font-weight-bold">{{ formatMoney(purchaseDetail.total) }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>

            <v-card v-if="purchaseDetail.returns && purchaseDetail.returns.length > 0" variant="outlined" class="mt-4">
              <v-card-title class="text-subtitle-1">Devoluciones Registradas</v-card-title>
              <v-card-text>
                <v-row v-for="ret in purchaseDetail.returns" :key="ret.purchase_return_id" dense class="py-1">
                  <v-col cols="12" md="5">
                    <div class="text-body-2">DEV {{ ret.purchase_return_id.slice(0, 8) }}</div>
                    <div class="text-caption text-grey">{{ formatDate(ret.created_at) }}</div>
                  </v-col>
                  <v-col cols="12" md="4">
                    <div class="text-caption text-grey">Usuario</div>
                    <div class="text-body-2">{{ ret.created_by_user?.full_name || '' }}</div>
                  </v-col>
                  <v-col cols="12" md="3" class="text-md-right">
                    <div class="text-caption text-grey">Total</div>
                    <div class="text-body-2 font-weight-bold">{{ formatMoney(ret.total) }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="detailDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="returnDialog" max-width="760" scrollable>
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--warning">
          <v-icon start color="white">mdi-undo</v-icon>
          <span class="text-white">Devolucion a proveedor</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-alert type="info" variant="tonal" density="compact" class="mb-3">
            Solo puedes devolver cantidades pendientes por linea.
          </v-alert>

          <v-card v-for="line in returnDraftLines" :key="line.source_line_id" variant="outlined" class="mb-2">
            <v-card-text class="py-2">
              <v-row dense align="center">
                <v-col cols="12" md="6">
                  <div class="text-body-2">{{ line.product_name }}{{ line.variant_name ? ' - ' + line.variant_name : '' }}</div>
                  <div class="text-caption text-grey">SKU: {{ line.sku || '-' }}</div>
                </v-col>
                <v-col cols="4" md="2" class="text-md-center">
                  <div class="text-caption text-grey">Comprado</div>
                  <div class="text-body-2">{{ line.quantity }}</div>
                </v-col>
                <v-col cols="4" md="2" class="text-md-center">
                  <div class="text-caption text-grey">Pendiente</div>
                  <div class="text-body-2">{{ line.returnable_qty }}</div>
                </v-col>
                <v-col cols="4" md="2">
                  <v-text-field
                    v-model.number="line.qty_to_return"
                    type="number"
                    min="0"
                    :max="line.returnable_qty"
                    step="0.001"
                    label="Devolver"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <v-text-field
            v-model="returnNote"
            label="Nota de devolucion (opcional)"
            prepend-inner-icon="mdi-note-text"
            variant="outlined"
            density="compact"
            class="mt-2"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="closeReturnDialog">{{ t('common.cancel') }}</v-btn>
          <v-btn color="warning" :loading="returningPurchase" prepend-icon="mdi-check" @click="confirmPurchaseReturn">
            Registrar devolucion
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="createPayableDialog" max-width="520">
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--orange">
          <v-icon start color="white">mdi-file-document-plus</v-icon>
          <span class="text-white">Crear cuenta por pagar</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-text-field
            v-model="payableForm.invoice_number"
            label="Numero de factura proveedor"
            prepend-inner-icon="mdi-file-document"
            variant="outlined"
            density="compact"
            class="mb-3"
          />
          <v-text-field
            v-model="payableForm.due_date"
            label="Fecha de vencimiento"
            type="date"
            prepend-inner-icon="mdi-calendar"
            variant="outlined"
            density="compact"
            class="mb-3"
          />
          <v-textarea
            v-model="payableForm.note"
            label="Nota (opcional)"
            prepend-inner-icon="mdi-note-text"
            variant="outlined"
            rows="2"
            density="compact"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="createPayableDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="deep-orange" :loading="savingPayable" prepend-icon="mdi-check" @click="confirmCreatePayable">
            Crear
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="supplierPaymentDialog" max-width="520">
      <v-card class="purchase-modal">
        <v-card-title class="purchase-modal__header purchase-modal__header--orange">
          <v-icon start color="white">mdi-cash-plus</v-icon>
          <span class="text-white">Registrar abono proveedor</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <div class="text-caption text-grey mb-2">
            Saldo actual: <strong>{{ formatMoney(purchasePayable?.balance || 0) }}</strong>
          </div>
          <v-text-field
            v-model.number="supplierPaymentForm.amount"
            label="Monto"
            type="number"
            min="0.01"
            :max="purchasePayable?.balance || undefined"
            prepend-inner-icon="mdi-cash"
            variant="outlined"
            density="compact"
            class="mb-3"
          />
          <v-text-field
            v-model="supplierPaymentForm.payment_method"
            label="Metodo de pago"
            prepend-inner-icon="mdi-credit-card-outline"
            variant="outlined"
            density="compact"
            class="mb-3"
          />
          <v-textarea
            v-model="supplierPaymentForm.note"
            label="Nota (opcional)"
            prepend-inner-icon="mdi-note-text"
            variant="outlined"
            rows="2"
            density="compact"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="supplierPaymentDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="deep-orange" :loading="savingSupplierPayment" prepend-icon="mdi-check" @click="confirmSupplierPayment">
            Registrar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useDisplay } from 'vuetify'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAuth } from '@/composables/useAuth'
import supabaseService from '@/services/supabase.service'
import purchasesService from '@/services/purchases.service'
import batchesService from '@/services/batches.service'
import thirdPartiesService from '@/services/thirdParties.service'
import ListView from '@/components/ListView.vue'
import ContextHelpCard from '@/components/ContextHelpCard.vue'
import { humanizeAppError } from '@/utils/appErrors'
import { formatMoney, formatDateTime as formatDate } from '@/utils/formatters'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { isMobile } = useDisplay()
const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const { userProfile } = useAuth()

const loading = ref(false)
const dialog = ref(false)
const saving = ref(false)
const savingDraft = ref(false)
const form = ref(null)

// Variables para detalle de compra
const detailDialog = ref(false)
const purchaseDetail = ref(null)
const loadingDetail = ref(false)
const detailError = ref(null)
const loadingSupplierPayable = ref(false)
const purchasePayable = ref(null)
const createPayableDialog = ref(false)
const savingPayable = ref(false)
const supplierPaymentDialog = ref(false)
const savingSupplierPayment = ref(false)
const payableForm = ref({
  invoice_number: '',
  due_date: null,
  note: ''
})
const supplierPaymentForm = ref({
  amount: 0,
  payment_method: '',
  note: ''
})
const returnDialog = ref(false)
const returningPurchase = ref(false)
const returnDraftLines = ref([])
const returnNote = ref('')

const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

const purchases = ref([])
const totalPurchases = ref(0)
const purchaseOrdersDialog = ref(false)
const pendingPurchaseOrders = ref([])
const loadingPurchaseOrders = ref(false)
const receivingPurchaseOrderId = ref(null)
const receiveConfirmDialog = ref(false)
const selectedPurchaseOrderToReceive = ref(null)
const receiveDraftLines = ref([])
const locations = ref([])
const variants = ref([])
const searchingVariants = ref(false)

const selectedLocation = ref(null)
const dateFrom = ref(null)
const dateTo = ref(null)
const search = ref('')

const purchaseData = ref({
  location_id: null,
  supplier_id: null,
  note: '',
  lines: []
})

const suppliers = ref([])
const suppliersLoading = ref(false)

const loadSuppliers = async (search = '') => {
  suppliersLoading.value = true
  try {
    suppliers.value = await thirdPartiesService.list({ search, type: 'supplier', limit: 50 })
  } catch (e) { console.error('Error cargando proveedores', e) }
  finally { suppliersLoading.value = false }
}

// Sugerencias IA
const suggestionsDialog = ref(false)
const suggestions = ref([])
const loadingSuggestions = ref(false)
const suggestionsTab = ref('critical')
const criticalCount = computed(() => suggestions.value.filter(s => s.priority === 1).length)

// Análisis IA Avanzado
const aiAnalysisDialog = ref(false)
const aiAnalysis = ref(null)
const loadingAIAnalysis = ref(false)
const aiAnalysisError = ref(null)
const aiSuggestionsTab = ref('all')
const aiAvailable = ref(false)
const pendingPurchaseOrdersCount = computed(() => pendingPurchaseOrders.value.length)

const supplierPayablesDialog = ref(false)
const supplierPayablesBoard = ref([])
const loadingSupplierPayablesBoard = ref(false)
const supplierPayablesStatusFilter = ref('OPEN_PARTIAL')
const supplierPayablesDueFilter = ref(30)
const supplierPayablesTotal = ref(0)
const supplierPayablesPage = ref(1)
const supplierPayablesPageSize = computed(() => defaultPageSize.value || 20)
const supplierPayablesStatusOptions = [
  { label: 'Abiertas y parciales', value: 'OPEN_PARTIAL' },
  { label: 'Todas', value: 'ALL' },
  { label: 'Abiertas', value: 'OPEN' },
  { label: 'Parciales', value: 'PARTIAL' },
  { label: 'Pagadas', value: 'PAID' },
  { label: 'Canceladas', value: 'CANCELLED' }
]
const supplierPayablesDueOptions = [
  { label: 'Sin filtro', value: null },
  { label: 'Vence hoy o en 7 dias', value: 7 },
  { label: 'Vence hoy o en 15 dias', value: 15 },
  { label: 'Vence hoy o en 30 dias', value: 30 },
  { label: 'Vence hoy o en 60 dias', value: 60 }
]
const supplierPayablesOpenCount = computed(() =>
  supplierPayablesBoard.value.filter(x => ['OPEN', 'PARTIAL'].includes(x.status)).length
)
const supplierPayablesOverdueCount = computed(() =>
  supplierPayablesBoard.value.filter(x => x.is_overdue && ['OPEN', 'PARTIAL'].includes(x.status)).length
)
const supplierPayablesSelectedIds = ref([])
const bulkSupplierPaymentDialog = ref(false)
const savingBulkSupplierPayment = ref(false)
const bulkSupplierPaymentForm = ref({
  payment_method: '',
  note: ''
})
const selectedSupplierPayablesRows = computed(() =>
  supplierPayablesBoard.value.filter(row =>
    supplierPayablesSelectedIds.value.includes(row.payable_id) && isSupplierPayableSelectable(row)
  )
)
const selectedSupplierPayablesTotal = computed(() =>
  selectedSupplierPayablesRows.value.reduce((sum, row) => sum + Number(row.balance || 0), 0)
)
const selectableSupplierPayablesIds = computed(() =>
  supplierPayablesBoard.value.filter(isSupplierPayableSelectable).map(row => row.payable_id)
)
const allSupplierPayablesSelected = computed(() =>
  selectableSupplierPayablesIds.value.length > 0 &&
  selectableSupplierPayablesIds.value.every(id => supplierPayablesSelectedIds.value.includes(id))
)

// Verificar disponibilidad de IA
onMounted(() => {
  aiAvailable.value = purchasesService.isAIAvailable()
  if (!aiAvailable.value) {
    console.warn('Servicio de IA no disponible. Verifique la Edge Function deepseek-proxy.')
  }
})

const rules = {
  required: v => !!v || v === 0 || 'Campo requerido',
  positive: v => v > 0 || 'Debe ser mayor a 0'
}

const createPurchaseLine = (payload = {}) => ({
  variant_id: payload.variant_id || null,
  qty: Number(payload.qty ?? 1),
  unit_cost: Number(payload.unit_cost ?? 0),
  requires_expiration: !!payload.requires_expiration,
  batch_number: payload.batch_number || '',
  expiration_date: payload.expiration_date || null,
  physical_location: payload.physical_location || ''
})

const resolveRequiresExpiration = (variantRow) => (
  variantRow?.requires_expiration !== null && variantRow?.requires_expiration !== undefined
    ? !!variantRow?.requires_expiration
    : !!variantRow?.product_id?.requires_expiration
)

const normalizeDateInput = (value) => {
  if (!value) return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

const formatVariantLabel = (variantRow, fallbackId) => {
  if (!variantRow) return `variante ${fallbackId}`
  const productName = variantRow.product_id?.name || 'Producto'
  const variantName = variantRow.variant_name ? ` - ${variantRow.variant_name}` : ''
  const sku = variantRow.sku ? ` (${variantRow.sku})` : ''
  return `${productName}${variantName}${sku}`
}

const buildPurchaseLineLabel = (line, fallbackId) => {
  if (!line) return fallbackId ? `producto ${fallbackId}` : null
  if (line.label) return line.label
  const productName = line.product_name || line.productName || line.product?.name || line.product_id?.name || 'Producto'
  const variantName = line.variant_name || line.variantName || line.variant?.variant_name || ''
  const sku = line.sku || line.variant?.sku || ''
  const suffixVariant = variantName ? ` - ${variantName}` : ''
  const suffixSku = sku ? ` (${sku})` : ''
  return `${productName}${suffixVariant}${suffixSku}`.trim()
}

const buildPurchaseErrorContext = (lines = purchaseData.value.lines) => {
  const idLabels = new Map()

  ;(lines || []).forEach((line) => {
    if (!line?.variant_id) return
    const label = buildPurchaseLineLabel(line, line.variant_id)
    if (label) idLabels.set(String(line.variant_id).toLowerCase(), label)
  })

  ;(variants.value || []).forEach((variantRow) => {
    if (!variantRow?.variant_id) return
    const label = formatVariantLabel(variantRow, variantRow.variant_id)
    if (label) idLabels.set(String(variantRow.variant_id).toLowerCase(), label)
  })

  return {
    idLabels,
    defaultMessage: 'Ocurrió un error al procesar la compra.',
  }
}

const loadVariantMetadata = async (variantIds = []) => {
  const uniqueVariantIds = [...new Set((variantIds || []).filter(Boolean))]
  if (!tenantId.value || uniqueVariantIds.length === 0) {
    return { success: true, byVariant: new Map() }
  }

  try {
    const { data, error } = await supabaseService.client
      .from('product_variants')
      .select(`
        variant_id,
        sku,
        variant_name,
        requires_expiration,
        product_id!inner(name, requires_expiration)
      `)
      .eq('tenant_id', tenantId.value)
      .in('variant_id', uniqueVariantIds)

    if (error) throw error

    const byVariant = new Map((data || []).map((row) => ([
      row.variant_id,
      {
        ...row,
        resolved_requires_expiration: resolveRequiresExpiration(row),
        label: formatVariantLabel(row, row.variant_id)
      }
    ])))

    return { success: true, byVariant }
  } catch (error) {
    return {
      success: false,
      error: humanizeAppError(error, buildPurchaseErrorContext()),
      byVariant: new Map()
    }
  }
}

const validateExpirationRequirements = async (lines, { qtyField = 'qty', contextLabel = 'guardar' } = {}) => {
  const result = await loadVariantMetadata(lines.map(line => line.variant_id))
  if (!result.success) {
    showMsg(`No se pudo validar vencimientos: ${result.error}`, 'error')
    return false
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const qty = Number(line?.[qtyField] || 0)
    const metadata = result.byVariant.get(line?.variant_id)
    const requiresExpiration = metadata?.resolved_requires_expiration ?? !!line?.requires_expiration

    line.requires_expiration = requiresExpiration

    if (!requiresExpiration) continue

    const normalizedDate = normalizeDateInput(line?.expiration_date)
    if (line) line.expiration_date = normalizedDate

    if (!normalizedDate) {
      const lineLabel = metadata?.label || `variante ${line?.variant_id || 'sin id'}`
      showMsg(`Linea ${index + 1}: ${lineLabel} requiere fecha de vencimiento para ${contextLabel}`, 'error')
      return false
    }

    if (qty <= 0) {
      showMsg(`Linea ${index + 1}: cantidad inválida para ${contextLabel}`, 'error')
      return false
    }
  }

  return true
}

const payableStatusLabel = (status) => ({
  OPEN: 'Abierta',
  PARTIAL: 'Parcial',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada'
}[status] || status)

const payableStatusColor = (status) => ({
  OPEN: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
  CANCELLED: 'grey'
}[status] || 'grey')

// Funciones de sugerencias
const openSuggestionsDialog = async () => {
  suggestionsDialog.value = true
  await loadSuggestions()
}

const loadSuggestions = async () => {
  if (!tenantId.value) return
  loadingSuggestions.value = true
  try {
    const result = await purchasesService.getPurchaseSuggestions(tenantId.value, 3, 50)
    if (result.success) {
      suggestions.value = result.data
      // Auto-abrir tab con datos
      if (criticalCount.value > 0) {
        suggestionsTab.value = 'critical'
      } else if (result.data.filter(s => s.priority === 2).length > 0) {
        suggestionsTab.value = 'high'
      } else {
        suggestionsTab.value = 'medium'
      }
    } else {
      showMsg('Error al cargar sugerencias', 'error')
    }
  } finally {
    loadingSuggestions.value = false
  }
}

const addSuggestionToCart = (item) => {
  // Buscar si ya existe en el carrito
  const existing = purchaseData.value.lines.find(l => l.variant_id === item.variant_id)
  if (existing) {
    existing.qty = item.suggested_order_qty
    existing.unit_cost = item.unit_cost
    showMsg(`Actualizado: ${item.product_name}`, 'info')
  } else {
    purchaseData.value.lines.push(createPurchaseLine({
      variant_id: item.variant_id,
      qty: item.suggested_order_qty,
      unit_cost: item.unit_cost
    }))
    showMsg(`Agregado: ${item.product_name}`, 'success')
  }
}

const createPurchaseFromSuggestions = () => {
  // Transferir todas las sugerencias al formulario de compra
  suggestionsDialog.value = false
  dialog.value = true
  purchaseData.value.lines = suggestions.value.map(s => createPurchaseLine({
    variant_id: s.variant_id,
    qty: s.suggested_order_qty,
    unit_cost: s.unit_cost
  }))
  showMsg(`${suggestions.value.length} productos agregados a la orden de compra`, 'success')
}

// Funciones de Análisis IA Avanzado
const openAIAnalysisDialog = async () => {
  aiAnalysisDialog.value = true
  if (!aiAnalysis.value) {
    await loadAIAnalysis()
  }
}

const loadAIAnalysis = async (forceRefresh = false) => {
  if (!tenantId.value) return
  if (!aiAvailable.value) {
    aiAnalysisError.value = 'Servicio de IA no disponible. Verifique la Edge Function deepseek-proxy y su secreto DEEPSEEK_API_KEY.'
    return
  }

  loadingAIAnalysis.value = true
  aiAnalysisError.value = null

  try {
    const result = await purchasesService.getAIPurchaseAnalysis(tenantId.value, {
      businessContext: 'Tienda minorista con análisis histórico de ventas',
      priorityLevel: 3,
      forceRefresh
    })

    if (result.success) {
      aiAnalysis.value = result.data
      showMsg('Análisis IA completado exitosamente', 'success')
    } else {
      aiAnalysisError.value = result.error || 'Error al cargar análisis de IA'
    }
  } catch (error) {
    console.error('Error loading AI analysis:', error)
    aiAnalysisError.value = humanizeAppError(`Error: ${error.message}`, buildPurchaseErrorContext())
  } finally {
    loadingAIAnalysis.value = false
  }
}

const refreshAIAnalysis = async () => {
  aiAnalysis.value = null
  await loadAIAnalysis(true)
}

const addAISuggestionToCart = (item) => {
  const qty = item.ai_suggested_qty || item.suggested_order_qty
  const existing = purchaseData.value.lines.find(l => l.variant_id === item.variant_id)
  
  if (existing) {
    existing.qty = qty
    existing.unit_cost = item.unit_cost
    showMsg(`Actualizado con sugerencia IA: ${item.product_name}`, 'info')
  } else {
    purchaseData.value.lines.push(createPurchaseLine({
      variant_id: item.variant_id,
      qty: qty,
      unit_cost: item.unit_cost
    }))
    showMsg(`Agregado con sugerencia IA: ${item.product_name}`, 'success')
  }
  
  // Cerrar diálogo y abrir formulario de compra
  aiAnalysisDialog.value = false
  dialog.value = true
}

const getPriorityColor = (priority) => {
  const colors = {
    1: 'error',
    2: 'warning',
    3: 'info',
    4: 'grey',
    5: 'grey'
  }
  return colors[priority] || 'grey'
}

const getConfidenceColor = (confidence) => {
  if (confidence >= 0.8) return 'success'
  if (confidence >= 0.6) return 'info'
  if (confidence >= 0.4) return 'warning'
  return 'error'
}

onMounted(async () => {
  await loadSettings()
  await loadLocations()
  await loadPurchases()
  await loadPendingPurchaseOrders()
  await loadSupplierPayablesBoard()
  // Cargar sugerencias en background para mostrar badge
  loadSuggestions()
})

const loadPendingPurchaseOrders = async () => {
  if (!tenantId.value) return
  loadingPurchaseOrders.value = true
  try {
    const result = await purchasesService.getOpenPurchaseOrders(tenantId.value)
    if (result.success) {
      pendingPurchaseOrders.value = result.data || []
    } else {
      throw new Error(result.error)
    }
  } catch (error) {
    showMsg('Error al cargar OC pendientes: ' + error.message, 'error')
  } finally {
    loadingPurchaseOrders.value = false
  }
}

const openPurchaseOrdersDialog = async () => {
  purchaseOrdersDialog.value = true
  await loadPendingPurchaseOrders()
}

const loadSupplierPayablesBoard = async (pageParam = supplierPayablesPage.value, pageSizeParam = supplierPayablesPageSize.value) => {
  if (!tenantId.value) return
  loadingSupplierPayablesBoard.value = true
  try {
    const actualPage = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
    const actualPageSize = Number.isInteger(pageSizeParam) && pageSizeParam > 0
      ? pageSizeParam
      : supplierPayablesPageSize.value

    const result = await purchasesService.getSupplierPayablesDashboard({
      tenantId: tenantId.value,
      status: supplierPayablesStatusFilter.value,
      dueInDays: supplierPayablesDueFilter.value,
      page: actualPage,
      pageSize: actualPageSize
    })

    if (result.success) {
      supplierPayablesBoard.value = result.data || []
      supplierPayablesTotal.value = Number(result.total || 0)
      supplierPayablesPage.value = actualPage
      const validIds = new Set((supplierPayablesBoard.value || []).map(x => x.payable_id))
      supplierPayablesSelectedIds.value = supplierPayablesSelectedIds.value.filter(id => validIds.has(id))
    } else {
      throw new Error(result.error)
    }
  } catch (error) {
    showMsg('Error al cargar cuentas por pagar: ' + error.message, 'error')
  } finally {
    loadingSupplierPayablesBoard.value = false
  }
}

const loadSupplierPayablesPage = ({ page, pageSize }) => {
  loadSupplierPayablesBoard(page, pageSize)
}

const applySupplierPayablesFilters = async () => {
  supplierPayablesPage.value = 1
  supplierPayablesSelectedIds.value = []
  await loadSupplierPayablesBoard(1, supplierPayablesPageSize.value)
}

const openSupplierPayablesDialog = async () => {
  supplierPayablesDialog.value = true
  supplierPayablesPage.value = 1
  await loadSupplierPayablesBoard(1, supplierPayablesPageSize.value)
}

const isSupplierPayableSelectable = (row) => {
  return ['OPEN', 'PARTIAL'].includes(row?.status) && Number(row?.balance || 0) > 0
}

const toggleSupplierPayableSelection = (payableId, checked) => {
  if (!payableId) return
  if (checked) {
    if (!supplierPayablesSelectedIds.value.includes(payableId)) {
      supplierPayablesSelectedIds.value.push(payableId)
    }
  } else {
    supplierPayablesSelectedIds.value = supplierPayablesSelectedIds.value.filter(id => id !== payableId)
  }
}

const toggleSelectAllSupplierPayables = (checked) => {
  if (checked) {
    supplierPayablesSelectedIds.value = [...selectableSupplierPayablesIds.value]
  } else {
    supplierPayablesSelectedIds.value = []
  }
}

const openBulkSupplierPaymentDialog = () => {
  if (!userProfile.value?.user_id) {
    showMsg('Error: Usuario no identificado', 'error')
    return
  }
  if (selectedSupplierPayablesRows.value.length === 0) {
    showMsg('No hay cuentas seleccionadas para pagar', 'warning')
    return
  }
  bulkSupplierPaymentForm.value = {
    payment_method: '',
    note: ''
  }
  bulkSupplierPaymentDialog.value = true
}

const confirmBulkSupplierPayment = async () => {
  if (!tenantId.value || !userProfile.value?.user_id) return
  const rows = selectedSupplierPayablesRows.value
  if (rows.length === 0) {
    showMsg('No hay cuentas v�lidas para pagar', 'warning')
    return
  }
  savingBulkSupplierPayment.value = true
  let ok = 0
  let failed = 0
  try {
    for (const row of rows) {
      const amount = Number(row.balance || 0)
      if (amount <= 0) continue
      const result = await purchasesService.registerSupplierPayment({
        tenantId: tenantId.value,
        payableId: row.payable_id,
        amount,
        createdBy: userProfile.value.user_id,
        paymentMethod: bulkSupplierPaymentForm.value.payment_method || null,
        note: bulkSupplierPaymentForm.value.note || 'Pago masivo de cuentas por pagar'
      })
      if (result.success) ok++
      else failed++
    }
    if (ok > 0 && failed === 0) {
      showMsg(`Pago masivo completado. Cuentas pagadas: ${ok}`)
    } else if (ok > 0 && failed > 0) {
      showMsg(`Pago masivo parcial. Exitosas: ${ok}, fallidas: ${failed}`, 'warning')
    } else {
      showMsg('No se pudo registrar el pago masivo', 'error')
    }
    bulkSupplierPaymentDialog.value = false
    supplierPayablesSelectedIds.value = []
    await loadSupplierPayablesBoard(supplierPayablesPage.value, supplierPayablesPageSize.value)
  } catch (error) {
    showMsg('Error en pago masivo: ' + error.message, 'error')
  } finally {
    savingBulkSupplierPayment.value = false
  }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const { data, error } = await supabaseService.client
    .from('locations')
    .select('location_id, name')
    .eq('tenant_id', tenantId.value)
    .eq('is_active', true)
    .order('name')
  if (!error) locations.value = data || []
}

const loadPurchases = async (pageParam = 1, pageSizeParam = null) => {
  if (!tenantId.value) return
  loading.value = true
  try {
    const actualPageSize = pageSizeParam || defaultPageSize.value
    const filters = {}
    if (selectedLocation.value) filters.location_id = selectedLocation.value
    if (dateFrom.value) filters.from_date = dateFrom.value
    if (dateTo.value) filters.to_date = dateTo.value + 'T23:59:59'

    const result = await purchasesService.getPurchases(tenantId.value, pageParam, actualPageSize, filters)
    
    if (result.success) {
      purchases.value = result.data || []
      totalPurchases.value = result.total || 0
    } else {
      throw new Error(result.error)
    }
  } catch (error) {
    showMsg('Error al cargar compras: ' + error.message, 'error')
  } finally {
    loading.value = false
  }
}

const loadPurchasesPage = ({ page, pageSize }) => {
  loadPurchases(page, pageSize)
}

const handleSearch = ({ search: searchTerm, page, pageSize }) => {
  search.value = searchTerm
  loadPurchases(page, pageSize)
}

// Ver detalle de compra
const openPurchaseDetailByPurchaseId = async (purchaseId) => {
  if (!tenantId.value || !purchaseId) return

  detailDialog.value = true
  supplierPayablesDialog.value = false
  loadingDetail.value = true
  detailError.value = null
  purchaseDetail.value = null
  purchasePayable.value = null

  try {
    const result = await purchasesService.getPurchaseDetail(tenantId.value, purchaseId)

    if (result.success) {
      purchaseDetail.value = result.data
      await loadSupplierPayable(purchaseId)
    } else {
      detailError.value = result.error
    }
  } catch (error) {
    console.error('Error loading purchase detail:', error)
    detailError.value = humanizeAppError('Error al cargar detalle: ' + error.message, buildPurchaseErrorContext())
  } finally {
    loadingDetail.value = false
  }
}

// Ver detalle de compra
const viewPurchaseDetail = async (item) => {
  if (!tenantId.value || !item.purchase_id) return

  try {
    const { data: moveData, error: moveError } = await supabaseService.client
      .from('inventory_moves')
      .select('source_id')
      .eq('inventory_move_id', item.purchase_id)
      .eq('tenant_id', tenantId.value)
      .single()

    if (moveError) throw moveError

    await openPurchaseDetailByPurchaseId(moveData.source_id)
  } catch (error) {
    showMsg('Error al abrir detalle de compra: ' + error.message, 'error')
  }
}

const loadSupplierPayable = async (purchaseId) => {
  if (!tenantId.value || !purchaseId) return
  loadingSupplierPayable.value = true
  try {
    const result = await purchasesService.getSupplierPayableByPurchase(tenantId.value, purchaseId)
    if (result.success) {
      purchasePayable.value = result.data
    } else {
      throw new Error(result.error)
    }
  } catch (error) {
    purchasePayable.value = null
    showMsg('Error al cargar cuenta por pagar: ' + error.message, 'error')
  } finally {
    loadingSupplierPayable.value = false
  }
}

const openCreatePayableDialog = () => {
  payableForm.value = {
    invoice_number: '',
    due_date: null,
    note: ''
  }
  createPayableDialog.value = true
}

const confirmCreatePayable = async () => {
  if (!tenantId.value || !purchaseDetail.value?.purchase_id) return

  if (!userProfile.value?.user_id) {
    showMsg('Error: Usuario no identificado', 'error')
    return
  }

  savingPayable.value = true
  try {
    const result = await purchasesService.createSupplierPayable({
      tenantId: tenantId.value,
      purchaseId: purchaseDetail.value.purchase_id,
      createdBy: userProfile.value.user_id,
      dueDate: payableForm.value.due_date || null,
      invoiceNumber: payableForm.value.invoice_number || null,
      note: payableForm.value.note || null
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    showMsg('Cuenta por pagar creada')
    createPayableDialog.value = false
    await loadSupplierPayable(purchaseDetail.value.purchase_id)
  } catch (error) {
    showMsg('Error al crear cuenta por pagar: ' + error.message, 'error')
  } finally {
    savingPayable.value = false
  }
}

const openSupplierPaymentDialog = () => {
  supplierPaymentForm.value = {
    amount: purchasePayable.value?.balance || 0,
    payment_method: '',
    note: ''
  }
  supplierPaymentDialog.value = true
}

const confirmSupplierPayment = async () => {
  if (!tenantId.value || !purchasePayable.value?.payable_id) return

  if (!userProfile.value?.user_id) {
    showMsg('Error: Usuario no identificado', 'error')
    return
  }

  const amount = Number(supplierPaymentForm.value.amount || 0)
  if (amount <= 0) {
    showMsg('El monto debe ser mayor a 0', 'warning')
    return
  }
  if (amount > Number(purchasePayable.value.balance || 0)) {
    showMsg('El abono no puede superar el saldo', 'warning')
    return
  }

  savingSupplierPayment.value = true
  try {
    const result = await purchasesService.registerSupplierPayment({
      tenantId: tenantId.value,
      payableId: purchasePayable.value.payable_id,
      amount,
      createdBy: userProfile.value.user_id,
      paymentMethod: supplierPaymentForm.value.payment_method || null,
      note: supplierPaymentForm.value.note || null
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    showMsg('Abono registrado correctamente')
    supplierPaymentDialog.value = false
    await loadSupplierPayable(purchaseDetail.value.purchase_id)
  } catch (error) {
    showMsg('Error al registrar abono: ' + error.message, 'error')
  } finally {
    savingSupplierPayment.value = false
  }
}
const openReturnDialog = () => {
  if (!purchaseDetail.value?.lines?.length) {
    showMsg('No hay lineas para devolver', 'warning')
    return
  }

  returnDraftLines.value = purchaseDetail.value.lines
    .map(line => ({
      source_line_id: line.line_id,
      variant_id: line.variant_id,
      quantity: Number(line.quantity || 0),
      returned_qty: Number(line.returned_qty || 0),
      returnable_qty: Math.max(Number(line.returnable_qty || 0), 0),
      qty_to_return: 0,
      unit_cost: Number(line.unit_cost || 0),
      product_name: line.product_name || '',
      variant_name: line.variant_name || '',
      sku: line.sku || ''
    }))
    .filter(line => line.returnable_qty > 0)

  if (returnDraftLines.value.length === 0) {
    showMsg('Toda la compra ya fue devuelta', 'info')
    return
  }

  returnNote.value = ''
  returnDialog.value = true
}

const closeReturnDialog = () => {
  returnDialog.value = false
  returnDraftLines.value = []
  returnNote.value = ''
}

const confirmPurchaseReturn = async () => {
  if (!tenantId.value || !purchaseDetail.value?.purchase_id) return

  if (!userProfile.value?.user_id) {
    showMsg('Error: Usuario no identificado', 'error')
    return
  }

  const selectedLines = returnDraftLines.value
    .filter(line => Number(line.qty_to_return || 0) > 0)
    .map(line => ({
      source_line_id: line.source_line_id,
      variant_id: line.variant_id,
      qty: Number(line.qty_to_return),
      unit_cost: Number(line.unit_cost)
    }))

  if (selectedLines.length === 0) {
    showMsg('Ingresa al menos una linea con cantidad a devolver', 'warning')
    return
  }

  for (const line of returnDraftLines.value) {
    const qty = Number(line.qty_to_return || 0)
    if (qty < 0) {
      showMsg('No se permiten cantidades negativas', 'error')
      return
    }
    if (qty > Number(line.returnable_qty || 0)) {
      showMsg('Una cantidad excede lo pendiente por devolver', 'error')
      return
    }
  }

  returningPurchase.value = true
  try {
    const result = await purchasesService.createPurchaseReturn({
      tenantId: tenantId.value,
      purchaseId: purchaseDetail.value.purchase_id,
      createdBy: userProfile.value.user_id,
      lines: selectedLines,
      note: returnNote.value || null
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    showMsg('Devolucion registrada correctamente')
    closeReturnDialog()

    const refreshed = await purchasesService.getPurchaseDetail(tenantId.value, purchaseDetail.value.purchase_id)
    if (refreshed.success) {
      purchaseDetail.value = refreshed.data
    }

    await loadPurchases()
  } catch (error) {
    showMsg('Error al registrar devolucion: ' + error.message, 'error')
  } finally {
    returningPurchase.value = false
  }
}

const loadInitialVariants = async () => {
  if (!tenantId.value) return
  searchingVariants.value = true
  try {
    const { data, error } = await supabaseService.client
      .from('product_variants')
      .select(`
        variant_id,
        sku,
        variant_name,
        requires_expiration,
        product_id!inner(product_id, name, requires_expiration)
      `)
      .eq('tenant_id', tenantId.value)
      .eq('is_active', true)
      .order('sku')
      .limit(50)

    if (error) throw error
    
    if (data) {
      variants.value = data.map(v => ({
        ...v,
        // Resolver requires_expiration con jerarquía: variant sobreescribe producto si no es null
        requires_expiration: resolveRequiresExpiration(v),
        _displayName: `${v.product_id.name}${v.variant_name ? ' - ' + v.variant_name : ''} (${v.sku})`
      }))
    }
  } catch (error) {
    showMsg('Error al cargar productos: ' + error.message, 'error')
  } finally {
    searchingVariants.value = false
  }
}

const searchVariants = async (searchTerm) => {
  if (!tenantId.value) return
  
  // Si no hay término de búsqueda o es muy corto, cargar productos iniciales
  if (!searchTerm || searchTerm.length < 2) {
    await loadInitialVariants()
    return
  }
  
  searchingVariants.value = true
  try {
    // Buscar primero por SKU o variant_name
    let query = supabaseService.client
      .from('product_variants')
      .select(`
        variant_id,
        sku,
        variant_name,
        requires_expiration,
        product_id!inner(product_id, name, requires_expiration)
      `)
      .eq('tenant_id', tenantId.value)
      .eq('is_active', true)
      .order('sku')
      .limit(30)

    // Buscar en SKU, variant_name o nombre del producto
    const searchLower = searchTerm.toLowerCase()
    
    const { data, error } = await query
    
    if (error) throw error
    
    if (data) {
      // Filtrar resultados manualmente para incluir búsqueda por nombre de producto
      const filtered = data.filter(v => 
        v.sku?.toLowerCase().includes(searchLower) ||
        v.variant_name?.toLowerCase().includes(searchLower) ||
        v.product_id?.name?.toLowerCase().includes(searchLower)
      )
      
      variants.value = filtered.map(v => ({
        ...v,
        // Resolver requires_expiration con jerarquía: variant sobreescribe producto si no es null
        requires_expiration: resolveRequiresExpiration(v),
        _displayName: `${v.product_id.name}${v.variant_name ? ' - ' + v.variant_name : ''} (${v.sku})`
      }))
    }
  } catch (error) {
    showMsg('Error al buscar productos: ' + error.message, 'error')
  } finally {
    searchingVariants.value = false
  }
}

const openCreateDialog = async () => {
  purchaseData.value = {
    location_id: locations.value.length === 1 ? locations.value[0].location_id : null,
    supplier_id: null,
    note: '',
    lines: []
  }
  dialog.value = true
  await Promise.all([loadInitialVariants(), loadSuppliers()])
}

const addLine = () => {
  purchaseData.value.lines.push(createPurchaseLine())
}

const removeLine = (index) => {
  purchaseData.value.lines.splice(index, 1)
}

// Detectar si el producto seleccionado requiere vencimiento
const onVariantSelected = (lineIndex, variantId) => {
  const line = purchaseData.value.lines[lineIndex]
  if (!line) return

  if (!variantId) {
    line.requires_expiration = false
    line.batch_number = ''
    line.expiration_date = null
    line.physical_location = ''
    return
  }
  
  const variant = variants.value.find(v => v.variant_id === variantId)
  if (variant) {
    line.requires_expiration = !!variant.requires_expiration
    
    // Limpiar campos de lote si no requiere vencimiento
    if (!variant.requires_expiration) {
      line.batch_number = ''
      line.expiration_date = null
      line.physical_location = ''
    }
  }
}

// Generar numero de lote automatico
const generateBatchNumber = async (lineIndex) => {
  const line = purchaseData.value.lines[lineIndex]
  if (!line.variant_id || !tenantId.value) {
    showMsg('Selecciona primero un producto', 'warning')
    return
  }

  try {
    const result = await batchesService.generateBatchNumber(tenantId.value, line.variant_id)
    if (result.success) {
      purchaseData.value.lines[lineIndex].batch_number = result.batchNumber
      showMsg('Numero de lote generado', 'success')
    } else {
      showMsg('Error al generar lote: ' + result.error, 'error')
    }
  } catch (error) {
    showMsg('Error al generar lote', 'error')
  }
}

const buildFormattedLines = () => {
  return purchaseData.value.lines.map(line => ({
    variant_id: line.variant_id,
    qty: Number(line.qty),
    unit_cost: Number(line.unit_cost),
    batch_number: line.batch_number || null,
    expiration_date: normalizeDateInput(line.expiration_date),
    physical_location: line.physical_location || null
  }))
}

const savePurchase = async () => {
  const { valid } = await form.value.validate()
  if (!valid || !tenantId.value) return

  if (purchaseData.value.lines.length === 0) {
    showMsg('Agrega al menos un producto', 'warning')
    return
  }

  if (!userProfile.value?.user_id) {
    showMsg('Error: Usuario no identificado', 'error')
    return
  }

  const validExpirationData = await validateExpirationRequirements(
    purchaseData.value.lines,
    { qtyField: 'qty', contextLabel: 'guardar la compra' }
  )
  if (!validExpirationData) return

  saving.value = true
  let formattedLines = []
  try {
    formattedLines = buildFormattedLines()

    const { error } = await supabaseService.client.rpc('sp_create_purchase', {
      p_tenant: tenantId.value,
      p_location: purchaseData.value.location_id,
      p_supplier_id: purchaseData.value.supplier_id || null,
      p_created_by: userProfile.value.user_id,
      p_lines: formattedLines,
      p_note: purchaseData.value.note || null
    })

    if (error) throw error

    showMsg('Compra registrada exitosamente')
    dialog.value = false
    await loadPurchases()
  } catch (error) {
    showMsg('Error al guardar compra: ' + error.message, 'error')
  } finally {
    saving.value = false
  }
}

const savePurchaseOrder = async () => {
  const { valid } = await form.value.validate()
  if (!valid || !tenantId.value) return

  if (purchaseData.value.lines.length === 0) {
    showMsg('Agrega al menos un producto', 'warning')
    return
  }

  if (!userProfile.value?.user_id) {
    showMsg('Error: Usuario no identificado', 'error')
    return
  }

  const validExpirationData = await validateExpirationRequirements(
    purchaseData.value.lines,
    { qtyField: 'qty', contextLabel: 'guardar la orden de compra' }
  )
  if (!validExpirationData) return

  savingDraft.value = true
  try {
    const formattedLines = buildFormattedLines()

    const result = await purchasesService.createPurchaseOrder({
      tenantId: tenantId.value,
      locationId: purchaseData.value.location_id,
      supplierId: purchaseData.value.supplier_id || null,
      createdBy: userProfile.value.user_id,
      lines: formattedLines,
      note: purchaseData.value.note || null
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    showMsg('Orden de compra guardada en borrador')
    dialog.value = false
    await loadPendingPurchaseOrders()
  } catch (error) {
    showMsg('Error al guardar OC: ' + error.message, 'error')
  } finally {
    savingDraft.value = false
  }
}

const openReceiveConfirm = (order) => {
  if (!order?.purchase_order_id) return
  selectedPurchaseOrderToReceive.value = order
  receiveDraftLines.value = (order.lines || [])
    .map(line => ({
      purchase_order_line_id: line.purchase_order_line_id,
      variant_id: line.variant_id,
      unit_cost: line.unit_cost,
      batch_number: line.batch_number || null,
      expiration_date: line.expiration_date || null,
      physical_location: line.physical_location || null,
      qty_ordered: Number(line.qty_ordered || 0),
      qty_received: Number(line.qty_received || 0),
      qty_remaining: Math.max(Number(line.qty_remaining || 0), 0),
      qty_to_receive: Math.max(Number(line.qty_remaining || 0), 0),
      product_name: line.variant?.product?.name || 'Producto',
      variant_name: line.variant?.variant_name || '',
      sku: line.variant?.sku || ''
    }))
    .filter(line => line.qty_remaining > 0)

  if (receiveDraftLines.value.length === 0) {
    showMsg('Esta OC no tiene lineas pendientes por recibir', 'warning')
    return
  }
  receiveConfirmDialog.value = true
}

const closeReceiveConfirm = () => {
  receiveConfirmDialog.value = false
  selectedPurchaseOrderToReceive.value = null
  receiveDraftLines.value = []
}

const confirmReceivePurchaseOrder = async () => {
  const order = selectedPurchaseOrderToReceive.value
  if (!tenantId.value || !order?.purchase_order_id) return

  if (!userProfile.value?.user_id) {
    showMsg('Error: Usuario no identificado', 'error')
    return
  }

  const selectedLines = receiveDraftLines.value
    .filter(line => Number(line.qty_to_receive || 0) > 0)
    .map(line => ({
      purchase_order_line_id: line.purchase_order_line_id,
      variant_id: line.variant_id,
      qty_to_receive: Number(line.qty_to_receive),
      unit_cost: Number(line.unit_cost),
      batch_number: line.batch_number || null,
      expiration_date: line.expiration_date || null,
      physical_location: line.physical_location || null
    }))

  if (selectedLines.length === 0) {
    showMsg('Ingresa al menos una linea con cantidad a recibir', 'warning')
    return
  }

  for (const line of receiveDraftLines.value) {
    const qty = Number(line.qty_to_receive || 0)
    if (qty < 0) {
      showMsg('No se permiten cantidades negativas', 'error')
      return
    }
    if (qty > Number(line.qty_remaining || 0)) {
      showMsg('Una cantidad excede lo pendiente por recibir', 'error')
      return
    }
  }

  const validExpirationData = await validateExpirationRequirements(
    selectedLines,
    { qtyField: 'qty_to_receive', contextLabel: 'recibir la OC' }
  )
  if (!validExpirationData) return

  receivingPurchaseOrderId.value = order.purchase_order_id
  try {
    const result = await purchasesService.receivePurchaseOrderPartial({
      tenantId: tenantId.value,
      purchaseOrderId: order.purchase_order_id,
      createdBy: userProfile.value.user_id,
      lines: selectedLines,
      note: order.note || null
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    showMsg('OC recibida y registrada en inventario')
    closeReceiveConfirm()
    await Promise.all([loadPurchases(), loadPendingPurchaseOrders()])
  } catch (error) {
    showMsg('Error al recibir OC: ' + error.message, 'error')
  } finally {
    receivingPurchaseOrderId.value = null
  }
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = color === 'error'
    ? humanizeAppError(msg, buildPurchaseErrorContext())
    : msg
  snackbarColor.value = color
  snackbar.value = true
}
</script>

<style scoped>
.purchases-actions :deep(.v-btn) {
  border-radius: 12px;
  font-weight: 700;
}

.purchases-actions :deep(.v-btn__content) {
  white-space: normal;
  line-height: 1.15;
}

.purchases-page :deep(.v-field) {
  border-radius: 12px;
}

.purchases-page :deep(.v-card-title) {
  font-weight: 700;
}

.supplier-payables-dialog {
  border-radius: 16px;
  overflow: hidden;
}

.supplier-payables-header {
  letter-spacing: 0.2px;
}

.supplier-payables-filters {
  align-items: center;
}

.purchase-modal {
  border-radius: 18px;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  background: linear-gradient(
    145deg,
    rgba(var(--v-theme-surface), 0.98),
    rgba(var(--v-theme-background), 0.94)
  ) !important;
  box-shadow: 0 20px 36px rgba(17, 26, 43, 0.18);
  overflow: hidden;
}

.purchase-modal__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  padding-inline: 16px;
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.2);
  background: linear-gradient(120deg, rgba(31, 82, 196, 0.92), rgba(26, 55, 126, 0.88));
  color: #f8fbff;
}

.purchase-modal__header--orange {
  background: linear-gradient(120deg, rgba(255, 101, 43, 0.95), rgba(228, 82, 19, 0.9));
}

.purchase-modal__header--success {
  background: linear-gradient(120deg, rgba(43, 167, 98, 0.95), rgba(27, 130, 75, 0.9));
}

.purchase-modal__header--purple {
  background: linear-gradient(120deg, rgba(160, 47, 202, 0.94), rgba(123, 39, 182, 0.9));
}

.purchase-modal__header--deep-purple {
  background: linear-gradient(120deg, rgba(110, 63, 208, 0.94), rgba(77, 42, 167, 0.9));
}

.purchase-modal__header--indigo {
  background: linear-gradient(120deg, rgba(80, 94, 225, 0.94), rgba(55, 66, 178, 0.9));
}

.purchase-modal__header--teal {
  background: linear-gradient(120deg, rgba(24, 160, 146, 0.94), rgba(15, 118, 114, 0.9));
}

.purchase-modal__header--warning {
  background: linear-gradient(120deg, rgba(249, 146, 35, 0.95), rgba(231, 111, 22, 0.9));
}

.purchase-modal__header--warning-soft {
  background: linear-gradient(120deg, rgba(255, 243, 220, 0.95), rgba(255, 231, 189, 0.92));
  color: rgba(83, 55, 12, 0.95);
}

.purchase-modal :deep(.v-card-text) {
  padding-top: 14px;
}

.purchase-modal :deep(.v-btn) {
  border-radius: 11px;
  font-weight: 700;
}

.purchase-suggestion-item {
  border-color: rgba(var(--v-theme-primary), 0.2) !important;
}

.purchase-suggestions-summary {
  border: 1px solid rgba(151, 78, 204, 0.22);
}

.purchase-ai-executive {
  border: 1px solid rgba(106, 76, 205, 0.24);
}

.purchase-ai-kpi {
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-radius: 14px;
}

.purchase-ai-kpi--highlight {
  border-color: rgba(165, 77, 214, 0.36);
}

.purchase-ai-section {
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
}

.purchase-ai-suggestion-item {
  border-color: rgba(var(--v-theme-primary), 0.2) !important;
}
</style>




