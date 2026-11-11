#!/usr/bin/env python3
"""Slice C: paginación keyset y rendimiento en base desechable.

Siembra >=120 filas por listado (productos, ventas, compras, movimientos),
prueba keyset con empates, página vacía, último cursor y cambio concurrente,
y ejecuta EXPLAIN (ANALYZE, BUFFERS) sobre las consultas keyset.
No toca PROD ni el esquema público de DEV; elimina base y rol al final.
"""

import argparse
import json
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
ACTOR = "ofirone_pagination_actor"

T_A = "00000000-0000-0000-0000-0000000000a1"
T_B = "00000000-0000-0000-0000-0000000000b2"
I_A = "10000000-0000-0000-0000-0000000000a1"
LOC_A = "60000000-0000-0000-0000-0000000000a1"
LOC_B = "60000000-0000-0000-0000-0000000000b1"
UNIT_A = "61000000-0000-0000-0000-0000000000a1"
CAT_A = "62000000-0000-0000-0000-0000000000a1"
PAY_A = "64000000-0000-0000-0000-0000000000a1"
TP_A = "80000000-0000-0000-0000-0000000000a1"
VAR_A = "71000000-0000-0000-0000-0000000000a0"
BATCH_A = "72000000-0000-0000-0000-0000000000a1"
PAGE = 17
N = 130

lines, results = [], []


def err_code(exc):
    try:
        return exc.args[0].get("C")
    except Exception:  # noqa: BLE001
        return None


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
                      ssl_context=ssl.create_default_context(), timeout=60)


def seed(conn):
    conn.run("begin")
    conn.run(f"insert into public.tenants (tenant_id, slug, name) values ('{T_A}','tenant-a','A'),('{T_B}','tenant-b','B')")
    conn.run(f"insert into public.identities (identity_id, email, display_name) values ('{I_A}','a@example.test','A')")
    conn.run(f"insert into public.locations (location_id, tenant_id, code, name) values ('{LOC_A}','{T_A}','A','A')")
    conn.run(f"insert into public.locations (location_id, tenant_id, code, name) values ('{LOC_B}','{T_B}','B','B')")
    conn.run(f"insert into public.units_of_measure (unit_id, tenant_id, code, name) values ('{UNIT_A}','{T_A}','UND','Unidad')")
    conn.run(f"insert into public.categories (category_id, tenant_id, code, name) values ('{CAT_A}','{T_A}','GEN','General')")
    conn.run(f"insert into public.payment_methods (payment_method_id, tenant_id, code, name, method_type) values ('{PAY_A}','{T_A}','CASH','Efectivo','cash')")
    conn.run(f"insert into public.third_parties (third_party_id, tenant_id, legal_name, is_supplier, is_customer) values ('{TP_A}','{T_A}','Proveedor A',true,false)")
    # 130 productos: grupos de 10 con el MISMO nombre (empates).
    for i in range(N):
        pid = f"70000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.products (product_id, tenant_id, category_id, default_unit_id, code, name)
            values ('{pid}','{T_A}','{CAT_A}','{UNIT_A}','P-{i:03d}','Producto {i//10:02d}')""")
    first_product = "70000000-0000-0000-0000-000000000000"
    # 130 variantes (una por producto) + la variante de inventario
    for i in range(N):
        vid = f"71000000-0000-0000-0000-{i:012d}"
        pid = f"70000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.product_variants (variant_id, tenant_id, product_id, sku, name, cost, sale_price)
            values ('{vid}','{T_A}','{pid}','SKU-{i:03d}','Variante {i:03d}',1,10)""")
    conn.run(f"""insert into public.product_variants (variant_id, tenant_id, product_id, sku, name, cost, sale_price)
        values ('{VAR_A}','{T_A}','{first_product}','SKU-0','Variante 0',1,10)""")
    conn.run(f"""insert into public.inventory_batches (batch_id, tenant_id, location_id, variant_id, batch_number, quantity_on_hand, quantity_reserved, unit_cost)
        values ('{BATCH_A}','{T_A}','{LOC_A}','{VAR_A}','L-1',1000,0,1)""")

    # 130 ventas con sold_at empatado en grupos de 10.
    for i in range(N):
        sid = f"73000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.sales (sale_id, tenant_id, location_id, sale_number, sold_at, subtotal, total)
            values ('{sid}','{T_A}','{LOC_A}',{i+1}, timestamptz '2026-01-01 00:00:00+00' + interval '{i//10} minute', 10, 10)""")

    # 130 compras con purchased_at empatado en grupos de 10.
    for i in range(N):
        pid = f"82000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.purchases (purchase_id, tenant_id, location_id, supplier_id, purchase_number, purchased_at, subtotal, total)
            values ('{pid}','{T_A}','{LOC_A}','{TP_A}',{i+1}, timestamptz '2026-01-01 00:00:00+00' + interval '{i//10} minute', 10, 10)""")

    # 130 movimientos de inventario.
    for i in range(N):
        conn.run(f"""insert into public.inventory_moves (tenant_id, location_id, variant_id, batch_id, quantity_delta, movement_type, source_type)
            values ('{T_A}','{LOC_A}','{VAR_A}','{BATCH_A}',1,'adjustment','test')""")

    # 130 terceros y clientes.
    for i in range(N):
        tp = f"88000000-0000-0000-0000-{i:012d}"
        cu = f"89000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.third_parties (third_party_id, tenant_id, legal_name, is_supplier, is_customer)
            values ('{tp}','{T_A}','Tercero {i:03d}',true,true)""")
        conn.run(f"""insert into public.customers (customer_id, tenant_id, third_party_id, credit_enabled, credit_limit)
            values ('{cu}','{T_A}','{tp}',true,500)""")

    # 130 apartados (encabezados).
    for i in range(N):
        lid = f"8a000000-0000-0000-0000-{i:012d}"
        cu = f"89000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.layaway_contracts (layaway_id, tenant_id, location_id, customer_id, contract_number, subtotal, total, paid_total, balance_due)
            values ('{lid}','{T_A}','{LOC_A}','{cu}',{i+1},100,100,0,100)""")

    # 130 jobs y 130 eventos de auditoría.
    for i in range(N):
        jid = f"8b000000-0000-0000-0000-{i:012d}"
        aid = f"8c000000-0000-0000-0000-{i:012d}"
        conn.run(f"""insert into public.async_jobs (job_id, tenant_id, job_type, idempotency_key)
            values ('{jid}','{T_A}','test','k-{i:03d}')""")
        conn.run(f"""insert into public.audit_log (audit_id, tenant_id, action, resource_type)
            values ('{aid}','{T_A}','test.event','sale')""")
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
    conn.run(f"grant select, insert on all tables in schema public to {ACTOR}")


