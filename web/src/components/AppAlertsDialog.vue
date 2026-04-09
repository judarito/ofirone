<template>
  <v-dialog v-model="dialogModel" max-width="1000" scrollable class="alerts-dialog">
    <v-card :class="['alerts-modal', isDark ? 'alerts-modal--dark' : 'alerts-modal--light']">
      <v-card-title class="d-flex align-center pa-4 alerts-modal__header">
        <v-icon color="error" class="mr-2">mdi-alert-circle</v-icon>
        {{ t('app.alerts') }}
        <v-spacer></v-spacer>
        <v-btn icon variant="text" class="alerts-modal__close" @click="dialogModel = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider></v-divider>

      <v-tabs v-model="alertsTab" class="alerts-modal__tabs">
        <v-tab value="stock">
          <v-badge
            :content="stockAlertsCount"
            :color="stockAlertsCount > 0 ? 'error' : 'grey'"
            :model-value="stockAlertsCount > 0"
            inline
          >
            {{ t('app.stock') }}
          </v-badge>
        </v-tab>
        <v-tab value="expiration">
          <v-badge
            :content="expirationAlertsCount"
            :color="expirationAlertsCount > 0 ? 'error' : 'grey'"
            :model-value="expirationAlertsCount > 0"
            inline
          >
            {{ t('app.expirations') }}
          </v-badge>
        </v-tab>
        <v-tab value="layaway">
          <v-badge
            :content="layawayAlertsCount"
            :color="layawayAlertsCount > 0 ? 'warning' : 'grey'"
            :model-value="layawayAlertsCount > 0"
            inline
          >
            {{ t('app.layaway') }}
          </v-badge>
        </v-tab>
        <v-tab value="payable">
          <v-badge
            :content="payableAlertsCount"
            :color="payableAlertsCount > 0 ? 'error' : 'grey'"
            :model-value="payableAlertsCount > 0"
            inline
          >
            {{ t('app.payable') }}
          </v-badge>
        </v-tab>
        <v-tab value="receivable">
          <v-badge
            :content="receivableAlertsCount"
            :color="receivableAlertsCount > 0 ? 'warning' : 'grey'"
            :model-value="receivableAlertsCount > 0"
            inline
          >
            {{ t('app.receivable') }}
          </v-badge>
        </v-tab>
      </v-tabs>

      <v-window v-model="alertsTab" class="alerts-modal__window">
        <v-window-item value="stock">
          <v-card-text class="pa-4 alerts-modal__filters">
            <v-row dense>
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="stockFilters.alert_level"
                  :items="stockAlertLevels"
                  :label="t('app.alertLevel')"
                  clearable
                  density="compact"
                  variant="outlined"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="stockFilters.location_id"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  :label="t('app.branch')"
                  clearable
                  density="compact"
                  variant="outlined"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="12" md="6">
                <v-text-field
                  v-model="stockFilters.search"
                  :label="t('app.searchProductSku')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  density="compact"
                  variant="outlined"
                  @keyup.enter="loadStockAlerts"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-card-text>

          <v-divider></v-divider>

          <v-card-text v-if="isMobile" class="pa-2 alerts-mobile-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="primary"></v-progress-linear>
            <div v-else-if="stockAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noStockAlerts') }}</p>
            </div>
            <v-card
              v-else
              v-for="alert in stockAlertsPageItems"
              :key="alert.alert_id"
              class="mb-2 alerts-mobile-item"
              :color="getStockAlertColor(alert.alert_level) + '-lighten-5'"
              variant="outlined"
            >
              <v-card-text class="pa-3">
                <div class="d-flex align-center mb-2">
                  <v-chip :color="getStockAlertColor(alert.alert_level)" size="small" label>
                    <v-icon start size="small">{{ getStockAlertIcon(alert.alert_level) }}</v-icon>
                    {{ getStockAlertLabel(alert.alert_level) }}
                  </v-chip>
                  <v-spacer></v-spacer>
                  <span class="text-caption text-grey">{{ alert.data.location_name }}</span>
                </div>
                <div class="mb-1">
                  <strong>{{ alert.data.product_name }}</strong>
                  <span v-if="alert.data.variant_name" class="text-caption ml-1">({{ alert.data.variant_name }})</span>
                </div>
                <div class="text-caption text-grey mb-2">SKU: {{ alert.data.sku }}</div>
                <v-row dense class="text-caption">
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.onHand') }}:</div>
                    <div class="font-weight-bold">{{ alert.data.on_hand }}</div>
                  </v-col>
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.available') }}:</div>
                    <div class="font-weight-bold">{{ alert.data.available }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-card-text>

          <v-card-text v-else class="pa-0 alerts-table-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="primary"></v-progress-linear>
            <div v-else-if="stockAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noStockAlerts') }}</p>
            </div>
            <v-table v-else class="alerts-table" density="compact" fixed-header height="500">
              <thead>
                <tr>
                  <th>{{ t('app.alert') }}</th>
                  <th>{{ t('app.branch') }}</th>
                  <th>{{ t('app.product') }}</th>
                  <th>SKU</th>
                  <th class="text-right">{{ t('app.onHand') }}</th>
                  <th class="text-right">{{ t('app.available') }}</th>
                  <th class="text-right">{{ t('app.minimum') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="alert in stockAlertsPageItems" :key="alert.alert_id">
                  <td>
                    <v-chip :color="getStockAlertColor(alert.alert_level)" size="small" label>
                      <v-icon start size="small">{{ getStockAlertIcon(alert.alert_level) }}</v-icon>
                      {{ getStockAlertLabel(alert.alert_level) }}
                    </v-chip>
                  </td>
                  <td>{{ alert.data.location_name }}</td>
                  <td>
                    <div>{{ alert.data.product_name }}</div>
                    <div v-if="alert.data.variant_name" class="text-caption text-grey">{{ alert.data.variant_name }}</div>
                  </td>
                  <td>{{ alert.data.sku }}</td>
                  <td class="text-right">{{ alert.data.on_hand }}</td>
                  <td class="text-right">{{ alert.data.available }}</td>
                  <td class="text-right">{{ alert.data.min_stock }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>

          <v-card-actions v-if="stockAlertsCount > ALERTS_PAGE_SIZE" class="alerts-modal__pager">
            <v-pagination
              v-model="stockPage"
              :length="stockTotalPages"
              :total-visible="5"
              density="comfortable"
            ></v-pagination>
          </v-card-actions>

          <v-divider></v-divider>

          <v-card-actions class="pa-4 alerts-modal__actions">
            <v-btn color="primary" variant="text" @click="loadStockAlerts">
              <v-icon start>mdi-refresh</v-icon>
              {{ t('common.update') }}
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn color="primary" variant="tonal" @click="goTo('/inventory')">
              <v-icon start>mdi-warehouse</v-icon>
              {{ t('app.goToInventory') }}
            </v-btn>
          </v-card-actions>
        </v-window-item>

        <v-window-item value="expiration">
          <v-card-text class="pa-4 alerts-modal__filters">
            <v-row dense>
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="expirationFilters.alert_level"
                  :items="expirationAlertLevels"
                  :label="t('app.alertLevel')"
                  clearable
                  density="compact"
                  variant="outlined"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="expirationFilters.location_id"
                  :items="locations"
                  item-title="name"
                  item-value="location_id"
                  :label="t('app.branch')"
                  clearable
                  density="compact"
                  variant="outlined"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="12" md="6">
                <v-text-field
                  v-model="expirationFilters.search"
                  :label="t('app.searchProductSkuBatch')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  density="compact"
                  variant="outlined"
                  @keyup.enter="loadExpirationAlerts"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-card-text>

          <v-divider></v-divider>

          <v-card-text v-if="isMobile" class="pa-2 alerts-mobile-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="error"></v-progress-linear>
            <div v-else-if="expirationAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noExpirationAlerts') }}</p>
            </div>
            <v-card
              v-else
              v-for="alert in expirationAlertsPageItems"
              :key="alert.alert_id"
              class="mb-2 alerts-mobile-item"
              :color="getExpirationAlertColor(alert.alert_level) + '-lighten-5'"
              variant="outlined"
            >
              <v-card-text class="pa-3">
                <div class="d-flex align-center mb-2">
                  <v-chip :color="getExpirationAlertColor(alert.alert_level)" size="small" label>
                    <v-icon start size="small">{{ getExpirationAlertIcon(alert.alert_level) }}</v-icon>
                    {{ getExpirationAlertLabel(alert.alert_level) }}
                  </v-chip>
                  <v-spacer></v-spacer>
                  <span class="text-caption text-grey">{{ alert.data.location_name }}</span>
                </div>
                <div class="mb-1">
                  <strong>{{ alert.data.product_name }}</strong>
                  <span v-if="alert.data.variant_name" class="text-caption ml-1">({{ alert.data.variant_name }})</span>
                </div>
                <div class="text-caption text-grey mb-2">
                  {{ t('app.batch') }}: {{ alert.data.batch_number }} | SKU: {{ alert.data.sku }}
                </div>
                <v-row dense class="text-caption">
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.expires') }}:</div>
                    <div class="font-weight-bold">{{ formatDate(alert.data.expiration_date) }}</div>
                  </v-col>
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.days') }}:</div>
                    <div class="font-weight-bold" :class="alert.data.days_to_expiry < 0 ? 'text-error' : ''">
                      {{ alert.data.days_to_expiry }}
                    </div>
                  </v-col>
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.stock') }}:</div>
                    <div class="font-weight-bold">{{ alert.data.on_hand }}</div>
                  </v-col>
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.available') }}:</div>
                    <div class="font-weight-bold">{{ alert.data.available }}</div>
                  </v-col>
                </v-row>
                <div v-if="alert.data.physical_location" class="text-caption text-grey mt-2">
                  <v-icon size="small">mdi-map-marker</v-icon>
                  {{ alert.data.physical_location }}
                </div>
              </v-card-text>
            </v-card>
          </v-card-text>

          <v-card-text v-else class="pa-0 alerts-table-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="error"></v-progress-linear>
            <div v-else-if="expirationAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noExpirationAlerts') }}</p>
            </div>
            <v-table v-else class="alerts-table" density="compact" fixed-header height="500">
              <thead>
                <tr>
                  <th>{{ t('app.alert') }}</th>
                  <th>{{ t('app.branch') }}</th>
                  <th>{{ t('app.product') }}</th>
                  <th>{{ t('app.batch') }}</th>
                  <th>{{ t('app.expirationDate') }}</th>
                  <th class="text-right">{{ t('app.days') }}</th>
                  <th class="text-right">{{ t('app.stock') }}</th>
                  <th class="text-right">{{ t('app.available') }}</th>
                  <th>{{ t('app.location') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="alert in expirationAlertsPageItems" :key="alert.alert_id">
                  <td>
                    <v-chip :color="getExpirationAlertColor(alert.alert_level)" size="small" label>
                      <v-icon start size="small">{{ getExpirationAlertIcon(alert.alert_level) }}</v-icon>
                      {{ getExpirationAlertLabel(alert.alert_level) }}
                    </v-chip>
                  </td>
                  <td>{{ alert.data.location_name }}</td>
                  <td>
                    <div>{{ alert.data.product_name }}</div>
                    <div v-if="alert.data.variant_name" class="text-caption text-grey">{{ alert.data.variant_name }}</div>
                    <div class="text-caption text-grey">{{ alert.data.sku }}</div>
                  </td>
                  <td>{{ alert.data.batch_number }}</td>
                  <td>{{ formatDate(alert.data.expiration_date) }}</td>
                  <td class="text-right" :class="alert.data.days_to_expiry < 0 ? 'text-error font-weight-bold' : ''">
                    {{ alert.data.days_to_expiry }}
                  </td>
                  <td class="text-right">{{ alert.data.on_hand }}</td>
                  <td class="text-right">{{ alert.data.available }}</td>
                  <td>
                    <span v-if="alert.data.physical_location" class="text-caption">
                      {{ alert.data.physical_location }}
                    </span>
                    <span v-else class="text-caption text-grey">-</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>

          <v-card-actions v-if="expirationAlertsCount > ALERTS_PAGE_SIZE" class="alerts-modal__pager">
            <v-pagination
              v-model="expirationPage"
              :length="expirationTotalPages"
              :total-visible="5"
              density="comfortable"
            ></v-pagination>
          </v-card-actions>

          <v-divider></v-divider>

          <v-card-actions class="pa-4 alerts-modal__actions">
            <v-btn color="error" variant="text" @click="loadExpirationAlerts">
              <v-icon start>mdi-refresh</v-icon>
              {{ t('common.update') }}
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn color="error" variant="tonal" @click="goTo('/batches')">
              <v-icon start>mdi-barcode</v-icon>
              {{ t('app.goToBatches') }}
            </v-btn>
          </v-card-actions>
        </v-window-item>

        <v-window-item value="layaway">
          <v-card-text class="pa-4 alerts-modal__filters">
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="layawayFilters.alert_level"
                  :items="layawayAlertLevels"
                  :label="t('app.status')"
                  clearable
                  density="compact"
                  variant="outlined"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="layawayFilters.search"
                  :label="t('app.searchCustomer')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  density="compact"
                  variant="outlined"
                  @keyup.enter="loadLayawayAlerts"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-card-text>

          <v-divider></v-divider>

          <v-card-text v-if="isMobile" class="pa-2 alerts-mobile-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="warning"></v-progress-linear>
            <div v-else-if="layawayAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noLayawayAlerts') }}</p>
            </div>
            <v-card
              v-else
              v-for="alert in layawayAlertsPageItems"
              :key="alert.alert_id"
              class="mb-2 alerts-mobile-item"
              :color="getLayawayAlertColor(alert.alert_level) + '-lighten-5'"
              variant="outlined"
            >
              <v-card-text class="pa-3">
                <div class="d-flex align-center mb-2">
                  <v-chip :color="getLayawayAlertColor(alert.alert_level)" size="small" label>
                    <v-icon start size="small">{{ getLayawayAlertIcon(alert.alert_level) }}</v-icon>
                    {{ getLayawayAlertLabel(alert.alert_level) }}
                  </v-chip>
                  <v-spacer></v-spacer>
                  <span class="text-caption">{{ formatDate(alert.data.due_date) }}</span>
                </div>
                <div class="mb-1"><strong>{{ alert.data.customer_name }}</strong></div>
                <div class="text-caption text-grey mb-2">{{ alert.data.customer_document || alert.data.customer_phone }}</div>
                <v-row dense class="text-caption">
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.total') }}:</div>
                    <div class="font-weight-bold">{{ formatMoney(alert.data.total) }}</div>
                  </v-col>
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.balance') }}:</div>
                    <div class="font-weight-bold text-error">{{ formatMoney(alert.data.balance) }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-card-text>

          <v-card-text v-else class="pa-0 alerts-table-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="warning"></v-progress-linear>
            <div v-else-if="layawayAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noLayawayAlerts') }}</p>
            </div>
            <v-table v-else class="alerts-table" density="compact" fixed-header height="500">
              <thead>
                <tr>
                  <th>{{ t('app.status') }}</th>
                  <th>{{ t('app.customer') }}</th>
                  <th>{{ t('app.branch') }}</th>
                  <th>{{ t('app.expirationDate') }}</th>
                  <th class="text-right">{{ t('app.total') }}</th>
                  <th class="text-right">{{ t('app.paid') }}</th>
                  <th class="text-right">{{ t('app.balance') }}</th>
                  <th>{{ t('app.actions') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="alert in layawayAlertsPageItems" :key="alert.alert_id">
                  <td>
                    <v-chip :color="getLayawayAlertColor(alert.alert_level)" size="small" label>
                      <v-icon start size="small">{{ getLayawayAlertIcon(alert.alert_level) }}</v-icon>
                      {{ getLayawayAlertLabel(alert.alert_level) }}
                    </v-chip>
                  </td>
                  <td>
                    <div>{{ alert.data.customer_name }}</div>
                    <div class="text-caption text-grey">{{ alert.data.customer_document || alert.data.customer_phone }}</div>
                  </td>
                  <td>{{ alert.data.location_name }}</td>
                  <td>{{ formatDate(alert.data.due_date) }}</td>
                  <td class="text-right">{{ formatMoney(alert.data.total) }}</td>
                  <td class="text-right">{{ formatMoney(alert.data.paid_total) }}</td>
                  <td class="text-right text-error font-weight-bold">{{ formatMoney(alert.data.balance) }}</td>
                  <td>
                    <v-btn
                      size="small"
                      color="primary"
                      variant="text"
                      icon
                      @click="goTo(`/layaway/${alert.data.layaway_id}`)"
                    >
                      <v-icon>mdi-eye</v-icon>
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>

          <v-card-actions v-if="layawayAlertsCount > ALERTS_PAGE_SIZE" class="alerts-modal__pager">
            <v-pagination
              v-model="layawayPage"
              :length="layawayTotalPages"
              :total-visible="5"
              density="comfortable"
            ></v-pagination>
          </v-card-actions>

          <v-divider></v-divider>

          <v-card-actions class="pa-4 alerts-modal__actions">
            <v-btn color="warning" variant="text" @click="loadLayawayAlerts">
              <v-icon start>mdi-refresh</v-icon>
              {{ t('common.update') }}
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn color="warning" variant="tonal" @click="goTo('/layaway')">
              <v-icon start>mdi-calendar-clock</v-icon>
              {{ t('app.goToLayaway') }}
            </v-btn>
          </v-card-actions>
        </v-window-item>

        <v-window-item value="payable">
          <v-card-text class="pa-4 alerts-modal__filters">
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="payableFilters.alert_level"
                  :items="payableAlertLevels"
                  :label="t('app.alertLevel')"
                  clearable
                  density="compact"
                  variant="outlined"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="payableFilters.search"
                  :label="t('app.searchSupplierInvoiceBranch')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  density="compact"
                  variant="outlined"
                  @keyup.enter="loadPayableAlerts"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-card-text>

          <v-divider></v-divider>

          <v-card-text v-if="isMobile" class="pa-2 alerts-mobile-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="error"></v-progress-linear>
            <div v-else-if="payableAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noPayableAlerts') }}</p>
            </div>
            <v-card
              v-else
              v-for="alert in payableAlertsPageItems"
              :key="alert.alert_id"
              class="mb-2 alerts-mobile-item"
              :color="getPayableAlertColor(alert.alert_level) + '-lighten-5'"
              variant="outlined"
            >
              <v-card-text class="pa-3">
                <div class="d-flex align-center mb-2">
                  <v-chip :color="getPayableAlertColor(alert.alert_level)" size="small" label>
                    <v-icon start size="small">{{ getPayableAlertIcon(alert.alert_level) }}</v-icon>
                    {{ getPayableAlertLabel(alert.alert_level) }}
                  </v-chip>
                  <v-spacer></v-spacer>
                  <span class="text-caption">{{ formatDate(alert.data.due_date) }}</span>
                </div>
                <div class="mb-1"><strong>{{ alert.data.supplier_name }}</strong></div>
                <div class="text-caption text-grey mb-2">{{ t('app.invoice') }}: {{ alert.data.invoice_number || t('app.withoutNumber') }}</div>
                <v-row dense class="text-caption">
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.branch') }}:</div>
                    <div class="font-weight-bold">{{ alert.data.location_name || '-' }}</div>
                  </v-col>
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.balance') }}:</div>
                    <div class="font-weight-bold text-error">{{ formatMoney(alert.data.balance) }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-card-text>

          <v-card-text v-else class="pa-0 alerts-table-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="error"></v-progress-linear>
            <div v-else-if="payableAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noPayableAlerts') }}</p>
            </div>
            <v-table v-else class="alerts-table" density="compact" fixed-header height="500">
              <thead>
                <tr>
                  <th>{{ t('app.status') }}</th>
                  <th>{{ t('app.provider') }}</th>
                  <th>{{ t('app.branch') }}</th>
                  <th>{{ t('app.invoice') }}</th>
                  <th>{{ t('app.expirationDate') }}</th>
                  <th class="text-right">{{ t('app.balance') }}</th>
                  <th>{{ t('app.action') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="alert in payableAlertsPageItems" :key="alert.alert_id">
                  <td>
                    <v-chip :color="getPayableAlertColor(alert.alert_level)" size="small" label>
                      <v-icon start size="small">{{ getPayableAlertIcon(alert.alert_level) }}</v-icon>
                      {{ getPayableAlertLabel(alert.alert_level) }}
                    </v-chip>
                  </td>
                  <td>{{ alert.data.supplier_name }}</td>
                  <td>{{ alert.data.location_name || '-' }}</td>
                  <td>{{ alert.data.invoice_number || t('app.withoutNumber') }}</td>
                  <td>{{ formatDate(alert.data.due_date) }}</td>
                  <td class="text-right text-error font-weight-bold">{{ formatMoney(alert.data.balance) }}</td>
                  <td>
                    <v-btn size="small" color="error" variant="text" @click="goTo('/purchases')">
                      {{ t('app.viewPurchases') }}
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>

          <v-card-actions v-if="payableAlertsCount > ALERTS_PAGE_SIZE" class="alerts-modal__pager">
            <v-pagination
              v-model="payablePage"
              :length="payableTotalPages"
              :total-visible="5"
              density="comfortable"
            ></v-pagination>
          </v-card-actions>

          <v-divider></v-divider>

          <v-card-actions class="pa-4 alerts-modal__actions">
            <v-btn color="error" variant="text" @click="loadPayableAlerts">
              <v-icon start>mdi-refresh</v-icon>
              {{ t('common.update') }}
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn color="error" variant="tonal" @click="goTo('/purchases')">
              <v-icon start>mdi-cart-plus</v-icon>
              {{ t('app.goToPurchases') }}
            </v-btn>
          </v-card-actions>
        </v-window-item>

        <v-window-item value="receivable">
          <v-card-text class="pa-4 alerts-modal__filters">
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="receivableFilters.alert_level"
                  :items="receivableAlertLevels"
                  :label="t('app.alertLevel')"
                  clearable
                  density="compact"
                  variant="outlined"
                ></v-select>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="receivableFilters.search"
                  :label="t('app.searchCustomerDocument')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  density="compact"
                  variant="outlined"
                  @keyup.enter="loadReceivableAlerts"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-card-text>

          <v-divider></v-divider>

          <v-card-text v-if="isMobile" class="pa-2 alerts-mobile-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="warning"></v-progress-linear>
            <div v-else-if="receivableAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noReceivableAlerts') }}</p>
            </div>
            <v-card
              v-else
              v-for="alert in receivableAlertsPageItems"
              :key="alert.alert_id"
              class="mb-2 alerts-mobile-item"
              :color="getReceivableAlertColor(alert.alert_level) + '-lighten-5'"
              variant="outlined"
            >
              <v-card-text class="pa-3">
                <div class="d-flex align-center mb-2">
                  <v-chip :color="getReceivableAlertColor(alert.alert_level)" size="small" label>
                    <v-icon start size="small">{{ getReceivableAlertIcon(alert.alert_level) }}</v-icon>
                    {{ getReceivableAlertLabel(alert.alert_level) }}
                  </v-chip>
                </div>
                <div class="mb-1"><strong>{{ alert.data.customer_name }}</strong></div>
                <div class="text-caption text-grey mb-2">{{ alert.data.customer_document || t('app.withoutDocument') }}</div>
                <v-row dense class="text-caption">
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.balance') }}:</div>
                    <div class="font-weight-bold text-error">{{ formatMoney(alert.data.current_balance) }}</div>
                  </v-col>
                  <v-col cols="6">
                    <div class="text-grey">{{ t('app.limit') }}:</div>
                    <div class="font-weight-bold">{{ formatMoney(alert.data.credit_limit) }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-card-text>

          <v-card-text v-else class="pa-0 alerts-table-wrap">
            <v-progress-linear v-if="loadingAlerts" indeterminate color="warning"></v-progress-linear>
            <div v-else-if="receivableAlertsCount === 0" class="text-center pa-8 text-grey alerts-empty-state">
              <v-icon size="64" color="grey-lighten-1">mdi-check-circle</v-icon>
              <p class="mt-4">{{ t('app.noReceivableAlerts') }}</p>
            </div>
            <v-table v-else class="alerts-table" density="compact" fixed-header height="500">
              <thead>
                <tr>
                  <th>{{ t('app.status') }}</th>
                  <th>{{ t('app.customer') }}</th>
                  <th>{{ t('app.document') }}</th>
                  <th class="text-right">{{ t('app.balance') }}</th>
                  <th class="text-right">{{ t('app.limit') }}</th>
                  <th class="text-right">{{ t('app.excess') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="alert in receivableAlertsPageItems" :key="alert.alert_id">
                  <td>
                    <v-chip :color="getReceivableAlertColor(alert.alert_level)" size="small" label>
                      <v-icon start size="small">{{ getReceivableAlertIcon(alert.alert_level) }}</v-icon>
                      {{ getReceivableAlertLabel(alert.alert_level) }}
                    </v-chip>
                  </td>
                  <td>{{ alert.data.customer_name }}</td>
                  <td>{{ alert.data.customer_document || t('app.withoutDocument') }}</td>
                  <td class="text-right text-error font-weight-bold">{{ formatMoney(alert.data.current_balance) }}</td>
                  <td class="text-right">{{ formatMoney(alert.data.credit_limit) }}</td>
                  <td class="text-right">{{ formatMoney(alert.data.over_limit_amount || 0) }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>

          <v-card-actions v-if="receivableAlertsCount > ALERTS_PAGE_SIZE" class="alerts-modal__pager">
            <v-pagination
              v-model="receivablePage"
              :length="receivableTotalPages"
              :total-visible="5"
              density="comfortable"
            ></v-pagination>
          </v-card-actions>

          <v-divider></v-divider>

          <v-card-actions class="pa-4 alerts-modal__actions">
            <v-btn color="warning" variant="text" @click="loadReceivableAlerts">
              <v-icon start>mdi-refresh</v-icon>
              {{ t('common.update') }}
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn color="warning" variant="tonal" @click="goTo('/cartera')">
              <v-icon start>mdi-account-credit-card</v-icon>
              {{ t('app.goToReceivable') }}
            </v-btn>
          </v-card-actions>
        </v-window-item>
      </v-window>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { useAppAlerts } from '@/composables/useAppAlerts'
import { useTheme } from '@/composables/useTheme'
import { useI18n } from '@/i18n'
import { formatMoney, formatDate } from '@/utils/formatters'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])
const router = useRouter()
const { mobile: isMobile } = useDisplay()
const { isDark } = useTheme()
const { t } = useI18n()
const alertsTab = ref('stock')
const ALERTS_PAGE_SIZE = 20

const {
  loadingAlerts,
  locations,
  stockFilters,
  expirationFilters,
  layawayFilters,
  payableFilters,
  receivableFilters,
  stockAlertLevels,
  expirationAlertLevels,
  layawayAlertLevels,
  payableAlertLevels,
  receivableAlertLevels,
  stockAlerts,
  expirationAlerts,
  layawayAlerts,
  payableAlerts,
  receivableAlerts,
  stockAlertsCount,
  expirationAlertsCount,
  layawayAlertsCount,
  payableAlertsCount,
  receivableAlertsCount,
  filteredLayawayAlerts,
  loadLocations,
  loadStockAlerts,
  loadExpirationAlerts,
  loadLayawayAlerts,
  loadPayableAlerts,
  loadReceivableAlerts,
  getStockAlertColor,
  getStockAlertIcon,
  getStockAlertLabel,
  getExpirationAlertColor,
  getExpirationAlertIcon,
  getExpirationAlertLabel,
  getLayawayAlertColor,
  getLayawayAlertIcon,
  getLayawayAlertLabel,
  getPayableAlertColor,
  getPayableAlertIcon,
  getPayableAlertLabel,
  getReceivableAlertColor,
  getReceivableAlertIcon,
  getReceivableAlertLabel
} = useAppAlerts()

const dialogModel = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const stockPage = ref(1)
const expirationPage = ref(1)
const layawayPage = ref(1)
const payablePage = ref(1)
const receivablePage = ref(1)

const paginateAlerts = (itemsRef, pageRef) => computed(() => {
  const start = (pageRef.value - 1) * ALERTS_PAGE_SIZE
  return itemsRef.value.slice(start, start + ALERTS_PAGE_SIZE)
})

const getTotalPages = (itemsRef) => computed(() => (
  Math.max(1, Math.ceil(itemsRef.value.length / ALERTS_PAGE_SIZE))
))

const stockAlertsPageItems = paginateAlerts(stockAlerts, stockPage)
const expirationAlertsPageItems = paginateAlerts(expirationAlerts, expirationPage)
const layawayAlertsPageItems = paginateAlerts(filteredLayawayAlerts, layawayPage)
const payableAlertsPageItems = paginateAlerts(payableAlerts, payablePage)
const receivableAlertsPageItems = paginateAlerts(receivableAlerts, receivablePage)

const stockTotalPages = getTotalPages(stockAlerts)
const expirationTotalPages = getTotalPages(expirationAlerts)
const layawayTotalPages = getTotalPages(filteredLayawayAlerts)
const payableTotalPages = getTotalPages(payableAlerts)
const receivableTotalPages = getTotalPages(receivableAlerts)

watch(() => stockAlerts.value.length, () => { stockPage.value = 1 })
watch(() => expirationAlerts.value.length, () => { expirationPage.value = 1 })
watch(() => filteredLayawayAlerts.value.length, () => { layawayPage.value = 1 })
watch(() => payableAlerts.value.length, () => { payablePage.value = 1 })
watch(() => receivableAlerts.value.length, () => { receivablePage.value = 1 })

watch(stockTotalPages, (total) => { if (stockPage.value > total) stockPage.value = total })
watch(expirationTotalPages, (total) => { if (expirationPage.value > total) expirationPage.value = total })
watch(layawayTotalPages, (total) => { if (layawayPage.value > total) layawayPage.value = total })
watch(payableTotalPages, (total) => { if (payablePage.value > total) payablePage.value = total })
watch(receivableTotalPages, (total) => { if (receivablePage.value > total) receivablePage.value = total })

const goTo = (path) => {
  dialogModel.value = false
  router.push(path)
}

onMounted(() => {
  if (!locations.value.length) {
    loadLocations()
  }
})
</script>

<style scoped>
.alerts-dialog :deep(.v-overlay__content) {
  width: min(1080px, calc(100vw - 24px));
}

.alerts-modal {
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  background: linear-gradient(
    145deg,
    rgba(var(--v-theme-surface), 0.985),
    rgba(var(--v-theme-background), 0.95)
  ) !important;
  box-shadow: 0 20px 38px rgba(18, 28, 48, 0.2);
}

.alerts-modal__header {
  min-height: 60px;
  gap: 8px;
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.2);
  letter-spacing: 0.25px;
  background: linear-gradient(120deg, rgba(38, 95, 224, 0.92), rgba(62, 139, 230, 0.9));
  color: #f8fcff;
}

.alerts-modal__close {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.28);
}

.alerts-modal__tabs {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.16);
  background: linear-gradient(180deg, rgba(245, 249, 255, 0.98), rgba(236, 243, 255, 0.92));
}

.alerts-modal__tabs :deep(.v-slide-group__content) {
  gap: 8px;
}

.alerts-modal__tabs :deep(.v-tab) {
  min-height: 42px;
  border-radius: 11px;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
}

.alerts-modal__tabs :deep(.v-tab--selected) {
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.28), rgba(120, 214, 75, 0.24));
}

.alerts-modal__window {
  background: transparent;
}

.alerts-modal__filters {
  padding-top: 14px !important;
  padding-bottom: 10px !important;
}

.alerts-modal__filters :deep(.v-field) {
  border-radius: 12px;
}

.alerts-mobile-wrap {
  max-height: 500px;
  overflow: auto;
  padding: 10px !important;
}

.alerts-mobile-item {
  border-radius: 14px !important;
  border-width: 1px !important;
  border-color: rgba(37, 99, 235, 0.18) !important;
}

.alerts-table-wrap {
  max-height: 500px;
  overflow: hidden;
}

.alerts-table {
  background: transparent !important;
}

.alerts-table :deep(thead th) {
  font-size: 0.76rem !important;
  font-weight: 800 !important;
  letter-spacing: 0.45px;
  text-transform: uppercase;
  white-space: nowrap;
}

.alerts-table :deep(td) {
  padding-top: 11px !important;
  padding-bottom: 11px !important;
  vertical-align: middle;
}

.alerts-table :deep(tbody tr:hover) {
  background: rgba(37, 99, 235, 0.07);
}

.alerts-empty-state {
  margin: 12px;
  border-radius: 14px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
  background: rgba(245, 250, 255, 0.9);
}

.alerts-modal--dark {
  border-color: rgba(96, 134, 255, 0.22);
  background: linear-gradient(145deg, rgba(10, 18, 35, 0.985), rgba(7, 14, 28, 0.97)) !important;
  box-shadow: 0 22px 40px rgba(2, 7, 20, 0.42);
}

.alerts-modal--dark .alerts-modal__close {
  background: rgba(255, 255, 255, 0.18);
}

.alerts-modal--dark .alerts-modal__tabs {
  border-bottom-color: rgba(96, 134, 255, 0.18);
  background: linear-gradient(180deg, rgba(16, 26, 48, 0.98), rgba(11, 19, 36, 0.96));
}

.alerts-modal--dark .alerts-modal__tabs :deep(.v-tab) {
  color: rgba(230, 239, 255, 0.88);
}

.alerts-modal--dark .alerts-modal__tabs :deep(.v-tab--selected) {
  background: linear-gradient(90deg, rgba(54, 116, 255, 0.22), rgba(71, 190, 113, 0.2));
  color: #f5f8ff;
}

.alerts-modal--dark .alerts-modal__filters {
  background: rgba(9, 16, 31, 0.78);
}

.alerts-modal--dark .alerts-modal__filters :deep(.v-field),
.alerts-modal--dark .alerts-mobile-item {
  background: rgba(14, 23, 44, 0.72) !important;
}

.alerts-modal--dark .alerts-table :deep(thead th) {
  background: rgba(11, 19, 36, 0.96);
  color: rgba(232, 239, 252, 0.9);
}

.alerts-modal--dark .alerts-table :deep(tbody tr:hover) {
  background: rgba(50, 98, 210, 0.16);
}

.alerts-modal--dark .alerts-empty-state {
  border-color: rgba(96, 134, 255, 0.26);
  background: linear-gradient(145deg, rgba(16, 26, 48, 0.96), rgba(10, 18, 35, 0.92));
  color: rgba(226, 236, 252, 0.82);
}

.alerts-modal--light .alerts-modal__filters {
  background: rgba(255, 255, 255, 0.84);
}

.alerts-modal--light .alerts-empty-state {
  color: rgba(65, 77, 97, 0.82);
}

.alerts-modal__actions {
  gap: 10px;
  flex-wrap: wrap;
}

.alerts-modal__pager {
  justify-content: center;
  padding: 10px 14px;
}

.alerts-modal__actions :deep(.v-btn) {
  border-radius: 11px;
  font-weight: 700;
  text-transform: none;
}

@media (max-width: 960px) {
  .alerts-dialog :deep(.v-overlay__content) {
    width: calc(100vw - 12px);
  }

  .alerts-modal__tabs {
    padding-inline: 6px;
  }

  .alerts-modal__tabs :deep(.v-tab) {
    min-width: max-content;
    font-size: 0.75rem;
    padding-inline: 10px;
  }

  .alerts-modal__actions {
    padding: 12px !important;
  }
}
</style>
