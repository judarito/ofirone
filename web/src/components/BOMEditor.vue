<template>
  <v-dialog v-model="dialog" max-width="1200" scrollable persistent>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-file-tree</v-icon>
        <span>{{ isEditing ? 'Editar BOM' : 'Nueva Lista de Materiales (BOM)' }}</span>
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" variant="text" @click="close"></v-btn>
      </v-card-title>

      <v-divider></v-divider>

      <v-card-text style="max-height: 600px;">
        <v-form ref="form" @submit.prevent="save">
          <!-- Información básica del BOM -->
          <v-row>
            <v-col cols="12">
              <v-text-field
                v-model="formData.bom_name"
                label="Nombre del BOM"
                prepend-inner-icon="mdi-tag"
                variant="outlined"
                :rules="[rules.required]"
                hint="Ej: Pizza Margarita v1, Hamburguesa Especial"
                persistent-hint
              ></v-text-field>
            </v-col>

            <!-- Selección de Producto o Variante (solo si es nuevo) -->
            <v-col v-if="!isEditing" cols="12">
              <v-autocomplete
                v-model="selectedProductVariant"
                :items="productVariantOptions"
                item-title="display_name"
                item-value="id"
                label="Producto / Variante *"
                prepend-inner-icon="mdi-package-variant"
                variant="outlined"
                :rules="[rules.required]"
                hint="Selecciona el producto o variante para el cual crear este BOM"
                persistent-hint
                clearable
                @update:model-value="onProductVariantChange"
              >
                <template #item="{ props, item }">
                  <v-list-item
                    v-bind="props"
                    :subtitle="item.raw.type === 'product' ? 'Producto' : 'Variante'"
                  >
                    <template #prepend>
                      <v-icon>{{ item.raw.type === 'product' ? 'mdi-package' : 'mdi-package-variant' }}</v-icon>
                    </template>
                  </v-list-item>
                </template>
              </v-autocomplete>
            </v-col>

            <v-col cols="12">
              <v-textarea
                v-model="formData.notes"
                label="Notas"
                prepend-inner-icon="mdi-note-text"
                variant="outlined"
                rows="2"
                hint="Instrucciones de preparación, observaciones"
              ></v-textarea>
            </v-col>
          </v-row>

          <v-divider class="my-4"></v-divider>

          <!-- Componentes del BOM -->
          <div class="d-flex align-center mb-3">
            <v-icon start color="primary">mdi-format-list-bulleted</v-icon>
            <span class="text-h6">Componentes</span>
            <v-spacer></v-spacer>
            <v-chip variant="tonal" color="info">
              {{ formData.components.length }} componente(s)
            </v-chip>
          </div>

          <!-- Alerta si no hay componentes disponibles -->
          <v-alert
            v-if="componentOptions.length === 0"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
            icon="mdi-alert"
          >
            No hay productos marcados como "Componentes" disponibles. 
            Debes crear productos con la opción "Es un componente" activada.
          </v-alert>

          <!-- Contador de componentes disponibles -->
          <v-alert
            v-else
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
            icon="mdi-package-variant"
          >
            {{ componentOptions.length }} componente(s) disponible(s) para usar en este BOM
          </v-alert>

          <!-- Lista de componentes -->
          <v-table v-if="formData.components.length > 0" density="comfortable" class="mb-3">
            <thead>
              <tr>
                <th>Producto/Componente</th>
                <th width="120">Cantidad</th>
                <th width="100">Unidad</th>
                <th width="100">Desperdicio %</th>
                <th width="80">Opcional</th>
                <th width="100">Costo Unit.</th>
                <th width="100">Total</th>
                <th width="60"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(comp, index) in formData.components" :key="index">
                <td>
                  <v-autocomplete
                    v-model="comp.component_variant_id"
                    :items="componentOptions"
                    item-title="display_name"
                    item-value="variant_id"
                    variant="outlined"
                    density="compact"
                    hide-details
                    placeholder="Buscar componente..."
                    @update:model-value="onComponentSelect(index, $event)"
                  >
                    <template #item="{ props, item }">
                      <v-list-item v-bind="props">
                        <template #prepend>
                          <v-icon :color="item.raw.is_component ? 'success' : 'grey'">
                            {{ item.raw.is_component ? 'mdi-cog' : 'mdi-package-variant' }}
                          </v-icon>
                        </template>
                        <template #title>{{ item.raw.display_name }}</template>
                        <template #subtitle>
                          SKU: {{ item.raw.sku }} | Costo: ${{ Number(item.raw.cost || 0).toLocaleString() }}
                        </template>
                      </v-list-item>
                    </template>
                  </v-autocomplete>
                </td>
                <td>
                  <v-text-field
                    v-model.number="comp.quantity_required"
                    type="number"
                    step="0.01"
                    min="0"
                    variant="outlined"
                    density="compact"
                    hide-details
                    @update:model-value="calculateComponentCost(index)"
                  ></v-text-field>
                </td>
                <td>
                  <v-text-field
                    :model-value="comp.unit_code || ''"
                    variant="outlined"
                    density="compact"
                    readonly
                    placeholder="Auto"
                    hide-details
                  ></v-text-field>
                </td>
                <td>
                  <v-text-field
                    v-model.number="comp.waste_percentage"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    variant="outlined"
                    density="compact"
                    hide-details
                    suffix="%"
                    @update:model-value="calculateComponentCost(index)"
                  ></v-text-field>
                </td>
                <td class="text-center">
                  <v-checkbox
                    v-model="comp.is_optional"
                    hide-details
                    density="compact"
                  ></v-checkbox>
                </td>
                <td class="text-right">
                  ${{ (comp.unit_cost || 0).toLocaleString() }}
                </td>
                <td class="text-right font-weight-bold">
                  ${{ (comp.total_cost || 0).toLocaleString() }}
                </td>
                <td>
                  <v-btn
                    icon="mdi-delete"
                    variant="text"
                    size="small"
                    color="error"
                    @click="removeComponent(index)"
                  ></v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>

          <!-- Botón agregar componente -->
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-plus"
            @click="addComponent"
            block
          >
            Agregar Componente
          </v-btn>

          <!-- Resumen de costos -->
          <v-card v-if="formData.components.length > 0" variant="tonal" color="info" class="mt-4">
            <v-card-text>
              <v-row dense>
                <v-col cols="6">
                  <div class="text-subtitle-2">Costo Total BOM:</div>
                </v-col>
                <v-col cols="6" class="text-right">
                  <div class="text-h6 font-weight-bold">
                    ${{ totalBOMCost.toLocaleString('es-CO', { minimumFractionDigits: 2 }) }}
                  </div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption">Componentes requeridos:</div>
                </v-col>
                <v-col cols="6" class="text-right">
                  <div class="text-caption">{{ formData.components.filter(c => !c.is_optional).length }}</div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption">Componentes opcionales:</div>
                </v-col>
                <v-col cols="6" class="text-right">
                  <div class="text-caption">{{ formData.components.filter(c => c.is_optional).length }}</div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <!-- Alertas -->
          <v-alert v-if="formData.components.length === 0" type="warning" variant="tonal" class="mt-3">
            Agrega al menos un componente para crear el BOM
          </v-alert>

          <v-alert v-if="circularDependency" type="error" variant="tonal" class="mt-3">
            <v-icon start>mdi-alert-circle</v-icon>
            Dependencia circular detectada. No puedes agregar este componente.
          </v-alert>
        </v-form>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions>
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="formData.components.length === 0 || circularDependency"
          @click="save"
        >
          {{ isEditing ? 'Actualizar' : 'Crear' }} BOM
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Snackbar -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
      {{ snackbar.message }}
    </v-snackbar>
  </v-dialog>
