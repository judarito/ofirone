<template>
  <div class="home-root ofir-home" :class="isDark ? 'ofir-home--dark' : 'ofir-home--light'">
    <template v-if="isSuperAdminDashboard">
      <v-row class="ofir-home__hero mb-4" align="center">
        <v-col cols="12" md="8">
          <div class="ofir-home__eyebrow">OfirOne Super Admin</div>
          <h1 class="ofir-home__title">Control de tenants</h1>
          <p class="ofir-home__subtitle">
            Administra empresas, usuarios administradores y accesos globales del sistema.
          </p>
        </v-col>
        <v-col cols="12" md="4" class="d-flex justify-md-end">
          <v-btn
            class="ofir-home__cta"
            color="primary"
            prepend-icon="mdi-office-building-cog"
            size="large"
            to="/tenant-management"
          >
            Ir a tenants
          </v-btn>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="7">
          <v-card class="ofir-panel">
            <v-card-title class="text-body-1 font-weight-bold">
              Acceso especial
            </v-card-title>
            <v-card-text class="text-body-2">
              Este usuario no pertenece a un tenant operativo. Por eso no se cargan widgets de ventas, inventario ni caja en el inicio.
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="5">
          <v-card class="ofir-panel">
            <v-card-title class="text-body-1 font-weight-bold">
              Acciones rápidas
            </v-card-title>
            <v-card-text class="d-flex flex-column" style="gap: 12px;">
              <v-btn color="primary" variant="tonal" to="/tenant-management" prepend-icon="mdi-office-building-plus">
                Gestionar tenants
              </v-btn>
              <v-btn color="secondary" variant="tonal" to="/superadmin/roles-menus" prepend-icon="mdi-shield-crown">
                Roles y menús
              </v-btn>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <template v-else>
    <v-row class="ofir-home__hero mb-3" align="center">
      <v-col cols="12" md="8">
        <div class="ofir-home__eyebrow">OfirOne Dashboard</div>
        <h1 class="ofir-home__title">Escritorio</h1>
        <p class="ofir-home__subtitle">
          {{ userProfile?.tenants?.name || 'Control central de ventas, inventario y alertas' }}
        </p>
      </v-col>
      <v-col cols="12" md="4" class="d-flex justify-md-end">
        <div class="ofir-home__actions">
          <v-btn
            class="ofir-home__cta"
            color="secondary"
            prepend-icon="mdi-plus"
            size="large"
            to="/pos"
          >
            Nueva Venta
          </v-btn>

          <v-btn
            v-if="showSetupButton"
            class="ofir-home__assistant-btn"
            :color="setupStatusColor"
            prepend-icon="mdi-rocket-launch-outline"
            variant="tonal"
            size="large"
            to="/setup"
          >
            Config inicial
            <v-badge
              inline
              :content="setupPendingCount"
              color="error"
              :model-value="setupPendingCount > 0"
              class="ml-2"
            />
          </v-btn>
        </div>
      </v-col>
    </v-row>

    <!-- Alerta: sesiones de caja con más de 24h abiertas -->
    <v-alert
      v-if="expiredSessions.length > 0"
      type="error"
      variant="tonal"
      class="mb-4 ofir-alert"
      prepend-icon="mdi-clock-alert"
      :title="`${expiredSessions.length} caja${expiredSessions.length > 1 ? 's' : ''} con sesión abierta por más de 24 horas`"
    >
      <div class="text-body-2 mt-1">
        <span v-for="(s, i) in expiredSessions" :key="s.cash_session_id">
          <strong>{{ s.cash_register?.name }}</strong>
          ({{ s.cash_register?.location?.name }}) — {{ Math.floor((Date.now()-new Date(s.opened_at))/3600000) }}h abierta por {{ s.opened_by_user?.full_name }}<span v-if="i < expiredSessions.length-1">, </span>
        </span>
      </div>
      <template #append>
        <v-btn size="small" variant="outlined" color="error" to="/cash-sessions">{{ t('home.viewCashRegisters') }}</v-btn>
      </template>
    </v-alert>

    <!-- Alerta: cuentas por pagar a proveedores vencidas / por vencer -->
    <v-alert
      v-if="canViewSupplierPayables && (supplierPayablesOverdueCount > 0 || supplierPayablesDueSoonCount > 0)"
      :type="supplierPayablesOverdueCount > 0 ? 'error' : 'warning'"
      variant="tonal"
      class="mb-4 ofir-alert"
      prepend-icon="mdi-file-alert"
      :title="supplierPayablesAlertTitle"
    >
      <div class="text-body-2 mt-1">
        <span v-if="supplierPayablesOverdueCount > 0">
          {{ t('home.overdue') }}: <strong>{{ supplierPayablesOverdueCount }}</strong>
          ({{ formatMoney(supplierPayablesOverdueAmount) }})
        </span>
        <span v-if="supplierPayablesDueSoonCount > 0">
          <span v-if="supplierPayablesOverdueCount > 0"> • </span>
          {{ t('home.dueSoon7Days') }}: <strong>{{ supplierPayablesDueSoonCount }}</strong>
          ({{ formatMoney(supplierPayablesDueSoonAmount) }})
        </span>
      </div>
      <template #append>
        <v-btn size="small" variant="outlined" :color="supplierPayablesOverdueCount > 0 ? 'error' : 'warning'" to="/purchases">
          {{ t('app.viewPurchases') }}
        </v-btn>
      </template>
    </v-alert>

    <!-- KPI Cards de ventas -->
    <v-row class="mb-1">
      <!-- Ventas Hoy -->
      <v-col cols="12" sm="4">
        <v-card variant="tonal" color="blue" class="kpi-home-card ofir-panel ofir-kpi">
          <v-card-text class="pa-4">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption font-weight-bold text-uppercase text-medium-emphasis">{{ t('home.salesToday') }}</span>
              <v-avatar color="blue" size="32">
                <v-icon color="white" size="16">mdi-calendar-today</v-icon>
              </v-avatar>
            </div>
            <div v-if="kpiLoading" class="text-h6 text-blue font-weight-bold">—</div>
            <div v-else class="text-h6 text-blue font-weight-bold">{{ formatMoney(kpis?.today?.total || 0) }}</div>
            <div class="text-caption text-medium-emphasis mt-1">{{ kpis?.today?.count || 0 }} {{ t('home.transactions') }}</div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Ventas Este Mes -->
      <v-col cols="12" sm="4">
        <v-card variant="tonal" color="green" class="kpi-home-card ofir-panel ofir-kpi">
          <v-card-text class="pa-4">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption font-weight-bold text-uppercase text-medium-emphasis">{{ t('home.thisMonth') }}</span>
              <v-avatar color="green" size="32">
                <v-icon color="white" size="16">mdi-calendar-month</v-icon>
              </v-avatar>
            </div>
            <div v-if="kpiLoading" class="text-h6 text-green font-weight-bold">—</div>
            <div v-else class="text-h6 text-green font-weight-bold">{{ formatMoney(kpis?.month?.total || 0) }}</div>
            <div class="d-flex align-center flex-wrap mt-1" style="gap:4px">
              <span class="text-caption text-medium-emphasis">{{ kpis?.month?.count || 0 }} {{ t('home.transShort') }}</span>
              <v-chip
                v-if="kpis?.month?.vs_prev !== null && kpis?.month?.vs_prev !== undefined"
                :color="parseFloat(kpis.month.vs_prev) >= 0 ? 'green' : 'red'"
                size="x-small" variant="tonal"
              >
                <v-icon start size="10">{{ parseFloat(kpis.month.vs_prev) >= 0 ? 'mdi-trending-up' : 'mdi-trending-down' }}</v-icon>
                {{ Math.abs(kpis.month.vs_prev) }}% {{ t('home.vsPreviousMonth') }}
              </v-chip>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Ventas Este Año -->
      <v-col cols="12" sm="4">
        <v-card variant="tonal" color="purple" class="kpi-home-card ofir-panel ofir-kpi">
          <v-card-text class="pa-4">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption font-weight-bold text-uppercase text-medium-emphasis">{{ t('home.thisYear') }}</span>
              <v-avatar color="purple" size="32">
                <v-icon color="white" size="16">mdi-calendar-blank</v-icon>
              </v-avatar>
            </div>
            <div v-if="kpiLoading" class="text-h6 text-purple font-weight-bold">—</div>
            <div v-else class="text-h6 text-purple font-weight-bold">{{ formatMoney(kpis?.year?.total || 0) }}</div>
            <div class="text-caption text-medium-emphasis mt-1">{{ kpis?.year?.count || 0 }} {{ t('home.totalTransactions') }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Gráficas -->
    <v-row class="mb-1">
      <!-- Tendencia 30 días -->
      <v-col cols="12" md="8">
        <v-card class="ofir-panel">
          <v-card-title class="text-body-2 font-weight-bold pa-3 pb-0 d-flex align-center">
            <v-icon start color="blue" size="18">mdi-chart-line</v-icon>
            {{ t('home.dailySalesLast30Days') }}
          </v-card-title>
          <v-card-text class="pa-1 pt-0">
            <div v-if="kpiLoading" class="d-flex align-center justify-center" style="height:200px">
              <v-progress-circular indeterminate color="blue" size="28"></v-progress-circular>
            </div>
            <apexchart
              v-else-if="dailySeries.length"
              :key="`trend-${chartThemeMode}`"
              type="area"
              height="200"
              :options="trendChartOptions"
              :series="trendSeries"
            ></apexchart>
            <div v-else class="d-flex align-center justify-center text-medium-emphasis text-caption" style="height:200px">
              {{ t('home.noData') }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Métodos de pago -->
      <v-col cols="12" md="4">
        <v-card height="100%" class="ofir-panel">
          <v-card-title class="text-body-2 font-weight-bold pa-3 pb-0 d-flex align-center">
            <v-icon start color="teal" size="18">mdi-credit-card-multiple</v-icon>
            {{ t('home.paymentMethods') }}
            <span class="text-caption font-weight-regular text-medium-emphasis ml-1">({{ t('home.month') }})</span>
          </v-card-title>
          <v-card-text class="pa-1 pt-0">
            <div v-if="kpiLoading" class="d-flex align-center justify-center" style="height:200px">
              <v-progress-circular indeterminate color="teal" size="28"></v-progress-circular>
            </div>
            <apexchart
              v-else-if="paymentMethods.length"
              :key="`donut-${chartThemeMode}`"
              type="donut"
              height="200"
              :options="donutChartOptions"
              :series="donutSeries"
            ></apexchart>
            <div v-else class="d-flex align-center justify-center text-medium-emphasis text-caption" style="height:200px">
              {{ t('home.noData') }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Top productos del mes -->
    <v-row class="mb-1">
      <v-col cols="12">
        <v-card class="ofir-panel">
          <v-card-title class="text-body-2 font-weight-bold pa-3 pb-0 d-flex align-center">
            <v-icon start color="orange" size="18">mdi-trophy</v-icon>
            {{ t('home.topProductsOfMonth') }}
            <v-spacer></v-spacer>
            <v-btn to="/reports/ventas" variant="text" color="blue" size="x-small" append-icon="mdi-arrow-right" class="text-caption">
              {{ t('home.viewDetail') }}
            </v-btn>
          </v-card-title>
          <v-card-text class="pa-1 pt-0">
            <div v-if="kpiLoading" class="d-flex align-center justify-center" style="height:160px">
              <v-progress-circular indeterminate color="orange" size="28"></v-progress-circular>
            </div>
            <apexchart
              v-else-if="topProducts.length"
              :key="`bar-${chartThemeMode}`"
              type="bar"
              height="180"
              :options="barChartOptions"
              :series="barSeries"
            ></apexchart>
            <div v-else class="d-flex align-center justify-center text-medium-emphasis text-caption" style="height:160px">
              {{ t('home.noData') }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Widget de Pronóstico de Ventas con IA -->
    <v-row>
      <v-col cols="12">
        <SalesForecastWidget />
      </v-col>
    </v-row>

    <!-- Accesos directos -->
    <v-row>
      <v-col
        v-for="card in visibleCards"
        :key="card.title"
        cols="12"
        sm="6"
        md="4"
      >
        <v-card class="ofir-panel ofir-shortcut-card" elevation="2" hover @click="navigateTo(card.route)" style="cursor: pointer;">
          <v-card-title class="d-flex flex-column align-center text-center pt-4">
            <v-avatar :color="card.color" variant="tonal" size="54" class="mb-2">
              <v-icon color="white" size="28">
                {{ card.icon }}
              </v-icon>
            </v-avatar>
            <span>{{ card.title }}</span>
          </v-card-title>
          <v-card-text class="text-center pt-2">
            {{ card.description }}
          </v-card-text>
          <v-card-actions class="justify-center pb-4">
            <v-btn :color="card.color" variant="tonal" @click.stop="navigateTo(card.route)">
              Ir
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'
import { useCashSession } from '@/composables/useCashSession'
import { useAuth } from '@/composables/useAuth'
import { useTenant } from '@/composables/useTenant'
import { useTheme } from '@/composables/useTheme'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAppAlerts } from '@/composables/useAppAlerts'
import { useSuperAdmin } from '@/composables/useSuperAdmin'
import { useSetupAssistant } from '@/composables/useSetupAssistant'
import { useI18n } from '@/i18n'
import SalesForecastWidget from '@/components/SalesForecastWidget.vue'
import reportsService from '@/services/reports.service'
import cashService from '@/services/cash.service'
import { formatMoney } from '@/utils/formatters'

const apexchart = VueApexCharts

const router = useRouter()
const { t } = useI18n()
const { loadPOSContext } = useCashSession()
const { userProfile } = useAuth()
const { tenantId } = useTenant()
const { isDark } = useTheme()
const { cashSessionMaxHours } = useTenantSettings()
const { canManageTenants } = useSuperAdmin()
const { overall: setupOverall, loadSetupReadiness } = useSetupAssistant()
const isSuperAdminDashboard = computed(() => canManageTenants.value && !userProfile.value)
const setupPendingCount = computed(() => Math.max(setupOverall.value.requiredSteps - setupOverall.value.completedRequired, 0))
const showSetupButton = computed(() => (
  !!tenantId.value &&
  !!userProfile.value &&
  setupOverall.value.requiredSteps > 0 &&
  !setupOverall.value.isFullyOperational
))
const setupStatusColor = computed(() => {
  if ((setupOverall.value.requiredSteps - setupOverall.value.completedRequired) <= 1) return 'warning'
  return 'error'
})

// ─── KPIs & charts ────────────────────────────────────────────────────────
const kpiLoading     = ref(true)
const kpis           = ref(null)
const dailySeries    = ref([])
const topProducts    = ref([])
const paymentMethods = ref([])
const expiredSessions = ref([])
const { payableSummary } = useAppAlerts()
const canViewSupplierPayables = computed(() => {
  const roles = (userProfile.value?.roles || []).map(r => r.name)
  return roles.includes('ADMINISTRADOR') || roles.includes('GERENTE')
})
const supplierPayablesOverdueCount = computed(() => payableSummary.value.overdueCount)
const supplierPayablesDueSoonCount = computed(() => payableSummary.value.dueSoonCount)
const supplierPayablesOverdueAmount = computed(() => payableSummary.value.overdueAmount)
const supplierPayablesDueSoonAmount = computed(() => payableSummary.value.dueSoonAmount)
const supplierPayablesAlertTitle = computed(() => {
  if (supplierPayablesOverdueCount.value > 0) {
    return `${supplierPayablesOverdueCount.value} CxP de proveedores vencidas`
  }
  return `${supplierPayablesDueSoonCount.value} CxP de proveedores por vencer`
})

const chartThemeMode = computed(() => isDark.value ? 'dark' : 'light')
const chartTextColor = computed(() => isDark.value ? '#E5E7EB' : '#334155')
const chartGridColor = computed(() => isDark.value ? '#3F3F46' : '#E2E8F0')

// Trend chart
const trendSeries = computed(() => [{
  name: 'Ventas',
  data: dailySeries.value.map(d => ({ x: d.date, y: Math.round(d.total) }))
}])
const trendChartOptions = computed(() => ({
  chart: {
    toolbar: { show: false },
    sparkline: { enabled: false },
    animations: { enabled: false },
    background: 'transparent',
    foreColor: chartTextColor.value
  },
  theme: { mode: chartThemeMode.value },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2 },
  fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.03 } },
  colors: ['#1565C0'],
  xaxis: {
    type: 'category', tickAmount: 8,
    labels: { rotate: -30, style: { fontSize: '10px', colors: chartTextColor.value }, formatter: v => { if (!v) return ''; const d = new Date(v + 'T00:00:00'); return `${d.getDate()}/${d.getMonth() + 1}` } }
  },
  yaxis: { labels: { style: { fontSize: '10px', colors: chartTextColor.value }, formatter: v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}` } },
  tooltip: { theme: chartThemeMode.value, y: { formatter: v => formatMoney(v) } },
  grid: { borderColor: chartGridColor.value, padding: { left: 4, right: 4 } }
}))

// Donut chart
const methodLabels = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', OTHER: 'Otro' }
const donutSeries  = computed(() => paymentMethods.value.map(p => Math.round(p.total)))
const donutChartOptions = computed(() => ({
  chart: {
    toolbar: { show: false },
    animations: { enabled: false },
    background: 'transparent',
    foreColor: chartTextColor.value
  },
  theme: { mode: chartThemeMode.value },
  labels: paymentMethods.value.map(p => methodLabels[p.method] || p.method),
  colors: ['#00897B', '#1565C0', '#F57C00', '#7B1FA2', '#C62828', '#546E7A'],
  dataLabels: { enabled: true, style: { fontSize: '10px' }, formatter: v => `${v.toFixed(1)}%` },
  legend: { position: 'bottom', fontSize: '10px', labels: { colors: chartTextColor.value } },
  tooltip: { theme: chartThemeMode.value, y: { formatter: v => formatMoney(v) } },
  plotOptions: { pie: { donut: { size: '60%', labels: { show: true, total: { show: true, label: 'Total', color: chartTextColor.value, fontSize: '11px', formatter: () => formatMoney(donutSeries.value.reduce((a, b) => a + b, 0)) } } } } }
}))

// Bar chart
const barSeries = computed(() => [{ name: 'Ingresos', data: topProducts.value.map(p => Math.round(p.revenue)) }])
const barChartOptions = computed(() => ({
  chart: {
    toolbar: { show: false },
    animations: { enabled: false },
    background: 'transparent',
    foreColor: chartTextColor.value
  },
  theme: { mode: chartThemeMode.value },
  plotOptions: { bar: { horizontal: true, barHeight: '55%', borderRadius: 3 } },
  colors: ['#E65100'],
  dataLabels: { enabled: true, style: { fontSize: '10px' }, formatter: v => formatMoney(v) },
  xaxis: {
    categories: topProducts.value.map(p => p.name.length > 30 ? p.name.substring(0, 28) + '…' : p.name),
    labels: { style: { fontSize: '10px', colors: chartTextColor.value }, formatter: v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}` }
  },
  yaxis: { labels: { style: { colors: chartTextColor.value } } },
  tooltip: { theme: chartThemeMode.value, y: { formatter: v => formatMoney(v) } },
  grid: { borderColor: chartGridColor.value, padding: { left: 4, right: 8 } }
}))

