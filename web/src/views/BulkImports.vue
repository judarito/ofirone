<template>
  <div data-testid="bulk-imports-page">
    <v-alert v-if="bulkImportHintVisible" type="info" variant="tonal" class="mb-4">
      <div class="text-subtitle-2 font-weight-bold mb-1">
        Cargue masivo para catalogo e inventario
      </div>
      <div class="text-body-2">
        Esta opcion te permite crear productos, variantes y stock inicial desde Excel para acelerar
        el arranque del tenant.
      </div>
    </v-alert>

    <v-card class="mb-4" elevation="2">
      <v-card-title class="d-flex align-center justify-space-between">
        <div>
          <div class="text-h6">Carga rapida por foto</div>
          <div class="text-caption text-grey">
            Sube una foto de una lista escrita o impresa, corrige el borrador y luego importa los
            productos detectados.
          </div>
        </div>
        <v-btn
          color="deep-purple"
          variant="tonal"
          prepend-icon="mdi-camera-outline"
          :loading="processingPhoto"
          data-testid="bulk-imports-photo-upload"
          @click="openPhotoPicker"
        >
          Tomar o subir foto
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <input
          ref="photoFileInput"
          type="file"
          accept="image/*"
          capture="environment"
          class="d-none"
          data-testid="bulk-imports-photo-input"
          @change="handlePhotoSelected"
        />

        <v-row dense>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="photoDefaults.unit_code"
              label="Unidad default"
              variant="outlined"
              density="comfortable"
              hint="Ej: UND"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="photoDefaults.location_code"
              label="Ubicación para stock inicial"
              variant="outlined"
              density="comfortable"
              hint="Opcional"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="photoDefaults.category_name"
              label="Categoría default"
              variant="outlined"
              density="comfortable"
              hint="Opcional"
              persistent-hint
            />
          </v-col>
        </v-row>

        <v-sheet class="pa-3 mt-2" color="grey-lighten-5" rounded="lg">
          <div class="text-subtitle-2 font-weight-bold mb-2">Ejemplo sugerido para la foto</div>
          <div class="text-body-2">Camiseta blanca talla M | 45000 | 28000 | 20</div>
          <div class="text-body-2">Camiseta blanca talla L | 45000 | 28000 | 15</div>
          <div class="text-body-2">Jean slim azul 32 | 99000 | 62000 | 8</div>
          <div class="text-caption text-medium-emphasis mt-2">
            Formato sugerido: Nombre | Precio venta | Costo | Stock
          </div>
        </v-sheet>

        <div v-if="photoSummary" class="mt-3 d-flex flex-wrap ga-2">
          <v-chip color="primary" variant="tonal"
            >Filas detectadas: {{ photoSummary.totalRows }}</v-chip
          >
          <v-chip color="success" variant="tonal">Validas: {{ photoSummary.validRows }}</v-chip>
          <v-chip color="warning" variant="tonal"
            >Pendientes: {{ photoSummary.invalidRows }}</v-chip
          >
        </div>

        <v-alert v-if="photoWarnings.length" type="warning" variant="tonal" class="mt-3">
          {{ photoWarnings.slice(0, 3).join(' | ') }}
        </v-alert>

        <div v-if="photoMeta.model" class="text-caption text-medium-emphasis mt-2">
          Modelo: {{ photoMeta.model }}
        </div>

        <div v-if="photoSummary?.preview" class="text-caption text-medium-emphasis mt-2">
          Preview: {{ photoSummary.preview }}
        </div>

        <div class="d-flex flex-wrap ga-2 mt-3" v-if="photoDraftRows.length">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-eye-outline"
            @click="photoPreviewDialog = true"
          >
            Revisar filas detectadas ({{ photoDraftRows.length }})
          </v-btn>
          <v-btn
            color="success"
            prepend-icon="mdi-database-import-outline"
            :loading="importingPhotoRows"
            :disabled="validPhotoRowsCount === 0"
            @click="importPhotoDraftRows"
          >
            Importar borrador
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card class="mb-4" elevation="2">
      <v-card-title class="d-flex align-center justify-space-between">
        <div>
          <div class="text-h6">Carga masiva de productos</div>
          <div class="text-caption text-grey">
            Sube un archivo XLSX con productos simples (una variante) y deja que el sistema cree
            productos, variantes y stock inicial.
          </div>
        </div>
        <div class="d-flex gap-2">
          <v-btn
            color="primary"
            variant="tonal"
            :href="templateUrl"
            target="_blank"
            rel="noreferrer"
          >
            <v-icon left>mdi-file-download-outline</v-icon> Descargar plantilla
          </v-btn>
          <v-btn color="secondary" variant="outlined" @click="showNotes = true">Notas</v-btn>
        </div>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-alert color="info" border="start" variant="tonal" dense>
          Se almacenan los archivos en el bucket <strong>dataimport</strong> (puedes revisar las
          políticas en la consola de Supabase para permitir solo tu tenant). El sistema lee
          automáticamente la hoja <strong>productos</strong>.
        </v-alert>
        <v-row dense class="mt-4">
          <v-col cols="12" md="4">
            <v-select
              v-model="selectedType"
              :items="typeOptions"
              item-title="label"
              item-value="value"
              label="Tipo de importación"
              density="comfortable"
              variant="outlined"
            ></v-select>
          </v-col>
          <v-col cols="12" md="8">
            <v-file-input
              v-model="selectedFile"
              accept=".xls,.xlsx"
              dense
              label="Elige el archivo XLSX"
              placeholder="Arrastra o selecciona"
              truncate-length="20"
              :disabled="processing"
            ></v-file-input>
          </v-col>
        </v-row>
        <div class="d-flex flex-wrap gap-2 mt-3">
          <v-btn color="primary" :disabled="!selectedFile || processing" @click="handleUpload">
            <v-icon left>mdi-cloud-upload-outline</v-icon>
            Subir y procesar
          </v-btn>
          <v-btn
            variant="outlined"
            color="secondary"
            :disabled="processing"
            @click="selectedFile = null"
            >{{ t('common.cancel') }}</v-btn
          >
          <span class="text-caption text-grey" v-if="processing"
            >Procesando el archivo... esto puede tardar unos segundos.</span
          >
        </div>
      </v-card-text>
    </v-card>

    <v-card elevation="2">
      <ListView
        title="Historial de importaciones"
        icon="mdi-history"
        :items="history"
        :total-items="history.length"
        :loading="loadingHistory"
        :page-size="10"
        item-key="import_id"
        title-field="file_name"
        subtitle-field="import_type"
        avatar-icon="mdi-file-excel-box"
        avatar-color="success"
        empty-message="Aun no hay importaciones registradas."
        :editable="false"
        :deletable="false"
        :show-create-button="false"
        :client-side="true"
        :table-columns="historyTableColumns"
        :search-fields="['file_name', 'import_type', 'status']"
        view-storage-key="bulk-imports-history"
      >
        <template #filters>
          <div class="d-flex align-center justify-space-between flex-wrap ga-3">
            <div class="text-caption text-medium-emphasis">
              Ultimos {{ history.length }} archivos subidos para el tipo seleccionado.
            </div>
            <v-btn
              variant="tonal"
              color="primary"
              prepend-icon="mdi-refresh"
              :loading="loadingHistory"
              @click="loadHistory"
            >
              Actualizar
            </v-btn>
          </div>
        </template>

        <template #content="{ item }">
          <div class="mt-2 d-flex flex-wrap ga-2">
            <div class="d-flex flex-wrap ga-2">
              <v-chip
                :color="statusColor(item.status)"
                :variant="item.status === 'failed' ? 'tonal' : 'outlined'"
                size="small"
              >
                {{ item.status }}
              </v-chip>
              <v-chip v-if="importPhase(item)" size="small" color="primary" variant="tonal">
                {{ importPhaseLabel(importPhase(item)) }}
              </v-chip>
              <v-chip size="small" variant="tonal"
                >Procesados: {{ item.processed_count || 0 }}</v-chip
              >
              <v-chip v-if="previewRows(item) > 0" size="small" color="success" variant="tonal">
                Válidas: {{ previewRows(item) }}
              </v-chip>
              <v-chip
                size="small"
                variant="tonal"
                :color="item.error_count > 0 ? 'error' : 'success'"
              >
                Errores: {{ item.error_count || 0 }}
              </v-chip>
            </div>
          </div>
        </template>

        <template #table-cell-status="{ item }">
          <v-chip
            :color="statusColor(item.status)"
            :variant="item.status === 'failed' ? 'tonal' : 'outlined'"
            size="small"
          >
            {{ item.status }}
          </v-chip>
        </template>

        <template #table-cell-error_count="{ item }">
          <span :class="item.error_count > 0 ? 'text-error font-weight-bold' : ''">
            {{ item.error_count }}
          </span>
        </template>

        <template #table-cell-created_at="{ item }">
          {{ formatDate(item.created_at) }}
        </template>

        <template #actions="{ item }">
          <v-tooltip v-if="canApplyImportPreview(item)" text="Aplicar preview">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon
                variant="text"
                density="comfortable"
                color="success"
                :loading="applyingImportId === item.import_id"
                :data-testid="buildTestId('bulk-imports-apply-preview', item.import_id)"
                @click.stop="applyPreviewImport(item)"
              >
                <v-icon>mdi-check-decagram-outline</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
          <v-btn
            icon
            variant="text"
            density="comfortable"
            :data-testid="buildTestId('bulk-imports-errors', item.import_id)"
            @click.stop="loadErrors(item.import_id)"
          >
            <v-icon>mdi-alert-circle-outline</v-icon>
          </v-btn>
        </template>
      </ListView>
    </v-card>

    <v-card v-if="backendJobHistoryEnabled" class="mt-4" elevation="2">
      <ListView
        title="Historial de procesos"
        icon="mdi-timeline-clock-outline"
        :items="jobHistoryItems"
        :total-items="jobHistoryItems.length"
        :loading="loadingJobHistory"
        :page-size="10"
        item-key="job_id"
        title-field="title"
        subtitle-field="subtitle"
        avatar-icon="mdi-cog-clockwise"
        avatar-color="primary"
        empty-message="Aun no hay procesos asíncronos registrados."
        :editable="false"
        :deletable="false"
        :show-create-button="false"
        :client-side="true"
        :table-columns="jobHistoryTableColumns"
        :search-fields="['title', 'subtitle', 'status', 'queue', 'job_type']"
        view-storage-key="bulk-imports-job-history"
      >
        <template #filters>
          <div class="d-flex align-center justify-space-between flex-wrap ga-3">
            <div class="text-caption text-medium-emphasis">
              Jobs recientes de Excel y fotos procesados por backend.
            </div>
            <v-btn
              variant="tonal"
              color="primary"
              prepend-icon="mdi-refresh"
              :loading="loadingJobHistory"
              @click="loadJobHistory"
            >
              Actualizar
            </v-btn>
          </div>
        </template>

        <template #content="{ item }">
          <div class="mt-2 d-flex flex-wrap ga-2">
            <v-chip :color="statusColor(item.status)" size="small" variant="tonal">
              {{ item.status }}
            </v-chip>
            <v-chip size="small" variant="tonal">{{ jobQueueLabel(item.queue) }}</v-chip>
            <v-chip v-if="item.phase" size="small" color="success" variant="tonal">
              {{ importPhaseLabel(item.phase) }}
            </v-chip>
            <v-chip v-if="item.attempts > 0" size="small" variant="outlined">
              Intentos: {{ item.attempts }}/{{ item.max_attempts }}
            </v-chip>
            <v-btn
              v-if="item.phase === 'draft_ready'"
              size="small"
              variant="tonal"
              color="secondary"
              prepend-icon="mdi-file-eye-outline"
              @click="openDraftPreview(item)"
            >
              Ver borrador
            </v-btn>
          </div>
        </template>

        <template #table-cell-status="{ item }">
          <v-chip :color="statusColor(item.status)" size="small" variant="tonal">
            {{ item.status }}
          </v-chip>
        </template>

        <template #table-cell-queue="{ item }">
          {{ jobQueueLabel(item.queue) }}
        </template>

        <template #table-cell-created_at="{ item }">
          {{ formatDate(item.created_at) }}
        </template>
      </ListView>
    </v-card>

    <v-dialog v-model="errorDialog" max-width="700">
      <v-card>
        <v-card-title>
          Errores de importación
          <v-spacer></v-spacer>
          <v-btn icon variant="text" @click="errorDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <v-data-table
            :headers="errorHeaders"
            :items="errorRows"
            hide-default-footer
            density="compact"
          ></v-data-table>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showNotes" max-width="600">
      <v-card>
        <v-card-title>Notas y guía de la plantilla</v-card-title>
        <v-card-text>
          <iframe style="width: 100%; height: 400px; border: none" :src="notesUrl"></iframe>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="showNotes = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="draftPreviewDialog" max-width="960" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <div>
            <div class="text-h6">Borrador del proceso</div>
            <div class="text-caption text-medium-emphasis">
              {{ jobTypeLabel(draftPreview?.job_type || '') }} ·
              {{ importPhaseLabel(draftPreview?.result?.phase || '') }}
            </div>
          </div>
          <v-btn icon variant="text" @click="draftPreviewDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <div v-if="draftPreview?.result?.draft?.invoice" class="mb-2">
            <div class="text-subtitle-2 font-weight-bold mb-1">Proveedor / encabezado</div>
            <div class="text-body-2">
              {{ draftPreview.result.draft.invoice.vendor_name || '—' }}
            </div>
          </div>
          <v-data-table
            v-if="draftTableRows.length"
            :headers="draftTableHeaders"
            :items="draftTableRows"
            hide-default-footer
            density="compact"
            class="mt-1"
          ></v-data-table>
          <div v-if="draftPreview?.result?.draft?.warnings?.length" class="mt-3">
            <div class="text-caption text-warning">
              Advertencias: {{ draftPreview.result.draft.warnings.join(' | ') }}
            </div>
          </div>
          <div v-if="draftPreview?.result?.ocr_text" class="mt-3">
            <div class="text-caption text-medium-emphasis mb-1">Texto OCR extraído</div>
            <pre
              style="
                white-space: pre-wrap;
                word-break: break-word;
                max-height: 220px;
                overflow: auto;
                font-size: 12px;
                background: rgba(0, 0, 0, 0.04);
                padding: 8px;
                border-radius: 6px;
              "
              >{{ draftPreview.result.ocr_text.slice(0, 1600) }}</pre
            >
          </div>
          <div v-else-if="!draftTableRows.length" class="text-body-2 text-medium-emphasis">
            El borrador no tiene filas para mostrar.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            v-if="draftPreview?.job_type === 'purchase_invoice_photo'"
            color="primary"
            prepend-icon="mdi-cart-arrow-right"
            @click="useDraftInPurchase"
          >
            Usar en compra
          </v-btn>
          <v-btn text @click="draftPreviewDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="photoPreviewDialog" max-width="960" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <div>
            <div class="text-h6">Borrador por foto</div>
            <div class="text-caption text-medium-emphasis">
              Corrige las filas detectadas antes de importar.
            </div>
          </div>
          <v-btn icon variant="text" @click="photoPreviewDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <v-alert v-if="photoDraftRows.length === 0" type="info" variant="tonal">
            Aun no hay filas detectadas por foto.
          </v-alert>

          <v-card
            v-for="(row, index) in photoDraftRows"
            :key="row.local_id"
            variant="outlined"
            class="mb-3"
          >
            <v-card-text>
              <div class="d-flex align-center justify-space-between mb-3">
                <div class="text-subtitle-2">Fila {{ index + 1 }}</div>
                <div class="d-flex align-center ga-2">
                  <v-chip size="small" color="secondary" variant="tonal">
                    Conf. {{ Math.round(Number(row.confidence || 0) * 100) }}%
                  </v-chip>
                  <v-btn
                    icon="mdi-delete-outline"
                    size="small"
                    variant="text"
                    color="error"
                    @click="removePhotoDraftRow(index)"
                  />
                </div>
              </div>

              <v-row dense>
                <v-col cols="12" md="5">
                  <v-text-field
                    :model-value="row.product_name"
                    label="Producto"
                    variant="outlined"
                    density="compact"
                    @update:model-value="
                      (value) => updatePhotoDraftRow(index, 'product_name', value)
                    "
                  />
                </v-col>
                <v-col cols="12" md="3">
                  <v-text-field
                    :model-value="row.variant_name"
                    label="Variante"
                    variant="outlined"
                    density="compact"
                    @update:model-value="
                      (value) => updatePhotoDraftRow(index, 'variant_name', value)
                    "
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    :model-value="row.category_name"
                    label="Categoría"
                    variant="outlined"
                    density="compact"
                    @update:model-value="
                      (value) => updatePhotoDraftRow(index, 'category_name', value)
                    "
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    :model-value="row.unit_price"
                    label="Precio venta"
                    type="number"
                    variant="outlined"
                    density="compact"
                    @update:model-value="(value) => updatePhotoDraftRow(index, 'unit_price', value)"
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    :model-value="row.unit_cost"
                    label="Costo"
                    type="number"
                    variant="outlined"
                    density="compact"
                    @update:model-value="(value) => updatePhotoDraftRow(index, 'unit_cost', value)"
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    :model-value="row.initial_stock"
                    label="Stock inicial"
                    type="number"
                    variant="outlined"
                    density="compact"
                    @update:model-value="
                      (value) => updatePhotoDraftRow(index, 'initial_stock', value)
                    "
                  />
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="photoPreviewDialog = false">{{ t('common.close') }}</v-btn>
          <v-btn
            color="success"
            :loading="importingPhotoRows"
            :disabled="validPhotoRowsCount === 0"
            @click="importPhotoDraftRows"
          >
            Importar {{ validPhotoRowsCount }} fila(s) validas
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTenant } from '@/composables/useTenant';
import { useAuth } from '@/composables/useAuth';
import { useNotification } from '@/composables/useNotification';
import ListView from '@/components/ListView.vue';
import {
  uploadBulkImport,
  enqueueBulkImportJob,
  enqueueBulkImportApplyProducts,
  enqueueBulkImportApplyThirdParties,
  isBackendImportJobsEnabled,
  listBulkImports,
  getBulkImportErrors,
} from '@/services/bulkImportClient.service';
import { processBulkImport } from '@/services/bulkImport.service';
import {
  analyzeProductsPhotoFile,
  importProductsFromRows,
} from '@/services/productPhotoImport.service';
import {
  enqueueProductCatalogPhotoJob,
  isBackendMediaJobsEnabled,
} from '@/services/mediaProcessingClient.service';
import {
  isBackendJobHistoryEnabled,
  listAsyncJobHistory,
} from '@/services/asyncJobsClient.service';
import {
  applyPhotoAnalysisToState,
  buildPhotoImportFeedback,
  removePhotoDraftRow as removePhotoDraftRowState,
  updatePhotoDraftRow as updatePhotoDraftRowState,
} from '@/utils/bulkImportPhotoFlow';
import {
  buildProductPhotoImportSummary,
  countValidProductPhotoRows,
} from '@/utils/productPhotoBulkImport';
import { useI18n } from '@/i18n';
import { buildTestId } from '@/utils/testIds';
import { savePendingPurchaseDraft } from '@/utils/purchaseDraftBridge';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const { tenantId } = useTenant();
const { userProfile } = useAuth();
const { show: showSnackbar } = useNotification();

