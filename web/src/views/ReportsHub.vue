<template>
  <div>
    <!-- Header -->
    <div class="mb-5">
      <div class="text-h5 font-weight-bold">{{ t('reportsHub.title') }}</div>
      <div class="text-body-2 text-medium-emphasis">{{ todayLabel }}</div>
    </div>

    <!-- Accesos rápidos a reportes -->
    <div class="text-subtitle-1 font-weight-bold mb-3">{{ t('reportsHub.goTo') }}</div>
    <v-row>
      <v-col v-for="report in reportCards" :key="report.route" cols="12" sm="6" md="4" lg="2-4">
        <v-card
          :to="report.route"
          hover
          class="report-nav-card"
          variant="outlined"
        >
          <v-card-text class="pa-4 d-flex align-center gap-3">
            <v-avatar :color="report.color" size="40" variant="tonal">
              <v-icon :color="report.color">{{ report.icon }}</v-icon>
            </v-avatar>
            <div>
              <div class="text-body-2 font-weight-bold">{{ report.title }}</div>
              <div class="text-caption text-medium-emphasis">{{ report.subtitle }}</div>
            </div>
            <v-spacer></v-spacer>
            <v-icon size="16" color="grey">mdi-chevron-right</v-icon>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const todayLabel = computed(() => {
  return new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
})

const reportCards = [
  { route: '/reports/ventas',      title: t('reportsHub.salesTitle'),      subtitle: t('reportsHub.salesSubtitle'),      icon: 'mdi-cash-register',         color: 'blue'   },
  { route: '/reports/inventario',  title: t('reportsHub.inventoryTitle'),  subtitle: t('reportsHub.inventorySubtitle'),  icon: 'mdi-package-variant-closed', color: 'green'  },
  { route: '/reports/produccion',  title: t('reportsHub.productionTitle'), subtitle: t('reportsHub.productionSubtitle'), icon: 'mdi-factory',                color: 'purple' },
  { route: '/reports/cajas',       title: t('reportsHub.cashTitle'),       subtitle: t('reportsHub.cashSubtitle'),       icon: 'mdi-cash-multiple',          color: 'orange' },
  { route: '/reports/financiero',  title: t('reportsHub.financialTitle'),  subtitle: t('reportsHub.financialSubtitle'),  icon: 'mdi-finance',                color: 'teal'   },
]
</script>

<style scoped>
.report-nav-card {
  transition: transform 0.15s, box-shadow 0.15s;
  cursor: pointer;
}
.report-nav-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
.gap-3 {
  gap: 12px;
}
</style>
