#!/usr/bin/env python3
"""Valida la propuesta de roles (migrator/auth/api) en base desechable.

Comprueba mínimo privilegio y RLS con roles NOBYPASSRLS:
- API: lee/escribe su tenant, no lee ledger/identities, no crea tablas,
  no cruza tenant.
- AUTH: lee su identidad, no lee productos.
Elimina base y roles al final. Nunca PROD.
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
FIXTURES = ROOT / "docs/database-portability/_data/contracts/fixtures.sql"
API, AUTH, MIG = "ofirone_test_api", "ofirone_test_auth", "ofirone_test_migrator"
T_A = "00000000-0000-0000-0000-0000000000a1"
I_A = "10000000-0000-0000-0000-0000000000a1"


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


def main():
    cfg = parse_url(load_url())
    admin = connect(cfg)
    name = "ofirone_roles_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S").lower()
    lines, failures = ["Prueba de roles propuestos (NOBYPASSRLS)", "base=" + name], 0

    def ok(label, cond, detail=""):
        nonlocal failures
        lines.append(f"[{'PASS' if cond else 'FAIL'}] {label}: {detail}")
        failures += 0 if cond else 1

    def expect(conn, label, sql, codes):
        try:
            conn.run(sql)
            ok(label, False, "aceptado")
        except Exception as exc:  # noqa: BLE001
            got = code(exc)
            ok(label, got in codes, f"SQLSTATE {got}")

    try:
        admin.run(f'create database "{name}"')
        conn = connect(cfg, name)
        for path in sorted(MIGRATIONS.glob("*.up.sql")):
            conn.run(path.read_text(encoding="utf-8"))
        conn.run(FIXTURES.read_text(encoding="utf-8"))

        for role in (MIG, AUTH, API):
            try:
                conn.run(f"drop role if exists {role}")
            except Exception:  # noqa: BLE001
                pass
            conn.run(f"create role {role} nologin nosuperuser nobypassrls nocreatedb nocreaterole")
            conn.run(f"grant {role} to current_user")
        lines.append("[PASS] roles creados (migrator/auth/api, NOBYPASSRLS)")

        conn.run(f"grant usage on schema public, app_private to {API}")
        conn.run(f"grant execute on function app_private.current_tenant_id(), app_private.current_identity_id() to {API}")
        conn.run(f"grant select, insert, update on all tables in schema public to {API}")
        # Mínimo privilegio: API no toca ledger ni tablas de auth/identidad/roles.
        conn.run(f"revoke all on public.schema_migrations, public.identities, public.sessions, public.refresh_tokens, "
                 f"public.tenant_memberships, public.membership_roles, public.roles, public.role_permissions, public.permissions from {API}")

        conn.run(f"grant usage on schema public, app_private to {AUTH}")
        conn.run(f"grant execute on function app_private.current_tenant_id(), app_private.current_identity_id() to {AUTH}")
        conn.run(f"grant select, insert, update on public.identities, public.sessions, public.refresh_tokens, "
                 f"public.tenant_memberships, public.membership_roles, public.roles, public.role_permissions, public.permissions to {AUTH}")

        conn.run(f"set role {API}")
        conn.run(f"select set_config('app.tenant_id','{T_A}',false)")
        ok("API ve 1 producto de su tenant", conn.run("select count(*) from public.products")[0][0] == 1)
        ok("API ve 1 venta de su tenant", conn.run("select count(*) from public.sales")[0][0] == 1)
        expect(conn, "API no lee schema_migrations", "select count(*) from public.schema_migrations", {"42501"})
        expect(conn, "API no lee identities", "select count(*) from public.identities", {"42501"})
        expect(conn, "API no crea tablas", "create table public.hack(x int)", {"42501"})
        expect(conn, "API no inserta venta de otro tenant",
               f"insert into public.sales (tenant_id,location_id,sale_number,subtotal,total) values ('00000000-0000-0000-0000-0000000000b2','60000000-0000-0000-0000-0000000000a1',9,5,5)",
               {"42501", "23503"})
        expect(conn, "API no cambia tenant_id de venta",
               "update public.sales set tenant_id='00000000-0000-0000-0000-0000000000b2' where sale_id='73000000-0000-0000-0000-0000000000a1'",
               {"42501"})
        conn.run(f"insert into public.sales (tenant_id,location_id,sale_number,subtotal,total) values ('{T_A}','60000000-0000-0000-0000-0000000000a1',2,5,5)")
        ok("API inserta venta válida de su tenant", True)
        conn.run("reset role")

        conn.run(f"set role {AUTH}")
        conn.run(f"select set_config('app.tenant_id','{T_A}',false), set_config('app.identity_id','{I_A}',false)")
        ok("AUTH ve su identidad", conn.run("select count(*) from public.identities")[0][0] == 1)
        expect(conn, "AUTH no lee productos", "select count(*) from public.products", {"42501"})
        conn.run("reset role")

        rows = conn.run(f"select rolname, rolbypassrls from pg_roles where rolname in ('{API}','{AUTH}','{MIG}') order by 1")
        ok("roles sin BYPASSRLS", all(not r[1] for r in rows), str(rows))
        conn.close()
    except Exception as exc:  # noqa: BLE001
        lines.append(f"[FAIL] ejecución: {type(exc).__name__}: {str(exc)[:200]}")
        failures += 1
    finally:
        try:
            admin.run(f'drop database if exists "{name}" with (force)')
            lines.append("base temporal eliminada")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"drop db fail: {type(exc).__name__}")
        for role in (API, AUTH, MIG):
            try:
                admin.run(f"drop role if exists {role}")
            except Exception as exc:  # noqa: BLE001
                lines.append(f"drop role {role} fail: {type(exc).__name__}")
        admin.close()

    lines.append("")
    lines.append(f"RESULTADO GLOBAL: {'PASS' if failures == 0 else 'CON FALLOS'}")
    Path("docs/database-portability/_data/validation-runtime-roles-0012.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
