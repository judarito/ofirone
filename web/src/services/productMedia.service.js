import supabaseService from './supabase.service'
import {
  buildProductPhotoStoragePath,
  normalizeProductPhotoAiData,
} from '@/utils/productMediaHelpers'

const PRODUCT_MEDIA_BUCKET = 'productmedia'
const PRODUCT_MEDIA_AI_EDGE_FUNCTION =
  import.meta.env.VITE_PRODUCT_PHOTO_ANALYZER_EDGE_FUNCTION || 'product-photo-analyzer'

export const MAX_PRODUCT_PHOTOS = 5
export const PRODUCT_PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const PRODUCT_PHOTO_SIGNED_URL_TTL = 60 * 60 * 24 * 7

const UPLOAD_WIDTHS = [1600, 1400, 1280, 1080]
const UPLOAD_QUALITIES = [0.82, 0.72, 0.62, 0.52]
const AI_WIDTHS = [1400, 1200, 1000, 800]
const AI_QUALITIES = [0.35, 0.24, 0.16, 0.12]
const AI_MAX_BYTES = 980 * 1024

function randomToken(length = 8) {
  return Math.random().toString(36).slice(2, 2 + length)
}

function isMissingRelationError(error) {
  return String(error?.message || '').toLowerCase().includes('product_media')
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

async function buildOptimizedImage(file, widths, qualities, maxBytes) {
  if (!file) {
    return { success: false, error: 'No se recibió ningún archivo para procesar.' }
  }

  const image = await loadImageElement(file)
  const originalWidth = Number(image.naturalWidth || image.width || 0)
  const originalHeight = Number(image.naturalHeight || image.height || 0)

  for (const targetWidth of widths) {
    const safeWidth = Math.min(originalWidth || targetWidth, targetWidth)
    const scale = originalWidth > 0 ? safeWidth / originalWidth : 1
    const safeHeight = Math.max(1, Math.round((originalHeight || safeWidth) * scale))

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(safeWidth))
    canvas.height = safeHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return { success: false, error: 'El navegador no permitió preparar la imagen para subir.' }
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, quality)
      if (blob && blob.size > 0 && blob.size <= maxBytes) {
        return {
          success: true,
          data: {
            blob,
            mimeType: 'image/jpeg',
            sizeBytes: blob.size,
            width: canvas.width,
            height: canvas.height,
          },
        }
      }
    }
  }

  return {
    success: false,
    error: `No se pudo optimizar la imagen por debajo de ${Math.round(maxBytes / 1024 / 1024)}MB.`,
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

async function signMediaRows(rows, expiresIn = PRODUCT_PHOTO_SIGNED_URL_TTL) {
  const source = Array.isArray(rows) ? rows : []
  if (!source.length) return []

  return Promise.all(
    source.map(async (row) => {
      const { data: signedData, error } = await supabaseService.client
        .storage
        .from(PRODUCT_MEDIA_BUCKET)
        .createSignedUrl(row.storage_path, expiresIn)

      return {
        ...row,
        signed_url: error ? null : signedData?.signedUrl || null,
      }
    }),
  )
}

export async function attachProductMediaSummary(tenantId, products = [], expiresIn = PRODUCT_PHOTO_SIGNED_URL_TTL) {
  const source = Array.isArray(products) ? products : []
  if (!tenantId || !source.length) return source

  const productIds = source.map((item) => item.product_id).filter(Boolean)
  if (!productIds.length) return source

  const { data: mediaRows, error } = await supabaseService.client
    .from('product_media')
    .select('media_id, product_id, storage_path, is_cover, sort_order, created_at')
    .eq('tenant_id', tenantId)
    .in('product_id', productIds)
    .order('is_cover', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    if (isMissingRelationError(error)) {
      return source.map((item) => ({
        ...item,
        media_count: 0,
        cover_media_id: null,
        cover_image_url: null,
      }))
    }
    throw error
  }

  const grouped = new Map()
  for (const row of mediaRows || []) {
    const current = grouped.get(row.product_id) || []
    current.push(row)
    grouped.set(row.product_id, current)
  }

  const coverRows = source
    .map((item) => (grouped.get(item.product_id) || [])[0] || null)
    .filter(Boolean)

  const signedPairs = await Promise.all(
    coverRows.map(async (row) => {
      const { data: signedData, error: signError } = await supabaseService.client
        .storage
        .from(PRODUCT_MEDIA_BUCKET)
        .createSignedUrl(row.storage_path, expiresIn)

      return [row.media_id, signError ? null : signedData?.signedUrl || null]
    }),
  )

  const signedMap = new Map(signedPairs)

  return source.map((item) => {
    const rows = grouped.get(item.product_id) || []
    const cover = rows[0] || null
    return {
      ...item,
      media_count: rows.length,
      cover_media_id: cover?.media_id || null,
      cover_image_url: cover ? signedMap.get(cover.media_id) || null : null,
    }
  })
}

class ProductMediaService {
  async listProductMedia({ tenantId, productId, signedUrlExpiresIn = PRODUCT_PHOTO_SIGNED_URL_TTL } = {}) {
    if (!tenantId) return { success: false, error: 'tenantId es requerido.', data: [] }
    if (!productId) return { success: false, error: 'productId es requerido.', data: [] }

    try {
      const { data, error } = await supabaseService.client
        .from('product_media')
        .select(`
          media_id,
          tenant_id,
          product_id,
          variant_id,
          storage_path,
          mime_type,
          size_bytes,
          width,
          height,
          sort_order,
          is_cover,
          ai_status,
          ai_summary,
          ai_detected_name,
          ai_detected_brand,
          ai_detected_category,
          ai_suggested_description,
          ai_labels,
          ai_warnings,
          created_at,
          updated_at
        `)
        .eq('tenant_id', tenantId)
        .eq('product_id', productId)
        .order('is_cover', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) {
        if (isMissingRelationError(error)) {
          return { success: true, data: [] }
        }
        throw error
      }

      const signedRows = await signMediaRows(data || [], signedUrlExpiresIn)
      return { success: true, data: signedRows }
    } catch (error) {
      return { success: false, error: error.message, data: [] }
    }
  }

  async uploadProductPhoto({ tenantId, productId, file, currentCount = 0, analyzeWithAi = true } = {}) {
    if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
    if (!productId) return { success: false, error: 'productId es requerido.' }
    if (!(file instanceof Blob)) return { success: false, error: 'Debes seleccionar una imagen válida.' }
    if (Number(currentCount || 0) >= MAX_PRODUCT_PHOTOS) {
      return { success: false, error: `Máximo ${MAX_PRODUCT_PHOTOS} fotos por producto.` }
    }

    const optimizedForUpload = await buildOptimizedImage(file, UPLOAD_WIDTHS, UPLOAD_QUALITIES, PRODUCT_PHOTO_MAX_BYTES)
    if (!optimizedForUpload.success) return optimizedForUpload

    const uploadData = optimizedForUpload.data
    const storagePath = buildProductPhotoStoragePath({
      tenantId,
      productId,
      token: randomToken(10),
      extension: 'jpg',
    })
    let uploadedToStorage = false

    try {
      const { error: uploadError } = await supabaseService.client
        .storage
        .from(PRODUCT_MEDIA_BUCKET)
        .upload(storagePath, uploadData.blob, {
          contentType: uploadData.mimeType,
          upsert: false,
        })

      if (uploadError) throw uploadError
      uploadedToStorage = true

      const { data: inserted, error: insertError } = await supabaseService.client
        .from('product_media')
        .insert({
          tenant_id: tenantId,
          product_id: productId,
          storage_path: storagePath,
          mime_type: uploadData.mimeType,
          size_bytes: uploadData.sizeBytes,
          width: uploadData.width,
          height: uploadData.height,
          sort_order: Number(currentCount || 0),
          is_cover: Number(currentCount || 0) === 0,
          ai_status: analyzeWithAi ? 'PROCESSING' : 'NOT_ANALYZED',
        })
        .select(`
          media_id,
          tenant_id,
          product_id,
          variant_id,
          storage_path,
          mime_type,
          size_bytes,
          width,
          height,
          sort_order,
          is_cover,
          ai_status,
          ai_summary,
          ai_detected_name,
          ai_detected_brand,
          ai_detected_category,
          ai_suggested_description,
          ai_labels,
          ai_warnings,
          created_at,
          updated_at
        `)
        .single()

      if (insertError) throw insertError

      let aiResult = null
      let finalRecord = inserted

      if (analyzeWithAi) {
        const optimizedForAi = await buildOptimizedImage(file, AI_WIDTHS, AI_QUALITIES, AI_MAX_BYTES)
        if (optimizedForAi.success) {
          const base64Image = await blobToBase64(optimizedForAi.data.blob)
          const { data, error } = await supabaseService.client.functions.invoke(PRODUCT_MEDIA_AI_EDGE_FUNCTION, {
            body: {
              image: base64Image,
              mime_type: optimizedForAi.data.mimeType || 'image/jpeg',
              model: import.meta.env.VITE_DEEPSEEK_TEXT_MODEL || 'deepseek-chat',
            },
          })

          if (error) {
            const details = await extractInvokeError(error)
            const failWarnings = [`No se pudo analizar la foto con IA: ${details}`]
            const { data: updated } = await supabaseService.client
              .from('product_media')
              .update({
                ai_status: 'FAILED',
                ai_summary: null,
                ai_detected_name: null,
                ai_detected_brand: null,
                ai_detected_category: null,
                ai_suggested_description: null,
                ai_labels: [],
                ai_warnings: failWarnings,
              })
              .eq('tenant_id', tenantId)
              .eq('media_id', inserted.media_id)
              .select(`
                media_id,
                tenant_id,
                product_id,
                variant_id,
                storage_path,
                mime_type,
                size_bytes,
                width,
                height,
                sort_order,
                is_cover,
                ai_status,
                ai_summary,
                ai_detected_name,
                ai_detected_brand,
                ai_detected_category,
                ai_suggested_description,
                ai_labels,
                ai_warnings,
                created_at,
                updated_at
              `)
              .single()

            finalRecord = updated || { ...inserted, ai_status: 'FAILED', ai_warnings: failWarnings }
          } else {
            aiResult = data?.data || null
            const normalizedAi = normalizeProductPhotoAiData(aiResult)
            const { data: updated, error: updateAiError } = await supabaseService.client
              .from('product_media')
              .update(normalizedAi)
              .eq('tenant_id', tenantId)
              .eq('media_id', inserted.media_id)
              .select(`
                media_id,
                tenant_id,
                product_id,
                variant_id,
                storage_path,
                mime_type,
                size_bytes,
                width,
                height,
                sort_order,
                is_cover,
                ai_status,
                ai_summary,
                ai_detected_name,
                ai_detected_brand,
                ai_detected_category,
                ai_suggested_description,
                ai_labels,
                ai_warnings,
                created_at,
                updated_at
              `)
              .single()

            if (!updateAiError && updated) {
              finalRecord = updated
            }
          }
        } else {
          const failWarnings = [optimizedForAi.error || 'No se pudo preparar la foto para IA.']
          const { data: updated } = await supabaseService.client
            .from('product_media')
            .update({
              ai_status: 'FAILED',
              ai_summary: null,
              ai_detected_name: null,
              ai_detected_brand: null,
              ai_detected_category: null,
              ai_suggested_description: null,
              ai_labels: [],
              ai_warnings: failWarnings,
            })
            .eq('tenant_id', tenantId)
            .eq('media_id', inserted.media_id)
            .select(`
              media_id,
              tenant_id,
              product_id,
              variant_id,
              storage_path,
              mime_type,
              size_bytes,
              width,
              height,
              sort_order,
              is_cover,
              ai_status,
              ai_summary,
              ai_detected_name,
              ai_detected_brand,
              ai_detected_category,
              ai_suggested_description,
              ai_labels,
              ai_warnings,
              created_at,
              updated_at
            `)
            .single()

          finalRecord = updated || { ...inserted, ai_status: 'FAILED', ai_warnings: failWarnings }
        }
      }

      const signedRows = await signMediaRows([finalRecord])
      return { success: true, data: signedRows[0] || finalRecord, ai: aiResult }
    } catch (error) {
      if (uploadedToStorage) {
        await supabaseService.client.storage.from(PRODUCT_MEDIA_BUCKET).remove([storagePath]).catch(() => null)
      }
      return { success: false, error: error.message }
    }
  }

  async setProductCover({ tenantId, productId, mediaId } = {}) {
    if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
    if (!productId) return { success: false, error: 'productId es requerido.' }
    if (!mediaId) return { success: false, error: 'mediaId es requerido.' }

    try {
      const { data, error } = await supabaseService.client
        .from('product_media')
        .update({ is_cover: true })
        .eq('tenant_id', tenantId)
        .eq('product_id', productId)
        .eq('media_id', mediaId)
        .select(`
          media_id,
          tenant_id,
          product_id,
          variant_id,
          storage_path,
          mime_type,
          size_bytes,
          width,
          height,
          sort_order,
          is_cover,
          ai_status,
          ai_summary,
          ai_detected_name,
          ai_detected_brand,
          ai_detected_category,
          ai_suggested_description,
          ai_labels,
          ai_warnings,
          created_at,
          updated_at
        `)
        .single()

      if (error) throw error
      const signedRows = await signMediaRows([data])
      return { success: true, data: signedRows[0] || data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async deleteProductPhoto({ tenantId, mediaId } = {}) {
    if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
    if (!mediaId) return { success: false, error: 'mediaId es requerido.' }

    try {
      const { data: existing, error: fetchError } = await supabaseService.client
        .from('product_media')
        .select('media_id, tenant_id, product_id, storage_path')
        .eq('tenant_id', tenantId)
        .eq('media_id', mediaId)
        .single()

      if (fetchError) throw fetchError

      const { error: deleteRowError } = await supabaseService.client
        .from('product_media')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('media_id', mediaId)

      if (deleteRowError) throw deleteRowError

      let warning = null
      if (existing?.storage_path) {
        const { error: storageError } = await supabaseService.client
          .storage
          .from(PRODUCT_MEDIA_BUCKET)
          .remove([existing.storage_path])
        if (storageError) {
          warning = `La metadata fue eliminada pero no se pudo borrar el archivo físico: ${storageError.message}`
        }
      }

      return { success: true, data: existing, warning }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}

export default new ProductMediaService()
