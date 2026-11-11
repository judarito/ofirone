#!/usr/bin/env python3
"""Validaciones no destructivas para el PostgreSQL portable de Ofirone.

Solo ejecuta SELECT sobre catálogos y agregados. Abre la conexión en modo
`read only` y fija `statement_timeout`. No imprime la URL de conexión ni
valores de datos personales: como máximo devuelve UUID de tenant y conteos.

Requiere PostgreSQL 15+ y `pg8000` (misma dependencia que `db_snapshot.py`).
La importación de `pg8000` es diferida para que `--help` funcione sin instalar
nada.

Uso:
  export DATABASE_URL_DEV        # valor desde el gestor de secretos; nunca se imprime
  python3 tools/database/validate_portable_schema.py --env DEV objects
  python3 tools/database/validate_portable_schema.py --env DEV tenantless
  python3 tools/database/validate_portable_schema.py --env DEV all --json

Subcomandos:
  objects        Conteo de tablas, vistas, matviews, funciones, triggers, etc.
  tenantless     Tablas sin `tenant_id` (excluye catálogos globales conocidos).
  tenant-counts  Filas por tenant en cada tabla con `tenant_id`.
  orphans        Foreign keys con referencias rotas (conteo, sin listar filas).
  indexes        FKs y columnas de filtro sin índice líder.
  duplicates     Duplicados en claves de negocio candidatas o indicadas.
  function-deps  Funciones, `SECURITY DEFINER`, `search_path` y dependencias.
  all            Ejecuta todos los checks anteriores.

Seguridad:
  - `--env PROD` exige que el usuario sea de solo lectura; si no, aborta.
  - No existe ninguna ruta de escritura en este archivo.
  - `--max-tables` y `--statement-timeout` acotan el costo.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

MIN_PG_VERSION = 150000
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")

# Catálogos globales que pueden no tener tenant_id por diseño.
GLOBAL_CATALOGS = {
    "permissions",
    "schema_migrations",
    "spatial_ref_sys",
    "units_of_measure",
    "tenants",
}

# Columnas que suelen ser filtro/orden y no siempre tienen índice líder.
FILTER_COLUMNS = ("tenant_id", "status", "created_at", "updated_at", "sold_at", "deleted_at")


def quote_ident(name: str) -> str:
    """Cita un identificador ya validado contra el catálogo."""
    if not IDENT_RE.match(name):
        raise ValueError(f"Identificador inesperado: {name!r}")
    return '"' + name.replace('"', '""') + '"'


def parse_url(raw: str) -> dict:
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


def resolve_url(env_name: str) -> str:
    key = f"DATABASE_URL_{env_name.upper()}"
    raw = os.environ.get(key)
    if not raw:
        raise SystemExit(
            f"Falta {key}. Exporta la variable en la shell; no escribas la URL en el repo."
        )
    return raw


def connect(url: str, statement_timeout_ms: int):
    try:
        import pg8000
    except ImportError:  # pragma: no cover
        raise SystemExit("Falta pg8000. Instalar en un venv temporal: pip install pg8000")

    cfg = parse_url(url)
    conn = pg8000.connect(
        user=cfg["user"],
        password=cfg["password"],
        host=cfg["host"],
        port=cfg["port"],
        database=cfg["database"],
        timeout=15,
        ssl_context=ssl.create_default_context(),
    )
    cur = conn.cursor()
    cur.execute(f"set statement_timeout = {int(statement_timeout_ms)}")
    cur.execute("set default_transaction_read_only = on")
    return conn, cur


def fetch_dicts(cur, sql: str, params=None) -> list[dict]:
    cur.execute(sql, params or ())
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_one(cur, sql: str, params=None):
    cur.execute(sql, params or ())
    row = cur.fetchone()
    if row is None:
        return None
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, row))


def guard_read_only(cur, env_name: str, allow_prod: bool) -> dict:
    facts = fetch_one(
        cur,
        """
        select current_user as db_user,
               current_database() as db_name,
               current_setting('server_version_num')::int as version_num,
               (select rolsuper from pg_roles where rolname = current_user) as is_superuser,
               has_database_privilege(current_database(), 'CREATE') as can_create_db,
               has_schema_privilege('public', 'CREATE') as can_create_public
        """,
    )
    facts["version_ok"] = facts["version_num"] >= MIN_PG_VERSION
    facts["read_only_user"] = not (
        facts["is_superuser"] or facts["can_create_db"] or facts["can_create_public"]
    )
    if not facts["version_ok"]:
        raise SystemExit(
            f"PostgreSQL {facts['version_num']} < {MIN_PG_VERSION} (15). "
            "El baseline portable exige 15+."
        )
    if env_name.upper() == "PROD" and not facts["read_only_user"] and not allow_prod:
        raise SystemExit(
            "PROD: el usuario no es de solo lectura (superuser o con CREATE). "
            "Análisis abortado por política; no reintentar."
        )
    return facts


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #

def check_objects(cur) -> dict:
    sql = """
        select 'tablas' as objeto, count(*)::int as total
          from information_schema.tables
         where table_type = 'BASE TABLE'
           and table_schema not in ('pg_catalog', 'information_schema')
        union all
        select 'vistas', count(*)::int
          from information_schema.views
         where table_schema not in ('pg_catalog', 'information_schema')
        union all
        select 'matviews', count(*)::int from pg_matviews
        union all
        select 'funciones', count(*)::int
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname not in ('pg_catalog', 'information_schema')
        union all
        select 'triggers', count(*)::int
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal
           and n.nspname not in ('pg_catalog', 'information_schema')
        union all
        select 'indices', count(*)::int
          from pg_indexes
         where schemaname not in ('pg_catalog', 'information_schema')
        union all
        select 'constraints', count(*)::int
          from pg_constraint con join pg_class c on c.oid = con.conrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname not in ('pg_catalog', 'information_schema')
        union all
        select 'extensiones', count(*)::int from pg_extension
        order by 1
    """
    rows = fetch_dicts(cur, sql)
    extensions = fetch_dicts(cur, "select extname, extversion from pg_extension order by 1")
    return {"conteos": rows, "extensiones": extensions}


def _base_tables(cur) -> list[dict]:
    return fetch_dicts(
        cur,
        """
        select c.oid, n.nspname as schema, c.relname as name
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r'
           and n.nspname not in ('pg_catalog', 'information_schema')
         order by 1, 2
        """,
    )


def check_tenantless(cur) -> dict:
    tables = _base_tables(cur)
    out = []
    for t in tables:
        cols = fetch_dicts(
            cur,
            """
            select column_name from information_schema.columns
             where table_schema = %s and table_name = %s and column_name = 'tenant_id'
            """,
            (t["schema"], t["name"]),
        )
        if not cols:
            out.append({"schema": t["schema"], "tabla": t["name"],
                        "global_conocida": t["name"] in GLOBAL_CATALOGS})
    return {
        "tablas_totales": len(tables),
        "sin_tenant_id": len(out),
        "detalle": out,
    }


def check_tenant_counts(cur, max_tables: int) -> dict:
    tables = fetch_dicts(
        cur,
        """
        select c.oid, n.nspname as schema, c.relname as name
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          join information_schema.columns col
            on col.table_schema = n.nspname and col.table_name = c.relname
         where c.relkind = 'r' and col.column_name = 'tenant_id'
           and n.nspname not in ('pg_catalog', 'information_schema')
         order by 1, 2
         limit %s
        """,
        (int(max_tables),),
    )
    out = []
    for t in tables:
        q = (
            f"select tenant_id::text as tenant_id, count(*)::bigint as filas "
            f"from {quote_ident(t['schema'])}.{quote_ident(t['name'])} "
            f"group by tenant_id order by 2 desc"
        )
        try:
            rows = fetch_dicts(cur, q)
            out.append({"tabla": t["name"], "tenants": rows,
                        "total_filas": sum(r["filas"] for r in rows)})
        except Exception as exc:  # noqa: BLE001
            out.append({"tabla": t["name"], "error": f"{type(exc).__name__}"})
    return {"tablas_evaluadas": len(tables), "detalle": out}


def _foreign_keys(cur, only_table: str | None = None) -> list[dict]:
    params = []
    where = ""
    if only_table:
        where = "and c.relname = %s"
        params.append(only_table)
    return fetch_dicts(
        cur,
        f"""
        select con.oid as con_oid, n.nspname as schema, c.relname as tabla,
               con.conname as constraint_name,
               fn.nspname as ref_schema, fc.relname as ref_table,
               con.conkey, con.confkey
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_class fc on fc.oid = con.confrelid
          join pg_namespace fn on fn.oid = fc.relnamespace
         where con.contype = 'f'
           and n.nspname not in ('pg_catalog', 'information_schema')
           {where}
         order by 1
        """,
        params,
    )


def _column_names(cur, oid: int, attnums: list[int]) -> list[str]:
    rows = fetch_dicts(
        cur,
        """
        select a.attnum, a.attname
          from pg_attribute a
         where a.attrelid = %s and a.attnum = any(%s::int2[])
         order by a.attnum
        """,
        (oid, attnums),
    )
    return [r["attname"] for r in rows]


def check_orphans(cur, only_table: str | None, max_fks: int) -> dict:
    fks = _foreign_keys(cur, only_table)[:max_fks]
    out = []
    for fk in fks:
        child_oid = _relation_oid(cur, fk["schema"], fk["tabla"])
        child_cols = _column_names(cur, child_oid, fk["conkey"])
        parent_oid = _relation_oid(cur, fk["ref_schema"], fk["ref_table"])
        parent_cols = _column_names(cur, parent_oid, fk["confkey"])
        if len(child_cols) != len(parent_cols) or not child_cols:
            out.append({"tabla": fk["tabla"], "fk": fk["constraint_name"],
                        "error": "no se pudieron resolver columnas"})
            continue
        join = " and ".join(
            f"p.{quote_ident(pc)} = c.{quote_ident(cc)}"
            for cc, pc in zip(child_cols, parent_cols)
        )
        not_null = " and ".join(f"c.{quote_ident(cc)} is not null" for cc in child_cols)
        all_null = " or ".join(f"c.{quote_ident(cc)} is null" for cc in child_cols)
        q = (
            f"select count(*)::bigint as huerfanos from "
            f"{quote_ident(fk['schema'])}.{quote_ident(fk['tabla'])} c "
            f"left join {quote_ident(fk['ref_schema'])}.{quote_ident(fk['ref_table'])} p "
            f"on {join} where ({not_null}) and not ({all_null}) and p.{quote_ident(parent_cols[0])} is null"
        )
        try:
            row = fetch_one(cur, q)
            out.append({"tabla": fk["tabla"], "fk": fk["constraint_name"],
                        "referencia": f"{fk['ref_table']}({', '.join(parent_cols)})",
                        "huerfanos": int(row["huerfanos"])})
        except Exception as exc:  # noqa: BLE001
            out.append({"tabla": fk["tabla"], "fk": fk["constraint_name"],
                        "error": f"{type(exc).__name__}"})
    return {"fks_evaluadas": len(fks), "detalle": out}


def _relation_oid(cur, schema: str, table: str) -> int:
    row = fetch_one(
        cur,
        """
        select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = %s and c.relname = %s
        """,
        (schema, table),
    )
    if not row:
        raise ValueError(f"No existe {schema}.{table}")
    return int(row["oid"])


def check_indexes(cur) -> dict:
    fks = _foreign_keys(cur)
    out_fk = []
    for fk in fks:
        child_oid = _relation_oid(cur, fk["schema"], fk["tabla"])
        cols = _column_names(cur, child_oid, fk["conkey"])
        if not cols:
            continue
        has_index = fetch_one(
            cur,
            """
            select 1 as ok
              from pg_index i
             where i.indrelid = %s
               and i.indisvalid
               and i.indkey[0] = %s
             limit 1
            """,
            (child_oid, _attnum(cur, child_oid, cols[0])),
        )
        if not has_index:
            out_fk.append({"tabla": fk["tabla"], "fk": fk["constraint_name"],
                           "columnas": cols})

    missing_filter = []
    for t in _base_tables(cur):
        cols = fetch_dicts(
            cur,
            """
            select column_name from information_schema.columns
             where table_schema = %s and table_name = %s
               and column_name = any(%s)
            """,
            (t["schema"], t["name"], list(FILTER_COLUMNS)),
        )
        for col in cols:
            attnum = _attnum(cur, _relation_oid(cur, t["schema"], t["name"]), col["column_name"])
            if attnum is None:
                continue
            ok = fetch_one(
                cur,
                "select 1 as ok from pg_index i where i.indrelid = %s and i.indisvalid "
                "and i.indkey[0] = %s limit 1",
                (_relation_oid(cur, t["schema"], t["name"]), attnum),
            )
            if not ok:
                missing_filter.append({"tabla": t["name"], "columna": col["column_name"]})
    return {
        "fks_sin_indice_lider": out_fk,
        "columnas_filtro_sin_indice": missing_filter,
    }


def _attnum(cur, oid: int, column: str):
    row = fetch_one(
        cur,
        "select attnum from pg_attribute where attrelid = %s and attname = %s and attnum > 0",
        (oid, column),
    )
    return int(row["attnum"]) if row else None


def check_duplicates(cur, keys: list[str], max_tables: int) -> dict:
    """keys: lista de `tabla.columna` o `tabla.col1,col2`."""
    if not keys:
        candidates = fetch_dicts(
            cur,
            """
            select table_schema as schema, table_name as tabla, column_name as columna
              from information_schema.columns
             where table_schema not in ('pg_catalog', 'information_schema')
               and column_name ~* '^(sku|code|codigo|document_number|email|slug|operation_id)$'
             order by 1,2,3
             limit %s
            """,
            (int(max_tables),),
        )
        grouped: dict[tuple[str, str], list[str]] = {}
        for c in candidates:
            grouped.setdefault((c["schema"], c["tabla"]), []).append(c["columna"])
        keys = [f"{t}.{','.join(cols)}" for (_s, t), cols in grouped.items()]

    out = []
    for spec in keys:
        table, _, cols_raw = spec.partition(".")
        cols = [c.strip() for c in cols_raw.split(",") if c.strip()]
        if not table or not cols:
            out.append({"clave": spec, "error": "formato tabla.columna"})
            continue
        table = table.split(".")[-1]
        schema_row = fetch_one(
            cur,
            "select table_schema as schema from information_schema.columns "
            "where table_name = %s limit 1",
            (table,),
        )
        if not schema_row:
            out.append({"clave": spec, "error": "tabla no encontrada"})
            continue
        schema = schema_row["schema"]
        col_sql = ", ".join(quote_ident(c) for c in cols)
        q = (
            f"select count(*)::bigint as grupos from ("
            f"select {col_sql} from {quote_ident(schema)}.{quote_ident(table)} "
            f"where {' and '.join(quote_ident(c) + ' is not null' for c in cols)} "
            f"group by {col_sql} having count(*) > 1) d"
        )
        try:
            row = fetch_one(cur, q)
            out.append({"clave": spec, "grupos_duplicados": int(row["grupos"])})
        except Exception as exc:  # noqa: BLE001
            out.append({"clave": spec, "error": f"{type(exc).__name__}"})
    return {"claves_evaluadas": len(keys), "detalle": out}


def check_function_deps(cur) -> dict:
    funcs = fetch_dicts(
        cur,
        """
        select n.nspname as schema, p.proname as nombre,
               pg_get_function_identity_arguments(p.oid) as args,
               p.prosecdef as security_definer,
               p.proconfig as config,
               l.lanname as lenguaje,
               pg_get_functiondef(p.oid) as definicion
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          join pg_language l on l.oid = p.prolang
         where n.nspname not in ('pg_catalog', 'information_schema')
           and p.prokind = 'f'
         order by 1, 2, 3
        """,
    )
    definer_no_path = []
    auth_refs = []
    for f in funcs:
        cfg = f.get("config") or []
        if f["security_definer"] and not any(str(c).startswith("search_path=") for c in cfg):
            definer_no_path.append({"schema": f["schema"], "funcion": f["nombre"],
                                    "args": f["args"]})
        if re.search(r"\bauth\.(uid|jwt|role|email|users)\b", f["definicion"] or ""):
            auth_refs.append({"schema": f["schema"], "funcion": f["nombre"],
                              "args": f["args"]})
    edges = fetch_dicts(
        cur,
        """
        select pn.nspname as schema_origen, p.proname as origen,
               dn.nspname as schema_destino, d.proname as destino
          from pg_depend dep
          join pg_proc p on p.oid = dep.objid
          join pg_namespace pn on pn.oid = p.pronamespace
          join pg_proc d on d.oid = dep.refobjid
          join pg_namespace dn on dn.oid = d.pronamespace
         where dep.classid = 'pg_proc'::regclass
           and dep.refclassid = 'pg_proc'::regclass
           and dep.objid <> dep.refobjid
           and pn.nspname not in ('pg_catalog', 'information_schema')
         order by 1,2,4
        """,
    )
    return {
        "funciones": len(funcs),
        "security_definer_sin_search_path": definer_no_path,
        "funciones_con_auth": auth_refs,
        "dependencias_funcion_a_funcion": edges,
    }


CHECKS = ("objects", "tenantless", "tenant-counts", "orphans", "indexes",
          "duplicates", "function-deps")


def run_check(name: str, cur, args) -> dict:
    if name == "objects":
        return check_objects(cur)
    if name == "tenantless":
        return check_tenantless(cur)
    if name == "tenant-counts":
        return check_tenant_counts(cur, args.max_tables)
    if name == "orphans":
        return check_orphans(cur, args.table, args.max_fks)
    if name == "indexes":
        return check_indexes(cur)
    if name == "duplicates":
        return check_duplicates(cur, args.key, args.max_tables)
    if name == "function-deps":
        return check_function_deps(cur)
    raise ValueError(name)


def print_human(results: dict) -> None:
    for name, payload in results.items():
        print(f"\n== {name} ==")
        if isinstance(payload, dict) and "conteos" in payload:
            for row in payload["conteos"]:
                print(f"  {row['objeto']}: {row['total']}")
            print(f"  extensiones: {', '.join(e['extname'] for e in payload['extensiones']) or '(ninguna)'}")
        elif isinstance(payload, dict) and "tablas_totales" in payload:
            print(f"  tablas: {payload['tablas_totales']}; sin tenant_id: {payload['sin_tenant_id']}")
            for row in payload["detalle"]:
                marca = " (global conocida)" if row["global_conocida"] else ""
                print(f"  - {row['schema']}.{row['tabla']}{marca}")
        elif isinstance(payload, dict) and "tablas_evaluadas" in payload:
            for row in payload["detalle"]:
                if "error" in row:
                    print(f"  - {row['tabla']}: error {row['error']}")
                else:
                    print(f"  - {row['tabla']}: {row['total_filas']} filas en {len(row['tenants'])} tenants")
        elif isinstance(payload, dict) and "fks_evaluadas" in payload:
            print(f"  FKs evaluadas: {payload['fks_evaluadas']}")
            for row in payload["detalle"]:
                if "error" in row:
                    print(f"  - {row['tabla']}.{row['fk']}: error {row['error']}")
                elif row["huerfanos"]:
                    print(f"  - {row['tabla']}.{row['fk']}: {row['huerfanos']} huérfanos")
        elif isinstance(payload, dict) and "fks_sin_indice_lider" in payload:
            print(f"  FKs sin índice líder: {len(payload['fks_sin_indice_lider'])}")
            for row in payload["fks_sin_indice_lider"]:
                print(f"  - {row['tabla']}.{row['fk']} ({', '.join(row['columnas'])})")
            print(f"  columnas de filtro sin índice: {len(payload['columnas_filtro_sin_indice'])}")
            for row in payload["columnas_filtro_sin_indice"]:
                print(f"  - {row['tabla']}.{row['columna']}")
        elif isinstance(payload, dict) and "claves_evaluadas" in payload:
            for row in payload["detalle"]:
                if "error" in row:
                    print(f"  - {row['clave']}: error {row['error']}")
                else:
                    print(f"  - {row['clave']}: {row['grupos_duplicados']} grupos duplicados")
        elif isinstance(payload, dict) and "funciones" in payload:
            print(f"  funciones: {payload['funciones']}")
            print(f"  SECURITY DEFINER sin search_path: {len(payload['security_definer_sin_search_path'])}")
            print(f"  funciones con auth.*: {len(payload['funciones_con_auth'])}")
            print(f"  dependencias función→función: {len(payload['dependencias_funcion_a_funcion'])}")
        else:
            print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Validaciones de solo lectura para PostgreSQL portable (PG 15+).",
        epilog="Nunca imprime la URL de conexión. Ver docs/database-portability/data-migration-runbook.md.",
    )
    ap.add_argument("--env", choices=["DEV", "PROD"], default="DEV",
                    help="Conexión a usar; lee DATABASE_URL_<ENV> (por defecto DEV).")
    ap.add_argument("--json", action="store_true", help="Salida JSON.")
    ap.add_argument("--statement-timeout", type=int, default=30000,
                    help="Timeout por sentencia en ms (por defecto 30000).")
    ap.add_argument("--max-tables", type=int, default=200,
                    help="Máximo de tablas a agregar en tenant-counts/duplicates.")
    ap.add_argument("--max-fks", type=int, default=200,
                    help="Máximo de FKs a comprobar en orphans.")
    ap.add_argument("--table", help="Limita orphans a una tabla.")
    ap.add_argument("--key", action="append", default=[],
                    help="Clave de negocio `tabla.col1[,col2]` para duplicates (repetible).")
    ap.add_argument("--allow-prod-nonreadonly", action="store_true",
                    help="Ignorar el bloqueo de PROD (no recomendado; solo diagnóstico).")
    ap.add_argument("check", nargs="?", choices=CHECKS + ("all",), default="all")
    args = ap.parse_args()

    url = resolve_url(args.env)
    conn, cur = connect(url, args.statement_timeout)
    try:
        facts = guard_read_only(cur, args.env, args.allow_prod_nonreadonly)
        names = CHECKS if args.check == "all" else (args.check,)
        results = {name: run_check(name, cur, args) for name in names}
        # Politica de secretos: no persistir/imprimir nombres de base ni de rol.
        meta = {
            "generado_en": datetime.now(timezone.utc).isoformat(),
            "entorno": args.env.upper(),
            "db": "[redactado]",
            "usuario": "[redactado]",
            "pg_version_num": facts["version_num"],
            "usuario_solo_lectura": facts["read_only_user"],
        }
        if args.json:
            print(json.dumps({"meta": meta, "checks": results},
                             ensure_ascii=False, indent=2, default=str))
        else:
            print(f"[{meta['entorno']}] db={meta['db']} pg={meta['pg_version_num']} "
                  f"read_only={meta['usuario_solo_lectura']}")
            print_human(results)
        return 0
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    sys.exit(main())
