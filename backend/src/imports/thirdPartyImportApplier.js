import { serviceRestRequest } from '../repositories/supabaseServiceRestClient.js';

function cleanString(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || null;
}

function toBool(value, defaultValue = false) {
  if (value === true || value === 'TRUE' || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'FALSE' || value === 'false' || value === 0 || value === '0') return false;
  return defaultValue;
}

function toInteger(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeThirdPartyType(value) {
  const normalized = String(value || 'both').trim().toLowerCase();
  if (['customer', 'supplier', 'both'].includes(normalized)) return normalized;
  if (['cliente', 'clientes'].includes(normalized)) return 'customer';
  if (['proveedor', 'proveedores'].includes(normalized)) return 'supplier';
  if (['ambos', 'cliente/proveedor', 'customer/supplier'].includes(normalized)) return 'both';
  return 'both';
}

function buildThirdPartyPayload(row, tenantId) {
  const legalName = cleanString(row.legal_name);
  if (!legalName) throw new Error('legal_name es requerido en la plantilla de terceros');

  return {
    tenant_id: tenantId,
    legal_name: legalName,
    trade_name: cleanString(row.trade_name),
    document_type: cleanString(row.document_type),
    document_number: cleanString(row.document_number),
    dv: cleanString(row.dv),
    type: normalizeThirdPartyType(row.type),
    phone: cleanString(row.phone),
    email: cleanString(row.email),
    fiscal_email: cleanString(row.fiscal_email),
    address: cleanString(row.address),
    city: cleanString(row.city),
    city_code: cleanString(row.city_code),
    department: cleanString(row.department),
    country_code: cleanString(row.country_code) || 'CO',
    tax_regime: cleanString(row.tax_regime),
    is_responsible_for_iva: toBool(row.is_responsible_for_iva, false),
    obligated_accounting: toBool(row.obligated_accounting, false),
    default_payment_terms: toInteger(row.default_payment_terms),
    max_credit_amount: toNumber(row.max_credit_amount),
    default_currency: cleanString(row.default_currency) || 'COP',
    is_active: toBool(row.is_active, true),
  };
}

async function findExistingThirdParty(payload, deps) {
  if (!payload.document_number) return null;

  const rows = await serviceRestRequest(
    `/third_parties?select=third_party_id&tenant_id=eq.${encodeURIComponent(payload.tenant_id)}&document_number=eq.${encodeURIComponent(payload.document_number)}&limit=1`,
    { ...deps, operation: 'findThirdPartyByDocument' },
  );
  return rows?.[0] || null;
}

async function upsertThirdParty(payload, deps) {
  return serviceRestRequest('/rpc/fn_upsert_third_party', {
    ...deps,
    method: 'POST',
    body: { p_data: payload },
    operation: 'fn_upsert_third_party',
  });
}

export async function applyThirdPartyImportRow(row, tenantId, deps = {}) {
  if (!tenantId) throw new Error('tenant_id faltante en el registro de importación');

  const payload = buildThirdPartyPayload(row, tenantId);
  const existing = await findExistingThirdParty(payload, deps);
  if (existing?.third_party_id) {
    payload.third_party_id = existing.third_party_id;
  }

  const result = await upsertThirdParty(payload, deps);

  return {
    third_party_id: result?.third_party_id || payload.third_party_id || null,
    action: existing?.third_party_id ? 'updated' : 'created',
  };
}
