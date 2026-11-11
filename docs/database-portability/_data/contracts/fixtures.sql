-- Fixtures sintéticos reproducibles — Ofirone PostgreSQL portable (0001–0012)
-- Ejecutar SOLO en una base desechable, después de aplicar las migraciones.
-- Requiere un rol con BYPASSRLS (owner de la base temporal) o, en su defecto,
-- desactivar FORCE RLS temporalmente para tenants/identities. Nunca en PROD.
-- Dominios .example.test, UUID fijos, sin datos reales.

begin;

-- 2 tenants e identidades
insert into public.tenants (tenant_id, slug, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'fixture-a', 'Fixture A'),
  ('00000000-0000-0000-0000-0000000000b2', 'fixture-b', 'Fixture B');

insert into public.identities (identity_id, email, display_name) values
  ('10000000-0000-0000-0000-0000000000a1', 'a@example.test', 'Alice A'),
  ('10000000-0000-0000-0000-0000000000b2', 'b@example.test', 'Bob B');

insert into public.tenant_memberships (membership_id, tenant_id, identity_id) values
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2');

insert into public.roles (role_id, tenant_id, code, name) values
  ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'owner', 'Owner'),
  ('30000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'owner', 'Owner');

-- Catálogo A
insert into public.locations (location_id, tenant_id, code, name) values
  ('60000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'MAIN', 'Principal');
insert into public.units_of_measure (unit_id, tenant_id, code, name) values
  ('61000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'UND', 'Unidad');
insert into public.categories (category_id, tenant_id, code, name) values
  ('62000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'GEN', 'General');
insert into public.taxes (tax_id, tenant_id, code, name, rate) values
  ('63000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'IVA19', 'IVA 19', 19);
insert into public.payment_methods (payment_method_id, tenant_id, code, name, method_type) values
  ('64000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'CASH', 'Efectivo', 'cash');

-- Tercero, cliente y producto A
insert into public.third_parties (third_party_id, tenant_id, legal_name, is_supplier, is_customer) values
  ('80000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Proveedor/Cliente Fixture', true, true);
insert into public.customers (customer_id, tenant_id, third_party_id, credit_enabled, credit_limit) values
  ('81000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-0000000000a1', true, 500);
insert into public.products (product_id, tenant_id, category_id, default_unit_id, code, name) values
  ('70000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '62000000-0000-0000-0000-0000000000a1', '61000000-0000-0000-0000-0000000000a1', 'P-1', 'Producto Fixture');
insert into public.product_variants (variant_id, tenant_id, product_id, sku, name, cost, sale_price) values
  ('71000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1', 'SKU-1', 'Variante Fixture', 5, 20);

-- Inventario A: lote 98 = +100 -2
insert into public.inventory_batches (batch_id, tenant_id, location_id, variant_id, batch_number, quantity_on_hand, quantity_reserved, unit_cost) values
  ('72000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000a1', 'L-1', 98, 0, 5);
insert into public.inventory_moves (tenant_id, location_id, variant_id, batch_id, quantity_delta, movement_type, source_type) values
  ('00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-0000000000a1', 100, 'purchase_in', 'purchase'),
  ('00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-0000000000a1', -2, 'sale_out', 'sale');

-- Venta A (20) con línea y pago
insert into public.sales (sale_id, tenant_id, location_id, sale_number, subtotal, total) values
  ('73000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 1, 20, 20);
insert into public.sale_lines (tenant_id, sale_id, variant_id, line_number, quantity, unit_price, line_total) values
  ('00000000-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000a1', 1, 1, 20, 20);
insert into public.sale_payments (tenant_id, sale_id, payment_method_id, amount) values
  ('00000000-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-0000000000a1', '64000000-0000-0000-0000-0000000000a1', 20);

-- Compra A (100) y cuenta por pagar
insert into public.purchases (purchase_id, tenant_id, location_id, supplier_id, purchase_number, subtotal, total) values
  ('82000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-0000000000a1', 1, 100, 100);
insert into public.purchase_lines (tenant_id, purchase_id, variant_id, line_number, quantity, unit_cost, line_total, quantity_received) values
  ('00000000-0000-0000-0000-0000000000a1', '82000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000a1', 1, 10, 10, 100, 10);
insert into public.supplier_payables (payable_id, tenant_id, supplier_id, purchase_id, original_amount, paid_amount, status) values
  ('83000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-0000000000a1', '82000000-0000-0000-0000-0000000000a1', 100, 0, 'open');

-- Cartera cliente A (saldo 20)
insert into public.customer_credit_accounts (credit_account_id, tenant_id, customer_id, credit_limit, current_balance) values
  ('84000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-0000000000a1', 500, 20);
insert into public.customer_credit_movements (tenant_id, credit_account_id, movement_type, amount, source_type, source_id) values
  ('00000000-0000-0000-0000-0000000000a1', '84000000-0000-0000-0000-0000000000a1', 'charge', 20, 'sale', '73000000-0000-0000-0000-0000000000a1');

-- Apartado A (total 100, saldo 100, cuota 100)
insert into public.layaway_contracts (layaway_id, tenant_id, location_id, customer_id, contract_number, subtotal, total, paid_total, balance_due) values
  ('85000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-0000000000a1', 1, 100, 100, 0, 100);
insert into public.layaway_items (tenant_id, layaway_id, variant_id, line_number, quantity, unit_price, line_total) values
  ('00000000-0000-0000-0000-0000000000a1', '85000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000a1', 1, 1, 100, 100);
insert into public.layaway_installments (tenant_id, layaway_id, installment_number, due_date, amount, paid_amount, status) values
  ('00000000-0000-0000-0000-0000000000a1', '85000000-0000-0000-0000-0000000000a1', 1, current_date + 30, 100, 0, 'pending');

-- Jobs y auditoría A
insert into public.async_jobs (job_id, tenant_id, job_type, idempotency_key) values
  ('86000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'fixture', 'fixture-1');
insert into public.audit_log (audit_id, tenant_id, action, resource_type, resource_id) values
  ('87000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'sale.created', 'sale', '73000000-0000-0000-0000-0000000000a1');

commit;
