<template>
  <div v-if="context && featuredArticle" class="help-context-entry">
    <div class="help-context-entry__trigger">
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-lifebuoy"
        class="text-none"
        @click="openHelp"
      >
        Ayuda
      </v-btn>
      <v-chip
        v-if="articleProgress.total > 0"
        size="small"
        :color="articleProgress.isDone ? 'success' : context.color"
        variant="outlined"
      >
        {{ articleProgress.completed }}/{{ articleProgress.total }} pasos
      </v-chip>
    </div>

    <v-dialog
      v-model="dialog"
      :max-width="isMobile ? undefined : 920"
      :fullscreen="isMobile"
      scrollable
      class="help-context-dialog"
    >
      <v-card :class="['help-context-card', isDark ? 'help-context-card--dark' : 'help-context-card--light']">
        <v-card-title class="help-context-card__header d-flex align-center justify-space-between ga-3 flex-wrap">
          <div class="d-flex align-center ga-3">
            <v-avatar :color="context.color" variant="flat" size="38">
              <v-icon size="20">{{ context.icon }}</v-icon>
            </v-avatar>
            <div>
              <div class="text-subtitle-1 font-weight-bold">{{ context.title }}</div>
              <div class="text-caption text-medium-emphasis">Ayuda contextual del módulo</div>
            </div>
          </div>

          <div class="d-flex align-center ga-2">
            <v-chip
              v-if="articleProgress.total > 0"
              size="small"
              :color="articleProgress.isDone ? 'success' : context.color"
              variant="outlined"
            >
              {{ articleProgress.completed }}/{{ articleProgress.total }} pasos
            </v-chip>
            <v-btn icon="mdi-close" variant="text" class="help-context-card__close" @click="dialog = false" />
          </div>
        </v-card-title>

        <v-divider />

        <v-card-text class="d-flex flex-column flex-md-row justify-space-between ga-4">
          <div class="help-context-card__copy">
            <p class="text-body-2 mb-3">{{ context.summary }}</p>

            <div v-if="context.quickTips?.length" class="d-flex flex-wrap ga-2 mb-4">
              <v-chip
                v-for="tip in context.quickTips"
                :key="tip"
                size="small"
                variant="outlined"
              >
                {{ tip }}
              </v-chip>
            </div>

            <v-card variant="flat" class="help-context-card__article">
              <v-card-text>
                <div class="text-overline mb-1">Guía destacada</div>
                <div class="text-h6 mb-2">{{ featuredArticle.title }}</div>
                <p class="text-body-2 mb-3">{{ featuredArticle.summary }}</p>

                <div v-if="featuredArticle.steps?.length" class="d-flex flex-column ga-2">
                  <div
                    v-for="(step, index) in featuredArticle.steps.slice(0, 5)"
                    :key="step.id"
                    class="help-context-card__step"
                  >
                    <div class="text-caption font-weight-bold">Paso {{ index + 1 }}</div>
                    <div class="text-body-2 font-weight-medium">{{ step.title }}</div>
                    <div class="text-caption text-medium-emphasis">{{ step.description }}</div>
                  </div>
                </div>
              </v-card-text>
            </v-card>
          </div>

          <div class="help-context-card__actions d-flex flex-column align-md-end ga-2">
            <v-btn
              color="primary"
              variant="elevated"
              :to="{ path: '/help', query: { article: featuredArticle.slug, process: featuredArticle.process } }"
              @click="dialog = false"
            >
              Abrir guía
            </v-btn>
            <v-btn
              v-if="firstFaq"
              color="secondary"
              variant="tonal"
              :to="{ path: '/help', query: { process: featuredArticle.process, faq: firstFaq.id, article: featuredArticle.slug } }"
              @click="dialog = false"
            >
              Ver FAQ
            </v-btn>
            <v-btn
              color="grey"
              variant="text"
              :to="{ path: '/help', query: { process: featuredArticle.process } }"
              @click="dialog = false"
            >
              Centro de ayuda
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useHelpCenter } from '@/composables/useHelpCenter'
import { useDisplay } from 'vuetify'
import { useTheme } from '@/composables/useTheme'

const props = defineProps({
  contextKey: {
    type: String,
    required: true
  }
})

const dialog = ref(false)
const { mobile: isMobile } = useDisplay()
const { isDark } = useTheme()
const { getArticle, getFaq, getHelpContext, getArticleProgress, markArticleViewed } = useHelpCenter()

const context = computed(() => getHelpContext(props.contextKey))
const featuredArticle = computed(() => getArticle(context.value?.featuredArticle || ''))
const firstFaq = computed(() => getFaq(context.value?.faqIds?.[0] || ''))
const articleProgress = computed(() => {
  if (!featuredArticle.value) {
    return { completed: 0, total: 0, isDone: false }
  }
  return getArticleProgress(featuredArticle.value.slug)
})

function openHelp() {
  dialog.value = true
  if (featuredArticle.value?.slug) {
    markArticleViewed(featuredArticle.value.slug)
  }
}
</script>

<style scoped>
.help-context-entry {
  display: flex;
  justify-content: flex-end;
}

.help-context-entry__trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.help-context-card {
  border-radius: 18px;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  background: linear-gradient(145deg, rgba(253, 255, 255, 0.98), rgba(242, 248, 255, 0.96)) !important;
  box-shadow: 0 22px 40px rgba(16, 28, 49, 0.24);
}

.help-context-dialog :deep(.v-overlay__content) {
  width: min(920px, calc(100vw - 24px));
}

.help-context-card__header {
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.14);
  background: linear-gradient(120deg, rgba(54, 176, 111, 0.12), rgba(37, 99, 235, 0.08));
}

.help-context-card__close {
  border-radius: 12px;
  background: rgba(19, 31, 54, 0.06);
}

.help-context-card__copy {
  flex: 1 1 620px;
}

.help-context-card__actions {
  min-width: 180px;
}

.help-context-card__article {
  border-radius: 16px;
  border: 1px solid rgba(var(--v-theme-primary), 0.12);
  background: rgba(255, 255, 255, 0.94) !important;
}

.help-context-card__step {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(23, 33, 54, 0.06);
}

.help-context-card--dark {
  border-color: rgba(92, 133, 255, 0.22);
  background: linear-gradient(145deg, rgba(9, 17, 33, 0.985), rgba(6, 13, 26, 0.975)) !important;
  box-shadow: 0 26px 46px rgba(2, 7, 20, 0.48);
}

.help-context-card--dark .help-context-card__header {
  border-bottom-color: rgba(92, 133, 255, 0.18);
  background: linear-gradient(120deg, rgba(28, 122, 75, 0.24), rgba(25, 76, 167, 0.18));
}

.help-context-card--dark .help-context-card__close {
  background: rgba(255, 255, 255, 0.12);
}

.help-context-card--dark .help-context-card__article {
  border-color: rgba(92, 133, 255, 0.18);
  background: rgba(18, 28, 48, 0.94) !important;
}

.help-context-card--dark .help-context-card__step {
  background: rgba(255, 255, 255, 0.06);
}

.help-context-card--light .help-context-card__header {
  color: #18304f;
}
</style>
