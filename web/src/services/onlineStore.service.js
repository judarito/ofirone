import { supabase } from '@/plugins/supabase'
import supabaseService from './supabase.service'
import queryCache from '@/utils/queryCache'
import { serviceErrorResult } from '@/utils/appErrors'

const STOREFRONT_BUCKET = 'storefront'
const ADMIN_CACHE_TTL_MS = 60 * 1000
const configuredMercadoPagoPreferenceFunction = String(import.meta.env.VITE_MP_CREATE_PREFERENCE_EDGE_FUNCTION || '').trim()
const MERCADO_PAGO_PREFERENCE_EDGE_FUNCTION = configuredMercadoPagoPreferenceFunction
  && configuredMercadoPagoPreferenceFunction !== 'mercadopago-create-preference'
  ? configuredMercadoPagoPreferenceFunction
  : 'mercadopago-create-preference-v2'
const TENANT_MERCADOPAGO_CONFIG_EDGE_FUNCTION = import.meta.env.VITE_TENANT_MP_CONFIG_EDGE_FUNCTION || 'tenant-mercadopago-config'
const MERCADO_PAGO_WEBHOOK_EDGE_FUNCTION = import.meta.env.VITE_MP_WEBHOOK_EDGE_FUNCTION || 'mercadopago-webhook'
const ONLINE_ORDER_EMAIL_EDGE_FUNCTION = import.meta.env.VITE_ONLINE_ORDER_EMAIL_EDGE_FUNCTION || 'online-order-email'

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sanitizeAssetName(name) {
  const source = String(name || 'asset')
  const [base, ext] = source.split(/\.(?=[^.]+$)/)
  const normalizedBase = slugify(base || 'asset') || 'asset'
  const normalizedExt = String(ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  return `${normalizedBase}.${normalizedExt}`
}

function normalizeAbsoluteUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol)) return ''
    return url.toString()
  } catch (_error) {
    return ''
  }
}

async function extractFunctionInvokeError(error) {
  const rawMessage = String(error?.message || error || '').trim()
  const context = error?.context
  if (!context || typeof context?.json !== 'function') {
    return rawMessage
  }

  try {
    const payload = await context.json()
    const nestedMessage = String(payload?.error || payload?.message || '').trim()
    const buildId = String(payload?.build_id || '').trim()
    const submittedPreference = payload?.submitted_preference || payload?.submitted_items || null
    const debugSuffix = [
      buildId ? `build_id=${buildId}` : '',
      submittedPreference ? `submitted_preference=${JSON.stringify(submittedPreference)}` : '',
    ].filter(Boolean).join(' | ')
    const message = nestedMessage || rawMessage
    return debugSuffix ? `${message} (${debugSuffix})` : message
  } catch (_contextError) {
    return rawMessage
  }
}

function buildPublicStorageUrl(bucket, path) {
  const normalizedPath = String(path || '').replace(/^\/+/, '')
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  if (!baseUrl || !normalizedPath) return ''
  return `${baseUrl}/storage/v1/object/public/${bucket}/${normalizedPath}`
}

function isBucketNotFoundError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('bucket not found')
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(hex) {
  const normalized = String(hex || '').trim().replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  }
}

function mixColors(hexA, hexB, weight = 0.5) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a && !b) return '#1e63b7'
  if (!a) return hexB
  if (!b) return hexA
  const ratio = clamp(Number(weight || 0), 0, 1)
  return rgbToHex(
    (a.r * (1 - ratio)) + (b.r * ratio),
    (a.g * (1 - ratio)) + (b.g * ratio),
    (a.b * (1 - ratio)) + (b.b * ratio),
  )
}

function getRelativeLuminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function bestTextColor(backgroundHex) {
  return getRelativeLuminance(backgroundHex) > 0.45 ? '#0f172a' : '#f8fafc'
}

function loadImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const dimensions = {
        width: Number(image.naturalWidth || image.width || 0),
        height: Number(image.naturalHeight || image.height || 0),
      }
      URL.revokeObjectURL(objectUrl)
      resolve(dimensions)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo leer la imagen para validar dimensiones.'))
    }
    image.src = objectUrl
  })
}

