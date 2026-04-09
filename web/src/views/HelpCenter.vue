<template>
  <div class="help-center ofir-page">
    <v-card class="help-center__hero mb-4">
      <v-card-text class="pa-6">
        <div class="d-flex flex-column flex-lg-row justify-space-between ga-6">
          <div class="help-center__hero-copy">
            <div class="help-center__eyebrow">Manual de usuario</div>
            <h1 class="help-center__title">Centro de ayuda OfirOne</h1>
            <p class="help-center__subtitle">
              Guias cortas, FAQs y checklists interactivos para que el equipo pueda operar venta, compra, caja, inventario y contabilidad sin depender de soporte.
            </p>

            <div class="d-flex flex-wrap ga-2 mt-4">
              <v-chip color="primary" variant="flat">{{ processes.length }} rutas de ayuda</v-chip>
              <v-chip color="success" variant="tonal">{{ articles.length }} guias operativas</v-chip>
              <v-chip color="secondary" variant="tonal">{{ faqs.length }} FAQs</v-chip>
            </div>
          </div>

          <div class="help-center__search-panel">
            <v-text-field
              v-model="searchTerm"
              prepend-inner-icon="mdi-magnify"
              label="Buscar ayuda"
              variant="outlined"
              density="comfortable"
              hide-details
              class="mb-3"
              placeholder="Ej: cobrar, stock, proveedor, cola contable"
            />
            <div class="text-caption text-medium-emphasis mb-2">Filtrar por proceso</div>
            <div class="d-flex flex-wrap ga-2">
              <v-chip
                :color="selectedProcess === 'all' ? 'primary' : 'grey'"
                :variant="selectedProcess === 'all' ? 'flat' : 'outlined'"
                @click="selectProcess('all')"
              >
                Todos
              </v-chip>
              <v-chip
                v-for="process in processes"
                :key="process.id"
                :color="selectedProcess === process.id ? process.color : 'grey'"
                :variant="selectedProcess === process.id ? 'flat' : 'outlined'"
                @click="selectProcess(process.id)"
              >
                {{ process.title }}
              </v-chip>
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-row class="mb-1">
      <v-col
        v-for="process in processes"
        :key="process.id"
        cols="12"
        sm="6"
        md="4"
      >
        <v-sheet class="help-center__process-card pa-4" rounded="xl">
          <div class="d-flex align-center justify-space-between ga-3 mb-2">
            <div class="d-flex align-center ga-2">
              <v-avatar :color="process.color" variant="tonal" size="36">
                <v-icon size="18">{{ process.icon }}</v-icon>
              </v-avatar>
              <div class="font-weight-bold">{{ process.title }}</div>
            </div>
            <v-chip size="x-small" variant="outlined">{{ getArticlesByProcess(process.id).length }} guias</v-chip>
          </div>
          <div class="text-body-2 text-medium-emphasis mb-3">
            {{ processDescriptions[process.id] }}
          </div>
          <v-btn
            block
            color="primary"
            variant="tonal"
            @click="openProcessGuide(process.id)"
          >
            Abrir guia
          </v-btn>
        </v-sheet>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" lg="5">
        <ListView
          title="Guias y manuales"
          icon="mdi-book-open-page-variant"
          :items="visibleArticles"
          :total-items="filteredArticles.length"
          :page-size="PAGE_SIZE"
          item-key="slug"
          title-field="title"
          avatar-icon="mdi-file-document-outline"
          avatar-color="primary"
          empty-message="No se encontraron guias con ese filtro."
          :searchable="false"
          :show-create-button="false"
          :editable="false"
          :deletable="false"
          :clickable="true"
          :auto-load="false"
          @load-page="loadArticlePage"
          @item-click="openArticle"
        >
          <template #subtitle="{ item }">
            {{ getProcess(item.process)?.title || 'General' }} • {{ item.estimatedMinutes }} min
          </template>
          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip
                v-if="isSelectedArticle(item.slug)"
                size="x-small"
                color="success"
                variant="flat"
              >
                Guia abierta
              </v-chip>
              <v-chip size="x-small" :color="getProcess(item.process)?.color || 'primary'" variant="tonal">
                {{ getArticleProgress(item.slug).completed }}/{{ getArticleProgress(item.slug).total }} pasos
              </v-chip>
              <v-chip size="x-small" variant="tonal">{{ item.audience }}</v-chip>
            </div>
            <div class="text-caption text-medium-emphasis mt-2">{{ item.summary }}</div>
          </template>
          <template #actions="{ item }">
            <v-btn
              variant="tonal"
              size="small"
              color="primary"
              @click.stop="openArticle(item)"
            >
              Abrir guia
            </v-btn>
          </template>
        </ListView>

        <v-card class="mt-4">
          <v-card-title class="d-flex align-center ga-2">
            <v-icon color="secondary">mdi-history</v-icon>
            Ultimas guias vistas
          </v-card-title>
          <v-divider />
          <v-card-text>
            <v-alert
              v-if="recentViewedArticles.length === 0"
              type="info"
              variant="tonal"
            >
              Aun no has abierto articulos. Empieza por la guia de primeros pasos.
            </v-alert>
            <div v-else class="d-flex flex-wrap ga-2">
              <v-chip
                v-for="article in recentViewedArticles"
                :key="article.slug"
                color="primary"
                variant="outlined"
                @click="openArticle(article)"
              >
                {{ article.title }}
              </v-chip>
            </div>
          </v-card-text>
        </v-card>

        <v-card class="mt-4">
          <v-card-title class="d-flex align-center ga-2">
            <v-icon color="warning">mdi-help-circle-outline</v-icon>
            FAQs rapidas
          </v-card-title>
          <v-divider />
          <v-card-text>
            <v-expansion-panels variant="accordion">
              <v-expansion-panel
                v-for="faq in quickFaqs"
                :key="faq.id"
              >
                <v-expansion-panel-title>{{ faq.question }}</v-expansion-panel-title>
                <v-expansion-panel-text>{{ faq.answer }}</v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card
          v-if="selectedArticle"
          ref="articlePanelRef"
          class="help-center__article-card"
        >
          <v-card-text class="pa-5 pa-md-6">
            <div class="d-flex flex-column flex-md-row justify-space-between ga-4 mb-4">
              <div>
                <div class="d-flex align-center ga-2 mb-2 flex-wrap">
                  <v-chip :color="selectedProcessMeta?.color || 'primary'" variant="tonal" size="small">
                    {{ selectedProcessMeta?.title || 'General' }}
                  </v-chip>
                  <v-chip size="small" variant="outlined">{{ selectedArticle.estimatedMinutes }} min</v-chip>
                  <v-chip size="small" variant="outlined">{{ selectedArticle.audience }}</v-chip>
                </div>
                <h2 class="help-center__article-title">{{ selectedArticle.title }}</h2>
                <p class="text-body-1 text-medium-emphasis mb-0">{{ selectedArticle.summary }}</p>
              </div>

              <div class="help-center__article-progress">
                <div class="text-caption text-medium-emphasis mb-1">Checklist de la guia</div>
                <div class="text-h5 font-weight-bold mb-2">
                  {{ selectedArticleProgress.completed }}/{{ selectedArticleProgress.total }}
                </div>
                <v-progress-linear
                  :model-value="selectedArticleProgress.percentage"
                  :color="selectedArticleProgress.isDone ? 'success' : 'primary'"
                  height="10"
                  rounded
                />
              </div>
            </div>

            <v-row class="mb-2">
              <v-col cols="12" md="5">
                <v-card variant="outlined" class="h-100">
                  <v-card-title class="text-subtitle-1">Antes de empezar</v-card-title>
                  <v-divider />
                  <v-list class="bg-transparent">
                    <v-list-item
                      v-for="item in selectedArticle.prerequisites"
                      :key="item"
                    >
                      <template #prepend>
                        <v-icon color="secondary" size="18">mdi-check-circle-outline</v-icon>
                      </template>
                      <v-list-item-title class="text-wrap">{{ item }}</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-card>
              </v-col>

              <v-col cols="12" md="7">
                <v-card variant="outlined" class="h-100">
                  <v-card-title class="text-subtitle-1">Resultado esperado</v-card-title>
                  <v-divider />
                  <v-card-text class="text-body-2">
                    {{ selectedArticle.expectedResult }}
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>

            <v-card
              v-if="selectedArticle.nextSteps?.length"
              variant="outlined"
              class="mb-4"
            >
              <v-card-title class="text-subtitle-1">Siguientes pasos</v-card-title>
              <v-divider />
              <v-list class="bg-transparent">
                <v-list-item
                  v-for="item in selectedArticle.nextSteps"
                  :key="item"
                >
                  <template #prepend>
                    <v-icon color="primary" size="18">mdi-arrow-right-circle-outline</v-icon>
                  </template>
                  <v-list-item-title class="text-wrap">{{ item }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-card>

            <v-card variant="outlined" class="mb-4">
              <v-card-title class="text-subtitle-1">Paso a paso</v-card-title>
              <v-divider />
              <v-card-text>
                <div
                  v-for="step in selectedArticle.steps"
                  :key="step.id"
                  class="help-center__step"
                >
                  <div class="d-flex align-start justify-space-between ga-3 flex-wrap">
                    <div class="d-flex align-start ga-3">
                      <v-checkbox-btn
                        :model-value="isArticleStepChecked(selectedArticle.slug, step.id)"
                        color="success"
                        @update:model-value="(value) => setArticleStepChecked(selectedArticle.slug, step.id, value)"
                      />
                      <div>
                        <div class="font-weight-bold">{{ step.title }}</div>
                        <div class="text-body-2 text-medium-emphasis mt-1">{{ step.description }}</div>
                      </div>
                    </div>
                    <v-btn
                      v-if="step.route"
                      size="small"
                      color="primary"
                      variant="tonal"
                      :to="step.route"
                    >
                      Abrir modulo
                    </v-btn>
                  </div>
                </div>
              </v-card-text>
            </v-card>

            <v-card variant="outlined" class="mb-4">
              <v-card-title class="text-subtitle-1">Errores comunes</v-card-title>
              <v-divider />
              <v-card-text>
                <v-expansion-panels variant="accordion">
                  <v-expansion-panel
                    v-for="errorItem in selectedArticle.commonErrors"
                    :key="errorItem.title"
                  >
                    <v-expansion-panel-title>{{ errorItem.title }}</v-expansion-panel-title>
                    <v-expansion-panel-text>{{ errorItem.answer }}</v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-card-text>
            </v-card>

            <v-card variant="outlined">
              <v-card-title class="text-subtitle-1">FAQs relacionadas</v-card-title>
              <v-divider />
              <v-card-text>
                <v-expansion-panels variant="accordion" v-model="expandedFaqs">
                  <v-expansion-panel
                    v-for="faq in selectedFaqs"
                    :key="faq.id"
                    :value="faq.id"
                  >
                    <v-expansion-panel-title>{{ faq.question }}</v-expansion-panel-title>
                    <v-expansion-panel-text>{{ faq.answer }}</v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-card-text>
            </v-card>

            <div v-if="relatedArticles.length > 0" class="mt-4">
              <div class="text-subtitle-2 mb-2">Tambien te puede servir</div>
              <div class="d-flex flex-wrap ga-2">
                <v-chip
                  v-for="article in relatedArticles"
                  :key="article.slug"
                  color="primary"
                  variant="outlined"
                  @click="openArticle(article)"
                >
                  {{ article.title }}
                </v-chip>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ListView from '@/components/ListView.vue'
import { useHelpCenter } from '@/composables/useHelpCenter'

const PAGE_SIZE = 6

const route = useRoute()
const router = useRouter()
const {
  articles,
  faqs,
  processes,
  getArticle,
  getFaq,
  getProcess,
  getArticlesByProcess,
  searchArticles,
  getArticleProgress,
  isArticleStepChecked,
  setArticleStepChecked,
  markArticleViewed,
  recentViewedArticles
} = useHelpCenter()

const processDescriptions = {
  'getting-started': 'Arranque guiado para dejar la empresa lista.',
  sales: 'Cobro, clientes, pagos y resultado de la venta.',
  purchases: 'Abastecimiento, proveedor y entrada a inventario.',
  cash: 'Apertura, operacion y cierre de sesiones de caja.',
  inventory: 'Stock, ajustes, traslados, kardex y cargue masivo.',
  accounting: 'Activacion gradual, cola y validacion contable.'
}

const currentPage = ref(1)
const searchTerm = ref(String(route.query.search || ''))
const expandedFaqs = ref([])
const articlePanelRef = ref(null)

const selectedProcess = computed(() => String(route.query.process || 'all'))
const filteredArticles = computed(() => searchArticles(searchTerm.value, selectedProcess.value))
const visibleArticles = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredArticles.value.slice(start, start + PAGE_SIZE)
})

