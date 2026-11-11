#!/usr/bin/env python3
"""
supabase_dependency_scan.py — Inventario estatico de dependencias Supabase.

No se conecta a ninguna base de datos ni a ningun servicio: solo lee archivos
.sql del repositorio y, opcionalmente, escribe un JSON donde se le indique.
Es de solo lectura sobre el repositorio y no imprime credenciales ni URLs.

Uso:
    python3 tools/database/supabase_dependency_scan.py
    python3 tools/database/supabase_dependency_scan.py --json docs/database-portability/_data/supabase-deps.json
    python3 tools/database/supabase_dependency_scan.py --include-extras

Por defecto analiza solo `shared/supabase/migrations/` (fuente canonica asumida).
Con `--include-extras` agrega los archivos .sql que existen en `web/migrations/`
o `mobile/migrations/` y no estan en `shared/`.

Salida:
    Conteos por categoria, ocurrencias con evidencia archivo:linea, politicas
    RLS (totales y con auth.*), funciones cuyo cuerpo usa auth.* o claims, y
    tablas con RLS habilitado.

Limitaciones:
    - Analisis textual (regex), no un parser SQL. El DDL dinamico dentro de
      bloques DO/EXECUTE se detecta como texto, no como objeto resuelto.
    - Cuenta sentencias historicas, no el estado final desplegado.
    - No resuelve search_path: asume `public` cuando no hay esquema.
    - No ejecuta SQL. No requiere PostgreSQL.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_DIR = REPO_ROOT / "shared" / "supabase" / "migrations"
EXTRA_DIRS = [REPO_ROOT / "web" / "migrations", REPO_ROOT / "mobile" / "migrations"]

# Categorias -> (descripcion, regex). El regex es case-insensitive y se aplica
# sobre el texto completo; la linea se calcula a partir del offset.
DEPENDENCIES = {
    "identity": [
        ("auth.uid()", r"auth\.uid\s*\(\s*\)"),
        ("auth.jwt()", r"auth\.jwt\s*\(\s*\)"),
        ("auth.role()", r"auth\.role\s*\(\s*\)"),
        ("auth.email()", r"auth\.email\s*\(\s*\)"),
        ("auth.users", r"\bauth\.users\b"),
        ("request.jwt.claim*", r"request\.jwt\.claim"),
        ("set_config request.jwt", r"set_config\s*\(\s*'request\.jwt"),
        ("columna auth_user_id", r"\bauth_user_id\b"),
        ("tabla profiles (legado)", r"\bpublic\.profiles\b|\bprofiles\b"),
    ],
    "storage": [
        ("storage.objects", r"\bstorage\.objects\b"),
        ("storage.buckets", r"\bstorage\.buckets\b"),
        ("storage.create_bucket", r"\bstorage\.create_bucket\b"),
        ("storage.foldername", r"\bstorage\.foldername\b"),
        ("bucket_id", r"\bbucket_id\b"),
    ],
    "realtime": [
        ("supabase_realtime", r"\bsupabase_realtime\b"),
        ("postgres_changes", r"\bpostgres_changes\b"),
        ("alter publication", r"\balter\s+publication\b"),
    ],
    "platform": [
        ("supabase_functions", r"\bsupabase_functions\b"),
        ("pg_net / net.http_post", r"\bnet\.http_post\b|\bpg_net\b"),
        ("vault", r"\bvault\."),
        ("pg_cron / cron.schedule", r"\bpg_cron\b|\bcron\.(?:schedule|unschedule)\b"),
        ("create extension", r"\bcreate\s+extension\b"),
    ],
    "roles": [
        ("rol anon", r"\banon\b"),
        ("rol authenticated", r"\bauthenticated\b"),
        ("rol service_role", r"\bservice_role\b"),
        ("grant/revoke", r"\b(?:grant|revoke)\b"),
    ],
}

AUTH_RE = re.compile(
    r"auth\.(?:uid|jwt|role|email)\s*\(\s*\)|request\.jwt\.claim", re.I
)
POLICY_RE = re.compile(
    r"(?is)\bcreate\s+policy\s+(?P<name>\"[^\"]+\"|[A-Za-z_][\w$]*)"
    r"\s+on\s+(?P<table>(?:\"[^\"]+\"|[A-Za-z_][\w$]*)(?:\.(?:\"[^\"]+\"|[A-Za-z_][\w$]*))?)"
    r"(?P<body>.*?);"
)
FUNC_RE = re.compile(
    r"(?im)^\s*create\s+(?:or\s+replace\s+)?function\s+"
    r"(?P<name>(?:\"[^\"]+\"|[A-Za-z_][\w$]*)(?:\.(?:\"[^\"]+\"|[A-Za-z_][\w$]*))?)\s*\("
)
RLS_RE = re.compile(
    r"(?im)^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?"
    r"(?P<table>(?:\"[^\"]+\"|[A-Za-z_][\w$]*)(?:\.(?:\"[^\"]+\"|[A-Za-z_][\w$]*))?)"
    r"\s+enable\s+row\s+level\s+security"
)
DOLLAR = re.compile(r"\$([A-Za-z_0-9]*)\$")


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def norm_ident(value: str) -> str:
    value = value.replace('"', "").replace(" ", "").strip().lower()
    if value.startswith("public."):
        value = value[len("public.") :]
    return value


def iter_files(include_extras: bool) -> tuple[list[Path], list[Path]]:
    shared = sorted(SHARED_DIR.glob("*.sql"))
    extras: list[Path] = []
    if include_extras:
        shared_names = {p.name for p in shared}
        for directory in EXTRA_DIRS:
            for path in sorted(directory.glob("*.sql")):
                if path.name not in shared_names:
                    extras.append(path)
    return shared, extras


def scan_occurrences(paths: list[Path]) -> tuple[dict, dict, dict]:
    counts: dict[str, Counter] = {cat: Counter() for cat in DEPENDENCIES}
    files: dict[str, set] = {cat: set() for cat in DEPENDENCIES}
    evidence: dict[str, dict[str, list]] = {
        cat: {label: [] for label, _ in items} for cat, items in DEPENDENCIES.items()
    }

    compiled = {
        cat: [(label, re.compile(rx, re.I)) for label, rx in items]
        for cat, items in DEPENDENCIES.items()
    }

    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(REPO_ROOT).as_posix()
        for cat, patterns in compiled.items():
            for label, rx in patterns:
                matches = list(rx.finditer(text))
                if not matches:
                    continue
                counts[cat][label] += len(matches)
                files[cat].add(rel)
                for match in matches:
                    start = max(0, match.start() - 60)
                    end = min(len(text), match.end() + 60)
                    snippet = " ".join(text[start:end].split())
                    evidence[cat][label].append(
                        {"file": rel, "line": line_of(text, match.start()), "snippet": snippet}
                    )

    return counts, files, evidence


def scan_policies(paths: list[Path]) -> dict:
    total = 0
    unique: set[tuple[str, str]] = set()
    by_table: Counter = Counter()
    with_auth = 0
    with_storage = 0
    with_role = 0
    dynamic = 0
    examples_auth: list[dict] = []
    examples_other: list[dict] = []

    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(REPO_ROOT).as_posix()
        for match in POLICY_RE.finditer(text):
            name = norm_ident(match.group("name"))
            table_raw = match.group("table")
            table = norm_ident(table_raw)
            body = match.group("body") or ""
            total += 1
            # DDL dinamico: `EXECUTE format('CREATE POLICY ... ON public.%I ...')`.
            # El regex solo alcanza a capturar `public` como tabla y deja `.%I`
            # al inicio del cuerpo; tambien se detecta por el `format(` previo.
            prefix = text[max(0, match.start() - 240) : match.start()]
            if (
                "%i" in table_raw.lower()
                or "%s" in table_raw.lower()
                or table in {"%i", "%s"}
                or re.match(r"^\s*\.\s*%[is]", body, re.I)
                or re.search(r"format\s*\(\s*'[^']*create\s+policy", prefix, re.I)
            ):
                dynamic += 1
                continue
            unique.add((table, name))
            by_table[table] += 1
            has_auth = bool(re.search(r"auth\.(?:uid|jwt|role|email)\s*\(", body, re.I))
            has_storage = bool(re.search(r"storage\.", body, re.I))
            has_role = bool(re.search(r"auth\.role\s*\(|service_role", body, re.I))
            if has_auth:
                with_auth += 1
                if len(examples_auth) < 12:
                    examples_auth.append(
                        {
                            "file": rel,
                            "line": line_of(text, match.start()),
                            "table": table,
                            "name": name,
                        }
                    )
            if has_storage:
                with_storage += 1
            if has_role:
                with_role += 1
            if not has_auth and len(examples_other) < 8:
                examples_other.append(
                    {
                        "file": rel,
                        "line": line_of(text, match.start()),
                        "table": table,
                        "name": name,
                    }
                )

    return {
        "statements": total,
        "unique": len(unique),
        "dynamic_ddl_skipped": dynamic,
        "with_auth_uid_jwt_role_email": with_auth,
        "with_storage": with_storage,
        "with_service_role": with_role,
        "top_tables": by_table.most_common(15),
        "examples_auth": examples_auth,
        "examples_other": examples_other,
    }


def scan_functions(paths: list[Path]) -> dict:
    definitions = 0
    dependent: dict[str, list] = defaultdict(list)
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(REPO_ROOT).as_posix()
        for match in FUNC_RE.finditer(text):
            definitions += 1
            name = norm_ident(match.group("name"))
            tail = text[match.end() : match.end() + 8000]
            quote = DOLLAR.search(tail)
            if not quote:
                continue
            tag = quote.group(0)
            body_start = match.end() + quote.end()
            body_end = text.find(tag, body_start)
            if body_end == -1:
                continue
            body = text[body_start:body_end]
            found = sorted({m.group(0).lower() for m in AUTH_RE.finditer(body)})
            if found:
                dependent[name].append(
                    {
                        "file": rel,
                        "line": line_of(text, match.start()),
                        "apis": found,
                    }
                )
    return {
        "definitions": definitions,
        "dependent_unique": len(dependent),
        "dependent": {k: v for k, v in sorted(dependent.items())},
    }


def scan_rls(paths: list[Path]) -> dict:
    tables: set[str] = set()
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in RLS_RE.finditer(text):
            tables.add(norm_ident(match.group("table")))
    return {"tables_enabled": len(tables), "tables": sorted(tables)}


def summarize(label: str, paths: list[Path]) -> dict:
    counts, files, evidence = scan_occurrences(paths)
    return {
        "label": label,
        "file_count": len(paths),
        "files": [p.relative_to(REPO_ROOT).as_posix() for p in paths],
        "counts": {cat: dict(counter) for cat, counter in counts.items()},
        "files_with_dependency": {cat: sorted(v) for cat, v in files.items()},
        "policy": scan_policies(paths),
        "function": scan_functions(paths),
        "rls": scan_rls(paths),
        "evidence": evidence,
    }


def print_summary(result: dict) -> None:
    print(f"Alcance: {result['label']} ({result['file_count']} archivos .sql)")
    for cat, counter in result["counts"].items():
        if not counter:
            continue
        total = sum(counter.values())
        print(f"\n[{cat}] {total} ocurrencias")
        for label, value in sorted(counter.items(), key=lambda kv: -kv[1]):
            print(f"  {value:5d}  {label}")
    pol = result["policy"]
    print(
        f"\n[RLS] {pol['statements']} sentencias create policy, "
        f"{pol['unique']} unicas (tabla+nombre), "
        f"{pol['with_auth_uid_jwt_role_email']} usan auth.*, "
        f"{pol['with_storage']} tocan storage.*, "
        f"{pol['with_service_role']} mencionan service_role, "
        f"{pol['dynamic_ddl_skipped']} son DDL dinamico no resuelto"
    )
    print(
        f"[RLS] {result['rls']['tables_enabled']} tablas con "
        f"enable row level security"
    )
    fn = result["function"]
    print(
        f"[Funciones] {fn['definitions']} definiciones, "
        f"{fn['dependent_unique']} nombres con auth.*/claims en el cuerpo"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Escaneo estatico de dependencias Supabase")
    parser.add_argument("--json", help="ruta de salida JSON (opcional)")
    parser.add_argument(
        "--include-extras",
        action="store_true",
        help="incluye migraciones propias de web/ y mobile/ ausentes en shared/",
    )
    args = parser.parse_args()

    shared, extras = iter_files(args.include_extras)
    result = {
        "generated_from": {
            "shared_dir": SHARED_DIR.relative_to(REPO_ROOT).as_posix(),
            "extra_dirs": [d.relative_to(REPO_ROOT).as_posix() for d in EXTRA_DIRS],
            "include_extras": args.include_extras,
            "date": "2026-11-08",
            "postgresql_note": "Analisis textual; no requiere conexion ni ejecuta SQL.",
        },
        "canonical": summarize("shared/supabase/migrations", shared),
        "extras": summarize("extras web/mobile", extras) if extras else None,
    }

    print_summary(result["canonical"])
    if result["extras"]:
        print("\n" + "=" * 70)
        print_summary(result["extras"])

    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nJSON escrito en: {out}")


if __name__ == "__main__":
    main()
