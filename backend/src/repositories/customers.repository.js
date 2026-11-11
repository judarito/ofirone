import { supabaseRestGetPaged } from './supabaseRestClient.js';

const CUSTOMER_COLUMNS =
  'third_party_id,tenant_id,document_type,document_number,dv,legal_name,trade_name,phone,email,fiscal_email,address,city,department,max_credit_amount,default_payment_terms,default_currency,is_active,created_at';

function normalizePage({ page = 1, pageSize = 20 } = {}) {
  const parsedPage = Math.max(1, Math.floor(Number(page) || 1));
  const parsedSize = Math.max(1, Math.min(200, Math.floor(Number(pageSize) || 20)));
  const from = (parsedPage - 1) * parsedSize;
  return { from, to: from + parsedSize - 1, page: parsedPage, pageSize: parsedSize };
}

export function createCustomersRepository(deps) {
  return {
    async listCustomers({ page = 1, pageSize = 20, search = '' } = {}) {
      const { from, to } = normalizePage({ page, pageSize });
      const normalizedSearch = String(search || '').trim();
      let path = `/third_parties?select=${CUSTOMER_COLUMNS}`;
      if (normalizedSearch) {
        const q = encodeURIComponent(`%${normalizedSearch}%`);
        path += `&or=(legal_name.ilike.${q},document_number.ilike.${q},phone.ilike.${q},email.ilike.${q})`;
      }
      path += '&order=legal_name.asc';

      const { data, total } = await supabaseRestGetPaged(path, {
        ...deps,
        domain: 'customers',
        operation: 'listCustomers',
        range: { from, to },
      });

      return { data: data || [], total: total ?? 0 };
    },
  };
}
