#!/usr/bin/env python3
"""Snapshot no destructivo del esquema (PostgreSQL portable / Neon).

Solo ejecuta SELECT / lecturas de catálogo. Nunca escribe ni modifica datos.
Las credenciales se leen de variables de entorno o `.env.database.local` y NUNCA
se imprimen ni se escriben en los reportes.

Uso:
  DATABASE_URL_DEV=postgresql://... DATABASE_URL_PROD=postgresql://... \
    python3 tools/database/db_snapshot.py --only dev
  python3 tools/database/db_snapshot.py --connections-file .env.database.local

Salida: docs/database-portability/_data/<target>-schema.json
"""

import argparse
import json
import os
import ssl
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

try:
    import pg8000
except ImportError:  # pragma: no cover
    sys.exit("Falta pg8000. Instalar: pip install pg8000 (o usar venv temporal).")


def parse_url(raw):
    url = raw.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    u = urlparse(url)
    if u.scheme != "postgresql" or not u.hostname:
        raise ValueError("URL PostgreSQL inválida")
    return {
        "host": u.hostname,
        "port": u.port or 5432,
        "database": (u.path or "/postgres").lstrip("/") or "postgres",
        "user": u.username,
        "password": u.password,
    }


def load_connections(path):
    """Lee URLs desde entorno o archivo local KEY=URL/KEY: URL."""
    env = {
        "DEV": os.environ.get("DATABASE_URL_DEV"),
        "PROD": os.environ.get("DATABASE_URL_PROD"),
    }
    if any(env.values()):
        return {k: v for k, v in env.items() if v}
    if path == "conecionesNEO.txt" and os.path.exists(".env.database.local"):
        path = ".env.database.local"
    if not os.path.exists(path):
        raise SystemExit(f"No existen URLs de entorno ni el archivo local {path}")
    out = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or ":" not in line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, rest = line.partition("=")
            else:
                key, _, rest = line.partition(":")
            key = key.strip().upper().removeprefix("DATABASE_URL_")
            if key in ("DEV", "PROD"):
                out[key] = rest.strip()
    return out


QUERIES = {
    "tables": """
        select table_schema, table_name
        from information_schema.tables
        where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema')
        order by 1,2
    """,
    "views": """
        select table_schema, table_name
        from information_schema.views
        where table_schema not in ('pg_catalog','information_schema')
        order by 1,2
    """,
    "matviews": """
        select schemaname, matviewname, ispopulated
        from pg_matviews
        order by 1,2
    """,
    "functions": """
        select n.nspname as schema, p.proname as name,
               p.prosecdef as security_definer,
               l.lanname as language,
               pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_language l on l.oid = p.prolang
        where n.nspname not in ('pg_catalog','information_schema')
        order by 1,2
    """,
    "triggers": """
        select n.nspname as schema, c.relname as table_name, t.tgname as trigger_name,
               pg_get_triggerdef(t.oid) as definition
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and n.nspname not in ('pg_catalog','information_schema')
        order by 1,2,3
    """,
    "sequences": """
        select sequence_schema, sequence_name
        from information_schema.sequences
        where sequence_schema not in ('pg_catalog','information_schema')
        order by 1,2
    """,
    "indexes": """
        select schemaname, tablename, indexname, indexdef
        from pg_indexes
        where schemaname not in ('pg_catalog','information_schema')
        order by 1,2,3
    """,
    "constraints": """
        select n.nspname as schema, c.relname as table_name, con.conname as name,
               con.contype as type
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname not in ('pg_catalog','information_schema')
        order by 1,2,3
    """,
    "enums": """
        select n.nspname as schema, t.typname as name,
               array_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname not in ('pg_catalog','information_schema')
        group by 1,2
        order by 1,2
    """,
    "extensions": "select extname, extversion from pg_extension order by 1",
    "rls_tables": """
        select n.nspname as schema, c.relname as table_name, c.relrowsecurity as rls,
               c.relforcerowsecurity as force_rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind='r' and n.nspname not in ('pg_catalog','information_schema')
        order by 1,2
    """,
    "rls_policies": """
        select schemaname, tablename, policyname, cmd, roles
        from pg_policies
        order by 1,2,3
    """,
    "tenant_tables": """
        select table_schema, table_name, column_name, data_type, is_nullable
        from information_schema.columns
        where table_schema not in ('pg_catalog','information_schema')
          and column_name = 'tenant_id'
        order by 1,2
    """,
    "sensitive_columns": """
        select table_schema, table_name, column_name, data_type
        from information_schema.columns
        where table_schema not in ('pg_catalog','information_schema')
          and (column_name ~* '(pass|secret|token|refresh|api_?key|card|iban|salary|email|phone|document|address|legal_name|birth|fiscal)')
        order by 1,2,3
    """,
    "foreign_keys": """
        select n.nspname as schema, c.relname as table_name, con.conname,
               fn.nspname as ref_schema, fc.relname as ref_table
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_class fc on fc.oid = con.confrelid
        join pg_namespace fn on fn.oid = fc.relnamespace
        where con.contype='f' and n.nspname not in ('pg_catalog','information_schema')
        order by 1,2,3
    """,
    "row_counts": """
        select n.nspname as schema, c.relname as table_name,
               (select reltuples::bigint from pg_class rc where rc.oid = c.oid) as approx_rows
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind='r' and n.nspname not in ('pg_catalog','information_schema')
        order by 1,2
    """,
}


