<template>
  <div class="ofir-page products-page">
    <!-- Tabs para separar productos y componentes -->
    <v-tabs v-model="currentTab" class="mb-3" color="primary">
      <v-tab value="products">
        <v-icon start>mdi-package-variant-closed</v-icon>
        Productos para Venta
      </v-tab>
      <v-tab value="components">
        <v-icon start>mdi-cog</v-icon>
        Insumos/Componentes
      </v-tab>
    </v-tabs>

    <v-alert
      v-if="productsHintConfig"
      :type="productsHintConfig.type"
      variant="tonal"
      class="mb-3"
    >
      <div class="text-subtitle-2 font-weight-bold mb-1">{{ productsHintConfig.title }}</div>
      <div class="text-body-2">{{ productsHintConfig.message }}</div>

      <div class="d-flex flex-wrap ga-2 mt-3">
        <v-btn
          v-for="action in productsHintConfig.actions"
          :key="action.label"
          size="small"
          :color="action.color"
          :variant="action.variant || 'tonal'"
          @click="action.onClick"
        >
          {{ action.label }}
        </v-btn>
      </div>
    </v-alert>

    <div class="d-flex justify-end mb-3 products-toolbar">
      <v-btn
        color="success"
        prepend-icon="mdi-microsoft-excel"
        :loading="exportingCatalog"
        @click="downloadCatalogExcel"
      >
        Descargar Catalogo Excel
      </v-btn>
    </div>

    <v-window v-model="currentTab">
      <!-- Tab: Productos para Venta -->
      <v-window-item value="products">
        <ListView
          title="Productos para Venta"
          icon="mdi-package-variant-closed"
          :items="products"
          :total-items="productsTotal"
          :loading="productsLoading"
          :page-size="defaultPageSize"
          item-key="product_id"
          title-field="name"
          avatar-icon="mdi-package-variant"
          avatar-color="indigo"
          empty-message="No hay productos registrados"
          create-button-text="Nuevo Producto"
          @create="openCreateDialog"
          @edit="openEditDialog"
          @delete="confirmDelete"
          @load-page="loadProducts"
          @search="loadProducts"
        >
          <template #subtitle="{ item }">
            {{ item.category ? item.category.name : 'Sin categoría' }}
          </template>
          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip :color="item.is_active ? 'success' : 'error'" size="small" variant="flat">
                {{ item.is_active ? 'Activo' : 'Inactivo' }}
              </v-chip>
              <v-chip size="small" variant="tonal" prepend-icon="mdi-cube-outline">
                {{ item.product_variants?.length || 0 }} variante(s)
              </v-chip>
              <v-chip v-if="item.track_inventory" size="small" variant="tonal" color="info" prepend-icon="mdi-archive">
                Inventario
              </v-chip>
            </div>
          </template>
          <template #actions="{ item }">
            <div class="d-flex flex-column flex-sm-row ga-1">
              <v-tooltip text="Gestionar variantes" location="top">
                <template #activator="{ props }">
                  <v-btn
                    icon="mdi-cube-outline"
                    variant="text"
                    size="small"
                    color="primary"
                    v-bind="props"
                    @click.stop="openVariantDialogFromList(item)"
                  ></v-btn>
                </template>
              </v-tooltip>
              <v-btn
                icon="mdi-pencil"
                variant="text"
                size="small"
                @click.stop="openEditDialog(item)"
              ></v-btn>
              <v-btn
                icon="mdi-delete"
                variant="text"
                size="small"
                color="error"
                @click.stop="confirmDelete(item)"
              ></v-btn>
            </div>
          </template>
        </ListView>
      </v-window-item>

      <!-- Tab: Insumos/Componentes -->
      <v-window-item value="components">
        <ListView
          title="Insumos/Componentes"
          icon="mdi-cog"
          :items="components"
          :total-items="componentsTotal"
          :loading="componentsLoading"
          :page-size="defaultPageSize"
          item-key="product_id"
          title-field="name"
          avatar-icon="mdi-cog"
          avatar-color="orange"
          empty-message="No hay componentes registrados"
          create-button-text="Nuevo Componente"
          @create="openCreateDialog"
          @edit="openEditDialog"
          @delete="confirmDelete"
          @load-page="loadComponents"
          @search="loadComponents"
        >
          <template #subtitle="{ item }">
            {{ item.category ? item.category.name : 'Sin categoría' }}
          </template>
          <template #content="{ item }">
            <div class="mt-2 d-flex flex-wrap ga-2">
              <v-chip color="orange" size="small" variant="flat">
                Es componente
              </v-chip>
              <v-chip :color="item.is_active ? 'success' : 'error'" size="small" variant="flat">
                {{ item.is_active ? 'Activo' : 'Inactivo' }}
              </v-chip>
              <v-chip size="small" variant="tonal" prepend-icon="mdi-cube-outline">
                {{ item.product_variants?.length || 0 }} variante(s)
              </v-chip>
            </div>
          </template>
          <template #actions="{ item }">
            <div class="d-flex flex-column flex-sm-row ga-1">
              <v-tooltip text="Gestionar variantes" location="top">
                <template #activator="{ props }">
                  <v-btn
                    icon="mdi-cube-outline"
                    variant="text"
                    size="small"
                    color="primary"
                    v-bind="props"
                    @click.stop="openVariantDialogFromList(item)"
                  ></v-btn>
                </template>
              </v-tooltip>
              <v-btn
                icon="mdi-pencil"
                variant="text"
                size="small"
                @click.stop="openEditDialog(item)"
              ></v-btn>
              <v-btn
                icon="mdi-delete"
                variant="text"
                size="small"
                color="error"
                @click.stop="confirmDelete(item)"
              ></v-btn>
            </div>
          </template>
        </ListView>
      </v-window-item>
    </v-window>

    <!-- Dialog Crear/Editar Producto -->
    <v-dialog v-model="dialog" max-width="700" scrollable>
      <v-card>
        <v-card-title>
          <v-icon start>{{ isEditing ? 'mdi-pencil' : 'mdi-plus' }}</v-icon>
          {{ isEditing ? 'Editar Producto' : 'Nuevo Producto' }}
        </v-card-title>
        <v-card-text>
          <v-form ref="form" @submit.prevent="save">
            <v-row>
              <v-col cols="12" sm="8">
                <v-text-field v-model="formData.name" :label="t('common.name')" prepend-inner-icon="mdi-text" variant="outlined" :rules="[rules.required]"></v-text-field>
              </v-col>
              <v-col cols="12" sm="4">
                <v-select v-model="formData.category_id" label="Categoría" prepend-inner-icon="mdi-shape" variant="outlined" :items="categoryOptions" item-title="name" item-value="category_id" clearable></v-select>
              </v-col>
              <v-col cols="12" sm="4">
                <v-autocomplete
                  v-model="formData.unit_id"
                  :items="unitOptions"
                  item-title="display_name"
                  item-value="unit_id"
                  label="Unidad de medida"
                  prepend-inner-icon="mdi-ruler"
                  variant="outlined"
                  clearable
                  hint="Selecciona la unidad de medida del producto"
                  persistent-hint
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props">
                      <template #prepend>
                        <v-chip size="x-small" :color="item.raw.is_system ? 'blue' : 'green'">
                          {{ item.raw.code }}
                        </v-chip>
                      </template>
                      <template #append v-if="item.raw.dian_code">
                        <v-chip size="x-small" variant="outlined" color="purple">
                          DIAN: {{ item.raw.dian_code }}
                        </v-chip>
                      </template>
                    </v-list-item>
                  </template>
                </v-autocomplete>
              </v-col>
              <v-col cols="12">
                <v-textarea v-model="formData.description" label="Descripción" prepend-inner-icon="mdi-text-long" variant="outlined" rows="2" auto-grow></v-textarea>
              </v-col>
            </v-row>

            <!-- Gestión de Variantes -->
            <v-divider class="my-4"></v-divider>
            <div class="text-subtitle-1 font-weight-bold mb-3">
              <v-icon start color="primary">mdi-package-variant</v-icon>
              Gestión de Variantes
            </div>
            <v-radio-group v-model="formData.variant_mode" inline hide-details class="mb-4">
              <v-radio 
                label="Producto Simple (variante única)" 
                value="single"
              >
                <template #label>
                  <div>
                    <div class="font-weight-medium">Producto Simple (variante única)</div>
                    <div class="text-caption text-grey">Un solo precio y costo para todo el producto</div>
                  </div>
                </template>
              </v-radio>
              <v-radio 
                label="Producto con Variantes" 
                value="multiple"
              >
                <template #label>
                  <div>
                    <div class="font-weight-medium">Producto con Variantes</div>
                    <div class="text-caption text-grey">Múltiples variantes (tallas, colores, etc.) con precios diferentes</div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>

            <!-- Información de Precio (solo para variante única) -->
            <div v-if="formData.variant_mode === 'single'">
            <v-divider class="my-4"></v-divider>
            <div class="text-subtitle-1 font-weight-bold mb-3">
              <v-icon start color="success">mdi-currency-usd</v-icon>
              Información de Precio
            </div>
            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model.number="formData.base_cost"
                  label="Costo Base"
                  prepend-inner-icon="mdi-cash-minus"
                  variant="outlined"
                  type="number"
                  hint="Costo del producto (se aplicará a la variante predeterminada)"
                  persistent-hint
                  :rules="[rules.positive]"
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model.number="formData.base_price"
                  label="Precio Base"
                  prepend-inner-icon="mdi-cash-plus"
                  variant="outlined"
                  type="number"
                  hint="Precio de venta (se aplicará a la variante predeterminada)"
                  persistent-hint
                  :rules="[rules.positive]"
                ></v-text-field>
              </v-col>
              <v-col v-if="formData.track_inventory" cols="12" sm="6">
                <v-text-field
                  v-model.number="formData.base_min_stock"
                  label="Stock Mínimo"
                  prepend-inner-icon="mdi-alert-outline"
                  variant="outlined"
                  type="number"
                  hint="Genera alerta cuando stock <= este valor (0 = sin alerta)"
                  persistent-hint
                  :rules="[rules.positiveOrZero]"
                ></v-text-field>
              </v-col>
            </v-row>
            <v-alert type="info" density="compact" class="my-3" variant="tonal">
              <template #text>
                <v-icon start size="small">mdi-information</v-icon>
                El producto se creará con una variante predeterminada usando este costo y precio. Podrás agregar más variantes después si lo necesitas.
              </template>
            </v-alert>
            </div>

            <!-- Configuración de Manufactura -->
            <v-divider class="my-4"></v-divider>
            <div class="text-subtitle-1 font-weight-bold mb-3">
              <v-icon start color="primary">mdi-cog</v-icon>
              Configuración de Manufactura
            </div>
            <v-row>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="formData.inventory_behavior"
                  :items="inventoryBehaviorOptions"
                  label="Tipo de Inventario"
                  prepend-inner-icon="mdi-cube-outline"
                  variant="outlined"
                  hint="Define cómo se maneja el inventario del producto"
                  persistent-hint
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props">
                      <template #append>
                        <v-icon v-if="item.value === 'SERVICE'" color="blue" size="small">mdi-hand-extended</v-icon>
                        <v-icon v-else-if="item.value === 'MANUFACTURED'" color="orange" size="small">mdi-factory</v-icon>
                        <v-icon v-else-if="item.value === 'BUNDLE'" color="purple" size="small">mdi-package-variant</v-icon>
                        <v-icon v-else color="green" size="small">mdi-cart</v-icon>
                      </template>
                    </v-list-item>
                  </template>
                </v-select>
              </v-col>
              <v-col v-if="formData.inventory_behavior === 'MANUFACTURED'" cols="12" sm="6">
                <v-select
                  v-model="formData.production_type"
                  :items="productionTypeOptions"
                  label="Tipo de Producción"
                  prepend-inner-icon="mdi-factory"
                  variant="outlined"
                  hint="Bajo demanda o para stock"
                  persistent-hint
                ></v-select>
              </v-col>
            </v-row>

            <!-- Controles de inventario -->
            <v-divider class="my-4"></v-divider>
            <div class="text-subtitle-1 font-weight-bold mb-3">
              <v-icon start color="info">mdi-package-variant-closed</v-icon>
              Control de Inventario
            </div>
            <v-row>
              <v-col cols="6">
                <v-switch v-model="formData.is_active" :label="t('common.active')" color="success" hide-details></v-switch>
              </v-col>
              <v-col cols="6">
                <v-switch 
                  v-model="formData.track_inventory" 
                  label="Controlar inventario" 
                  color="info" 
                  :disabled="!canTrackInventory"
                  :hint="!canTrackInventory ? 'No disponible para ' + (formData.inventory_behavior === 'SERVICE' ? 'Servicios' : 'Combos') : 'Registrar entradas/salidas de stock'"
                  persistent-hint
                ></v-switch>
              </v-col>
              <v-col cols="12">
                <v-switch 
                  v-model="formData.requires_expiration" 
                  label="Requiere control de vencimiento" 
                  color="warning"
                  :disabled="!canRequireExpiration"
                  :hint="!canRequireExpiration ? 'No disponible para ' + (formData.inventory_behavior === 'SERVICE' ? 'Servicios' : 'Combos') : 'Los productos con esta opción deben registrarse en lotes con fecha de vencimiento'"
                  persistent-hint
                ></v-switch>
              </v-col>
              <v-col cols="12">
                <v-switch
                  v-model="formData.is_component"
                  label="Es componente de otros productos"
                  color="purple"
                  :disabled="!canBeComponent"
                  :hint="!canBeComponent 
                    ? (formData.inventory_behavior === 'SERVICE' ? 'Los servicios no son componentes físicos' 
                      : formData.inventory_behavior === 'MANUFACTURED' ? 'Los productos manufacturados son resultado final, no componentes. Marca los insumos como componentes.' 
                      : 'Los combos no pueden ser componentes de otros productos')
                    : 'Marca este producto como insumo/materia prima para poder usarlo en BOMs de manufactura'"
                  persistent-hint
                ></v-switch>
              </v-col>
              <v-col v-if="formData.inventory_behavior === 'MANUFACTURED' && isEditing" cols="12">
                <v-btn
                  color="primary"
                  variant="tonal"
                  block
                  prepend-icon="mdi-file-tree"
                  @click="openBOMEditor"
                >
                  {{ formData.active_bom_id ? 'Editar BOM' : 'Configurar BOM' }}
                </v-btn>
                <div v-if="formData.active_bom_id" class="text-caption text-success mt-1">
                  <v-icon size="small">mdi-check-circle</v-icon>
                  BOM configurado
                </div>
              </v-col>
            </v-row>

            <!-- Variantes (solo si modo múltiple O si está editando con variante única y quiere agregar más) -->
            <div v-if="formData.variant_mode === 'multiple' || (isEditing && formData.variant_mode === 'single')">
            <v-divider class="my-4"></v-divider>
            <div class="d-flex align-center mb-2">
              <span class="text-subtitle-1 font-weight-bold">Variantes</span>
              <v-spacer></v-spacer>
              <v-btn v-if="isEditing" size="small" color="primary" prepend-icon="mdi-plus" variant="tonal" @click="addVariant">Agregar</v-btn>
            </div>

            <div v-if="!isEditing && formData.variant_mode === 'multiple'" class="text-body-2 text-grey mb-2">
              Guarde el producto primero, luego agregue variantes manualmente.
            </div>
            
            <v-alert v-if="isEditing && formData.variant_mode === 'single' && variants.length === 1" type="success" density="compact" class="mb-3" variant="tonal">
              <template #text>
                <v-icon start size="small">mdi-check-circle</v-icon>
                Producto con variante predeterminada. Si necesitas agregar variantes adicionales (tallas, colores), usa el botón "Agregar" arriba.
              </template>
            </v-alert>
            
            <v-alert v-if="isEditing && formData.variant_mode === 'multiple' && variants.length === 0" type="warning" density="compact" class="mb-3" variant="tonal">
              <template #text>
                <v-icon start size="small">mdi-alert</v-icon>
                Este producto requiere al menos una variante. Usa el botón "Agregar" para crear variantes con diferentes precios, tallas, colores, etc.
              </template>
            </v-alert>

            <!-- Desktop: List -->
            <v-list v-if="isEditing && variants.length > 0" density="compact" class="d-none d-sm-block">
              <template v-for="(v, i) in variants" :key="v.variant_id || i">
                <v-list-item>
                  <v-list-item-title>{{ v.variant_name || 'Default' }} — SKU: {{ v.sku }}</v-list-item-title>
                  <v-list-item-subtitle>Costo: {{ v.cost }} | Precio: {{ v.price }}</v-list-item-subtitle>
                  <template #append>
                    <v-btn icon="mdi-pencil" size="x-small" variant="text" @click="editVariant(v)"></v-btn>
                    <v-btn icon="mdi-delete" size="x-small" variant="text" color="error" @click="confirmDeleteVariant(v)"></v-btn>
                  </template>
                </v-list-item>
                <v-divider v-if="i < variants.length - 1"></v-divider>
              </template>
            </v-list>

            <!-- Mobile: Cards -->
            <div v-if="isEditing && variants.length > 0" class="d-sm-none">
              <v-card v-for="(v, i) in variants" :key="v.variant_id || i" variant="outlined" class="mb-2">
                <v-card-text>
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div class="text-body-2 font-weight-bold">{{ v.variant_name || 'Default' }}</div>
                    <v-chip size="x-small" color="primary">{{ v.sku }}</v-chip>
                  </div>
                  <v-divider class="my-2"></v-divider>
                  <div class="d-flex justify-space-between text-caption mb-1">
                    <span class="text-grey">Costo:</span>
                    <span>{{ v.cost }}</span>
                  </div>
                  <div class="d-flex justify-space-between text-caption mb-2">
                    <span class="text-grey">Precio:</span>
                    <span class="font-weight-bold">{{ v.price }}</span>
                  </div>
                  <div class="d-flex ga-2">
                    <v-btn prepend-icon="mdi-pencil" size="small" variant="outlined" color="primary" flex @click="editVariant(v)">
                      Editar
                    </v-btn>
                    <v-btn prepend-icon="mdi-delete" size="small" variant="outlined" color="error" flex @click="confirmDeleteVariant(v)">
                      Eliminar
                    </v-btn>
                  </div>
                </v-card-text>
              </v-card>
            </div>
            </div>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ isEditing ? 'Actualizar' : 'Crear' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Variante -->
    <v-dialog v-model="variantDialog" max-width="500">
      <v-card>
        <v-card-title>{{ editingVariant ? 'Editar Variante' : 'Nueva Variante' }}</v-card-title>
        <v-card-text>
          <v-form ref="variantForm" @submit.prevent="saveVariant">
            <div class="d-flex ga-2 align-end mb-2">
              <v-text-field 
                v-model="variantData.sku" 
                label="SKU" 
                prepend-inner-icon="mdi-barcode" 
                variant="outlined" 
                :rules="[rules.required]"
                hint="Código único del producto"
                persistent-hint
                style="flex: 1"
              ></v-text-field>
              <v-tooltip text="Generar SKU automático" location="top">
                <template #activator="{ props }">
                  <v-btn 
                    v-bind="props"
                    icon="mdi-auto-fix"
                    color="primary" 
                    variant="tonal" 
                    @click="autoGenerateSKU"
                    :disabled="!formData.name"
                  ></v-btn>
                </template>
              </v-tooltip>
            </div>
            <v-text-field 
              v-model="variantData.variant_name" 
              label="Nombre variante" 
              prepend-inner-icon="mdi-text" 
              variant="outlined" 
              hint="Ej: Rojo / M" 
              class="mb-2"
            ></v-text-field>
            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field 
                  v-model.number="variantData.cost" 
                  label="Costo" 
                  prepend-inner-icon="mdi-cash-minus" 
                  variant="outlined" 
                  type="number" 
                  :rules="[rules.required, rules.positive]"
                  hint="Costo base de la variante"
                  persistent-hint
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field 
                  v-model.number="variantData.price" 
                  label="Precio de Venta" 
                  prepend-inner-icon="mdi-cash-plus" 
                  variant="outlined" 
                  type="number" 
                  :rules="[rules.required, rules.positive]"
                  hint="Precio calculado según políticas de precio"
                  persistent-hint
                ></v-text-field>
              </v-col>
              <v-col cols="12">
                <v-switch 
                  v-model="variantData.price_includes_tax" 
                  label="Precio incluye IVA (IVA incluido)" 
                  color="primary"
                  hint="Si está activo: el precio ya incluye el IVA (se descompone). Si está inactivo: el IVA se suma al precio."
                  persistent-hint
                  class="mb-2"
                ></v-switch>
              </v-col>
            </v-row>

            <v-divider class="my-4"></v-divider>
            <div class="text-subtitle-2 mb-3">
              <v-icon start color="info" size="small">mdi-package-variant-closed</v-icon>
              Control de Inventario
            </div>

            <v-text-field 
              v-model.number="variantData.min_stock" 
              label="Stock mínimo" 
              prepend-inner-icon="mdi-alert-circle-outline" 
              variant="outlined" 
              type="number" 
              min="0"
              :disabled="!variantCanTrackInventory"
              :hint="!variantCanTrackInventory 
                ? 'No disponible para productos tipo ' + (formData.inventory_behavior === 'SERVICE' ? 'Servicio' : 'Combo') 
                : 'Genera alerta cuando stock en cualquier sede esté bajo este valor'"
              persistent-hint
              class="mb-2"
            ></v-text-field>
            <v-switch 
              v-model="variantData.allow_backorder" 
              label="Permitir sobreventa" 
              color="warning"
              :disabled="!variantCanTrackInventory"
              :hint="!variantCanTrackInventory 
                ? 'No disponible para productos tipo ' + (formData.inventory_behavior === 'SERVICE' ? 'Servicio' : 'Combo') 
                : 'Permite vender aunque no haya stock (inventario negativo)'"
              persistent-hint
              class="mb-2"
            ></v-switch>
            <div class="mb-2">
              <div class="d-flex align-center ga-2 mb-1">
                <span class="text-body-2">Control de vencimiento</span>
                <v-tooltip text="Null = heredar del producto, True = requerir, False = no requerir">
                  <template #activator="{ props }">
                    <v-icon v-bind="props" size="small" color="grey">mdi-information</v-icon>
                  </template>
                </v-tooltip>
              </div>
              <v-radio-group 
                v-model="variantData.requires_expiration" 
                inline
                hide-details
                :disabled="!variantCanRequireExpiration"
              >
                <v-radio label="Heredar del producto" :value="null"></v-radio>
                <v-radio label="Sí requiere" :value="true"></v-radio>
                <v-radio label="No requiere" :value="false"></v-radio>
              </v-radio-group>
              <div v-if="!variantCanRequireExpiration" class="text-caption text-grey mt-1">
                No disponible para productos tipo {{ formData.inventory_behavior === 'SERVICE' ? 'Servicio' : 'Combo' }}
              </div>
            </div>
            <v-switch v-model="variantData.is_active" :label="t('common.active')" color="success" hide-details></v-switch>

            <v-divider class="my-4"></v-divider>
            <div class="text-subtitle-2 mb-3">
              <v-icon start color="orange" size="small">mdi-receipt-text</v-icon>
              Facturación Electrónica (DIAN)
            </div>
            <v-row>
              <v-col cols="12">
                <v-autocomplete
                  v-model="variantData.unit_id"
                  :items="unitOptions"
                  item-title="display_name"
                  item-value="unit_id"
                  label="Unidad de medida DIAN"
                  prepend-inner-icon="mdi-ruler"
                  variant="outlined"
                  clearable
                  hint="Unidad requerida en el XML FE (ej: 94=Unidad, KGM=Kilogramo)"
                  persistent-hint
                ></v-autocomplete>
              </v-col>
              <v-col cols="12" sm="8">
                <v-text-field
                  v-model="variantData.standard_code"
                  label="Código estándar (UNSPSC / EAN / GTIN)"
                  prepend-inner-icon="mdi-barcode"
                  variant="outlined"
                  hint="Código UNSPSC del producto para el XML FE"
                  persistent-hint
                ></v-text-field>
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="variantData.standard_code_type"
                  :items="[{title:'UNSPSC', value:'UNSPSC'},{title:'EAN', value:'EAN'},{title:'GTIN', value:'GTIN'},{title:'Fabricante', value:'PARTNUM'}]"
                  item-title="title"
                  item-value="value"
                  label="Tipo código"
                  variant="outlined"
                  hint="Tipo de código estándar"
                  persistent-hint
                ></v-select>
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="variantDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="savingVariant" @click="saveVariant">{{ t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirmations -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title><v-icon start color="error">mdi-alert</v-icon>{{ t('common.confirmDelete') }}</v-card-title>
        <v-card-text>¿Eliminar el producto <strong>{{ itemToDelete?.name }}</strong> y todas sus variantes?</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">{{ t('common.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- BOM Editor -->
    <BOMEditor ref="bomEditor" @saved="onBOMSaved" />

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import ListView from '@/components/ListView.vue'
import BOMEditor from '@/components/BOMEditor.vue'
import productsService from '@/services/products.service'
import categoriesService from '@/services/categories.service'
import manufacturingService from '@/services/manufacturing.service'
import unitsOfMeasureService from '@/services/unitsOfMeasure.service'
import { humanizeAppError } from '@/utils/appErrors'
import { generateSKU, generateShortSKU } from '@/utils/skuGenerator'
import { utils, writeFileXLSX } from 'xlsx'
import { useI18n } from '@/i18n'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const { tenantId } = useTenant()
const { defaultPageSize, loadSettings } = useTenantSettings()
const currentTab = ref('products')
const guidedActionHandled = ref('')

