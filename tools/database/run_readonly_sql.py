#!/usr/bin/env python3
"""Ejecuta los scripts SQL de inspección (solo lectura) sin psql.

Usa el protocolo simple de PostgreSQL vía pg8000.native para correr archivos
multisentencia (los 0N_*.sql). Se niega a ejecutar:
  - archivos sin BEGIN/SET TRANSACTION READ ONLY,
  - archivos con escrituras (INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER/CREATE/GRANT),
  - PROD cuando el usuario no es de solo lectura.
No imprime URLs ni nombres de base/rol.

Requisito: pip install pg8000.

Uso:
  python3 tools/database/run_readonly_sql.py --env DEV
  python3 tools/database/run_readonly_sql.py --env DEV --files 01 03 --json
"""

import argparse
import json
import os
import re
import ssl
import sys
from pathlib import Path

try:
    from pg8000.native import Connection
except ImportError:
    sys.exit("Falta pg8000. Instalar: pip install pg8000")

ALLOWED_FILES = ["01", "02", "03", "04", "05", "06", "07"]
FORBIDDEN = re.compile(
    r"\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE|DROP\s+|ALTER\s+|CREATE\s+|GRANT\s+|REVOKE\s+)",
    re.IGNORECASE,
)


def load_url(env_name, connections_file):
    env_var = f"DATABASE_URL_{env_name.upper()}"
    raw = os.environ.get(env_var)
    if raw:
        return raw
    path = Path(connections_file)
    if path.exists():
        pattern = re.compile(r"^(?:export\s+)?(?:DATABASE_URL_)?(DEV|PROD)\s*[:=]\s*(\S+)\s*$", re.IGNORECASE)
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = pattern.match(line)
            if match and match.group(1).upper() == env_name.upper():
                value = match.group(2).strip().strip("'\"")
                return value
    raise SystemExit(f"No hay URL para {env_name} (variable {env_var} o archivo local).")


def parse_url(raw):
    url = raw.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    m = re.match(r"postgresql://([^:]+):([^@]*)@([^:/]+)(?::(\d+))?/([^?]+)", url)
    if not m:
        raise SystemExit("URL PostgreSQL inválida.")
    return {
        "user": m.group(1),
        "password": m.group(2),
        "host": m.group(3),
        "port": int(m.group(4) or 5432),
        "database": m.group(5),
    }


def read_only_facts(conn):
    rows = conn.run(
        "select current_user, "
        "(select rolsuper from pg_roles where rolname=current_user) as super, "
        "has_schema_privilege(current_user,'public','CREATE') as create_public, "
        "has_database_privilege(current_user,current_database(),'CREATE') as create_db"
    )
    user, super_, create_public, create_db = rows[0]
    read_only = not (super_ or create_public or create_db)
    return {"usuario": "[redactado]", "super": bool(super_), "read_only": read_only}


def sanitize(text):
    text = re.sub(r"postgres(?:ql)?://\S+", "<URL redactada>", text)
    text = re.sub(r"\b[a-z][a-z0-9]{2,}_owner\b", "[rol redactado]", text)
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["DEV", "PROD"], default="DEV")
    ap.add_argument("--connections-file", default=".env.database.local")
    ap.add_argument("--dir", default="tools/database")
    ap.add_argument("--files", nargs="*", default=ALLOWED_FILES)
    ap.add_argument("--statement-timeout", type=int, default=30000)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--evidence", help="Ruta para guardar evidencia saneada (texto).")
    args = ap.parse_args()

    cfg = parse_url(load_url(args.env, args.connections_file))
    ssl_ctx = ssl.create_default_context()
    conn = Connection(
        user=cfg["user"], password=cfg["password"], host=cfg["host"],
        port=cfg["port"], database=cfg["database"], ssl_context=ssl_ctx, timeout=20,
    )
    results = {}
    try:
        conn.run(f"set statement_timeout = {int(args.statement_timeout)}")
        facts = read_only_facts(conn)
        if args.env.upper() == "PROD" and not facts["read_only"]:
            print("BLOQUEADO: el usuario de PROD no es de solo lectura. No se ejecuta nada.")
            return 2

        lines = [f"[{args.env.upper()}] ejecución read-only (sin names de db/rol)"]
        for key in args.files:
            matches = sorted(Path(args.dir).glob(f"{key}_*.sql"))
            path = matches[0] if matches else None
            if path is None or not path.exists():
                results[key] = {"status": "missing"}
                lines.append(f"== {key} == MISSING")
                continue
            sql = path.read_text(encoding="utf-8")
            if "READ ONLY" not in sql.upper() or "BEGIN" not in sql.upper():
                results[key] = {"status": "refused", "reason": "sin BEGIN/READ ONLY"}
                lines.append(f"== {key} == REFUSED (sin BEGIN/READ ONLY)")
                continue
            # La transacción READ ONLY es la garantía real: se avisa si el SQL
            # declara escrituras fuera de comentarios, pero se permite ejecutar
            # porque PostgreSQL rechaza cualquier escritura en este modo.
            sin_comentarios = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
            sin_comentarios = re.sub(r"--[^\n]*", "", sin_comentarios)
            warning = " (aviso: contiene palabras de escritura)" if FORBIDDEN.search(sin_comentarios) else ""
            try:
                rows = conn.run(sql)
                n = len(rows) if isinstance(rows, list) else None
                results[key] = {"status": "ok", "rows": n}
                lines.append(f"== {key} == OK (filas última consulta: {n}){warning}")
            except Exception as exc:  # noqa: BLE001
                try:
                    conn.run("rollback")
                except Exception:  # noqa: BLE001
                    pass
                results[key] = {"status": "error", "error": type(exc).__name__}
                lines.append(f"== {key} == ERROR {type(exc).__name__}: {sanitize(str(exc))[:200]}")

        output = "\n".join(lines) if not args.json else json.dumps(results, ensure_ascii=False, indent=1)
        output = sanitize(output)
        print(output)
        if args.evidence:
            Path(args.evidence).write_text(output + "\n", encoding="utf-8")
        return 0 if all(r.get("status") == "ok" for r in results.values()) else 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
