<template>
  <div class="setup-page">
    <v-card class="setup-hero">
      <v-card-text class="pa-6 pa-md-8">
        <div class="d-flex flex-column flex-md-row justify-space-between ga-6">
          <div class="setup-hero__copy">
            <div class="setup-hero__eyebrow">Onboarding operativo</div>
            <h1 class="setup-hero__title">Asistente de Configuracion Inicial</h1>
            <p class="setup-hero__subtitle">
              Te guiamos por los procesos criticos para que vender, comprar, operar caja, controlar inventario y activar contabilidad sea claro desde el primer dia.
            </p>

            <div class="d-flex flex-wrap ga-2 mt-4">
              <v-chip color="primary" variant="flat">
                {{ overall.progressPercentage }}% listo
              </v-chip>
              <v-chip color="success" variant="tonal">
                {{ overall.operationalProcesses }}/{{ overall.totalProcesses }} procesos operativos
              </v-chip>
              <v-chip v-if="overall.nextAction" color="warning" variant="tonal">
                Siguiente: {{ overall.nextAction.processTitle }}
              </v-chip>
            </div>
          </div>

          <div class="setup-hero__panel">
            <div class="text-overline mb-2">Progreso esencial</div>
            <div class="text-h3 font-weight-bold mb-2">{{ overall.completedRequired }}/{{ overall.requiredSteps }}</div>
            <v-progress-linear
              :model-value="overall.progressPercentage"
              :color="overall.isFullyOperational ? 'success' : 'primary'"
              height="12"
              rounded
              class="mb-3"
            />
            <div class="text-body-2 text-medium-emphasis">
              {{ summaryMessage }}
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mt-4"
    >
      {{ error }}
    </v-alert>

    <v-row class="mt-1">
      <v-col cols="12" md="8">
        <v-card class="setup-summary-card h-100">
          <v-card-title class="d-flex align-center justify-space-between flex-wrap ga-2">
            <span class="d-flex align-center ga-2">
              <v-icon color="primary">mdi-compass-outline</v-icon>
              Ruta recomendada
            </span>
            <v-btn
              color="primary"
              variant="tonal"
              prepend-icon="mdi-refresh"
              :loading="loading"
              @click="refreshProgress"
            >
              Actualizar
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <v-alert
              v-if="overall.nextAction"
              type="info"
              variant="tonal"
              class="mb-4"
            >
              <strong>{{ overall.nextAction.processTitle }}</strong>: {{ overall.nextAction.title }}
              <div class="mt-2">{{ overall.nextAction.description }}</div>
            </v-alert>

            <v-alert
              v-else
              type="success"
              variant="tonal"
              class="mb-4"
            >
              Todos los procesos criticos ya pasaron la etapa de arranque.
            </v-alert>

            <v-row>
              <v-col
                v-for="process in processes"
                :key="process.id"
                cols="12"
                sm="6"
              >
                <v-sheet class="setup-process-card pa-4" rounded="xl">
                  <div class="d-flex align-center justify-space-between mb-3">
                    <div class="d-flex align-center ga-2">
                      <v-avatar :color="process.stateColor" variant="tonal" size="38">
                        <v-icon size="20">{{ process.icon }}</v-icon>
                      </v-avatar>
                      <div>
                        <div class="font-weight-bold">{{ process.title }}</div>
                        <div class="text-caption text-medium-emphasis">
                          {{ process.completedRequired }}/{{ process.requiredStepsCount }} esenciales
                        </div>
                      </div>
                    </div>
                    <v-chip :color="process.stateColor" size="small" variant="tonal">
                      {{ process.stateLabel }}
                    </v-chip>
                  </div>

                  <div class="text-body-2 mb-3">{{ process.description }}</div>

                  <v-progress-linear
                    :model-value="process.progressPercentage"
                    :color="process.stateColor"
                    height="8"
                    rounded
                    class="mb-3"
                  />

                  <div class="text-caption mb-3">
                    {{ process.nextStep ? `Siguiente paso: ${process.nextStep.title}` : 'Proceso completo' }}
                  </div>

                  <v-btn
                    block
                    :color="process.stateColor === 'error' ? 'primary' : process.stateColor"
                    variant="tonal"
                    :to="process.nextStep?.route || process.route"
                  >
                    {{ process.nextStep?.actionLabel || 'Abrir proceso' }}
                  </v-btn>
                </v-sheet>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card class="setup-sidebar-card h-100">
          <v-card-title class="d-flex align-center ga-2">
            <v-icon color="secondary">mdi-flag-checkered</v-icon>
            Objetivos de arranque
          </v-card-title>
          <v-divider />
          <v-list class="bg-transparent">
            <v-list-item v-for="item in launchGoals" :key="item.title">
              <template #prepend>
                <v-avatar :color="item.color" size="32" variant="tonal">
                  <v-icon size="16">{{ item.icon }}</v-icon>
                </v-avatar>
              </template>
              <v-list-item-title>{{ item.title }}</v-list-item-title>
              <v-list-item-subtitle class="text-wrap">{{ item.description }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <v-card
      v-if="accountingProcess && accountingProcess.state !== 'OPERATIONAL'"
      class="setup-accounting-card"
    >
      <v-card-title class="d-flex align-center justify-space-between flex-wrap ga-2">
        <span class="d-flex align-center ga-2">
          <v-icon color="secondary">mdi-scale-balance</v-icon>
          {{ accountingProcess.onboardingTitle }}
        </span>
        <v-chip :color="accountingProcess.stateColor" variant="tonal">
          {{ accountingProcess.stateLabel }}
        </v-chip>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <p class="text-body-2 mb-4">{{ accountingProcess.onboardingDescription }}</p>
        <v-list class="bg-transparent">
          <v-list-item
            v-for="item in accountingProcess.onboardingChecklist || []"
            :key="item"
          >
            <template #prepend>
              <v-icon color="secondary" size="18">mdi-check-circle-outline</v-icon>
            </template>
            <v-list-item-title>{{ item }}</v-list-item-title>
          </v-list-item>
        </v-list>

        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn
            color="secondary"
            variant="elevated"
            :to="accountingProcess.nextStep?.route || accountingProcess.route"
          >
            {{ accountingProcess.nextStep?.actionLabel || 'Continuar contabilidad' }}
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            :to="{ path: '/accounting', query: { tab: 'dashboard', onboarding: 'accounting-overview' } }"
          >
            Abrir modulo contable
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card class="mt-4">
      <v-card-title class="d-flex align-center justify-space-between flex-wrap ga-2">
        <span class="d-flex align-center ga-2">
          <v-icon color="primary">mdi-format-list-checks</v-icon>
          Checklist por proceso
        </span>
        <v-btn
          v-if="overall.isFullyOperational"
          color="success"
          variant="elevated"
          prepend-icon="mdi-point-of-sale"
          @click="startSelling"
        >
          Ir al Punto de Venta
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text>
        <v-expansion-panels
          v-model="expandedPanels"
          multiple
          variant="accordion"
        >
          <v-expansion-panel
            v-for="process in processes"
            :key="process.id"
            :value="process.id"
          >
            <v-expansion-panel-title>
              <div class="setup-panel-title d-flex align-center justify-space-between w-100 ga-3">
                <div class="d-flex align-center ga-3">
                  <v-avatar :color="process.stateColor" variant="tonal" size="38">
                    <v-icon size="20">{{ process.icon }}</v-icon>
                  </v-avatar>
                  <div>
                    <div class="font-weight-bold">{{ process.title }}</div>
                    <div class="text-caption text-medium-emphasis">{{ process.description }}</div>
                  </div>
                </div>

                <div class="d-flex align-center ga-2 flex-wrap justify-end">
                  <v-chip :color="process.stateColor" size="small" variant="tonal">
                    {{ process.stateLabel }}
                  </v-chip>
                  <v-chip size="small" variant="outlined">
                    {{ process.progressPercentage }}%
                  </v-chip>
                </div>
              </div>
            </v-expansion-panel-title>

            <v-expansion-panel-text>
              <v-alert
                v-if="process.blockers.length > 0"
                type="warning"
                variant="tonal"
                class="mb-4"
              >
                <strong>Bloqueantes actuales:</strong> {{ process.blockers.join(', ') }}
              </v-alert>

              <v-list class="bg-transparent">
                <v-list-item
                  v-for="step in process.steps"
                  :key="step.id"
                  class="setup-step"
                >
                  <template #prepend>
                    <v-avatar :color="step.stateColor" size="36" variant="tonal">
                      <v-icon size="18">{{ step.completed ? 'mdi-check' : (step.required ? 'mdi-alert' : 'mdi-arrow-right') }}</v-icon>
                    </v-avatar>
                  </template>

                  <v-list-item-title class="d-flex align-center flex-wrap ga-2">
                    <span>{{ step.title }}</span>
                    <v-chip
                      :color="step.required ? 'error' : 'grey'"
                      size="x-small"
                      variant="tonal"
                    >
                      {{ step.required ? 'Esencial' : 'Recomendado' }}
                    </v-chip>
                    <v-chip
                      v-if="step.kind === 'proof'"
                      color="info"
                      size="x-small"
                      variant="tonal"
                    >
                      Prueba final
                    </v-chip>
                  </v-list-item-title>

                  <v-list-item-subtitle class="text-wrap">
                    {{ step.description }}
                  </v-list-item-subtitle>

                  <template #append>
                    <div class="d-flex align-center ga-2 flex-wrap justify-end">
                      <v-chip :color="step.stateColor" size="small" variant="tonal">
                        {{ step.stateLabel }}
                      </v-chip>
                      <v-btn
                        v-if="!step.completed && step.route"
                        size="small"
                        color="primary"
                        variant="text"
                        :to="step.route"
                      >
                        {{ step.actionLabel }}
                      </v-btn>
                    </div>
                  </template>
                </v-list-item>
              </v-list>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </v-card>

    <div class="mt-4 d-flex justify-space-between flex-wrap ga-2">
      <v-btn color="grey" variant="text" @click="closeWizard">
        Cerrar
      </v-btn>
      <div class="d-flex flex-wrap ga-2">
        <v-btn
          v-if="overall.nextAction"
          color="primary"
          variant="elevated"
          :to="overall.nextAction.route"
        >
          {{ overall.nextAction.label }}
        </v-btn>
        <v-btn
          color="secondary"
          variant="tonal"
          prepend-icon="mdi-view-dashboard-outline"
          @click="goToHome"
        >
          Ir al dashboard
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTenant } from '@/composables/useTenant'
import { useSetupAssistant } from '@/composables/useSetupAssistant'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { loading, error, processes, processMap, overall, loadSetupReadiness } = useSetupAssistant()
const expandedPanels = ref([])