const selectedType = ref('product_variants');
const selectedFile = ref(null);
const processing = ref(false);
const photoFileInput = ref(null);
const processingPhoto = ref(false);
const importingPhotoRows = ref(false);
const photoDraftRows = ref([]);
const photoPreviewDialog = ref(false);
const photoWarnings = ref([]);
const photoMeta = ref({ model: null, usage: null });
const photoDefaults = ref({
  unit_code: 'UND',
  location_code: '',
  category_name: '',
});
const showNotes = ref(false);
const history = ref([]);
const loadingHistory = ref(false);
const errorDialog = ref(false);
const errorRows = ref([]);
const applyingImportId = ref(null);
const jobHistory = ref([]);
const loadingJobHistory = ref(false);

const typeOptions = [
  { label: 'Productos/variantes', value: 'product_variants' },
  { label: 'Terceros (clientes/proveedores)', value: 'third_parties' },
];
const bulkImportHintVisible = computed(() => {
  const onboarding = String(route.query.onboarding || '').trim();
  return onboarding === 'inventory-import' || onboarding === 'inventory-stock';
});

const historyTableColumns = [
  { title: 'Estado', key: 'status', width: '150px' },
  { title: 'Procesados', key: 'processed_count', align: 'right', width: '120px' },
  { title: 'Errores', key: 'error_count', align: 'right', width: '120px' },
  { title: 'Creado', key: 'created_at', width: '180px' },
];

