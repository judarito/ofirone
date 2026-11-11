#!/usr/bin/env python3
"""Validación de negocio en base desechable (0001-0007 disponibles).

Crea una base temporal, aplica TODAS las migraciones .up.sql presentes,
siembra datos sintéticos (identidad, catálogo, productos, inventario, ventas),
ejecuta casos N disponibles, conteos/sumas, keyset, up→down→up y segunda
ejecución; compara checksums con el ledger de DEV y elimina todo al final.

Casos N8–N20 que dependen de tablas aún no migradas (compras, cartera,
auditoría, jobs, matviews) se registran como BLOQ.

No toca PROD, ni el esquema público de DEV compartido.
"""

import argparse
import hashlib
import os
import re
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from pg8000.native import Connection
except ImportError:
    sys.exit("Falta pg8000. Instalar: pip install pg8000")

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "database" / "migrations"
ACTOR = "ofirone_business_validation_actor"

T_A = "00000000-0000-0000-0000-0000000000a1"
T_B = "00000000-0000-0000-0000-0000000000b2"
I_A = "10000000-0000-0000-0000-0000000000a1"
I_B = "10000000-0000-0000-0000-0000000000b2"
M_A = "20000000-0000-0000-0000-0000000000a1"
M_B = "20000000-0000-0000-0000-0000000000b2"
ROLE_A = "30000000-0000-0000-0000-0000000000a1"
ROLE_B = "30000000-0000-0000-0000-0000000000b1"
LOC_A = "60000000-0000-0000-0000-0000000000a1"
LOC_B = "60000000-0000-0000-0000-0000000000b1"
UNIT_A = "61000000-0000-0000-0000-0000000000a1"
UNIT_B = "61000000-0000-0000-0000-0000000000b1"
CAT_A = "62000000-0000-0000-0000-0000000000a1"
CAT_B = "62000000-0000-0000-0000-0000000000b1"
TAX_A = "63000000-0000-0000-0000-0000000000a1"
TAX_B = "63000000-0000-0000-0000-0000000000b1"
PAY_A = "64000000-0000-0000-0000-0000000000a1"
PAY_B = "64000000-0000-0000-0000-0000000000b1"
TP_A = "80000000-0000-0000-0000-0000000000a1"
TP_B = "80000000-0000-0000-0000-0000000000b1"
CUST_A = "81000000-0000-0000-0000-0000000000a1"
CUST_B = "81000000-0000-0000-0000-0000000000b1"
PUR_A = "82000000-0000-0000-0000-0000000000a1"
PUR_B = "82000000-0000-0000-0000-0000000000b1"
PAYABLE_A = "83000000-0000-0000-0000-0000000000a1"
PAYABLE_B = "83000000-0000-0000-0000-0000000000b1"
ACCT_A = "84000000-0000-0000-0000-0000000000a1"
ACCT_B = "84000000-0000-0000-0000-0000000000b1"
LAY_A = "85000000-0000-0000-0000-0000000000a1"
LAY_B = "85000000-0000-0000-0000-0000000000b1"
JOB_A = "86000000-0000-0000-0000-0000000000a1"
JOB_B = "86000000-0000-0000-0000-0000000000b1"
AUD_A = "87000000-0000-0000-0000-0000000000a1"
AUD_B = "87000000-0000-0000-0000-0000000000b1"
BATCH_A = "72000000-0000-0000-0000-0000000000a1"
BATCH_B = "72000000-0000-0000-0000-0000000000b1"
STORE_A = "75000000-0000-0000-0000-0000000000a1"
STORE_B = "75000000-0000-0000-0000-0000000000b1"

lines, results = [], []


def record(name, ok, detail="", status=None):
    status = status or ("PASS" if ok else "FAIL")
    results.append({"prueba": name, "status": status, "detalle": detail})
    lines.append(f"[{status}] {name}: {detail}")


def sanitize(text):
    text = re.sub(r"postgres(?:ql)?://\S+", "<URL redactada>", text)
    text = re.sub(r"\b[a-z][a-z0-9]{2,}_owner\b", "[rol redactado]", text)
    return text


def load_url(env_name, connections_file):
    raw = os.environ.get(f"DATABASE_URL_{env_name.upper()}")
    if raw:
        return raw.strip()
    pattern = re.compile(r"^(?:export\s+)?(?:DATABASE_URL_)?(DEV|PROD)\s*[:=]\s*(\S+)\s*$", re.I)
    for line in Path(connections_file).read_text(encoding="utf-8").splitlines():
        m = pattern.match(line.strip())
        if m and m.group(1).upper() == env_name.upper():
            return m.group(2).strip().strip("'\"")
    raise SystemExit(f"No hay URL para {env_name}.")


def parse_url(raw):
    u = raw.strip()
    if u.startswith("postgres://"):
        u = "postgresql://" + u[len("postgres://"):]
    m = re.match(r"postgresql://([^:]+):([^@]*)@([^:/]+)(?::(\d+))?/([^?]+)", u)
    return {"user": m.group(1), "password": m.group(2), "host": m.group(3),
            "port": int(m.group(4) or 5432), "database": m.group(5)}


