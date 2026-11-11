#!/usr/bin/env python3
"""
Extrae definiciones de funciones SQL de las migraciones (solo lectura).

Fuentes: shared/supabase/migrations (canónica) + archivos propios de
web/migrations y mobile/migrations (no symlinks). Deduplica por ruta real.

Uso:
    python3 tools/database/extract_sql_functions.py \
        --out docs/database-portability/_data/sql-functions.json
"""
from __future__ import annotations

import argparse
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIRS = ['shared/supabase/migrations', 'web/migrations', 'mobile/migrations']

FUNC_RE = re.compile(r'\bcreate\s+(or\s+replace\s+)?function\s+([A-Za-z0-9_."]+)\s*\(', re.I)
DOLLAR_RE = re.compile(r'\bas\s+(\$[A-Za-z0-9_]*\$)', re.I)


def line_of(text: str, idx: int) -> int:
    return text.count('\n', 0, idx) + 1


def mask_sql(text: str) -> str:
    """Enmascara comentarios SQL conservando longitud y saltos de línea.

    No enmascara el interior de literales entre comillas simples ni de
    bloques $$...$$, para no alterar cuerpos ni offsets.
    """
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


def find_matching(text: str, open_idx: int) -> int:
    depth, i, n = 0, open_idx, len(text)
    instr = None
    while i < n:
        c = text[i]
        if instr:
            if c == instr:
                # comillas SQL duplicadas
                if i + 1 < n and text[i + 1] == instr:
                    i += 2
                    continue
                instr = None
        elif c in "'\"":
            instr = c
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n - 1


def split_params(s: str) -> list[str]:
    out, depth, cur, instr = [], 0, [], None
    for c in s:
        if instr:
            cur.append(c)
            if c == instr:
                instr = None
            continue
        if c in "'\"":
            instr = c
            cur.append(c)
        elif c in '([{':
            depth += 1
            cur.append(c)
        elif c in ')]}':
            depth -= 1
            cur.append(c)
        elif c == ',' and depth == 0:
            out.append(''.join(cur).strip())
            cur = []
        else:
            cur.append(c)
    if cur:
        out.append(''.join(cur).strip())
    return [p for p in out if p]


def clean_param(p: str, maxlen: int = 34) -> str:
    p = re.sub(r'--[^\n]*', ' ', p)
    p = re.sub(r'/\*.*?\*/', ' ', p, flags=re.S)
    p = re.sub(r'\s+', ' ', p).strip()
    p = re.sub(r'\bDEFAULT\b.*$', '', p, flags=re.I).strip()
    # conserva nombre y tipo base (sin default)
    if len(p) > maxlen:
        p = p[:maxlen - 1] + '…'
    return p


def short_sig(name: str, params: list[str]) -> str:
    shown = [clean_param(p) for p in params[:8]]
    sig = ', '.join(shown)
    if len(params) > 8:
        sig += f', … (+{len(params) - 8})'
    return f"{name}({sig})"


