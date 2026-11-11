#!/usr/bin/env python3
"""Validación en base PostgreSQL desechable (nunca PROD, nunca esquema DEV compartido).

Crea una base temporal en el servidor de DEV, aplica el baseline portable
(0001-0003), siembra datos SINTÉTICOS, ejecuta pruebas de aislamiento y keyset,
prueba segunda ejecución y up→down→up, y ELIMINA la base al finalizar.

Restricciones de seguridad:
- Solo --env DEV; PROD se rechaza siempre.
- Ningún dato real: UUID/emails sintéticos (*.example.test).
- No imprime URLs ni credenciales; los roles *_owner se redactan.
- No toca el esquema public de la base DEV compartida.

Uso (requiere pg8000):
  python3 tools/database/validate_disposable_env.py --evidence docs/database-portability/_data/validation-disposable.txt
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
UP_FILES = ["0001_core.up.sql", "0002_identity.up.sql", "0003_migration_control.up.sql"]
DOWN_FILES = ["0003_migration_control.down.sql", "0002_identity.down.sql", "0001_core.down.sql"]

TENANT_A = "00000000-0000-0000-0000-0000000000a1"
TENANT_B = "00000000-0000-0000-0000-0000000000b2"
IDENT_A = "10000000-0000-0000-0000-0000000000a1"
IDENT_B = "10000000-0000-0000-0000-0000000000b2"
MEM_A = "20000000-0000-0000-0000-0000000000a1"
MEM_B = "20000000-0000-0000-0000-0000000000b2"
ACTOR = "ofirone_validation_actor"

lines = []
results = []


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
    path = Path(connections_file)
    pattern = re.compile(r"^(?:export\s+)?(?:DATABASE_URL_)?(DEV|PROD)\s*[:=]\s*(\S+)\s*$", re.I)
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = pattern.match(line.strip())
            if m and m.group(1).upper() == env_name.upper():
                return m.group(2).strip().strip("'\"")
    raise SystemExit(f"No hay URL para {env_name}.")


def parse_url(raw):
    u = raw.strip()
    if u.startswith("postgres://"):
        u = "postgresql://" + u[len("postgres://"):]
    m = re.match(r"postgresql://([^:]+):([^@]*)@([^:/]+)(?::(\d+))?/([^?]+)", u)
    if not m:
        raise SystemExit("URL PostgreSQL inválida.")
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


def expect_error(conn, label, sql, expected_codes, name):
    try:
        conn.run(sql)
        record(name, False, f"{label}: se aceptó cuando debía fallar")
    except Exception as exc:  # noqa: BLE001
        code = err_code(exc)
        if code in expected_codes:
            record(name, True, f"{label}: rechazado con SQLSTATE {code}")
        else:
            record(name, False, f"{label}: error inesperado {code}: {sanitize(str(exc))[:180]}")


def seed(conn):
    """Siembra sintética. Suspende FORCE solo para tenants/identities (sin política INSERT)."""
    conn.run("begin")
    conn.run("alter table public.tenants no force row level security")
    conn.run("alter table public.identities no force row level security")
    conn.run(f"""
        insert into public.tenants (tenant_id, slug, name) values
          ('{TENANT_A}', 'tenant-a', 'Tenant A'),
          ('{TENANT_B}', 'tenant-b', 'Tenant B')
    """)
    conn.run(f"""
        insert into public.identities (identity_id, email, display_name) values
          ('{IDENT_A}', 'a@example.test', 'Alice A'),
          ('{IDENT_B}', 'b@example.test', 'Bob B')
    """)
    conn.run("alter table public.tenants force row level security")
    conn.run("alter table public.identities force row level security")

    for tenant, ident, mem in ((TENANT_A, IDENT_A, MEM_A), (TENANT_B, IDENT_B, MEM_B)):
        conn.run(f"select set_config('app.tenant_id', '{tenant}', false)")
        conn.run(f"""
            insert into public.tenant_memberships (membership_id, tenant_id, identity_id)
            values ('{mem}', '{tenant}', '{ident}')
        """)
    conn.run("select set_config('app.tenant_id', '', false)")

    # 25 roles en A y 5 en B (para keyset pagination).
    for i in range(25):
        conn.run(f"select set_config('app.tenant_id', '{TENANT_A}', false)")
        conn.run(f"""
            insert into public.roles (role_id, tenant_id, code, name)
            values ('30000000-0000-0000-0000-0000000a{i:04d}', '{TENANT_A}', 'role-a-{i:02d}', 'Role A {i:02d}')
        """)
    for i in range(5):
        conn.run(f"select set_config('app.tenant_id', '{TENANT_B}', false)")
        conn.run(f"""
            insert into public.roles (role_id, tenant_id, code, name)
            values ('30000000-0000-0000-0000-0000000b{i:04d}', '{TENANT_B}', 'role-b-{i:02d}', 'Role B {i:02d}')
        """)

    conn.run(f"select set_config('app.tenant_id', '{TENANT_A}', false)")
    conn.run("insert into public.permissions (permission_id, code) values ('40000000-0000-0000-0000-000000000001','sales.read')")
    conn.run(f"""
        insert into public.role_permissions (tenant_id, role_id, permission_id)
        values ('{TENANT_A}', '30000000-0000-0000-0000-0000000a0000', '40000000-0000-0000-0000-000000000001')
    """)
    conn.run(f"""
        insert into public.membership_roles (tenant_id, membership_id, role_id)
        values ('{TENANT_A}', '{MEM_A}', '30000000-0000-0000-0000-0000000a0000')
    """)
    conn.run(f"""
        insert into public.sessions (session_id, tenant_id, membership_id, identity_id, expires_at)
        values ('50000000-0000-0000-0000-0000000000a1', '{TENANT_A}', '{MEM_A}', '{IDENT_A}', clock_timestamp() + interval '1 day')
    """)
    conn.run(f"""
        insert into public.refresh_tokens (tenant_id, session_id, token_hash, expires_at)
        values ('{TENANT_A}', '50000000-0000-0000-0000-0000000000a1', decode(repeat('01',32),'hex'), clock_timestamp() + interval '1 hour')
    """)
    conn.run("commit")


def isolation_tests(conn):
    conn.run(f"set role {ACTOR}")
    try:
        _isolation_tests(conn)
    finally:
        conn.run("reset role")


def _isolation_tests(conn):
    # Sin contexto: RLS no debe exponer filas.
    conn.run("select set_config('app.tenant_id','',false), set_config('app.identity_id','',false)")
    for table in ("tenants", "roles", "identities", "sessions", "refresh_tokens"):
        rows = conn.run(f"select count(*) from public.{table}")
        record(f"Sin contexto → {table} invisible", rows[0][0] == 0, f"filas={rows[0][0]}")

    # Contexto A: sólo datos A.
    conn.run(f"select set_config('app.tenant_id','{TENANT_A}',false), set_config('app.identity_id','{IDENT_A}',false)")
    for table, expected in (("tenants", 1), ("roles", 25), ("tenant_memberships", 1), ("sessions", 1)):
        rows = conn.run(f"select count(*) from public.{table}")
        record(f"Tenant A → {table} = {expected}", rows[0][0] == expected, f"filas={rows[0][0]}")
    ident = conn.run("select count(*) from public.identities")
    record("Tenant A ve sólo su identidad", ident[0][0] == 1, f"filas={ident[0][0]}")

    # Contexto B: no ve A.
    conn.run(f"select set_config('app.tenant_id','{TENANT_B}',false), set_config('app.identity_id','{IDENT_B}',false)")
    for table in ("sessions", "refresh_tokens", "membership_roles"):
        rows = conn.run(f"select count(*) from public.{table}")
        record(f"Tenant B NO ve {table} de A", rows[0][0] == 0, f"filas={rows[0][0]}")
    roles_b = conn.run("select count(*) from public.roles")
    record("Tenant B ve sólo sus 5 roles", roles_b[0][0] == 5, f"filas={roles_b[0][0]}")

    # Escrituras cruzadas rechazadas (RLS) y FKs compuestas.
    conn.run(f"select set_config('app.tenant_id','{TENANT_A}',false)")
    expect_error(conn, "INSERT rol de tenant B desde contexto A",
                 f"insert into public.roles (tenant_id, code, name) values ('{TENANT_B}','intruder','Intruder')",
                 {"42501"}, "RLS: rechaza INSERT cross-tenant")
    expect_error(conn, "UPDATE tenant_id de rol A hacia B",
                 f"update public.roles set tenant_id='{TENANT_B}', code='moved' where role_id='30000000-0000-0000-0000-0000000a0000'",
                 {"42501"}, "RLS: rechaza UPDATE cross-tenant")
    expect_error(conn, "membership_roles con rol de otro tenant",
                 f"insert into public.membership_roles (tenant_id, membership_id, role_id) values ('{TENANT_A}','{MEM_A}','30000000-0000-0000-0000-0000000b0000')",
                 {"23503"}, "FK compuesta: rechaza rol de otro tenant")
    expect_error(conn, "sesión con identidad que no es del membership",
                 f"insert into public.sessions (tenant_id, membership_id, identity_id, expires_at) values ('{TENANT_A}','{MEM_A}','{IDENT_B}', clock_timestamp()+interval '1 day')",
                 {"23503"}, "FK compuesta: rechaza identidad cruzada")
    expect_error(conn, "refresh token con hash corto",
                 f"insert into public.refresh_tokens (tenant_id, session_id, token_hash, expires_at) values ('{TENANT_A}','50000000-0000-0000-0000-0000000000a1', decode('01','hex'), clock_timestamp()+interval '1 hour')",
                 {"23514"}, "CHECK: rechaza hash de 1 byte")


def keyset_test(conn):
    conn.run(f"set role {ACTOR}")
    try:
        _keyset_test(conn)
    finally:
        conn.run("reset role")


def _keyset_test(conn):
    conn.run(f"select set_config('app.tenant_id','{TENANT_A}',false)")
    collected, last = [], None
    for _ in range(10):
        if last is None:
            rows = conn.run(
                f"select role_id::text, created_at::text from public.roles where tenant_id = '{TENANT_A}' "
                "order by created_at, role_id limit 10")
        else:
            ts = last[1].replace("'", "''")
            rid = last[0].replace("'", "''")
            rows = conn.run(
                f"select role_id::text, created_at::text from public.roles where tenant_id = '{TENANT_A}' "
                f"and (created_at, role_id) > ('{ts}'::timestamptz, '{rid}'::uuid) "
                "order by created_at, role_id limit 10")
        if not rows:
            break
        collected.extend(r[0] for r in rows)
        last = rows[-1]
    unique = set(collected)
    record("Keyset pagination sin duplicados", len(unique) == len(collected), f"filas={len(collected)}, únicas={len(unique)}")
    record("Keyset pagination sin omisiones (25 roles A)", len(unique) == 25, f"únicas={len(unique)}")
    leaked = conn.run(f"select count(*) from public.roles where tenant_id = '{TENANT_B}'")
    record("Keyset pagination no mezcla tenant B", leaked[0][0] == 0, f"filas_b={leaked[0][0]}")


def checksums():
    data = []
    for name in UP_FILES:
        digest = hashlib.sha256((MIGRATIONS / name).read_bytes()).hexdigest()
        data.append(f"{name} sha256={digest}")
        lines.append(f"  {name} sha256={digest}")
    record("Checksums SHA-256 de migraciones calculados", True, f"{len(data)} archivos")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["DEV"], default="DEV")
    ap.add_argument("--connections-file", default=".env.database.local")
    ap.add_argument("--evidence", default="docs/database-portability/_data/validation-disposable.txt")
    ap.add_argument("--keep", action="store_true", help="No eliminar la base (solo diagnóstico).")
    args = ap.parse_args()

    cfg = parse_url(load_url(args.env, args.connections_file))
    admin = connect(cfg)
    db_name = "ofirone_validation_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S").lower()
    temp = None
    kept = False
    try:
        admin.run(f'create database "{db_name}"')
        lines.append(f"Base temporal aislada creada: {db_name} (se elimina al final)")
        temp = connect(cfg, database=db_name)

        # 1) Baseline up
        up_ok = True
        for name in UP_FILES:
            try:
                run_file(temp, MIGRATIONS / name)
            except Exception as exc:  # noqa: BLE001
                up_ok = False
                record(f"up {name}", False, sanitize(str(exc))[:200])
                break
        record("Baseline 0001-0003 aplicado en base vacía", up_ok)

        if up_ok:
            counts = temp.run("""
                select
                  (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tablas,
                  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private') as funciones,
                  (select count(*) from pg_policies where schemaname='public') as politicas,
                  (select count(*) from public.schema_migrations) as ledger
            """)[0]
            record("Objetos del baseline tras up", counts[0] == 10, f"tablas={counts[0]}, funciones={counts[1]}, políticas={counts[2]}, ledger={counts[3]}")

            seed(temp)

            # El owner de Neon tiene BYPASSRLS: las pruebas RLS requieren un rol
            # NOSUPERUSER NOBYPASSRLS. Se crea solo para esta base temporal.
            try:
                temp.run(f"drop role if exists {ACTOR}")
            except Exception:  # noqa: BLE001
                pass
            try:
                temp.run(f"create role {ACTOR} nologin nosuperuser nobypassrls noinherit")
            except Exception:  # noqa: BLE001
                pass  # rol preexistente de una ejecución interrumpida
            temp.run(f"grant {ACTOR} to current_user")
            temp.run("grant usage on schema public, app_private to " + ACTOR)
            temp.run(f"grant execute on function app_private.current_tenant_id(), app_private.current_identity_id() to {ACTOR}")
            temp.run(f"grant select, insert on public.tenants, public.identities, public.tenant_memberships, public.roles, public.permissions, public.role_permissions, public.membership_roles, public.sessions, public.refresh_tokens to {ACTOR}")
            temp.run(f"grant update on public.roles to {ACTOR}")
            record("Siembra sintética + rol de prueba NOBYPASSRLS", True,
                   "owner de Neon tiene BYPASSRLS; las aserciones se ejecutan con SET ROLE")

            isolation_tests(temp)
            keyset_test(temp)

            business = temp.run("""
                select count(*) from information_schema.tables
                where table_schema='public' and table_name in ('products','product_variants','inventory_moves','sales','purchases','receivables')
            """)[0][0]
            record("Validaciones de negocio (productos/inventario/ventas/compras/cartera)",
                   False, f"esquema de negocio portable inexistente (tablas encontradas={business})",
                   status="BLOQ")

            # 2) Segunda ejecución de una migración
            try:
                temp.run("rollback")
            except Exception:  # noqa: BLE001
                pass
            try:
                run_file(temp, MIGRATIONS / "0001_core.up.sql")
                record("Segunda ejecución 0001 no rompe", True, "re-ejecución aceptada")
            except Exception as exc:  # noqa: BLE001
                try:
                    temp.run("rollback")
                except Exception:  # noqa: BLE001
                    pass
                record("Segunda ejecución 0001 no rompe", False,
                       f"no idempotente ({sanitize(str(exc))[:140]}). El ledger debe evitar re-aplicar.",
                       status="HALLAZGO")

            # 3) up -> down -> up
            for name in DOWN_FILES:
                try:
                    run_file(temp, MIGRATIONS / name)
                except Exception as exc:  # noqa: BLE001
                    record(f"down {name}", False, sanitize(str(exc))[:200])
                    break
            leftover = temp.run("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")[0][0]
            record("Down elimina objetos del baseline", leftover == 0, f"tablas_restantes={leftover}")
            reup_ok = True
            for name in UP_FILES:
                try:
                    run_file(temp, MIGRATIONS / name)
                except Exception as exc:  # noqa: BLE001
                    reup_ok = False
                    record(f"re-up {name}", False, sanitize(str(exc))[:200])
                    break
            record("Ciclo up → down → up completado", reup_ok, "esquema recreado" if reup_ok else "falló")

            checksums()

        temp.close()
        temp = None
    finally:
        if temp is not None and not kept:
            try:
                temp.close()
            except Exception:  # noqa: BLE001
                pass
        if not args.keep:
            try:
                admin.run(f'drop database if exists "{db_name}" with (force)')
                lines.append(f"Base temporal eliminada: {db_name}")
            except Exception as exc:  # noqa: BLE001
                lines.append(f"NO se pudo eliminar la base temporal: {sanitize(str(exc))[:120]}")
            try:
                admin.run(f"drop role if exists {ACTOR}")
                lines.append(f"Rol temporal eliminado: {ACTOR}")
            except Exception as exc:  # noqa: BLE001
                lines.append(f"NO se pudo eliminar el rol temporal: {sanitize(str(exc))[:120]}")
        admin.close()

    counts = {s: sum(1 for r in results if r["status"] == s) for s in ("PASS", "FAIL", "BLOQ", "HALLAZGO")}
    ok = counts["FAIL"] == 0 and counts["PASS"] > 0
    lines.append("")
    lines.append(f"RESULTADO GLOBAL: {'PASS' if ok else 'CON FALLOS'} "
                 f"(PASS={counts['PASS']}, FAIL={counts['FAIL']}, BLOQ={counts['BLOQ']}, HALLAZGO={counts['HALLAZGO']})")
    output = sanitize("\n".join(lines))
    Path(args.evidence).parent.mkdir(parents=True, exist_ok=True)
    Path(args.evidence).write_text(output + "\n", encoding="utf-8")
    print(output)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
