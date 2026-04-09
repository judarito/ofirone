<template>
  <div>
    <div v-if="isFromAccounting" class="mb-3">
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-arrow-left"
        @click="goBackToAccounting"
      >
        Volver a Contabilidad
      </v-btn>
    </div>

    <!-- Header con breadcrumb -->
    <v-breadcrumbs :items="breadcrumbs" class="pa-0 mb-4">
      <template #divider><v-icon>mdi-chevron-right</v-icon></template>
    </v-breadcrumbs>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon start color="blue">mdi-cash-register</v-icon>
        {{ t('reports.salesTitle') }}
      </v-card-title>
      <v-card-text>
        <v-row class="ga-2" align="center">
          <v-col cols="12" sm="3">
            <v-text-field v-model="fromDate" type="date" :label="t('reports.from')" variant="outlined" density="compact" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field v-model="toDate" type="date" :label="t('reports.to')" variant="outlined" density="compact" hide-details></v-text-field>
          </v-col>
          <v-col cols="12" sm="3">
            <v-select v-model="locationFilter" :items="locations" item-title="name" item-value="location_id" :label="t('app.branch')" variant="outlined" density="compact" hide-details clearable></v-select>
          </v-col>
          <v-col cols="12" sm="3">
            <v-btn color="primary" prepend-icon="mdi-magnify" @click="loadAllReports" :loading="loading">{{ t('reports.query') }}</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Tarjetas de resumen -->
    <v-row class="mb-4" v-if="summary">
      <v-col cols="6" sm="2">
        <v-card color="blue" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ summary.total_sales }}</div>
            <div class="text-caption">Ventas</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="2">
        <v-card color="green" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.gross_total) }}</div>
            <div class="text-caption">Ventas Brutas</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="2">
        <v-card color="red" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.returns_total) }}</div>
            <div class="text-caption">Devoluciones</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="2">
        <v-card color="teal" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.net_total) }}</div>
            <div class="text-caption">Ventas Netas</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="2">
        <v-card color="orange" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.gross_discount) }}</div>
            <div class="text-caption">Descuentos</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" sm="2">
        <v-card color="purple" variant="tonal">
          <v-card-text class="text-center">
            <div class="text-h6 font-weight-bold">{{ formatMoney(summary.gross_tax) }}</div>
            <div class="text-caption">Impuestos</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-tabs v-model="reportTab" color="primary" class="mb-4">
      <v-tab value="daily">Por Día</v-tab>
      <v-tab value="products">Top Productos</v-tab>
      <v-tab value="categories">Por Categoría</v-tab>
      <v-tab value="sellers">Por Vendedor</v-tab>
      <v-tab value="payments">Por Método de Pago</v-tab>
      <v-tab value="movements">Movimientos de Caja</v-tab>
      <v-tab value="layaway">Plan Separe</v-tab>
      <v-tab value="stock-alerts">
        <v-badge v-if="stockAlertsCount > 0" :content="stockAlertsCount" color="error">
          Alertas de Stock
        </v-badge>
        <span v-else>Alertas de Stock</span>
      </v-tab>
    </v-tabs>

    <v-window v-model="reportTab">
      <!-- Por Día -->
      <v-window-item value="daily">
        <v-card>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr><th>Fecha</th><th class="text-center">Ventas</th><th class="text-right">Bruto</th><th class="text-right">Devoluciones</th><th class="text-right">Neto</th></tr>
            </thead>
            <tbody>
              <tr v-for="day in salesByDay" :key="day.date">
                <td>{{ day.date }}</td>
                <td class="text-center">{{ day.count }}</td>
                <td class="text-right">{{ formatMoney(day.gross_total) }}</td>
                <td class="text-right text-red">{{ formatMoney(day.returns_total) }}</td>
                <td class="text-right font-weight-bold">{{ formatMoney(day.net_total) }}</td>
              </tr>
              <tr v-if="salesByDay.length === 0"><td colspan="5" class="text-center text-grey pa-4">Sin datos</td></tr>
            </tbody>
          </v-table>
          <div class="d-sm-none pa-2">
            <v-card v-for="day in salesByDay" :key="day.date" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="text-body-2 font-weight-bold mb-2">{{ day.date }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Ventas:</span><span class="font-weight-bold">{{ day.count }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Bruto:</span><span>{{ formatMoney(day.gross_total) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Devoluciones:</span><span class="text-red">{{ formatMoney(day.returns_total) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Neto:</span><span class="font-weight-bold text-success">{{ formatMoney(day.net_total) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="salesByDay.length === 0" class="text-center text-grey pa-4">Sin datos</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Top Productos -->
      <v-window-item value="products">
        <v-card>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr><th>#</th><th>Producto</th><th>SKU</th><th class="text-right">Cant.</th><th class="text-right">Ingresos</th><th class="text-right">Costo</th><th class="text-right">Utilidad</th></tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in topProducts" :key="p.variant_id">
                <td>{{ i + 1 }}</td>
                <td>{{ p.product_name }} {{ p.variant_name ? '— ' + p.variant_name : '' }}</td>
                <td>{{ p.sku }}</td>
                <td class="text-right">{{ p.total_qty }}</td>
                <td class="text-right">{{ formatMoney(p.total_revenue) }}</td>
                <td class="text-right">{{ formatMoney(p.total_cost) }}</td>
                <td class="text-right font-weight-bold" :class="p.profit >= 0 ? 'text-success' : 'text-error'">{{ formatMoney(p.profit) }}</td>
              </tr>
              <tr v-if="topProducts.length === 0"><td colspan="7" class="text-center text-grey pa-4">Sin datos</td></tr>
            </tbody>
          </v-table>
          <div class="d-sm-none pa-2">
            <v-card v-for="(p, i) in topProducts" :key="p.variant_id" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center mb-2">
                  <v-chip size="x-small" color="primary" class="mr-2">{{ i + 1 }}</v-chip>
                  <div class="flex-grow-1" style="min-width: 0;">
                    <div class="text-body-2 font-weight-bold">{{ p.product_name }}</div>
                    <div class="text-caption text-grey">{{ p.variant_name }}</div>
                    <div class="text-caption text-grey">SKU: {{ p.sku }}</div>
                  </div>
                </div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Cantidad:</span><span class="font-weight-bold">{{ p.total_qty }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Ingresos:</span><span>{{ formatMoney(p.total_revenue) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Costo:</span><span>{{ formatMoney(p.total_cost) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Utilidad:</span><span class="font-weight-bold" :class="p.profit >= 0 ? 'text-success' : 'text-error'">{{ formatMoney(p.profit) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="topProducts.length === 0" class="text-center text-grey pa-4">Sin datos</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Por Categoría -->
      <v-window-item value="categories">
        <v-card>
          <v-card-title class="d-flex align-center py-3">
            <v-icon start color="blue">mdi-tag-multiple</v-icon>
            Ventas por Categoría
            <v-spacer></v-spacer>
            <v-btn size="small" variant="tonal" color="blue" prepend-icon="mdi-refresh" @click="loadCategories" :loading="loadingCategories">Recargar</v-btn>
          </v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>#</th>
                <th>Categoría</th>
                <th class="text-right">Cantidad</th>
                <th class="text-right">Ingresos</th>
                <th class="text-right">Costo</th>
                <th class="text-right">Utilidad</th>
                <th class="text-right">Margen %</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(c, i) in salesByCategory" :key="c.category">
                <td>{{ i + 1 }}</td>
                <td>
                  <v-chip size="small" color="blue" variant="tonal">{{ c.category }}</v-chip>
                </td>
                <td class="text-right">{{ c.qty }}</td>
                <td class="text-right">{{ formatMoney(c.revenue) }}</td>
                <td class="text-right text-grey">{{ formatMoney(c.cost) }}</td>
                <td class="text-right font-weight-bold" :class="c.profit >= 0 ? 'text-success' : 'text-error'">{{ formatMoney(c.profit) }}</td>
                <td class="text-right">
                  <v-chip
                    size="small"
                    :color="c.margin >= 30 ? 'success' : c.margin >= 15 ? 'warning' : 'error'"
                    variant="tonal"
                  >
                    {{ c.margin }}%
                  </v-chip>
                </td>
              </tr>
              <tr v-if="salesByCategory.length === 0">
                <td colspan="7" class="text-center text-grey pa-4">Sin datos</td>
              </tr>
            </tbody>
          </v-table>
          <!-- Mobile -->
          <div class="d-sm-none pa-2">
            <v-card v-for="(c, i) in salesByCategory" :key="c.category" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center mb-2">
                  <v-chip size="x-small" color="primary" class="mr-2">{{ i + 1 }}</v-chip>
                  <v-chip size="small" color="blue" variant="tonal">{{ c.category }}</v-chip>
                </div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Cantidad:</span><span class="font-weight-bold">{{ c.qty }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Ingresos:</span><span>{{ formatMoney(c.revenue) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Costo:</span><span class="text-grey">{{ formatMoney(c.cost) }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Utilidad:</span><span class="font-weight-bold" :class="c.profit >= 0 ? 'text-success' : 'text-error'">{{ formatMoney(c.profit) }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Margen:</span><v-chip size="x-small" :color="c.margin >= 30 ? 'success' : c.margin >= 15 ? 'warning' : 'error'" variant="tonal">{{ c.margin }}%</v-chip></div>
              </v-card-text>
            </v-card>
            <div v-if="salesByCategory.length === 0" class="text-center text-grey pa-4">Sin datos</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Por Vendedor -->
      <v-window-item value="sellers">
        <v-card>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr><th>Vendedor</th><th class="text-center">Ventas</th><th class="text-right">Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in salesBySeller" :key="s.user_id">
                <td>{{ s.name }}</td>
                <td class="text-center">{{ s.count }}</td>
                <td class="text-right font-weight-bold">{{ formatMoney(s.total) }}</td>
              </tr>
              <tr v-if="salesBySeller.length === 0"><td colspan="3" class="text-center text-grey pa-4">Sin datos</td></tr>
            </tbody>
          </v-table>
          <div class="d-sm-none pa-2">
            <v-card v-for="s in salesBySeller" :key="s.user_id" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="text-body-2 font-weight-bold mb-2">{{ s.name }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Ventas:</span><span class="font-weight-bold">{{ s.count }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Total:</span><span class="font-weight-bold text-success">{{ formatMoney(s.total) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="salesBySeller.length === 0" class="text-center text-grey pa-4">Sin datos</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Por Método de Pago -->
      <v-window-item value="payments">
        <v-card>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr><th>Método</th><th class="text-center">Transacciones</th><th class="text-right">Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in salesByPayment" :key="p.code">
                <td>{{ p.name }}</td>
                <td class="text-center">{{ p.count }}</td>
                <td class="text-right font-weight-bold">{{ formatMoney(p.total) }}</td>
              </tr>
              <tr v-if="salesByPayment.length === 0"><td colspan="3" class="text-center text-grey pa-4">Sin datos</td></tr>
            </tbody>
          </v-table>
          <div class="d-sm-none pa-2">
            <v-card v-for="p in salesByPayment" :key="p.code" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="text-body-2 font-weight-bold mb-2">{{ p.name }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Transacciones:</span><span class="font-weight-bold">{{ p.count }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Total:</span><span class="font-weight-bold text-success">{{ formatMoney(p.total) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="salesByPayment.length === 0" class="text-center text-grey pa-4">Sin datos</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Movimientos de Caja -->
      <v-window-item value="movements">
        <v-card class="mb-3" v-if="movementsSummary">
          <v-card-text>
            <v-row dense>
              <v-col cols="6" sm="3">
                <div class="text-caption text-grey">Total Ingresos</div>
                <div class="text-h6 text-success">{{ formatMoney(movementsSummary.total_income) }}</div>
                <div class="text-caption">{{ movementsSummary.count_income }} movimientos</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-grey">Total Gastos</div>
                <div class="text-h6 text-error">{{ formatMoney(movementsSummary.total_expense) }}</div>
                <div class="text-caption">{{ movementsSummary.count_expense }} movimientos</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-grey">Neto</div>
                <div class="text-h6" :class="movementsSummary.net >= 0 ? 'text-success' : 'text-error'">{{ formatMoney(movementsSummary.net) }}</div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
        <v-card>
          <v-card-title class="d-flex align-center">
            <span>Detalle de Movimientos</span>
            <v-spacer></v-spacer>
            <v-btn-toggle v-model="movementTypeFilter" mandatory density="compact" class="mr-2">
              <v-btn value="ALL" size="small">Todos</v-btn>
              <v-btn value="INCOME" size="small" color="success">Ingresos</v-btn>
              <v-btn value="EXPENSE" size="small" color="error">Gastos</v-btn>
            </v-btn-toggle>
          </v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr>
                <th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Caja</th><th>Registrado por</th><th class="text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in filteredMovements" :key="m.cash_movement_id">
                <td>{{ formatDateTime(m.created_at) }}</td>
                <td>
                  <v-chip :color="m.type === 'INCOME' ? 'success' : 'error'" size="x-small" variant="flat">
                    {{ m.type === 'INCOME' ? 'Ingreso' : 'Gasto' }}
                  </v-chip>
                </td>
                <td>{{ m.category || 'Sin categoría' }}</td>
                <td>{{ m.session?.cash_register?.name || '-' }} ({{ m.session?.cash_register?.location?.name || '-' }})</td>
                <td>{{ m.created_by_user?.full_name || '-' }}</td>
                <td class="text-right font-weight-bold" :class="m.type === 'INCOME' ? 'text-success' : 'text-error'">
                  {{ m.type === 'INCOME' ? '+' : '-' }}{{ formatMoney(m.amount) }}
                </td>
              </tr>
              <tr v-if="filteredMovements.length === 0">
                <td colspan="6" class="text-center text-grey pa-4">Sin movimientos</td>
              </tr>
            </tbody>
          </v-table>
          <div class="d-sm-none pa-2">
            <v-card v-for="m in filteredMovements" :key="m.cash_movement_id" variant="outlined" class="mb-2">
              <v-card-text>
                <div class="d-flex align-center justify-space-between mb-2">
                  <span class="text-caption text-grey">{{ formatDateTime(m.created_at) }}</span>
                  <v-chip :color="m.type === 'INCOME' ? 'success' : 'error'" size="x-small" variant="flat">
                    {{ m.type === 'INCOME' ? 'Ingreso' : 'Gasto' }}
                  </v-chip>
                </div>
                <div class="text-body-2 font-weight-bold mb-1">{{ m.category || 'Sin categoría' }}</div>
                <v-divider class="my-2"></v-divider>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Caja:</span><span>{{ m.session?.cash_register?.name || '-' }}</span></div>
                <div class="d-flex justify-space-between text-caption mb-1"><span class="text-grey">Por:</span><span>{{ m.created_by_user?.full_name || '-' }}</span></div>
                <div class="d-flex justify-space-between text-caption"><span class="text-grey">Monto:</span><span class="font-weight-bold" :class="m.type === 'INCOME' ? 'text-success' : 'text-error'">{{ m.type === 'INCOME' ? '+' : '-' }}{{ formatMoney(m.amount) }}</span></div>
              </v-card-text>
            </v-card>
            <div v-if="filteredMovements.length === 0" class="text-center text-grey pa-4">Sin movimientos</div>
          </div>
        </v-card>
      </v-window-item>

      <!-- Plan Separe -->
      <v-window-item value="layaway">
        <v-row class="mb-3">
          <v-col cols="6" sm="3"><v-card color="blue" variant="tonal"><v-card-text class="text-center"><div class="text-h6 font-weight-bold">{{ layawaySummary?.total_contracts || 0 }}</div><div class="text-caption">Contratos Totales</div></v-card-text></v-card></v-col>
          <v-col cols="6" sm="3"><v-card color="green" variant="tonal"><v-card-text class="text-center"><div class="text-h6 font-weight-bold">{{ layawaySummary?.active_contracts || 0 }}</div><div class="text-caption">Activos</div></v-card-text></v-card></v-col>
          <v-col cols="6" sm="3"><v-card color="teal" variant="tonal"><v-card-text class="text-center"><div class="text-h6 font-weight-bold">{{ layawaySummary?.completed_contracts || 0 }}</div><div class="text-caption">Completados</div></v-card-text></v-card></v-col>
          <v-col cols="6" sm="3"><v-card color="red" variant="tonal"><v-card-text class="text-center"><div class="text-h6 font-weight-bold">{{ layawaySummary?.cancelled_contracts || 0 }}</div><div class="text-caption">Cancelados</div></v-card-text></v-card></v-col>
        </v-row>
        <v-card>
          <v-card-title>Contratos</v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr><th>Cliente</th><th>Estado</th><th>Creación</th><th>Vencimiento</th><th class="text-right">Total</th><th class="text-right">Abonado</th><th class="text-right">Saldo</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in layawayContracts" :key="c.layaway_id">
                <td>{{ c.customer_name }}</td>
                <td><v-chip :color="c.status === 'ACTIVE' ? 'green' : c.status === 'COMPLETED' ? 'blue' : 'red'" size="x-small" variant="flat">{{ c.status }}</v-chip></td>
                <td>{{ formatDate(c.created_at) }}</td>
                <td>{{ c.due_date ? formatDate(c.due_date) : '-' }}</td>
                <td class="text-right">{{ formatMoney(c.total) }}</td>
                <td class="text-right text-success">{{ formatMoney(c.paid_total) }}</td>
                <td class="text-right font-weight-bold text-error">{{ formatMoney(c.balance) }}</td>
              </tr>
              <tr v-if="layawayContracts.length === 0"><td colspan="7" class="text-center text-grey pa-4">Sin contratos</td></tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <!-- Alertas de Stock -->
      <v-window-item value="stock-alerts">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon start color="warning">mdi-alert-circle</v-icon>
            Alertas de Stock
            <v-spacer></v-spacer>
            <v-select v-model="alertLevelFilter" :items="alertLevelOptions" item-title="label" item-value="value" label="Nivel" variant="outlined" density="compact" hide-details clearable style="max-width: 200px;" class="mr-2"></v-select>
            <v-btn color="primary" prepend-icon="mdi-refresh" @click="loadStockAlerts" :loading="loadingAlerts" size="small">Recargar</v-btn>
          </v-card-title>
          <v-table density="comfortable" class="d-none d-sm-table w-100">
            <thead>
              <tr><th>Alerta</th><th>Producto</th><th>SKU</th><th>Sede</th><th class="text-right">Stock</th><th class="text-right">Disponible</th><th class="text-right">Mínimo</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredStockAlerts" :key="`${item.location_id}-${item.variant_id}`">
                <td><v-chip :color="alertColor(item.alert_level)" size="small" variant="flat"><v-icon start size="x-small">{{ alertIcon(item.alert_level) }}</v-icon>{{ alertLabel(item.alert_level) }}</v-chip></td>
                <td><div class="text-body-2">{{ item.product_name }}</div><div class="text-caption text-grey">{{ item.variant_name }}</div></td>
                <td>{{ item.sku }}</td>
                <td>{{ item.location_name }}</td>
                <td class="text-right"><v-chip :color="item.on_hand <= 0 ? 'error' : 'grey'" size="small" variant="tonal">{{ item.on_hand }}</v-chip></td>
                <td class="text-right"><v-chip :color="item.available <= 0 ? 'error' : item.available <= item.min_stock ? 'warning' : 'success'" size="small" variant="tonal">{{ item.available }}</v-chip></td>
                <td class="text-right font-weight-bold">{{ item.min_stock }}</td>
              </tr>
              <tr v-if="filteredStockAlerts.length === 0">
                <td colspan="7" class="text-center pa-6">
                  <v-icon size="large" color="success">mdi-check-circle</v-icon>
                  <div class="mt-2 text-grey">No hay alertas de stock</div>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '@/i18n'
import { useTenant } from '@/composables/useTenant'
import reportsService from '@/services/reports.service'
import inventoryService from '@/services/inventory.service'
import { formatMoney, formatDate, formatDateTime } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const { tenantId } = useTenant()
const { t } = useI18n()

const breadcrumbs = [
  { title: 'Reportes', to: '/reports', disabled: false },
  { title: 'Ventas', disabled: true }
]

const loading = ref(false)
const reportTab = ref('daily')
const locations = ref([])
const locationFilter = ref(null)

const now = new Date()
const fromDate = ref(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10))
const toDate = ref(now.toISOString().substring(0, 10))

const summary = ref(null)
const salesByDay = ref([])
const topProducts = ref([])
const salesBySeller = ref([])
const salesByPayment = ref([])
const cashMovements = ref([])
const movementsSummary = ref(null)
const movementTypeFilter = ref('ALL')
const layawaySummary = ref(null)
const layawayContracts = ref([])

// Categorías
const salesByCategory = ref([])
const loadingCategories = ref(false)

// Stock Alerts
const stockAlerts = ref([])
const loadingAlerts = ref(false)
const alertLevelFilter = ref(null)
const alertLevelOptions = [
  { label: 'Sin stock', value: 'OUT_OF_STOCK' },
  { label: 'Stock bajo', value: 'LOW_STOCK' },
  { label: 'Sin disponible', value: 'NO_AVAILABLE' },
  { label: 'Disponible bajo', value: 'LOW_AVAILABLE' }
]

const filteredStockAlerts = computed(() => {
  if (!alertLevelFilter.value) return stockAlerts.value
  return stockAlerts.value.filter(item => item.alert_level === alertLevelFilter.value)
})
const stockAlertsCount = computed(() => stockAlerts.value.length)
const isFromAccounting = computed(() => String(route.query.from || '') === 'accounting')

const filteredMovements = computed(() => {
  if (movementTypeFilter.value === 'ALL') return cashMovements.value
  return cashMovements.value.filter(m => m.type === movementTypeFilter.value)
})

const alertColor = (level) => ({ OUT_OF_STOCK: 'error', LOW_STOCK: 'warning', NO_AVAILABLE: 'error', LOW_AVAILABLE: 'orange' }[level] || 'grey')
const alertIcon = (level) => ({ OUT_OF_STOCK: 'mdi-alert-circle', LOW_STOCK: 'mdi-alert', NO_AVAILABLE: 'mdi-alert-circle-outline', LOW_AVAILABLE: 'mdi-alert-outline' }[level] || 'mdi-information')
const alertLabel = (level) => ({ OUT_OF_STOCK: 'Sin stock', LOW_STOCK: 'Stock bajo', NO_AVAILABLE: 'Sin disponible', LOW_AVAILABLE: 'Disponible bajo' }[level] || level)

const loadCategories = async () => {
  if (!tenantId.value || !fromDate.value || !toDate.value) return
  loadingCategories.value = true
  try {
    const fd = fromDate.value + 'T00:00:00'
    const td = toDate.value + 'T23:59:59'
    const r = await reportsService.getSalesByCategory(tenantId.value, fd, td, locationFilter.value)
    if (r.success) salesByCategory.value = r.data
  } finally {
    loadingCategories.value = false
  }
}

const loadAllReports = async () => {
  if (!tenantId.value || !fromDate.value || !toDate.value) return
  loading.value = true
  const fd = fromDate.value + 'T00:00:00'
  const td = toDate.value + 'T23:59:59'
  const loc = locationFilter.value || null

  try {
    const [r1, r2, r3, r4, r5, r6, r7, r8, r9] = await Promise.all([
      reportsService.getSalesSummary(tenantId.value, fd, td, loc),
      reportsService.getSalesByDay(tenantId.value, fd, td, loc),
      reportsService.getTopProducts(tenantId.value, fd, td),
      reportsService.getSalesBySeller(tenantId.value, fd, td),
      reportsService.getSalesByPaymentMethod(tenantId.value, fd, td),
      reportsService.getCashMovements(tenantId.value, fd, td, loc),
      reportsService.getLayawaySummary(tenantId.value, fd, td, loc),
      reportsService.getLayawayPayments(tenantId.value, fd, td, loc),
      reportsService.getSalesByCategory(tenantId.value, fd, td, loc)
    ])

    if (r1.success) summary.value = r1.data
    if (r2.success) salesByDay.value = r2.data
    if (r3.success) topProducts.value = r3.data
    if (r4.success) salesBySeller.value = r4.data
    if (r5.success) salesByPayment.value = r5.data
    if (r6.success) { cashMovements.value = r6.data; movementsSummary.value = r6.summary }
    if (r7.success) { layawaySummary.value = r7.summary; layawayContracts.value = r7.contracts }
    if (r9.success) salesByCategory.value = r9.data
  } finally {
    loading.value = false
  }
}

const loadLocations = async () => {
  if (!tenantId.value) return
  const { default: locService } = await import('@/services/locations.service')
  const r = await locService.getLocations(tenantId.value, 1, 100)
  if (r.success) locations.value = r.data
}

const loadStockAlerts = async () => {
  if (!tenantId.value) return
  loadingAlerts.value = true
  try {
    const r = await inventoryService.getStockAlerts(tenantId.value, { location_id: locationFilter.value || undefined })
    if (r.success) stockAlerts.value = r.data
  } finally {
    loadingAlerts.value = false
  }
}

const goBackToAccounting = () => {
  const tab = String(route.query.tab || 'compliance')
  router.push({
    path: '/accounting',
    query: { tab }
  })
}

onMounted(async () => {
  await loadLocations()
  loadAllReports()
  loadStockAlerts()
})
</script>
