<template>
  <div class="list-view ofir-list-view">
    <v-card flat class="ofir-list-view__card">
      <v-card-title class="ofir-list-view__title d-flex flex-column flex-sm-row align-start align-sm-center pa-2 pa-sm-4">
        <div class="d-flex align-center mb-2 mb-sm-0">
          <v-icon :icon="icon" class="mr-2"></v-icon>
          <span class="text-h6">{{ title }}</span>
        </div>
        <v-spacer class="d-none d-sm-flex"></v-spacer>
        
        <!-- Búsqueda -->
        <v-text-field
          v-if="searchable"
          v-model="searchQuery"
          density="compact"
          variant="outlined"
          label="Buscar"
          prepend-inner-icon="mdi-magnify"
          single-line
          hide-details
          class="ofir-list-view__search mb-2 mb-sm-0 mr-sm-2"
          style="max-width: 100%; width: 100%;"
          :style="{ 'max-width': $vuetify.display.smAndUp ? '300px' : '100%' }"
          @update:model-value="debouncedSearch"
        ></v-text-field>

        <v-btn-toggle
          v-if="showViewToggle"
          v-model="viewMode"
          mandatory
          density="comfortable"
          color="primary"
          class="ofir-list-view__mode-toggle mb-2 mb-sm-0 mr-sm-2"
        >
          <v-btn value="list" icon="mdi-format-list-bulleted" size="small" :title="'Vista lista'"></v-btn>
          <v-btn value="table" icon="mdi-table" size="small" :title="'Vista tabla'"></v-btn>
        </v-btn-toggle>

        <!-- Botón crear -->
        <v-btn
          v-if="showCreateButton"
          class="ofir-list-view__create-btn"
          color="primary"
          prepend-icon="mdi-plus"
          :block="$vuetify.display.xs"
          @click="$emit('create')"
        >
          {{ createButtonText }}
        </v-btn>
      </v-card-title>

      <v-divider class="ofir-list-view__divider"></v-divider>

      <v-card-text v-if="$slots.filters" class="ofir-list-view__filters py-3">
        <slot name="filters"></slot>
      </v-card-text>

      <v-divider v-if="$slots.filters" class="ofir-list-view__divider"></v-divider>

      <!-- Loading -->
      <v-progress-linear
        v-if="loading"
        indeterminate
        color="primary"
        class="ofir-list-view__loading"
      ></v-progress-linear>

      <v-list
        v-if="!loading && displayItems.length > 0 && viewMode === 'list'"
        lines="two"
        class="ofir-list-view__list"
      >
        <template v-for="(item, index) in displayItems" :key="item[itemKey]">
          <v-list-item
            @click="$emit('item-click', item)"
            class="ofir-list-view__item"
            :class="{ 'cursor-pointer': clickable }"
          >
            <!-- Avatar/Icono -->
            <template v-slot:prepend v-if="$slots.avatar || avatarIcon">
              <slot name="avatar" :item="item">
                <v-avatar :color="avatarColor">
                  <v-icon>{{ avatarIcon }}</v-icon>
                </v-avatar>
              </slot>
            </template>

            <!-- Título y subtítulo -->
            <v-list-item-title>
              <slot name="title" :item="item">
                {{ item[titleField] }}
              </slot>
            </v-list-item-title>

            <v-list-item-subtitle v-if="subtitleField || $slots.subtitle">
              <slot name="subtitle" :item="item">
                {{ item[subtitleField] }}
              </slot>
            </v-list-item-subtitle>

            <!-- Contenido adicional -->
            <template v-if="$slots.content">
              <slot name="content" :item="item"></slot>
            </template>

            <!-- Acciones -->
            <template v-slot:append v-if="showActions || $slots.actions">
              <slot name="actions" :item="item">
                <div class="d-flex flex-column flex-sm-row ga-1">
                  <v-btn
                    v-if="editable"
                    icon="mdi-pencil"
                    variant="text"
                    size="small"
                    @click.stop="$emit('edit', item)"
                  ></v-btn>
                  <v-btn
                    v-if="deletable"
                    icon="mdi-delete"
                    variant="text"
                    size="small"
                    color="error"
                    @click.stop="$emit('delete', item)"
                  ></v-btn>
                </div>
              </slot>
            </template>
          </v-list-item>

          <v-divider v-if="index < displayItems.length - 1" class="ofir-list-view__item-divider"></v-divider>
        </template>
      </v-list>

      <div
        v-else-if="!loading && displayItems.length > 0 && viewMode === 'table'"
        class="ofir-list-view__table-container"
      >
        <v-table
          class="ofir-list-view__table"
          :class="{ 'ofir-list-view__table--explicit': hasExplicitTableColumns }"
          density="comfortable"
        >
          <thead>
            <tr>
              <th class="text-left">{{ tableMainTitle }}</th>
              <th
                v-for="column in normalizedTableColumns"
                :key="column.key"
                :class="column.align ? `text-${column.align}` : 'text-left'"
                :style="column.width ? { width: column.width } : undefined"
              >
                {{ column.title }}
              </th>
              <th v-if="showRowActions" class="text-right" style="width: 1%;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in displayItems"
              :key="item[itemKey]"
              class="ofir-list-view__table-row"
              :class="{ 'cursor-pointer': clickable }"
              @click="handleRowClick(item)"
            >
              <td class="ofir-list-view__table-main">
                <slot name="table-main" :item="item">
                  <div class="ofir-list-view__table-main-title">
                    <slot name="title" :item="item">
                      {{ item[titleField] }}
                    </slot>
                  </div>
                  <div
                    v-if="showTableSubtitleInline && (subtitleField || $slots.subtitle)"
                    class="ofir-list-view__table-main-subtitle text-medium-emphasis"
                  >
                    <slot name="subtitle" :item="item">
                      {{ item[subtitleField] }}
                    </slot>
                  </div>
                  <div v-if="showTableContentInline && $slots.content" class="ofir-list-view__table-main-content mt-2">
                    <slot name="content" :item="item"></slot>
                  </div>
                </slot>
              </td>
              <td
                v-for="column in normalizedTableColumns"
                :key="column.key"
                :class="column.align ? `text-${column.align}` : 'text-left'"
              >
                <slot
                  :name="`table-cell-${column.key}`"
                  :item="item"
                  :value="getColumnValue(item, column)"
                >
                  {{ getColumnValue(item, column) }}
                </slot>
              </td>
              <td v-if="showRowActions" class="text-right" @click.stop>
                <slot name="actions" :item="item">
                  <div class="d-flex justify-end flex-wrap ga-1">
                    <v-btn
                      v-if="editable"
                      icon="mdi-pencil"
                      variant="text"
                      size="small"
                      @click.stop="$emit('edit', item)"
                    ></v-btn>
                    <v-btn
                      v-if="deletable"
                      icon="mdi-delete"
                      variant="text"
                      size="small"
                      color="error"
                      @click.stop="$emit('delete', item)"
                    ></v-btn>
                  </div>
                </slot>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <!-- Sin datos -->
      <v-card-text v-if="!loading && displayItems.length === 0">
        <v-alert type="info" variant="tonal" class="text-center ofir-list-view__empty-alert">
          <v-icon size="48" class="mb-2">{{ emptyIcon }}</v-icon>
          <div>{{ emptyMessage }}</div>
        </v-alert>
      </v-card-text>

      <!-- Paginación -->
      <v-card-actions v-if="totalPages > 1" class="justify-center pa-2 ofir-list-view__pagination">
        <v-pagination
          v-model="currentPage"
          :length="totalPages"
          :total-visible="$vuetify.display.xs ? 5 : 7"
          :size="$vuetify.display.xs ? 'small' : 'default'"
          @update:model-value="loadPage"
        ></v-pagination>
      </v-card-actions>

      <!-- Info de paginación -->
      <v-card-text v-if="displayItems.length > 0" class="text-center text-caption pa-2 ofir-list-view__meta">
        Mostrando {{ startIndex + 1 }} - {{ endIndex }} de {{ totalItemsForView }} registros
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, useSlots } from 'vue'
import { useRoute } from 'vue-router'
import { useTenant } from '@/composables/useTenant'

