import { supabase } from '@/plugins/supabase'

const bucket = 'dataimport'
const MAX_HISTORY = 20
const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || ''
const USE_BACKEND_IMPORT_JOBS = import.meta.env.VITE_USE_BACKEND_IMPORT_JOBS === 'true'

const backendBaseUrl = () => BACKEND_BASE_URL.replace(/\/+$/, '')

async function getBackendAccessToken() {
  const { data } = await supabase.auth.getSession()
  const accessToken = data?.session?.access_token
  if (!accessToken) {
    throw new Error('Sesión requerida para encolar importaciones.')
  }
  return accessToken
}

async function enqueueImportJob(importRecord, jobOptions) {
  if (!USE_BACKEND_IMPORT_JOBS) {
    return { queued: false, job_id: null }
  }

  if (!BACKEND_BASE_URL) {
    throw new Error('VITE_BACKEND_API_URL no configurado para encolar importaciones.')
  }

  const accessToken = await getBackendAccessToken()
  const response = await fetch(`${backendBaseUrl()}/async-jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      tenant_id: importRecord.tenant_id,
      queue: 'import_jobs',
      job_type: jobOptions.jobType,
      payload: {
        import_id: importRecord.import_id,
        import_type: importRecord.import_type,
        file_key: importRecord.file_key,
        file_name: importRecord.file_name,
      },
      dedupe_key: jobOptions.dedupeKey,
      priority: jobOptions.priority,
      max_attempts: 3,
      source: 'web',
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Backend respondió ${response.status} al encolar importación.`)
  }

  return { queued: true, job_id: payload.job_id }
}

export function isBackendImportJobsEnabled() {
  return USE_BACKEND_IMPORT_JOBS
}

export async function uploadBulkImport({ importType, file, tenantId, uploadedBy }) {
  const timestamp = Date.now()
  const key = `${tenantId}/${importType}/${timestamp}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(key, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      metadata: {
        tenant_id: tenantId,
        import_type: importType
      }
    })

  if (uploadError) {
    throw uploadError
  }

  const { data: record, error: insertError } = await supabase
    .from('bulk_imports')
    .insert({
      tenant_id: tenantId,
      import_type: importType,
      file_key: key,
      file_name: file.name,
      uploaded_by: uploadedBy
    })
    .select()
    .single()

  if (insertError) {
    throw insertError
  }

  return record
}

export async function enqueueBulkImportJob(importRecord) {
  return enqueueImportJob(importRecord, {
    jobType: 'bulk_import_process',
    dedupeKey: `bulk-import:${importRecord.import_id}`,
    priority: 50,
  })
}

export async function enqueueBulkImportApplyProducts(importRecord) {
  return enqueueImportJob(importRecord, {
    jobType: 'bulk_import_apply_products',
    dedupeKey: `bulk-import-apply:${importRecord.import_id}`,
    priority: 40,
  })
}

export async function enqueueBulkImportApplyThirdParties(importRecord) {
  return enqueueImportJob(importRecord, {
    jobType: 'bulk_import_apply_third_parties',
    dedupeKey: `bulk-import-apply:${importRecord.import_id}`,
    priority: 40,
  })
}

export async function listBulkImports(tenantId, importType) {
  let query = supabase
    .from('bulk_imports')
    .select('import_id, tenant_id, import_type, file_key, file_name, uploaded_by, status, row_count, processed_count, error_count, summary, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY)

  if (importType) query = query.eq('import_type', importType)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getBulkImportErrors(importId) {
  const { data, error } = await supabase
    .from('bulk_import_errors')
    .select('*')
    .eq('import_id', importId)
    .order('row_number', { ascending: true })

  if (error) throw error
  return data || []
}
