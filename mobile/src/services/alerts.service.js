import { supabase } from '../lib/supabase';

const ALERT_FIELDS = 'alert_id, alert_type, alert_level, reference_id, created_at, updated_at, data';

export async function getOnlineOrderAlerts(tenantId, { limit = 80 } = {}) {
  if (!tenantId) return { success: true, data: [] };
  try {
    const { data, error } = await supabase
      .from('system_alerts')
      .select(ALERT_FIELDS)
      .eq('tenant_id', tenantId)
      .eq('alert_type', 'ONLINE_ORDER')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export function subscribeToAlerts(tenantId, callback) {
  if (!tenantId) return null;
  return supabase
    .channel(`system-alerts:${tenantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'system_alerts',
        filter: `tenant_id=eq.${tenantId}`,
      },
      callback,
    )
    .subscribe();
}

export async function unsubscribeFromAlerts(channel) {
  if (!channel) return;
  await supabase.removeChannel(channel);
}