// Estado independiente para productos y componentes
const products = ref([])
const productsTotal = ref(0)
const productsLoading = ref(false)

const components = ref([])
const componentsTotal = ref(0)
const componentsLoading = ref(false)

const dialog = ref(false)
const deleteDialog = ref(false)
const variantDialog = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const savingVariant = ref(false)
const deleting = ref(false)
const form = ref(null)
const variantForm = ref(null)
const itemToDelete = ref(null)
const categoryOptions = ref([])
const unitOptions = ref([])
const variants = ref([])
const editingVariant = ref(false)
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')
const bomEditor = ref(null)
const exportingCatalog = ref(false)

const formData = ref({ 
  product_id: null, 
  name: '', 
  description: '', 
  category_id: null,
  unit_id: null,
  variant_mode: 'single',
  base_cost: 0,
  base_price: 0,
  base_min_stock: 0,
  is_active: true, 
  track_inventory: false, 
  requires_expiration: false,
  inventory_behavior: 'RESELL',
  production_type: null,
  is_component: false,
  active_bom_id: null
})

const variantData = ref({ 
  variant_id: null, 
  product_id: null, 
  sku: '', 
  variant_name: '', 
  cost: 0, 
  price: 0, 
  price_includes_tax: false, 
  min_stock: 0, 
  allow_backorder: false, 
  requires_expiration: null, 
  is_active: true,
  // Facturación Electrónica DIAN
  standard_code: '',
  standard_code_type: 'UNSPSC',
  unit_id: null   // Unidad de medida DIAN por defecto para esta variante
})

