import supabaseService from './supabase.service'
import { normalizeParsedPhotoProducts } from '@/utils/productPhotoBulkImport'

const PHOTO_PARSER_EDGE_FUNCTION =
  import.meta.env.VITE_PRODUCT_PHOTO_PARSER_EDGE_FUNCTION || 'product-photo-parser'

const OCR_MAX_BYTES = 980 * 1024
const OCR_WIDTHS = [1400, 1200, 1000, 800]
const OCR_QUALITIES = [0.35, 0.22, 0.14, 0.1]

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeBool(value, defaultValue = false) {
  if (value === true || value === 'TRUE' || value === 'true' || value === 1) return true
  if (value === false || value === 'FALSE' || value === 'false' || value === 0) return false
  return defaultValue
}

function normalizeInventoryBehavior(value) {
  const raw = String(value || 'REVENTA').trim().toUpperCase()
  const map = {
    RESELL: 'RESELL',
    REVENTA: 'RESELL',
    MANUFACTURED: 'MANUFACTURED',
    MANUFACTURA: 'MANUFACTURED',
    SERVICE: 'SERVICE',
    SERVICIO: 'SERVICE',
    BUNDLE: 'BUNDLE',
    COMBO: 'BUNDLE',
  }
  return map[raw] || 'RESELL'
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function findOrCreateCategoryByName(tenantId, categoryName) {
  const name = normalizeText(categoryName)
  if (!name) return null

  const { data: existing, error: searchError } = await supabaseService.client
    .from('categories')
    .select('category_id')
    .eq('tenant_id', tenantId)
    .ilike('name', name)
    .limit(1)

  if (searchError) throw searchError
  if (existing?.length) return existing[0].category_id

  const { data: created, error: createError } = await supabaseService.client
    .from('categories')
    .insert({
      tenant_id: tenantId,
      name,
      parent_category_id: null,
    })
    .select('category_id')
    .single()

  if (createError) throw createError
  return created?.category_id || null
}

async function resolveUnitId(tenantId, unitCode) {
  const code = normalizeText(unitCode).toUpperCase()
  if (!code) return null

  const { data, error } = await supabaseService.client
    .from('units_of_measure')
    .select('unit_id')
    .eq('is_active', true)
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .ilike('code', code)
    .order('is_system', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0]?.unit_id || null
}

async function resolveLocationIdByName(tenantId, locationName) {
  const value = normalizeText(locationName)
  if (!value) return null

  const { data, error } = await supabaseService.client
    .from('locations')
    .select('location_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .ilike('name', value)
    .limit(1)

  if (error) throw error
  return data?.[0]?.location_id || null
}

function generateSku(value) {
  const normalized = String(value || 'PRD')
    .trim()
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase()
  const suffix = Math.floor(Math.random() * 900000) + 100000
  return `${normalized || 'PRD'}-${suffix}`
}

async function upsertSimpleProduct(tenantId, row, defaults = {}) {
  const productName = normalizeText(row.product_name)
  if (!productName) {
    throw new Error('product_name es obligatorio')
  }

  const variantName = normalizeText(row.variant_name || defaults.variant_name || 'Predeterminada')
  const description = normalizeText(row.description || row.notes || null) || null
  const isActive = normalizeBool(row.is_active, true)
  const requiresExpiration = normalizeBool(row.control_expiration, false)
  const isComponent = normalizeBool(row.is_component, false)
  const unitPrice = normalizeNumber(row.unit_price, 0)
  const unitCost = normalizeNumber(row.unit_cost, 0)
  const initialStock = normalizeNumber(row.initial_stock, 0)
  const priceIncludesTax = normalizeBool(row.price_includes_tax, false)
  const inventoryBehavior = normalizeInventoryBehavior(row.inventory_type || defaults.inventory_type || 'REVENTA')
  const unitCode = normalizeText(row.unit_code || defaults.unit_code || '')
  const locationCode = normalizeText(row.location_code || defaults.location_code || '')

  const [categoryId, unitId] = await Promise.all([
    findOrCreateCategoryByName(tenantId, row.category_name || defaults.category_name || null),
    resolveUnitId(tenantId, unitCode),
  ])

  const { data: existingProducts, error: findProductError } = await supabaseService.client
    .from('products')
    .select('product_id')
    .eq('tenant_id', tenantId)
    .ilike('name', productName)
    .limit(1)

  if (findProductError) throw findProductError

  const productPayload = {
    name: productName,
    description,
    category_id: categoryId,
    unit_id: unitId,
    is_active: isActive,
    track_inventory: true,
    requires_expiration: requiresExpiration,
    inventory_behavior: inventoryBehavior,
    is_component: isComponent,
  }

  let productId = existingProducts?.[0]?.product_id || null
  let productCreated = false

  if (productId) {
    const { error: updateProductError } = await supabaseService.client
      .from('products')
      .update(productPayload)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
    if (updateProductError) throw updateProductError
  } else {
    const { data: createdProduct, error: createProductError } = await supabaseService.client
      .from('products')
      .insert({
        tenant_id: tenantId,
        ...productPayload,
      })
      .select('product_id')
      .single()
    if (createProductError) throw createProductError
    productId = createdProduct?.product_id || null
    productCreated = true
  }

  if (!productId) {
    throw new Error(`No se pudo resolver product_id para "${productName}"`)
  }

  let variantQuery = await supabaseService.client
    .from('product_variants')
    .select('variant_id, sku')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .ilike('variant_name', variantName)
    .limit(1)

  if (variantQuery.error) throw variantQuery.error
  if (!variantQuery.data?.length) {
    variantQuery = await supabaseService.client
      .from('product_variants')
      .select('variant_id, sku')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .limit(1)
    if (variantQuery.error) throw variantQuery.error
  }

  const variantPayload = {
    variant_name: variantName,
    cost: unitCost,
    price: unitPrice,
    price_includes_tax: priceIncludesTax,
    is_active: isActive,
    requires_expiration: requiresExpiration,
    unit_id: unitId,
  }

  let variantId = variantQuery.data?.[0]?.variant_id || null
  if (variantId) {
    const { error: updateVariantError } = await supabaseService.client
      .from('product_variants')
      .update({
        ...variantPayload,
        sku: variantQuery.data?.[0]?.sku || generateSku(productName),
      })
      .eq('tenant_id', tenantId)
      .eq('variant_id', variantId)
    if (updateVariantError) throw updateVariantError
  } else {
    const { data: createdVariant, error: createVariantError } = await supabaseService.client
      .from('product_variants')
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        sku: generateSku(productName),
        ...variantPayload,
      })
      .select('variant_id')
      .single()
    if (createVariantError) throw createVariantError
    variantId = createdVariant?.variant_id || null
  }

  const warnings = []
  if (initialStock > 0 && locationCode && variantId) {
    const locationId = await resolveLocationIdByName(tenantId, locationCode)
    if (!locationId) {
      warnings.push(`Ubicacion "${locationCode}" no encontrada para stock inicial.`)
    } else {
      const { error: moveError } = await supabaseService.client
        .from('inventory_moves')
        .insert({
          tenant_id: tenantId,
          move_type: 'INITIAL_STOCK',
          location_id: locationId,
          variant_id: variantId,
          quantity: initialStock,
          unit_cost: unitCost,
          source: 'BULK_IMPORT',
          note: 'Stock inicial via carga por foto',
        })
      if (moveError) throw moveError

      const { error: rpcError } = await supabaseService.client.rpc('fn_apply_stock_delta', {
        p_tenant: tenantId,
        p_location: locationId,
        p_variant: variantId,
        p_delta: initialStock,
      })
      if (rpcError) throw rpcError
    }
  }

  return {
    product_id: productId,
    variant_id: variantId,
    product_created: productCreated,
    warnings,
  }
}

