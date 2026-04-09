import { supabase } from '../lib/supabase';
import { getPageCache, getLatestPageCache, savePageCache, getSimpleCache, saveSimpleCache } from './offlineCache.service';

const LOCATIONS_CACHE_KEY = (tenantId) => `locations:${tenantId}`;

export async function listLocations(tenantId, { offlineMode = false } = {}) {
  const cacheKey = LOCATIONS_CACHE_KEY(tenantId);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return { success: true, data: cached?.value || [], source: 'cache' };
  }

  try {
    const { data, error } = await supabase
      .from('locations')
      .select('location_id,name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    const list = data || [];
    await saveSimpleCache(cacheKey, list);
    return { success: true, data: list };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value?.length) {
      return { success: true, data: cached.value, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [] };
  }
}

const STOCK_BALANCES_NS = 'inventory-stock';

function filterByComponent(data, isComponent) {
  return (data || []).filter((item) => {
    const effectiveIsComponent =
      item.variant?.is_component !== null && item.variant?.is_component !== undefined
        ? item.variant?.is_component
        : item.variant?.product?.is_component || false;
    return Boolean(effectiveIsComponent) === Boolean(isComponent);
  });
}

export async function listStockBalances({
  tenantId,
  locationId = null,
  isComponent = false,
  limit = 20,
  offset = 0,
  offlineMode = false,
} = {}) {
  const page = Math.floor(offset / limit) + 1;
  const filters = { locationId: locationId || '', isComponent: Boolean(isComponent) };

  if (offlineMode) {
    const cached = await getPageCache({ namespace: STOCK_BALANCES_NS, tenantId, page, pageSize: limit, filters });
    return {
      success: true,
      data: cached?.items || [],
      total: cached?.total || 0,
      source: 'cache',
    };
  }

  try {
    let query = supabase
      .from('stock_balances')
      .select(
        `
          tenant_id,
          location_id,
          variant_id,
          on_hand,
          reserved,
          updated_at,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            cost,
            min_stock,
            is_component,
            product:product_id(name,is_component)
          )
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = filterByComponent(data, isComponent);

    await savePageCache({
      namespace: STOCK_BALANCES_NS,
      tenantId,
      page,
      pageSize: limit,
      filters,
      items: rows,
      total: Number(count || 0),
    });

    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    const cached = await getPageCache({ namespace: STOCK_BALANCES_NS, tenantId, page, pageSize: limit, filters });
    if (cached?.items?.length) {
      return { success: true, data: cached.items, total: cached.total || 0, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listInventoryMoves({
  tenantId,
  locationId = null,
  moveType = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('inventory_moves')
      .select(
        `
          inventory_move_id,
          tenant_id,
          move_type,
          location_id,
          to_location_id,
          variant_id,
          quantity,
          unit_cost,
          note,
          source,
          source_id,
          created_at,
          location:location_id(name),
          to_location:to_location_id(name),
          variant:variant_id(sku,variant_name,product:product_id(name)),
          created_by_user:created_by(full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }
    if (moveType) {
      query = query.eq('move_type', moveType);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listBatches({
  tenantId,
  locationId = null,
  alertLevel = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('inventory_batches')
      .select(
        `
          batch_id,
          tenant_id,
          location_id,
          variant_id,
          batch_number,
          expiration_date,
          on_hand,
          reserved,
          unit_cost,
          is_active,
          received_at,
          physical_location,
          notes,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            product:product_id(name,requires_expiration)
          )
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('expiration_date', { ascending: true, nullsFirst: false })
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const today = new Date();
    const rows = (data || []).filter((row) => {
      if (!alertLevel) return true;
      if (!row.expiration_date) return alertLevel === 'NO_EXP';
      const exp = new Date(`${row.expiration_date}T00:00:00`);
      const diffDays = Math.floor((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      if (alertLevel === 'EXPIRED') return diffDays < 0;
      if (alertLevel === 'CRITICAL') return diffDays >= 0 && diffDays <= 7;
      if (alertLevel === 'WARNING') return diffDays > 7 && diffDays <= 30;
      if (alertLevel === 'OK') return diffDays > 30;
      return true;
    });

    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listPurchases({
  tenantId,
  locationId = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('purchases')
      .select(
        `
          purchase_id,
          tenant_id,
          location_id,
          supplier_id,
          total,
          note,
          created_at,
          location:location_id(name),
          supplier:supplier_id(legal_name,trade_name,document_number),
          created_by_user:created_by(full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const purchaseIds = (data || []).map((item) => item.purchase_id).filter(Boolean);
    const linesByPurchase = new Map();

    if (purchaseIds.length > 0) {
      const { data: lineRows, error: lineError } = await supabase
        .from('inventory_moves')
        .select(`
          source_id,
          quantity,
          unit_cost,
          variant:variant_id(
            sku,
            variant_name,
            product:product_id(name)
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('move_type', 'PURCHASE_IN')
        .in('source_id', purchaseIds)
        .order('created_at', { ascending: true });

      if (lineError) throw lineError;

      (lineRows || []).forEach((line) => {
        const key = line.source_id;
        if (!key) return;
        if (!linesByPurchase.has(key)) {
          linesByPurchase.set(key, []);
        }
        linesByPurchase.get(key).push(line);
      });
    }

    const rows = (data || []).map((item) => {
      const purchaseLines = linesByPurchase.get(item.purchase_id) || [];
      const firstLine = purchaseLines[0] || null;
      const firstProductName = firstLine?.variant?.product?.name || 'Compra';
      const firstVariantName = firstLine?.variant?.variant_name
        ? ` - ${firstLine.variant.variant_name}`
        : '';
      const itemsCount = purchaseLines.length;
      const itemsSummary = itemsCount > 1
        ? `${firstProductName}${firstVariantName} +${itemsCount - 1} item${itemsCount - 1 === 1 ? '' : 's'}`
        : `${firstProductName}${firstVariantName}`;

      return {
        purchase_id: item.purchase_id,
        source_purchase_id: item.purchase_id,
        supplier_name: item.supplier?.trade_name || item.supplier?.legal_name || 'Sin proveedor',
        supplier_document: item.supplier?.document_number || '',
        items_count: itemsCount,
        items_summary: itemsSummary,
        qty_total: purchaseLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
        sku: firstLine?.variant?.sku || '',
        variant_name: firstLine?.variant?.variant_name || '',
        product_name: firstLine?.variant?.product?.name || '',
        location_name: item.location?.name || '',
        total: Number(item.total || 0),
        purchased_at: item.created_at,
        purchased_by_name: item.created_by_user?.full_name || '',
        note: item.note,
      };
    });

    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listProductionOrders({
  tenantId,
  status = null,
  locationId = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('production_orders')
      .select(
        `
          production_order_id,
          tenant_id,
          order_number,
          bom_id,
          location_id,
          status,
          quantity_planned,
          quantity_produced,
          scheduled_start,
          started_at,
          completed_at,
          notes,
          created_at,
          location:location_id(name),
          bom:bom_id(
            bom_id,
            bom_name,
            product:product_id(name),
            variant:variant_id(sku,variant_name)
          )
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }
    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listBoms({ tenantId, type = null, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('bill_of_materials')
      .select(
        `
          bom_id,
          tenant_id,
          product_id,
          variant_id,
          bom_name,
          version,
          is_active,
          notes,
          created_at,
          product:product_id(product_id,name),
          variant:variant_id(variant_id,sku,variant_name),
          bom_components(component_id)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search && search.trim()) {
      query = query.or(`bom_name.ilike.%${search.trim()}%,notes.ilike.%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const filtered = (data || []).filter((row) => {
      if (!type) return true;
      if (type === 'product') return Boolean(row.product_id);
      if (type === 'variant') return Boolean(row.variant_id);
      return true;
    });

    return { success: true, data: filtered, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}