const getWizardStorageKey = (suffix) => `setup-wizard:${tenantId.value || 'no-tenant'}:${suffix}`

const launchGoals = [
  {
    title: 'Primera venta sin friccion',
    description: 'Caja, medios de pago, producto y datos comerciales listos.',
    icon: 'mdi-point-of-sale',
    color: 'primary'
  },
  {
    title: 'Primera compra registrada',
    description: 'Proveedor, sede y productos preparados para abastecimiento.',
    icon: 'mdi-cart-plus',
    color: 'deep-orange'
  },
  {
    title: 'Caja operativa',
    description: 'Asignacion y sesion de prueba para reducir bloqueos del equipo.',
    icon: 'mdi-cash-register',
    color: 'success'
  },
  {
    title: 'Contabilidad activable',
    description: 'Modulo listo para adoptarse sin detener POS ni inventario.',
    icon: 'mdi-scale-balance',
    color: 'secondary'
  }
]

const summaryMessage = computed(() => {
  if (overall.value.isFullyOperational) {
    return 'Excelente. Tus procesos criticos ya quedaron listos para operar.'
  }

  if (overall.value.nextAction) {
    return `Te falta avanzar en ${overall.value.nextAction.processTitle}: ${overall.value.nextAction.title}.`
  }

  return 'Estamos calculando que falta para dejar la operacion lista.'
})