const inventoryBehaviorOptions = [
  { value: 'RESELL', title: 'Reventa (Normal)' },
  { value: 'SERVICE', title: 'Servicio (Sin inventario)' },
  { value: 'MANUFACTURED', title: 'Manufacturado' },
  { value: 'BUNDLE', title: 'Combo/Bundle' }
]

const productionTypeOptions = [
  { value: 'ON_DEMAND', title: 'Bajo Demanda (On-Demand)' },
  { value: 'TO_STOCK', title: 'Para Stock (To-Stock)' }
]
const allowedTabs = ['products', 'components']

const openBulkImports = () => {
  router.push({
    path: '/bulk-imports',
    query: {
      type: 'product_variants',
      onboarding: 'inventory-import'
    }
  })
}

const goToInventoryOperations = () => {
  router.push({
    path: '/inventory',
    query: {
      tab: 'operations',
      onboarding: 'inventory-stock'
    }
  })
}

const productsHintConfig = computed(() => {
  const onboarding = String(route.query.onboarding || '').trim()

  if (onboarding === 'sales-products') {
    return {
      type: 'info',
      title: 'Catalogo listo para vender',
      message: 'Para vender en POS necesitas productos con al menos una variante activa. Si vienes de Excel, puedes acelerar el arranque con cargue masivo.',
      actions: [
        {
          label: 'Nuevo producto',
          color: 'primary',
          variant: 'elevated',
          onClick: openCreateDialog
        },
        {
          label: 'Cargue masivo',
          color: 'secondary',
          onClick: openBulkImports
        }
      ]
    }
  }

  if (onboarding === 'purchases-products') {
    return {
      type: 'info',
      title: 'Catalogo listo para compras',
      message: 'Antes de comprar, verifica que el producto y su variante existan. Luego podras ingresar existencias desde Compras o desde Operaciones de inventario.',
      actions: [
        {
          label: 'Nuevo producto',
          color: 'primary',
          variant: 'elevated',
          onClick: openCreateDialog
        },
        {
          label: 'Cargue masivo',
          color: 'secondary',
          onClick: openBulkImports
        }
      ]
    }
  }

  if (onboarding === 'inventory-products') {
    return {
      type: 'warning',
      title: 'Productos con inventario activo',
      message: 'Crea productos inventariables y activa control de inventario para que luego puedas cargar stock real y verlo en kardex.',
      actions: [
        {
          label: 'Nuevo producto',
          color: 'primary',
          variant: 'elevated',
          onClick: openCreateDialog
        },
        {
          label: 'Cargue masivo',
          color: 'secondary',
          onClick: openBulkImports
        }
      ]
    }
  }

  if (onboarding === 'inventory-variants') {
    return {
      type: 'info',
      title: 'Las variantes son las que operan el stock',
      message: 'Cada producto debe tener al menos una variante para comprar, mover y vender inventario. Usa el boton de variantes en la lista o carga varias desde Excel.',
      actions: [
        {
          label: 'Cargue masivo',
          color: 'secondary',
          variant: 'elevated',
          onClick: openBulkImports
        },
        {
          label: 'Ir a inventario',
          color: 'primary',
          onClick: goToInventoryOperations
        }
      ]
    }
  }

  return null
})