def keyset(conn, table, cols, idcol, cursor_cols, casts, limit=PAGE, extra=""):
    collected, last = [], None
    pages = 0
    while True:
        where = f"where tenant_id='{T_A}' {extra}"
        params = ""
        if last is not None:
            vals = ", ".join(f"'{v}'::{c}" for v, c in zip(last, casts))
            cur = cursor_cols
            where += f" and ({cur}) > ({vals})"
        sql = f"select {idcol}::text, {cols} from public.{table} {where} order by {cursor_cols} limit {limit}"
        rows = conn.run(sql)
        if not rows:
            break
        pages += 1
        collected.extend(r[0] for r in rows)
        # Orden de cursor_cols: (columna_de_orden, id). Se guardan ambos.
        last = (rows[-1][1], rows[-1][0])
        if pages > 200:
            break
    return collected, pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["DEV"], default="DEV")
    ap.add_argument("--connections-file", default=".env.database.local")
    ap.add_argument("--evidence", default="docs/database-portability/_data/validation-pagination-0012-2026-11-09.txt")
    args = ap.parse_args()

    ups = sorted(MIGRATIONS.glob("*.up.sql"))
    cfg = parse_url(load_url(args.env, args.connections_file))
    admin = connect(cfg)
    db_name = "ofirone_pagination_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S").lower()
    temp = None
    try:
        admin.run(f'create database "{db_name}"')
        temp = connect(cfg, database=db_name)
        for path in ups:
            temp.run(path.read_text(encoding="utf-8"))
        lines.append(f"Migraciones aplicadas: {len(ups)}; filas por listado: {N}")
        seed(temp)
        setup_actor(temp)
        temp.run(f"set role {ACTOR}")
        temp.run(f"select set_config('app.tenant_id','{T_A}',false)")

        cases = [
            ("productos", "products", "name", "product_id", "name, product_id", ("text", "uuid")),
            ("ventas", "sales", "sold_at::text", "sale_id", "sold_at, sale_id", ("timestamptz", "uuid")),
            ("compras", "purchases", "purchased_at::text", "purchase_id", "purchased_at, purchase_id", ("timestamptz", "uuid")),
            ("movimientos", "inventory_moves", "created_at::text", "movement_id", "created_at, movement_id", ("timestamptz", "uuid")),
            ("clientes", "customers", "created_at::text", "customer_id", "created_at, customer_id", ("timestamptz", "uuid")),
            ("terceros", "third_parties", "legal_name", "third_party_id", "legal_name, third_party_id", ("text", "uuid")),
            ("variantes", "product_variants", "sku", "variant_id", "sku, variant_id", ("text", "uuid")),
            ("apartados", "layaway_contracts", "created_at::text", "layaway_id", "created_at, layaway_id", ("timestamptz", "uuid")),
            ("jobs", "async_jobs", "created_at::text", "job_id", "created_at, job_id", ("timestamptz", "uuid")),
            ("auditoría", "audit_log", "created_at::text", "audit_id", "created_at, audit_id", ("timestamptz", "uuid")),
        ]
        expected = {"terceros": N + 1, "variantes": N + 1}  # 130 + proveedor / variante de inventario
        for label, table, cols, idcol, order, casts in cases:
            ids, pages = keyset(temp, table, cols, idcol, order, casts)
            total = expected.get(label, N)
            record(f"Keyset {label}: {total} filas sin duplicados", len(ids) == len(set(ids)), f"filas={len(ids)} páginas={pages}")
            record(f"Keyset {label}: sin omisiones", len(set(ids)) == total, f"únicas={len(set(ids))} esperadas={total}")

        # EXT-08: cursor repetido (misma página dos veces), inválido y límite máximo.
        first = temp.run("select product_id::text,name from public.products where tenant_id='%s' order by name,product_id limit 17" % T_A)
        last = (first[-1][1], first[-1][0])
        def page_after(cursor):
            return temp.run(f"select product_id::text from public.products where tenant_id='{T_A}' and (name,product_id) > ('{cursor[0]}','{cursor[1]}'::uuid) order by name,product_id limit 17")
        p1, p2 = page_after(last), page_after(last)
        record("Cursor repetido devuelve la misma página", p1 == p2, f"filas={len(p1)}")
        try:
            temp.run(f"select product_id from public.products where tenant_id='{T_A}' and (name,product_id) > ('Producto 00','no-es-uuid'::uuid) limit 1")
            record("Cursor inválido rechazado", False, "aceptado")
        except Exception as exc:  # noqa: BLE001
            record("Cursor inválido rechazado", err_code(exc) in {"22P02","22007"}, f"SQLSTATE {err_code(exc)}")
        n = temp.run(f"select count(*) from (select product_id from public.products where tenant_id='{T_A}' order by name,product_id limit 1000) x")[0][0]
        record("Límite máximo devuelve el conjunto completo", n == 130, f"filas={n}")

        # Página vacía: cursor por encima del máximo.
        empty = temp.run("select count(*) from public.sales where (sold_at, sale_id) > (timestamptz '2030-01-01', gen_random_uuid())")[0][0]
        record("Página vacía tras el último cursor", empty == 0, f"filas={empty}")

        # Cambio concurrente: insertar una venta más nueva tras la primera página.
        first = temp.run("select sale_id::text, sold_at::text from public.sales order by sold_at, sale_id limit 1")[0]
        temp.run(f"""insert into public.sales (sale_id, tenant_id, location_id, sale_number, sold_at, subtotal, total)
            values (gen_random_uuid(),'{T_A}','{LOC_A}',9999, timestamptz '2030-01-01 00:00:00+00',10,10)""")
        rest = temp.run(f"select sale_id::text from public.sales where (sold_at, sale_id) > ('{first[1]}'::timestamptz, '{first[0]}'::uuid) order by sold_at, sale_id")
        record("Cambio concurrente aparece tras el cursor", any(r[0] != first[0] for r in rest), f"filas_siguientes={len(rest)}")

        # EXPLAIN (ANALYZE, BUFFERS) de keyset de ventas y productos.
        for label, sql in (
            ("ventas", "select sale_id from public.sales where (sold_at, sale_id) > (timestamptz '2026-01-01 00:00:00+00', gen_random_uuid()) order by sold_at, sale_id limit 17"),
            ("productos", "select product_id from public.products where (name, product_id) > ('Producto 00', gen_random_uuid()) order by name, product_id limit 17"),
            ("clientes", "select customer_id from public.customers where (created_at, customer_id) > (timestamptz '1970-01-01', gen_random_uuid()) order by created_at, customer_id limit 17"),
            ("jobs", "select job_id from public.async_jobs where (created_at, job_id) > (timestamptz '1970-01-01', gen_random_uuid()) order by created_at, job_id limit 17"),
        ):
            plan = temp.run(f"explain (analyze, buffers, format json) {sql}")[0][0]
            plan = plan if isinstance(plan, str) else json.dumps(plan, default=str)
            node = re.search(r'"Node Type":\s*"([^"]+)"', plan)
            idx = re.search(r'"Index Name":\s*"([^"]+)"', plan)
            record(f"EXPLAIN {label}", True,
                   f"nodo={node.group(1) if node else '?'}, índice={idx.group(1) if idx else 'ninguno'}")
            lines.append(f"  plan {label}: {plan[:400]}")

        temp.run("reset role")
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
                 f"(PASS={counts['PASS']}, FAIL={counts['FAIL']}, BLOQ={counts['BLOQ']})")
    Path(args.evidence).parent.mkdir(parents=True, exist_ok=True)
    Path(args.evidence).write_text(sanitize("\n".join(lines)) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
