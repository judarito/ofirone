import { supabase } from '../lib/supabase';
import { ensureTenantBillingFeature } from './tenantBilling.service';
import { BILLING_FEATURE_CODES } from '../../../shared/utils/billingAccess';

const OPS_RAG_EDGE_FUNCTION =
  process.env.EXPO_PUBLIC_OPS_RAG_EDGE_FUNCTION || 'ops-rag-agent';

async function extractInvokeError(error) {
  const fragments = [];
  if (error?.message) fragments.push(String(error.message));

  const context = error?.context;
  if (!context) return fragments.join(' | ') || 'Error desconocido';

  try {
    const response = typeof context.clone === 'function' ? context.clone() : context;
    if (response?.status) fragments.push(`HTTP ${response.status}`);

    let bodyJson = null;
    if (typeof response?.json === 'function') {
      bodyJson = await response.json().catch(() => null);
    }

    if (bodyJson?.error) fragments.push(String(bodyJson.error));
    if (bodyJson?.details) fragments.push(String(bodyJson.details));

    if (!bodyJson && typeof response?.text === 'function') {
      const bodyText = await response.text().catch(() => '');
      if (bodyText?.trim()) fragments.push(bodyText.trim().slice(0, 280));
    }
  } catch (_e) {
    // no-op
  }

  const unique = Array.from(new Set(fragments.filter(Boolean)));
  return unique.join(' | ') || 'Error desconocido';
}

export async function askOpsRagAgent({
  tenantId,
  query,
  domains = [],
  fromDate = null,
  toDate = null,
  locationId = null,
  locationName = null,
  includeDebug = false,
  maxItemsPerBlock = 5,
  useCache = true,
} = {}) {
  const text = String(query || '').trim();
  if (!text) {
    return { success: false, error: 'query es requerido', data: null };
  }

  const billingAccess = await ensureTenantBillingFeature(tenantId, BILLING_FEATURE_CODES.AI_ASSISTANT, {
    featureLabel: 'Centro IA',
  });
  if (!billingAccess.success) {
    return { success: false, error: billingAccess.error, data: null };
  }

  const body = {
    tenant_id: tenantId || null,
    query: text,
    domains: Array.isArray(domains) ? domains : [],
    from_date: fromDate || null,
    to_date: toDate || null,
    location_id: locationId || null,
    location_name: locationName || null,
    include_debug: includeDebug === true,
    max_items_per_block: Number(maxItemsPerBlock || 5),
    use_cache: useCache !== false,
  };

  const { data, error } = await supabase.functions.invoke(OPS_RAG_EDGE_FUNCTION, {
    body,
  });

  if (error) {
    const details = await extractInvokeError(error);
    return {
      success: false,
      error: `Error invocando Edge Function "${OPS_RAG_EDGE_FUNCTION}": ${details}.`,
      data: null,
    };
  }

  if (!data?.success || !data?.data) {
    return {
      success: false,
      error: data?.error || data?.details || 'La Edge Function no devolvió un payload válido.',
      data: null,
    };
  }

  return {
    success: true,
    data: data.data,
  };
}