// Lógica condicional para habilitar/deshabilitar campos según tipo de inventario
const canTrackInventory = computed(() => {
  // Solo RESELL y MANUFACTURED pueden controlar inventario
  return formData.value.inventory_behavior === 'RESELL' || formData.value.inventory_behavior === 'MANUFACTURED'
})

const canRequireExpiration = computed(() => {
  // Solo RESELL y MANUFACTURED pueden requerir vencimiento
  return formData.value.inventory_behavior === 'RESELL' || formData.value.inventory_behavior === 'MANUFACTURED'
})

const canBeComponent = computed(() => {
  // Solo RESELL puede ser componente (insumos/materias primas)
  return formData.value.inventory_behavior === 'RESELL'
})

// Lógica condicional para variantes según el tipo de inventario del producto padre
const variantCanTrackInventory = computed(() => {
  // Las variantes solo pueden controlar inventario si el producto padre lo permite
  return formData.value.inventory_behavior === 'RESELL' || formData.value.inventory_behavior === 'MANUFACTURED'
})

const variantCanRequireExpiration = computed(() => {
  // Las variantes solo pueden requerir vencimiento si el producto padre lo permite
  return formData.value.inventory_behavior === 'RESELL' || formData.value.inventory_behavior === 'MANUFACTURED'
})