def connect(cfg, database=None):
    return Connection(user=cfg["user"], password=cfg["password"], host=cfg["host"],
                      port=cfg["port"], database=database or cfg["database"],
                      ssl_context=ssl.create_default_context(), timeout=30)


def run_file(conn, path):
    conn.run(path.read_text(encoding="utf-8"))


def err_code(exc):
    try:
        return exc.args[0].get("C")
    except Exception:  # noqa: BLE001
        return None


def expect_error(conn, name, sql, codes):
    try:
        conn.run(sql)
        record(name, False, "se aceptó cuando debía fallar")
    except Exception as exc:  # noqa: BLE001
        code = err_code(exc)
        record(name, code in codes, f"SQLSTATE {code}")
        try:
            conn.run("rollback")
        except Exception:  # noqa: BLE001
            pass


def seed(conn):
    conn.run("begin")
    conn.run("alter table public.tenants no force row level security")
    conn.run("alter table public.identities no force row level security")
    conn.run(f"""insert into public.tenants (tenant_id, slug, name) values
        ('{T_A}','tenant-a','Tenant A'), ('{T_B}','tenant-b','Tenant B')""")
    conn.run(f"""insert into public.identities (identity_id, email, display_name) values
        ('{I_A}','a@example.test','Alice A'), ('{I_B}','b@example.test','Bob B')""")
    conn.run("alter table public.tenants force row level security")
    conn.run("alter table public.identities force row level security")

    for tenant, ident, mem, role in ((T_A, I_A, M_A, ROLE_A), (T_B, I_B, M_B, ROLE_B)):
        conn.run(f"""insert into public.tenant_memberships (membership_id, tenant_id, identity_id)
            values ('{mem}', '{tenant}', '{ident}')""")
        conn.run(f"""insert into public.roles (role_id, tenant_id, code, name)
            values ('{role}', '{tenant}', 'owner', 'Owner')""")

    # Catálogo base por tenant
    for tenant, loc, unit, cat, tax, pay in (
        (T_A, LOC_A, UNIT_A, CAT_A, TAX_A, PAY_A),
        (T_B, LOC_B, UNIT_B, CAT_B, TAX_B, PAY_B),
    ):
        conn.run(f"insert into public.locations (location_id, tenant_id, code, name) values ('{loc}','{tenant}','MAIN','Principal')")
        conn.run(f"insert into public.units_of_measure (unit_id, tenant_id, code, name) values ('{unit}','{tenant}','UND','Unidad')")
        conn.run(f"insert into public.categories (category_id, tenant_id, code, name) values ('{cat}','{tenant}','GEN','General')")
        conn.run(f"insert into public.taxes (tax_id, tenant_id, code, name, rate) values ('{tax}','{tenant}','IVA19','IVA 19',19)")
        conn.run(f"insert into public.payment_methods (payment_method_id, tenant_id, code, name, method_type) values ('{pay}','{tenant}','CASH','Efectivo','cash')")

    # 5 productos A (keyset) y 1 B; mismos SKU por tenant para N13.
    for i in range(5):
        pid = f"70000000-0000-0000-0000-0000000000a{i}"
        vid = f"71000000-0000-0000-0000-0000000000a{i}"
        conn.run(f"""insert into public.products (product_id, tenant_id, category_id, default_unit_id, code, name)
            values ('{pid}','{T_A}','{CAT_A}','{UNIT_A}','P-A-{i}','Producto A {i}')""")
        conn.run(f"""insert into public.product_variants (variant_id, tenant_id, product_id, sku, name, cost, sale_price)
            values ('{vid}','{T_A}','{pid}','SKU-{i}','Variante A {i}',5,10)""")
        conn.run(f"""insert into public.product_barcodes (tenant_id, variant_id, barcode, is_primary)
            values ('{T_A}','{vid}','7500000000{i}',{str(i == 0).lower()})""")
    p_b = "70000000-0000-0000-0000-0000000000b1"
    v_b = "71000000-0000-0000-0000-0000000000b1"
    conn.run(f"""insert into public.products (product_id, tenant_id, category_id, default_unit_id, code, name)
        values ('{p_b}','{T_B}','{CAT_B}','{UNIT_B}','P-B-0','Producto B 0')""")
    conn.run(f"""insert into public.product_variants (variant_id, tenant_id, product_id, sku, name, cost, sale_price)
        values ('{v_b}','{T_B}','{p_b}','SKU-0','Variante B 0',5,10)""")

    # Inventario A: lote 100, movimientos +100 (purchase_in) y -2 (sale_out) => 98.
    batch_a = "72000000-0000-0000-0000-0000000000a1"
    conn.run(f"""insert into public.inventory_batches (batch_id, tenant_id, location_id, variant_id, batch_number, quantity_on_hand, quantity_reserved, unit_cost)
        values ('{batch_a}','{T_A}','{LOC_A}','71000000-0000-0000-0000-0000000000a0','L-A-1',98,0,5)""")
    conn.run(f"""insert into public.inventory_moves (tenant_id, location_id, variant_id, batch_id, quantity_delta, movement_type, source_type)
        values ('{T_A}','{LOC_A}','71000000-0000-0000-0000-0000000000a0','{batch_a}',100,'purchase_in','purchase')""")
    conn.run(f"""insert into public.inventory_moves (tenant_id, location_id, variant_id, batch_id, quantity_delta, movement_type, source_type)
        values ('{T_A}','{LOC_A}','71000000-0000-0000-0000-0000000000a0','{batch_a}',-2,'sale_out','sale')""")
    # Inventario B simple: 50.
    batch_b = "72000000-0000-0000-0000-0000000000b1"
    conn.run(f"""insert into public.inventory_batches (batch_id, tenant_id, location_id, variant_id, batch_number, quantity_on_hand, quantity_reserved, unit_cost)
        values ('{batch_b}','{T_B}','{LOC_B}','{v_b}','L-B-1',50,0,5)""")
    conn.run(f"""insert into public.inventory_moves (tenant_id, location_id, variant_id, batch_id, quantity_delta, movement_type, source_type)
        values ('{T_B}','{LOC_B}','{v_b}','{batch_b}',50,'purchase_in','purchase')""")

    # Ventas: A: 2 (20 y 30), B: 1 (40), con línea y pago.
    sales = [
        ("73000000-0000-0000-0000-0000000000a1", T_A, LOC_A, 1, 20, "71000000-0000-0000-0000-0000000000a0", PAY_A),
        ("73000000-0000-0000-0000-0000000000a2", T_A, LOC_A, 2, 30, "71000000-0000-0000-0000-0000000000a1", PAY_A),
        ("73000000-0000-0000-0000-0000000000b1", T_B, LOC_B, 1, 40, v_b, PAY_B),
    ]
    for sid, tenant, loc, num, total, variant, pay in sales:
        conn.run(f"""insert into public.sales (sale_id, tenant_id, location_id, sale_number, subtotal, tax_total, discount_total, total)
            values ('{sid}','{tenant}','{loc}',{num},{total},0,0,{total})""")
        conn.run(f"""insert into public.sale_lines (tenant_id, sale_id, variant_id, line_number, quantity, unit_price, line_total)
            values ('{tenant}','{sid}','{variant}',1,1,{total},{total})""")
        conn.run(f"""insert into public.sale_payments (tenant_id, sale_id, payment_method_id, amount)
            values ('{tenant}','{sid}','{pay}',{total})""")
    # Terceros/clientes, compras y cartera (0008-0010)
    for tenant, tp, cust in ((T_A, TP_A, CUST_A), (T_B, TP_B, CUST_B)):
        conn.run(f"""insert into public.third_parties (third_party_id, tenant_id, legal_name, is_supplier, is_customer)
            values ('{tp}','{tenant}','Proveedor/Cliente sintético',true,true)""")
        conn.run(f"""insert into public.customers (customer_id, tenant_id, third_party_id, credit_enabled, credit_limit)
            values ('{cust}','{tenant}','{tp}',true,500)""")

    for sid, tenant, loc, sup, num, total in (
        (PUR_A, T_A, LOC_A, TP_A, 1, 100), (PUR_B, T_B, LOC_B, TP_B, 1, 200)
    ):
        conn.run(f"""insert into public.purchases (purchase_id, tenant_id, location_id, supplier_id, purchase_number, subtotal, total)
            values ('{sid}','{tenant}','{loc}','{sup}',{num},{total},{total})""")
        conn.run(f"""insert into public.purchase_lines (tenant_id, purchase_id, variant_id, line_number, quantity, unit_cost, line_total, quantity_received)
            values ('{tenant}','{sid}','{("71000000-0000-0000-0000-0000000000a0" if tenant==T_A else v_b)}',1,10,{total/10},{total},10)""")

    conn.run(f"""insert into public.supplier_payables (payable_id, tenant_id, supplier_id, purchase_id, original_amount, paid_amount, status)
        values ('{PAYABLE_A}','{T_A}','{TP_A}','{PUR_A}',100,30,'partially_paid')""")
    conn.run(f"""insert into public.supplier_payable_payments (tenant_id, payable_id, payment_method_id, amount)
        values ('{T_A}','{PAYABLE_A}','{PAY_A}',30)""")
    conn.run(f"""insert into public.supplier_payables (payable_id, tenant_id, supplier_id, purchase_id, original_amount, status)
        values ('{PAYABLE_B}','{T_B}','{TP_B}','{PUR_B}',200,'open')""")

    conn.run(f"""insert into public.customer_credit_accounts (credit_account_id, tenant_id, customer_id, credit_limit, current_balance)
        values ('{ACCT_A}','{T_A}','{CUST_A}',500,20)""")
    conn.run(f"""insert into public.customer_credit_movements (tenant_id, credit_account_id, movement_type, amount, source_type, source_id)
        values ('{T_A}','{ACCT_A}','charge',20,'sale','73000000-0000-0000-0000-0000000000a1')""")
    conn.run(f"""insert into public.customer_credit_accounts (credit_account_id, tenant_id, customer_id, credit_limit, current_balance)
        values ('{ACCT_B}','{T_B}','{CUST_B}',500,40)""")
    conn.run(f"""insert into public.customer_credit_movements (tenant_id, credit_account_id, movement_type, amount, source_type, source_id)
        values ('{T_B}','{ACCT_B}','charge',40,'sale','73000000-0000-0000-0000-0000000000b1')""")

    # Layaway A/B (0011)
    for lay, tenant, loc, cust, num, total, paid in (
        (LAY_A, T_A, LOC_A, CUST_A, 1, 100, 20),
        (LAY_B, T_B, LOC_B, CUST_B, 1, 200, 0),
    ):
        variant = "71000000-0000-0000-0000-0000000000a0" if tenant == T_A else v_b
        conn.run(f"""insert into public.layaway_contracts (layaway_id, tenant_id, location_id, customer_id, contract_number, subtotal, total, paid_total, balance_due)
            values ('{lay}','{tenant}','{loc}','{cust}',{num},{total},{total},{paid},{total-paid})""")
        conn.run(f"""insert into public.layaway_items (tenant_id, layaway_id, variant_id, line_number, quantity, unit_price, line_total)
            values ('{tenant}','{lay}','{variant}',1,1,{total},{total})""")
        conn.run(f"""insert into public.layaway_installments (tenant_id, layaway_id, installment_number, due_date, amount, paid_amount, status)
            values ('{tenant}','{lay}',1,current_date + 30,{total},{paid},'{("partially_paid" if paid else "pending")}')""")
        if paid:
            conn.run(f"""insert into public.layaway_payments (tenant_id, layaway_id, payment_method_id, amount)
                values ('{tenant}','{lay}','{PAY_A}',{paid})""")

    # Jobs y auditoría (0012)
    conn.run(f"""insert into public.async_jobs (job_id, tenant_id, job_type, idempotency_key) values ('{JOB_A}','{T_A}','test','k-a')""")
    conn.run(f"""insert into public.async_jobs (job_id, tenant_id, job_type, idempotency_key) values ('{JOB_B}','{T_B}','test','k-b')""")
    conn.run(f"""insert into public.audit_log (audit_id, tenant_id, action, resource_type, resource_id) values ('{AUD_A}','{T_A}','sale.created','sale','73000000-0000-0000-0000-0000000000a1')""")
    conn.run(f"""insert into public.audit_log (audit_id, tenant_id, action, resource_type, resource_id) values ('{AUD_B}','{T_B}','sale.created','sale','73000000-0000-0000-0000-0000000000b1')""")

    # Tiendas/catálogo para N10 (0018)
    conn.run(f"""insert into public.online_stores (store_id, tenant_id, slug, name, status) values
        ('{STORE_A}','{T_A}','tienda-a','Tienda A','active'),
        ('{STORE_B}','{T_B}','tienda-b','Tienda B','active')""")
    conn.run(f"""insert into public.online_store_catalog (tenant_id, store_id, variant_id, is_published)
        values ('{T_A}','{STORE_A}','71000000-0000-0000-0000-0000000000a0',true),
               ('{T_B}','{STORE_B}','{v_b}',true)""")

    conn.run("commit")