function sampleImagePaletteFromUrl(imageUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      const maxWidth = 64
      const scale = image.naturalWidth > 0 ? Math.min(1, maxWidth / image.naturalWidth) : 1
      canvas.width = Math.max(8, Math.round((image.naturalWidth || 64) * scale))
      canvas.height = Math.max(8, Math.round((image.naturalHeight || 64) * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        reject(new Error('El navegador no permitió analizar la imagen.'))
        return
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      const buckets = new Map()
      let totalR = 0
      let totalG = 0
      let totalB = 0
      let totalSamples = 0

      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3]
        if (alpha < 180) continue

        const r = data[index]
        const g = data[index + 1]
        const b = data[index + 2]
        totalR += r
        totalG += g
        totalB += b
        totalSamples += 1

        const key = `${Math.round(r / 32) * 32}-${Math.round(g / 32) * 32}-${Math.round(b / 32) * 32}`
        buckets.set(key, (buckets.get(key) || 0) + 1)
      }

      if (!totalSamples || buckets.size === 0) {
        reject(new Error('No se encontraron colores utilizables en la imagen.'))
        return
      }

      const dominantBucket = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '30-99-183'
      const [dominantR, dominantG, dominantB] = dominantBucket.split('-').map((value) => Number(value || 0))
      const averageHex = rgbToHex(totalR / totalSamples, totalG / totalSamples, totalB / totalSamples)
      const dominantHex = rgbToHex(dominantR, dominantG, dominantB)

      resolve({
        dominantHex,
        averageHex,
      })
    }
    image.onerror = () => reject(new Error('No se pudo analizar la imagen.'))
    image.src = imageUrl
  })
}

class OnlineStoreService {
  constructor() {
    this.storesTable = 'online_stores'
    this.catalogTable = 'online_store_catalog'
    this.ordersTable = 'online_orders'
  }

  getEmptyStoreConfig() {
    return {
      store_id: null,
      slug: '',
      is_enabled: false,
      is_published: false,
      location_id: null,
      sold_by_user_id: null,
      manual_payment_method_id: null,
      stock_buffer_units: 0,
      landing_return_url: '',
      brand_name: '',
      brand_logo_url: '',
      header_image_url: '',
      primary_color: '#1e63b7',
      secondary_color: '#4ca53c',
      accent_color: '#f59e0b',
      background_color: '#f8fafc',
      surface_color: '#ffffff',
      text_color: '#0f172a',
      button_text: 'Comprar ahora',
      checkout_message: '',
      support_whatsapp: '',
      allow_manual_payment: true,
      allow_gateway_payment: false,
      gateway_status: 'COMING_SOON',
    }
  }

  getEmptyMercadoPagoConfig() {
    return {
      environment: 'sandbox',
      public_key: '',
      access_token: '',
      access_token_hint: '',
      has_access_token: false,
      account_email: '',
      is_enabled: false,
      clear_access_token: false,
      updated_at: null,
    }
  }

