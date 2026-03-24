import { supabase } from '../lib/supabase';

const PRODUCT_MEDIA_BUCKET = 'productmedia';
const PRODUCT_MEDIA_SIGNED_URL_TTL = 60 * 60 * 24 * 7;

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