const jobHistoryTableColumns = [
  { title: 'Estado', key: 'status', width: '150px' },
  { title: 'Cola', key: 'queue', width: '170px' },
  { title: 'Creado', key: 'created_at', width: '180px' },
];

const errorHeaders = [
  { title: 'Fila', key: 'row_number', value: 'row_number' },
  { title: 'Detalle', key: 'detail', value: 'detail' },
  { title: 'Datos', key: 'raw_data', value: 'raw_data' },
];

const templateUrl = computed(() =>
  selectedType.value === 'third_parties'
    ? '/templates/import-third-parties.xlsx'
    : '/templates/import-product-variants.xlsx'
);
const notesUrl = computed(() => '/templates/import-product-variants-notes.md');
const validPhotoRowsCount = computed(() => countValidProductPhotoRows(photoDraftRows.value));
const photoSummary = computed(() =>
  photoDraftRows.value.length > 0 ? buildProductPhotoImportSummary(photoDraftRows.value) : null
);
const backendImportJobsEnabled = isBackendImportJobsEnabled();
const backendJobHistoryEnabled = isBackendJobHistoryEnabled();
const jobHistoryItems = computed(() =>
  jobHistory.value.map((job) => ({
    ...job,
    title: jobTypeLabel(job.job_type),
    subtitle: [job.payload?.file_name || job.payload?.file_key || '', job.correlation_id || '']
      .filter(Boolean)
      .join(' · '),
    phase: job.result?.phase || '',
  }))
);