async function loadKPIs() {
  if (!tenantId.value) return
  kpiLoading.value = true
  const res = await reportsService.getDashboardSummary(tenantId.value)
  if (res.success) {
    kpis.value           = res.kpis
    dailySeries.value    = res.dailySeries
    topProducts.value    = res.topProducts
    paymentMethods.value = res.paymentMethods
  } else {
    console.warn('Dashboard summary RPC no disponible:', res.error)
    kpis.value = null
    dailySeries.value = []
    topProducts.value = []
    paymentMethods.value = []
  }
  kpiLoading.value = false
}

onMounted(async () => {
  if (isSuperAdminDashboard.value) return

  const tasks = [
    loadPOSContext(),
    loadKPIs()
  ]

  if (tenantId.value && userProfile.value) {
    tasks.push(loadSetupReadiness())
  }

  await Promise.all(tasks)

  if (tenantId.value) {
    const r = await cashService.getExpiredSessions(tenantId.value, cashSessionMaxHours.value)
    if (r.success) expiredSessions.value = r.data
  }
})

const cards = ref([
  {
    title: t('home.pos'),
    icon: 'mdi-point-of-sale',
    color: 'primary',
    description: t('home.posDescription'),
    route: '/pos',
    roles: ['ADMINISTRADOR', 'CAJERO', 'VENDEDOR', 'GERENTE'] // Todos
  },
  {
    title: t('home.products'),
    icon: 'mdi-package-variant',
    color: 'success',
    description: t('home.productsDescription'),
    route: '/products',
    roles: ['ADMINISTRADOR', 'GERENTE', 'VENDEDOR'] // NO cajeros
  },
  {
    title: t('home.sales'),
    icon: 'mdi-cart',
    color: 'info',
    description: t('home.salesDescription'),
    route: '/sales',
    roles: ['ADMINISTRADOR', 'CAJERO', 'VENDEDOR', 'GERENTE'] // Todos
  },
  {
    title: t('home.layaway'),
    icon: 'mdi-calendar-clock',
    color: 'blue',
    description: t('home.layawayDescription'),
    route: '/layaway',
    roles: ['ADMINISTRADOR', 'CAJERO', 'VENDEDOR', 'GERENTE'] // Todos
  },
  {
    title: t('home.inventory'),
    icon: 'mdi-warehouse',
    color: 'orange',
    description: t('home.inventoryDescription'),
    route: '/inventory',
    roles: ['ADMINISTRADOR', 'GERENTE'] // NO cajeros
  },
  {
    title: t('home.purchases'),
    icon: 'mdi-cart-plus',
    color: 'teal',
    description: t('home.purchasesDescription'),
    route: '/purchases',
    roles: ['ADMINISTRADOR', 'GERENTE'] // NO cajeros
  },
  {
    title: t('home.reports'),
    icon: 'mdi-chart-bar',
    color: 'purple',
    description: t('home.reportsDescription'),
    route: '/reports',
    roles: ['ADMINISTRADOR', 'CAJERO', 'VENDEDOR', 'GERENTE'] // Todos
  },
])

