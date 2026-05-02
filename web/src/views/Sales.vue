<template>
  <div class="ofir-page sales-page">
    <!-- Tabs -->
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="sales">Historial de Ventas</v-tab>
      <v-tab value="online">Ventas online</v-tab>
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

      <v-window-item value="online">
        <v-card class="mb-4 sales-filter-card" elevation="1">
          <v-card-text>
            <div class="d-flex flex-wrap align-center ga-3">
              <div>
                <div class="text-subtitle-1 font-weight-bold">Ventas online</div>
                <div class="text-body-2 text-medium-emphasis">
                  Revisa pedidos online manuales y por pasarela, su estado de pago y la venta creada en el POS.
                </div>
              </div>
              <v-spacer />
              <v-btn
                color="primary"
                variant="tonal"
                prepend-icon="mdi-refresh"
                :loading="loadingOnlineOrders"
                @click="refreshOnlineOrders"
              >
                Actualizar
              </v-btn>
            </div>

            <v-row dense class="mt-3">
              <v-col cols="12" sm="6" md="4">
                <v-select
                  v-model="onlineStatusFilter"
                  :items="onlineStatusOptions"
                  item-title="title"
                  item-value="value"
                  label="Estado online"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="6" md="4">
                <v-text-field
                  v-model="onlineSearch"
                  label="Buscar pedido, cliente o referencia"
                  variant="outlined"
                  density="compact"
                  hide-details
                  prepend-inner-icon="mdi-magnify"
                />
              </v-col>
              <v-col cols="12" sm="6" md="4">
                <div class="d-flex flex-wrap ga-2">
                  <v-chip size="small" color="warning" variant="tonal">
                    Pendientes: {{ pendingOnlineOrdersCount }}
                  </v-chip>
                  <v-chip size="small" color="info" variant="tonal">
                    Reservadas: {{ reservedOnlineUnitsLabel }}
                  </v-chip>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-alert v-if="loadingOnlineOrders" type="info" variant="tonal">
          Cargando pedidos online...
        </v-alert>

        <v-alert v-else-if="!filteredOnlineOrders.length" type="info" variant="tonal">
          No hay pedidos online que coincidan con los filtros actuales.
        </v-alert>

        <v-table v-else density="comfortable" class="sales-online-table">
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
            <tr v-for="order in filteredOnlineOrders" :key="order.online_order_id">
              <td>
                <div class="font-weight-medium">#{{ order.order_number }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ order.payment_reference || 'Sin referencia' }}
                </div>
                <div class="text-caption text-medium-emphasis mt-1">
                  {{ order.payment_mode === 'GATEWAY' ? 'Pasarela Mercado Pago' : 'Pago manual' }}
                </div>
                <div v-if="order.payment_proof_url" class="text-caption mt-1">
                  <v-tooltip
                    location="top"
                    max-width="360"
                    content-class="online-proof-tooltip"
                    transition="fade-transition"
                  >
                    <template #activator="{ props: tooltipProps }">
                      <a
                        v-bind="tooltipProps"
                        :href="order.payment_proof_url"
                        target="_blank"
                        rel="noreferrer"
                        @click.prevent="openPaymentProofPreview(order.payment_proof_url)"
                      >
                        Ver comprobante
                      </a>
                    </template>
                    <div style="width: 320px; padding: 4px;">
                      <v-img
                        :src="order.payment_proof_url"
                        height="280"
                        cover
                        class="rounded"
                        @error="(e) => { e.target.style.display = 'none' }"
                      />
                    </div>
                  </v-tooltip>
                </div>
                <div class="text-caption mt-1">
                  <router-link :to="`/pedido/${order.online_order_id}`" class="text-primary">Estado público</router-link>
                </div>
              </td>
              <td>
                <div>{{ order.customer_name || 'Cliente no informado' }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ order.customer_phone || order.customer_email || 'Sin contacto' }}
                </div>
                <div v-if="order.delivery_address" class="text-caption text-medium-emphasis mt-1">
                  {{ order.delivery_address }}
                </div>
              </td>
              <td>
                <div class="d-flex flex-wrap ga-2">
                  <v-chip size="small" variant="tonal" :color="onlineOrderStatusColor(order)">
                    {{ onlineOrderStatusLabel(order) }}
                  </v-chip>
                  <v-chip size="small" variant="tonal" :color="onlinePaymentStatusColor(order.payment_status)">
                    {{ onlinePaymentStatusLabel(order.payment_status) }}
                  </v-chip>
                </div>
              </td>
              <td>{{ formatMoney(order.total) }}</td>
              <td>{{ formatOnlineReservationSummary(order) }}</td>
              <td>
                <div>{{ formatDate(order.created_at) }}</div>
                <div class="text-caption text-medium-emphasis">{{ order.lines?.length || 0 }} líneas</div>
              </td>
              <td class="text-right">
                <div class="d-flex justify-end flex-wrap ga-2">
                  <v-btn
                    size="small"
                    color="info"
                    variant="text"
                    prepend-icon="mdi-eye"
                    @click="viewOnlineOrderDetail(order)"
                  >
                    Detalle
                  </v-btn>
                  <v-btn
                    v-if="canResyncGatewayOrder(order)"
                    size="small"
                    color="secondary"
                    variant="tonal"
                    :loading="onlineOrderActionLoading && selectedOnlineOrder?.online_order_id === order.online_order_id && onlineOrderActionMode === 'sync'"
                    @click="resyncGatewayOrder(order)"
                  >
                    Revalidar pago
                  </v-btn>
                  <v-btn
                    v-if="canReviewOnlineOrder(order)"
                    size="small"
                    color="success"
                    variant="tonal"
                    :loading="onlineOrderActionLoading && selectedOnlineOrder?.online_order_id === order.online_order_id && onlineOrderActionMode === 'confirm'"
                    @click="openOnlineOrderDialog(order, 'confirm')"
                  >
                    Confirmar pago
                  </v-btn>
                  <v-btn
                    v-if="canReviewOnlineOrder(order)"
                    size="small"
                    color="error"
                    variant="tonal"
                    :loading="onlineOrderActionLoading && selectedOnlineOrder?.online_order_id === order.online_order_id && onlineOrderActionMode === 'reject'"
                    @click="openOnlineOrderDialog(order, 'reject')"
                  >
                    Rechazar
                  </v-btn>
                  <v-chip v-if="order.sale_id" size="small" variant="outlined" color="success">
                    Venta creada
                  </v-chip>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
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

    <v-dialog v-model="onlineOrderDialog" max-width="620">
      <v-card>
        <v-card-title>
          {{ onlineOrderActionMode === 'confirm' ? 'Confirmar pago online' : 'Rechazar pago online' }}
        </v-card-title>
        <v-card-text v-if="selectedOnlineOrder">
          <div class="text-body-2 text-medium-emphasis mb-4">
            Pedido #{{ selectedOnlineOrder.order_number }} · {{ selectedOnlineOrder.customer_name || 'Cliente no informado' }}
          </div>

          <v-alert
            :type="onlineOrderActionMode === 'confirm' ? 'info' : 'warning'"
            variant="tonal"
            class="mb-4"
          >
            <template v-if="onlineOrderActionMode === 'confirm'">
              Al confirmar se crea la venta real en el POS y la reserva de stock pasa a consumida.
            </template>
            <template v-else>
              Al rechazar se cancela el pedido y se libera la reserva del stock online.
            </template>
          </v-alert>

          <div class="text-body-2 mb-4">
            Total: <strong>{{ formatMoney(selectedOnlineOrder.total) }}</strong> · Reserva: <strong>{{ formatOnlineReservationSummary(selectedOnlineOrder) }}</strong>
          </div>

          <div v-if="selectedOnlineOrder.payment_proof_url" class="mb-4">
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-file-document-outline"
              :href="selectedOnlineOrder.payment_proof_url"
              target="_blank"
            >
              Ver comprobante adjunto
            </v-btn>
          </div>

          <v-text-field
            v-if="onlineOrderActionMode === 'confirm'"
            v-model="onlineOrderReference"
            label="Referencia confirmada"
            variant="outlined"
            hint="Puedes ajustar la referencia final del pago antes de crear la venta."
            persistent-hint
            class="mb-3"
          />

          <v-textarea
            v-model="onlineOrderNote"
            :label="onlineOrderActionMode === 'confirm' ? 'Nota de validación' : 'Motivo del rechazo'"
            variant="outlined"
            rows="4"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="closeOnlineOrderDialog">Cancelar</v-btn>
          <v-btn
            :color="onlineOrderActionMode === 'confirm' ? 'success' : 'error'"
            :loading="onlineOrderActionLoading"
            @click="submitOnlineOrderAction"
          >
            {{ onlineOrderActionMode === 'confirm' ? 'Confirmar pago' : 'Rechazar pedido' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Detalle Pedido Online -->
    <v-dialog v-model="onlineOrderDetailDialog" max-width="750" scrollable>
      <v-card v-if="onlineOrderDetail">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon color="info">mdi-cart-outline</v-icon>
          Pedido online #{{ onlineOrderDetail.order_number }}
        </v-card-title>
        <v-card-text>
          <!-- Info general -->
          <v-row dense class="mb-3">
            <v-col cols="12" sm="6">
              <div class="text-caption text-medium-emphasis">Estado</div>
              <div class="d-flex flex-wrap ga-2 mt-1">
                <v-chip size="small" variant="tonal" :color="onlineOrderStatusColor(onlineOrderDetail)">
                  {{ onlineOrderStatusLabel(onlineOrderDetail) }}
                </v-chip>
                <v-chip size="small" variant="tonal" :color="onlinePaymentStatusColor(onlineOrderDetail.payment_status)">
                  {{ onlinePaymentStatusLabel(onlineOrderDetail.payment_status) }}
                </v-chip>
              </div>
            </v-col>
            <v-col cols="12" sm="6">
              <div class="text-caption text-medium-emphasis">Modo de pago</div>
              <div class="text-body-2 font-weight-medium">{{ onlineOrderDetail.payment_mode === 'MANUAL' ? 'Manual' : 'Pasarela' }}</div>
            </v-col>
          </v-row>

          <v-divider class="my-3" />

          <!-- Datos del cliente / checkout -->
          <div class="text-subtitle-2 mb-2">Datos del checkout</div>
          <v-row dense>
            <v-col cols="12" sm="6">
              <div class="text-caption text-medium-emphasis">Cliente</div>
              <div class="text-body-2">{{ onlineOrderDetail.customer_name || 'No informado' }}</div>
            </v-col>
            <v-col cols="12" sm="6">
              <div class="text-caption text-medium-emphasis">Email</div>
              <div class="text-body-2">{{ onlineOrderDetail.customer_email || 'No informado' }}</div>
            </v-col>
            <v-col cols="12" sm="6">
              <div class="text-caption text-medium-emphasis">Teléfono</div>
              <div class="text-body-2">{{ onlineOrderDetail.customer_phone || 'No informado' }}</div>
            </v-col>
            <v-col cols="12" sm="6">
              <div class="text-caption text-medium-emphasis">Referencia de pago</div>
              <div class="text-body-2">{{ onlineOrderDetail.payment_reference || 'No informada' }}</div>
            </v-col>
            <v-col cols="12" v-if="onlineOrderDetail.delivery_address">
              <div class="text-caption text-medium-emphasis">Dirección de entrega</div>
              <div class="text-body-2">{{ onlineOrderDetail.delivery_address }}</div>
            </v-col>
            <v-col cols="12" v-if="onlineOrderDetail.customer_note">
              <div class="text-caption text-medium-emphasis">Nota del cliente</div>
              <div class="text-body-2">{{ onlineOrderDetail.customer_note }}</div>
            </v-col>
            <v-col cols="12" v-if="onlineOrderDetail.landing_return_url">
              <div class="text-caption text-medium-emphasis">URL de retorno</div>
              <div class="text-body-2 text-truncate">
                <a :href="onlineOrderDetail.landing_return_url" target="_blank" rel="noreferrer">{{ onlineOrderDetail.landing_return_url }}</a>
              </div>
            </v-col>
          </v-row>

          <v-divider class="my-3" />

          <!-- Líneas del pedido -->
          <div class="text-subtitle-2 mb-2">Productos ({{ onlineOrderDetail.lines?.length || 0 }})</div>
          <v-table density="compact">
            <thead>
              <tr>
                <th>Producto</th>
                <th class="text-center">Cant.</th>
                <th class="text-right">Precio</th>
                <th class="text-right">Impuesto</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in onlineOrderDetail.lines" :key="line.online_order_line_id || line.variant_id">
                <td>
                  <div class="text-body-2">{{ line.product_name }}</div>
                  <div class="text-caption text-medium-emphasis">{{ line.variant_name || '' }} {{ line.sku ? '· SKU ' + line.sku : '' }}</div>
                </td>
                <td class="text-center">{{ line.quantity }}</td>
                <td class="text-right">{{ formatMoney(line.unit_price) }}</td>
                <td class="text-right">{{ formatMoney(line.tax_amount) }}</td>
                <td class="text-right">{{ formatMoney(line.line_total) }}</td>
              </tr>
            </tbody>
          </v-table>

          <div class="mt-3 text-right">
            <div>Subtotal: {{ formatMoney(onlineOrderDetail.subtotal) }}</div>
            <div v-if="onlineOrderDetail.discount_total > 0">Descuento: -{{ formatMoney(onlineOrderDetail.discount_total) }}</div>
            <div>Impuestos: {{ formatMoney(onlineOrderDetail.tax_total) }}</div>
            <div class="text-h6 font-weight-bold">Total: {{ formatMoney(onlineOrderDetail.total) }}</div>
          </div>

          <v-divider class="my-3" />

          <!-- Reservas -->
          <div class="text-subtitle-2 mb-2">Reservas de stock</div>
          <div v-if="!onlineOrderDetail.reservations?.length" class="text-body-2 text-medium-emphasis">Sin reservas registradas.</div>
          <v-table v-else density="compact">
            <thead>
              <tr>
                <th>Variante</th>
                <th class="text-center">Cant.</th>
                <th>Estado</th>
                <th>Creada</th>
                <th>Consumida/Liberada</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="res in onlineOrderDetail.reservations" :key="res.reservation_id || res.variant_id">
                <td class="text-body-2">{{ res.variant_id?.slice(0, 8) || '—' }}</td>
                <td class="text-center">{{ res.reserved_qty }}</td>
                <td>
                  <v-chip size="x-small" variant="tonal" :color="res.status === 'ACTIVE' ? 'warning' : res.status === 'CONSUMED' ? 'success' : 'grey'">
                    {{ res.status === 'ACTIVE' ? 'Activa' : res.status === 'CONSUMED' ? 'Consumida' : 'Liberada' }}
                  </v-chip>
                </td>
                <td class="text-caption">{{ formatDate(res.created_at) }}</td>
                <td class="text-caption">{{ res.consumed_at ? formatDate(res.consumed_at) : res.released_at ? formatDate(res.released_at) : '—' }}</td>
              </tr>
            </tbody>
          </v-table>

          <!-- Comprobante de pago -->
          <template v-if="onlineOrderDetail.payment_proof_url">
            <v-divider class="my-3" />
            <div class="text-subtitle-2 mb-2">Comprobante de pago</div>
            <v-img
              :src="onlineOrderDetail.payment_proof_url"
              max-height="400"
              contain
              class="rounded mb-2"
              @error="paymentProofError = true"
            />
            <div v-if="paymentProofError" class="text-body-2 text-medium-emphasis">
              No se pudo previsualizar el comprobante.
              <a :href="onlineOrderDetail.payment_proof_url" target="_blank" rel="noreferrer">Abrir en nueva pestaña</a>
            </div>
          </template>

          <!-- Venta asociada -->
          <template v-if="onlineOrderDetail.sale_id">
            <v-divider class="my-3" />
            <div class="text-subtitle-2 mb-2">Venta POS asociada</div>
            <div class="d-flex align-center ga-2">
              <v-chip size="small" color="success" variant="tonal" prepend-icon="mdi-receipt">
                {{ onlineOrderDetail.sale_id }}
              </v-chip>
              <v-btn
                size="small"
                variant="text"
                color="primary"
                prepend-icon="mdi-eye"
                @click="viewSaleFromOnlineDetail"
              >
                Ver detalle de venta
              </v-btn>
            </div>
          </template>

          <!-- Payload completo -->
          <template v-if="onlineOrderDetail.payment_payload && Object.keys(onlineOrderDetail.payment_payload).length > 0">
            <v-divider class="my-3" />
            <div class="text-subtitle-2 mb-2">Payload del pago</div>
            <pre class="text-caption bg-grey-lighten-3 pa-3 rounded" style="overflow-x: auto; white-space: pre-wrap;">{{ JSON.stringify(onlineOrderDetail.payment_payload, null, 2) }}</pre>
          </template>

          <!-- Historial de cambios -->
          <template v-if="onlineOrderDetail.status_history?.length">
            <v-divider class="my-3" />
            <div class="text-subtitle-2 mb-2">Historial de cambios</div>
            <v-timeline density="compact" side="end" class="online-order-timeline">
              <v-timeline-item
                v-for="(entry, i) in onlineOrderDetail.status_history"
                :key="i"
                :dot-color="entry.status === 'COMPLETED' ? 'success' : entry.status === 'CANCELLED' || entry.status === 'FAILED' ? 'error' : entry.status === 'PROCESSING' ? 'info' : 'warning'"
                size="x-small"
              >
                <div class="d-flex align-center ga-2 mb-1">
                  <v-chip size="x-small" variant="flat" :color="entry.status === 'COMPLETED' ? 'success' : entry.status === 'CANCELLED' || entry.status === 'FAILED' ? 'error' : entry.status === 'PROCESSING' ? 'info' : 'warning'">
                    {{ entry.status === 'COMPLETED' ? 'Venta creada' : entry.status === 'CANCELLED' ? 'Cancelado' : entry.status === 'FAILED' ? 'Falló' : entry.status === 'PROCESSING' ? 'En revisión' : 'Pendiente' }}
                  </v-chip>
                  <span class="text-caption text-medium-emphasis">{{ formatDate(entry.timestamp) }}</span>
                </div>
                <div v-if="entry.changed_by" class="text-caption">
                  Por: <strong>{{ entry.changed_by }}</strong>
                </div>
                <div v-if="entry.note" class="text-caption text-medium-emphasis mt-1">
                  {{ entry.note }}
                </div>
              </v-timeline-item>
            </v-timeline>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="onlineOrderDetailDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import onlineStoreService from '@/services/onlineStore.service'
import { formatMoney, formatDateTimeFull as formatDate } from '@/utils/formatters'
import { useI18n } from '@/i18n'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const { tenantId } = useTenant()
const { userProfile } = useAuth()
const { printing, printSaleTicket } = usePrint()
const { defaultPageSize, loadSettings, electronicInvoicingEnabled } = useTenantSettings()

const tab = ref('sales')
const sales = ref([])
const totalSales = ref(0)
const loadingSales = ref(false)
const onlineOrders = ref([])
const loadingOnlineOrders = ref(false)
const returns = ref([])
const totalReturns = ref(0)
const loadingReturns = ref(false)
const onlineStatusFilter = ref('ALL')
const onlineSearch = ref('')
const onlineOrderDialog = ref(false)
const selectedOnlineOrder = ref(null)
const onlineOrderActionMode = ref('confirm')
const onlineOrderActionLoading = ref(false)
const onlineOrderReference = ref('')
const onlineOrderNote = ref('')
const onlineOrderDetailDialog = ref(false)
const onlineOrderDetail = ref(null)
const paymentProofError = ref(false)

const openPaymentProofPreview = (url) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const viewOnlineOrderDetail = async (order) => {
  // Forzar recarga fresca desde la BD para obtener status_history
  try {
    const result = await onlineStoreService.getOnlineOrders(tenantId.value, null, { forceRefresh: true, limit: 100 })
    if (result.success) {
      onlineOrders.value = result.data || []
      const fresh = (result.data || []).find(o => o.online_order_id === order.online_order_id)
      if (fresh) {
        onlineOrderDetail.value = fresh
        paymentProofError.value = false
        onlineOrderDetailDialog.value = true
        return
      }
    }
  } catch (_e) {
    // fallback: usar el objeto original
  }
  onlineOrderDetail.value = order
  paymentProofError.value = false
  onlineOrderDetailDialog.value = true
}

const viewSaleFromOnlineDetail = () => {
  if (!onlineOrderDetail.value?.sale_id) return
  onlineOrderDetailDialog.value = false
  // Buscar la venta en la lista de ventas y abrir su detalle
  const sale = sales.value.find((s) => s.sale_id === onlineOrderDetail.value.sale_id)
  if (sale) {
    viewSale(sale)
  } else {
    // Si no está en la lista actual, cargarla directamente
    viewSale({ sale_id: onlineOrderDetail.value.sale_id })
  }
}

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
const onlineStatusOptions = [
  { title: 'Todos', value: 'ALL' },
  { title: 'Pendientes de pago', value: 'PENDING' },
  { title: 'Confirmados', value: 'COMPLETED' },
  { title: 'Cancelados', value: 'CANCELLED' },
]

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
const onlinePaymentStatusLabel = (s) => ({ PAID: 'Pago confirmado', FAILED: 'Pago rechazado', REFUNDED: 'Reembolsado', PENDING: 'Pago pendiente' }[s] || s || 'Pago pendiente')
const onlinePaymentStatusColor = (s) => ({ PAID: 'success', FAILED: 'error', REFUNDED: 'info', PENDING: 'warning' }[s] || 'grey')
const onlineOrderStatusLabel = (order) => {
  if (order.status === 'COMPLETED') return 'Venta creada'
  if (order.status === 'CANCELLED') return 'Cancelado'
  if (order.status === 'FAILED') return 'Falló'
  if (order.status === 'PROCESSING') return 'En revisión'
  return 'Pendiente'
}
const onlineOrderStatusColor = (order) => {
  if (order.status === 'COMPLETED') return 'success'
  if (order.status === 'CANCELLED' || order.status === 'FAILED') return 'error'
  if (order.status === 'PROCESSING') return 'info'
  return 'warning'
}
const canReviewOnlineOrder = (order) => order?.payment_mode === 'MANUAL'
  && order?.payment_status === 'PENDING'
  && ['PENDING', 'PROCESSING'].includes(order?.status)
  && !order?.sale_id
const canResyncGatewayOrder = (order) => order?.payment_mode === 'GATEWAY'
  && order?.payment_status === 'PENDING'
  && ['PENDING', 'PROCESSING'].includes(order?.status)
  && !order?.sale_id

const filteredOnlineOrders = computed(() => {
  const search = String(onlineSearch.value || '').trim().toLowerCase()
  return onlineOrders.value.filter((order) => {
    const matchesStatus = onlineStatusFilter.value === 'ALL'
      || (onlineStatusFilter.value === 'PENDING' && order?.payment_status === 'PENDING' && ['PENDING', 'PROCESSING'].includes(order?.status))
      || (onlineStatusFilter.value === 'COMPLETED' && order.status === 'COMPLETED' && order.payment_status === 'PAID')
      || (onlineStatusFilter.value === 'CANCELLED' && ['CANCELLED', 'FAILED'].includes(order.status))

    const haystack = [
      order.order_number,
      order.customer_name,
      order.customer_email,
      order.customer_phone,
      order.payment_reference,
    ].join(' ').toLowerCase()

    const matchesSearch = !search || haystack.includes(search)
    return matchesStatus && matchesSearch
  })
})

const pendingOnlineOrdersCount = computed(() => onlineOrders.value.filter((order) => order?.payment_status === 'PENDING' && ['PENDING', 'PROCESSING'].includes(order?.status)).length)
const reservedOnlineUnitsLabel = computed(() => {
  const total = onlineOrders.value
    .filter((order) => order?.payment_status === 'PENDING' && ['PENDING', 'PROCESSING'].includes(order?.status))
    .reduce((sum, order) => sum + (order.reservations || [])
      .filter((reservation) => reservation.status === 'ACTIVE')
      .reduce((orderSum, reservation) => orderSum + Number(reservation.reserved_qty || 0), 0), 0)

  return Number.isInteger(total) ? String(total) : total.toFixed(3)
})

const feStatusColor = (s) => ({ ACCEPTED: 'success', PROCESSING: 'blue', PENDING: 'grey', REJECTED: 'error', ERROR: 'orange' }[s] || 'grey')
const feStatusLabel = (s) => ({ ACCEPTED: 'Aceptada DIAN', PROCESSING: 'Procesando', PENDING: 'Pendiente', REJECTED: 'Rechazada', ERROR: 'Error envío' }[s] || (s ? s : 'Sin enviar'))

const retrying = ref(false)
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const formatOnlineReservationSummary = (order) => {
  const activeQty = (order?.reservations || [])
    .filter((reservation) => reservation.status === 'ACTIVE')
    .reduce((sum, reservation) => sum + Number(reservation.reserved_qty || 0), 0)

  if (activeQty > 0) {
    return Number.isInteger(activeQty) ? `${activeQty} uds reservadas` : `${activeQty.toFixed(3)} uds reservadas`
  }
  if (order?.status === 'COMPLETED') return 'Consumida'
  if (order?.status === 'CANCELLED') return 'Liberada'
  return 'Sin reserva'
}

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

const refreshOnlineOrders = async () => {
  if (!tenantId.value) return
  loadingOnlineOrders.value = true
  try {
    const result = await onlineStoreService.getOnlineOrders(tenantId.value, null, { forceRefresh: true, limit: 100 })
    if (result.success) {
      onlineOrders.value = result.data || []
    } else {
      showMsg(result.error || 'No se pudieron cargar los pedidos online.', 'error')
    }
  } finally {
    loadingOnlineOrders.value = false
  }
}

const openOnlineOrderDialog = (order, mode) => {
  selectedOnlineOrder.value = order
  onlineOrderActionMode.value = mode
  onlineOrderReference.value = order?.payment_reference || ''
  onlineOrderNote.value = ''
  onlineOrderDialog.value = true
}

const closeOnlineOrderDialog = () => {
  onlineOrderDialog.value = false
  selectedOnlineOrder.value = null
  onlineOrderActionMode.value = 'confirm'
  onlineOrderReference.value = ''
  onlineOrderNote.value = ''
}

const submitOnlineOrderAction = async () => {
  if (!selectedOnlineOrder.value?.online_order_id) return
  onlineOrderActionLoading.value = true
  try {
    const result = onlineOrderActionMode.value === 'confirm'
      ? await onlineStoreService.confirmManualOrder(selectedOnlineOrder.value.online_order_id, {
        payment_reference: onlineOrderReference.value,
        payment_note: onlineOrderNote.value,
      })
      : await onlineStoreService.rejectManualOrder(selectedOnlineOrder.value.online_order_id, {
        reason: onlineOrderNote.value,
      })

    if (!result.success) {
      showMsg(result.error || 'No se pudo procesar el pedido online.', 'error')
      return
    }

    showMsg(onlineOrderActionMode.value === 'confirm' ? 'Pago confirmado y venta creada.' : 'Pedido rechazado y stock liberado.')
    closeOnlineOrderDialog()
    await refreshOnlineOrders()
    await loadSales({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
  } finally {
    onlineOrderActionLoading.value = false
  }
}

const resyncGatewayOrder = async (order) => {
  if (!order?.online_order_id) return
  selectedOnlineOrder.value = order
  onlineOrderActionMode.value = 'sync'
  onlineOrderActionLoading.value = true
  try {
    const result = await onlineStoreService.syncGatewayOrder(order.online_order_id)
    if (!result.success) {
      showMsg(result.error || 'No se pudo revalidar el pago en Mercado Pago.', 'error')
      return
    }

    showMsg('Revalidamos el pago con Mercado Pago. La bandeja se actualizará enseguida.')
    await refreshOnlineOrders()
    await loadSales({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })

    if (onlineOrderDetail.value?.online_order_id === order.online_order_id) {
      const fresh = onlineOrders.value.find((item) => item.online_order_id === order.online_order_id)
      if (fresh) onlineOrderDetail.value = fresh
    }
  } finally {
    onlineOrderActionLoading.value = false
    if (selectedOnlineOrder.value?.online_order_id === order.online_order_id) {
      selectedOnlineOrder.value = null
    }
    onlineOrderActionMode.value = 'confirm'
  }
}

watch(
  () => route.query.tab,
  (value) => {
    if (value === 'online' || value === 'sales' || value === 'returns') {
      tab.value = value
      return
    }
    tab.value = 'sales'
  },
  { immediate: true }
)

watch(tab, (value) => {
  const nextQuery = { ...route.query }
  if (value === 'sales') {
    delete nextQuery.tab
  } else {
    nextQuery.tab = value
  }
  router.replace({ query: nextQuery })
})

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
  await refreshOnlineOrders()
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

.sales-online-table {
  border: 1px solid rgba(95, 131, 236, 0.2);
  border-radius: 16px;
  overflow: hidden;
}
</style>