const draftPreviewDialog = ref(false);
const draftPreview = ref(null);
const draftTableRows = computed(() => {
  const draft = draftPreview.value?.result?.draft || {};
  if (Array.isArray(draft.line_items)) return draft.line_items;
  if (Array.isArray(draft.rows)) return draft.rows;
  return Array.isArray(draft) ? draft : [];
});
const draftTableHeaders = computed(() => {
  const first = draftTableRows.value[0];
  if (!first) return [];
  return Object.keys(first)
    .slice(0, 10)
    .map((key) => ({ title: key.replace(/_/g, ' '), key, value: key }));
});
function openDraftPreview(item) {
  const job = jobHistory.value.find((entry) => entry.job_id === item.job_id) || item;
  draftPreview.value = job;
  draftPreviewDialog.value = true;
}

function useDraftInPurchase() {
  if (draftPreview.value?.job_type !== 'purchase_invoice_photo') return;
  savePendingPurchaseDraft(draftPreview.value);
  draftPreviewDialog.value = false;
  router.push({ path: '/purchases' });
}

const applyRouteContext = () => {
  const requestedType = String(route.query.type || '').trim();
  if (typeOptions.some((option) => option.value === requestedType)) {
    selectedType.value = requestedType;
  }
};

const loadHistory = async () => {
  if (!tenantId.value) return;
  loadingHistory.value = true;
  try {
    history.value = await listBulkImports(tenantId.value, selectedType.value);
  } catch (error) {
    console.error('[loadHistory]', error);
    showSnackbar('No fue posible cargar el historial de importaciones', 'error');
  } finally {
    loadingHistory.value = false;
  }
};

