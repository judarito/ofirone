import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyProductImportRow } from './productImportApplier.js';

const env = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseServiceRoleKey: 'service-role',
};

describe('product import applier', () => {
  it('crea categoría, producto y variante desde una fila', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/rest/v1/categories?select=*')) return Response.json([]);
      if (String(url).endsWith('/rest/v1/categories')) return Response.json([{ category_id: 'cat-1' }]);
      if (String(url).endsWith('/rest/v1/rpc/fn_get_unit_by_code')) return Response.json('unit-1');
      if (String(url).includes('/rest/v1/products?select=product_id')) return Response.json([]);
      if (String(url).endsWith('/rest/v1/products')) return Response.json([{ product_id: 'prod-1' }]);
      if (String(url).includes('/rest/v1/product_variants?select=variant_id,sku')) return Response.json([]);
      if (String(url).endsWith('/rest/v1/product_variants')) return Response.json([{ variant_id: 'var-1' }]);

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await applyProductImportRow({
      product_name: 'Camisa',
      category_name: 'Ropa',
      unit_code: 'UND',
      variant_name: 'Azul',
      unit_cost: 20000,
      unit_price: 45000,
    }, 'tenant-1', { env, fetchImpl });

    assert.equal(result.product_id, 'prod-1');
    assert.equal(result.variant_id, 'var-1');
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/categories') && call.method === 'POST'));
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/products') && call.method === 'POST'));
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/product_variants') && call.method === 'POST'));
  });

  it('aplica stock inicial cuando la fila trae ubicación', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });

      if (String(url).includes('/rest/v1/categories?select=*')) return Response.json([]);
      if (String(url).endsWith('/rest/v1/rpc/fn_get_unit_by_code')) return Response.json(null);
      if (String(url).includes('/rest/v1/products?select=product_id')) return Response.json([{ product_id: 'prod-1' }]);
      if (String(url).includes('/rest/v1/products?tenant_id=')) return Response.json([{ product_id: 'prod-1' }]);
      if (String(url).includes('/rest/v1/product_variants?select=variant_id,sku')) return Response.json([{ variant_id: 'var-1', sku: 'SKU-1' }]);
      if (String(url).includes('/rest/v1/product_variants?tenant_id=')) return Response.json([{ variant_id: 'var-1' }]);
      if (String(url).includes('/rest/v1/locations?select=location_id')) return Response.json([{ location_id: 'loc-1' }]);
      if (String(url).endsWith('/rest/v1/inventory_moves')) return Response.json([{ inventory_move_id: 'move-1' }]);
      if (String(url).endsWith('/rest/v1/rpc/fn_apply_stock_delta')) return Response.json(null);

      throw new Error(`URL no mockeada: ${url}`);
    };

    const result = await applyProductImportRow({
      product_name: 'Camisa',
      location_code: 'Principal',
      initial_stock: 10,
      unit_cost: 20000,
      unit_price: 45000,
    }, 'tenant-1', { env, fetchImpl });

    assert.equal(result.stock.skipped, false);
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/inventory_moves')));
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/rpc/fn_apply_stock_delta')));
  });
});

