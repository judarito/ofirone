import supabaseService from './supabase.service'
import { normalizeInvoiceAnalysisPayload } from '@/utils/purchaseInvoiceOcr'
import tenantBillingService from './tenantBilling.service'
import { BILLING_FEATURE_CODES } from '../../../shared/utils/billingAccess'

const OCR_EDGE_FUNCTION =
  import.meta.env.VITE_DEEPSEEK_OCR_EDGE_FUNCTION || 'deepseek-ocr-proxy'
const TEXT_EDGE_FUNCTION =
  import.meta.env.VITE_DEEPSEEK_TEXT_EDGE_FUNCTION || 'deepseek-proxy'
const DEFAULT_TEXT_MODEL =
  import.meta.env.VITE_DEEPSEEK_TEXT_MODEL || 'deepseek-chat'
const OCR_MAX_BYTES = 980 * 1024
const OCR_WIDTHS = [1600, 1400, 1280, 1080]
const OCR_QUALITIES = [0.72, 0.58, 0.46, 0.34]

function parseAiJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (_nestedError) {
      return null
    }
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
  } catch (_nestedError) {
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
            sizeBytes: blob.size,
          },
        }
      }
    }
  }

  return {
    success: false,
    error: 'No se pudo optimizar la imagen por debajo de 1MB para OCR. Toma la foto mas cerca y con menos fondo.',
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = () => reject(new Error('No se pudo leer la imagen para OCR.'))
    reader.readAsDataURL(blob)
  })
}

export async function analyzeInvoiceWithText({ tenantId, ocrText } = {}) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' }
  }

  const billingAccess = await tenantBillingService.ensureFeatureAccess(
    tenantId,
    BILLING_FEATURE_CODES.OCR_IMPORT,
    { featureLabel: 'OCR de facturas' },
  )
  if (!billingAccess.success) {
    return { success: false, error: billingAccess.error }
  }
  const extractedText = String(ocrText || '').trim()
  if (!extractedText) {
    return { success: false, error: 'No hay texto OCR para analizar.' }
  }

  const clippedText = extractedText.slice(0, 12000)
  const systemPrompt =
    'Eres un agente estructurador de facturas para POS. A partir de texto OCR, extrae productos y cantidades con alta precision. Responde SOLO JSON valido.'

  const userPrompt = `Analiza este texto OCR de una factura y responde JSON con:
{
  "invoice": {
    "vendor_name": "string|null",
    "invoice_number": "string|null",
    "date": "YYYY-MM-DD|null",
    "currency": "string|null",
    "subtotal": number|null,
    "tax": number|null,
    "total": number|null
  },
  "line_items": [
    {
      "raw_name": "string",
      "sku": "string|null",
      "quantity": number,
      "unit_price": number|null,
      "line_total": number|null
    }
  ]
}

Reglas:
- quantity debe ser > 0 (si no existe, usa 1).
- Si no puedes inferir un campo, usa null.
- No agregues texto fuera del JSON.
- No inventes lineas o precios no presentes.
- Conserva atributos de variante en raw_name (ej: talla, color, presentacion, capacidad).

Texto OCR:
"""${clippedText}"""`

  const { data, error } = await supabaseService.client.functions.invoke(TEXT_EDGE_FUNCTION, {
    body: {
      model: DEFAULT_TEXT_MODEL,
      temperature: 0.1,
      max_tokens: 2400,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  })

  if (error) {
    const details = await extractInvokeError(error)
    return {
      success: false,
      error: `Error invocando Edge Function "${TEXT_EDGE_FUNCTION}": ${details}.`,
    }
  }

  const parsed = parseAiJson(data?.content)
  if (!parsed || !Array.isArray(parsed.line_items)) {
    return { success: false, error: 'No se pudo parsear la respuesta de IA para la factura.' }
  }

  return {
    success: true,
    data: normalizeInvoiceAnalysisPayload({
      invoice: parsed.invoice || {},
      line_items: parsed.line_items,
      raw: parsed,
      model: data?.model || DEFAULT_TEXT_MODEL,
    }),
  }
}

export async function analyzeInvoiceFile({ tenantId, file } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' }
  const billingAccess = await tenantBillingService.ensureFeatureAccess(
    tenantId,
    BILLING_FEATURE_CODES.OCR_IMPORT,
    { featureLabel: 'OCR de facturas' },
  )
  if (!billingAccess.success) return { success: false, error: billingAccess.error }
  if (!(file instanceof Blob)) return { success: false, error: 'Debes seleccionar una imagen valida.' }

  try {
    const optimized = await optimizeImageForOcr(file)
    if (!optimized.success) return optimized

    const imageBase64 = await blobToBase64(optimized.data.blob)
  const prompt = `Analiza el texto OCR de una factura y responde JSON con:
{
  "invoice": {
    "vendor_name": "string|null",
    "invoice_number": "string|null",
    "date": "YYYY-MM-DD|null",
    "currency": "string|null",
    "subtotal": number|null,
    "tax": number|null,
    "total": number|null
  },
  "line_items": [
    {
      "raw_name": "string",
      "sku": "string|null",
      "quantity": number,
      "unit_price": number|null,
      "line_total": number|null
    }
  ]
}

Reglas:
- quantity > 0 (si no existe, usa 1).
- Si no puedes inferir un campo, usa null.
- No agregues texto fuera del JSON.
- No inventes lineas o precios no presentes.
- Conserva atributos de variante en raw_name (ej: talla, color, presentacion, capacidad).`

    const { data, error } = await supabaseService.client.functions.invoke(OCR_EDGE_FUNCTION, {
      body: {
        model: DEFAULT_TEXT_MODEL,
        temperature: 0.1,
        max_tokens: 2400,
        image: imageBase64,
        mime_type: optimized.data.mimeType || 'image/jpeg',
        prompt,
      },
    })

    if (error) {
      const details = await extractInvokeError(error)
      const sizeHint = String(details || '').toLowerCase().includes('maximum size limit 1024 kb')
        ? ' OCR.Space (plan actual) solo acepta imagenes <= 1MB; intenta una toma mas cercana o con menos fondo.'
        : ''
      return {
        success: false,
        error: `Error invocando Edge Function "${OCR_EDGE_FUNCTION}": ${details}.${sizeHint}`,
      }
    }

    const parsed = parseAiJson(data?.content)
    if (!parsed || !Array.isArray(parsed.line_items)) {
      return { success: false, error: 'No se pudo parsear la respuesta OCR+IA para la factura.' }
    }

    return {
      success: true,
      data: normalizeInvoiceAnalysisPayload({
        invoice: parsed.invoice || {},
        line_items: parsed.line_items,
        ocr_text: data?.ocr_text || null,
        raw: parsed,
        model: data?.model || DEFAULT_TEXT_MODEL,
      }),
    }
  } catch (error) {
    return { success: false, error: error?.message || 'No se pudo procesar la imagen para OCR.' }
  }
}