const loadJobHistory = async () => {
  if (!backendJobHistoryEnabled) return;
  loadingJobHistory.value = true;
  try {
    const result = await listAsyncJobHistory({
      queues: ['import_jobs', 'media_processing'],
      limit: 50,
    });
    jobHistory.value = result.jobs;
  } catch (error) {
    console.error('[loadJobHistory]', error);
    showSnackbar('No fue posible cargar el historial de procesos async', 'error');
  } finally {
    loadingJobHistory.value = false;
  }
};

const handleUpload = async () => {
  if (!selectedFile.value || !tenantId.value) {
    showSnackbar('Selecciona un archivo válido', 'error');
    return;
  }
  processing.value = true;
  try {
    const importRecord = await uploadBulkImport({
      importType: selectedType.value,
      file: selectedFile.value,
      tenantId: tenantId.value,
      uploadedBy: userProfile.value?.user_id,
    });
    showSnackbar('Archivo subido. Procesando...', 'info');
    selectedFile.value = null;
    await loadHistory();
    const queued = await enqueueBulkImportJob(importRecord);
    if (queued.queued) {
      showSnackbar('Importación encolada para procesamiento asíncrono.', 'info');
      await Promise.all([loadHistory(), loadJobHistory()]);
      return;
    }
    await processBulkImport(importRecord);
    await loadHistory();
    const done = history.value.find((r) => r.import_id === importRecord.import_id);
    if (done?.error_count > 0 && done?.processed_count === 0) {
      showSnackbar(`Importación fallida: ${done.error_count} errores. Revisa el log.`, 'error');
    } else if (done?.error_count > 0) {
      showSnackbar(
        `Importación con advertencias: ${done.processed_count} ok, ${done.error_count} errores. Revisa el log.`,
        'warning'
      );
    } else {
      showSnackbar(
        `Importación completada: ${done?.processed_count ?? 0} registros creados/actualizados.`,
        'success'
      );
    }
  } catch (error) {
    showSnackbar(error.message || 'Error en la importación', 'error');
    await loadHistory();
  } finally {
    processing.value = false;
  }
};