async function extractInvokeError(error) {
  const fragments = []
  if (error?.message) fragments.push(String(error.message))
  const context = error?.context
  if (!context) return fragments.join(' | ') || 'Error desconocido'

  try {
    const response = typeof context.clone === 'function' ? context.clone() : context
    if (response?.status) fragments.push(`HTTP ${response.status}`)
    let bodyJson = null
    if (typeof response?.json === 'function') {
      bodyJson = await response.json().catch(() => null)
    }
    if (bodyJson?.error) fragments.push(String(bodyJson.error))
    if (bodyJson?.details) fragments.push(String(bodyJson.details))
    if (!bodyJson && typeof response?.text === 'function') {
      const bodyText = await response.text().catch(() => '')
      if (bodyText?.trim()) fragments.push(bodyText.trim().slice(0, 280))
    }
  } catch (_error) {
    // no-op
  }

  return Array.from(new Set(fragments.filter(Boolean))).join(' | ') || 'Error desconocido'
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo leer la imagen seleccionada.'))
    }
    image.src = objectUrl
  })
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

async function optimizeImageForOcr(file) {
  if (!(file instanceof Blob)) {
    return { success: false, error: 'Debes seleccionar una imagen valida.' }
  }

  const image = await loadImageElement(file)
  const originalWidth = Number(image.naturalWidth || image.width || 0)
  const originalHeight = Number(image.naturalHeight || image.height || 0)

  for (const targetWidth of OCR_WIDTHS) {
    const safeWidth = Math.min(originalWidth || targetWidth, targetWidth)
    const scale = originalWidth > 0 ? safeWidth / originalWidth : 1
    const safeHeight = Math.max(1, Math.round((originalHeight || safeWidth) * scale))

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(safeWidth))
    canvas.height = safeHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return { success: false, error: 'El navegador no permitio preparar la imagen para OCR.' }
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    for (const quality of OCR_QUALITIES) {
      const blob = await canvasToBlob(canvas, quality)
      if (blob && blob.size > 0 && blob.size <= OCR_MAX_BYTES) {
        return {
          success: true,
          data: {
            blob,
            mimeType: 'image/jpeg',
          },
        }
      }
    }
  }

  return {
    success: false,
    error: 'No se pudo reducir la foto por debajo de 1MB para OCR. Acerca mas la camara y evita fondo extra.',
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = () => reject(new Error('No se pudo leer la imagen para IA.'))
    reader.readAsDataURL(blob)
  })
}

