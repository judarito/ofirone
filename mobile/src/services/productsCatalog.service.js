import { supabase } from '../lib/supabase';

const PRODUCT_MEDIA_BUCKET = 'productmedia';
const PRODUCT_MEDIA_SIGNED_URL_TTL = 60 * 60 * 24 * 7;
const PRODUCT_MEDIA_SHORT_SIGNED_URL_TTL = 60 * 60;
const PRODUCT_COVER_MEMORY_CACHE_LIMIT = 500;
const productCoverUrlMemoryCache = new Map();

const cols = `
  product_id,
  tenant_id,
  name,
  description,
  category_id,
  unit_id,
  is_active,
  track_inventory,
  requires_expiration,
  inventory_behavior,
  is_component,
  category:category_id(category_id,name),
  unit:unit_id(unit_id,code,name,dian_code,is_system),
  product_variants(variant_id,sku,variant_name,cost,price,min_stock,is_active)
`;

async function attachProductMediaSummary(tenantId, products) {
  const source = Array.isArray(products) ? products : [];
  if (!tenantId || !source.length) return source;

  const productIds = source.map((item) => item.product_id).filter(Boolean);
  if (!productIds.length) return source;

  const { data: mediaRows, error } = await supabase
    .from('product_media')
    .select('media_id, product_id, storage_path, is_cover, sort_order, created_at')
    .eq('tenant_id', tenantId)
    .in('product_id', productIds)
    .order('is_cover', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    const relationMissing = String(error?.message || '').toLowerCase().includes('product_media');
    if (relationMissing) {
      return source.map((item) => ({
        ...item,
        media_count: 0,
        cover_image_url: null,
        cover_media_id: null,
      }));
    }
    throw error;
  }

  const grouped = new Map();
  for (const row of mediaRows || []) {
    const current = grouped.get(row.product_id) || [];
    current.push(row);
    grouped.set(row.product_id, current);
  }

  const coverRows = source
    .map((item) => {
      const rows = grouped.get(item.product_id) || [];
      return rows[0] || null;
    })
    .filter(Boolean);

  const signedPairs = await Promise.all(
    coverRows.map(async (row) => {
      const { data: signedData, error: signError } = await supabase
        .storage
        .from(PRODUCT_MEDIA_BUCKET)
        .createSignedUrl(row.storage_path, PRODUCT_MEDIA_SIGNED_URL_TTL);

      return [
        row.media_id,
        signError ? null : signedData?.signedUrl || null,
      ];
    }),
  );

  const signedMap = new Map(signedPairs);

  return source.map((item) => {
    const rows = grouped.get(item.product_id) || [];
    const cover = rows[0] || null;
    return {
      ...item,
      media_count: rows.length,
      cover_media_id: cover?.media_id || null,
      cover_image_url: cover ? signedMap.get(cover.media_id) || null : null,
    };
  });
}

function buildProductCoverCacheKey(tenantId, productId) {
  return `${tenantId}:${productId}`;
}

function getCachedProductCoverUrl(tenantId, productId) {
  const key = buildProductCoverCacheKey(tenantId, productId);
  const entry = productCoverUrlMemoryCache.get(key);
  if (!entry) return { hit: false, url: null };
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    productCoverUrlMemoryCache.delete(key);
    return { hit: false, url: null };
  }
  return { hit: true, url: entry.url || null };
}

function setCachedProductCoverUrl(tenantId, productId, url, expiresIn = PRODUCT_MEDIA_SHORT_SIGNED_URL_TTL) {
  const safeTtl = Math.max(60, Number(expiresIn || PRODUCT_MEDIA_SHORT_SIGNED_URL_TTL));
  const key = buildProductCoverCacheKey(tenantId, productId);
  if (productCoverUrlMemoryCache.has(key)) {
    productCoverUrlMemoryCache.delete(key);
  }
  productCoverUrlMemoryCache.set(key, {
    url: url || null,
    expiresAt: Date.now() + (safeTtl * 1000),
  });
  if (productCoverUrlMemoryCache.size > PRODUCT_COVER_MEMORY_CACHE_LIMIT) {
    const oldestKey = productCoverUrlMemoryCache.keys().next().value;
    if (oldestKey) {
      productCoverUrlMemoryCache.delete(oldestKey);
    }
  }
}

export async function listProductCoverImageUrls({
  tenantId,
  productIds = [],
  expiresIn = PRODUCT_MEDIA_SHORT_SIGNED_URL_TTL,
} = {}) {
  const uniqueProductIds = Array.from(new Set((productIds || []).filter(Boolean)));
  if (!tenantId || !uniqueProductIds.length) {
    return { success: true, data: {} };
  }

  const coverMap = {};
  const pendingProductIds = [];

  uniqueProductIds.forEach((productId) => {
    const cached = getCachedProductCoverUrl(tenantId, productId);
    if (cached.hit) {
      coverMap[productId] = cached.url;
      return;
    }
    pendingProductIds.push(productId);
  });

  if (!pendingProductIds.length) {
    return { success: true, data: coverMap };
  }

  try {
    const { data: mediaRows, error } = await supabase
      .from('product_media')
      .select('media_id, product_id, storage_path, is_cover, sort_order, created_at')
      .eq('tenant_id', tenantId)
      .in('product_id', pendingProductIds)
      .order('is_cover', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      const relationMissing = String(error?.message || '').toLowerCase().includes('product_media');
      if (relationMissing) {
        pendingProductIds.forEach((productId) => {
          coverMap[productId] = null;
          setCachedProductCoverUrl(tenantId, productId, null, expiresIn);
        });
        return { success: true, data: coverMap };
      }
      throw error;
    }

    const grouped = new Map();
    for (const row of mediaRows || []) {
      if (grouped.has(row.product_id)) continue;
      grouped.set(row.product_id, row);
    }

    const signResults = await Promise.all(
      pendingProductIds.map(async (productId) => {
        const coverRow = grouped.get(productId);
        if (!coverRow?.storage_path) {
          return [productId, null];
        }

        const { data: signedData, error: signError } = await supabase
          .storage
          .from(PRODUCT_MEDIA_BUCKET)
          .createSignedUrl(coverRow.storage_path, expiresIn);

        return [productId, signError ? null : signedData?.signedUrl || null];
      }),
    );

    signResults.forEach(([productId, signedUrl]) => {
      coverMap[productId] = signedUrl;
      setCachedProductCoverUrl(tenantId, productId, signedUrl, expiresIn);
    });

    return { success: true, data: coverMap };
  } catch (error) {
    return { success: false, error: error.message, data: coverMap };
  }
}

export async function listProducts({
  tenantId,
  search = '',
  limit = 20,
  offset = 0,
  isComponent,
} = {}) {
  try {
    let query = supabase
      .from('products')
      .select(cols, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (typeof isComponent === 'boolean') {
      query = query.eq('is_component', isComponent);
    }

    if (search && search.trim()) {
      query = query.or(`name.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    const enriched = await attachProductMediaSummary(tenantId, data || []);
    return { success: true, data: enriched, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createProduct(payload) {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select(cols)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateProduct(productId, tenantId, updates) {
  try {
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('product_id', productId)
      .eq('tenant_id', tenantId)
      .select(cols)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeProduct(productId, tenantId) {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('product_id', productId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listCategoryOptions(tenantId) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('category_id,name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}