</template>

<script>
import { ref, computed, watch } from 'vue'
import { useTenant } from '@/composables/useTenant'
import manufacturingService from '@/services/manufacturing.service'
import productsService from '@/services/products.service'
import unitsOfMeasureService from '@/services/unitsOfMeasure.service'

export default {
  name: 'BOMEditor',
  emits: ['saved', 'close'],
  
  setup(props, { emit }) {
    const { tenantId } = useTenant()
    const dialog = ref(false)
    const form = ref(null)
    const saving = ref(false)
    const isEditing = ref(false)
    const circularDependency = ref(false)

    const componentOptions = ref([])
    const unitOptions = ref([])
    const productVariantOptions = ref([])
    const selectedProductVariant = ref(null)

    // Snackbar
    const snackbar = ref({
      show: false,
      message: '',
      color: 'success'
    })

    const formData = ref({
      bom_id: null,
      product_id: null,
      variant_id: null,
      bom_name: '',
      notes: '',
      components: []
    })

    const rules = {
      required: value => !!value || 'Campo requerido'
    }

    const totalBOMCost = computed(() => {
      return formData.value.components.reduce((sum, comp) => {
        return sum + (comp.total_cost || 0)
      }, 0)
    })

    const loadComponents = async () => {
      try {
        const result = await productsService.getProducts(tenantId.value, 1, 1000, '')
        if (result.success) {
          componentOptions.value = []
          result.data.forEach(product => {
            // Solo incluir productos marcados como componentes
            if (product.is_component && product.product_variants) {
              product.product_variants.forEach(variant => {
                componentOptions.value.push({
                  variant_id: variant.variant_id,
                  sku: variant.sku,
                  variant_name: variant.variant_name,
                  display_name: `${product.name} - ${variant.variant_name || 'Predeterminado'}`,
                  cost: variant.cost || 0,
                  unit_id: variant.unit_id || product.unit_id || null,
                  is_component: true
                })
              })
            }
          })
        }
      } catch (error) {
        console.error('Error loading components:', error)
      }
    }

    const loadUnits = async () => {
      if (!tenantId.value) return
      try {
        const r = await unitsOfMeasureService.getActiveUnits(tenantId.value)
        if (r.success) {
          unitOptions.value = r.data.map(u => ({
            ...u,
            display_name: `${u.code} - ${u.name}${u.dian_code ? ' (DIAN: ' + u.dian_code + ')' : ''}`
          }))
        }
      } catch (error) {
        console.error('Error loading units:', error)
      }
    }

    const loadProductVariantOptions = async () => {
      if (!tenantId.value) return
      try {
        const result = await productsService.getProducts(tenantId.value, 1, 1000, '')
        if (result.success) {
          productVariantOptions.value = []
          
          result.data.forEach(product => {
            // Solo productos MANUFACTURED que pueden tener BOM
            if (product.inventory_behavior === 'MANUFACTURED' && product.product_variants) {
              // Opción: Producto nivel
              productVariantOptions.value.push({
                id: `product_${product.product_id}`,
                display_name: `${product.name} (Producto)`,
                type: 'product',
                product_id: product.product_id,
                variant_id: null
              })
              
              // Opciones: Variantes específicas
              product.product_variants.forEach(variant => {
                productVariantOptions.value.push({
                  id: `variant_${variant.variant_id}`,
                  display_name: `${product.name} - ${variant.variant_name || 'Predeterminado'} (Variante)`,
                  type: 'variant',
                  product_id: null,
                  variant_id: variant.variant_id
                })
              })
            }
          })
        }
      } catch (error) {
        console.error('Error loading product/variant options:', error)
      }
    }

    const onProductVariantChange = (value) => {
      if (!value) {
        formData.value.product_id = null
        formData.value.variant_id = null
        return
      }
      
      const selected = productVariantOptions.value.find(opt => opt.id === value)
      if (selected) {
        formData.value.product_id = selected.product_id
        formData.value.variant_id = selected.variant_id
      }
    }

    const addComponent = () => {
      formData.value.components.push({
        component_variant_id: null,
        quantity_required: 1,
        unit_id: null,
        unit_code: '',
        waste_percentage: 0,
        is_optional: false,
        unit_cost: 0,
        total_cost: 0
      })
    }

    const removeComponent = (index) => {
      formData.value.components.splice(index, 1)
    }

    const onComponentSelect = (index, variantId) => {
      const comp = formData.value.components[index]
      if (!variantId) {
        comp.unit_cost = 0
        comp.total_cost = 0
        return
      }

      const selectedComponent = componentOptions.value.find(
        c => c.variant_id === variantId
      )
      
      if (selectedComponent) {
        // Heredar unit_id y unit_code del componente automáticamente
        if (selectedComponent.unit_id) {
          comp.unit_id = selectedComponent.unit_id
          // Buscar el código de la unidad
          const unit = unitOptions.value.find(u => u.unit_id === selectedComponent.unit_id)
          comp.unit_code = unit ? unit.code : ''
        }
        comp.unit_cost = selectedComponent.cost || 0
      }
      
      calculateComponentCost(index)
    }

    const showMessage = (message, color = 'success') => {
      snackbar.value = { show: true, message, color }
    }

    const calculateComponentCost = (index) => {
      const component = formData.value.components[index]
      if (!component.component_variant_id) return

      const variantData = componentOptions.value.find(
        v => v.variant_id === component.component_variant_id
      )

      if (variantData) {
        component.unit_cost = variantData.cost || 0
        const wasteMultiplier = 1 + ((component.waste_percentage || 0) / 100)
        component.total_cost = component.unit_cost * (component.quantity_required || 0) * wasteMultiplier
      }
    }

    const open = async (productId = null, variantId = null, existingBOM = null) => {
      await loadComponents()
      await loadUnits()
      await loadProductVariantOptions()
      
      if (existingBOM) {
        isEditing.value = true
        
        // Establecer selección de producto/variante para mostrar en edición
        if (existingBOM.product_id) {
          selectedProductVariant.value = `product_${existingBOM.product_id}`
        } else if (existingBOM.variant_id) {
          selectedProductVariant.value = `variant_${existingBOM.variant_id}`
        }
        
        // Asegurar que todos los componentes del BOM estén en componentOptions
        if (existingBOM.bom_components) {
          existingBOM.bom_components.forEach(comp => {
            if (comp.component_variant) {
              const exists = componentOptions.value.find(
                opt => opt.variant_id === comp.component_variant.variant_id
              )
              
              if (!exists) {
                // Agregar componente faltante a las opciones
                componentOptions.value.push({
                  variant_id: comp.component_variant.variant_id,
                  sku: comp.component_variant.sku,
                  variant_name: comp.component_variant.variant_name || 'Sin nombre',
                  display_name: `${comp.component_variant.sku} - ${comp.component_variant.variant_name || 'Sin nombre'}`,
                  cost: comp.component_variant.cost || 0,
                  is_component: true
                })
              }
            }
          })
        }
        
        formData.value = {
          bom_id: existingBOM.bom_id,
          product_id: existingBOM.product_id,
          variant_id: existingBOM.variant_id,
          bom_name: existingBOM.bom_name,
          notes: existingBOM.notes || '',
          components: existingBOM.bom_components?.map(c => {
            // Obtener código de unidad para mostrar
            let unit_code = ''
            if (c.unit_id) {
              const unit = unitOptions.value.find(u => u.unit_id === c.unit_id)
              unit_code = unit ? unit.code : ''
            } else if (c.unit) {
              unit_code = c.unit
            }
            
            return {
              component_variant_id: c.component_variant_id,
              quantity_required: c.quantity_required,
              unit_id: c.unit_id,
              unit_code: unit_code,
              waste_percentage: c.waste_percentage || 0,
              is_optional: c.is_optional || false,
              unit_cost: c.component_variant?.cost || 0,
              total_cost: 0
            }
          }) || []
        }
        
        // Recalcular costos después de cargar componentes
        formData.value.components.forEach((_, index) => calculateComponentCost(index))
      } else {
        isEditing.value = false
        
        // Establecer selección inicial si se proporciona desde fuera
        if (productId) {
          selectedProductVariant.value = `product_${productId}`
        } else if (variantId) {
          selectedProductVariant.value = `variant_${variantId}`
        } else {
          selectedProductVariant.value = null
        }
        
        formData.value = {
          bom_id: null,
          product_id: productId,
          variant_id: variantId,
          bom_name: '',
          notes: '',
          components: []
        }
      }

      dialog.value = true
    }

    const close = () => {
      dialog.value = false
      if (form.value) form.value.reset()
      emit('close')
    }

    const save = async () => {
      const { valid } = await form.value.validate()
      if (!valid || formData.value.components.length === 0) return

      // Validar que tenga product_id O variant_id
      if (!formData.value.product_id && !formData.value.variant_id) {
        showMessage('Debe seleccionar un producto o variante para crear el BOM', 'warning')
        return
      }

      saving.value = true
      try {
        // Separar datos del BOM de los componentes
        const bomMainData = {
          product_id: formData.value.product_id,
          variant_id: formData.value.variant_id,
          bom_name: formData.value.bom_name,
          notes: formData.value.notes
        }

        const bomComponents = formData.value.components.map(c => {
          const component = {
            component_variant_id: c.component_variant_id,
            quantity_required: c.quantity_required,
            waste_percentage: c.waste_percentage || 0,
            is_optional: c.is_optional || false
          }
          
          // Incluir unit_id si existe (para migración nueva)
          if (c.unit_id) {
            component.unit_id = c.unit_id
          }
          
          // Incluir unit (código) si existe (para compatibilidad con tabla sin migrar)
          if (c.unit_code) {
            component.unit = c.unit_code
          }
          
          return component
        })

        let result
        if (isEditing.value) {
          result = await manufacturingService.updateBOM(
            tenantId.value, 
            formData.value.bom_id, 
            bomMainData,
            bomComponents
          )
        } else {
          result = await manufacturingService.createBOM(tenantId.value, {
            ...bomMainData,
            components: bomComponents
          })
        }

        if (result.success) {
          emit('saved', result.data)
          close()
        } else {
          throw new Error(result.error)
        }
      } catch (error) {
        console.error('Error saving BOM:', error)
        showMessage('Error al guardar el BOM: ' + error.message, 'error')
      } finally {
        saving.value = false
      }
    }

    // Watch para validar dependencias circulares (placeholder)
    watch(() => formData.value.components, () => {
      circularDependency.value = false
      // TODO: Implementar validación de dependencias circulares client-side
    }, { deep: true })

    return {
      dialog,
      form,
      saving,
      isEditing,
      circularDependency,
      formData,
      rules,
      componentOptions,
      unitOptions,
      productVariantOptions,
      selectedProductVariant,
      snackbar,
      totalBOMCost,
      addComponent,
      removeComponent,
      onComponentSelect,
      calculateComponentCost,
      onProductVariantChange,
      showMessage,
      open,
      close,
      save
    }
  }
}
</script>

<style scoped>
.v-table {
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 4px;
}
</style>
