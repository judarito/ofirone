#!/usr/bin/env python3
"""
Extrae sitios de consulta (.from / .rpc) de los clientes web y mobile.

Solo lectura: no abre conexiones a base de datos ni modifica archivos del
repositorio salvo el JSON de salida indicado por --out.

Uso:
    python3 tools/database/extract_query_sites.py \
        --out docs/database-portability/_data/query-sites.json
"""
from __future__ import annotations

import argparse
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIRS = [
    'web/src/services',
    'web/src/views',
    'mobile/src/services',
    'mobile/src/screens',
]


def line_of(text: str, idx: int) -> int:
    return text.count('\n', 0, idx) + 1


def strip_comments(text: str) -> str:
    """Sustituye comentarios por espacios conservando los saltos de línea."""
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            j = n if j == -1 else j
            out.append(' ' * (j - i))
            i = j
        elif c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            j = n if j == -1 else j
            seg = text[i:j + 2]
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in seg))
            i = j + 2
        elif c in "'\"`":
            q = c
            j = i + 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def find_matching(text: str, open_idx: int, open_ch: str = '(', close_ch: str = ')') -> int:
    depth = 0
    i, n = open_idx, len(text)
    instr = None
    while i < n:
        c = text[i]
        if instr:
            if c == '\\':
                i += 2
                continue
            if c == instr:
                instr = None
        elif c in "'\"`":
            instr = c
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n - 1


def first_string(s: str) -> str:
    m = re.search(r"['\"`]([^'\"`]{0,160})['\"`]", s, re.S)
    return m.group(1).strip() if m else ''


def split_top_args(s: str) -> list[str]:
    args, depth, cur, instr = [], 0, [], None
    for c in s:
        if instr:
            cur.append(c)
            if c == instr:
                instr = None
            continue
        if c in "'\"`":
            instr = c
            cur.append(c)
        elif c in '([{':
            depth += 1
            cur.append(c)
        elif c in ')]}':
            depth -= 1
            cur.append(c)
        elif c == ',' and depth == 0:
            args.append(''.join(cur).strip())
            cur = []
        else:
            cur.append(c)
    if cur:
        args.append(''.join(cur).strip())
    return args


def parse_methods(chain: str) -> list[tuple[str, str]]:
    calls = []
    i, n = 0, len(chain)
    while i < n:
        m = re.search(r'\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(', chain[i:])
        if not m:
            break
        open_idx = i + m.end() - 1
        close_idx = find_matching(chain, open_idx)
        calls.append((m.group(1), chain[open_idx + 1:close_idx].strip()))
        i = close_idx + 1
    return calls


def chain_end(text: str, start: int) -> int:
    depth, i, n = 0, start, len(text)
    while i < n:
        c = text[i]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
            if depth < 0:
                return i
        elif c == ';' and depth == 0:
            return i + 1
        elif c == '\n' and depth == 0:
            j = i + 1
            while j < n and text[j] in ' \t\r\n':
                j += 1
            if j < n and text[j] != '.':
                return i
        i += 1
    return n


def norm_value(v: str, maxlen: int = 42) -> str:
    v = re.sub(r'\s+', ' ', v).strip().strip('{} ')
    return v[:maxlen - 1] + '…' if len(v) > maxlen else v


def extract_direct_filters(calls):
    filters, order = [], []
    limit = select_cols = count = ''
    for name, args in calls:
        if name == 'select':
            select_cols = norm_value(first_string(args), 70)
            cm = re.search(r"count\s*:\s*['\"](\w+)['\"]", args)
            if cm:
                count = cm.group(1)
            if re.search(r'head\s*:\s*true', args):
                count += ' head'
        elif name in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
                      'is', 'in', 'contains', 'overlaps', 'textSearch'):
            parts = split_top_args(args)
            if len(parts) >= 2:
                field = parts[0].strip().strip("'\"")
                filters.append(f"{field} {name} {norm_value(parts[1])}")
        elif name == 'or':
            f = 'OR ' + norm_value(args)
            if f not in filters:
                filters.append(f)
        elif name == 'not':
            parts = split_top_args(args)
            if len(parts) >= 3:
                f = (f"NOT({parts[0].strip().strip(chr(39)+chr(34))} "
                     f"{parts[1].strip().strip(chr(39)+chr(34))} {norm_value(parts[2], 20)})")
            else:
                f = 'NOT ' + norm_value(args)
            if f not in filters:
                filters.append(f)
        elif name == 'match':
            filters.append('match ' + norm_value(args))
        elif name == 'filter':
            filters.append('filter ' + norm_value(args))
        elif name == 'order':
            parts = split_top_args(args)
            col = parts[0].strip().strip("'\"") if parts else ''
            asc = ''
            if len(parts) > 1 and ('ascending: false' in parts[1] or 'ascending:false' in parts[1]):
                asc = ' desc'
            order.append(f"{col}{asc}")
        elif name == 'limit':
            limit = norm_value(args, 20)
        elif name == 'range':
            limit = 'range ' + norm_value(args, 30)
    return filters, order, limit, select_cols, count


