import { supabase } from '../lib/supabase';
import { listThirdParties } from './thirdParties.service';

function resolveRequiresExpiration(variantRow) {
  if (variantRow?.requires_expiration !== null && variantRow?.requires_expiration !== undefined) {
    return Boolean(variantRow.requires_expiration);
  }
  return Boolean(variantRow?.product?.requires_expiration);
}

function formatVariantLabel(variantRow) {
  const productName = variantRow?.product?.name || 'Producto';
  const variantName = variantRow?.variant_name ? ` - ${variantRow.variant_name}` : '';
  const sku = variantRow?.sku ? ` (${variantRow.sku})` : '';
  return `${productName}${variantName}${sku}`;
}

function normalizeVariantRow(variantRow) {
  return {
    ...variantRow,
    requires_expiration: resolveRequiresExpiration(variantRow),
    _displayName: formatVariantLabel(variantRow),
  };
}

function buildFallbackBatchNumber(variantId, prefix = 'BATCH') {
  const safePrefix = String(prefix || 'BATCH').trim() || 'BATCH';
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const variantPart = String(variantId || 'VAR').slice(0, 6).toUpperCase();
  const randomPart = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `${safePrefix}-${variantPart}-${datePart}-${randomPart}`;
}

export async function listPurchaseSuppliers({ search = '', limit = 50 } = {}) {
  const result = await listThirdParties({
    search,
    limit,
    type: 'supplier',
  });

  if (!result?.success) {
    return {
      success: false,
      error: result?.error || 'No fue posible cargar proveedores.',
      data: [],
      total: 0,
    };
  }

  const mapped = (result.data || []).map((item) => ({
    ...item,
    _displayName: item.trade_name || item.legal_name || item.document_number || 'Proveedor',
  }));

  return {
    success: true,
    data: mapped,
    total: Number(result.total || mapped.length || 0),
  };
}

