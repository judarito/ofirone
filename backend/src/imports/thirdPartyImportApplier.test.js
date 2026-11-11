import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyThirdPartyImportRow } from './thirdPartyImportApplier.js';

const env = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseServiceRoleKey: 'service-role',
};

describe('third party import applier', () => {
  it('crea tercero desde una fila de importación', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/rest/v1/third_parties?select=third_party_id')) return Response.json([]);
      if (String(url).endsWith('/rest/v1/rpc/fn_upsert_third_party')) {
        return Response.json({ third_party_id: 'tp-1', legal_name: body.p_data.legal_name });
      }

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await applyThirdPartyImportRow({
      legal_name: 'Proveedor Demo',
      document_type: 'NIT',
      document_number: '900123',
      type: 'proveedor',
      email: 'compras@example.com',
      is_responsible_for_iva: 'true',
    }, 'tenant-1', { env, fetchImpl });

    assert.equal(result.third_party_id, 'tp-1');
    assert.equal(result.action, 'created');
    const rpcCall = calls.find((call) => call.url.endsWith('/rest/v1/rpc/fn_upsert_third_party'));
    assert.equal(rpcCall.body.p_data.type, 'supplier');
    assert.equal(rpcCall.body.p_data.country_code, 'CO');
    assert.equal(rpcCall.body.p_data.default_currency, 'COP');
    assert.equal(rpcCall.body.p_data.is_responsible_for_iva, true);
  });

  it('actualiza tercero existente cuando coincide documento dentro del tenant', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/rest/v1/third_parties?select=third_party_id')) {
        return Response.json([{ third_party_id: 'tp-existing' }]);
      }
      if (String(url).endsWith('/rest/v1/rpc/fn_upsert_third_party')) {
        return Response.json({ third_party_id: body.p_data.third_party_id });
      }

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await applyThirdPartyImportRow({
      legal_name: 'Cliente Demo',
      document_number: '123',
      type: 'cliente',
    }, 'tenant-1', { env, fetchImpl });

    assert.equal(result.third_party_id, 'tp-existing');
    assert.equal(result.action, 'updated');
    const rpcCall = calls.find((call) => call.url.endsWith('/rest/v1/rpc/fn_upsert_third_party'));
    assert.equal(rpcCall.body.p_data.third_party_id, 'tp-existing');
    assert.equal(rpcCall.body.p_data.type, 'customer');
  });
});
