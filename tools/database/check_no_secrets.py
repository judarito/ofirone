#!/usr/bin/env python3
"""Escáner de secretos para el paquete de portabilidad.

Falla (exit 1) si encuentra credenciales, URLs con password, JWT, claves
privadas o identificadores de rol/base de infraestructura persistidos.
Pensado como chequeo previo a commit para docs/database-portability,
docs/decisions y tools/database.

Uso:
  python3 tools/database/check_no_secrets.py [rutas...]
"""

import re
import sys
from pathlib import Path

PATTERNS = [
    ("url_con_credenciales", re.compile(r"postgres(?:ql)?://[^:\s\"'<>]+:[^@\s\"'<>]+@[A-Za-z0-9.-]+")),
    ("rol_owner_infra", re.compile(r"\b(?!ofirone)[a-z][a-z0-9]{2,}_owner\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}")),
    ("service_role_asignada", re.compile(r"SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S{10,}")),
    ("password_asignada", re.compile(r"(?i)\b(password|passwd|pwd)\b\s*[:=]\s*['\"][^'\"]{8,}['\"]")),
    ("clave_privada", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
]

ALLOW_EXT = {".md", ".json", ".py", ".sql", ".txt", ".yaml", ".yml", ".js"}
DEFAULT_PATHS = ["docs/database-portability", "docs/decisions", "tools/database"]


def scan_file(path: Path):
    findings = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return findings
    for lineno, line in enumerate(text.splitlines(), 1):
        for name, rx in PATTERNS:
            if rx.search(line):
                findings.append((name, str(path), lineno, line.strip()[:160]))
    return findings


def main(argv):
    targets = argv[1:] or DEFAULT_PATHS
    findings = []
    for target in targets:
        base = Path(target)
        candidates = [base] if base.is_file() else sorted(base.rglob("*"))
        for path in candidates:
            if path.is_file() and (path.suffix.lower() in ALLOW_EXT or path.name == "README.md"):
                findings.extend(scan_file(path))
    if findings:
        for name, file, line, snippet in findings:
            print(f"FAIL [{name}] {file}:{line}: {snippet}")
        print(f"\n{len(findings)} hallazgo(s) de secretos.")
        return 1
    print("PASS: sin credenciales, URLs con password, JWT ni identificadores de infraestructura en el paquete.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
