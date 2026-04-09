import supabaseService from './supabase.service'

class ManufacturingService {
  constructor() {
    this.bomsTable = 'bill_of_materials'
    this.componentsTable = 'bom_components'
    this.productionOrdersTable = 'production_orders'
    this.productionLinesTable = 'production_order_lines'
    this.bundlesTable = 'bundle_compositions'
  }

  // ==================== BOMs ====================
  
  async getBOMs(tenantId, page = 1, pageSize = 10, search = '') {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.bomsTable)
        .select(`
          *,
          product:product_id(product_id, name),
          variant:variant_id(variant_id, sku, variant_name),
          bom_components(
            component_id,
            component_variant_id,
            component_variant:component_variant_id(variant_id, sku, variant_name, price, cost),
            quantity_required,
            unit_id,
            unit:unit_id(unit_id, code, name, dian_code, is_system),
            waste_percentage,
            is_optional
          )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (search) {
        query = query.or(`bom_name.ilike.%${search}%,notes.ilike.%${search}%`)
      }

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return { success: false, error: error.message, data: [], total: 0 }
    }
  }

  async getBOMById(tenantId, bomId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.bomsTable)
        .select(`
          *,
          product:product_id(product_id, name),
          variant:variant_id(variant_id, sku, variant_name),
          bom_components(
            component_id,
            component_variant_id,
            component_variant:component_variant_id(variant_id, sku, variant_name, price, cost),
            quantity_required,
            unit_id,
            unit:unit_id(unit_id, code, name, dian_code, is_system),
            waste_percentage,
            is_optional,
            notes
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('bom_id', bomId)
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async createBOM(tenantId, bom) {
    try {
      // Validar que se proporcione EXACTAMENTE uno: product_id O variant_id
      const hasProductId = !!bom.product_id
      const hasVariantId = !!bom.variant_id
      
      if (!hasProductId && !hasVariantId) {
        throw new Error('Debe especificar un product_id O variant_id')
      }
      if (hasProductId && hasVariantId) {
        throw new Error('Solo puede especificar product_id O variant_id, no ambos')
      }

      // Crear el BOM (solo incluir product_id/variant_id si no son null)
      const bomData = {
        tenant_id: tenantId,
        bom_name: bom.bom_name,
        notes: bom.notes || null,
        is_active: true,
        created_at: new Date().toISOString()
      }

      // Solo agregar product_id si tiene valor (no enviar null como string)
      if (bom.product_id) {
        bomData.product_id = bom.product_id
      }
      // Solo agregar variant_id si tiene valor
      if (bom.variant_id) {
        bomData.variant_id = bom.variant_id
      }

      const { data: bomResult, error: bomError } = await supabaseService.client
        .from(this.bomsTable)
        .insert(bomData)
        .select()
        .single()

      if (bomError) throw bomError

      // Crear los componentes del BOM
      if (bom.components && bom.components.length > 0) {
        const components = bom.components.map(c => {
          const component = {
            tenant_id: tenantId,
            bom_id: bomResult.bom_id,
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
          if (c.unit) {
            component.unit = c.unit
          }
          
          return component
        })

        const { error: componentsError } = await supabaseService.client
          .from(this.componentsTable)
          .insert(components)

        if (componentsError) throw componentsError
      }

      return { success: true, data: bomResult }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async updateBOM(tenantId, bomId, updates, components = null) {
    try {
      // Validar que no se viole el constraint: exactamente uno de product_id o variant_id
      if (updates.product_id !== undefined || updates.variant_id !== undefined) {
        const hasProductId = !!updates.product_id
        const hasVariantId = !!updates.variant_id
        
        if (!hasProductId && !hasVariantId) {
          throw new Error('Debe especificar un product_id O variant_id')
        }
        if (hasProductId && hasVariantId) {
          throw new Error('Solo puede especificar product_id O variant_id, no ambos')
        }
      }

      // Filtrar solo campos válidos de bill_of_materials (sin components)
      const validFields = ['product_id', 'variant_id', 'bom_name', 'notes', 'is_active']
      const bomUpdates = {}
      validFields.forEach(field => {
        if (updates[field] !== undefined) {
          // Para product_id y variant_id, solo incluir si no son null (evitar error UUID)
          if ((field === 'product_id' || field === 'variant_id') && updates[field] === null) {
            return
          }
          bomUpdates[field] = updates[field]
        }
      })

      // Actualizar tabla bill_of_materials
      const { data, error } = await supabaseService.update(
        this.bomsTable,
        { bom_id: bomId, tenant_id: tenantId },
        bomUpdates
      )
      if (error) throw error

      // Si se proporcionan componentes, actualizar tabla bom_components
      if (components && Array.isArray(components)) {
        // 1. Eliminar componentes existentes
        const { error: deleteError } = await supabaseService.client
          .from(this.componentsTable)
          .delete()
          .eq('bom_id', bomId)
          .eq('tenant_id', tenantId)
        
        if (deleteError) throw deleteError

        // 2. Insertar nuevos componentes
        if (components.length > 0) {
          const newComponents = components.map(c => {
            const component = {
              tenant_id: tenantId,
              bom_id: bomId,
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
            if (c.unit) {
              component.unit = c.unit
            }
            
            return component
          })

          const { error: insertError } = await supabaseService.client
            .from(this.componentsTable)
            .insert(newComponents)
          
          if (insertError) throw insertError
        }
      }

      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async deleteBOM(tenantId, bomId) {
    try {
      // Verificar si el BOM está activo en algún producto o variante
      const { data: products } = await supabaseService.client
        .from('products')
        .select('product_id, name')
        .eq('tenant_id', tenantId)
        .eq('active_bom_id', bomId)
        .limit(1)

      if (products && products.length > 0) {
        throw new Error(`No se puede eliminar: BOM activo en producto "${products[0].name}"`)
      }

      const { data: variants } = await supabaseService.client
        .from('product_variants')
        .select('variant_id, variant_name')
        .eq('tenant_id', tenantId)
        .eq('active_bom_id', bomId)
        .limit(1)

      if (variants && variants.length > 0) {
        throw new Error(`No se puede eliminar: BOM activo en variante "${variants[0].variant_name}"`)
      }

      // Eliminar BOM (los componentes se eliminan por CASCADE)
      const { error } = await supabaseService.client
        .from(this.bomsTable)
        .delete()
        .eq('tenant_id', tenantId)
        .eq('bom_id', bomId)

      if (error) throw error
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async activateBOM(tenantId, productId, variantId, bomId) {
    try {
      const table = variantId ? 'product_variants' : 'products'
      const idField = variantId ? 'variant_id' : 'product_id'
      const idValue = variantId || productId

      const { data, error } = await supabaseService.update(
        table,
        { [idField]: idValue, tenant_id: tenantId },
        { active_bom_id: bomId }
      )
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async getBOMCost(tenantId, bomId, quantity = 1) {
    try {
      // Obtener componentes del BOM con sus costos
      const { data: components, error } = await supabaseService.client
        .from(this.componentsTable)
        .select(`
          component_variant_id,
          quantity_required,
          waste_percentage,
          component_variant:component_variant_id(cost, sku)
        `)
        .eq('tenant_id', tenantId)
        .eq('bom_id', bomId)

      if (error) throw error

      // Calcular costo total
      let totalCost = 0
      const componentDetails = []

      for (const comp of components || []) {
        const wasteMultiplier = 1 + (comp.waste_percentage || 0) / 100
        const adjustedQty = comp.quantity_required * wasteMultiplier * quantity
        const unitCost = comp.component_variant?.cost || 0
        const lineCost = unitCost * adjustedQty

        totalCost += lineCost
        componentDetails.push({
          variant_id: comp.component_variant_id,
          sku: comp.component_variant?.sku,
          quantity: adjustedQty,
          unit_cost: unitCost,
          total_cost: lineCost
        })
      }

      return { 
        success: true, 
        data: { 
          total_cost: totalCost, 
          components: componentDetails 
        } 
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async validateBOMAvailability(tenantId, bomId, quantity, locationId) {
    try {
      // Obtener componentes del BOM
      const { data: components, error } = await supabaseService.client
        .from(this.componentsTable)
        .select(`
          component_variant_id,
          quantity_required,
          waste_percentage,
          is_optional,
          component_variant:component_variant_id(sku, variant_name)
        `)
        .eq('tenant_id', tenantId)
        .eq('bom_id', bomId)

      if (error) throw error

      // Obtener stock disponible de cada componente
      const variantIds = components.map(c => c.component_variant_id)
      const { data: stockData } = await supabaseService.client
        .from('stock_balances')
        .select('variant_id, on_hand, reserved')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)
        .in('variant_id', variantIds)

      const stockMap = new Map()
      for (const stock of stockData || []) {
        stockMap.set(stock.variant_id, {
          available: (stock.on_hand || 0) - (stock.reserved || 0)
        })
      }

      // Validar disponibilidad de cada componente
      const validation = []
      let allAvailable = true

      for (const comp of components) {
        const wasteMultiplier = 1 + (comp.waste_percentage || 0) / 100
        const required = comp.quantity_required * wasteMultiplier * quantity
        const stock = stockMap.get(comp.component_variant_id)
        const available = stock?.available || 0
        const isAvailable = available >= required

        if (!isAvailable && !comp.is_optional) {
          allAvailable = false
        }

        validation.push({
          variant_id: comp.component_variant_id,
          sku: comp.component_variant?.sku,
          required: required,
          available: available,
          is_available: isAvailable,
          is_optional: comp.is_optional
        })
      }

      return { 
        success: true, 
        data: { 
          all_available: allAvailable, 
          components: validation 
        } 
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ==================== Production Orders ====================
  
  async getProductionOrders(tenantId, page = 1, pageSize = 10, filters = {}) {
    try {
      // Validar parámetros
      const validPage = Number.isInteger(page) && page > 0 ? page : 1
      const validPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10
      
      const from = (validPage - 1) * validPageSize
      const to = from + validPageSize - 1

      let query = supabaseService.client
        .from(this.productionOrdersTable)
        .select(`
          *,
          location:location_id(location_id, name),
          bom:bom_id(
            bom_id,
            bom_name,
            product:product_id(name),
            variant:variant_id(sku, variant_name)
          ),
          created_by_user:created_by(user_id, full_name),
          production_order_lines(
            line_id,
            component_variant:component_variant_id(variant_id, sku, variant_name),
            quantity_planned,
            quantity_consumed,
            unit_cost
          )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (filters.status) {
        query = query.eq('status', filters.status)
      }
      if (filters.location_id) {
        query = query.eq('location_id', filters.location_id)
      }

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return { success: false, error: error.message, data: [], total: 0 }
    }
  }

  async getProductionOrderById(tenantId, orderId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.productionOrdersTable)
        .select(`
          *,
          location:location_id(location_id, name),
          bom:bom_id(
            bom_id,
            bom_name,
            product:product_id(name),
            variant:variant_id(sku, variant_name),
            bom_components(
              component_variant:component_variant_id(variant_id, sku, variant_name),
              quantity_required,
              unit
            )
          ),
          created_by_user:created_by(user_id, full_name),
          started_by_user:started_by(user_id, full_name),
          completed_by_user:completed_by(user_id, full_name),
          production_order_lines(
            line_id,
            component_variant:component_variant_id(variant_id, sku, variant_name, cost),
            quantity_required,
            quantity_consumed,
            unit_cost
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('production_order_id', orderId)
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async createProductionOrder(tenantId, locationId, bomId, quantity, createdBy, scheduledStart = null, notes = null) {
    try {
      const orderData = {
        tenant_id: tenantId,
        location_id: locationId,
        bom_id: bomId,
        quantity_planned: quantity,
        status: 'PENDING',
        created_by: createdBy,
        scheduled_start_date: scheduledStart,
        notes: notes,
        created_at: new Date().toISOString()
      }

      const { data, error } = await supabaseService.client
        .from(this.productionOrdersTable)
        .insert(orderData)
        .select()
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async startProduction(tenantId, orderId, startedBy) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.productionOrdersTable)
        .update({
          status: 'IN_PROGRESS',
          started_by: startedBy,
          started_at: new Date().toISOString()
        })
        .eq('production_order_id', orderId)
        .eq('tenant_id', tenantId)
        .select()
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async completeProduction(tenantId, orderId, quantityProduced, completedBy, expirationDate = null, physicalLocation = null) {
    try {
      // Llamar a la función PostgreSQL fn_complete_production() que:
      // 1. Consume componentes con FEFO
      // 2. Calcula actual_cost basado en componentes reales consumidos
      // 3. Crea lote de inventario con unit_cost correcto
      // 4. Actualiza product_variants.cost y product_variants.price automáticamente
      const { data, error } = await supabaseService.client
        .rpc('fn_complete_production', {
          p_production_order: orderId,
          p_quantity_produced: quantityProduced,
          p_completed_by: completedBy,
          p_expiration_date: expirationDate,
          p_physical_location: physicalLocation
        })

      if (error) throw error

      // La función retorna el batch_id del lote creado
      const batchId = data

      // Obtener datos actualizados de la orden
      const { data: orderData, error: orderError } = await supabaseService.client
        .from(this.productionOrdersTable)
        .select()
        .eq('production_order_id', orderId)
        .eq('tenant_id', tenantId)
        .single()

      if (orderError) throw orderError

      return { success: true, data: orderData, batchId }
    } catch (error) {
      console.error('Error completing production:', error)
      return { success: false, error: error.message }
    }
  }

  async cancelProductionOrder(tenantId, orderId) {
    try {
      const { data, error } = await supabaseService.update(
        this.productionOrdersTable,
        { production_order_id: orderId, tenant_id: tenantId },
        { status: 'CANCELLED', cancelled_at: new Date().toISOString() }
      )
      if (error) throw error
      return { success: true, data: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ==================== Bundles ====================
  
  async getBundleComponents(tenantId, variantId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.bundlesTable)
        .select(`
          *,
          component_variant:component_variant_id(variant_id, sku, variant_name, price, cost)
        `)
        .eq('tenant_id', tenantId)
        .eq('bundle_variant_id', variantId)
        .order('component_order', { ascending: true })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async createBundleComponents(tenantId, bundleVariantId, components) {
    try {
      const inserts = components.map((c, index) => ({
        tenant_id: tenantId,
        bundle_variant_id: bundleVariantId,
        component_variant_id: c.component_variant_id,
        quantity: c.quantity,
        component_order: index + 1
      }))

      const { data, error } = await supabaseService.client
        .from(this.bundlesTable)
        .insert(inserts)
        .select()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async deleteBundleComponents(tenantId, bundleVariantId) {
    try {
      const { error } = await supabaseService.client
        .from(this.bundlesTable)
        .delete()
        .eq('tenant_id', tenantId)
        .eq('bundle_variant_id', bundleVariantId)

      if (error) throw error
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // ==================== Reports & Analytics ====================
  
  async getManufacturingDashboard(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_manufacturing_dashboard')
        .select('*')
        .eq('tenant_id', tenantId)
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async getOnDemandMargins(tenantId, limit = 20) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_ondemand_margin_analysis')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('sale_date', { ascending: false })
        .limit(limit)

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async getComponentExpirationRisks(tenantId) {
    try {
      const { data, error } = await supabaseService.client
        .from('vw_component_expiration_risk')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('days_to_expiry', { ascending: true })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }
}

export default new ManufacturingService()