def classify(name: str, file: str, body: str) -> str:
    """Clasifica por tokens del nombre; evita falsos positivos por subcadena.

    Ej.: `average` no debe caer en RAG por contener "rag"; `cost` es demasiado
    genérico y solo se usa junto a `average`.
    """
    tokens = set(t for t in name.lower().split('_') if t)
    f = file.lower()
    b = body.lower()

    def has(*words: str) -> bool:
        return any(w in tokens for w in words)

    # El orden importa: un trigger contable de ventas es contabilidad, no ventas.
    if has('accounting', 'journal', 'ledger', 'withholding', 'period', 'periods',
           'posting', 'debit', 'chart'):
        return 'contabilidad'
    if has('import', 'imports', 'bulk', 'dataimport', 'csv'):
        return 'importación masiva'
    if has('notification', 'notifications', 'push', 'email', 'emails', 'outbox', 'notify'):
        return 'notificaciones/outbox'
    if has('layaway', 'layaways', 'separado', 'separados'):
        return 'layaway/separados'
    if has('purchase', 'purchases', 'supplier', 'payable', 'payables'):
        return 'compras/proveedores'
    if has('sale', 'sales', 'pos', 'cash', 'cashier', 'return', 'returns', 'counter',
           'tax', 'taxes', 'price', 'pricing', 'discount', 'rounding'):
        return 'ventas/caja'
    if has('credit', 'receivable', 'receivables', 'cartera', 'collection', 'collections'):
        return 'cartera/crédito'
    if has('tenant', 'tenants', 'subscription', 'subscriptions', 'billing', 'plan', 'plans',
           'superadmin', 'menu', 'menus', 'role', 'roles', 'user', 'users', 'permission',
           'permissions', 'auth', 'membership', 'profile', 'access', 'admin', 'manager',
           'password', 'can', 'login'):
        return 'identidad/tenancy'
    if has('stock', 'batch', 'batches', 'inventory', 'bom', 'production', 'manufacturing',
           'manufacture', 'transfer', 'adjustment', 'expiration', 'fefo', 'variant',
           'variants', 'component', 'components', 'bundle', 'kardex', 'rotation'):
        return 'inventario/producción'
    if has('average') and has('cost'):
        return 'inventario/producción'
    if has('alert', 'alerts'):
        return 'alertas'
    if has('telemetry', 'ai', 'rag', 'ocr', 'insight', 'insights', 'forecast', 'agent'):
        return 'IA/telemetría'
    if has('report', 'reports', 'dashboard', 'summary', 'summaries'):
        return 'reportes'
    if has('online', 'storefront', 'public', 'store', 'order'):
        return 'tienda online/público'
    if name.lower().startswith('trg_') or 'trigger' in name.lower():
        return 'trigger'
    if name.lower().startswith(('fn_refresh', 'fn_recalc', 'fn_sync', 'fn_touch')):
        return 'mantenimiento'
    if 'auth.uid()' in b:
        return 'identidad/tenancy'
    return 'soporte/otros'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    files, seen_real = [], set()
    for d in DIRS:
        p = os.path.join(ROOT, d)
        for fn in sorted(os.listdir(p)):
            full = os.path.join(p, fn)
            if not fn.endswith('.sql') or not os.path.isfile(full):
                continue
            real = os.path.realpath(full)
            if real in seen_real:
                continue
            seen_real.add(real)
            files.append(full)

    funcs = []
    for path in files:
        rel = os.path.relpath(path, ROOT)
        text = mask_sql(open(path, encoding='utf-8', errors='replace').read())
        for m in FUNC_RE.finditer(text):
            name_raw = m.group(2)
            name = name_raw.split('.')[-1].strip('"')
            line = line_of(text, m.start())
            o = m.end() - 1
            c = find_matching(text, o)
            params = split_params(text[o + 1:c])
            # cabecera hasta AS $$ o LANGUAGE o BEGIN (2000 chars)
            tail = text[c + 1:c + 2500]
            dm = DOLLAR_RE.search(tail)
            head = tail[:dm.start()] if dm else tail[:1200]
            body = ''
            if dm:
                endtok = dm.group(1)
                bstart = c + 1 + dm.end()
                bend = text.find(endtok, bstart)
                body = text[bstart:bend if bend != -1 else bstart + 6000]
            ret = ''
            rm = re.search(r'\breturns\s+(.+?)(?=\blanguage\b|\bas\s+\$|\bsecurity\b|\bset\s+search_path\b|\$)', head, re.I | re.S)
            if rm:
                ret = re.sub(r'\s+', ' ', rm.group(1)).strip()[:90]
            sd = bool(re.search(r'\bsecurity\s+definer\b', head, re.I))
            sp = bool(re.search(r'\bset\s+search_path\b', head, re.I))
            lang_m = re.search(r'\blanguage\s+([a-z0-9_]+)', head, re.I)
            vol_m = re.search(r'\b(volatile|stable|immutable)\b', head, re.I)
            funcs.append({
                'file': rel, 'line': line, 'name': name, 'name_raw': name_raw,
                'params': params, 'sig': short_sig(name, params), 'returns': ret,
                'security_definer': sd, 'search_path': sp,
                'language': lang_m.group(1) if lang_m else '',
                'volatility': vol_m.group(1).lower() if vol_m else '',
                'domain': classify(name, rel, body),
                'body_head': re.sub(r'\s+', ' ', body.strip())[:900],
                'is_trigger': bool(re.search(r'\breturns\s+trigger\b', head, re.I)),
                'uses_auth': bool(re.search(r'\bauth\.(uid|role|jwt)\s*\(|request\.jwt', body, re.I)),
                'uses_storage': bool(re.search(r'\bstorage\.', body, re.I)),
                'uses_realtime': bool(re.search(r'\brealtime\.', body, re.I)),
                'uses_cron': bool(re.search(r'\b(?:cron\.|pg_cron)\b', body, re.I)),
                'uses_net': bool(re.search(r'\bnet\.http|\bhttp_(?:get|post)\s*\(', body, re.I)),
                'uses_vault': bool(re.search(r'\bvault\.', body, re.I)),
                'uses_supabase': bool(re.search(r'\bsupabase_(?:functions|migrations|storage)\b', body, re.I)),
                'uses_dynsql': bool(re.search(r'\bexecute\s+(?:format\s*\(|\')', body, re.I)),
                'writes': sorted(set(x.lower() for x in re.findall(
                    r'\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?([a-z][a-z0-9_]+)',
                    body, re.I)) - {'set', 'values', 'select', 'where', 'table', 'only'})[:10],
                'calls': sorted(set(x.lower() for x in re.findall(
                    r'\b([a-z][a-z0-9_]{2,})\s*\(', body, re.I)))[:30],
            })

    funcs.sort(key=lambda x: (x['domain'], x['name'], x['file'], x['line']))
    # marcar redefiniciones por nombre+firma de parámetros
    groups = {}
    for f in funcs:
        key = (f['name'], len(f['params']))
        groups.setdefault(key, []).append(f)
    for key, arr in groups.items():
        for i, f in enumerate(arr, 1):
            f['variant'] = i
            f['variants'] = len(arr)

    if args.out:
        path = os.path.join(ROOT, args.out) if not os.path.isabs(args.out) else args.out
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(funcs, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f"escrito {path}")
    print(f"archivos={len(files)} definiciones={len(funcs)} nombres={len(groups)} "
          f"sd={sum(1 for f in funcs if f['security_definer'])}")
    from collections import Counter
    for d, n in Counter(f['domain'] for f in funcs).most_common():
        print(f"  {d}: {n}")


if __name__ == '__main__':
    main()