// Filtrar cards según roles del usuario
const visibleCards = computed(() => {
  if (!userProfile.value?.roles) return []
  
  const userRoles = userProfile.value.roles.map(r => r.name)
  
  return cards.value.filter(card => {
    // Si el usuario tiene al menos uno de los roles requeridos
    return card.roles.some(role => userRoles.includes(role))
  })
})

const navigateTo = (route) => {
  if (route) {
    router.push(route)
  }
}
</script>

<style scoped>
.ofir-home {
  --ofir-green: #78d64b;
  --ofir-blue: #2c62f6;
}

.ofir-home__hero {
  border-bottom: 1px solid transparent;
  margin-bottom: 18px;
  padding-bottom: 10px;
}

.ofir-home--dark .ofir-home__hero {
  border-bottom-color: rgba(109, 141, 255, 0.22);
}

.ofir-home--light .ofir-home__hero {
  border-bottom-color: rgba(44, 98, 246, 0.14);
}

.ofir-home__eyebrow {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 1.4px;
  opacity: 0.72;
  margin-bottom: 2px;
}

.ofir-home__title {
  margin: 0;
  font-size: clamp(2rem, 3vw, 2.8rem);
  line-height: 1.05;
  letter-spacing: -0.5px;
}

.ofir-home__subtitle {
  margin-top: 6px;
  margin-bottom: 0;
  opacity: 0.82;
}

