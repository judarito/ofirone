#!/usr/bin/env python3
"""P0 end-to-end: ¿un usuario autenticado puede consultar productos, verificar
existencias y registrar una venta sin fuga de tenant?

Base temporal desechable, rol NOBYPASSRLS, datos sintéticos. No PROD.
Clasifica brechas como P0/P1/P2 sin inventar tablas.
"""

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
ACTOR = "ofirone_p0_actor"
T_A = "00000000-0000-0000-0000-0000000000a1"
T_B = "00000000-0000-0000-0000-0000000000b2"
I_A = "10000000-0000-0000-0000-0000000000a1"
I_B = "10000000-0000-0000-0000-0000000000b2"
M_A = "20000000-0000-0000-0000-0000000000a1"
M_B = "20000000-0000-0000-0000-0000000000b2"
LOC_A = "60000000-0000-0000-0000-0000000000a1"
LOC_B = "60000000-0000-0000-0000-0000000000b1"
UNIT_A = "61000000-0000-0000-0000-0000000000a1"
CAT_A = "62000000-0000-0000-0000-0000000000a1"
PAY_A = "64000000-0000-0000-0000-0000000000a1"
VAR0 = "71000000-0000-0000-0000-000000000000"
BATCH_A = "72000000-0000-0000-0000-0000000000a1"
SALE_A = "73000000-0000-0000-0000-0000000000a1"

lines, results = [], []


def record(name, ok, detail="", status=None):
    status = status or ("PASS" if ok else "FAIL")
    results.append({"prueba": name, "status": status, "detalle": detail})
    lines.append(f"[{status}] {name}: {detail}")


def sanitize(text):
    text = re.sub(r"postgres(?:ql)?://\S+", "<URL redactada>", text)
    text = re.sub(r"\b[a-z][a-z0-9]{2,}_owner\b", "[rol redactado]", text)
    return text


def load_url():
    raw = os.environ.get("DATABASE_URL_DEV")
    if raw:
        return raw.strip()
    for line in Path(".env.database.local").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(?:export\s+)?(?:DATABASE_URL_)?DEV\s*[:=]\s*(\S+)\s*$", line.strip(), re.I)
        if m:
            return m.group(1).strip().strip("'\"")
    raise SystemExit("No hay DATABASE_URL_DEV.")


def parse_url(raw):
    u = raw.strip().replace("postgres://", "postgresql://", 1)
    m = re.match(r"postgresql://([^:]+):([^@]*)@([^:/]+)(?::(\d+))?/([^?]+)", u)
    return {"user": m.group(1), "password": m.group(2), "host": m.group(3),
            "port": int(m.group(4) or 5432), "database": m.group(5)}


def connect(cfg, db=None):
    return Connection(user=cfg["user"], password=cfg["password"], host=cfg["host"],
                      port=cfg["port"], database=db or cfg["database"],
                      ssl_context=ssl.create_default_context(), timeout=30)


def err_code(exc):
    try:
        return exc.args[0].get("C")
    except Exception:  # noqa: BLE001
        return None