// Watcher para ajustar valores cuando cambia el tipo de inventario
watch(() => formData.value.inventory_behavior, (newValue) => {
  // SERVICE: forzar todo a false
  if (newValue === 'SERVICE') {
    formData.value.track_inventory = false
    formData.value.requires_expiration = false
    formData.value.is_component = false
    // Resetear valores de variante si el diálogo está abierto
    if (variantDialog.value) {
      variantData.value.min_stock = 0
      variantData.value.allow_backorder = false
      variantData.value.requires_expiration = null
    }
  }
  // BUNDLE: forzar todo a false
  else if (newValue === 'BUNDLE') {
    formData.value.track_inventory = false
    formData.value.requires_expiration = false
    formData.value.is_component = false
    // Resetear valores de variante si el diálogo está abierto
    if (variantDialog.value) {
      variantData.value.min_stock = 0
      variantData.value.allow_backorder = false
      variantData.value.requires_expiration = null
    }
  }
  // MANUFACTURED: habilitar inventario/vencimiento, deshabilitar componente
  else if (newValue === 'MANUFACTURED') {
    formData.value.is_component = false
  }
  // RESELL: todo habilitado (valores por defecto)
  else if (newValue === 'RESELL') {
    if (!formData.value.track_inventory) formData.value.track_inventory = true
  }
})

