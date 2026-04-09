import { supabase } from '../lib/supabase';

function normalizeProviderRecord(payload = {}) {
  return {
    provider_name: payload.provider_name || '',
    base_url: String(payload.base_url || '').trim().replace(/\/$/, ''),
    auth_type: payload.auth_type || 'apikey',
    auth_header: payload.auth_header || 'X-API-Key',
    api_key: payload.api_key || '',
    software_id: payload.software_id || '',
    software_pin: payload.software_pin || '',
    environment: payload.environment || 'habilitacion',
    test_set_id: payload.test_set_id || '',
    timeout_seconds: Number(payload.timeout_seconds || 30),
    is_active: payload.is_active !== false,
  };
}

function normalizeResolutionRecord(payload = {}) {
  return {
    resolution_id: payload.resolution_id || null,
    document_type: payload.document_type || 'FE',
    prefix: payload.prefix || '',
    from_number: Number(payload.from_number || 1),
    to_number: Number(payload.to_number || 1000),
    current_number: Number(payload.current_number ?? 0),
    resolution_number: payload.resolution_number || '',
    resolution_date: payload.resolution_date || '',
    valid_from: payload.valid_from || '',
    valid_to: payload.valid_to || '',
    technical_key: payload.technical_key || '',
    is_active: payload.is_active !== false,
  };
}

export function getDefaultFeProviderConfig() {
  return normalizeProviderRecord();
}

export function getDefaultInvoiceResolution() {
  return normalizeResolutionRecord();
}

export async function getProviderConfig(tenantId) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido', data: null };
  try {
    const { data, error } = await supabase
      .from('fe_provider_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) throw error;
    return { success: true, data: data ? normalizeProviderRecord(data) : null };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function saveProviderConfig(tenantId, payload) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido' };
  try {
    const record = {
      tenant_id: tenantId,
      ...normalizeProviderRecord(payload),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('fe_provider_config')
      .upsert(record, { onConflict: 'tenant_id' })
      .select('*')
      .single();

    if (error) throw error;
    return { success: true, data: normalizeProviderRecord(data) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getActiveResolution(tenantId, documentType = 'FE') {
  if (!tenantId) return { success: false, error: 'tenantId es requerido', data: null };
  try {
    const { data, error } = await supabase
      .from('invoice_resolutions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('document_type', documentType)
      .eq('is_active', true)
      .order('resolution_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return { success: true, data: data ? normalizeResolutionRecord(data) : null };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function upsertResolution(tenantId, payload) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido' };
  try {
    const record = {
      tenant_id: tenantId,
      ...normalizeResolutionRecord(payload),
      updated_at: new Date().toISOString(),
    };

    let response;
    if (record.resolution_id) {
      response = await supabase
        .from('invoice_resolutions')
        .update({
          document_type: record.document_type,
          prefix: record.prefix,
          from_number: record.from_number,
          to_number: record.to_number,
          current_number: record.current_number,
          resolution_number: record.resolution_number || null,
          resolution_date: record.resolution_date || null,
          valid_from: record.valid_from || null,
          valid_to: record.valid_to || null,
          technical_key: record.technical_key || null,
          is_active: record.is_active,
          updated_at: record.updated_at,
        })
        .eq('tenant_id', tenantId)
        .eq('resolution_id', record.resolution_id)
        .select('*')
        .single();
    } else {
      response = await supabase
        .from('invoice_resolutions')
        .insert({
          tenant_id: tenantId,
          document_type: record.document_type,
          prefix: record.prefix,
          from_number: record.from_number,
          to_number: record.to_number,
          current_number: record.current_number,
          resolution_number: record.resolution_number || null,
          resolution_date: record.resolution_date || null,
          valid_from: record.valid_from || null,
          valid_to: record.valid_to || null,
          technical_key: record.technical_key || null,
          is_active: record.is_active,
          updated_at: record.updated_at,
        })
        .select('*')
        .single();
    }

    if (response.error) throw response.error;
    return { success: true, data: normalizeResolutionRecord(response.data) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