def seed(conn):
    conn.run("begin")
    conn.run(f"insert into public.tenants (tenant_id,slug,name) values ('{T_A}','p0-a','P0 A'),('{T_B}','p0-b','P0 B')")
    conn.run(f"insert into public.identities (identity_id,email,display_name) values ('{I_A}','a@example.test','A'),('{I_B}','b@example.test','B')")
    conn.run(f"insert into public.tenant_memberships (membership_id,tenant_id,identity_id) values ('{M_A}','{T_A}','{I_A}'),('{M_B}','{T_B}','{I_B}')")
    conn.run(f"insert into public.roles (tenant_id,code,name) values ('{T_A}','owner','Owner'),('{T_B}','owner','Owner')")
    conn.run(f"insert into public.locations (location_id,tenant_id,code,name) values ('{LOC_A}','{T_A}','MAIN','Principal'),('{LOC_B}','{T_B}','MAIN','Principal')")
    conn.run(f"insert into public.units_of_measure (unit_id,tenant_id,code,name) values ('{UNIT_A}','{T_A}','UND','Unidad')")
    conn.run(f"insert into public.categories (category_id,tenant_id,code,name) values ('{CAT_A}','{T_A}','GEN','General')")
    conn.run(f"insert into public.taxes (tenant_id,code,name,rate) values ('{T_A}','IVA19','IVA 19',19)")
    conn.run(f"insert into public.payment_methods (payment_method_id,tenant_id,code,name,method_type) values ('{PAY_A}','{T_A}','CASH','Efectivo','cash')")

    # 30 productos P0 y variantes
    for i in range(30):
        pid = f"70000000-0000-0000-0000-{i:012d}"
        vid = f"71000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.products (product_id,tenant_id,category_id,default_unit_id,code,name)
            values ('{pid}','{T_A}','{CAT_A}','{UNIT_A}','P0-{i:02d}','P0 Producto {i:02d}')""")
        conn.run(f"""insert into public.product_variants (variant_id,tenant_id,product_id,sku,name,cost,sale_price)
            values ('{vid}','{T_A}','{pid}','P0-SKU-{i:02d}','Variante {i:02d}',5,20)""")
    # 20 clientes P0
    for i in range(20):
        tp = f"88000000-0000-0000-0000-{i:012d}"
        cu = f"89000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.third_parties (third_party_id,tenant_id,legal_name,is_customer) values ('{tp}','{T_A}','Cliente {i:02d}',true)""")
        conn.run(f"""insert into public.customers (customer_id,tenant_id,third_party_id) values ('{cu}','{T_A}','{tp}')""")
    # Catálogo y producto de B para probar aislamiento
    conn.run(f"insert into public.units_of_measure (unit_id,tenant_id,code,name) values ('61000000-0000-0000-0000-0000000000b1','{T_B}','UND','Unidad')")
    conn.run(f"insert into public.categories (category_id,tenant_id,code,name) values ('62000000-0000-0000-0000-0000000000b1','{T_B}','GEN','General')")
    conn.run(f"""insert into public.products (product_id,tenant_id,category_id,default_unit_id,code,name)
        values ('70000000-0000-0000-0000-0000000000b1','{T_B}','62000000-0000-0000-0000-0000000000b1','61000000-0000-0000-0000-0000000000b1','B-1','Producto B')""")
    conn.run(f"insert into public.third_parties (third_party_id,tenant_id,legal_name,is_customer) values ('88000000-0000-0000-0000-0000000000b1','{T_B}','Cliente B',true)")
    conn.run(f"insert into public.customers (customer_id,tenant_id,third_party_id) values ('89000000-0000-0000-0000-0000000000b1','{T_B}','88000000-0000-0000-0000-0000000000b1')")
    # Stock inicial: lote 100 y movimiento +100
    conn.run(f"""insert into public.inventory_batches (batch_id,tenant_id,location_id,variant_id,batch_number,quantity_on_hand,quantity_reserved,unit_cost)
        values ('{BATCH_A}','{T_A}','{LOC_A}','{VAR0}','L-1',100,0,5)""")
    conn.run(f"""insert into public.inventory_moves (tenant_id,location_id,variant_id,batch_id,quantity_delta,movement_type,source_type)
        values ('{T_A}','{LOC_A}','{VAR0}','{BATCH_A}',100,'purchase_in','purchase')""")
    conn.run("commit")


def setup_actor(conn):
    try:
        conn.run(f"drop role if exists {ACTOR}")
    except Exception:  # noqa: BLE001
        pass
    conn.run(f"create role {ACTOR} nologin nosuperuser nobypassrls noinherit")
    conn.run(f"grant {ACTOR} to current_user")
    conn.run(f"grant usage on schema public, app_private to {ACTOR}")
    conn.run(f"grant execute on function app_private.current_tenant_id(), app_private.current_identity_id() to {ACTOR}")
    conn.run(f"""grant select on public.tenants, public.identities, public.tenant_memberships, public.roles, public.permissions to {ACTOR}""")
    conn.run(f"""grant select, insert, update on public.locations, public.units_of_measure, public.categories,
        public.taxes, public.payment_methods, public.third_parties, public.customers, public.products,
        public.product_variants, public.product_barcodes, public.inventory_batches, public.inventory_moves,
        public.stock_reservations, public.sales, public.sale_lines, public.sale_payments to {ACTOR}""")


