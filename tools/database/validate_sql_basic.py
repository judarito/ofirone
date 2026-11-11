#!/usr/bin/env python3
"""Validación básica y estática de los scripts SQL de tools/database/.

No sustituye a un parser de PostgreSQL ni a ejecutar los scripts contra una
base real. Comprueba:

- que cada archivo exista, no esté vacío y termine en ``COMMIT;``;
- que abra con ``BEGIN;`` y declare ``SET TRANSACTION READ ONLY``;
- que los paréntesis y los delimitadores de cadena estén balanceados;
- que no aparezcan sentencias de escritura fuera de comentarios o literales;
- que no haya cadenas de conexión, contraseñas ni URLs de base de datos;
- que se mencione PostgreSQL >= 15 y una advertencia de confirmación explícita.

Uso:
    python3 tools/database/validate_sql_basic.py [archivos...]

Sin argumentos valida los ``0*.sql`` del directorio del script.
Salida: una línea por archivo y código de salida 1 si hay errores.
"""

from __future__ import annotations

import glob
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WRITE_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|"
    r"CALL|VACUUM|ANALYZE|REFRESH|CLUSTER|REINDEX|COMMENT\s+ON)\b",
    re.IGNORECASE,
)
SECRET_PATTERNS = [
    re.compile(r"postgres(?:ql)?://", re.IGNORECASE),
    re.compile(r"DATABASE_URL\s*=", re.IGNORECASE),
    re.compile(r"password\s*=", re.IGNORECASE),
    re.compile(r"PGPASSWORD", re.IGNORECASE),
]


def strip_sql(text: str) -> tuple[str, list[str]]:
    """Devuelve (código sin comentarios ni literales, errores de delimitadores).

    Conserva los caracteres de estructura (paréntesis, punto y coma) y
    reemplaza por espacios el contenido de comentarios y literales.
    """
    out: list[str] = []
    errors: list[str] = []
    i = 0
    n = len(text)
    line = 1
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "\n":
            line += 1
            out.append(ch)
            i += 1
            continue
        if ch == "-" and nxt == "-":
            j = text.find("\n", i)
            if j == -1:
                j = n
            out.append(" " * (j - i))
            i = j
            continue
        if ch == "/" and nxt == "*":
            j = text.find("*/", i + 2)
            if j == -1:
                errors.append(f"línea {line}: comentario /* sin cerrar")
                break
            segment = text[i : j + 2]
            out.append("".join("\n" if c == "\n" else " " for c in segment))
            line += segment.count("\n")
            i = j + 2
            continue
        if ch == "'":
            start_line = line
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        j += 2
                        continue
                    break
                if text[j] == "\n":
                    line += 1
                j += 1
            if j >= n:
                errors.append(f"línea {start_line}: literal ' sin cerrar")
                break
            out.append(" " * (j + 1 - i))
            i = j + 1
            continue
        if ch == "$":
            m = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text[i:])
            if m:
                tag = m.group(0)
                start_line = line
                j = text.find(tag, i + len(tag))
                if j == -1:
                    errors.append(f"línea {start_line}: dollar-quote {tag} sin cerrar")
                    break
                segment = text[i : j + len(tag)]
                out.append("".join("\n" if c == "\n" else " " for c in segment))
                line += segment.count("\n")
                i = j + len(tag)
                continue
        out.append(ch)
        i += 1
    return "".join(out), errors


def check_file(path: str) -> list[str]:
    errors: list[str] = []
    warnings: list[str] = []
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        return [f"no se pudo leer: {exc}"]
    if not text.strip():
        return ["archivo vacío"]

    code, lex_errors = strip_sql(text)
    errors.extend(lex_errors)

    if code.count("(") != code.count(")"):
        errors.append(
            f"paréntesis desbalanceados: {code.count('(')} abiertos, "
            f"{code.count(')')} cerrados"
        )
    if code.count("[") != code.count("]"):
        warnings.append("corchetes desbalanceados (revisar arrays)")

    if re.search(r",\s*FROM\b", code, re.IGNORECASE):
        errors.append("coma colgante antes de FROM (revise la lista de columnas)")

    body = code.strip()
    if not re.match(r"\ABEGIN\s*;", body, re.IGNORECASE):
        errors.append("no comienza con BEGIN;")
    if not re.search(r"COMMIT\s*;\s*\Z", body, re.IGNORECASE):
        errors.append("no termina con COMMIT;")
    if not re.search(r"SET\s+TRANSACTION\s+READ\s+ONLY", body, re.IGNORECASE):
        errors.append("falta SET TRANSACTION READ ONLY (garantía de solo lectura)")
    if not re.search(r"PostgreSQL\s*(mín\.?|min\.?|>=)?\s*:?\s*15", text, re.IGNORECASE):
        warnings.append("no se declara PostgreSQL 15 como mínimo")

    for pattern in SECRET_PATTERNS:
        if pattern.search(text):
            errors.append(f"posible credencial/URL de base de datos: {pattern.pattern}")

    statements = [s.strip() for s in body.split(";") if s.strip()]
    write_hits = []
    for stmt in statements:
        for match in WRITE_KEYWORDS.finditer(stmt):
            keyword = re.sub(r"\s+", " ", match.group(1)).upper()
            # BEGIN/COMMIT y SET no son escritura de datos.
            if keyword in {"ANALYZE"}:
                warnings.append("contiene ANALYZE: puede adquirir locks; revisar")
            write_hits.append(keyword)
    if write_hits:
        errors.append("posibles sentencias de escritura: " + ", ".join(sorted(set(write_hits))))

    if "ADVERTENCIA" not in text.upper() and "CONFIRMACI" not in text.upper():
        warnings.append("no incluye advertencia de confirmación explícita")

    if re.search(r"\bLIMIT\b", text, re.IGNORECASE):
        warnings.append("usa LIMIT: correcto para acotar salida")
    else:
        warnings.append("sin LIMIT explícito: revisar volumen de salida")

    for warning in warnings:
        print(f"  aviso: {warning}")
    return errors


def main(argv: list[str]) -> int:
    paths = argv[1:] or sorted(glob.glob(os.path.join(SCRIPT_DIR, "0*.sql")))
    if not paths:
        print("No se encontraron scripts 0*.sql")
        return 1
    failures = 0
    for path in paths:
        print(f"[{os.path.basename(path)}]")
        errors = check_file(path)
        if errors:
            failures += 1
            for error in errors:
                print(f"  ERROR: {error}")
        else:
            print("  OK (validación estática básica)")
    print()
    print(
        f"{len(paths) - failures}/{len(paths)} archivos sin errores básicos. "
        "La semántica y la ejecución real siguen pendientes."
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
