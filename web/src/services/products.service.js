import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'
import { serviceErrorResult } from '@/utils/appErrors'

const VARIANT_SEARCH_TTL_MS = 45 * 1000
const ACTIVE_VARIANTS_TTL_MS = 2 * 60 * 1000
const CHAT_MATCHING_VARIANTS_TTL_MS = 90 * 1000
const SIZE_TOKEN_SET = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl'])
const CHAT_SEARCH_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'por', 'con', 'sin'])

const normalizeSearchTerm = (value) => String(value || '').trim().toLowerCase()

const normalizeChatSearchPhrase = (value) => normalizeSearchTerm(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const stripSizeHints = (value) => normalizeChatSearchPhrase(value)
  .replace(/\btalla\s+(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)\b/g, ' ')
  .replace(/\b(?:xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const buildChatSearchVariants = (term) => {
  const normalized = normalizeChatSearchPhrase(term)
  if (!normalized) return []

  const variants = new Set([normalized])
  const withoutSize = stripSizeHints(normalized)
  if (withoutSize) variants.add(withoutSize)

  const baseTokens = (withoutSize || normalized).split(' ').filter(Boolean)
  const strongTokens = baseTokens.filter((token) => token.length >= 3 && !CHAT_SEARCH_STOPWORDS.has(token))

  if (strongTokens.length >= 2) {
    variants.add(strongTokens.join(' '))

    for (let windowSize = Math.min(4, strongTokens.length); windowSize >= 2; windowSize -= 1) {
      for (let index = 0; index <= strongTokens.length - windowSize; index += 1) {
        variants.add(strongTokens.slice(index, index + windowSize).join(' '))
      }
    }
  }

  for (const token of strongTokens) {
    if (!SIZE_TOKEN_SET.has(token) && token.length >= 4) {
      variants.add(token)
    }
  }

  return Array.from(variants).filter((entry) => entry.length >= 2)
}

const dedupeVariants = (variants, maxItems = Number.POSITIVE_INFINITY) => {
  const map = new Map()

  for (const variant of Array.isArray(variants) ? variants : []) {
    if (!variant?.variant_id || map.has(variant.variant_id)) continue
    map.set(variant.variant_id, variant)
    if (map.size >= maxItems) break
  }

  return Array.from(map.values())
}

class ProductsService {
  constructor() {
    this.table = 'products'
    this.variantsTable = 'product_variants'
    this.barcodesTable = 'product_barcodes'
  }

  buildVariantSearchCacheKey(search, limit, locationId, includeStock) {
    return `products:variant-search:${JSON.stringify({
      search: normalizeSearchTerm(search),
      limit: Number(limit || 20),
      locationId: locationId || null,
      includeStock: includeStock !== false
    })}`
  }

  async getProducts(tenantId, page = 1, pageSize = 10, search = '', filters = {}) {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let query = supabaseService.client
        .from(this.table)
        .select(`
          *,
          category:category_id(category_id, name),
          unit:unit_id(unit_id, code, name, dian_code, is_system),
          product_variants(variant_id, sku, variant_name, cost, price, pricing_method, markup_percentage, price_rounding, rounding_to, min_stock, allow_backorder, is_active)
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
        .range(from, to)

      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
      }

      // Filtros opcionales
      if (filters.is_component !== undefined) {
        query = query.eq('is_component', filters.is_component)
      }
      if (filters.is_active !== undefined) {
        query = query.eq('is_active', filters.is_active)
      }
      if (filters.inventory_behavior) {
        query = query.eq('inventory_behavior', filters.inventory_behavior)
      }

      const { data, error, count } = await query
      if (error) throw error
      return { success: true, data: data || [], total: count || 0 }
    } catch (error) {
      return serviceErrorResult(error, { data: [], total: 0 })
    }
  }

  async getProductsCatalog(tenantId, filters = {}) {
    try {
      const pageSize = 500
      let from = 0
      let hasMore = true
      const allRows = []

      while (hasMore) {
        let query = supabaseService.client
          .from(this.table)
          .select(`
            product_id,
            name,
            description,
            is_active,
            track_inventory,
            requires_expiration,
            inventory_behavior,
            is_component,
            category:category_id(category_id, name),
            unit:unit_id(unit_id, code, name, dian_code),
            product_variants(
              variant_id, sku, variant_name, cost, price, min_stock, allow_backorder, is_active
            )
          `)
          .eq('tenant_id', tenantId)
          .order('name', { ascending: true })
          .range(from, from + pageSize - 1)

        if (filters.is_component !== undefined) {
          query = query.eq('is_component', filters.is_component)
        }
        if (filters.is_active !== undefined) {
          query = query.eq('is_active', filters.is_active)
        }
        if (filters.inventory_behavior) {
          query = query.eq('inventory_behavior', filters.inventory_behavior)
        }

        const { data, error } = await query
        if (error) throw error

        const chunk = data || []
        allRows.push(...chunk)

        hasMore = chunk.length === pageSize
        from += pageSize
      }

      return { success: true, data: allRows }
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  async getProductById(tenantId, productId) {
    try {
      const { data, error } = await supabaseService.client
        .from(this.table)
        .select(`
          *,
          category:category_id(category_id, name),
          unit:unit_id(unit_id, code, name, dian_code, is_system),
          product_variants(
            variant_id, sku, variant_name, attrs, cost, price, price_includes_tax, pricing_method, markup_percentage, price_rounding, rounding_to, min_stock, allow_backorder, is_active,
            product_barcodes(barcode_id, barcode)
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('product_id', productId)
        .single()

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async createProduct(tenantId, product) {
    try {
      const { data, error } = await supabaseService.insert(this.table, {
        tenant_id: tenantId,
        name: product.name,
        description: product.description || null,
        category_id: product.category_id || null,
        unit_id: product.unit_id || null,
        base_cost: product.base_cost || 0,
        base_price: product.base_price || 0,
        base_min_stock: product.base_min_stock || 0,
        is_active: product.is_active !== false,
        track_inventory: product.track_inventory !== false,
        requires_expiration: product.requires_expiration || false,
        inventory_behavior: product.inventory_behavior || 'RESELL',
        production_type: product.production_type || null,
        is_component: product.is_component || false
      })
      if (error) throw error
      
      // Trigger auto-creará la variante predeterminada
      // Retornar producto con sus variantes
      const productWithVariants = await this.getProductById(tenantId, data[0].product_id)
      if (productWithVariants.success) {
        queryCache.invalidateByTags(['products', 'product-variants'], { tenantId })
        return { success: true, data: productWithVariants.data }
      }
      
      queryCache.invalidateByTags(['products', 'product-variants'], { tenantId })
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async updateProduct(tenantId, productId, updates) {
    try {
      const { data, error } = await supabaseService.update(this.table, {
        name: updates.name,
        description: updates.description || null,
        category_id: updates.category_id || null,
        unit_id: updates.unit_id || null,
        is_active: updates.is_active,
        track_inventory: updates.track_inventory,
        requires_expiration: updates.requires_expiration !== undefined ? updates.requires_expiration : false,
        inventory_behavior: updates.inventory_behavior || 'RESELL',
        production_type: updates.production_type || null,
        is_component: updates.is_component || false
      }, { tenant_id: tenantId, product_id: productId })
      if (error) throw error
      
      // Si es variante única y tiene base_cost/base_price/base_min_stock, actualizar la variante predeterminada
      if (updates.variant_mode === 'single' && 
          (updates.base_cost !== undefined || 
           updates.base_price !== undefined || 
           updates.base_min_stock !== undefined)) {
        const variantUpdates = {}
        if (updates.base_cost !== undefined) variantUpdates.cost = updates.base_cost
        if (updates.base_price !== undefined) variantUpdates.price = updates.base_price
        if (updates.base_min_stock !== undefined) variantUpdates.min_stock = updates.base_min_stock
        
        await supabaseService.update(this.variantsTable, variantUpdates, {
          tenant_id: tenantId,
          product_id: productId,
          variant_name: 'Predeterminado'
        })
      }
      
      queryCache.invalidateByTags(['products', 'product-variants'], { tenantId })
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async deleteProduct(tenantId, productId) {
    try {
      const { error } = await supabaseService.delete(this.table, {
        tenant_id: tenantId, product_id: productId
      })
      if (error) throw error
      queryCache.invalidateByTags(['products', 'product-variants'], { tenantId })
      return { success: true }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // ---- Variantes ----
  async createVariant(tenantId, variant) {
    try {
      const { data, error } = await supabaseService.insert(this.variantsTable, {
        tenant_id: tenantId,
        product_id: variant.product_id,
        sku: variant.sku,
        variant_name: variant.variant_name || null,
        attrs: variant.attrs || null,
        cost: variant.cost || 0,
        price: variant.price || 0,
        price_includes_tax: variant.price_includes_tax || false,
        pricing_method: variant.pricing_method || 'MARKUP',
        markup_percentage: variant.markup_percentage || 20,
        price_rounding: variant.price_rounding || 'NONE',
        rounding_to: variant.rounding_to || 1,
        min_stock: variant.min_stock || 0,
        allow_backorder: variant.allow_backorder || false,
        is_active: variant.is_active !== false,
        requires_expiration: variant.requires_expiration !== undefined ? variant.requires_expiration : null
      })
      if (error) throw error
      queryCache.invalidateByTags(['products', 'product-variants'], { tenantId })
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async updateVariant(tenantId, variantId, updates) {
    try {
      const { data, error } = await supabaseService.update(this.variantsTable, {
        sku: updates.sku,
        variant_name: updates.variant_name || null,
        attrs: updates.attrs || null,
        cost: updates.cost || 0,
        price: updates.price || 0,
        price_includes_tax: updates.price_includes_tax || false,
        pricing_method: updates.pricing_method || 'MARKUP',
        markup_percentage: updates.markup_percentage || 20,
        price_rounding: updates.price_rounding || 'NONE',
        rounding_to: updates.rounding_to || 1,
        min_stock: updates.min_stock || 0,
        allow_backorder: updates.allow_backorder || false,
        is_active: updates.is_active,
        requires_expiration: updates.requires_expiration !== undefined ? updates.requires_expiration : null
      }, { tenant_id: tenantId, variant_id: variantId })
      if (error) throw error
      queryCache.invalidateByTags(['products', 'product-variants'], { tenantId })
      return { success: true, data: data[0] }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async deleteVariant(tenantId, variantId) {
    try {
      const { error } = await supabaseService.delete(this.variantsTable, {
        tenant_id: tenantId, variant_id: variantId
      })
      if (error) throw error
      queryCache.invalidateByTags(['products', 'product-variants'], { tenantId })
      return { success: true }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Buscar variante por código de barras o SKU (para POS)
  async findVariantByBarcode(tenantId, barcode) {
    try {
      // Buscar por barcode
      let { data, error } = await supabaseService.client
        .from(this.barcodesTable)
        .select(`
          barcode,
          variant:variant_id(
            variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
            product:product_id(product_id, name, category_id, track_inventory, is_component)
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('barcode', barcode)
        .limit(1)

      if (error) throw error
      // Filtrar componentes: no se pueden vender directamente
      if (data && data.length > 0) {
        const variant = data[0].variant
        if (variant.is_component || variant.product?.is_component) {
          return { success: false, error: 'Este producto es un componente y no puede venderse directamente' }
        }
        return { success: true, data: variant }
      }

      // Buscar por SKU
      const r = await supabaseService.client
        .from(this.variantsTable)
        .select(`
          variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
          product:product_id(product_id, name, category_id, track_inventory, is_component)
        `)
        .eq('tenant_id', tenantId)
        .eq('sku', barcode)
        .limit(1)

      if (r.error) throw r.error
      if (r.data && r.data.length > 0) {
        const variant = r.data[0]
        if (variant.is_component || variant.product?.is_component) {
          return { success: false, error: 'Este producto es un componente y no puede venderse directamente' }
        }
        return { success: true, data: variant }
      }

      return { success: false, error: 'Producto no encontrado' }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  // Buscar variantes por texto (para POS autocomplete)
  async searchVariants(tenantId, search, limit = 20, locationId = null, options = {}) {
    try {
      const normalizedSearch = String(search || '').trim()
      if (!tenantId || !normalizedSearch) {
        return { success: true, data: [] }
      }

      const includeStock = options.includeStock !== false
      const cacheKey = this.buildVariantSearchCacheKey(normalizedSearch, limit, locationId, includeStock)

      return await queryCache.getOrLoad(
        cacheKey,
        async () => {
          // Buscar por SKU o nombre de variante (EXCLUIR COMPONENTES)
          const { data: byVariant, error: e1 } = await supabaseService.client
            .from(this.variantsTable)
            .select(`
              variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
              product:product_id(product_id, name, is_component)
            `)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .or('is_component.is.null,is_component.eq.false')
            .or(`sku.ilike.%${normalizedSearch}%,variant_name.ilike.%${normalizedSearch}%`)
            .limit(limit)

          if (e1) throw e1

          // Buscar por nombre de producto (EXCLUIR COMPONENTES)
          const { data: byProduct, error: e2 } = await supabaseService.client
            .from(this.variantsTable)
            .select(`
              variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
              product:product_id!inner(product_id, name, is_component)
            `)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .or('is_component.is.null,is_component.eq.false')
            .ilike('product.name', `%${normalizedSearch}%`)
            .limit(limit)

          if (e2) throw e2

          let results = dedupeVariants([...(byVariant || []), ...(byProduct || [])], limit)
            .filter((variant) => {
              const effectiveIsComponent = variant.is_component !== null
                ? variant.is_component
                : (variant.product?.is_component || false)
              return !effectiveIsComponent
            })

          if (includeStock && locationId && results.length > 0) {
            const variantIds = results.map((variant) => variant.variant_id)
            const { data: stockData, error: stockError } = await supabaseService.client
              .from('stock_balances')
              .select('variant_id, on_hand, reserved')
              .eq('tenant_id', tenantId)
              .eq('location_id', locationId)
              .in('variant_id', variantIds)

            if (!stockError && stockData) {
              const stockMap = new Map(stockData.map((stock) => [stock.variant_id, stock]))
              results = results.map((variant) => ({
                ...variant,
                stock_on_hand: stockMap.get(variant.variant_id)?.on_hand || 0,
                stock_reserved: stockMap.get(variant.variant_id)?.reserved || 0,
                stock_available: (stockMap.get(variant.variant_id)?.on_hand || 0) - (stockMap.get(variant.variant_id)?.reserved || 0)
              }))
            }
          }

          return { success: true, data: results }
        },
        {
          tenantId,
          ttlMs: VARIANT_SEARCH_TTL_MS,
          storage: 'memory',
          tags: ['products', 'product-variants'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true
        }
      )
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  /**
   * Obtener variantes activas para catálogos internos (lotes, compras, etc.)
   */
  async getActiveVariants(tenantId, limit = 500) {
    try {
      return await queryCache.getOrLoad(
        `products:active-variants:${Number(limit || 500)}`,
        async () => {
          const { data, error } = await supabaseService.client
            .from(this.variantsTable)
            .select(`
              variant_id,
              sku,
              variant_name,
              cost,
              price,
              is_active,
              is_component,
              requires_expiration,
              product:product_id(
                product_id,
                name,
                requires_expiration,
                is_component
              )
            `)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('sku', { ascending: true })
            .limit(limit)

          if (error) throw error
          return { success: true, data: data || [] }
        },
        {
          tenantId,
          ttlMs: ACTIVE_VARIANTS_TTL_MS,
          storage: 'session',
          tags: ['products', 'product-variants'],
          shouldCache: (result) => result?.success === true
        }
      )
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  async getVariantsForChatMatching(tenantId, searchTerms = [], options = {}) {
    try {
      const normalizedTerms = [...new Set(
        (Array.isArray(searchTerms) ? searchTerms : [])
          .flatMap((term) => buildChatSearchVariants(term))
          .filter((term) => term.length >= 2)
      )]

      if (!tenantId || normalizedTerms.length === 0) {
        return { success: true, data: [] }
      }

      const perTermLimit = Math.max(4, Number(options.perTermLimit || 14))
      const maxItems = Math.max(perTermLimit, Number(options.maxItems || 180))
      const selectedTerms = normalizedTerms.slice(0, 24)

      return await queryCache.getOrLoad(
        `products:chat-matching:${JSON.stringify({ terms: selectedTerms, perTermLimit, maxItems })}`,
        async () => {
          const results = await Promise.all(
            selectedTerms.map((term) => this.searchVariants(tenantId, term, perTermLimit, null, { includeStock: false }))
          )

          const merged = dedupeVariants(
            results.flatMap((result) => result.success ? (result.data || []) : []),
            maxItems
          )

          return { success: true, data: merged }
        },
        {
          tenantId,
          ttlMs: CHAT_MATCHING_VARIANTS_TTL_MS,
          storage: 'memory',
          tags: ['products', 'product-variants'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true
        }
      )
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  async createOrUpdateSimpleProduct(tenantId, payload) {
    if (!tenantId) {
      throw new Error('tenant_id es requerido para crear productos desde importación masiva')
    }

    const productName = payload.product_name?.trim()
    if (!productName) {
      throw new Error('product_name es requerido en la plantilla de importación')
    }

    const variantName = (payload.variant_name?.trim()) || 'Predeterminada'
    const description = payload.description?.trim() || null
    const isActive = payload.is_active !== false
    const controlExpiration = Boolean(payload.control_expiration)
    const isComponent = Boolean(payload.is_component)

    const behaviorMap = {
      RESELL: 'RESELL',
      REVENTA: 'RESELL',
      MANUFACTURED: 'MANUFACTURED',
      SERVICE: 'SERVICE',
      BUNDLE: 'BUNDLE',
      TO_STOCK: 'MANUFACTURED',
      ON_DEMAND: 'MANUFACTURED'
    }

    const inventoryBehavior = behaviorMap[(payload.inventory_type || 'RESELL').toUpperCase()] || 'RESELL'

    let unitId = null
    if (payload.unit_code) {
      const { data: unitData, error: unitError } = await supabaseService.client.rpc('fn_get_unit_by_code', {
        p_tenant_id: tenantId,
        p_code: payload.unit_code
      })
      if (unitError) throw unitError
      unitId = unitData
    }

    const { data: existingProducts, error: searchError } = await supabaseService.client
      .from(this.table)
      .select('product_id')
      .eq('tenant_id', tenantId)
      .ilike('name', productName)
      .limit(1)

    if (searchError) throw searchError

    const upsertPayload = {
      name: productName,
      description,
      category_id: payload.category_id || null,
      unit_id: unitId,
      is_active: isActive,
      track_inventory: true,
      inventory_behavior: inventoryBehavior,
      is_component: isComponent,
      requires_expiration: controlExpiration
    }

    let productId
    if (existingProducts && existingProducts.length > 0) {
      productId = existingProducts[0].product_id
      const { data: updated, error: updateError } = await supabaseService.update(this.table, upsertPayload, {
        tenant_id: tenantId,
        product_id: productId
      })

      if (updateError) throw updateError
      productId = updated[0].product_id
    } else {
      const { data: created, error: insertError } = await supabaseService.insert(this.table, {
        ...upsertPayload,
        tenant_id: tenantId
      })
      if (insertError) throw insertError
      productId = created[0].product_id
    }

    // Para productos simples siempre hay una única variante (creada por el trigger o manualmente).
    // Buscamos por product_id sin filtrar por nombre para no crear duplicados cuando
    // el trigger generó "Predeterminado" y el importador busca "Predeterminada".
    const variantSearch = await supabaseService.client
      .from(this.variantsTable)
      .select('variant_id, sku')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .ilike('variant_name', variantName)
      .limit(1)

    // Si no encontró por nombre exacto, buscar cualquier variante del producto
    let variantSearchData = variantSearch.data
    let variantSearchError = variantSearch.error
    if (variantSearchError) throw variantSearchError

    if (!variantSearchData || variantSearchData.length === 0) {
      const fallback = await supabaseService.client
        .from(this.variantsTable)
        .select('variant_id, sku')
        .eq('tenant_id', tenantId)
        .eq('product_id', productId)
        .limit(1)
      if (fallback.error) throw fallback.error
      variantSearchData = fallback.data
    }

    const variantPayload = {
      variant_name: variantName,
      cost: payload.unit_cost || 0,
      price: payload.unit_price || 0,
      price_includes_tax: Boolean(payload.price_includes_tax),
      is_active: isActive,
      requires_expiration: controlExpiration,
      unit_id: unitId,
      standard_code: payload.standard_code || null,
      standard_code_type: payload.standard_code_type || null
    }

    let variantId
    if (variantSearchData && variantSearchData.length > 0) {
      variantId = variantSearchData[0].variant_id
      const { data: updatedVariant, error: variantUpdateError } = await supabaseService.update(this.variantsTable, {
        ...variantPayload,
        sku: variantSearchData[0].sku
      }, {
        tenant_id: tenantId,
        variant_id: variantId
      })

      if (variantUpdateError) throw variantUpdateError
      variantId = updatedVariant[0].variant_id
    } else {
      const generatedSku = generateSku(productName)
      const { data: createdVariant, error: variantInsertError } = await supabaseService.insert(this.variantsTable, {
        tenant_id: tenantId,
        product_id: productId,
        sku: generatedSku,
        ...variantPayload
      })

      if (variantInsertError) throw variantInsertError
      variantId = createdVariant[0].variant_id
    }

    return {
      success: true,
      tenant_id: tenantId,
      product_id: productId,
      variant_id: variantId
    }
  }
}

export default new ProductsService()

function generateSku(value) {
  const normalized = (value || 'PRD')
    .trim()
    .replace(/[^A-Za-z0-9]/g, '')
    .substring(0, 3)
    .toUpperCase()
  const suffix = Math.floor(Math.random() * 900000) + 100000
  return `${normalized || 'PRD'}-${suffix}`
}
