import { supabaseRestGetPaged } from './supabaseRestClient.js';

const STOCK_SELECT =
  '*,location:location_id(name),variant:variant_id(sku,variant_name,cost,price,min_stock,is_component,product:product_id(name,is_component,category:category_id(name)))';

function normalizePage({ page = 1, pageSize = 20 } = {}) {
  const parsedPage = Math.max(1, Math.floor(Number(page) || 1));
  const parsedSize = Math.max(1, Math.min(200, Math.floor(Number(pageSize) || 20)));
  const from = (parsedPage - 1) * parsedSize;
  return { from, to: from + parsedSize - 1 };
}

export function createInventoryRepository(deps) {
  return {
    async listStockBalances({
      page = 1,
      pageSize = 20,
      locationId = null,
      variantId = null,
      lowStock = null,
    } = {}) {
      const { from, to } = normalizePage({ page, pageSize });
      let path = `/stock_balances?select=${STOCK_SELECT}`;
      if (locationId) {
        path += `&location_id=eq.${encodeURIComponent(String(locationId))}`;
      }
      if (variantId) {
        path += `&variant_id=eq.${encodeURIComponent(String(variantId))}`;
      }
      if (lowStock != null && Number(lowStock) >= 0) {
        path += `&on_hand=lte.${Number(lowStock)}`;
      }
      path += '&order=updated_at.desc';

      const { data, total } = await supabaseRestGetPaged(path, {
        ...deps,
        domain: 'inventory',
        operation: 'listStockBalances',
        range: { from, to },
      });

      return { data: data || [], total: total ?? 0 };
    },
  };
}