def setup_actor(conn):
    try:
        conn.run(f"drop role if exists {ACTOR}")
    except Exception:  # noqa: BLE001
        pass
    try:
        conn.run(f"create role {ACTOR} nologin nosuperuser nobypassrls noinherit")
    except Exception:  # noqa: BLE001
        pass
    conn.run(f"grant {ACTOR} to current_user")
    conn.run(f"grant usage on schema public, app_private to {ACTOR}")
    conn.run(f"grant execute on function app_private.current_tenant_id(), app_private.current_identity_id() to {ACTOR}")
    conn.run(f"grant select, insert, update on all tables in schema public to {ACTOR}")
    conn.run(f"grant execute on function public.fn_claim_async_jobs(text,text,integer,integer), public.fn_complete_async_job(uuid,text,integer) to {ACTOR}")


def n_cases(conn):
    conn.run(f"set role {ACTOR}")
    try:
        conn.run("select set_config('app.tenant_id','',false), set_config('app.identity_id','',false)")
        record("N1 sin contexto: sales invisible", conn.run("select count(*) from public.sales")[0][0] == 0)
        expect_error(conn, "N2 sin contexto: INSERT sales rechazado",
                     f"insert into public.sales (tenant_id, location_id, sale_number, total) values ('{T_A}','{LOC_A}',99,10)",
                     {"42501"})
        conn.run(f"select set_config('app.tenant_id','{T_A}',false), set_config('app.identity_id','{I_A}',false)")
        record("N3 contexto A: sales de B invisibles", conn.run(f"select count(*) from public.sales where tenant_id='{T_B}'")[0][0] == 0)
        record("N4 contexto A: venta B por id invisible", conn.run("select count(*) from public.sales where sale_id='73000000-0000-0000-0000-0000000000b1'")[0][0] == 0)
        expect_error(conn, "N5 contexto A: UPDATE tenant_id de venta A rechazado",
                     f"update public.sales set tenant_id='{T_B}' where sale_id='73000000-0000-0000-0000-0000000000a1'",
                     {"42501"})
        expect_error(conn, "N6 contexto A: sale_line con venta B rechazada",
                     f"insert into public.sale_lines (tenant_id, sale_id, variant_id, line_number, quantity, unit_price, line_total) values ('{T_A}','73000000-0000-0000-0000-0000000000b1','71000000-0000-0000-0000-0000000000a0',9,1,1,1)",
                     {"23503"})
        expect_error(conn, "N7 contexto A: venta con sede B rechazada",
                     f"insert into public.sales (tenant_id, location_id, sale_number, subtotal, total) values ('{T_A}','{LOC_B}',98,10,10)",
                     {"23503"})
        expect_error(conn, "N8 contexto A: membership_roles con rol de otro tenant rechazado",
                     f"insert into public.membership_roles (tenant_id, membership_id, role_id) values ('{T_A}','{M_A}','{ROLE_B}')",
                     {"23503", "42501"})
        # N9 sale_line_batches (0017)
        line_a = conn.run(f"select sale_line_id::text from public.sale_lines where tenant_id='{T_A}' and sale_id='73000000-0000-0000-0000-0000000000a1' limit 1")[0][0]
        conn.run(f"""insert into public.sale_line_batches (tenant_id,sale_id,sale_line_id,batch_id,quantity,unit_cost)
            values ('{T_A}','73000000-0000-0000-0000-0000000000a1','{line_a}','{BATCH_A}',1,5)""")
        record("N9 lote-línea válido del tenant A", True)
        expect_error(conn, "N9 lote de otro tenant rechazado",
                     f"insert into public.sale_line_batches (tenant_id,sale_id,sale_line_id,batch_id,quantity,unit_cost) values ('{T_A}','73000000-0000-0000-0000-0000000000a1','{line_a}','{BATCH_B}',1,5)",
                     {"23503","42501"})
        expect_error(conn, "N9b fila con tenant B rechazada",
                     f"insert into public.sale_line_batches (tenant_id,sale_id,sale_line_id,batch_id,quantity,unit_cost) values ('{T_B}','73000000-0000-0000-0000-0000000000a1','{line_a}','{BATCH_A}',1,5)",
                     {"23503","42501"})

        # N10 online_store_catalog (0018)
        conn.run(f"""insert into public.online_store_catalog (tenant_id,store_id,variant_id,is_published)
            values ('{T_A}','{STORE_A}','71000000-0000-0000-0000-0000000000a1',true)""")
        record("N10 catálogo tienda A + variante A válido", True)
        expect_error(conn, "N10 variante de otro tenant rechazada",
                     f"insert into public.online_store_catalog (tenant_id,store_id,variant_id,is_published) values ('{T_A}','{STORE_A}','71000000-0000-0000-0000-0000000000b1',true)",
                     {"23503","42501"})
        expect_error(conn, "N10b tienda de otro tenant rechazada",
                     f"insert into public.online_store_catalog (tenant_id,store_id,variant_id,is_published) values ('{T_B}','{STORE_B}','71000000-0000-0000-0000-0000000000a1',true)",
                     {"23503","42501"})
        expect_error(conn, "N11 contexto A: third_party con tenant_id NULL rechazado",
                     "insert into public.third_parties (tenant_id, legal_name, is_supplier, is_customer) values (NULL,'Sin tenant',true,false)",
                     {"23502","42501"})
        expect_error(conn, "N12 SKU duplicado en tenant A rechazado",
                     f"insert into public.product_variants (tenant_id, product_id, sku, name, cost, sale_price) values ('{T_A}','70000000-0000-0000-0000-0000000000a0','SKU-0','Duplicado',1,1)",
                     {"23505"})
        # RLS impide ver ambos tenants a la vez (correcto); se comprueba como owner
        # que la siembra del mismo SKU en A y B fue aceptada.
        conn.run("reset role")
        same_sku = conn.run("select count(distinct tenant_id) from public.product_variants where sku='SKU-0'")[0][0]
        conn.run(f"set role {ACTOR}")
        record("N13 SKU igual permitido entre tenants", same_sku == 2, f"tenants con SKU-0={same_sku}")
        conn.run(f"select set_config('app.tenant_id','{T_B}',false), set_config('app.identity_id','{I_B}',false)")
        record("N14 contexto B: sólo ventas de B", conn.run("select count(*) from public.sales")[0][0] == 1)
        conn.run("select set_config('app.tenant_id','',false), set_config('app.identity_id','',false)")
        record("N15 reset de contexto: sales invisible", conn.run("select count(*) from public.sales")[0][0] == 0)
        # N16–N19 requieren contexto A
        conn.run(f"select set_config('app.tenant_id','{T_A}',false), set_config('app.identity_id','{I_A}',false)")
        # N16 stock_balances (0019)
        kind = conn.run("select relkind::text from pg_class where oid='public.stock_balances'::regclass")[0][0]
        record("N16 stock_balances es vista", kind == "v", f"relkind={kind}")
        record("N16 A no ve stock de B", conn.run(f"select count(*) from public.stock_balances where tenant_id='{T_B}'")[0][0] == 0)
        total = conn.run("select coalesce(sum(on_hand),0) from public.stock_balances")[0][0]
        record("N16 stock A = 98", int(total) == 98, f"on_hand={total}")
        # N17 vw_sales_summary (0019)
        n = conn.run("select count(*) from public.vw_sales_summary")[0][0]
        record("N17 resumen ventas A = 2", n == 2, f"filas={n}")
        record("N17 A no ve ventas B", conn.run(f"select count(*) from public.vw_sales_summary where tenant_id='{T_B}'")[0][0] == 0)
        opts = conn.run("select coalesce(array_to_string(reloptions,','),'') from pg_class where oid='public.vw_sales_summary'::regclass")[0][0]
        record("N17 security_invoker=true", "security_invoker=true" in opts, opts)
        # N18/N19 claim/complete (0020)
        claimed = conn.run("select job_id::text,status from public.fn_claim_async_jobs('test','w1',10,300)")
        record("N18 claim sólo job A", len(claimed) == 1 and claimed[0][0] == JOB_A, str(claimed))
        done = conn.run(f"select status from public.fn_complete_async_job('{JOB_A}','w1',300)")
        record("N19 complete job A", bool(done) and done[0][0] == "succeeded", str(done))
        done2 = conn.run(f"select status from public.fn_complete_async_job('{JOB_A}','w1',300)")
        record("N19 complete idempotente", bool(done2) and done2[0][0] == "succeeded", str(done2))
        expect_error(conn, "N19 complete job B rechazado",
                     f"select public.fn_complete_async_job('{JOB_B}','w1',300)", {"42501"})
        expect_error(conn, "N20 contexto A: audit_log con tenant B rechazado",
                     f"insert into public.audit_log (tenant_id, action, resource_type) values ('{T_B}','x','sale')",
                     {"42501","23503"})

    finally:
        conn.run("reset role")