def read_only_facts(cur):
    """Indicadores de privilegios para decidir si una base es read-only."""
    cur.execute(
        """
        select current_user,
               (select rolsuper from pg_roles where rolname = current_user) as is_superuser,
               has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public,
               has_database_privilege(current_user, current_database(), 'CREATE') as can_create_db,
               current_setting('server_version') as version,
               current_database() as db
        """
    )
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, cur.fetchone()))


def snapshot(target, url, out_dir, allow_prod_nonreadonly=False):
    cfg = parse_url(url)
    ssl_ctx = ssl.create_default_context()

    try:
        conn = pg8000.connect(
            user=cfg["user"], password=cfg["password"], host=cfg["host"],
            port=cfg["port"], database=cfg["database"], timeout=15,
            ssl_context=ssl_ctx,
        )
    except Exception as exc:  # noqa: BLE001
        return {"target": target, "status": "error", "error": f"{type(exc).__name__}: {exc}"[:300]}

    result = {"target": target, "status": "ok", "captured_at": datetime.now(timezone.utc).isoformat()}
    try:
        cur = conn.cursor()
        cur.execute("set statement_timeout = '20000'")
        facts = read_only_facts(cur)
        # Politica de secretos: NO persistir nombres de base ni de rol
        # (son identificadores de infraestructura). Solo banderas de privilegios
        # y version, que son evidencia suficiente para el diagnostico.
        result["meta"] = {
            "db": "[redactado]",
            "user": "[redactado]",
            "pg_version": facts["version"],
            "is_superuser": bool(facts["is_superuser"]),
            "can_create_public": bool(facts["can_create_public"]),
            "can_create_db": bool(facts["can_create_db"]),
        }
        read_only = not (facts["is_superuser"] or facts["can_create_public"] or facts["can_create_db"])
        result["read_only_user"] = read_only
        if target == "prod" and not read_only and not allow_prod_nonreadonly:
            if not allow_prod_nonreadonly:
                result["status"] = "blocked"
                result["blocked_reason"] = (
                    "El usuario de PROD no es de solo lectura (superuser o con CREATE). "
                    "No se ejecuta ningún análisis; reportar bloqueo."
                )
                return result

        data = {}
        summary = {}
        for name, sql in QUERIES.items():
            try:
                cur.execute(sql)
                cols = [c[0] for c in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
                data[name] = rows
                summary[name] = len(rows)
            except Exception as exc:  # noqa: BLE001
                data[name] = []
                summary[name] = f"error: {type(exc).__name__}: {str(exc)[:160]}"
        result["summary"] = summary
        result["objects"] = data
        return result
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--connections-file", default="conecionesNEO.txt")
    ap.add_argument("--out-dir", default="docs/database-portability/_data")
    ap.add_argument("--only", choices=["dev", "prod", "both"], default="both")
    ap.add_argument("--allow-prod-nonreadonly", action="store_true")
    args = ap.parse_args()

    conns = load_connections(args.connections_file)
    os.makedirs(args.out_dir, exist_ok=True)
    targets = ["DEV", "PROD"] if args.only == "both" else [args.only.upper()]
    exit_code = 0
    for target in targets:
        raw = conns.get(target)
        if not raw:
            print(f"[{target}] sin URL disponible")
            continue
        snap = snapshot(target.lower(), raw, args.out_dir, args.allow_prod_nonreadonly)
        out = os.path.join(args.out_dir, f"{target.lower()}-schema.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(snap, fh, ensure_ascii=False, indent=1)
        status = snap.get("status")
        if status == "ok":
            print(f"[{target}] ok -> {out} ({snap['summary']})")
        elif status == "blocked":
            print(f"[{target}] BLOQUEADO: {snap.get('blocked_reason')}")
        else:
            print(f"[{target}] error: {snap.get('error')}")
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
