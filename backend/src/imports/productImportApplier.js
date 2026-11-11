import { serviceRestRequest } from '../repositories/supabaseServiceRestClient.js';

function cleanString(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || null;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBool(value, defaultValue = false) {
  if (value === true || value === 'TRUE' || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'FALSE' || value === 'false' || value === 0 || value === '0') return false;
  return defaultValue;
}

function mapInventoryBehavior(value) {
  const behaviorMap = {
    RESELL: 'RESELL',
    REVENTA: 'RESELL',
    MANUFACTURED: 'MANUFACTURED',
    SERVICE: 'SERVICE',
    BUNDLE: 'BUNDLE',
    TO_STOCK: 'MANUFACTURED',
    ON_DEMAND: 'MANUFACTURED',
  };
  return behaviorMap[String(value || 'RESELL').trim().toUpperCase()] || 'RESELL';
}

function generateSku(value) {
  const normalized = String(value || 'PRD')
    .trim()
    .replace(/[^A-Za-z0-9]/g, '')
    .substring(0, 3)
    .toUpperCase();
  const suffix = Math.floor(Math.random() * 900000) + 100000;
  return `${normalized || 'PRD'}-${suffix}`;
}

function buildProductPayload(row, tenantId) {
  const productName = cleanString(row.product_name);
  if (!productName) throw new Error('product_name es requerido en la plantilla de importación');

  return {
    tenantId,
    productName,
    categoryName: cleanString(row.category_name),
    unitCode: cleanString(row.unit_code),
    description: cleanString(row.description),
    variantName: cleanString(row.variant_name) || 'Predeterminada',
    initialStock: toNumber(row.initial_stock, 0),
    unitCost: toNumber(row.unit_cost, 0),
    unitPrice: toNumber(row.unit_price, 0),
    priceIncludesTax: toBool(row.price_includes_tax),
    inventoryBehavior: mapInventoryBehavior(row.inventory_type),
    isActive: !toBool(row.is_active, true) ? false : !(row.is_active === false || row.is_active === 'FALSE' || row.is_active === 'false' || row.is_active === 0),
    controlExpiration: toBool(row.control_expiration),
    isComponent: toBool(row.is_component),
    locationCode: cleanString(row.location_code),
    standardCode: cleanString(row.standard_code),
    standardCodeType: cleanString(row.standard_code_type) || 'UNSPSC',
  };
}

async function findFirst(path, deps) {
  const rows = await serviceRestRequest(path, deps);
  return rows?.[0] || null;
}

async function serviceRpc(functionName, body, deps) {
  return serviceRestRequest(`/rpc/${functionName}`, {
    ...deps,
    method: 'POST',
    body,
    operation: functionName,
  });
}

async function findOrCreateCategory(tenantId, name, deps) {
  const normalized = cleanString(name);
  if (!normalized) return null;

  const existing = await findFirst(
    `/categories?select=*&tenant_id=eq.${encodeURIComponent(tenantId)}&name=ilike.${encodeURIComponent(normalized)}&limit=1`,
    { ...deps, operation: 'findCategoryByName' },
  );
  if (existing) return existing;

  const created = await serviceRestRequest('/categories', {
    ...deps,
    method: 'POST',
    body: { tenant_id: tenantId, name: normalized },
    prefer: 'return=representation',
    operation: 'createCategory',
  });
  return created?.[0] || null;
}

async function getUnitId(tenantId, unitCode, deps) {
  if (!unitCode) return null;
  return serviceRpc('fn_get_unit_by_code', {
    p_tenant_id: tenantId,
    p_code: unitCode,
  }, deps);
}

async function upsertProduct(payload, categoryId, unitId, deps) {
  const existing = await findFirst(
    `/products?select=product_id&tenant_id=eq.${encodeURIComponent(payload.tenantId)}&name=ilike.${encodeURIComponent(payload.productName)}&limit=1`,
    { ...deps, operation: 'findProductByName' },
  );
  const productPayload = {
    name: payload.productName,
    description: payload.description,
    category_id: categoryId,
    unit_id: unitId,
    is_active: payload.isActive,
    track_inventory: true,
    inventory_behavior: payload.inventoryBehavior,
    is_component: payload.isComponent,
    requires_expiration: payload.controlExpiration,
  };

  if (existing?.product_id) {
    const updated = await serviceRestRequest(
      `/products?tenant_id=eq.${encodeURIComponent(payload.tenantId)}&product_id=eq.${encodeURIComponent(existing.product_id)}`,
      {
        ...deps,
        method: 'PATCH',
        body: productPayload,
        prefer: 'return=representation',
        operation: 'updateProduct',
      },
    );
    return updated?.[0]?.product_id || existing.product_id;
  }

  const created = await serviceRestRequest('/products', {
    ...deps,
    method: 'POST',
    body: { ...productPayload, tenant_id: payload.tenantId },
    prefer: 'return=representation',
    operation: 'createProduct',
  });
  return created?.[0]?.product_id;
}

async function findProductVariant(tenantId, productId, variantName, deps) {
  const byName = await findFirst(
    `/product_variants?select=variant_id,sku&tenant_id=eq.${encodeURIComponent(tenantId)}&product_id=eq.${encodeURIComponent(productId)}&variant_name=ilike.${encodeURIComponent(variantName)}&limit=1`,
    { ...deps, operation: 'findVariantByName' },
  );
  if (byName) return byName;

  return findFirst(
    `/product_variants?select=variant_id,sku&tenant_id=eq.${encodeURIComponent(tenantId)}&product_id=eq.${encodeURIComponent(productId)}&limit=1`,
    { ...deps, operation: 'findAnyProductVariant' },
  );
}

async function upsertVariant(payload, productId, unitId, deps) {
  const existing = await findProductVariant(payload.tenantId, productId, payload.variantName, deps);
  const variantPayload = {
    variant_name: payload.variantName,
    cost: payload.unitCost,
    price: payload.unitPrice,
    price_includes_tax: payload.priceIncludesTax,
    is_active: payload.isActive,
    requires_expiration: payload.controlExpiration,
    unit_id: unitId,
    standard_code: payload.standardCode,
    standard_code_type: payload.standardCodeType,
  };

  if (existing?.variant_id) {
    const updated = await serviceRestRequest(
      `/product_variants?tenant_id=eq.${encodeURIComponent(payload.tenantId)}&variant_id=eq.${encodeURIComponent(existing.variant_id)}`,
      {
        ...deps,
        method: 'PATCH',
        body: { ...variantPayload, sku: existing.sku },
        prefer: 'return=representation',
        operation: 'updateVariant',
      },
    );
    return updated?.[0]?.variant_id || existing.variant_id;
  }

  const created = await serviceRestRequest('/product_variants', {
    ...deps,
    method: 'POST',
    body: {
      tenant_id: payload.tenantId,
      product_id: productId,
      sku: generateSku(payload.productName),
      ...variantPayload,
    },
    prefer: 'return=representation',
    operation: 'createVariant',
  });
  return created?.[0]?.variant_id;
}

async function applyInitialStock(payload, variantId, deps) {
  if (!payload.locationCode || payload.initialStock <= 0) return { skipped: true };

  const location = await findFirst(
    `/locations?select=location_id&tenant_id=eq.${encodeURIComponent(payload.tenantId)}&name=ilike.${encodeURIComponent(payload.locationCode)}&is_active=eq.true&limit=1`,
    { ...deps, operation: 'findLocationByName' },
  );
  if (!location?.location_id) {
    throw new Error(`Ubicación "${payload.locationCode}" no encontrada. Verifica que exista y esté activa.`);
  }

  await serviceRestRequest('/inventory_moves', {
    ...deps,
    method: 'POST',
    body: {
      tenant_id: payload.tenantId,
      move_type: 'INITIAL_STOCK',
      location_id: location.location_id,
      variant_id: variantId,
      quantity: payload.initialStock,
      unit_cost: payload.unitCost,
      source: 'BULK_IMPORT',
      note: 'Stock inicial vía importación masiva',
    },
    prefer: 'return=representation',
    operation: 'createInitialStockMove',
  });

  await serviceRpc('fn_apply_stock_delta', {
    p_tenant: payload.tenantId,
    p_location: location.location_id,
    p_variant: variantId,
    p_delta: payload.initialStock,
  }, deps);

  return { skipped: false, location_id: location.location_id };
}

export async function applyProductImportRow(row, tenantId, deps = {}) {
  const payload = buildProductPayload(row, tenantId);
  const category = await findOrCreateCategory(tenantId, payload.categoryName, deps);
  const unitId = await getUnitId(tenantId, payload.unitCode, deps);
  const productId = await upsertProduct(payload, category?.category_id || null, unitId, deps);
  const variantId = await upsertVariant(payload, productId, unitId, deps);
  const stock = await applyInitialStock(payload, variantId, deps);

  return {
    product_id: productId,
    variant_id: variantId,
    stock,
  };
}

