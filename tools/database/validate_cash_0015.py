#!/usr/bin/env python3
"""Slice G: validación de la migración 0015_cash_sessions en base desechable."""

import re
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path
from pg8000.native import Connection

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / "database" / "migrations"
T_A, T_B = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000b2"
I_A, I_B = "10000000-0000-0000-0000-0000000000a1", "10000000-0000-0000-0000-0000000000b2"
LOC_A, LOC_B = "60000000-0000-0000-0000-0000000000a1", "60000000-0000-0000-0000-0000000000b1"
PM_A = "64000000-0000-0000-0000-0000000000a1"
SES, SES_B = "90000000-0000-0000-0000-0000000000a1", "90000000-0000-0000-0000-0000000000b1"
lines, results = [], []


def record(name, ok, detail="", status=None):
    status = status or ("PASS" if ok else "FAIL")
    results.append(status)
    lines.append(f"[{status}] {name}: {detail}")


def load_cfg():
    raw = None
    for line in Path(".env.database.local").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(?:export\s+)?(?:DATABASE_URL_)?DEV\s*[:=]\s*(\S+)\s*$", line.strip(), re.I)
        if m:
            raw = m.group(1).strip().strip("'\"")
            break
    if not raw:
        sys.exit("No DATABASE_URL_DEV")
    u = raw.replace("postgres://", "postgresql://", 1)
    p = re.match(r"postgresql://([^:]+):([^@]*)@([^:/]+)(?::(\d+))?/([^?]+)", u)
    return {"user": p.group(1), "password": p.group(2), "host": p.group(3),
            "port": int(p.group(4) or 5432), "database": p.group(5)}


def connect(cfg, db=None):
    return Connection(user=cfg["user"], password=cfg["password"], host=cfg["host"],
                      port=cfg["port"], database=db or cfg["database"],
                      ssl_context=ssl.create_default_context(), timeout=60)


def code(exc):
    try:
        return exc.args[0].get("C")
    except Exception:  # noqa: BLE001
        return None


def expect(conn, label, sql, codes):
    try:
        conn.run(sql)
        record(label, False, "aceptado")
    except Exception as exc:  # noqa: BLE001
        record(label, code(exc) in codes, f"SQLSTATE {code(exc)}")
        try:
            conn.run("rollback")
        except Exception:  # noqa: BLE001
            pass


