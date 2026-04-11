<template>
  <v-card variant="outlined" class="product-media-manager">
    <v-card-text>
      <div class="d-flex flex-wrap align-center ga-3 mb-3">
        <div>
          <div class="text-subtitle-2 font-weight-bold">Fotos del producto</div>
          <div class="text-body-2 text-medium-emphasis">
            JPG optimizado, máximo 2MB por imagen y hasta {{ MAX_PRODUCT_PHOTOS }} fotos por producto.
          </div>
        </div>
        <v-spacer />
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-camera-outline"
          :loading="busy"
          :disabled="disableUploadActions"
          @click="openCameraPicker"
        >
          Cámara
        </v-btn>
        <v-btn
          color="secondary"
          variant="tonal"
          prepend-icon="mdi-image-outline"
          :loading="busy"
          :disabled="disableUploadActions"
          @click="openLibraryPicker"
        >
          Elegir foto
        </v-btn>
      </div>

      <input
        ref="cameraInput"
        class="d-none"
        type="file"
        accept="image/*"
        capture="environment"
        @change="handleFileSelection"
      >
      <input
        ref="libraryInput"
        class="d-none"
        type="file"
        accept="image/*"
        @change="handleFileSelection"
      >

      <v-alert v-if="!productId" type="info" variant="tonal" class="mb-3">
        Guarda el producto primero para habilitar carga de fotos, portada y sugerencias IA.
      </v-alert>

      <v-alert v-else-if="mediaLimitReached" type="warning" variant="tonal" class="mb-3">
        Llegaste al límite de fotos. Elimina una si quieres reemplazarla.
      </v-alert>

      <v-alert v-if="noticeMessage" :type="noticeColor" variant="tonal" class="mb-3">
        {{ noticeMessage }}
      </v-alert>

      <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-3">
        {{ errorMessage }}
      </v-alert>

      <div v-if="loading" class="d-flex align-center ga-3 text-body-2 text-medium-emphasis py-6">
        <v-progress-circular indeterminate color="primary" size="20" />
        Cargando fotos del producto...
      </div>

      <template v-else-if="productId">
        <v-row v-if="mediaItems.length" class="mb-2">
          <v-col
            v-for="media in mediaItems"
            :key="media.media_id"
            cols="6"
            sm="4"
            md="3"
          >
            <v-card
              variant="outlined"
              class="media-thumb-card"
              :class="{ 'media-thumb-card--active': media.media_id === selectedMedia?.media_id }"
              @click="selectedMediaId = media.media_id"
            >
              <v-img
                v-if="media.signed_url"
                :src="media.signed_url"
                height="120"
                cover
              />
              <div v-else class="media-thumb-placeholder d-flex align-center justify-center">
                <v-icon size="28" color="medium-emphasis">mdi-image-outline</v-icon>
              </div>
              <div class="d-flex flex-wrap ga-1 pa-2">
                <v-chip v-if="media.is_cover" size="x-small" color="success" variant="flat">Portada</v-chip>
                <v-chip v-if="media.ai_status === 'READY'" size="x-small" color="info" variant="tonal">IA</v-chip>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <v-alert v-else type="info" variant="tonal">
          Este producto aún no tiene fotos. Puedes tomar una o elegirla desde tu equipo.
        </v-alert>

        <v-card v-if="selectedMedia" variant="tonal" color="primary" class="mt-3">
          <v-card-text>
            <v-img
              v-if="selectedMedia.signed_url"
              :src="selectedMedia.signed_url"
              height="260"
              cover
              class="rounded-lg mb-3"
            />
            <div class="text-body-2 mb-3">
              {{ formatBytes(selectedMedia.size_bytes) }}
              <span v-if="selectedMedia.width && selectedMedia.height">
                · {{ selectedMedia.width }}x{{ selectedMedia.height }}
              </span>
            </div>

            <div class="d-flex flex-wrap ga-2 mb-4">
              <v-btn
                v-if="!selectedMedia.is_cover"
                color="primary"
                variant="flat"
                prepend-icon="mdi-star-outline"
                :loading="busy"
                :disabled="busy"
                @click="handleSetCover(selectedMedia.media_id)"
              >
                Usar como portada
              </v-btn>
              <v-chip
                v-else
                color="warning"
                variant="flat"
                prepend-icon="mdi-star"
              >
                Esta es la portada actual
              </v-chip>

              <v-btn
                color="error"
                variant="tonal"
                prepend-icon="mdi-delete-outline"
                :loading="busy"
                :disabled="busy"
                @click="handleDeletePhoto(selectedMedia)"
              >
                Eliminar foto
              </v-btn>
            </div>

            <v-card
              v-if="selectedMedia.ai_status === 'READY' || selectedMedia.ai_status === 'FAILED'"
              variant="outlined"
            >
              <v-card-text>
                <div class="text-subtitle-2 font-weight-bold mb-2">Asistente IA de producto</div>
                <div v-if="selectedMedia.ai_summary" class="text-body-2 mb-2">{{ selectedMedia.ai_summary }}</div>
                <div v-if="normalizeText(selectedMedia.ai_detected_name)" class="text-body-2 mb-1">
                  Nombre sugerido: {{ selectedMedia.ai_detected_name }}
                </div>
                <div v-if="normalizeText(selectedMedia.ai_detected_category)" class="text-body-2 mb-1">
                  Categoría sugerida: {{ selectedMedia.ai_detected_category }}
                </div>
                <div v-if="normalizeText(selectedMedia.ai_detected_brand)" class="text-body-2 mb-1">
                  Marca detectada: {{ selectedMedia.ai_detected_brand }}
                </div>
                <div v-if="normalizeText(selectedMedia.ai_suggested_description)" class="text-body-2 mb-2">
                  Descripción sugerida: {{ selectedMedia.ai_suggested_description }}
                </div>
                <div
                  v-if="Array.isArray(selectedMedia.ai_labels) && selectedMedia.ai_labels.length"
                  class="text-caption text-medium-emphasis mb-2"
                >
                  Etiquetas: {{ selectedMedia.ai_labels.join(', ') }}
                </div>
                <v-alert
                  v-if="Array.isArray(selectedMedia.ai_warnings) && selectedMedia.ai_warnings.length"
                  type="warning"
                  variant="tonal"
                  density="compact"
                  class="mb-3"
                >
                  {{ selectedMedia.ai_warnings.join(' · ') }}
                </v-alert>
                <v-btn
                  v-if="hasApplicableAiSuggestion(selectedMedia)"
                  color="secondary"
                  variant="tonal"
                  prepend-icon="mdi-sparkles"
                  :disabled="busy"
                  @click="$emit('apply-suggestion', selectedMedia)"
                >
                  Aplicar al formulario
                </v-btn>
              </v-card-text>
            </v-card>
          </v-card-text>
        </v-card>
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import productMediaService, { MAX_PRODUCT_PHOTOS } from '@/services/productMedia.service'
import { humanizeAppError } from '@/utils/appErrors'
import { normalizeProductPhotoText as normalizeText } from '@/utils/productMediaHelpers'

