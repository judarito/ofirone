import { supabaseRestGetPaged } from './supabaseRestClient.js';

function normalizePage({ page = 1, pageSize = 20 } = {}) {
  const parsedPage = Math.max(1, Math.floor(Number(page) || 1));
  const parsedSize = Math.max(1, Math.min(200, Math.floor(Number(pageSize) || 20)));
  const from = (parsedPage - 1) * parsedSize;
  return { from, to: from + parsedSize - 1 };
}

export function createPurchasesRepository(deps) {
  return {
    async listPurchases({ page = 1, pageSize = 20 } = {}) {
      const { from, to } = normalizePage({ page, pageSize });
      const { data, total } = await supabaseRestGetPaged(
        '/purchases?select=*&order=created_at.desc',
        { ...deps, domain: 'purchases', operation: 'listPurchases', range: { from, to } }
      );
      return { data: data || [], total: total ?? 0 };
    },
  };
}
