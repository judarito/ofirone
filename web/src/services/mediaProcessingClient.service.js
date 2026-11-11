import supabaseService from './supabase.service'
import { MEDIA_JOB_TYPES } from '../../../shared/media/mediaProcessingContract'

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || ''
const USE_BACKEND_MEDIA_JOBS = import.meta.env.VITE_USE_BACKEND_MEDIA_JOBS === 'true'
const MEDIA_BUCKET = import.meta.env.VITE_MEDIA_PROCESSING_BUCKET || 'dataimport'

function backendBaseUrl() {
  return BACKEND_BASE_URL.replace(/\/+$/, '')
}

function safeFileName(name = 'media-upload') {
  return String(name || 'media-upload')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'media-upload'
}

async function getAccessToken() {
  const session = await supabaseService.getValidSession({ redirectOnFail: false, minValiditySeconds: 30 })
  const accessToken = session?.access_token
  if (!accessToken) {
    throw new Error('Sesión requerida para encolar procesamiento de media.')
  }
  return accessToken
}

async function uploadMediaFile({ tenantId, type, file }) {
  const timestamp = Date.now()
  const fileKey = `${tenantId}/media/${type}/${timestamp}-${safeFileName(file?.name)}`

  const { error } = await supabaseService.client.storage
    .from(MEDIA_BUCKET)
    .upload(fileKey, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file?.type || 'application/octet-stream',
      metadata: {
        tenant_id: tenantId,
        media_job_type: type,
      },
    })

  if (error) throw error
  return fileKey
}

export function isBackendMediaJobsEnabled() {
  return USE_BACKEND_MEDIA_JOBS
}

export async function enqueueMediaProcessingJob({
  tenantId,
  type,
  file,
  context = {},
  priority = 60,
} = {}) {
  if (!USE_BACKEND_MEDIA_JOBS) {
    return { queued: false, job_id: null }
  }

  if (!tenantId) throw new Error('tenantId es requerido.')
  if (!(file instanceof Blob)) throw new Error('Debes seleccionar una imagen válida.')
  if (!BACKEND_BASE_URL) throw new Error('VITE_BACKEND_API_URL no configurado para media jobs.')

  const fileKey = await uploadMediaFile({ tenantId, type, file })
  const accessToken = await getAccessToken()
  const response = await fetch(`${backendBaseUrl()}/media-processing/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      type,
      bucket: MEDIA_BUCKET,
      file_key: fileKey,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size || null,
      context,
      priority,
      source: 'web',
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Backend respondió ${response.status} al encolar media job.`)
  }

  return { queued: true, job_id: payload.job_id, file_key: fileKey, bucket: MEDIA_BUCKET }
}

export function enqueuePurchaseInvoicePhotoJob({ tenantId, file, context = {} } = {}) {
  return enqueueMediaProcessingJob({
    tenantId,
    type: MEDIA_JOB_TYPES.PURCHASE_INVOICE_PHOTO,
    file,
    context,
    priority: 45,
  })
}

export function enqueueProductCatalogPhotoJob({ tenantId, file, context = {} } = {}) {
  return enqueueMediaProcessingJob({
    tenantId,
    type: MEDIA_JOB_TYPES.PRODUCT_CATALOG_PHOTO,
    file,
    context,
    priority: 45,
  })
}
