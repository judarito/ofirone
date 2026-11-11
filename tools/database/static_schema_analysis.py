#!/usr/bin/env python3
"""
static_schema_analysis.py — Analisis estatico complementario del esquema.

Deriva, a partir de las migraciones SQL, hechos que el inventario necesita y que
un simple conteo de sentencias no entrega:

  - tablas y cuantas veces se (re)definen;
  - tablas con columna `tenant_id` directa y tablas sin ella;
  - tablas con RLS habilitado y numero de politicas por tabla;
  - columnas potencialmente sensibles (heuristica por nombre);
  - dependencias funcion -> tabla (lecturas/escrituras detectadas en el cuerpo);
  - FKs inline declaradas en los CREATE TABLE.

Es de solo lectura sobre el repositorio; escribe JSON solo si se le pasa --json.

Uso:
    python3 tools/database/static_schema_analysis.py --json docs/database-portability/_data/static-analysis.json

Limitaciones:
    - Heuristico: regex y balance de parentesis, no un parser SQL.
    - No resuelve herencia, ALTER TABLE ADD COLUMN ni search_path.
    - PostgreSQL minimo requerido: 12 (el script no ejecuta SQL).
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO_ROOT / "shared" / "supabase" / "migrations"

CREATE_TABLE = re.compile(
    r"create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.\"]+)", re.I
)
ALTER_RLS = re.compile(
    r"alter\s+table\s+(?:only\s+)?([a-z0-9_.\"]+)\s+enable\s+row\s+level\s+security", re.I
)
CREATE_POLICY = re.compile(r'create\s+policy\s+(?:"([^"]+)"|([a-z0-9_]+))\s+on\s+([a-z0-9_.]+)', re.I)
CREATE_FUNCTION = re.compile(r"create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.\"]+)", re.I)
CREATE_VIEW = re.compile(
    r"create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+([a-z0-9_.\"]+)", re.I
)
DML = re.compile(
    r"\b(?:from|join|insert\s+into|update|delete\s+from)\s+(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?",
    re.I,
)
SENSITIVE = re.compile(
    r"(password|passwd|pwd|secret|token|api_key|apikey|credential|"
    r"authorization|email|phone|telefono|celular|whatsapp|"
    r"document|documento|identificacion|identification|cedula|\bnit\b|"
    r"address|direccion|birth|nacimiento|"
    r"\bcard\b|tarjeta|cvv|iban|\bbank\b|cuenta_bancaria|account_number|"
    r"signature|firma|photo|selfie|ip_address|user_agent|latitude|longitude|"
    r"support_whatsapp)",
    re.I,
)
FINANCIAL = re.compile(
    r"(amount|total|subtotal|price|cost|costo|precio|balance|saldo|"
    r"tax|impuesto|discount|descuento|payment|pago|refund|reembolso|"
    r"credit|credito|debit|debito|salary|nomina|interest|interes|fee|comision)",
    re.I,
)
# nombres que no son tablas reales en el cuerpo de funciones
NOISE = {
    "select", "where", "set", "values", "lateral", "unnest", "generate_series",
    "jsonb_array_elements", "json_array_elements", "jsonb_each", "json_each",
    "information_schema", "pg_catalog", "dual", "new", "old", "excluded",
}


def norm(name: str) -> str:
    return name.replace('"', "").replace(" ", "").lower()


def strip_schema(name: str) -> str:
    return norm(name).split(".")[-1]


def strip_lead_comments(stmt: str) -> tuple[str, int]:
    """Quita comentarios iniciales (`--` y `/* */`) y devuelve (texto, offset)."""
    pos = 0
    while True:
        rest = stmt[pos:].lstrip()
        pos += len(stmt[pos:]) - len(rest)
        if rest.startswith("--"):
            nl = rest.find("\n")
            if nl == -1:
                return "", len(stmt)
            pos += nl + 1
            continue
        if rest.startswith("/*"):
            end = rest.find("*/")
            if end == -1:
                return "", len(stmt)
            pos += end + 2
            continue
        return rest, pos


def iter_statements(text: str):
    """Divide en sentencias respetando comentarios, $$ ... $$ y comillas simples.

    Devuelve (offset_inicial, sentencia) para poder calcular archivo:linea.
    """
    buf, i, n = [], 0, len(text)
    start = 0
    dollar = None
    in_squote = False
    while i < n:
        ch = text[i]
        if dollar:
            if text.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            buf.append(ch)
            i += 1
            continue
        if in_squote:
            buf.append(ch)
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    buf.append("'")
                    i += 2
                    continue
                in_squote = False
            i += 1
            continue
        # comentarios: se ignoran para el balance de comillas y de `;`
        if text.startswith("--", i):
            nl = text.find("\n", i)
            if nl == -1:
                break
            buf.append(text[i:nl])
            i = nl
            continue
        if text.startswith("/*", i):
            close = text.find("*/", i + 2)
            end = n if close == -1 else close + 2
            buf.append(text[i:end])
            i = end
            continue
        if ch == "'":
            in_squote = True
            buf.append(ch)
            i += 1
            continue
        if ch == "$":
            m = re.match(r"\$[A-Za-z_0-9]*\$", text[i:])
            if m:
                dollar = m.group(0)
                buf.append(dollar)
                i += len(dollar)
                continue
        if ch == ";":
            stmt = "".join(buf)
            if stmt.strip():
                yield start, stmt
            buf = []
            i += 1
            start = i
            continue
        buf.append(ch)
        i += 1
    if "".join(buf).strip():
        yield start, "".join(buf)


def split_top_level(body: str) -> list[str]:
    parts, depth, cur = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    args = ap.parse_args()

    tables = defaultdict(list)          # name -> [{file,line}]
    table_cols = defaultdict(dict)     # name -> {col: type} (ultima definicion)
    table_fks = defaultdict(list)      # name -> [(col, ref_table, ref_col)]
    rls_tables = defaultdict(list)
    policies = defaultdict(list)       # table -> [policy]
    functions = defaultdict(list)      # name -> [{file,line,tables}]
    views = defaultdict(list)
    sensitive = defaultdict(list)      # table -> [(col,type)]
    financial = defaultdict(list)      # table -> [(col,type)]

    for path in sorted(MIGRATIONS.glob("*.sql")):
        rel = path.relative_to(REPO_ROOT).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff")
        for offset, raw_stmt in iter_statements(text):
            stmt, delta = strip_lead_comments(raw_stmt)
            if not stmt.strip():
                continue
            line = text.count("\n", 0, offset + delta) + 1

            m = CREATE_TABLE.match(stmt.lstrip())
            if m:
                t = strip_schema(m.group(1))
                tables[t].append({"file": rel, "line": line})
                open_paren = stmt.find("(")
                close = stmt.rfind(")")
                if open_paren != -1 and close > open_paren:
                    body = stmt[open_paren + 1 : close]
                    cols = {}
                    for part in split_top_level(body):
                        p = re.sub(r"^\s*(?:--[^\n]*\n\s*)+", "", part).strip()
                        cm = re.match(r'"?([a-z_][a-z0-9_]*)"?\s+([a-z][a-z0-9_ ()]*)', p, re.I)
                        if not cm:
                            continue
                        col, ctype = cm.group(1).lower(), cm.group(2).strip().lower()
                        if col in ("constraint", "unique", "primary", "foreign", "check", "exclude"):
                            continue
                        cols[col] = ctype
                        if SENSITIVE.search(col):
                            sensitive[t].append((col, ctype))
                        if FINANCIAL.search(col):
                            financial[t].append((col, ctype))
                        fm = re.search(
                            r"references\s+\"?([a-z0-9_.]+)\"?\s*\(\s*([a-z0-9_]+)\s*\)", p, re.I
                        )
                        if fm:
                            table_fks[t].append((col, strip_schema(fm.group(1)), fm.group(2).lower()))
                    if cols:
                        table_cols[t] = cols
                continue

            m = ALTER_RLS.search(stmt)
            if m:
                rls_tables[strip_schema(m.group(1))].append({"file": rel, "line": line})
                continue

            m = CREATE_POLICY.search(stmt)
            if m:
                pname = (m.group(1) or m.group(2)).strip()
                policies[strip_schema(m.group(3))].append({"name": pname, "file": rel, "line": line})
                continue

            m = CREATE_FUNCTION.match(stmt.lstrip())
            if m:
                f = strip_schema(m.group(1))
                body = stmt
                deps = {d.lower() for d in DML.findall(body)}
                deps = {d for d in deps if d not in NOISE}
                functions[f].append({"file": rel, "line": line, "tables": sorted(deps)})
                continue

            m = CREATE_VIEW.match(stmt.lstrip())
            if m:
                views[strip_schema(m.group(1))].append({"file": rel, "line": line})

    tenant_yes, tenant_no = [], []
    for t, cols in table_cols.items():
        (tenant_yes if "tenant_id" in cols else tenant_no).append(t)

    result = {
        "tables": {
            "unique": len(tables),
            "definitions": sum(len(v) for v in tables.values()),
            "redefined": {t: len(v) for t, v in tables.items() if len(v) > 1},
            "detail": {t: v for t, v in sorted(tables.items())},
        },
        "tenant": {
            "with_tenant_id": sorted(tenant_yes),
            "without_tenant_id": sorted(tenant_no),
        },
        "rls": {
            "tables_enabled": sorted(rls_tables),
            "policies_by_table": {t: len(v) for t, v in sorted(policies.items())},
            "policies_total": sum(len(v) for v in policies.values()),
            "policies_detail": {t: v for t, v in sorted(policies.items())},
        },
        "functions": {
            "unique": len(functions),
            "definitions": sum(len(v) for v in functions.values()),
            "detail": {f: v for f, v in sorted(functions.items())},
        },
        "views": {"unique": len(views), "detail": {v: d for v, d in sorted(views.items())}},
        "sensitive_columns": {t: sorted(set(v)) for t, v in sorted(sensitive.items())},
        "financial_columns": {t: sorted(set(v)) for t, v in sorted(financial.items())},
        "inline_fks": {t: v for t, v in sorted(table_fks.items())},
    }

    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"tablas unicas={len(tables)} definiciones={sum(len(v) for v in tables.values())}")
    print(f"tablas con tenant_id={len(tenant_yes)}  sin tenant_id={len(tenant_no)}")
    print(f"tablas con RLS={len(rls_tables)}  politicas={sum(len(v) for v in policies.values())}")
    print(f"funciones unicas={len(functions)}  definiciones={sum(len(v) for v in functions.values())}")
    print(f"tablas con columnas sensibles={len(sensitive)}")
    print("--- tablas sin tenant_id ---")
    print(", ".join(sorted(tenant_no)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