export async function parseProductsFromPhoto({ tenantId, imageBase64, mimeType = 'image/jpeg' } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
  if (!imageBase64) return { success: false, error: 'imageBase64 es requerido.' }

  const { data, error } = await supabaseService.client.functions.invoke(PHOTO_PARSER_EDGE_FUNCTION, {
    body: {
      image: imageBase64,
      mime_type: mimeType,
      model: import.meta.env.VITE_DEEPSEEK_TEXT_MODEL || 'deepseek-chat',
      temperature: 0.1,
      max_tokens: 2200,
    },
  })

  if (error) {
    const details = await extractInvokeError(error)
    return { success: false, error: `Error invocando ${PHOTO_PARSER_EDGE_FUNCTION}: ${details}` }
  }

  return {
    success: true,
    data: normalizeParsedPhotoProducts({
      products: Array.isArray(data?.products) ? data.products : [],
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
      ocr_text: data?.ocr_text || null,
      usage: data?.usage || null,
      model: data?.model || null,
    }),
  }
}

export async function analyzeProductsPhotoFile({ tenantId, file } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
  if (!(file instanceof Blob)) return { success: false, error: 'Debes seleccionar una imagen valida.' }

  try {
    const optimized = await optimizeImageForOcr(file)
    if (!optimized.success) return optimized

    const imageBase64 = await blobToBase64(optimized.data.blob)
    return parseProductsFromPhoto({
      tenantId,
      imageBase64,
      mimeType: optimized.data.mimeType || 'image/jpeg',
    })
  } catch (error) {
    return { success: false, error: error?.message || 'No se pudo analizar la foto.' }
  }
}

export async function importProductsFromRows({ tenantId, rows, defaults = {} } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' }

  const source = Array.isArray(rows) ? rows : []
  const normalizedRows = source
    .map((row) => ({
      ...row,
      product_name: normalizeText(row?.product_name),
    }))
    .filter((row) => row.product_name)

  if (!normalizedRows.length) {
    return { success: false, error: 'No hay filas validas para importar.' }
  }

  let processed = 0
  let created = 0
  let failed = 0
  const errors = []
  const warnings = []

  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index]
    try {
      const result = await upsertSimpleProduct(tenantId, row, defaults)
      processed += 1
      if (result.product_created) created += 1
      if (Array.isArray(result.warnings) && result.warnings.length) {
        for (const warning of result.warnings) {
          warnings.push(`Fila ${index + 1}: ${warning}`)
        }
      }
    } catch (error) {
      failed += 1
      errors.push({
        row: index + 1,
        product_name: row.product_name,
        message: String(error?.message || 'Error desconocido'),
      })
    }
  }

  return {
    success: failed === 0,
    data: {
      processed,
      created,
      updated: Math.max(0, processed - created),
      failed,
      errors,
      warnings,
    },
    error: failed > 0 ? `Importacion parcial: ${processed} ok, ${failed} con error.` : null,
  }
}
