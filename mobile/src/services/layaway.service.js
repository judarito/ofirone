import { supabase } from '../lib/supabase';

async function refreshLayawayOperationalState(tenantId) {
  if (!tenantId) return;

  const { error } = await supabase.rpc('fn_expire_due_layaways', {
    p_tenant: tenantId,
  });

  if (error) {
    console.warn('No se pudo refrescar el estado operativo de plan separe:', error.message);
  }
}

export async function getLayawayContracts(tenantId, page = 1, pageSize = 20, status = null) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: [], total: 0 };
  }

  try {
    await refreshLayawayOperationalState(tenantId);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('vw_layaway_summary')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw error;

    return { success: true, data: data || [], total: count || 0 };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function getLayawayDetail(tenantId, layawayId) {
  if (!tenantId || !layawayId) {
    return { success: false, error: 'tenantId y layawayId son requeridos', data: null };
  }

  try {
    await refreshLayawayOperationalState(tenantId);

    const { data: contract, error: contractError } = await supabase
      .from('layaway_contracts')
      .select(
        `
          *,
          location:location_id(location_id, name),
          customer:customer_id(customer_id, full_name, document, phone, email),
          created_by_user:created_by(user_id, full_name),
          sale:sale_id(sale_id, sale_number)
        `,
      )
      .eq('tenant_id', tenantId)
      .eq('layaway_id', layawayId)
      .single();

    if (contractError) throw contractError;

    const { data: items, error: itemsError } = await supabase
      .from('layaway_items')
      .select(
        `
          *,
          variant:variant_id(
            variant_id,
            sku,
            variant_name,
            price,
            product:product_id(product_id, name)
          )
        `,
      )
      .eq('tenant_id', tenantId)
      .eq('layaway_id', layawayId);

    if (itemsError) throw itemsError;

    const { data: payments, error: paymentsError } = await supabase
      .from('vw_layaway_payments')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('layaway_id', layawayId)
      .order('paid_at', { ascending: false });

    if (paymentsError) throw paymentsError;

    const { data: installments, error: installmentsError } = await supabase
      .from('layaway_installments')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('layaway_id', layawayId)
      .order('due_date', { ascending: true });

    if (installmentsError) throw installmentsError;

    return {
      success: true,
      data: {
        ...contract,
        items: items || [],
        payments: payments || [],
        installments: installments || [],
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function createLayaway(tenantId, contractData) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: null };
  }

  try {
    const { data, error } = await supabase.rpc('sp_create_layaway', {
      p_tenant: tenantId,
      p_location: contractData.location_id,
      p_customer: contractData.customer_id,
      p_created_by: contractData.created_by,
      p_items: contractData.items,
      p_due_date: contractData.due_date || null,
      p_note: contractData.note || null,
      p_initial_payment: contractData.initial_payment || null,
      p_installments: contractData.installments || null,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function addLayawayPayment(tenantId, layawayId, paymentData) {
  try {
    await refreshLayawayOperationalState(tenantId);

    const { error } = await supabase.rpc('sp_add_layaway_payment', {
      p_tenant: tenantId,
      p_layaway: layawayId,
      p_payment_method_code: paymentData.payment_method_code,
      p_amount: paymentData.amount,
      p_paid_by: paymentData.paid_by,
      p_cash_session: paymentData.cash_session_id || null,
      p_reference: paymentData.reference || null,
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function completeLayaway(tenantId, layawayId, soldBy, note = null) {
  try {
    await refreshLayawayOperationalState(tenantId);

    const { data, error } = await supabase.rpc('sp_complete_layaway_to_sale', {
      p_tenant: tenantId,
      p_layaway: layawayId,
      p_sold_by: soldBy,
      p_note: note,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function cancelLayaway(tenantId, layawayId, cancelledBy, status = 'CANCELLED', note = null) {
  try {
    const { error } = await supabase.rpc('sp_cancel_layaway', {
      p_tenant: tenantId,
      p_layaway: layawayId,
      p_cancelled_by: cancelledBy,
      p_status: status,
      p_note: note,
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getStockAvailable(tenantId, locationId, variantId) {
  if (!tenantId || !locationId || !variantId) {
    return { success: false, error: 'tenantId, locationId y variantId son requeridos', data: null };
  }

  try {
    const { data, error } = await supabase
      .from('vw_stock_available')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId)
      .eq('variant_id', variantId)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}