const props = defineProps({
  title: { type: String, required: true },
  icon: { type: String, default: 'mdi-view-list' },
  items: { type: Array, default: () => [] },
  totalItems: { type: Number, default: 0 },
  itemKey: { type: String, default: 'id' },
  titleField: { type: String, default: 'name' },
  subtitleField: { type: String, default: '' },
  pageSize: { type: Number, default: 10 },
  autoLoad: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  searchable: { type: Boolean, default: true },
  clickable: { type: Boolean, default: false },
  editable: { type: Boolean, default: true },
  deletable: { type: Boolean, default: true },
  showCreateButton: { type: Boolean, default: true },
  createButtonText: { type: String, default: 'Crear' },
  avatarIcon: { type: String, default: '' },
  avatarColor: { type: String, default: 'primary' },
  emptyMessage: { type: String, default: 'No hay registros para mostrar' },
  emptyIcon: { type: String, default: 'mdi-inbox' },
  showViewToggle: { type: Boolean, default: true },
  defaultViewMode: { type: String, default: 'list' },
  viewStorageKey: { type: String, default: '' },
  clientSide: { type: Boolean, default: false },
  tableMainTitle: { type: String, default: 'Registro' },
  tableColumns: { type: Array, default: () => [] },
  searchFields: { type: Array, default: () => [] },
  tableInlineSubtitle: { type: Boolean, default: false },
  tableInlineContent: { type: Boolean, default: false }
})