const loadErrors = async (importId) => {
  errorDialog.value = true;
  try {
    errorRows.value = await getBulkImportErrors(importId);
  } catch (error) {
    showSnackbar('No se pudieron cargar los errores', 'error');
  }
};

const importPhase = (item) => item?.summary?.phase || '';

const importPhaseLabel = (phase) => {
  switch (phase) {
    case 'preview_ready':
      return 'Preview listo';
    case 'draft_ready':
      return 'Borrador listo';
    case 'imported':
      return 'Aplicado';
    case 'failed':
      return 'Falló';
    default:
      return phase;
  }
};

const previewRows = (item) => Number(item?.summary?.validRows || item?.summary?.valid_rows || 0);

const canApplyImportPreview = (item) =>
  backendImportJobsEnabled &&
  ['product_variants', 'third_parties'].includes(item?.import_type) &&
  importPhase(item) === 'preview_ready' &&
  previewRows(item) > 0;

const enqueuePreviewApplyJob = (item) => {
  if (item?.import_type === 'third_parties') {
    return enqueueBulkImportApplyThirdParties(item);
  }
  return enqueueBulkImportApplyProducts(item);
};

const applyPreviewImport = async (item) => {
  if (!canApplyImportPreview(item) || applyingImportId.value) return;

  applyingImportId.value = item.import_id;
  try {
    const queued = await enqueuePreviewApplyJob(item);
    if (queued.queued) {
      showSnackbar(
        'Aplicación del preview encolada. Actualiza el historial para ver el avance.',
        'info'
      );
    } else {
      showSnackbar(
        'Activa VITE_USE_BACKEND_IMPORT_JOBS para aplicar previews desde el backend.',
        'warning'
      );
    }
    await Promise.all([loadHistory(), loadJobHistory()]);
  } catch (error) {
    showSnackbar(error.message || 'No se pudo encolar la aplicación del preview.', 'error');
  } finally {
    applyingImportId.value = null;
  }
};