const rules = {
  required: v => !!v || v === 0 || 'Campo requerido',
  positive: v => v >= 0 || 'Debe ser >= 0',
  positiveOrZero: v => v >= 0 || 'Debe ser >= 0'
}

const loadProducts = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  productsLoading.value = true
  try {
    const r = await productsService.getProducts(tid, page, pageSize, search, { is_component: false })
    if (r.success) {
      products.value = r.data
      productsTotal.value = r.total
    } else {
      showMsg('Error al cargar productos', 'error')
    }
  } finally { productsLoading.value = false }
}

const loadComponents = async ({ page, pageSize, search, tenantId: tid }) => {
  if (!tid) return
  componentsLoading.value = true
  try {
    const r = await productsService.getProducts(tid, page, pageSize, search, { is_component: true })
    if (r.success) {
      components.value = r.data
      componentsTotal.value = r.total
    } else {
      showMsg('Error al cargar componentes', 'error')
    }
  } finally { componentsLoading.value = false }
}

const loadCategories = async () => {
  if (!tenantId.value) return
  const r = await categoriesService.getAllCategories(tenantId.value)
  if (r.success) categoryOptions.value = r.data
}

const loadUnits = async () => {
  if (!tenantId.value) return
  const r = await unitsOfMeasureService.getActiveUnits(tenantId.value)
  if (r.success) {
    unitOptions.value = r.data.map(u => ({
      ...u,
      display_name: `${u.code} - ${u.name}${u.dian_code ? ' (DIAN: ' + u.dian_code + ')' : ''}`
    }))
  }
}

const applyRouteContext = () => {
  const requestedTab = String(route.query.tab || '').trim()
  if (allowedTabs.includes(requestedTab)) {
    currentTab.value = requestedTab
  }
}

const handleGuidedAction = () => {
  const action = String(route.query.action || '').trim()
  if (!action || guidedActionHandled.value === action) return

  if (action === 'create-product') {
    guidedActionHandled.value = action
    openCreateDialog()
  }
}

const openCreateDialog = () => {
  const onboarding = String(route.query.onboarding || '').trim()
  const shouldTrackInventoryByDefault = ['sales-products', 'purchases-products', 'inventory-products'].includes(onboarding)

  isEditing.value = false
  formData.value = { 
    product_id: null, 
    name: '', 
    description: '', 
    category_id: null, 
    unit_id: null,
    variant_mode: 'single',
    base_cost: 0,
    base_price: 0,
    base_min_stock: 0,
    is_active: true, 
    track_inventory: shouldTrackInventoryByDefault,
    requires_expiration: false,
    inventory_behavior: 'RESELL',
    production_type: null,
    is_component: false
  }
  variants.value = []
  loadCategories()
  loadUnits()
  dialog.value = true
}