const emit = defineEmits([
  'create',
  'edit',
  'delete',
  'item-click',
  'load-page',
  'search'
])

const slots = useSlots()
const route = useRoute()
const { tenantId } = useTenant()
const currentPage = ref(1)
const searchQuery = ref('')
const viewMode = ref('list')
let searchTimeout = null
const storageKey = computed(() => {
  const routeKey = route.name || route.path || 'global'
  const listKey = props.viewStorageKey || props.title
  const baseKey = `${routeKey}:${listKey}`
  return `ofir:list-view-mode:${String(baseKey)}`
})

const normalizedTableColumns = computed(() => {
  return props.tableColumns.map((column) => ({
    align: 'left',
    ...column
  }))
})

const hasExplicitTableColumns = computed(() => normalizedTableColumns.value.length > 0)
const showTableSubtitleInline = computed(() => !hasExplicitTableColumns.value || props.tableInlineSubtitle)
const showTableContentInline = computed(() => !hasExplicitTableColumns.value || props.tableInlineContent)

const filteredClientItems = computed(() => {
  if (!props.clientSide) return props.items

  const term = normalizeSearch(searchQuery.value)
  if (!term) return props.items

  return props.items.filter((item) => matchSearch(item, term))
})

const totalItemsForView = computed(() => {
  return props.clientSide ? filteredClientItems.value.length : props.totalItems
})

const totalPages = computed(() => Math.ceil(totalItemsForView.value / props.pageSize) || 1)
const startIndex = computed(() => (currentPage.value - 1) * props.pageSize)
const endIndex = computed(() => Math.min(startIndex.value + displayItems.value.length, totalItemsForView.value))
const showActions = computed(() => props.editable || props.deletable)
const showRowActions = computed(() => showActions.value || Boolean(slots.actions))

const displayItems = computed(() => {
  if (!props.clientSide) return props.items
  return filteredClientItems.value.slice(startIndex.value, startIndex.value + props.pageSize)
})

const normalizeSearch = (value) => String(value || '').trim().toLowerCase()

const getSearchableValues = (item) => {
  if (!item) return []
  if (props.searchFields.length > 0) {
    return props.searchFields.map((field) => {
      if (typeof field === 'function') return field(item)
      return item?.[field]
    })
  }

  return Object.values(item).flatMap((value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => JSON.stringify(entry))
    }
    if (value && typeof value === 'object') {
      return JSON.stringify(value)
    }
    return value
  })
}

const matchSearch = (item, term) => {
  return getSearchableValues(item).some((value) => normalizeSearch(value).includes(term))
}

const persistViewMode = (mode) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey.value, mode)
}

const restoreViewMode = () => {
  if (typeof window === 'undefined') return
  const stored = window.localStorage.getItem(storageKey.value)
  const nextMode = stored === 'table' || stored === 'list' ? stored : props.defaultViewMode
  viewMode.value = nextMode === 'table' ? 'table' : 'list'
}

const getColumnValue = (item, column) => {
  if (typeof column.value === 'function') return column.value(item)
  if (column.field) return item?.[column.field]
  return item?.[column.key]
}

const handleRowClick = (item) => {
  if (!props.clickable) return
  emit('item-click', item)
}

const loadPage = (page) => {
  currentPage.value = page
  if (props.clientSide) return
  emit('load-page', {
    page,
    pageSize: props.pageSize,
    search: searchQuery.value,
    tenantId: tenantId.value
  })
}

const debouncedSearch = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  searchTimeout = setTimeout(() => {
    currentPage.value = 1
    if (props.clientSide) return
    emit('search', {
      search: searchQuery.value,
      page: 1,
      pageSize: props.pageSize,
      tenantId: tenantId.value
    })
  }, 500)
}

