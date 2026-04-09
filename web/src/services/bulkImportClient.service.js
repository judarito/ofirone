import { supabase } from '@/plugins/supabase'

const bucket = 'dataimport'
const MAX_HISTORY = 20

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
