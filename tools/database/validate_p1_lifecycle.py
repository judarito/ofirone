#!/usr/bin/env python3
"""P1: ciclo de vida administrativo en base desechable.

Compras (recepción parcial/cierre), apartados (abonos/cierre), aging de CxP,
sobrepago y brecha de conversión apartado→venta. Sin PROD; elimina la base.
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
T_A = "00000000-0000-0000-0000-0000000000a1"
I_A = "10000000-0000-0000-0000-0000000000a1"
LOC = "60000000-0000-0000-0000-0000000000a1"
UNIT = "61000000-0000-0000-0000-0000000000a1"
CAT = "62000000-0000-0000-0000-0000000000a1"
SUP = "80000000-0000-0000-0000-0000000000a1"
CUS = "81000000-0000-0000-0000-0000000000a1"
VAR = "71000000-0000-0000-0000-0000000000a1"
PUR = "82000000-0000-0000-0000-0000000000a1"
PAY1 = "83000000-0000-0000-0000-0000000000a1"
PAY2 = "83000000-0000-0000-0000-0000000000a2"
LAY = "85000000-0000-0000-0000-0000000000a1"
lines, results = [], []


def record(name, ok, detail="", status=None):
    status = status or ("PASS" if ok else "FAIL")
    results.append({"prueba": name, "status": status, "detalle": detail})
    lines.append(f"[{status}] {name}: {detail}")


def sanitize(text):
    return re.sub(r"postgres(?:ql)?://\S+", "<URL redactada>", text)


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


def code(exc):
    try:
        return exc.args[0].get("C")
    except Exception:  # noqa: BLE001
        return None


def expect(conn, name, sql, codes):
    try:
        conn.run(sql)
        record(name, False, "aceptado")
    except Exception as exc:  # noqa: BLE001
        record(name, code(exc) in codes, f"SQLSTATE {code(exc)}")
        try:
            conn.run("rollback")
        except Exception:  # noqa: BLE001
            pass


def main():
    cfg = parse_url(load_url())
    admin = connect(cfg)
    name = "ofirone_p1_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S").lower()
    try:
        admin.run(f'create database "{name}"')
        conn = connect(cfg, name)
        for path in sorted(MIGRATIONS.glob("*.up.sql")):
            conn.run(path.read_text(encoding="utf-8"))

        conn.run("begin")
        conn.run(f"insert into public.tenants (tenant_id,slug,name) values ('{T_A}','p1-a','P1 A')")
        conn.run(f"insert into public.identities (identity_id,email,display_name) values ('{I_A}','a@example.test','A')")
        conn.run(f"insert into public.locations (location_id,tenant_id,code,name) values ('{LOC}','{T_A}','MAIN','Main')")
        conn.run(f"insert into public.units_of_measure (unit_id,tenant_id,code,name) values ('{UNIT}','{T_A}','UND','Unidad')")
        conn.run(f"insert into public.categories (category_id,tenant_id,code,name) values ('{CAT}','{T_A}','GEN','Gen')")
        conn.run(f"insert into public.products (product_id,tenant_id,category_id,default_unit_id,code,name) values ('70000000-0000-0000-0000-0000000000a1','{T_A}','{CAT}','{UNIT}','P-1','P1')")
        conn.run(f"insert into public.product_variants (variant_id,tenant_id,product_id,sku,name,cost,sale_price) values ('{VAR}','{T_A}','70000000-0000-0000-0000-0000000000a1','SKU-1','V1',10,20)")
        conn.run(f"insert into public.third_parties (third_party_id,tenant_id,legal_name,is_supplier,is_customer) values ('{SUP}','{T_A}','Proveedor',true,false)")
        conn.run(f"insert into public.customers (customer_id,tenant_id,third_party_id) values ('{CUS}','{T_A}','{SUP}')")
        conn.run(f"insert into public.payment_methods (payment_method_id,tenant_id,code,name,method_type) values ('64000000-0000-0000-0000-0000000000a1','{T_A}','CASH','Efectivo','cash')")
        # Compra 10 unidades; una línea sin recibir
        conn.run(f"insert into public.purchases (purchase_id,tenant_id,location_id,supplier_id,purchase_number,status,subtotal,total) values ('{PUR}','{T_A}','{LOC}','{SUP}',1,'draft',100,100)")
        conn.run(f"insert into public.purchase_lines (tenant_id,purchase_id,variant_id,line_number,quantity,unit_cost,line_total,quantity_received) values ('{T_A}','{PUR}','{VAR}',1,10,10,100,0)")
        # CxP: una vencida hace 45 días y otra hace 5
        conn.run(f"insert into public.supplier_payables (payable_id,tenant_id,supplier_id,purchase_id,original_amount,paid_amount,status,due_date) values ('{PAY1}','{T_A}','{SUP}','{PUR}',100,30,'partially_paid',current_date - 45)")
        conn.run(f"insert into public.supplier_payables (payable_id,tenant_id,supplier_id,original_amount,status,due_date) values ('{PAY2}','{T_A}','{SUP}',50,'open',current_date - 5)")
        # Apartado 100, sin abonos
        conn.run(f"insert into public.layaway_contracts (layaway_id,tenant_id,location_id,customer_id,contract_number,subtotal,total,paid_total,balance_due) values ('{LAY}','{T_A}','{LOC}','{CUS}',1,100,100,0,100)")
        conn.run(f"insert into public.layaway_items (tenant_id,layaway_id,variant_id,line_number,quantity,unit_price,line_total) values ('{T_A}','{LAY}','{VAR}',1,1,100,100)")
        conn.run(f"insert into public.layaway_installments (tenant_id,layaway_id,installment_number,due_date,amount,paid_amount,status) values ('{T_A}','{LAY}',1,current_date + 30,100,0,'pending')")
        conn.run("commit")

        # Compra: recepción parcial y cierre
        conn.run(f"update public.purchase_lines set quantity_received=4 where tenant_id='{T_A}' and purchase_id='{PUR}'")
        conn.run(f"update public.purchases set status='ordered' where purchase_id='{PUR}'")
        conn.run(f"update public.purchases set status='partially_received' where purchase_id='{PUR}'")
        row = conn.run(f"select p.status,l.quantity_received from public.purchases p join public.purchase_lines l on l.tenant_id=p.tenant_id and l.purchase_id=p.purchase_id where p.purchase_id='{PUR}'")[0]
        record("P1 compra: recepción parcial 4/10", row[0] == "partially_received" and row[1] == 4, str(row))
        conn.run(f"update public.purchase_lines set quantity_received=10 where tenant_id='{T_A}' and purchase_id='{PUR}'")
        conn.run(f"update public.purchases set status='received' where purchase_id='{PUR}'")
        row = conn.run(f"select p.status,l.quantity_received from public.purchases p join public.purchase_lines l on l.tenant_id=p.tenant_id and l.purchase_id=p.purchase_id where p.purchase_id='{PUR}'")[0]
        record("P1 compra: recepción completa 10/10", row[0] == "received" and row[1] == 10, str(row))
        expect(conn, "P1 compra: recibir más de lo pedido rechazado",
               f"update public.purchase_lines set quantity_received=11 where tenant_id='{T_A}' and purchase_id='{PUR}'", {"23514"})
        expect(conn, "P1 compra: estado inválido rechazado",
               f"update public.purchases set status='bogus' where purchase_id='{PUR}'", {"23514"})
        try:
            conn.run("begin")
            conn.run(f"update public.purchases set status='draft' where purchase_id='{PUR}'")
            record("P1 compra: transición received→draft", False, "aceptada: no hay guard de transiciones de estado", status="HALLAZGO")
            conn.run("rollback")
        except Exception as exc:  # noqa: BLE001
            record("P1 compra: transición received→draft", True, f"rechazada ({code(exc)})")
            try:
                conn.run("rollback")
            except Exception:  # noqa: BLE001
                pass

        # Apartado: abonos y cierre
        conn.run(f"insert into public.layaway_payments (tenant_id,layaway_id,payment_method_id,amount) values ('{T_A}','{LAY}','64000000-0000-0000-0000-0000000000a1',40)")
        conn.run(f"update public.layaway_contracts set paid_total=40, balance_due=60, status='active' where layaway_id='{LAY}'")
        conn.run(f"update public.layaway_installments set paid_amount=40, status='partially_paid' where tenant_id='{T_A}' and layaway_id='{LAY}'")
        row = conn.run(f"select paid_total,balance_due from public.layaway_contracts where layaway_id='{LAY}'")[0]
        record("P1 apartado: abono 40, saldo 60", int(row[0]) == 40 and int(row[1]) == 60, str(row))
        conn.run(f"update public.layaway_contracts set paid_total=100, balance_due=0, status='completed' where layaway_id='{LAY}'")
        conn.run(f"update public.layaway_installments set paid_amount=100, status='paid' where tenant_id='{T_A}' and layaway_id='{LAY}'")
        record("P1 apartado: cierre pagado", conn.run(f"select status,balance_due from public.layaway_contracts where layaway_id='{LAY}'")[0] == ["completed", 0])
        expect(conn, "P1 apartado: sobrepago rechazado",
               f"update public.layaway_contracts set paid_total=110, balance_due=0 where layaway_id='{LAY}'", {"23514"})
        link = conn.run("select count(*) from information_schema.columns where table_schema='public' and ((table_name='sales' and column_name in ('layaway_id','layaway_contract_id')) or (table_name='layaway_contracts' and column_name='sale_id'))")[0][0]
        record("P1 apartado→venta", link > 0, "sin columna de conversión; brecha P1" if link == 0 else "existe enlace", status=("PASS" if link else "BLOQ-P1"))

        # Aging CxP
        aging = conn.run(f"""select case when current_date - due_date <= 30 then '0-30'
                                      when current_date - due_date <= 60 then '31-60' else '>60' end bucket,
                                      sum(original_amount - paid_amount)
                               from public.supplier_payables
                               where tenant_id='{T_A}' and status in ('open','partially_paid') and due_date is not null
                               group by 1 order by 1""")
        got = {r[0]: int(r[1]) for r in aging}
        record("P1 aging CxP: 0-30=50 y 31-60=70", got == {"0-30": 50, "31-60": 70}, str(got))

        # Sobrepago de CxP: no hay guard que sume pagos vs original
        try:
            conn.run(f"insert into public.supplier_payable_payments (tenant_id,payable_id,payment_method_id,amount) values ('{T_A}','{PAY1}','64000000-0000-0000-0000-0000000000a1',80)")
            record("P1 CxP: pago que excede el saldo", False, "aceptado: falta control de sobrepago", status="HALLAZGO")
        except Exception as exc:  # noqa: BLE001
            record("P1 CxP: pago que excede el saldo", True, f"rechazado ({code(exc)})")

        conn.close()
    except Exception as exc:  # noqa: BLE001
        record("Ejecución P1", False, f"{type(exc).__name__} {code(exc)}: {str(exc)[:200]}")
    finally:
        try:
            admin.run(f'drop database if exists "{name}" with (force)')
            lines.append(f"Base temporal eliminada: {name}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"drop fail: {type(exc).__name__}")
        admin.close()

    counts = {s: sum(1 for r in results if r["status"] == s) for s in ("PASS", "FAIL", "BLOQ-P1", "HALLAZGO")}
    lines.append("")
    lines.append(f"RESULTADO: PASS={counts['PASS']} FAIL={counts['FAIL']} BLOQ-P1={counts['BLOQ-P1']} HALLAZGO={counts['HALLAZGO']}")
    Path("docs/database-portability/_data/validation-p1-lifecycle-0012.txt").write_text(sanitize("\n".join(lines)) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if counts["FAIL"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