.ofir-home--dark .ofir-home__eyebrow,
.ofir-home--dark .ofir-home__subtitle {
  color: #9fb4ed;
}

.ofir-home--dark .ofir-home__title {
  color: #eff5ff;
}

.ofir-home--light .ofir-home__eyebrow,
.ofir-home--light .ofir-home__subtitle {
  color: #4e628b;
}

.ofir-home--light .ofir-home__title {
  color: #1f3661;
}

.ofir-home__cta {
  border-radius: 14px;
  font-weight: 700;
  box-shadow: 0 12px 24px rgba(77, 189, 66, 0.25);
}

.ofir-home__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 420px;
}

.ofir-home__assistant-btn {
  border-radius: 14px;
  font-weight: 700;
}

.ofir-alert {
  border-radius: 14px;
  border: 1px solid transparent;
}

.ofir-home--dark .ofir-alert {
  border-color: rgba(111, 136, 201, 0.24);
}

.ofir-home--light .ofir-alert {
  border-color: rgba(38, 95, 204, 0.2);
}

.ofir-panel {
  border-radius: 18px;
  border: 1px solid transparent;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.ofir-home--dark .ofir-panel {
  background: linear-gradient(145deg, rgba(15, 24, 48, 0.88), rgba(12, 19, 38, 0.9)) !important;
  border-color: rgba(111, 136, 201, 0.22);
  box-shadow: 0 10px 24px rgba(1, 4, 11, 0.42);
}

.ofir-home--light .ofir-panel {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(244, 249, 255, 0.95)) !important;
  border-color: rgba(44, 98, 246, 0.16);
  box-shadow: 0 10px 20px rgba(45, 84, 165, 0.1);
}