def extract_assigned_filters(text: str, var: str, start: int, end: int) -> list[str]:
    """Captura filtros condicionales aplicados después: var = var.eq(...)."""
    seg = text[start:end]
    found = []
    pattern = r'\b' + re.escape(var) + r'\s*=\s*' + re.escape(var) + r'\s*\.\s*(\w+)\s*\('
    for m in re.finditer(pattern, seg):
        name = m.group(1)
        if name not in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
                        'is', 'in', 'or', 'not', 'textSearch', 'filter'):
            continue
        o = start + m.end() - 1
        c = find_matching(text, o)
        parts = split_top_args(text[o + 1:c])
        if name == 'not' and len(parts) >= 3:
            f = (f"NOT({parts[0].strip().strip(chr(39)+chr(34))} "
                 f"{parts[1].strip().strip(chr(39)+chr(34))} {norm_value(parts[2], 20)}) (cond.)")
        elif len(parts) >= 2:
            field = parts[0].strip().strip("'\"")
            f = f"{field} {name} {norm_value(parts[1], 30)} (cond.)"
        else:
            f = f"{name} {norm_value(text[o + 1:c], 30)} (cond.)"
        if f not in found:
            found.append(f)
        if len(found) >= 12:
            break
    return found


def resolve_identifier(text: str, expr: str) -> str | None:
    """Resuelve this.tabla, constante local o nombre de tabla literal."""
    expr = expr.strip()
    m = re.fullmatch(r'this\.(\w+)', expr)
    if m:
        am = re.search(r'this\.' + re.escape(m.group(1)) + r'\s*=\s*[\'"`]([^\'"`]+)[\'"`]', text)
        return am.group(1) if am else None
    if re.fullmatch(r'[A-Za-z_$][\w$]*', expr):
        am = re.search(r'(?:const|let|var)\s+' + re.escape(expr) + r'\s*=\s*[\'"`]([^\'"`]+)[\'"`]', text)
        if am:
            return am.group(1)
        # algunos servicios declaran la tabla como propiedad de clase
        am = re.search(r'this\.' + re.escape(expr) + r'\s*=\s*[\'"`]([^\'"`]+)[\'"`]', text)
        return am.group(1) if am else None
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    files = []
    for d in DIRS:
        p = os.path.join(ROOT, d)
        for base, _, names in os.walk(p):
            if '__tests__' in base or '/node_modules/' in base:
                continue
            for fn in names:
                if fn.endswith(('.js', '.vue')):
                    files.append(os.path.join(base, fn))
    files.sort()

    out = {'from': [], 'rpc': []}
    for f in files:
        rel = os.path.relpath(f, ROOT)
        text = strip_comments(open(f, encoding='utf-8', errors='replace').read())

        for m in re.finditer(
            r"\.from\s*\(\s*(?:['\"`]([^'\"`]+)['\"`]|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))",
            text,
        ):
            table = m.group(1)
            if not table:
                table = resolve_identifier(text, m.group(2) or '')
                if not table:
                    table = '?' + (m.group(2) or '')
            # storage.from() no consulta una tabla SQL; Array.from()/Buffer.from()
            # son utilidades JS, no consultas.
            prefix = text[max(0, m.start() - 40):m.start()]
            if 'storage' in prefix.lower():
                continue
            if re.search(r'\b(?:Array|Buffer|Object|Set|Map)\s*$', prefix):
                continue
            line = line_of(text, m.start())
            end = chain_end(text, m.start())
            chain = text[m.start():end]
            pre = text[max(0, m.start() - 320):m.start()]
            vm = re.search(r'(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[\w$.]+\s*$',
                           pre, re.S)
            var = vm.group(1) if vm else None
            calls = parse_methods(chain)
            filters, order, limit, cols, count = extract_direct_filters(calls)
            if var and var not in ('data', 'error', 'result', 'response'):
                filters += extract_assigned_filters(text, var, m.start(),
                                                    min(len(text), m.start() + 3000))
            row_mode = 'many'
            if re.search(r'\.\s*(?:single|maybeSingle)\s*\(', chain):
                row_mode = 'one'
            elif any(f.startswith(table + '_id eq') or f.startswith('id eq') for f in filters):
                row_mode = 'one-ish'
            out['from'].append({
                'file': rel, 'line': line, 'table': table, 'var': var,
                'filters': filters, 'order': order, 'limit': limit,
                'select': cols, 'count': count, 'row_mode': row_mode,
                'list': bool(order or limit or count or table.startswith('vw_')),
                'snippet': re.sub(r'\s+', ' ', chain)[:600],
            })

        for m in re.finditer(r"\.rpc\s*\(\s*\n?\s*(?:['\"`]([^'\"`]+)['\"`]|([A-Za-z_$][\w$.]+))", text):
            fn = m.group(1) or ('?' + (m.group(2) or ''))
            line = line_of(text, m.start())
            o = text.find('(', m.start())
            c = find_matching(text, o)
            call = text[m.start():c + 1]
            payload = []
            for am in re.finditer(r'(\w+)\s*:', call):
                if am.group(1) not in payload:
                    payload.append(am.group(1))
            out['rpc'].append({
                'file': rel, 'line': line, 'fn': fn, 'payload': payload,
                'snippet': re.sub(r'\s+', ' ', call)[:500],
            })

    if args.out:
        path = os.path.join(ROOT, args.out) if not os.path.isabs(args.out) else args.out
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f"escrito {path}")
    print(f"archivos={len(files)} from={len(out['from'])} rpc={len(out['rpc'])} "
          f"listados={sum(1 for x in out['from'] if x['list'])} "
          f"tablas={len(set(x['table'] for x in out['from']))} "
          f"rpc_unicas={len(set(x['fn'] for x in out['rpc']))}")


if __name__ == '__main__':
    main()