const selectedArticle = computed(() => {
  const explicitSlug = String(route.query.article || '').trim()
  const explicitArticle = getArticle(explicitSlug)
  if (explicitArticle) return explicitArticle
  return filteredArticles.value[0] || getArticle('primeros-pasos')
})

const selectedProcessMeta = computed(() => getProcess(selectedArticle.value?.process || ''))
const selectedArticleProgress = computed(() => {
  if (!selectedArticle.value) {
    return { completed: 0, total: 0, percentage: 0, isDone: false }
  }
  return getArticleProgress(selectedArticle.value.slug)
})

const selectedFaqs = computed(() => {
  const articleFaqs = (selectedArticle.value?.faqIds || [])
    .map((faqId) => getFaq(faqId))
    .filter(Boolean)

  if (articleFaqs.length > 0) return articleFaqs

  return faqs.value.filter((faq) => faq.process === selectedArticle.value?.process)
})

const relatedArticles = computed(() => {
  return (selectedArticle.value?.related || [])
    .map((slug) => getArticle(slug))
    .filter(Boolean)
})

const quickFaqs = computed(() => {
  if (selectedProcess.value && selectedProcess.value !== 'all') {
    const scoped = faqs.value.filter((faq) => faq.process === selectedProcess.value)
    if (scoped.length > 0) return scoped.slice(0, 4)
  }

  const selectedArticleFaqs = selectedFaqs.value.slice(0, 4)
  if (selectedArticleFaqs.length > 0) return selectedArticleFaqs

  return faqs.value.slice(0, 4)
})