const formatDate = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

const statusColor = (status) => {
  switch (status) {
    case 'pending':
      return 'grey';
    case 'processing':
      return 'info';
    case 'waiting_retry':
      return 'warning';
    case 'completed':
      return 'success';
    case 'completed_with_warnings':
      return 'warning';
    case 'completed_with_errors':
      return 'warning';
    case 'failed':
      return 'error';
    case 'dead_letter':
      return 'error';
    case 'cancelled':
      return 'grey';
    default:
      return 'grey';
  }
};

const jobQueueLabel = (queue) => {
  switch (queue) {
    case 'import_jobs':
      return 'Importaciones';
    case 'media_processing':
      return 'Fotos/OCR';
    default:
      return queue || '-';
  }
};

const jobTypeLabel = (type) => {
  switch (type) {
    case 'bulk_import_process':
      return 'Preparar preview Excel';
    case 'bulk_import_apply_products':
      return 'Aplicar productos';
    case 'bulk_import_apply_third_parties':
      return 'Aplicar terceros';
    case 'purchase_invoice_photo':
      return 'Foto de factura';
    case 'product_catalog_photo':
      return 'Foto de productos';
    default:
      return type || 'Proceso async';
  }
};

const openPhotoPicker = () => {
  selectedType.value = 'product_variants';
  photoFileInput.value?.click();
};

