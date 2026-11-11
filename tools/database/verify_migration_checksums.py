#!/usr/bin/env python3
"""Inspect local migration files without writing files or contacting a database."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


NAME = re.compile(r"([0-9]{4})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.up\.sql", re.ASCII)
SHA256 = re.compile(r"[0-9a-f]{64}", re.ASCII)
DEFAULT_DIRECTORY = Path(__file__).resolve().parents[2] / "database" / "migrations"


class ValidationError(Exception):
    """An invalid local input, with a safe message for CLI output."""


def parse_name(name):
    match = NAME.fullmatch(name) if isinstance(name, str) else None
    if match is None or int(match.group(1)) == 0:
        raise ValidationError("Nombre inválido; se requiere NNNN_nombre.up.sql, versión 0001–9999.")
    return match.group(1)


def validate_entries(entries):
    if not isinstance(entries, list) or not entries:
        raise ValidationError("La lista de migraciones debe ser no vacía.")
    versions, names = set(), set()
    previous = 0
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"version", "name", "sha256"}:
            raise ValidationError("Cada migración debe contener solo version, name y sha256.")
        version = parse_name(entry["name"])
        if entry["version"] != version:
            raise ValidationError("La versión no coincide con el nombre de la migración.")
        if version in versions or entry["name"] in names:
            raise ValidationError("Existen nombres o versiones de migración duplicados.")
        if int(version) <= previous:
            raise ValidationError("Las migraciones deben estar ordenadas por versión ascendente.")
        digest = entry["sha256"]
        if not isinstance(digest, str) or SHA256.fullmatch(digest) is None:
            raise ValidationError("Checksum SHA-256 inválido; se requieren 64 caracteres hexadecimales minúsculos.")
        versions.add(version)
        names.add(entry["name"])
        previous = int(version)
    return entries


def manifest(directory):
    if not directory.is_dir():
        raise ValidationError("El directorio de migraciones no existe o no es un directorio.")
    entries = []
    # Direct children only: historical migrations and SQL tests are not included.
    for path in sorted(directory.glob("*.up.sql"), key=lambda item: item.name):
        version = parse_name(path.name)
        if path.is_symlink() or not path.is_file():
            raise ValidationError("Cada migración debe ser un archivo regular, sin enlaces simbólicos.")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(65536), b""):
                digest.update(block)
        entries.append({"version": version, "name": path.name, "sha256": digest.hexdigest()})
    return {"schema_version": 1, "migrations": validate_entries(entries)}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError("El JSON contiene claves duplicadas.")
        result[key] = value
    return result


def load_state(path):
    with path.open("r", encoding="utf-8") as source:
        state = json.load(source, object_pairs_hook=unique_object)
    if not isinstance(state, dict) or set(state) != {"schema_version", "migrations"}:
        raise ValidationError("El estado debe contener solo schema_version y migrations.")
    if type(state["schema_version"]) is not int or state["schema_version"] != 1:
        raise ValidationError("schema_version debe ser el entero 1.")
    validate_entries(state["migrations"])
    return state


def compare(current, state):
    expected = {item["version"]: item for item in state["migrations"]}
    actual = {item["version"]: item for item in current["migrations"]}
    # Print only validated version identifiers; never echo arbitrary state content.
    differences = []
    for version in sorted(expected.keys() | actual.keys()):
        if version not in actual:
            differences.append(f"{version}: falta el archivo registrado")
        elif version not in expected:
            differences.append(f"{version}: archivo sin registrar en el estado")
        elif actual[version] != expected[version]:
            differences.append(f"{version}: nombre o checksum diferente")
    return differences


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY,
                        help="Directorio local (por defecto: database/migrations del repositorio).")
    parser.add_argument("--state", type=Path, help="JSON local opcional; exige coincidencia exacta.")
    args = parser.parse_args(argv)
    try:
        current = manifest(args.directory)
        differences = compare(current, load_state(args.state)) if args.state else []
    except ValidationError as error:
        print(f"Entrada inválida: {error}", file=sys.stderr)
        return 2
    except (OSError, UnicodeError, ValueError, RecursionError):
        # Exception messages can include secrets, paths or raw JSON fragments.
        print("No se pudieron leer o interpretar los archivos locales.", file=sys.stderr)
        return 2
    print(json.dumps(current, indent=2, ensure_ascii=True))
    if differences:
        for difference in differences:
            print(difference, file=sys.stderr)
        return 1
    print("Checksums verificados." if args.state else "Checksums calculados; sin estado de comparación.",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