def main():
    cfg = load_cfg()
    admin = connect(cfg)
    name = "ofirone_cash_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S").lower()
    try:
        admin.run(f'create database "{name}"')
        c = connect(cfg, name)
        for path in sorted(MIG.glob("*.up.sql")):
            c.run(path.read_text(encoding="utf-8"))
        record("Migraciones 0001–0015 en base vacía", True)
        c.run(f"""insert into public.tenants (tenant_id,slug,name) values ('{T_A}','a','A'),('{T_B}','b','B');
          insert into public.identities (identity_id,email,display_name) values ('{I_A}','a@example.test','A'),('{I_B}','b@example.test','B');
          insert into public.locations (location_id,tenant_id,code,name) values ('{LOC_A}','{T_A}','MAIN','A'),('{LOC_B}','{T_B}','MAIN','B');
          insert into public.payment_methods (payment_method_id,tenant_id,code,name,method_type) values ('{PM_A}','{T_A}','CASH','Efectivo','cash');
          insert into public.cash_sessions (cash_session_id,tenant_id,location_id,opened_by_identity_id,opening_float,open_idempotency_key)
            values ('{SES_B}','{T_B}','{LOC_B}','{I_B}',50,'b-open');""")
        c.run("create role ofirone_cash_actor nologin nosuperuser nobypassrls nocreatedb nocreaterole")
        c.run("grant ofirone_cash_actor to current_user")
        c.run("grant usage on schema public, app_private to ofirone_cash_actor")
        c.run("grant execute on all functions in schema app_private to ofirone_cash_actor")
        c.run("grant select, insert, update on all tables in schema public to ofirone_cash_actor")
        c.run("set role ofirone_cash_actor")
        c.run(f"select set_config('app.tenant_id','{T_A}',false), set_config('app.identity_id','{I_A}',false)")
        c.run(f"insert into public.cash_sessions (cash_session_id,tenant_id,location_id,opened_by_identity_id,opening_float,open_idempotency_key) values ('{SES}','{T_A}','{LOC_A}','{I_A}',100,'open-1')")
        record("Sesión A abierta", True)
        expect(c, "Una sola sesión abierta por sede",
               f"insert into public.cash_sessions (tenant_id,location_id,opened_by_identity_id,opening_float,open_idempotency_key) values ('{T_A}','{LOC_A}','{I_A}',50,'open-2')", {"23505"})
        c.run(f"insert into public.sales (sale_id,tenant_id,location_id,sale_number,subtotal,total,cash_session_id) values ('73000000-0000-0000-0000-0000000000a1','{T_A}','{LOC_A}',1,20,20,'{SES}')")
        c.run(f"insert into public.sale_payments (tenant_id,sale_id,payment_method_id,amount) values ('{T_A}','73000000-0000-0000-0000-0000000000a1','{PM_A}',20)")
        record("Venta/pago cash en sesión abierta", True)
        c.run(f"insert into public.cash_session_counts (tenant_id,cash_session_id,denomination,quantity) values ('{T_A}','{SES}',50,2),('{T_A}','{SES}',20,1),('{T_A}','{SES}',10,1)")
        c.run(f"insert into public.cash_movements (tenant_id,cash_session_id,movement_type,direction,amount,created_by_identity_id,idempotency_key) values ('{T_A}','{SES}','cash_in','in',10,'{I_A}','mov-1')")
        record("Arqueo 130 y movimiento cash_in 10", True)
        c.run(f"update public.cash_sessions set status='closed',closed_by_identity_id='{I_A}',closed_at=clock_timestamp(),expected_cash=130,counted_cash=130,difference=0,close_idempotency_key='close-1' where cash_session_id='{SES}'")
        record("Cierre expected=counted=130, diferencia 0", True)
        expect(c, "Sesión cerrada inmutable", f"update public.cash_sessions set close_note='late' where cash_session_id='{SES}'", {"23514"})
        expect(c, "Venta después del cierre rechazada",
               f"insert into public.sales (tenant_id,location_id,sale_number,subtotal,total,cash_session_id) values ('{T_A}','{LOC_A}',2,5,5,'{SES}')", {"23514"})
        n = c.run(f"select count(*) from public.cash_sessions where cash_session_id='{SES_B}'")[0][0]
        record("RLS: A no ve sesión B", n == 0, f"filas={n}")
        expect(c, "Venta cross-tenant con sesión A rechazada",
               f"insert into public.sales (tenant_id,location_id,sale_number,subtotal,total,cash_session_id) values ('{T_B}','{LOC_B}',2,5,5,'{SES}')", {"23503", "23514", "42501"})
        c.run("reset role")
        # append-only como owner (el trigger aplica a todos)
        expect(c, "Movimiento append-only: UPDATE rechazado",
               f"update public.cash_movements set amount=20 where tenant_id='{T_A}' and idempotency_key='mov-1'", {"23514"})
        expect(c, "Movimiento append-only: DELETE rechazado",
               f"delete from public.cash_movements where tenant_id='{T_A}' and idempotency_key='mov-1'", {"23514"})
        c.run((MIG / "0015_cash_sessions.down.sql").read_text(encoding="utf-8"))
        tables = c.run("select count(*) from information_schema.tables where table_schema='public' and table_name in ('cash_sessions','cash_movements','cash_session_counts')")[0][0]
        col = c.run("select count(*) from information_schema.columns where table_schema='public' and table_name='sales' and column_name='cash_session_id'")[0][0]
        record("Down elimina caja y columna", tables == 0 and col == 0, f"tables={tables} col={col}")
        c.run((MIG / "0015_cash_sessions.up.sql").read_text(encoding="utf-8"))
        tables = c.run("select count(*) from information_schema.tables where table_schema='public' and table_name in ('cash_sessions','cash_movements','cash_session_counts')")[0][0]
        record("Re-up recrea 3 tablas", tables == 3, f"tables={tables}")
        c.close()
    except Exception as exc:  # noqa: BLE001
        record("Ejecución 0015", False, f"{type(exc).__name__} {code(exc)}: {str(exc)[:250]}")
    finally:
        try:
            admin.run(f'drop database if exists "{name}" with (force)')
        except Exception:  # noqa: BLE001
            pass
        try:
            admin.run("drop role if exists ofirone_cash_actor")
        except Exception:  # noqa: BLE001
            pass
        admin.close()
    fails = sum(1 for s in results if s == "FAIL")
    lines.append("")
    lines.append(f"RESULTADO: PASS={sum(1 for s in results if s == 'PASS')} FAIL={fails}")
    Path("docs/database-portability/_data/validation-cash-0015-2026-11-09.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