// Recargar cuando cambia el tenant
watch(() => tenantId.value, () => {
  if (props.autoLoad && tenantId.value && !props.clientSide) {
    currentPage.value = 1
    loadPage(1)
  }
})

watch(viewMode, (mode) => {
  persistViewMode(mode)
})

watch(
  () => filteredClientItems.value.length,
  (length) => {
    if (!props.clientSide) return
    const maxPage = Math.max(1, Math.ceil(length / props.pageSize) || 1)
    if (currentPage.value > maxPage) {
      currentPage.value = maxPage
    }
  }
)

onMounted(() => {
  restoreViewMode()
  if (props.autoLoad && tenantId.value && !props.clientSide) {
    loadPage(1)
  }
})
</script>

<style scoped>
.list-view {
  width: 100%;
}

.ofir-list-view__card {
  border-radius: 18px;
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  background: linear-gradient(
    145deg,
    rgba(var(--v-theme-surface), 0.98),
    rgba(var(--v-theme-background), 0.92)
  );
  overflow: hidden;
  box-shadow: 0 10px 22px rgba(20, 29, 51, 0.12);
}

:global(.ofir-shell--dark) .ofir-list-view__card {
  border-color: rgba(96, 134, 255, 0.24);
  background: linear-gradient(145deg, rgba(14, 23, 46, 0.92), rgba(9, 17, 34, 0.95)) !important;
  box-shadow: 0 14px 28px rgba(3, 8, 20, 0.36);
}

:global(.ofir-shell--light) .ofir-list-view__card {
  border-color: rgba(40, 88, 211, 0.18);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.97), rgba(242, 248, 255, 0.95)) !important;
}

.ofir-list-view__title {
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.16);
  gap: 8px;
  flex-wrap: wrap;
}

.ofir-list-view__search {
  flex: 1 1 240px;
  min-width: 180px;
}

.ofir-list-view__search :deep(.v-field),
.ofir-list-view__filters :deep(.v-field) {
  border-radius: 12px;
}

.ofir-list-view__create-btn {
  border-radius: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.ofir-list-view__mode-toggle {
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
}

.ofir-list-view__divider {
  opacity: 0.55;
}

.ofir-list-view__list {
  background: transparent !important;
}

.ofir-list-view__item {
  border-radius: 12px;
  margin: 4px 8px;
  border: 1px solid transparent;
  transition: background-color 0.2s ease;
}

:global(.ofir-shell--dark) .ofir-list-view__item {
  background: linear-gradient(120deg, rgba(14, 23, 46, 0.62), rgba(10, 18, 35, 0.44));
  border-color: rgba(95, 133, 255, 0.14);
}

:global(.ofir-shell--light) .ofir-list-view__item {
  background: rgba(255, 255, 255, 0.78);
  border-color: rgba(41, 88, 212, 0.1);
}

.ofir-list-view__item-divider {
  margin: 0 12px;
}

.ofir-list-view__table-container {
  overflow-x: auto;
}

.ofir-list-view__table {
  background: transparent !important;
}

.ofir-list-view__table :deep(table) {
  min-width: 760px;
}

.ofir-list-view__table :deep(th) {
  font-weight: 700;
  white-space: nowrap;
}

.ofir-list-view__table :deep(td) {
  vertical-align: top;
  word-break: break-word;
}

.ofir-list-view__table-row {
  transition: background-color 0.2s ease;
}

.ofir-list-view__table-row:hover {
  background-color: rgba(var(--v-theme-primary), 0.05);
}

.ofir-list-view__table-main {
  min-width: 260px;
}

.ofir-list-view__table-main-title {
  font-weight: 700;
  line-height: 1.35;
  margin-bottom: 4px;
}

.ofir-list-view__table-main-subtitle {
  font-size: 0.9rem;
  line-height: 1.35;
  margin-top: 2px;
}

.ofir-list-view__empty-alert {
  border-radius: 14px;
}

.ofir-list-view__pagination {
  border-top: 1px solid rgba(var(--v-theme-primary), 0.14);
}

.ofir-list-view__meta {
  opacity: 0.82;
}

.cursor-pointer {
  cursor: pointer;
}

.cursor-pointer:hover {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

:global(.ofir-shell--dark) .cursor-pointer:hover {
  background: linear-gradient(120deg, rgba(40, 69, 146, 0.4), rgba(20, 35, 73, 0.34));
}

@media (max-width: 600px) {
  .ofir-list-view__item {
    margin: 2px 6px;
  }
}
</style>