const tryEnqueueProductPhotoJob = async (file) => {
  if (!isBackendMediaJobsEnabled()) return false;

  try {
    const result = await enqueueProductCatalogPhotoJob({
      tenantId: tenantId.value,
      file,
      context: {
        source_view: 'bulk_imports',
        defaults: photoDefaults.value,
      },
    });
    if (result.queued) {
      showSnackbar('Foto subida y encolada para procesamiento asíncrono.', 'info');
      await loadJobHistory();
      return true;
    }
  } catch (error) {
    showSnackbar(
      `No se pudo encolar la foto; continúo con análisis directo. ${error.message}`,
      'warning'
    );
  }

  return false;
};

const handlePhotoSelected = async (event) => {
  const file = event?.target?.files?.[0];
  event.target.value = '';
  if (!file || !tenantId.value) return;

  processingPhoto.value = true;
  photoWarnings.value = [];
  try {
    const queued = await tryEnqueueProductPhotoJob(file);
    if (queued) return;

    const result = await analyzeProductsPhotoFile({
      tenantId: tenantId.value,
      file,
    });

    if (!result.success || !result?.data) {
      showSnackbar(result.error || 'No se pudo analizar la foto.', 'error');
      return;
    }

    const nextState = applyPhotoAnalysisToState(result.data);
    photoDraftRows.value = nextState.rows;
    photoWarnings.value = nextState.warnings;
    photoMeta.value = nextState.meta;
    photoPreviewDialog.value = nextState.shouldOpenPreview;
    showSnackbar(`Foto analizada: ${photoDraftRows.value.length} fila(s) detectadas.`, 'success');
  } catch (error) {
    showSnackbar(error.message || 'Error analizando foto.', 'error');
  } finally {
    processingPhoto.value = false;
  }
};

const updatePhotoDraftRow = (index, field, value) => {
  photoDraftRows.value = updatePhotoDraftRowState(photoDraftRows.value, index, field, value);
};

const removePhotoDraftRow = (index) => {
  photoDraftRows.value = removePhotoDraftRowState(photoDraftRows.value, index);
};

const importPhotoDraftRows = async () => {
  if (!tenantId.value || validPhotoRowsCount.value === 0) {
    showSnackbar('No hay filas validas para importar.', 'warning');
    return;
  }

  importingPhotoRows.value = true;
  try {
    const result = await importProductsFromRows({
      tenantId: tenantId.value,
      rows: photoDraftRows.value,
      defaults: photoDefaults.value,
    });

    if (!result.success && !result?.data) {
      showSnackbar(result.error || 'No se pudo importar el borrador.', 'error');
      return;
    }

    const summary = result.data || {};
    await loadHistory();
    photoPreviewDialog.value = false;
    photoDraftRows.value = [];
    const feedback = buildPhotoImportFeedback(summary);
    showSnackbar(feedback.message, feedback.color);
  } catch (error) {
    showSnackbar(error.message || 'Error importando filas por foto.', 'error');
  } finally {
    importingPhotoRows.value = false;
  }
};

onMounted(() => {
  applyRouteContext();
  loadHistory();
  loadJobHistory();
});

watch(
  () => route.query.type,
  () => {
    applyRouteContext();
    loadHistory();
  }
);

watch(selectedType, () => {
  loadHistory();
});
</script>