const props = defineProps({
  tenantId: { type: String, default: '' },
  productId: { type: String, default: '' },
})

const emit = defineEmits(['updated', 'apply-suggestion'])

const loading = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const noticeColor = ref('success')
const mediaItems = ref([])
const selectedMediaId = ref(null)
const cameraInput = ref(null)
const libraryInput = ref(null)

const selectedMedia = computed(() => (
  mediaItems.value.find((item) => item.media_id === selectedMediaId.value)
  || mediaItems.value[0]
  || null
))
const mediaLimitReached = computed(() => mediaItems.value.length >= MAX_PRODUCT_PHOTOS)
const disableUploadActions = computed(() => !props.productId || busy.value || mediaLimitReached.value)

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (!bytes) return 'Tamaño no disponible'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function hasApplicableAiSuggestion(media) {
  return Boolean(
    normalizeText(media?.ai_detected_name)
    || normalizeText(media?.ai_detected_category)
    || normalizeText(media?.ai_detected_brand)
    || normalizeText(media?.ai_suggested_description),
  )
}

function setNotice(message, color = 'success') {
  noticeMessage.value = message
  noticeColor.value = color
}

async function loadMedia() {
  if (!props.tenantId || !props.productId) {
    mediaItems.value = []
    selectedMediaId.value = null
    errorMessage.value = ''
    return
  }

  loading.value = true
  errorMessage.value = ''
  const result = await productMediaService.listProductMedia({
    tenantId: props.tenantId,
    productId: props.productId,
  })

  if (!result.success) {
    mediaItems.value = []
    selectedMediaId.value = null
    errorMessage.value = humanizeAppError(result.error, { defaultMessage: 'No se pudieron cargar las fotos del producto.' })
    loading.value = false
    return
  }

  mediaItems.value = result.data || []
  selectedMediaId.value = mediaItems.value[0]?.media_id || null
  loading.value = false
}

