import { supabase } from '../lib/supabase';

const ORDERS_SELECT = `
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
  subtotal,
  discount_total,
  tax_total,
  total,
  created_at,
  updated_at
`;

async function dispatchQueuedEmails() {
  try {
    await supabase.functions.invoke('notification-dispatcher', {
      body: { limit: 10 },
    });
  } catch (_error) {
    // El correo no debe bloquear la operacion principal del pedido.
  }
}

export async function getManualOrders(tenantId, { limit = 50 } = {}) {
  if (!tenantId) return { success: true, data: [] };
  try {
    const { data: orders, error: ordersError } = await supabase
      .from('online_orders')
      .select(ORDERS_SELECT)
      .eq('tenant_id', tenantId)
      .eq('payment_mode', 'MANUAL')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) return { success: true, data: [] };

    const orderIds = orders.map((o) => o.online_order_id);

    const [linesRes, reservationsRes] = await Promise.all([
      supabase
        .from('online_order_lines')
        .select(
          'online_order_id, variant_id, sku, product_name, variant_name, quantity, unit_price, tax_rate, tax_amount, line_total',
        )
        .in('online_order_id', orderIds)
        .order('created_at', { ascending: true }),
      supabase
        .from('online_order_reservations')
        .select(
          'online_order_id, variant_id, reserved_qty, status, consumed_at, released_at, release_reason',
        )
        .in('online_order_id', orderIds)
        .order('created_at', { ascending: true }),
    ]);

    if (linesRes.error) throw linesRes.error;
    if (reservationsRes.error) throw reservationsRes.error;

    const linesByOrder = new Map();
    for (const line of linesRes.data || []) {
      const prev = linesByOrder.get(line.online_order_id) || [];
      prev.push(line);
      linesByOrder.set(line.online_order_id, prev);
    }

    const reservationsByOrder = new Map();
    for (const r of reservationsRes.data || []) {
      const prev = reservationsByOrder.get(r.online_order_id) || [];
      prev.push(r);
      reservationsByOrder.set(r.online_order_id, prev);
    }

    return {
      success: true,
      data: orders.map((order) => ({
        ...order,
        payment_proof_url: order?.payment_payload?.payment_proof_url || '',
        lines: linesByOrder.get(order.online_order_id) || [],
        reservations: reservationsByOrder.get(order.online_order_id) || [],
      })),
    };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function confirmManualOrder(onlineOrderId, { payment_reference = null, payment_note = null } = {}) {
  if (!onlineOrderId) return { success: false, error: 'onlineOrderId es requerido' };
  try {
    const { data, error } = await supabase.rpc('fn_confirm_online_manual_order', {
      p_online_order_id: onlineOrderId,
      p_payment_reference: payment_reference || null,
      p_payment_note: payment_note || null,
    });
    if (error) throw error;
    await dispatchQueuedEmails();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function rejectManualOrder(onlineOrderId, { reason = null } = {}) {
  if (!onlineOrderId) return { success: false, error: 'onlineOrderId es requerido' };
  try {
    const { data, error } = await supabase.rpc('fn_reject_online_manual_order', {
      p_online_order_id: onlineOrderId,
      p_reason: reason || null,
    });
    if (error) throw error;
    await dispatchQueuedEmails();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function subscribeToOnlineOrderAlerts(tenantId, callback) {
  if (!tenantId) return null;
  return supabase
    .channel(`online-order-alerts:${tenantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'system_alerts',
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload) => {
        const record = payload?.new || payload?.old;
        if (record?.alert_type === 'ONLINE_ORDER' || !record?.alert_type) {
          callback(payload);
        }
      },
    )
    .subscribe();
}

export async function unsubscribeFromOnlineOrderAlerts(channel) {
  if (!channel) return;
  await supabase.removeChannel(channel);
}