const accountingProcess = computed(() => processMap.value.accounting || null)

const syncExpandedPanelsFromContext = () => {
  const nextPanels = new Set(expandedPanels.value || [])
  const stored = localStorage.getItem(getWizardStorageKey('expanded'))
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        parsed.forEach((panel) => nextPanels.add(panel))
      }
    } catch (_) {}
  }

  const focusProcess = String(route.query.process || '').trim()
  if (focusProcess && processMap.value[focusProcess]) {
    nextPanels.add(focusProcess)
  } else if (!nextPanels.size && overall.value.nextProcess?.id) {
    nextPanels.add(overall.value.nextProcess.id)
  }

  expandedPanels.value = [...nextPanels]
}

const refreshProgress = async () => {
  await loadSetupReadiness()
  syncExpandedPanelsFromContext()
}

const closeWizard = () => {
  localStorage.setItem('setupWizardDismissed', 'true')
  router.push('/')
}

const goToHome = () => {
  router.push('/')
}

const startSelling = () => {
  router.push('/pos')
}

onMounted(() => {
  loadSetupReadiness().then(() => {
    syncExpandedPanelsFromContext()
  })
})

watch(expandedPanels, (value) => {
  localStorage.setItem(getWizardStorageKey('expanded'), JSON.stringify(value || []))
})