const isSelectedArticle = (slug) => selectedArticle.value?.slug === slug

const focusSelectedArticle = async () => {
  await nextTick()
  articlePanelRef.value?.$el?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  })
}

const openArticle = (article) => {
  if (!article?.slug) return

  if (selectedArticle.value?.slug === article.slug) {
    focusSelectedArticle()
    return
  }

  router.push({
    path: '/help',
    query: {
      ...route.query,
      article: article.slug,
      process: article.process,
      search: searchTerm.value || undefined,
      faq: undefined
    }
  })
}

const selectProcess = (processId) => {
  currentPage.value = 1
  router.push({
    path: '/help',
    query: {
      ...route.query,
      process: processId === 'all' ? undefined : processId,
      article: undefined
    }
  })
}

const openProcessGuide = (processId) => {
  const processArticles = getArticlesByProcess(processId)
  const firstArticle = processArticles[0] || null

  currentPage.value = 1
  router.push({
    path: '/help',
    query: {
      ...route.query,
      process: processId === 'all' ? undefined : processId,
      article: firstArticle?.slug || undefined,
      faq: undefined
    }
  })
}

const loadArticlePage = ({ page }) => {
  currentPage.value = page || 1
}

watch(searchTerm, () => {
  currentPage.value = 1
})

watch(selectedProcess, () => {
  currentPage.value = 1
})

