#!/usr/bin/env python3
"""
Catálogo estático de tablas y vistas de las migraciones (solo lectura).

No abre conexiones. Deduplica archivos symlink y produce, por objeto, todas
las definiciones encontradas y si el bloque declara `tenant_id`.

Uso:
    python3 tools/database/extract_table_catalog.py \
        --out docs/database-portability/_data/table-catalog.json
"""
from __future__ import annotations

import argparse
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIRS = ['shared/supabase/migrations', 'web/migrations', 'mobile/migrations']


def line_of(text: str, idx: int) -> int:
    return text.count('\n', 0, idx) + 1


def mask_sql(text: str) -> str:
    out = []
    i, n = 0, len(text)
    instr = None
    dollar = None
    while i < n:
        if dollar:
            if text.startswith(dollar, i):
                out.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            out.append(text[i])
            i += 1
            continue
        if instr:
            out.append(text[i])
            if text[i] == instr:
                if i + 1 < n and text[i + 1] == instr:
                    out.append(text[i + 1])
                    i += 2
                    continue
                instr = None
            i += 1
            continue
        if text[i] == "'":
            instr = "'"
            out.append(text[i])
            i += 1
            continue
        dm = re.match(r'\$[A-Za-z0-9_]*\$', text[i:])
        if dm:
            dollar = dm.group(0)
            out.append(dollar)
            i += len(dollar)
            continue
        if text.startswith('--', i):
            j = text.find('\n', i)
            j = n if j == -1 else j
            out.append(' ' * (j - i))
            i = j
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = n if j == -1 else j + 2
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in text[i:j]))
            i = j
            continue
        out.append(text[i])
        i += 1
    return ''.join(out)


def find_block_end(text: str, start: int) -> int:
    """Devuelve el índice del ';' que cierra el DDL."""
    depth = 0
    i, n = start, len(text)
    while i < n:
        c = text[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth = max(0, depth - 1)
        elif c == ';' and depth == 0:
            return i
        i += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    files, seen = [], set()
    for d in DIRS:
        p = os.path.join(ROOT, d)
        for fn in sorted(os.listdir(p)):
            full = os.path.join(p, fn)
            if fn.endswith('.sql') and os.path.isfile(full):
                real = os.path.realpath(full)
                if real not in seen:
                    seen.add(real)
                    files.append(full)

    catalog: dict[str, dict] = {}
    rx = re.compile(
        r'\bcreate\s+(or\s+replace\s+)?(table|view|materialized\s+view)\s+'
        r'(?:if\s+not\s+exists\s+)?(?:public\.)?["\']?([a-z0-9_]+)["\']?',
        re.I,
    )
    for path in files:
        rel = os.path.relpath(path, ROOT)
        text = mask_sql(open(path, encoding='utf-8', errors='replace').read())
        for m in rx.finditer(text):
            kind = re.sub(r'\s+', ' ', m.group(2).lower())
            name = m.group(3).lower()
            line = line_of(text, m.start())
            end = find_block_end(text, m.end())
            block = text[m.end():end + 1]
            cols = re.findall(r'^\s*([a-z_][a-z0-9_]*)\s+', block, re.I | re.M)
            item = catalog.setdefault(name, {'name': name, 'kind': kind, 'defs': []})
            item['kind'] = kind if kind != 'table' else item.get('kind', kind)
            item['defs'].append({
                'file': rel, 'line': line, 'has_tenant_id': bool(re.search(r'\btenant_id\b', block, re.I)),
                'columns': sorted(set(c.lower() for c in cols))[:120],
            })
    for item in catalog.values():
        item['has_tenant_id'] = any(d['has_tenant_id'] for d in item['defs'])
        item['def_count'] = len(item['defs'])

    if args.out:
        path = os.path.join(ROOT, args.out) if not os.path.isabs(args.out) else args.out
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(catalog, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f"escrito {path}")
    print(f"archivos={len(files)} objetos={len(catalog)} "
          f"tablas={sum(1 for x in catalog.values() if x['kind'] == 'table')} "
          f"vistas={sum(1 for x in catalog.values() if 'view' in x['kind'])} "
          f"con_tenant={sum(1 for x in catalog.values() if x['has_tenant_id'])}")


if __name__ == '__main__':
    main()