watch(
  () => [route.query.process, tenantId.value],
  () => {
    syncExpandedPanelsFromContext()
  }
)
</script>

<style scoped>
.setup-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setup-hero {
  border: 1px solid rgba(66, 125, 255, 0.18);
  background:
    radial-gradient(circle at top right, rgba(120, 214, 75, 0.14), transparent 26%),
    radial-gradient(circle at left top, rgba(46, 90, 255, 0.16), transparent 28%),
    linear-gradient(145deg, rgba(11, 21, 46, 0.96), rgba(10, 18, 38, 0.92));
}

.setup-hero__copy {
  flex: 1 1 560px;
}

.setup-hero__panel {
  min-width: 260px;
  max-width: 320px;
  border-radius: 20px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(123, 154, 255, 0.18);
}

.setup-hero__eyebrow {
  font-size: 0.78rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #9db5f4;
  margin-bottom: 8px;
}

.setup-hero__title {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05;
  margin: 0 0 10px;
  color: #eff5ff;
}

.setup-hero__subtitle {
  margin: 0;
  max-width: 760px;
  color: #bfd0f7;
  font-size: 1rem;
}

.setup-summary-card,
.setup-sidebar-card {
  border-radius: 22px;
}

.setup-accounting-card {
  border-radius: 22px;
  border: 1px solid rgba(173, 106, 255, 0.18);
  background:
    radial-gradient(circle at top right, rgba(201, 123, 255, 0.12), transparent 28%),
    linear-gradient(145deg, rgba(28, 22, 48, 0.92), rgba(17, 16, 34, 0.9));
}

.setup-process-card {
  height: 100%;
  border: 1px solid rgba(72, 116, 214, 0.16);
  background: linear-gradient(180deg, rgba(23, 34, 64, 0.8), rgba(15, 24, 46, 0.72));
}

.setup-step {
  border: 1px solid rgba(109, 133, 192, 0.16);
  border-radius: 18px;
  margin-bottom: 10px;
}

.setup-panel-title {
  min-width: 0;
}

@media (max-width: 960px) {
  .setup-hero__panel {
    max-width: none;
  }
}
</style>