const openEditDialog = async (item) => {
  isEditing.value = true
  loadCategories()
  loadUnits()
  const r = await productsService.getProductById(tenantId.value, item.product_id)
  if (r.success) {
    const variantsData = r.data.product_variants || []
    
    // Detectar si es variante única o múltiple
    const isSingleVariant = variantsData.length === 1 && 
                           (variantsData[0].variant_name === 'Predeterminado' || 
                            variantsData[0].variant_name === null)
    
    formData.value = { 
      product_id: r.data.product_id, 
      name: r.data.name, 
      description: r.data.description, 
      category_id: r.data.category_id,
      unit_id: r.data.unit_id || null,
      variant_mode: isSingleVariant ? 'single' : 'multiple',
      base_cost: isSingleVariant ? (variantsData[0]?.cost || 0) : 0,
      base_price: isSingleVariant ? (variantsData[0]?.price || 0) : 0,
      base_min_stock: isSingleVariant ? (variantsData[0]?.min_stock || 0) : 0,
      is_active: r.data.is_active, 
      track_inventory: r.data.track_inventory,
      requires_expiration: r.data.requires_expiration || false,
      inventory_behavior: r.data.inventory_behavior || 'RESELL',
      production_type: r.data.production_type || null,
      is_component: r.data.is_component || false,
      active_bom_id: r.data.active_bom_id || null
    }
    variants.value = variantsData
    dialog.value = true
  } else showMsg('Error al cargar producto', 'error')
}

const openVariantDialogFromList = async (item) => {
  // Cargar el producto y abrir directamente el diálogo de agregar variante
  isEditing.value = true
  loadCategories()
  const r = await productsService.getProductById(tenantId.value, item.product_id)
  if (r.success) {
    formData.value = { 
      product_id: r.data.product_id, 
      name: r.data.name, 
      description: r.data.description, 
      category_id: r.data.category_id,
      unit_id: r.data.unit_id || null,
      is_active: r.data.is_active, 
      track_inventory: r.data.track_inventory,
      requires_expiration: r.data.requires_expiration || false
    }
    variants.value = r.data.product_variants || []
    // Abrir inmediatamente el diálogo de agregar variante
    addVariant()
  } else showMsg('Error al cargar producto', 'error')
}