.kpi-home-card {
  border-radius: 16px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.ofir-kpi {
  min-height: 130px;
}

.kpi-home-card:hover {
  transform: translateY(-4px);
}

.ofir-shortcut-card {
  overflow: hidden;
}

.ofir-shortcut-card :deep(.v-card-title) {
  font-weight: 700;
}

.ofir-shortcut-card :deep(.v-icon) {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.ofir-home--dark :deep(.apexcharts-canvas),
.ofir-home--dark :deep(.apexcharts-svg),
.ofir-home--dark :deep(.apexcharts-inner) {
  background: transparent !important;
}

.ofir-home--dark :deep(.apexcharts-text),
.ofir-home--dark :deep(.apexcharts-legend-text),
.ofir-home--dark :deep(.apexcharts-xaxis-label),
.ofir-home--dark :deep(.apexcharts-yaxis-label) {
  fill: #dbe6ff !important;
  color: #dbe6ff !important;
}

.ofir-home--dark :deep(.apexcharts-gridline) {
  stroke: #2f3f65 !important;
}

.ofir-home--light :deep(.apexcharts-gridline) {
  stroke: #cfdaee !important;
}

.ofir-home--light :deep(.apexcharts-text),
.ofir-home--light :deep(.apexcharts-legend-text),
.ofir-home--light :deep(.apexcharts-xaxis-label),
.ofir-home--light :deep(.apexcharts-yaxis-label) {
  fill: #2f466d !important;
  color: #2f466d !important;
}

@media (max-width: 960px) {
  .ofir-home__hero {
    margin-bottom: 12px;
    padding-bottom: 8px;
  }

  .ofir-home__title {
    font-size: 2rem;
  }

  .ofir-home__cta {
    width: 100%;
  }

  .ofir-home__actions {
    max-width: none;
  }

  .ofir-home__assistant-btn {
    width: 100%;
  }
}
</style>
