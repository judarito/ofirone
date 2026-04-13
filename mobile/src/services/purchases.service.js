import { supabase } from '../lib/supabase';
import { listThirdParties } from './thirdParties.service';
import aiPurchaseAdvisor from './ai-purchase-advisor.service';

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

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeInventoryBehavior(value) {
  const raw = String(value || 'RESELL').trim().toUpperCase();
  if (raw === 'MANUFACTURED' || raw === 'SERVICE' || raw === 'BUNDLE') return raw;
  return 'RESELL';
}

function generateSku(value) {
  const normalized = String(value || 'PRD')
    .trim()
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  const suffix = Math.floor(Math.random() * 900000) + 100000;
  return `${normalized || 'PRD'}-${suffix}`;
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

export async function createCatalogVariantForPurchase({
  tenantId,
  rawName,
  productName,
  variantName = 'Predeterminada',
  suggestedSku = null,
  unitCost = 0,
  requiresExpiration = false,
  inventoryBehavior = 'RESELL',
  notes = null,
  isComponent = false,
} = {}) {
  if (!tenantId) {
    return { success: false, error: 'Tenant invalido para crear articulo.' };
  }

  const safeProductName = normalizeText(productName || rawName);
  if (!safeProductName) {
    return { success: false, error: 'Nombre de producto requerido para crear articulo.' };
  }

  const safeVariantName = normalizeText(variantName || 'Predeterminada') || 'Predeterminada';
  const safeNotes = normalizeText(notes || '') || null;
  const safeCost = Number.isFinite(Number(unitCost)) ? Number(unitCost) : 0;
  const safeSku = normalizeText(suggestedSku || '') || generateSku(safeProductName);
  const safeInventoryBehavior = normalizeInventoryBehavior(inventoryBehavior);

  try {
    let productId = null;
    let productRow = null;

    const { data: existingProducts, error: productSearchError } = await supabase
      .from('products')
      .select('product_id, name, requires_expiration, unit_id')
      .eq('tenant_id', tenantId)
      .ilike('name', safeProductName)
      .limit(1);

    if (productSearchError) throw productSearchError;

    if (existingProducts?.length) {
      productRow = existingProducts[0];
      productId = productRow.product_id;
    } else {
      const { data: createdProduct, error: createProductError } = await supabase
        .from('products')
        .insert({
          tenant_id: tenantId,
          name: safeProductName,
          description: safeNotes,
          category_id: null,
          unit_id: null,
          is_active: true,
          track_inventory: true,
          requires_expiration: Boolean(requiresExpiration),
          inventory_behavior: safeInventoryBehavior,
          is_component: Boolean(isComponent),
        })
        .select('product_id, name, requires_expiration, unit_id')
        .single();

      if (createProductError) throw createProductError;
      productRow = createdProduct;
      productId = createdProduct?.product_id || null;
    }

    if (!productId) {
      throw new Error('No se pudo resolver el producto para crear la variante.');
    }

    const { data: existingVariants, error: variantSearchError } = await supabase
      .from('product_variants')
      .select(`
        variant_id,
        sku,
        variant_name,
        cost,
        requires_expiration,
        is_active,
        product:product_id(product_id,name,requires_expiration)
      `)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .ilike('variant_name', safeVariantName)
      .limit(1);

    if (variantSearchError) throw variantSearchError;

    if (existingVariants?.length) {
      return {
        success: true,
        data: normalizeVariantRow(existingVariants[0]),
        created: false,
      };
    }

    const { data: createdVariant, error: createVariantError } = await supabase
      .from('product_variants')
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        sku: safeSku,
        variant_name: safeVariantName,
        cost: safeCost,
        price: 0,
        price_includes_tax: false,
        is_active: true,
        requires_expiration: Boolean(requiresExpiration),
        unit_id: productRow?.unit_id || null,
      })
      .select(`
        variant_id,
        sku,
        variant_name,
        cost,
        requires_expiration,
        is_active,
        product:product_id(product_id,name,requires_expiration)
      `)
      .single();

    if (createVariantError) throw createVariantError;

    return {
      success: true,
      data: normalizeVariantRow(createdVariant),
      created: true,
    };
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

export async function getInventoryRotationAnalysis(tenantId) {
  if (!tenantId) {
    return { success: false, error: 'Tenant invalido para analizar rotacion.', data: [] };
  }

  try {
    const { data, error } = await supabase
      .from('vw_inventory_rotation_analysis')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('days_of_stock_remaining', { ascending: true, nullsFirst: false })
      .limit(100);

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function getPurchaseSuggestions(tenantId, minPriority = 3, limit = 50) {
  if (!tenantId) {
    return { success: false, error: 'Tenant invalido para sugerencias.', data: [] };
  }

  try {
    const { data, error } = await supabase.rpc('fn_get_purchase_suggestions', {
      p_tenant_id: tenantId,
      p_min_priority: minPriority,
      p_limit: limit,
    });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function getAIPurchaseAnalysis(tenantId, options = {}) {
  if (!tenantId) {
    return { success: false, error: 'Tenant invalido para analisis de IA.', data: null };
  }

  try {
    if (!aiPurchaseAdvisor.isAvailable()) {
      return {
        success: false,
        error: 'Servicio de IA no disponible. Verifique la Edge Function configurada.',
        data: null,
      };
    }

    const [suggestionsResult, rotationResult] = await Promise.all([
      getPurchaseSuggestions(tenantId, options.priorityLevel || 3, 100),
      getInventoryRotationAnalysis(tenantId),
    ]);

    if (!suggestionsResult.success || !rotationResult.success) {
      throw new Error('Error obteniendo datos base para análisis.');
    }

    const aiAnalysis = await aiPurchaseAdvisor.generatePurchaseRecommendations(
      tenantId,
      rotationResult.data || [],
      suggestionsResult.data || [],
      options,
    );

    const executiveSummary = aiPurchaseAdvisor.generateExecutiveSummary(aiAnalysis);

    return {
      success: true,
      data: {
        ...aiAnalysis,
        executive_summary: executiveSummary,
        base_suggestions: suggestionsResult.data || [],
        analysis_timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export function isAIAvailable() {
  return aiPurchaseAdvisor.isAvailable();
}

export async function getOpenPurchaseOrders(tenantId) {
  if (!tenantId) {
    return { success: false, error: 'Tenant invalido para consultar OCs.', data: [] };
  }

  try {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        purchase_order_id,
        tenant_id,
        location_id,
        supplier_id,
        status,
        note,
        total,
        created_at,
        location:location_id(name),
        supplier:supplier_id(third_party_id,legal_name,trade_name,document_number),
        lines:purchase_order_lines(
          purchase_order_line_id,
          variant_id,
          qty_ordered,
          qty_received,
          unit_cost,
          batch_number,
          expiration_date,
          physical_location,
          variant:variant_id(
            sku,
            variant_name,
            product:product_id(name)
          )
        )
      `)
      .eq('tenant_id', tenantId)
      .in('status', ['DRAFT', 'PARTIAL'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    return {
      success: true,
      data: (data || []).map((order) => ({
        ...order,
        lines_count: order.lines?.length || 0,
        pending_lines_count:
          order.lines?.filter((line) => Number(line.qty_received || 0) < Number(line.qty_ordered || 0))
            .length || 0,
        computed_total:
          order.lines?.reduce(
            (sum, line) => sum + Number(line.qty_ordered || 0) * Number(line.unit_cost || 0),
            0,
          ) || 0,
        lines: (order.lines || []).map((line) => ({
          ...line,
          qty_received: Number(line.qty_received || 0),
          qty_remaining: Math.max(
            Number(line.qty_ordered || 0) - Number(line.qty_received || 0),
            0,
          ),
        })),
      })),
    };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function receivePurchaseOrder({
  tenantId,
  purchaseOrderId,
  createdBy,
  note = null,
}) {
  try {
    const { data, error } = await supabase.rpc('sp_receive_purchase_order', {
      p_tenant: tenantId,
      p_purchase_order_id: purchaseOrderId,
      p_created_by: createdBy,
      p_note: note,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function receivePurchaseOrderPartial({
  tenantId,
  purchaseOrderId,
  createdBy,
  lines,
  note = null,
}) {
  try {
    const { data, error } = await supabase.rpc('sp_receive_purchase_order_partial', {
      p_tenant: tenantId,
      p_purchase_order_id: purchaseOrderId,
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

export async function getSupplierPayablesDashboard({
  tenantId,
  status = 'OPEN_PARTIAL',
  dueInDays = null,
  page = 1,
  pageSize = 20,
} = {}) {
  if (!tenantId) {
    return { success: false, error: 'Tenant invalido para consultar CxP.', data: [], total: 0 };
  }

  try {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 20;
    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;

    let query = supabase
      .from('supplier_payables')
      .select(`
        payable_id,
        purchase_id,
        supplier_id,
        invoice_number,
        due_date,
        total_amount,
        paid_amount,
        balance,
        status,
        created_at,
        purchase:purchase_id(
          location_id,
          location:location_id(name)
        ),
        supplier:supplier_id(
          legal_name,
          trade_name
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (status === 'OPEN_PARTIAL') {
      query = query.in('status', ['OPEN', 'PARTIAL']);
    } else if (status && status !== 'ALL') {
      query = query.eq('status', status);
    }

    if (dueInDays !== null && dueInDays !== undefined) {
      const untilDate = new Date();
      untilDate.setDate(untilDate.getDate() + Number(dueInDays));
      query = query
        .not('due_date', 'is', null)
        .lte('due_date', untilDate.toISOString().slice(0, 10));
    }

    const { data, error, count } = await query
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      success: true,
      data: (data || []).map((row) => {
        const dueDate = row.due_date ? new Date(`${row.due_date}T00:00:00`) : null;
        const daysToDue =
          dueDate ? Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

        return {
          ...row,
          supplier_name: row.supplier?.trade_name || row.supplier?.legal_name || 'Proveedor',
          location_id: row.purchase?.location_id || null,
          location_name: row.purchase?.location?.name || 'Sin sede',
          days_to_due: daysToDue,
          is_overdue: dueDate ? dueDate.getTime() < today.getTime() : false,
        };
      }),
      total: Number(count || 0),
    };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
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