const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid || !tenantId.value) return
  saving.value = true
  try {
    // Preparar datos según el modo de variante
    const productData = { ...formData.value }
    
    // Si es modo 'multiple', no enviar base_cost/base_price/base_min_stock
    if (formData.value.variant_mode === 'multiple') {
      delete productData.base_cost
      delete productData.base_price
      delete productData.base_min_stock
    }
    
    const r = isEditing.value
      ? await productsService.updateProduct(tenantId.value, formData.value.product_id, productData)
      : await productsService.createProduct(tenantId.value, productData)
      
    if (r.success) {
      if (isEditing.value) {
        showMsg('Producto actualizado')
        dialog.value = false
      } else {
        // Producto nuevo creado
        if (formData.value.variant_mode === 'single') {
          showMsg('Producto creado con variante predeterminada')
          dialog.value = false
        } else {
          // Modo múltiple: cambiar a edición para agregar variantes
          showMsg('Producto creado. Agrega las variantes ahora.')
          formData.value.product_id = r.data.product_id
          isEditing.value = true
          variants.value = r.data.product_variants || []
        }
      }
      loadProducts({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
    } else showMsg(r.error || 'Error al guardar', 'error')
  } finally { saving.value = false }
}

const confirmDelete = (item) => { itemToDelete.value = item; deleteDialog.value = true }
const doDelete = async () => {
  if (!itemToDelete.value || !tenantId.value) return
  deleting.value = true
  try {
    const r = await productsService.deleteProduct(tenantId.value, itemToDelete.value.product_id)
    if (r.success) { showMsg('Producto eliminado'); deleteDialog.value = false; loadProducts({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value }) }
    else showMsg(r.error, 'error')
  } finally { deleting.value = false }
}

// Variantes
const addVariant = () => { 
  editingVariant.value = false
  variantData.value = { 
    variant_id: null, 
    product_id: formData.value.product_id, 
    sku: '', 
    variant_name: '', 
    cost: 0, 
    price: 0, 
    price_includes_tax: false, 
    min_stock: 0, 
    allow_backorder: false, 
    is_active: true,
    requires_expiration: null,  // null = hereda del producto
    standard_code: '',
    standard_code_type: 'UNSPSC',
    unit_id: null
  }
  variantDialog.value = true 
}
const editVariant = (v) => { 
  editingVariant.value = true
  variantData.value = { 
    ...v, 
    min_stock: v.min_stock || 0, 
    allow_backorder: v.allow_backorder || false, 
    price_includes_tax: v.price_includes_tax || false,
    requires_expiration: v.requires_expiration !== undefined ? v.requires_expiration : null,
    standard_code: v.standard_code || '',
    standard_code_type: v.standard_code_type || 'UNSPSC',
    unit_id: v.unit_id || null
  }
  variantDialog.value = true 
}

// Generar SKU automáticamente basado en producto, categoría y variante
const autoGenerateSKU = () => {
  const productName = formData.value.name || ''
  const variantName = variantData.value.variant_name || ''
  
  // Buscar el nombre de la categoría si existe
  let categoryName = ''
  if (formData.value.category_id) {
    const category = categoryOptions.value.find(c => c.category_id === formData.value.category_id)
    categoryName = category ? category.name : ''
  }

  // Generar SKU usando la función utilitaria
  const generatedSKU = generateSKU(productName, categoryName, variantName)
  variantData.value.sku = generatedSKU
  
  showMsg('SKU generado automáticamente', 'info')
}

const saveVariant = async () => {
  console.log('saveVariant called', { 
    hasForm: !!variantForm.value, 
    hasTenant: !!tenantId.value,
    variantData: variantData.value 
  })
  
  if (!variantForm.value) {
    console.error('variantForm is null!')
    showMsg('Error: Formulario no inicializado', 'error')
    return
  }
  
  if (!tenantId.value) {
    console.error('tenantId is null!')
    showMsg('Error: No hay tenant seleccionado', 'error')
    return
  }
  
  const validationResult = await variantForm.value.validate()
  console.log('Validation result:', validationResult)
  
  if (!validationResult.valid) {
    console.log('Form is not valid')
    showMsg('Por favor complete todos los campos requeridos', 'warning')
    return
  }
  
  savingVariant.value = true
  try {
    console.log('Saving variant...', { editing: editingVariant.value })
    const r = editingVariant.value
      ? await productsService.updateVariant(tenantId.value, variantData.value.variant_id, variantData.value)
      : await productsService.createVariant(tenantId.value, { ...variantData.value, product_id: formData.value.product_id })
    console.log('Save result:', r)
    if (r.success) {
      showMsg('Variante guardada')
      variantDialog.value = false
      // Recargar variantes
      const pr = await productsService.getProductById(tenantId.value, formData.value.product_id)
      if (pr.success) variants.value = pr.data.product_variants || []
    } else showMsg(r.error, 'error')
  } catch (error) {
    console.error('Error saving variant:', error)
    showMsg('Error al guardar variante: ' + error.message, 'error')
  } finally { 
    savingVariant.value = false 
  }
}

const confirmDeleteVariant = async (v) => {
  if (!confirm('¿Eliminar esta variante?')) return
  const r = await productsService.deleteVariant(tenantId.value, v.variant_id)
  if (r.success) {
    showMsg('Variante eliminada')
    variants.value = variants.value.filter(x => x.variant_id !== v.variant_id)
  } else showMsg(r.error, 'error')
}

const openBOMEditor = async () => {
  if (!formData.value.product_id) return
  
  // Si ya tiene BOM, cargar el existente
  if (formData.value.active_bom_id) {
    try {
      const result = await manufacturingService.getBOMById(tenantId.value, formData.value.active_bom_id)
      if (result.success && bomEditor.value) {
        bomEditor.value.open(formData.value.product_id, null, result.data)
      }
    } catch (error) {
      console.error('Error loading BOM:', error)
      showMsg('Error al cargar BOM', 'error')
    }
  } else {
    // Crear nuevo BOM
    if (bomEditor.value) {
      bomEditor.value.open(formData.value.product_id, null, null)
    }
  }
}

const onBOMSaved = async (bomData) => {
  // Activar el BOM recién creado/actualizado
  try {
    const result = await manufacturingService.activateBOM(
      tenantId.value,
      formData.value.product_id,
      null, // Variant ID null porque es a nivel de producto
      bomData
    )
    
    if (result.success) {
      formData.value.active_bom_id = bomData
      showMsg('BOM guardado y activado', 'success')
    }
  } catch (error) {
    console.error('Error activating BOM:', error)
    showMsg('BOM guardado pero no se pudo activar', 'warning')
  }
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = color === 'error'
    ? humanizeAppError(msg, { defaultMessage: 'Ocurrió un error en productos.' })
    : msg
  snackbarColor.value = color
  snackbar.value = true
}

const sanitizeForExcel = (value) => {
  if (value === null || value === undefined) return ''
  const str = String(value)
  return /^[=+\-@]/.test(str) ? `'${str}` : str
}

const downloadCatalogExcel = async () => {
  if (!tenantId.value) return
  exportingCatalog.value = true
  try {
    const exportingComponents = currentTab.value === 'components'
    const r = await productsService.getProductsCatalog(tenantId.value, {
      is_component: exportingComponents
    })

    if (!r.success) {
      showMsg(r.error || 'Error al descargar catalogo', 'error')
      return
    }

    const rows = []
    for (const product of (r.data || [])) {
      const variants = product.product_variants && product.product_variants.length > 0
        ? product.product_variants
        : [null]

      for (const variant of variants) {
        rows.push({
          Producto: sanitizeForExcel(product.name),
          Descripcion: sanitizeForExcel(product.description || ''),
          Categoria: sanitizeForExcel(product.category?.name || 'Sin categoria'),
          Tipo: product.is_component ? 'Componente' : 'Producto',
          Estado: product.is_active ? 'Activo' : 'Inactivo',
          Inventario: product.track_inventory ? 'Si' : 'No',
          Vencimiento: product.requires_expiration ? 'Si' : 'No',
          Comportamiento: sanitizeForExcel(product.inventory_behavior || ''),
          SKU: sanitizeForExcel(variant?.sku || ''),
          Variante: sanitizeForExcel(variant?.variant_name || 'Predeterminado'),
          Costo: Number(variant?.cost || 0),
          Precio: Number(variant?.price || 0),
          MinStock: Number(variant?.min_stock || 0),
          Backorder: variant?.allow_backorder ? 'Si' : 'No',
          VarianteActiva: variant ? (variant.is_active ? 'Si' : 'No') : '',
          UnidadCodigo: sanitizeForExcel(product.unit?.code || ''),
          UnidadNombre: sanitizeForExcel(product.unit?.name || ''),
          DianCode: sanitizeForExcel(product.unit?.dian_code || '')
        })
      }
    }

    if (rows.length === 0) {
      showMsg('No hay datos para exportar', 'info')
      return
    }

    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Catalogo')

    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const tabSuffix = exportingComponents ? 'componentes' : 'productos'
    writeFileXLSX(wb, `catalogo_${tabSuffix}_${y}${m}${d}.xlsx`)

    showMsg('Catalogo descargado correctamente')
  } catch (error) {
    console.error('Error exportando catalogo:', error)
    showMsg('Error exportando catalogo', 'error')
  } finally {
    exportingCatalog.value = false
  }
}

// Lifecycle
onMounted(async () => {
  await loadSettings()
  await loadUnits()
  applyRouteContext()
  handleGuidedAction()
})

// Recargar productos cuando cambie el tab
watch(currentTab, () => {
  if (tenantId.value) {
    if (currentTab.value === 'components') {
      loadComponents({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
    } else {
      loadProducts({ page: 1, pageSize: defaultPageSize.value, search: '', tenantId: tenantId.value })
    }
  }
})

watch(
  () => route.query.tab,
  () => {
    applyRouteContext()
  }
)

watch(
  () => route.query.action,
  () => {
    guidedActionHandled.value = ''
    handleGuidedAction()
  }
)
</script>

<style scoped>
.products-toolbar :deep(.v-btn) {
  border-radius: 12px;
  font-weight: 700;
}

.products-page :deep(.v-field) {
  border-radius: 12px;
}

.products-page :deep(.v-dialog .v-card-title) {
  font-weight: 700;
}
</style>
