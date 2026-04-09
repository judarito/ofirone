import { supabase } from '../lib/supabase';

async function refreshStockAlertsBestEffort() {
  try {
    const { error } = await supabase.rpc('fn_refresh_stock_alerts');
    if (error) return;
  } catch {
    // Optional maintenance RPC; ignore when unavailable.
  }
}

export async function createManualAdjustment({
  tenantId,
  locationId,
  variantId,
  quantity,
  unitCost = 0,
  isIncrease = true,
  note = null,
  createdBy,
}) {
  try {
    const safeQuantity = Math.abs(Number(quantity || 0));
    const safeUnitCost = Number(unitCost || 0);

    if (!tenantId || !locationId || !variantId || !createdBy) {
      return { success: false, error: 'Faltan datos para registrar el ajuste.' };
    }
    if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
      return { success: false, error: 'La cantidad debe ser mayor a 0.' };
    }
    if (!Number.isFinite(safeUnitCost) || safeUnitCost < 0) {
      return { success: false, error: 'El costo unitario debe ser mayor o igual a 0.' };
    }

    const { data: moveRow, error: moveError } = await supabase
      .from('inventory_moves')
      .insert({
        tenant_id: tenantId,
        move_type: 'ADJUSTMENT',
        location_id: locationId,
        variant_id: variantId,
        quantity: safeQuantity,
        unit_cost: safeUnitCost,
        source: 'MANUAL',
        source_id: null,
        note: note || null,
        created_by: createdBy,
      })
      .select()
      .single();

    if (moveError) throw moveError;

    const delta = isIncrease ? safeQuantity : -safeQuantity;
    const { error: stockError } = await supabase.rpc('fn_apply_stock_delta', {
      p_tenant: tenantId,
      p_location: locationId,
      p_variant: variantId,
      p_delta: delta,
    });

    if (stockError) throw stockError;

    await refreshStockAlertsBestEffort();

    return { success: true, data: moveRow };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createTransfer({
  tenantId,
  fromLocationId,
  toLocationId,
  variantId,
  quantity,
  unitCost = 0,
  note = null,
  createdBy,
}) {
  try {
    const safeQuantity = Number(quantity || 0);
    const safeUnitCost = Number(unitCost || 0);

    if (!tenantId || !fromLocationId || !toLocationId || !variantId || !createdBy) {
      return { success: false, error: 'Faltan datos para registrar el traslado.' };
    }
    if (String(fromLocationId) === String(toLocationId)) {
      return { success: false, error: 'La sede destino debe ser diferente a la sede origen.' };
    }
    if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
      return { success: false, error: 'La cantidad debe ser mayor a 0.' };
    }
    if (!Number.isFinite(safeUnitCost) || safeUnitCost < 0) {
      return { success: false, error: 'El costo unitario debe ser mayor o igual a 0.' };
    }

    const { data, error } = await supabase.rpc('sp_create_transfer_request', {
      p_tenant: tenantId,
      p_from_location: fromLocationId,
      p_to_location: toLocationId,
      p_variant: variantId,
      p_quantity: safeQuantity,
      p_unit_cost: safeUnitCost,
      p_created_by: createdBy,
      p_note: note || null,
    });

    if (error) throw error;

    await refreshStockAlertsBestEffort();

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPendingTransfers({
  tenantId,
  toLocationId = null,
} = {}) {
  try {
    if (!tenantId) {
      return { success: false, error: 'Tenant invalido para consultar traslados.', data: [] };
    }

    let query = supabase
      .from('transfer_requests')
      .select(`
        transfer_id,
        tenant_id,
        from_location_id,
        to_location_id,
        variant_id,
        quantity,
        unit_cost,
        status,
        note,
        created_at,
        from_location:from_location_id(name),
        to_location:to_location_id(name),
        variant:variant_id(
          sku,
          variant_name,
          product:product_id(name)
        ),
        created_by_user:created_by(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('status', 'IN_TRANSIT')
      .order('created_at', { ascending: false })
      .limit(200);

    if (toLocationId) {
      query = query.eq('to_location_id', toLocationId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return {
      success: true,
      data: (data || []).map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        unit_cost: Number(item.unit_cost || 0),
      })),
    };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function receiveTransfer({
  tenantId,
  transferId,
  receivedBy,
  note = null,
}) {
  try {
    if (!tenantId || !transferId || !receivedBy) {
      return { success: false, error: 'Faltan datos para recibir el traslado.' };
    }

    const { data, error } = await supabase.rpc('sp_receive_transfer_request', {
      p_tenant: tenantId,
      p_transfer_id: transferId,
      p_received_by: receivedBy,
      p_note: note || null,
    });

    if (error) throw error;

    await refreshStockAlertsBestEffort();

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