export async function searchPurchaseVariants({
  tenantId,
  search = '',
  limit = 30,
} = {}) {
  if (!tenantId) {
    return { success: false, error: 'Tenant invalido para buscar productos.', data: [] };
  }

  const normalizedSearch = String(search || '').trim();
  const baseSelect = `
    variant_id,
    sku,
    variant_name,
    cost,
    requires_expiration,
    is_active,
    product:product_id(product_id,name,requires_expiration)
  `;

  try {
    if (normalizedSearch.length < 2) {
      const { data, error } = await supabase
        .from('product_variants')
        .select(baseSelect)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('sku', { ascending: true })
        .limit(limit);

      if (error) throw error;

      return {
        success: true,
        data: (data || []).map(normalizeVariantRow),
      };
    }

    const { data: byVariant, error: byVariantError } = await supabase
      .from('product_variants')
      .select(baseSelect)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or(`sku.ilike.%${normalizedSearch}%,variant_name.ilike.%${normalizedSearch}%`)
      .order('sku', { ascending: true })
      .limit(limit);

    if (byVariantError) throw byVariantError;

    const { data: byProduct, error: byProductError } = await supabase
      .from('product_variants')
      .select(`
        variant_id,
        sku,
        variant_name,
        cost,
        requires_expiration,
        is_active,
        product:product_id!inner(product_id,name,requires_expiration)
      `)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .ilike('product.name', `%${normalizedSearch}%`)
      .order('sku', { ascending: true })
      .limit(limit);

    if (byProductError) throw byProductError;

    const merged = new Map();
    [...(byVariant || []), ...(byProduct || [])].forEach((item) => {
      if (!item?.variant_id || merged.has(item.variant_id)) return;
      merged.set(item.variant_id, normalizeVariantRow(item));
    });

    return {
      success: true,
      data: Array.from(merged.values()).slice(0, limit),
    };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function createPurchase({
  tenantId,
  locationId,
  supplierId = null,
  createdBy,
  lines,
  note = null,
}) {
  try {
    const { data, error } = await supabase.rpc('sp_create_purchase', {
      p_tenant: tenantId,
      p_location: locationId,
      p_supplier_id: supplierId,
      p_created_by: createdBy,
      p_lines: lines,
      p_note: note,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createPurchaseOrder({
  tenantId,
  locationId,
  supplierId = null,
  createdBy,
  lines,
  note = null,
}) {
  try {
    const { data, error } = await supabase.rpc('sp_create_purchase_order', {
      p_tenant: tenantId,
      p_location: locationId,
      p_supplier_id: supplierId,
      p_created_by: createdBy,
      p_lines: lines,
      p_note: note,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPurchaseDetail(tenantId, purchaseId) {
  try {
    const { data: header } = await supabase
      .from('purchases')
      .select(`
        purchase_id,
        note,
        total,
        created_at,
        location:location_id(name),
        supplier:supplier_id(third_party_id,legal_name,trade_name,phone,document_number),
        created_by_user:created_by(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('purchase_id', purchaseId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('inventory_moves')
      .select(`
        inventory_move_id,
        move_type,
        location_id,
        variant_id,
        quantity,
        unit_cost,
        created_at,
        note,
        source_id,
        location:location_id(name),
        variant:variant_id(
          sku,
          variant_name,
          product:product_id(name)
        ),
        created_by_user:created_by(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('move_type', 'PURCHASE_IN')
      .eq('source_id', purchaseId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const { data: returnSummary, error: returnSummaryError } = await supabase
      .from('purchase_return_lines')
      .select('source_inventory_move_id,qty')
      .eq('tenant_id', tenantId)
      .eq('purchase_id', purchaseId);

    if (!data || data.length === 0) {
      return { success: false, error: 'Compra no encontrada.' };
    }

    const returnedBySourceLine = ((returnSummaryError ? [] : returnSummary) || []).reduce((accumulator, row) => {
      const key = row.source_inventory_move_id;
      const current = Number(accumulator[key] || 0);
      accumulator[key] = current + Number(row.qty || 0);
      return accumulator;
    }, {});

    const lines = (data || []).map((item) => ({
      line_id: item.inventory_move_id,
      variant_id: item.variant_id,
      sku: item.variant?.sku || '',
      variant_name: item.variant?.variant_name || '',
      product_name: item.variant?.product?.name || '',
      quantity: Number(item.quantity || 0),
      returned_qty: Number(returnedBySourceLine[item.inventory_move_id] || 0),
      returnable_qty: Math.max(
        Number(item.quantity || 0) - Number(returnedBySourceLine[item.inventory_move_id] || 0),
        0,
      ),
      unit_cost: Number(item.unit_cost || 0),
      line_total: Number(item.quantity || 0) * Number(item.unit_cost || 0),
    }));

    const total = lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    const firstLine = data[0];

    return {
      success: true,
      data: {
        purchase_id: purchaseId,
        location_id: firstLine.location_id,
        location_name: header?.location?.name || firstLine.location?.name || '',
        created_at: header?.created_at || firstLine.created_at,
        created_by_name: header?.created_by_user?.full_name || firstLine.created_by_user?.full_name || '',
        note: header?.note || firstLine.note || '',
        supplier: header?.supplier || null,
        lines,
        total: Number(header?.total || total || 0),
        items_count: lines.length,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getSupplierPayableByPurchase(tenantId, purchaseId) {
  try {
    const { data, error } = await supabase
      .from('supplier_payables')
      .select(`
        payable_id,
        tenant_id,
        supplier_id,
        purchase_id,
        invoice_number,
        due_date,
        total_amount,
        paid_amount,
        balance,
        status,
        note,
        created_at,
        updated_at,
        supplier:supplier_id(third_party_id,legal_name,trade_name,document_number),
        payments:supplier_payable_payments(
          payable_payment_id,
          amount,
          payment_method,
          note,
          created_at,
          created_by_user:created_by(full_name)
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('purchase_id', purchaseId)
      .maybeSingle();

    if (error) throw error;

    const payments = (data?.payments || [])
      .slice()
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

    return {
      success: true,
      data: data
        ? {
            ...data,
            payments,
          }
        : null,
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function createSupplierPayable({
  tenantId,
  purchaseId,
  createdBy,
  dueDate = null,
  invoiceNumber = null,
  note = null,
}) {
  try {
    const { data, error } = await supabase.rpc('sp_create_supplier_payable', {
      p_tenant: tenantId,
      p_purchase_id: purchaseId,
      p_created_by: createdBy,
      p_due_date: dueDate,
      p_invoice_number: invoiceNumber,
      p_note: note,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function registerSupplierPayment({
  tenantId,
  payableId,
  amount,
  createdBy,
  paymentMethod = null,
  note = null,
}) {
  try {
    const { data, error } = await supabase.rpc('sp_register_supplier_payment', {
      p_tenant: tenantId,
      p_payable_id: payableId,
      p_amount: amount,
      p_created_by: createdBy,
      p_payment_method: paymentMethod,
      p_note: note,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function generatePurchaseBatchNumber({
  tenantId,
  variantId,
  locationId = null,
  prefix = 'BATCH',
}) {
  try {
    const { data, error } = await supabase.rpc('fn_generate_batch_number', {
      p_tenant: tenantId,
      p_variant: variantId,
      p_location: locationId,
      p_prefix: prefix,
    });

    if (error) throw error;
    return { success: true, batchNumber: data };
  } catch (error) {
    return {
      success: true,
      batchNumber: buildFallbackBatchNumber(variantId, prefix),
      warning: error.message,
    };
  }
}