  async getStoreConfig(tenantId, options = {}) {
    try {
      return await queryCache.getOrLoad(
        'online-store:config',
        async () => {
          const { data, error } = await supabaseService.client
            .from(this.storesTable)
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle()

          if (error) throw error
          return {
            success: true,
            data: {
              ...this.getEmptyStoreConfig(),
              ...(data || {}),
              landing_return_url: data?.landing_return_url || '',
              brand_name: data?.brand_name || '',
              brand_logo_url: data?.brand_logo_url || '',
              header_image_url: data?.header_image_url || '',
              checkout_message: data?.checkout_message || '',
              support_whatsapp: data?.support_whatsapp || '',
            },
          }
        },
        {
          tenantId,
          ttlMs: ADMIN_CACHE_TTL_MS,
          storage: 'session',
          tags: ['online-store'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true,
        },
      )
    } catch (error) {
      return serviceErrorResult(error, { data: this.getEmptyStoreConfig() })
    }
  }

  async saveStoreConfig(tenantId, payload = {}) {
    try {
      const slug = slugify(payload.slug || payload.brand_name)
      const nextPayload = {
        tenant_id: tenantId,
        slug,
        is_enabled: payload.is_enabled === true,
        is_published: payload.is_published === true,
        location_id: payload.location_id || null,
        sold_by_user_id: payload.sold_by_user_id || null,
        manual_payment_method_id: payload.manual_payment_method_id || null,
        stock_buffer_units: Number(payload.stock_buffer_units || 0),
        landing_return_url: normalizeAbsoluteUrl(payload.landing_return_url) || null,
        brand_name: String(payload.brand_name || '').trim() || null,
        brand_logo_url: normalizeAbsoluteUrl(payload.brand_logo_url) || null,
        header_image_url: normalizeAbsoluteUrl(payload.header_image_url) || null,
        primary_color: payload.primary_color || '#1e63b7',
        secondary_color: payload.secondary_color || '#4ca53c',
        accent_color: payload.accent_color || '#f59e0b',
        background_color: payload.background_color || '#f8fafc',
        surface_color: payload.surface_color || '#ffffff',
        text_color: payload.text_color || '#0f172a',
        button_text: String(payload.button_text || '').trim() || 'Comprar ahora',
        checkout_message: String(payload.checkout_message || '').trim() || null,
        support_whatsapp: String(payload.support_whatsapp || '').trim() || null,
        allow_manual_payment: payload.allow_manual_payment !== false,
        allow_gateway_payment: payload.allow_gateway_payment === true,
        gateway_status: payload.gateway_status || 'COMING_SOON',
      }

      if (!nextPayload.slug) {
        return {
          success: false,
          error: 'Define un slug válido para generar el link de la tienda.',
        }
      }

      if ((nextPayload.is_enabled || nextPayload.is_published) && !nextPayload.location_id) {
        return { success: false, error: 'Selecciona la sede desde la que venderá la tienda online.' }
      }
      if ((nextPayload.is_enabled || nextPayload.is_published) && !nextPayload.sold_by_user_id) {
        return { success: false, error: 'Selecciona el usuario responsable para registrar las ventas online.' }
      }
      if ((nextPayload.is_enabled || nextPayload.is_published) && !nextPayload.manual_payment_method_id) {
        return { success: false, error: 'Selecciona el método de pago manual que se usará en checkout.' }
      }

      const { data, error } = await supabaseService.client
        .from(this.storesTable)
        .upsert(nextPayload, { onConflict: 'tenant_id' })
        .select('*')
        .single()

      if (error) throw error

      queryCache.invalidateByTags(['online-store'], { tenantId })
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async getCatalog(tenantId, storeId, options = {}) {
    if (!tenantId || !storeId) return { success: true, data: [] }
    try {
      return await queryCache.getOrLoad(
        `online-store:catalog:${storeId}`,
        async () => {
          const { data, error } = await supabaseService.client
            .from(this.catalogTable)
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('store_id', storeId)
            .order('sort_order', { ascending: true })

          if (error) throw error
          return { success: true, data: data || [] }
        },
        {
          tenantId,
          ttlMs: ADMIN_CACHE_TTL_MS,
          storage: 'session',
          tags: ['online-store'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true,
        },
      )
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  async saveCatalogItems(tenantId, storeId, items = []) {
    if (!tenantId || !storeId) {
      return { success: false, error: 'Guarda la configuración general de la tienda antes del catálogo.' }
    }

    try {
      const rows = (Array.isArray(items) ? items : [])
        .filter((item) => item?.variant_id)
        .map((item, index) => ({
          tenant_id: tenantId,
          store_id: storeId,
          variant_id: item.variant_id,
          is_published: item.is_published === true,
          stock_mode: ['ALL', 'FIXED', 'PERCENT'].includes(item.stock_mode) ? item.stock_mode : 'ALL',
          stock_value: item.stock_mode === 'ALL'
            ? null
            : Math.max(0, Number(item.stock_value || 0)),
          sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index + 1,
          custom_title: String(item.custom_title || '').trim() || null,
          custom_description: String(item.custom_description || '').trim() || null,
        }))

      if (rows.length === 0) {
        queryCache.invalidateByTags(['online-store'], { tenantId })
        return { success: true }
      }

      const { error } = await supabaseService.client
        .from(this.catalogTable)
        .upsert(rows, { onConflict: 'store_id,variant_id' })

      if (error) throw error

      queryCache.invalidateByTags(['online-store'], { tenantId })
      return { success: true }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async uploadBrandAsset(tenantId, file, assetType = 'header') {
    if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
    if (!file) return { success: false, error: 'Selecciona un archivo de imagen.' }

    try {
      const safeName = sanitizeAssetName(file.name)
      const storagePath = `${tenantId}/${assetType}-${Date.now()}-${safeName}`

      const { error } = await supabaseService.uploadFile(STOREFRONT_BUCKET, storagePath, file)
      if (error) throw error

      return {
        success: true,
        data: {
          storage_path: storagePath,
          public_url: supabaseService.getPublicUrl(STOREFRONT_BUCKET, storagePath),
        },
      }
    } catch (error) {
      if (isBucketNotFoundError(error)) {
        return {
          success: false,
          error: 'El bucket de Supabase `storefront` no existe todavía. Ejecuta la migración `ADD_ONLINE_STORE_MVP.sql` o créalo en Storage antes de subir imágenes.',
        }
      }
      return serviceErrorResult(error)
    }
  }

  async uploadPaymentProof(slug, file) {
    if (!slug) return { success: false, error: 'No encontramos la tienda para adjuntar el comprobante.' }
    if (!file) return { success: false, error: 'Selecciona un comprobante para continuar.' }

    try {
      const safeName = sanitizeAssetName(file.name)
      const storagePath = `public-proofs/${slugify(slug) || 'store'}/proof-${Date.now()}-${safeName}`
      const { error } = await supabase.storage.from(STOREFRONT_BUCKET).upload(storagePath, file, {
        upsert: false,
        cacheControl: '3600',
      })
      if (error) throw error

      return {
        success: true,
        data: {
          storage_path: storagePath,
          public_url: supabaseService.getPublicUrl(STOREFRONT_BUCKET, storagePath),
        },
      }
    } catch (error) {
      if (isBucketNotFoundError(error)) {
        return {
          success: false,
          error: 'El bucket `storefront` no existe todavía. Ejecuta las migraciones de tienda online antes de adjuntar comprobantes.',
        }
      }
      return serviceErrorResult(error)
    }
  }

  async getImageDimensions(file) {
    try {
      const data = await loadImageDimensions(file)
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async inferPaletteFromBranding({ headerImageUrl, logoUrl } = {}) {
    try {
      const sources = [headerImageUrl, logoUrl].filter(Boolean)
      if (sources.length === 0) {
        return { success: false, error: 'Sube un header o un logo antes de inferir colores.' }
      }

      const samples = []
      for (const source of sources) {
        const palette = await sampleImagePaletteFromUrl(source)
        samples.push(palette)
      }

      const headerPalette = samples[0] || null
      const logoPalette = samples[1] || null
      const primary = headerPalette?.dominantHex || logoPalette?.dominantHex || '#1e63b7'
      const secondary = logoPalette?.dominantHex || headerPalette?.averageHex || '#4ca53c'
      const accent = mixColors(primary, '#f59e0b', 0.45)
      const background = mixColors(headerPalette?.averageHex || primary, '#ffffff', 0.88)
      const surface = mixColors(background, '#ffffff', 0.6)
      const text = bestTextColor(background)

      return {
        success: true,
        data: {
          primary_color: primary,
          secondary_color: secondary,
          accent_color: accent,
          background_color: background,
          surface_color: surface,
          text_color: text,
        },
      }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async getPublicStore(slug) {
    try {
      const { data, error } = await supabase.rpc('fn_get_public_online_store', {
        p_slug: slug,
      })
      if (error) throw error
      return { success: true, data: data || null }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async getPublicCatalog(slug) {
    try {
      const { data, error } = await supabase.rpc('fn_list_public_online_store_products', {
        p_slug: slug,
      })
      if (error) throw error
      return {
        success: true,
        data: (data || []).map((item) => ({
          ...item,
          image_url: item?.image_path ? buildPublicStorageUrl('productmedia', item.image_path) : '',
        })),
      }
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  async createManualOrder(slug, payload = {}) {
    try {
      const { data, error } = await supabase.rpc('fn_create_online_manual_order', {
        p_slug: slug,
        p_customer_name: String(payload.customer_name || '').trim() || null,
        p_customer_email: String(payload.customer_email || '').trim() || null,
        p_customer_phone: String(payload.customer_phone || '').trim() || null,
        p_customer_note: String(payload.customer_note || '').trim() || null,
        p_payment_reference: String(payload.payment_reference || '').trim() || null,
        p_landing_return_url: normalizeAbsoluteUrl(payload.landing_return_url) || null,
        p_lines: Array.isArray(payload.lines) ? payload.lines : [],
        p_payment_mode: String(payload.payment_mode || 'MANUAL').trim().toUpperCase(),
        p_payment_proof_url: normalizeAbsoluteUrl(payload.payment_proof_url) || null,
        p_delivery_address: String(payload.delivery_address || '').trim() || null,
      })
      if (error) throw error
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async createGatewayPreference(slug, payload = {}) {
    try {
      const { data, error } = await supabase.functions.invoke(MERCADO_PAGO_PREFERENCE_EDGE_FUNCTION, {
        body: {
          slug,
          customer_name: String(payload.customer_name || '').trim() || null,
          customer_email: String(payload.customer_email || '').trim() || null,
          customer_phone: String(payload.customer_phone || '').trim() || null,
          customer_note: String(payload.customer_note || '').trim() || null,
          delivery_address: String(payload.delivery_address || '').trim() || null,
          landing_return_url: normalizeAbsoluteUrl(payload.landing_return_url) || null,
          origin: normalizeAbsoluteUrl(payload.origin) || null,
          lines: Array.isArray(payload.lines) ? payload.lines : [],
        },
      })

      if (error) throw error
      if (data?.error) {
        const debugSuffix = [
          data?.build_id ? `build_id=${data.build_id}` : '',
          data?.submitted_preference ? `submitted_preference=${JSON.stringify(data.submitted_preference)}` : '',
        ].filter(Boolean).join(' | ')
        throw new Error(debugSuffix ? `${data.error} (${debugSuffix})` : data.error)
      }
      return { success: true, data }
    } catch (error) {
      const extractedError = await extractFunctionInvokeError(error)
      return serviceErrorResult(extractedError)
    }
  }

  async getMercadoPagoConfig(tenantId) {
    if (!tenantId) return { success: true, data: this.getEmptyMercadoPagoConfig() }
    try {
      const { data, error } = await supabase.functions.invoke(TENANT_MERCADOPAGO_CONFIG_EDGE_FUNCTION, {
        body: {
          action: 'get',
          tenant_id: tenantId,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return {
        success: true,
        data: {
          ...this.getEmptyMercadoPagoConfig(),
          ...(data?.data || {}),
          access_token: '',
          clear_access_token: false,
        },
      }
    } catch (error) {
      return serviceErrorResult(error, { data: this.getEmptyMercadoPagoConfig() })
    }
  }

  async saveMercadoPagoConfig(tenantId, payload = {}) {
    if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
    try {
      const { data, error } = await supabase.functions.invoke(TENANT_MERCADOPAGO_CONFIG_EDGE_FUNCTION, {
        body: {
          action: 'save',
          tenant_id: tenantId,
          environment: String(payload.environment || 'sandbox').trim().toLowerCase(),
          public_key: String(payload.public_key || '').trim(),
          access_token: String(payload.access_token || '').trim(),
          account_email: String(payload.account_email || '').trim(),
          is_enabled: payload.is_enabled === true,
          clear_access_token: payload.clear_access_token === true,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return {
        success: true,
        data: {
          ...this.getEmptyMercadoPagoConfig(),
          ...(data?.data || {}),
          access_token: '',
          clear_access_token: false,
        },
      }
    } catch (error) {
      return serviceErrorResult(error, { data: this.getEmptyMercadoPagoConfig() })
    }
  }

  async getOnlineOrders(tenantId, storeId = null, options = {}) {
    if (!tenantId) return { success: true, data: [] }

    try {
      return await queryCache.getOrLoad(
        `online-store:orders:${storeId || 'all'}:${options.paymentMode || 'all'}`,
        async () => {
          let query = supabaseService.client
            .from(this.ordersTable)
            .select(`
              online_order_id,
              order_number,
              store_id,
              sale_id,
              status,
              payment_mode,
              payment_status,
              customer_name,
              customer_email,
              customer_phone,
              customer_note,
              delivery_address,
              payment_reference,
              payment_payload,
              status_history,
              subtotal,
              discount_total,
              tax_total,
              total,
              landing_return_url,
              created_at,
              updated_at
            `)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(options.limit || 50)

          if (storeId) {
            query = query.eq('store_id', storeId)
          }

          if (options.paymentMode) {
            query = query.eq('payment_mode', String(options.paymentMode).trim().toUpperCase())
          }

          const { data: orders, error: ordersError } = await query

          if (ordersError) throw ordersError

          const orderIds = (orders || []).map((item) => item.online_order_id).filter(Boolean)
          if (orderIds.length === 0) return { success: true, data: [] }

          const [linesRes, reservationsRes] = await Promise.all([
            supabaseService.client
              .from('online_order_lines')
              .select(`
                online_order_id,
                variant_id,
                sku,
                product_name,
                variant_name,
                quantity,
                unit_price,
                tax_rate,
                tax_amount,
                line_total
              `)
              .in('online_order_id', orderIds)
              .order('created_at', { ascending: true }),
            supabaseService.client
              .from('online_order_reservations')
              .select(`
                online_order_id,
                variant_id,
                reserved_qty,
                status,
                created_at,
                consumed_at,
                released_at,
                release_reason
              `)
              .in('online_order_id', orderIds)
              .order('created_at', { ascending: true }),
          ])

          if (linesRes.error) throw linesRes.error
          if (reservationsRes.error) throw reservationsRes.error

          const linesByOrder = new Map()
          for (const line of (linesRes.data || [])) {
            const current = linesByOrder.get(line.online_order_id) || []
            current.push(line)
            linesByOrder.set(line.online_order_id, current)
          }

          const reservationsByOrder = new Map()
          for (const reservation of (reservationsRes.data || [])) {
            const current = reservationsByOrder.get(reservation.online_order_id) || []
            current.push(reservation)
            reservationsByOrder.set(reservation.online_order_id, current)
          }

          return {
            success: true,
            data: (orders || []).map((order) => ({
              ...order,
              payment_proof_url: order?.payment_payload?.payment_proof_url || '',
              lines: linesByOrder.get(order.online_order_id) || [],
              reservations: reservationsByOrder.get(order.online_order_id) || [],
            })),
          }
        },
        {
          tenantId,
          ttlMs: 20 * 1000,
          storage: 'session',
          tags: ['online-store', 'online-store-orders'],
          forceRefresh: options.forceRefresh === true,
          shouldCache: (result) => result?.success === true,
        },
      )
    } catch (error) {
      return serviceErrorResult(error, { data: [] })
    }
  }

  async getManualOrders(tenantId, storeId = null, options = {}) {
    return this.getOnlineOrders(tenantId, storeId, {
      ...options,
      paymentMode: 'MANUAL',
    })
  }

  async confirmManualOrder(onlineOrderId, payload = {}) {
    try {
      const { data, error } = await supabase.rpc('fn_confirm_online_manual_order', {
        p_online_order_id: onlineOrderId,
        p_payment_reference: String(payload.payment_reference || '').trim() || null,
        p_payment_note: String(payload.payment_note || '').trim() || null,
      })
      if (error) throw error
      await this.sendOnlineOrderEmail(onlineOrderId, 'approved')
      queryCache.invalidateByTags(['online-store-orders', 'online-store'])
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async rejectManualOrder(onlineOrderId, payload = {}) {
    try {
      const { data, error } = await supabase.rpc('fn_reject_online_manual_order', {
        p_online_order_id: onlineOrderId,
        p_reason: String(payload.reason || '').trim() || null,
      })
      if (error) throw error
      await this.sendOnlineOrderEmail(onlineOrderId, 'rejected')
      queryCache.invalidateByTags(['online-store-orders', 'online-store'])
      return { success: true, data }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async sendOnlineOrderEmail(onlineOrderId, event, options = {}) {
    if (!onlineOrderId) return { success: false, error: 'No encontramos el pedido para notificar.' }

    try {
      const { data, error } = await supabase.functions.invoke(ONLINE_ORDER_EMAIL_EDGE_FUNCTION, {
        body: {
          online_order_id: onlineOrderId,
          event,
          force: options.force === true,
          origin: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return { success: true, data }
    } catch (error) {
      const extractedError = await extractFunctionInvokeError(error)
      return serviceErrorResult(extractedError)
    }
  }

  async getPublicOrderStatus(orderId) {
    try {
      const { data, error } = await supabase.rpc('fn_get_public_order_status', {
        p_order_id: orderId,
      })
      if (error) throw error
      if (data?.error) return { success: false, error: data.error }
      return {
        success: true,
        data: {
          ...data,
          lines: Array.isArray(data.lines) ? data.lines : [],
          payment_link: data?.payment_link || '',
          payment_status_detail: data?.payment_status_detail || '',
          mercado_pago_status: data?.mercado_pago_status || '',
          payment_reference: data?.payment_reference || '',
          expires_at: data?.expires_at || null,
        },
      }
    } catch (error) {
      return serviceErrorResult(error)
    }
  }

  async syncGatewayOrder(orderId, payload = {}) {
    if (!orderId) return { success: false, error: 'No encontramos el pedido a revalidar.' }

    try {
      const { data, error } = await supabase.functions.invoke(MERCADO_PAGO_WEBHOOK_EDGE_FUNCTION, {
        body: {
          external_reference: orderId,
          id: String(payload.payment_id || payload.collection_id || '').trim() || undefined,
          preference_id: String(payload.preference_id || '').trim() || undefined,
          type: 'payment',
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      queryCache.invalidateByTags(['online-store-orders', 'online-store'])
      return { success: true, data }
    } catch (error) {
      const extractedError = await extractFunctionInvokeError(error)
      return serviceErrorResult(extractedError)
    }
  }
}

export { slugify }
export default new OnlineStoreService()