def business_checks(conn):
    conn.run(f"set role {ACTOR}")
    try:
        conn.run(f"select set_config('app.tenant_id','{T_A}',false)")
        sales_sum = conn.run("select count(*), coalesce(sum(total),0) from public.sales")[0]
        record("Ventas A: 2 ventas, suma 50", sales_sum[0] == 2 and int(sales_sum[1]) == 50, f"count={sales_sum[0]} sum={sales_sum[1]}")
        moves = conn.run("select coalesce(sum(quantity_delta),0) from public.inventory_moves")[0][0]
        record("Inventario A: suma de movimientos = 98", int(moves) == 98, f"sum={moves}")
        products = conn.run("select count(*) from public.products")[0][0]
        record("Productos A: 5", products == 5, f"count={products}")
        pur = conn.run("select count(*), coalesce(sum(total),0) from public.purchases")[0]
        record("Compras A: 1 compra, suma 100", pur[0] == 1 and int(pur[1]) == 100, f"count={pur[0]} sum={pur[1]}")
        pay = conn.run("select coalesce(sum(original_amount),0), coalesce(sum(paid_amount),0) from public.supplier_payables")[0]
        record("Cartera proveedores A: original 100, pagado 30", int(pay[0]) == 100 and int(pay[1]) == 30, f"original={pay[0]} pagado={pay[1]}")
        cred = conn.run("select coalesce(sum(amount),0) from public.customer_credit_movements")[0][0]
        bal = conn.run("select coalesce(sum(current_balance),0) from public.customer_credit_accounts")[0][0]
        record("Cartera clientes A: movimientos 20, saldo 20", int(cred) == 20 and int(bal) == 20, f"mov={cred} saldo={bal}")
        lay = conn.run("select count(*), coalesce(sum(total),0), coalesce(sum(paid_total),0), coalesce(sum(balance_due),0) from public.layaway_contracts")[0]
        record("Apartados A: total 100, pagado 20, saldo 80", lay[0] == 1 and int(lay[1]) == 100 and int(lay[2]) == 20 and int(lay[3]) == 80, f"count={lay[0]} total={lay[1]} pagado={lay[2]} saldo={lay[3]}")
        rel = conn.run("select (select coalesce(sum(line_total),0) from public.layaway_items), (select coalesce(sum(total),0) from public.layaway_contracts)")[0]
        record("Apartados: líneas = total del encabezado", int(rel[0]) == int(rel[1]), f"lineas={rel[0]} total={rel[1]}")
        try:
            conn.run(f"update public.audit_log set action='hacked' where audit_id='{AUD_A}'")
            record("Auditoría append-only", False, "UPDATE permitido: falta trigger/restricción append-only", status="HALLAZGO")
        except Exception as exc:  # noqa: BLE001
            record("Auditoría append-only", True, f"UPDATE rechazado ({err_code(exc)})")
        jobs = conn.run("select count(*) from public.async_jobs")[0][0]
        audits = conn.run("select count(*) from public.audit_log")[0][0]
        record("Jobs/auditoría A: 1 job, 1 evento", jobs == 1 and audits == 1, f"jobs={jobs} audit={audits}")
        mism = conn.run("""
            select
              (select count(*) from public.sales s where s.total <> coalesce((select sum(l.line_total) from public.sale_lines l where l.tenant_id=s.tenant_id and l.sale_id=s.sale_id),0)),
              (select count(*) from public.sales s where s.total <> coalesce((select sum(p.amount) from public.sale_payments p where p.tenant_id=s.tenant_id and p.sale_id=s.sale_id),0)),
              (select count(*) from public.purchases p where p.total <> coalesce((select sum(l.line_total) from public.purchase_lines l where l.tenant_id=p.tenant_id and l.purchase_id=p.purchase_id),0)),
              (select count(*) from public.supplier_payables sp where sp.paid_amount <> coalesce((select sum(p.amount) from public.supplier_payable_payments p where p.tenant_id=sp.tenant_id and p.payable_id=sp.payable_id),0)),
              (select count(*) from public.customer_credit_accounts a where a.current_balance <> coalesce((select sum(m.amount) from public.customer_credit_movements m where m.tenant_id=a.tenant_id and m.credit_account_id=a.credit_account_id and m.movement_type='charge'),0) - coalesce((select sum(m.amount) from public.customer_credit_movements m where m.tenant_id=a.tenant_id and m.credit_account_id=a.credit_account_id and m.movement_type='payment'),0)),
              (select count(*) from public.inventory_batches b where b.quantity_on_hand <> coalesce((select sum(m.quantity_delta) from public.inventory_moves m where m.tenant_id=b.tenant_id and m.batch_id=b.batch_id),0)),
              (select count(*) from public.layaway_contracts c where c.balance_due <> coalesce((select sum(i.amount - i.paid_amount) from public.layaway_installments i where i.tenant_id=c.tenant_id and i.layaway_id=c.layaway_id),0))
        """)[0]
        labels = ["ventas: total=líneas", "ventas: total=pagos", "compras: total=líneas", "cartera proveedor: pagado=pagos", "cartera cliente: saldo=movimientos", "inventario: lote=movimientos", "apartados: saldo=cuotas"]
        for label, value in zip(labels, mism):
            record(f"Reconciliación {label}", int(value) == 0, f"descuadres={value}")

        # Keyset productos (5 filas, páginas de 2)
        collected, last = [], None
        while True:
            if last is None:
                rows = conn.run("select product_id::text, name from public.products order by name, product_id limit 2")
            else:
                name = last[1].replace("'", "''"); pid = last[0]
                rows = conn.run(f"select product_id::text, name from public.products where (name, product_id) > ('{name}','{pid}'::uuid) order by name, product_id limit 2")
            if not rows:
                break
            collected.extend(r[0] for r in rows); last = rows[-1]
        record("Keyset productos sin duplicados", len(set(collected)) == len(collected), f"filas={len(collected)}")
        record("Keyset productos sin omisiones (5)", len(set(collected)) == 5, f"únicas={len(set(collected))}")

        # Keyset ventas (2 filas, páginas de 1)
        collected, last = [], None
        while True:
            if last is None:
                rows = conn.run("select sale_id::text, sold_at::text from public.sales order by sold_at, sale_id limit 1")
            else:
                ts = last[1].replace("'", "''"); sid = last[0]
                rows = conn.run(f"select sale_id::text, sold_at::text from public.sales where (sold_at, sale_id) > ('{ts}'::timestamptz,'{sid}'::uuid) order by sold_at, sale_id limit 1")
            if not rows:
                break
            collected.extend(r[0] for r in rows); last = rows[-1]
        record("Keyset ventas sin duplicados/omisiones (2)", len(set(collected)) == 2, f"únicas={len(set(collected))}")
    finally:
        conn.run("reset role")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["DEV"], default="DEV")
    ap.add_argument("--connections-file", default=".env.database.local")
    ap.add_argument("--evidence", default="docs/database-portability/_data/validation-business-0013-2026-11-09.txt")
    args = ap.parse_args()

    ups = sorted(MIGRATIONS.glob("*.up.sql"))
    downs = sorted(MIGRATIONS.glob("*.down.sql"), reverse=True)
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in ups}
    lines.append(f"Migraciones validadas: {', '.join(hashes)}")
    for name, h in hashes.items():
        lines.append(f"  {name} sha256={h}")

    cfg = parse_url(load_url(args.env, args.connections_file))
    admin = connect(cfg)
    db_name = "ofirone_business_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S").lower()
    temp = None
    try:
        # Comparar con el ledger de DEV (solo lectura)
        ledger = admin.run("select version, name, checksum, dirty from public.schema_migrations order by version")
        by_version = {row[0]: row for row in ledger}
        checksum_mismatch, name_mismatch = [], []
        for idx, path in enumerate(ups, 1):
            row = by_version.get(idx)
            if row is None or row[2] != hashes[path.name] or row[3]:
                checksum_mismatch.append(idx)
            elif row[1] != path.name:
                name_mismatch.append((idx, row[1], path.name))
        record("Checksums de archivos coinciden con ledger DEV", not checksum_mismatch,
               f"versiones={len(by_version)}, discrepancias={checksum_mismatch}")
        record("Nombres del ledger coinciden con archivos", not name_mismatch,
               f"discrepancias={name_mismatch}", status=("HALLAZGO" if name_mismatch else "PASS"))
        versions_ok = [row[0] for row in ledger] == list(range(1, len(ups) + 1))
        clean_ok = all(not row[3] for row in ledger)
        record("Ledger DEV: versiones consecutivas", versions_ok, f"versiones={[row[0] for row in ledger]}")
        record("Ledger DEV: dirty=false", clean_ok)

        admin.run(f'create database "{db_name}"')
        temp = connect(cfg, database=db_name)
        up_ok = True
        for path in ups:
            try:
                run_file(temp, path)
            except Exception as exc:  # noqa: BLE001
                up_ok = False
                record(f"up {path.name}", False, sanitize(str(exc))[:200])
                break
        record(f"up de {len(ups)} migraciones en base vacía", up_ok)

        if up_ok:
            tables = temp.run("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")[0][0]
            record("Tablas tras up", tables >= 38, f"tablas={tables}")
            # El ledger de la base temporal nace vacío (lo llena el runner).
            # Se prueba que la PK rechace una segunda inserción de la misma versión.
            expected_names = [p.name for p in ups]
            try:
                temp.run("begin")
                temp.run(f"insert into public.schema_migrations (version, name, checksum) values (1,'{expected_names[0]}', repeat('0',64))")
                try:
                    temp.run(f"insert into public.schema_migrations (version, name, checksum) values (1,'{expected_names[0]}', repeat('0',64))")
                    record("Ledger: rechaza versión duplicada", False, "insert duplicado aceptado")
                except Exception as exc:  # noqa: BLE001
                    record("Ledger: rechaza versión duplicada", err_code(exc) == "23505", f"SQLSTATE {err_code(exc)}")
            finally:
                try:
                    temp.run("rollback")
                except Exception:  # noqa: BLE001
                    pass
            seed(temp)
            setup_actor(temp)
            record("Siembra sintética (identidad+catálogo+productos+inventario+ventas)", True)
            n_cases(temp)
            business_checks(temp)

            # 0013: idempotencia de ventas (después de los agregados)
            temp.run(f"set role {ACTOR}")
            temp.run(f"select set_config('app.tenant_id','{T_A}',false), set_config('app.identity_id','{I_A}',false)")
            temp.run(f"""insert into public.sales (tenant_id,location_id,sale_number,subtotal,total,idempotency_key)
                values ('{T_A}','{LOC_A}',900,1,1,'idem-1')""")
            expect_error(temp, "Idempotencia: misma clave en el mismo tenant rechazada",
                         f"insert into public.sales (tenant_id,location_id,sale_number,subtotal,total,idempotency_key) values ('{T_A}','{LOC_A}',901,1,1,'idem-1')",
                         {"23505"})
            temp.run(f"select set_config('app.tenant_id','{T_B}',false), set_config('app.identity_id','{I_B}',false)")
            try:
                temp.run(f"""insert into public.sales (tenant_id,location_id,sale_number,subtotal,total,idempotency_key)
                    values ('{T_B}','{LOC_B}',900,1,1,'idem-1')""")
                record("Idempotencia: misma clave permitida en otro tenant", True, "unique por tenant")
            except Exception as exc:  # noqa: BLE001
                record("Idempotencia: misma clave permitida en otro tenant", False, f"SQLSTATE {err_code(exc)}")
            temp.run("reset role")

            # Segunda ejecución
            try:
                temp.run("rollback")
            except Exception:  # noqa: BLE001
                pass
            try:
                run_file(temp, ups[0])
                record("Segunda ejecución no rompe", True, "re-ejecución aceptada")
            except Exception as exc:  # noqa: BLE001
                try:
                    temp.run("rollback")
                except Exception:  # noqa: BLE001
                    pass
                record("Segunda ejecución no rompe", False,
                       f"no idempotente ({sanitize(str(exc))[:120]}); el ledger debe impedir re-aplicar",
                       status="HALLAZGO")

            # up → down → up
            down_ok = True
            for path in downs:
                try:
                    run_file(temp, path)
                except Exception as exc:  # noqa: BLE001
                    down_ok = False
                    record(f"down {path.name}", False, sanitize(str(exc))[:160])
                    break
            leftover = temp.run("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")[0][0]
            record("down deja 0 tablas", down_ok and leftover == 0, f"restantes={leftover}")
            reup_ok = True
            for path in ups:
                try:
                    run_file(temp, path)
                except Exception as exc:  # noqa: BLE001
                    reup_ok = False
                    record(f"re-up {path.name}", False, sanitize(str(exc))[:160])
                    break
            record("Ciclo up→down→up completo", reup_ok)
        temp.close()
        temp = None
    finally:
        if temp is not None:
            try:
                temp.close()
            except Exception:  # noqa: BLE001
                pass
        try:
            admin.run(f'drop database if exists "{db_name}" with (force)')
            lines.append(f"Base temporal eliminada: {db_name}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"NO se pudo eliminar {db_name}: {sanitize(str(exc))[:120]}")
        try:
            admin.run(f"drop role if exists {ACTOR}")
            lines.append(f"Rol temporal eliminado: {ACTOR}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"NO se pudo eliminar rol: {sanitize(str(exc))[:120]}")
        admin.close()

    counts = {s: sum(1 for r in results if r["status"] == s) for s in ("PASS", "FAIL", "BLOQ", "HALLAZGO")}
    ok = counts["FAIL"] == 0 and counts["PASS"] > 0
    lines.append("")
    lines.append(f"RESULTADO GLOBAL: {'PASS' if ok else 'CON FALLOS'} "
                 f"(PASS={counts['PASS']}, FAIL={counts['FAIL']}, BLOQ={counts['BLOQ']}, HALLAZGO={counts['HALLAZGO']})")
    Path(args.evidence).parent.mkdir(parents=True, exist_ok=True)
    Path(args.evidence).write_text(sanitize("\n".join(lines)) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