watch(
  () => route.query.search,
  (value) => {
    searchTerm.value = String(value || '')
  }
)

watch(
  () => selectedArticle.value?.slug,
  (slug) => {
    if (!slug) return
    markArticleViewed(slug)
    focusSelectedArticle()
  },
  { immediate: true }
)

watch(
  () => route.query.faq,
  (faqId) => {
    expandedFaqs.value = faqId ? [String(faqId)] : []
  },
  { immediate: true }
)
</script>

<style scoped>
.help-center {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.help-center__hero {
  border-radius: 24px;
  border: 1px solid rgba(73, 124, 255, 0.2);
  background:
    radial-gradient(circle at 12% 0%, rgba(68, 111, 255, 0.16), transparent 32%),
    radial-gradient(circle at 100% 0%, rgba(120, 214, 75, 0.14), transparent 26%),
    linear-gradient(145deg, rgba(14, 24, 49, 0.94), rgba(10, 18, 36, 0.96));
}

.help-center__hero-copy {
  flex: 1 1 620px;
}

.help-center__search-panel {
  flex: 0 0 360px;
  max-width: 380px;
  padding: 20px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(125, 153, 255, 0.18);
}

.help-center__eyebrow {
  color: #9cb2f2;
  font-size: 0.78rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.help-center__title {
  margin: 0 0 10px;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05;
  color: #eff5ff;
}

.help-center__subtitle {
  margin: 0;
  color: #c3d3f7;
  max-width: 760px;
}

.help-center__process-card {
  height: 100%;
  border: 1px solid rgba(90, 121, 211, 0.16);
  background: linear-gradient(180deg, rgba(21, 33, 64, 0.82), rgba(13, 21, 42, 0.76));
}

.help-center__article-card {
  border-radius: 24px;
}

.help-center__article-title {
  margin: 0 0 8px;
  font-size: clamp(1.5rem, 3vw, 2.25rem);
}

.help-center__article-progress {
  min-width: 220px;
}

.help-center__step {
  border: 1px solid rgba(96, 122, 203, 0.16);
  border-radius: 18px;
  padding: 14px 16px;
  margin-bottom: 12px;
}

@media (max-width: 1280px) {
  .help-center__search-panel {
    max-width: none;
    flex-basis: auto;
  }
}
</style>
