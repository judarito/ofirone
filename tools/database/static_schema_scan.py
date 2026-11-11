#!/usr/bin/env python3
"""
static_schema_scan.py — Inventario estatico del esquema a partir de las migraciones SQL.

No se conecta a ninguna base de datos: solo lee archivos .sql. Es de solo lectura
sobre el repositorio y escribe su salida unicamente donde se le indique (por
defecto, stdout). No imprime credenciales ni URLs.

Uso:
    python3 tools/database/static_schema_scan.py --json docs/database-portability/_data/static-scan.json
    python3 tools/database/static_schema_scan.py --summary

Salida:
    Conteos de sentencias DDL y de nombres unicos, con evidencia archivo:linea
    para cada objeto. Pensado como insumo de docs/database-portability/schema-inventory.md.

Limitaciones:
    - Analisis puramente textual (regex), no un parser SQL.
    - Cuenta sentencias, no el estado final desplegado: `create or replace`,
      `drop ... if exists` y redefiniciones historicas inflan los conteos.
    - No resuelve `search_path` ni esquemas implicidos: asume `public` cuando no
      se especifica esquema.
    - PostgreSQL minimo requerido: 12 (solo se usa el propio Python; el analisis
      no ejecuta SQL).
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "shared" / "supabase" / "migrations"

IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
QNAME = rf"({IDENT}(?:\s*\.\s*{IDENT})?)"

# Cada patron captura el nombre del objeto; se aplica por linea (case-insensitive).
PATTERNS = [
    ("table", re.compile(rf"^\s*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?{QNAME}", re.I)),
    ("view", re.compile(rf"^\s*create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?view\s+{QNAME}", re.I)),
    ("matview", re.compile(rf"^\s*create\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?{QNAME}", re.I)),
    ("function", re.compile(rf"^\s*create\s+(?:or\s+replace\s+)?function\s+{QNAME}", re.I)),
    ("procedure", re.compile(rf"^\s*create\s+(?:or\s+replace\s+)?procedure\s+{QNAME}", re.I)),
    ("trigger", re.compile(rf"^\s*create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+({IDENT})", re.I)),
    ("index", re.compile(rf"^\s*create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?{QNAME}", re.I)),
    ("sequence", re.compile(rf"^\s*create\s+sequence\s+(?:if\s+not\s+exists\s+)?{QNAME}", re.I)),
    ("extension", re.compile(rf"^\s*create\s+extension\s+(?:if\s+not\s+exists\s+)?({IDENT})", re.I)),
    ("policy", re.compile(rf"^\s*create\s+policy\s+({IDENT})", re.I)),
    ("schema", re.compile(rf"^\s*create\s+schema\s+(?:if\s+not\s+exists\s+)?{QNAME}", re.I)),
    ("type", re.compile(rf"^\s*create\s+type\s+{QNAME}", re.I)),
]

TRIGGER_ON = re.compile(r"\bon\s+((?:public\.)?\"?[A-Za-z_][A-Za-z0-9_$\"]*)", re.I)
POLICY_ON = re.compile(rf"\bon\s+{QNAME}", re.I)
INDEX_ON = re.compile(rf"\bon\s+(?:only\s+)?{QNAME}", re.I)
FK_PATTERN = re.compile(
    rf"^\s*([A-Za-z_][A-Za-z0-9_$]*)\s+(?:uuid|bigint|integer|text)\b.*?references\s+{QNAME}\s*\(\s*([A-Za-z_][A-Za-z0-9_$]*)\s*\)",
    re.I,
)
TENANT_COL = re.compile(r"^\s*tenant_id\s+", re.I)
SENSITIVE = re.compile(
    r"(pass(word|wd)?|hash|token|secret|api_key|apikey|credential|authorization|"
    r"email|phone|telefono|celular|documento|document_number|identification|"
    r"address|direccion|birth|fecha_nacimiento|ssn|card|tarjeta|cvv|iban|account_number|"
    r"bank|license|licencia|signature|firma|photo|selfie|ip_address|user_agent)",
    re.I,
)


def normalize(name: str) -> str:
    return name.replace('"', "").replace(" ", "").strip().lower()


def scan_file(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff")
    lines = text.splitlines()
    rel = path.relative_to(REPO_ROOT).as_posix()
    found = defaultdict(list)

    for i, line in enumerate(lines, start=1):
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        for kind, rx in PATTERNS:
            m = rx.match(line)
            if not m:
                continue
            raw = m.group(1)
            name = normalize(raw)
            extra = {}
            if kind in ("trigger", "policy"):
                on = POLICY_ON.search(line[m.end():])
                if on:
                    extra["on"] = normalize(on.group(1))
            elif kind == "index":
                on = INDEX_ON.search(line[m.end():])
                if on:
                    extra["on"] = normalize(on.group(1))
            elif kind == "function":
                # firma: primera '(' despues del nombre en la misma linea o siguientes
                sig_lines = [line[m.end():]] + lines[i:i + 4]
                sig = " ".join(sig_lines)
                pm = re.match(r"\s*(\([^)]*\))", sig)
                if pm:
                    extra["args"] = re.sub(r"\s+", " ", pm.group(1))[:200]
            found[kind].append({"name": name, "file": rel, "line": i, **extra})
            break
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", help="ruta de salida JSON (opcional)")
    ap.add_argument("--summary", action="store_true", help="imprimir solo el resumen")
    args = ap.parse_args()

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    per_kind = defaultdict(list)
    for f in files:
        for kind, items in scan_file(f).items():
            per_kind[kind].extend(items)

    result = {
        "generated_from": "shared/supabase/migrations/*.sql",
        "file_count": len(files),
        "kinds": {},
    }
    for kind in sorted(per_kind):
        items = per_kind[kind]
        by_name = defaultdict(list)
        for it in items:
            by_name[it["name"]].append(it)
        result["kinds"][kind] = {
            "statements": len(items),
            "unique_names": len(by_name),
            "objects": {n: v for n, v in sorted(by_name.items())},
        }

    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"archivos sql analizados: {len(files)}")
    for kind in sorted(result["kinds"]):
        k = result["kinds"][kind]
        print(f"{kind:10s} sentencias={k['statements']:4d}  nombres unicos={k['unique_names']:4d}")
    if not args.summary and not args.json:
        print(json.dumps(result, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
