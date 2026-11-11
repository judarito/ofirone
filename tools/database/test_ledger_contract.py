#!/usr/bin/env python3
"""Contratos del ledger de migraciones (réplica de las reglas del runner Go).

No ejecuta el runner real (requiere Go); valida la lógica documentada:
- historia ordenada y consecutiva desde 1;
- ledger como prefijo EXACTO de la historia (versión, nombre, checksum);
- ninguna fila dirty;
- sin huecos, versiones desconocidas ni reordenamientos.

Salida: PASS/FAIL por caso y resumen. Sin acceso a base de datos.
"""

import hashlib
import sys
from pathlib import Path


class LedgerError(Exception):
    pass


def checksum(text):
    return hashlib.sha256(text.encode()).hexdigest()


def validate(history, ledger):
    if not history:
        raise LedgerError("historia vacía")
    for idx, m in enumerate(history, 1):
        if m["version"] != idx:
            raise LedgerError(f"historia no consecutiva en {m['version']}")
        if m["name"] != f"{idx:04d}_{m['slug']}.up.sql":
            raise LedgerError(f"nombre inválido {m['name']}")
        if not isinstance(m["checksum"], str) or len(m["checksum"]) != 64:
            raise LedgerError("checksum inválido")
    if len(ledger) > len(history):
        raise LedgerError("ledger más largo que la historia (versión aplicada desconocida)")
    for idx, row in enumerate(ledger):
        expected = history[idx]
        if row.get("dirty"):
            raise LedgerError(f"fila dirty en versión {row.get('version')}")
        if row.get("version") != expected["version"]:
            raise LedgerError("hueco o versión distinta en el ledger")
        if row.get("name") != expected["name"]:
            raise LedgerError(f"nombre distinto en versión {expected['version']}")
        if row.get("checksum") != expected["checksum"]:
            raise LedgerError(f"checksum distinto en versión {expected['version']}")
    return len(history) - len(ledger)


def main():
    slugs = ["core", "identity", "control"]
    history = [
        {"version": i, "slug": s, "name": f"{i:04d}_{s}.up.sql", "checksum": checksum(s)}
        for i, s in enumerate(slugs, 1)
    ]
    lines, failures = ["Contrato del ledger (reglas del runner)", ""], 0

    def case(label, expect_ok, history_arg, ledger_arg, expected_pending=None):
        nonlocal failures
        try:
            pending = validate(history_arg, ledger_arg)
            ok = expect_ok and (expected_pending is None or pending == expected_pending)
            detail = f"pending={pending}"
        except LedgerError as exc:
            ok = not expect_ok
            detail = f"rechazado: {exc}"
        lines.append(f"[{'PASS' if ok else 'FAIL'}] {label}: {detail}")
        failures += 0 if ok else 1

    def row(i, **kw):
        base = dict(history[i - 1])
        base.update(kw)
        return base

    case("ledger vacío: 3 pendientes", True, history, [], 3)
    case("ledger exacto: 0 pendientes", True, history, [row(1), row(2), row(3)], 0)
    case("prefijo de 2: 1 pendiente", True, history, [row(1), row(2)], 1)
    case("ledger más largo: rechazo", False, history, [row(1), row(2), row(3), row(3)])
    case("nombre distinto: rechazo", False, history, [row(1, name="0001_otro.up.sql")])
    case("checksum distinto: rechazo", False, history, [row(1, checksum="0" * 64)])
    case("dirty: rechazo", False, history, [row(1, dirty=True)])
    case("hueco en historia: rechazo", False, history, [row(1), row(3)])
    case("historia reordenada: rechazo", False, [history[1], history[0], history[2]], [])

    lines.append("")
    lines.append(f"RESULTADO GLOBAL: {'PASS' if failures == 0 else 'CON FALLOS'}")
    text = "\n".join(lines)
    Path("docs/database-portability/_data/validation-ledger-contract-0012.txt").write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