function openLibraryPicker() {
  libraryInput.value?.click()
}

function openCameraPicker() {
  cameraInput.value?.click()
}

async function handleFileSelection(event) {
  const file = event?.target?.files?.[0] || null
  if (event?.target) event.target.value = ''
  if (!file) return

  busy.value = true
  errorMessage.value = ''
  setNotice('')

  const result = await productMediaService.uploadProductPhoto({
    tenantId: props.tenantId,
    productId: props.productId,
    file,
    currentCount: mediaItems.value.length,
    analyzeWithAi: true,
  })

  if (!result.success) {
    errorMessage.value = humanizeAppError(result.error, { defaultMessage: 'No se pudo subir la foto.' })
    busy.value = false
    return
  }

  await loadMedia()
  selectedMediaId.value = result.data?.media_id || selectedMediaId.value
  setNotice(
    result.data?.ai_status === 'READY'
      ? 'Foto cargada y analizada por IA.'
      : 'Foto cargada. La sugerencia IA no estuvo disponible para esta imagen.',
    result.data?.ai_status === 'READY' ? 'success' : 'warning',
  )
  emit('updated')
  busy.value = false
}

async function handleSetCover(mediaId) {
  if (!props.tenantId || !props.productId || !mediaId) return

  busy.value = true
  errorMessage.value = ''
  setNotice('')
  const result = await productMediaService.setProductCover({
    tenantId: props.tenantId,
    productId: props.productId,
    mediaId,
  })

  if (!result.success) {
    errorMessage.value = humanizeAppError(result.error, { defaultMessage: 'No se pudo cambiar la portada.' })
    busy.value = false
    return
  }

  await loadMedia()
  selectedMediaId.value = mediaId
  setNotice('Portada actualizada.')
  emit('updated')
  busy.value = false
}

async function handleDeletePhoto(media) {
  if (!media?.media_id || !props.tenantId) return
  if (!window.confirm('¿Eliminar esta foto del producto?')) return

  busy.value = true
  errorMessage.value = ''
  setNotice('')
  const result = await productMediaService.deleteProductPhoto({
    tenantId: props.tenantId,
    mediaId: media.media_id,
  })

  if (!result.success) {
    errorMessage.value = humanizeAppError(result.error, { defaultMessage: 'No se pudo eliminar la foto.' })
    busy.value = false
    return
  }

  await loadMedia()
  selectedMediaId.value = mediaItems.value[0]?.media_id || null
  setNotice(result.warning || 'Foto eliminada.', result.warning ? 'warning' : 'success')
  emit('updated')
  busy.value = false
}

watch(
  () => [props.tenantId, props.productId],
  () => {
    loadMedia()
  },
  { immediate: true },
)
</script>

<style scoped>
.media-thumb-card {
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.media-thumb-card:hover {
  transform: translateY(-1px);
}

.media-thumb-card--active {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.18);
}

.media-thumb-placeholder {
  height: 120px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