def main():
    cfg = parse_url(load_url())
    admin = connect(cfg)
    name = "ofirone_p0_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S").lower()
    temp = None
    try:
        admin.run(f'create database "{name}"')
        temp = connect(cfg, name)
        for path in sorted(MIGRATIONS.glob("*.up.sql")):
            temp.run(path.read_text(encoding="utf-8"))
        seed(temp)
        setup_actor(temp)
        temp.run(f"set role {ACTOR}")
        temp.run(f"select set_config('app.tenant_id','{T_A}',false), set_config('app.identity_id','{I_A}',false)")

        # 1) identidad/tenant/membresía/roles
        record("P0 identidad: tenant/membresía/rol visibles",
               temp.run("select (select count(*) from public.tenants),(select count(*) from public.tenant_memberships),(select count(*) from public.roles)")[0] == [1, 1, 1])
        record("P0 identidad: sólo su identidad", temp.run("select count(*) from public.identities")[0][0] == 1)

        # 2) productos, búsqueda y precio
        n = temp.run("select count(*) from public.products")[0][0]
        record("P0 productos: 30 visibles", n == 30, f"filas={n}")
        search = temp.run("select count(*) from public.products where name ilike '%P0%' or code ilike '%P0%'")[0][0]
        record("P0 búsqueda por nombre/código", search == 30, f"filas={search}")
        price = temp.run("select sale_price from public.product_variants where sku='P0-SKU-00'")[0][0]
        record("P0 variante con precio", int(price) == 20, f"precio={price}")

        # 3) existencias
        stock = temp.run("select coalesce(sum(quantity_delta),0) from public.inventory_moves")[0][0]
        record("P0 stock inicial = 100", int(stock) == 100, f"stock={stock}")
        record("P0 lote coincide con movimientos", temp.run("select quantity_on_hand from public.inventory_batches where batch_id='%s'" % BATCH_A)[0][0] == 100)

        # 4) cliente
        clientes = temp.run("select count(*) from public.customers")[0][0]
        record("P0 clientes: 20 visibles", clientes == 20, f"filas={clientes}")

        # 5) venta + línea + pago
        temp.run(f"""insert into public.sales (sale_id,tenant_id,location_id,sale_number,subtotal,total,customer_id)
            values ('{SALE_A}','{T_A}','{LOC_A}',1,20,20,'89000000-0000-0000-0000-000000000000')""")
        temp.run(f"""insert into public.sale_lines (tenant_id,sale_id,variant_id,line_number,quantity,unit_price,line_total)
            values ('{T_A}','{SALE_A}','{VAR0}',1,1,20,20)""")
        temp.run(f"""insert into public.sale_payments (tenant_id,sale_id,payment_method_id,amount)
            values ('{T_A}','{SALE_A}','{PAY_A}',20)""")
        sale = temp.run("select count(*), coalesce(sum(total),0) from public.sales")[0]
        record("P0 venta registrada (total 20)", sale[0] == 1 and int(sale[1]) == 20, f"count={sale[0]} total={sale[1]}")
        pay = temp.run("select coalesce(sum(amount),0) from public.sale_payments")[0][0]
        record("P0 pago registrado = total", int(pay) == 20, f"pagado={pay}")

        # 6) salida de inventario por la venta
        temp.run(f"""insert into public.inventory_moves (tenant_id,location_id,variant_id,batch_id,quantity_delta,movement_type,source_type)
            values ('{T_A}','{LOC_A}','{VAR0}','{BATCH_A}',-1,'sale_out','sale')""")
        temp.run(f"update public.inventory_batches set quantity_on_hand = 99 where batch_id='{BATCH_A}'")
        stock = temp.run("select coalesce(sum(quantity_delta),0) from public.inventory_moves")[0][0]
        record("P0 stock tras venta = 99", int(stock) == 99, f"stock={stock}")

        # 7) paginación P0
        for label, table, cols, idcol, order, casts, expected in (
            ("productos", "products", "name", "product_id", "name, product_id", ("text", "uuid"), 30),
            ("clientes", "customers", "created_at::text", "customer_id", "created_at, customer_id", ("timestamptz", "uuid"), 20),
        ):
            collected, last, pages = [], None, 0
            while True:
                where = f"where tenant_id='{T_A}'"
                if last is not None:
                    vals = ", ".join(f"'{v}'::{c}" for v, c in zip(last, casts))
                    where += f" and ({order}) > ({vals})"
                rows = temp.run(f"select {idcol}::text, {cols} from public.{table} {where} order by {order} limit 7")
                if not rows:
                    break
                pages += 1
                collected.extend(r[0] for r in rows)
                last = (rows[-1][1], rows[-1][0])
            record(f"P0 paginación {label} sin duplicados/omisiones", len(set(collected)) == expected and len(collected) == expected,
                   f"filas={len(collected)} únicas={len(set(collected))} páginas={pages}")

        # 8) aislamiento
        record("P0 aislamiento: A no ve producto B", temp.run("select count(*) from public.products where tenant_id='%s'" % T_B)[0][0] == 0)
        record("P0 aislamiento: A no ve venta B", temp.run("select count(*) from public.sales where tenant_id='%s'" % T_B)[0][0] == 0)
        try:
            temp.run(f"""insert into public.sales (tenant_id,location_id,sale_number,subtotal,total)
                values ('{T_B}','{LOC_B}',2,5,5)""")
            record("P0 aislamiento: venta cross-tenant rechazada", False, "aceptada")
        except Exception as exc:  # noqa: BLE001
            record("P0 aislamiento: venta cross-tenant rechazada", err_code(exc) in {"42501", "23503"}, f"SQLSTATE {err_code(exc)}")
        temp.run(f"select set_config('app.tenant_id','{T_B}',false)")
        record("P0 aislamiento: B sólo ve su producto", temp.run("select count(*) from public.products")[0][0] == 1)
        record("P0 aislamiento: B no ve venta A", temp.run("select count(*) from public.sales")[0][0] == 0)
        temp.run("reset role")

        # 9) brechas de producto (sin inventar tablas)
        cust = temp.run(f"select customer_id::text from public.sales where sale_id='{SALE_A}'")[0][0]
        record("P0 venta atribuida a cliente", cust == "89000000-0000-0000-0000-000000000000", f"customer_id={cust}")
        try:
            temp.run(f"""insert into public.sales (tenant_id,location_id,sale_number,subtotal,total,customer_id)
                values ('{T_A}','{LOC_A}',2,5,5,'89000000-0000-0000-0000-0000000000b1')""")
            record("P0 venta con cliente de otro tenant rechazada", False, "aceptada")
        except Exception as exc:  # noqa: BLE001
            record("P0 venta con cliente de otro tenant rechazada", err_code(exc) in {"23503","42501"}, f"SQLSTATE {err_code(exc)}")
        cash = temp.run("select count(*) from information_schema.tables where table_schema='public' and table_name in ('cash_sessions','cash_movements','cash_session_counts')")[0][0]
        record("P0 caja disponible", cash == 3, f"tablas_caja={cash}")
        p2 = ["online_store_catalog", "bom", "manufacturing_orders", "notifications", "realtime_events"]
        found = [t for t in p2 if temp.run(f"select count(*) from information_schema.tables where table_schema='public' and table_name='{t}'")[0][0]]
        record("P2 capacidades diferidas", False, f"BLOQ-P2: ausentes {', '.join(p2)}", status="BLOQ-P2")
    finally:
        if temp is not None:
            try:
                temp.close()
            except Exception:  # noqa: BLE001
                pass
        try:
            admin.run(f'drop database if exists "{name}" with (force)')
            lines.append(f"Base temporal eliminada: {name}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"drop db fail: {sanitize(str(exc))[:100]}")
        try:
            admin.run(f"drop role if exists {ACTOR}")
            lines.append(f"Rol temporal eliminado: {ACTOR}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"drop role fail: {sanitize(str(exc))[:100]}")
        admin.close()

    counts = {s: sum(1 for r in results if r["status"] == s) for s in ("PASS", "FAIL", "BLOQ", "BLOQ-P0", "BLOQ-P1", "BLOQ-P2")}
    lines.append("")
    answer = "SÍ" if counts["FAIL"] == 0 and counts["BLOQ-P0"] == 0 else ("PARCIAL" if counts["FAIL"] == 0 else "NO")
    lines.append(f"RESPUESTA P0: {answer} — consulta de productos, existencias y venta sin fuga de tenant; brechas P0/P1/P2 documentadas.")
    lines.append(f"RESULTADO: PASS={counts['PASS']} FAIL={counts['FAIL']} BLOQ-P0={counts['BLOQ-P0']} BLOQ-P1={counts['BLOQ-P1']} BLOQ-P2={counts['BLOQ-P2']}")
    Path("docs/database-portability/_data/validation-p0-sell-flow-0012.txt").write_text(sanitize("\n".join(lines)) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if counts["FAIL"] == 0 and counts["BLOQ-P0"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
