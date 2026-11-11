#!/usr/bin/env python3
"""
Genera docs/database-portability/_data/listings-and-rpcs.md a partir de:
  - query-sites.json      (sitios .from/.rpc en web/mobile)
  - sql-functions.json    (definiciones CREATE FUNCTION en migraciones)
  - table-catalog.json    (tablas/vistas y tenant_id)

Solo lectura sobre el código; escribe el Markdown indicado por --out.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'docs', 'database-portability', '_data')

PRIORITY_DOMAINS = [
    'ventas/caja',
    'compras/proveedores',
    'cartera/crédito',
    'layaway/separados',
    'importación masiva',
    'inventario/producción',
    'contabilidad',
    'notificaciones/outbox',
]
AUX_DOMAINS = [
    'identidad/tenancy',
    'tienda online/público',
    'soporte/otros',
    'alertas',
    'IA/telemetría',
    'reportes',
    'mantenimiento',
    'trigger',
]

FK_INDIRECT = {
    'sale_id', 'sale_line_id', 'cash_session_id', 'import_id', 'batch_id',
    'product_id', 'purchase_id', 'purchase_order_id', 'layaway_id',
    'credit_account_id', 'online_order_id', 'order_id', 'payable_id',
    'supplier_id', 'customer_id', 'production_order_id', 'bom_id',
    'transfer_id', 'user_id', 'role_id', 'notification_id', 'event_id',
}

NOTES = {
    # ventas / caja
    'sp_create_sale': 'Venta atómica: cabecera, líneas, pagos, numeración y stock/lotes. 7 variantes; ver R01.',
    'sp_create_sale_idempotent': 'Idempotencia por operation_id (advisory lock + mobile_sale_operations). Ver R02.',
    'sp_create_return': 'Devolución base: repone stock e inserta reembolsos. Ver R03.',
    'sp_create_return_v2': 'Valida reembolsos contra el total y delega en sp_create_return. Ver R03.',
    'fn_get_sale_warnings': 'Lectura de advertencias de stock/precio para el POS.',
    'fn_next_sale_number': 'Consecutivo de venta por tenant/sede; requiere lock o UNIQUE portable.',
    'fn_get_open_cash_session_for_user': 'Sesión de caja abierta del usuario; depende de auth.uid().',
    'sp_open_cash_session': 'Apertura de caja con validación de usuario/asignación.',
    'sp_close_cash_session_secure': 'Cierre de caja con validación de permisos y descuadre.',
    'sp_close_cash_session': 'Cierre de caja (variante previa); seleccionar una sola definición.',
    'sp_assign_cash_register_to_user': 'Asigna caja a usuario; administración de sedes.',
    'fn_user_can_use_cash_register': 'Autorización de uso de caja; mover a contexto de aplicación.',
    'fn_pos_home_context': 'Contexto agregado del POS (caja, alertas); lectura multi-tabla.',
    'get_sales_by_role': 'Variante legacy por rol; depende de auth/RLS, revisar eliminación.',
    'get_sale_lines_by_role': 'Variante legacy por rol; depende de auth/RLS, revisar eliminación.',
    'get_sale_payments_by_role': 'Variante legacy por rol; depende de auth/RLS, revisar eliminación.',

    # inventario / producción
    'fn_apply_stock_delta': 'Delta de stock; convive con el modelo de lotes. Ver R07.',
    'fn_apply_stock_reservation_delta': 'Ajusta la cantidad reservada del saldo.',
    'fn_allocate_stock_fefo': 'Asigna lotes FEFO sin persistir el consumo. Ver R08.',
    'fn_consume_batch_stock': 'Consume un lote con lock; descuenta on_hand/reserved. Ver R09.',
    'fn_consume_bom_components': 'Consume componentes de BOM y calcula costos. Ver R10.',
    'fn_complete_production': 'Cierra orden, consume BOM y genera lote/output. Ver R11.',
    'fn_create_production_order': 'Crea orden de producción con tenant/sede; valida BOM y cantidades.',
    'fn_start_production': 'Inicia orden de producción; validar estado y tenant.',
    'fn_create_batch': 'Crea lote de inventario; usada por compras y manufactura.',
    'fn_generate_batch_number': 'Numeración de lote por ubicación; requiere secuencia/unique portable.',
    'fn_update_average_cost': 'Costo promedio ponderado por entrada; trigger de inventario.',
    'sp_create_inventory_adjustment': 'Ajuste de inventario con movimiento; usado por mobile.',
    'sp_create_transfer_request': 'Solicitud de traslado entre sedes; no mueve stock hasta recepción.',
    'sp_receive_transfer_request': 'Recepción de traslado; aplica entrada/salida y diferencias.',
    'fn_refresh_stock_balances': 'Recalcula el snapshot de saldos; mantenimiento, no usar para decidir stock.',
    'fn_refresh_stock_alerts': 'Recalcula alertas de stock mínimo.',
    'fn_refresh_expiration_alerts': 'Recalcula alertas de vencimiento; operación global de mantenimiento.',
    'fn_refresh_layaway_alerts': 'Recalcula alertas de separados; operación global de mantenimiento.',
    'fn_refresh_all_alerts': 'Recalcula todas las alertas; operación global de mantenimiento.',
    'fn_get_purchase_suggestions': 'Sugerencia de reposición por prioridad y límite.',
    'fn_variant_requires_expiration': 'Regla de vencimiento por variante; auxiliar de ventas/compras.',
    'fn_get_effective_inventory_behavior': 'Resuelve comportamiento de inventario configurado por tenant.',

    # compras / proveedores
    'sp_create_purchase': 'Compra atómica + lotes/movimiento de entrada. 5 variantes; ver R04.',
    'sp_create_purchase_order': 'Orden de compra con líneas; no mueve stock.',
    'sp_receive_purchase_order': 'Recepción total de orden; genera compra. Ver R05.',
    'sp_receive_purchase_order_partial': 'Recepción parcial con lock de cabecera. Ver R05.',
    'sp_create_purchase_return': 'Devolución a proveedor con salida de stock. Ver R06.',
    'sp_create_manual_purchase_ingress': 'Ingreso manual de compra (variante mobile); aplica stock/lote.',
    'sp_create_supplier_payable': 'CxP desde compra; evita duplicado por compra.',
    'sp_register_supplier_payment': 'Pago de CxP con lock; actualiza pagado/saldo/estado.',
    'sp_get_supplier_payables_dashboard': 'Lectura de cartera de proveedores por estado/vencimiento.',
    'fn_accounting_trg_purchases_enqueue': 'Trigger: encola asiento contable de compra.',
    'fn_refresh_supplier_payable_alerts': 'Recalcula alertas de CxP; operación global de mantenimiento.',

    # layaway / separados
    'sp_create_layaway': 'Contrato, items, pago inicial y reserva de stock; 4 variantes.',
    'sp_add_layaway_payment': 'Pago con lock de contrato ACTIVE; actualiza saldo/estado.',
    'sp_complete_layaway_to_sale': 'Convierte separado en venta; consume stock y registra pagos.',
    'sp_cancel_layaway': 'Cancela/expira contrato y libera reserva; lock de cabecera.',
    'fn_expire_due_layaways': 'Job de contratos vencidos; invoca sp_cancel_layaway.',
    'fn_recalc_layaway_totals': 'Recalcula subtotal/impuesto/total del contrato.',

    # cartera / crédito
    'fn_update_credit_balance': 'SECURITY DEFINER; ajusta saldo por credit_account_id sin tenant → riesgo.',
    'create_auth_user': 'Alta de usuario en auth; migrar hash/credenciales fuera de SQL y revisar privilegios.',
    'change_user_password': 'Cambio de contraseña; revisar algoritmo de hash y no depender de auth de Supabase.',
    'fn_refresh_customer_receivable_alerts': 'Recalcula alertas de cartera. p_tenant DEFAULT NULL: la llamada sin payload refresca todos los tenants (a verificar).',
    'trg_refresh_customer_receivable_alerts': 'Trigger que refresca alertas de cartera.',
    'trg_enqueue_credit_movement_email': 'Trigger de outbox para movimientos de crédito.',

    # importación masiva
    'fn_set_dataimport_tenant_metadata': 'Metadata del bucket dataimport; depende de storage/Supabase.',
    'trg_enqueue_bulk_import_email': 'Trigger de outbox para importación masiva.',

    # contabilidad
    'fn_accounting_post_entry': 'SECURITY DEFINER; valida usuario/tenant/periodo y postea DRAFT. Ver R12.',
    'fn_accounting_process_queue': 'SECURITY DEFINER; worker de cola contable con dedupe. Ver R13.',
    'fn_accounting_open_period': 'Abre periodo contable; validar unicidad por tenant.',
    'fn_accounting_close_period': 'Cierra periodo contable; validar bloqueo de asientos del rango.',
    'fn_accounting_reopen_period': 'Reabre periodo; validar autorización y asientos ya posteados.',
    'fn_accounting_is_period_open': 'Predicado de periodo abierto; auxiliar de posteo.',
    'fn_accounting_is_period_closed': 'Predicado de periodo cerrado; auxiliar de posteo.',
    'fn_accounting_summary': 'Resumen contable por rango; lectura.',
    'fn_accounting_trial_balance': 'Balance de comprobación; lectura agregada.',
    'fn_accounting_get_withholding_summary': 'Resumen de retenciones; lectura.',
    'fn_accounting_enqueue_event': 'Encola evento contable; base del outbox.',
    'fn_accounting_trg_sales_enqueue': 'Trigger: encola asiento de venta.',
    'fn_accounting_seed_chart_for_tenant': 'Provisión de catálogo contable para un tenant.',
    'fn_accounting_seed_competitive_defaults_new_tenant': 'Provisión inicial de configuración contable.',
    'fn_accounting_process_queue_all_tenants': 'Worker multi-tenant; revisar autorización y límites.',

    # notificaciones / outbox
    'fn_emit_notification_event': 'SECURITY DEFINER; inserta evento y notificación in-app con dedupe.',
    'fn_enqueue_email_notification': 'SECURITY DEFINER; outbox de email con dedupe por clave.',
    'fn_list_my_notifications': 'SECURITY DEFINER; lista del usuario con limit/offset acotados.',
    'fn_mark_notification_read': 'SECURITY DEFINER; marca una notificación del usuario.',
    'fn_mark_all_notifications_read': 'SECURITY DEFINER; marca todas las del usuario.',
    'fn_upsert_my_push_device': 'SECURITY DEFINER; registra token push del usuario.',
    'fn_deactivate_my_push_device': 'SECURITY DEFINER; desactiva token push del usuario.',
    'fn_set_my_notification_pref': 'SECURITY DEFINER; preferencias de notificación del usuario.',
    'fn_push_dispatcher_cron': 'SECURITY DEFINER; usa pg_cron/net/vault; no portable directo.',
    'fn_notify_from_system_alerts': 'SECURITY DEFINER; traduce alertas a notificaciones.',
    'fn_enqueue_subscription_status_emails': 'Encola correos de cambio de suscripción.',
    'fn_enqueue_push_for_notification': 'Trigger/worker que encola push a partir de notificación.',
    'trg_enqueue_sale_customer_email': 'Trigger de outbox para venta.',
    'trg_enqueue_sale_return_email': 'Trigger de outbox para devolución.',
    'trg_enqueue_layaway_email': 'Trigger de outbox para separado.',
    'trg_enqueue_layaway_payment_email': 'Trigger de outbox para pago de separado.',
    'trg_enqueue_supplier_payable_email': 'Trigger de outbox para CxP.',
    'trg_enqueue_online_order_email': 'Trigger de outbox para pedido online.',
    'trg_enqueue_operational_email': 'Trigger de outbox operativo.',
    'trg_enqueue_subscription_email': 'Trigger de outbox de suscripción.',
    'trg_enqueue_user_created_email': 'Trigger de outbox de alta de usuario.',

    # jobs
    'fn_claim_async_jobs': 'Claim con FOR UPDATE SKIP LOCKED. Ver R14.',
    'fn_complete_async_job': 'Completa job; no valida ownership/lease en la versión revisada. Ver R15.',
    'fn_fail_async_job': 'Fallo con backoff y transición de estado. Ver R16.',
    'fn_enqueue_async_job': 'Encola job asíncrono; revisar dedupe.',

    # identidad / autorización / pricing
    'fn_create_tenant': 'Alta de tenant y provisión inicial; operación de superadmin.',
    'get_current_user_tenant_id': 'Resuelve tenant desde auth.uid(); reemplazar por contexto de sesión.',
    'fn_current_user_tenant_id': 'Resuelve tenant desde auth.uid(); reemplazar por contexto de sesión.',
    'get_current_user_app_user_id': 'Resuelve usuario de aplicación desde auth.uid().',
    'has_permission': 'Autorización en SQL por permisos; mover a Go o a contexto firmado.',
    'fn_is_super_admin': 'Autorización de superadmin basada en claims/roles.',
    'fn_can_access_location': 'Autorización por sede; mover a contexto de aplicación.',
    'fn_get_user_menus': 'Menús por usuario/rol; lectura dependiente de auth.',
    'fn_calculate_price': 'Cálculo de precio; candidato a dominio Go puro.',
    'fn_get_pricing_policy': 'Política de precios por tenant; lectura.',
    'fn_get_tax_rate_for_variant': 'Tasa de impuesto por variante; auxiliar de ventas.',
    'fn_get_tax_info_for_variant': 'Información fiscal por variante; auxiliar de ventas.',
    'fn_calculate_tax_breakdown': 'Desglose de impuestos; candidato a dominio Go puro.',
    'fn_apply_rounding': 'Redondeo monetario; replicar exactamente en Go.',
    'fn_format_cop': 'Formato de moneda COP; no usar en persistencia.',
    'fn_escape_html': 'Utilidad de escape; no es lógica de negocio.',
    'fn_online_store_create_sale': 'Venta desde tienda online; revisar autorización pública y stock.',
    'fn_upsert_third_party': 'Upsert de tercero desde JSON; el tenant viaja dentro de p_data (a verificar).',
    'fn_create_online_manual_order': 'Pedido online manual; tenant desde el slug; 8 definiciones a consolidar.',
    'fn_confirm_online_manual_order': 'Confirma pedido online; validar autorización y pago.',
    'fn_reject_online_manual_order': 'Rechaza pedido online; validar autorización y motivo.',
    'fn_online_store_reserved_qty': 'Cantidad reservada de tienda online; lectura.',
    'fn_online_store_available_qty': 'Disponibilidad online; no confundir con stock físico.',
    'fn_get_public_order_status': 'RPC público por token; limitar datos expuestos.',
    'fn_get_public_online_store': 'RPC público de tienda; sin tenant de sesión.',
    'fn_list_public_online_store_products': 'RPC público de catálogo; paginación y filtros a revisar.',
    'fn_list_public_subscription_plans': 'RPC público de planes; lectura.',
}


# ---------------------------------------------------------------- utilidades

def esc(s: str) -> str:
    return (s or '').replace('|', '\\|').replace('\n', ' ').strip()


def clip(s: str, n: int) -> str:
    s = esc(s)
    return s if len(s) <= n else s[:n - 1] + '…'


def short_file(path: str) -> str:
    if path.startswith('shared/supabase/migrations/'):
        return path.rsplit('/', 1)[-1]
    if path.startswith('web/migrations/'):
        return 'web/' + path.rsplit('/', 1)[-1]
    if path.startswith('mobile/migrations/'):
        return 'mobile/' + path.rsplit('/', 1)[-1]
    return path


def site(x: dict) -> str:
    return f"`{x['file']}:{x['line']}`"


def definitions_cell(defs: list[dict], max_show: int = 4) -> str:
    seen, locs = set(), []
    for d in defs:
        key = (d['file'], d['line'])
        if key not in seen:
            seen.add(key)
            locs.append(f"{short_file(d['file'])}:{d['line']}")
    if len(locs) > max_show:
        return '; '.join(locs[:max_show]) + f'; +{len(locs) - max_show}'
    return '; '.join(locs) if locs else '—'


def sd_cell(defs: list[dict]) -> str:
    flags = {d['security_definer'] for d in defs}
    if flags == {True}:
        if any(not d['search_path'] for d in defs):
            return 'Sí (sin search_path)'
        return 'Sí'
    if flags == {False}:
        return 'No'
    return 'Mixto'


def function_consumers(funcs: list[dict], client_counts: Counter, internal_counts: Counter) -> str:
    names = {f['name'] for f in funcs}
    client = max((client_counts.get(n, 0) for n in names), default=0)
    internal = max((internal_counts.get(n, 0) for n in names), default=0)
    if client:
        return f'cliente ({client} sitios)'
    if internal:
        return f'SQL ({internal} refs)'
    return 'sin consumidor estático'


def function_note(name: str, defs: list[dict], client_counts: Counter,
                  internal_counts: Counter) -> str:
    base = NOTES.get(name)
    if not base:
        d = defs[0]
        if any(x['is_trigger'] for x in defs):
            base = 'Trigger de tabla.'
        elif client_counts.get(name):
            base = f"RPC cliente ({client_counts[name]} sitios)."
        elif internal_counts.get(name, 0) > 0:
            base = f"Auxiliar; {internal_counts[name]} referencias SQL."
        else:
            base = 'Sin consumidor estático; a verificar.'
        writes = sorted({w for x in defs for w in x.get('writes', [])})
        if writes and not any(x['is_trigger'] for x in defs):
            base += ' Escribe: ' + ', '.join(writes[:3]) + '.'
    extras = []
    if any(x.get('uses_auth') for x in defs):
        extras.append('usa auth.uid()/jwt')
    if any(x.get('uses_cron') for x in defs):
        extras.append('pg_cron')
    if any(x.get('uses_net') for x in defs):
        extras.append('net/http')
    if any(x.get('uses_vault') for x in defs):
        extras.append('vault')
    if any(x.get('uses_dynsql') for x in defs):
        extras.append('SQL dinámico')
    if extras:
        base += ' [' + ', '.join(dict.fromkeys(extras)) + '].'
    return clip(base, 190)


def entity_label(table: str, catalog: dict) -> str:
    meta = catalog.get(table)
    if not meta:
        return table
    kind = meta.get('kind', '')
    if kind == 'materialized view':
        return f'{table} (matview)'
    if 'view' in kind:
        return f'{table} (vista)'
    return table


def tenant_label(x: dict, catalog: dict) -> str:
    table = x['table']
    filters = x.get('filters', [])
    tenant_filters = [f for f in filters if re.search(r'(^|\.)tenant_id\s', f)]
    if tenant_filters:
        if any(re.match(r'[a-z_]+\.[a-z_]+', f) for f in tenant_filters):
            return 'Sí (join)'
        return 'Sí'
    meta = catalog.get(table)
    has = meta.get('has_tenant_id') if meta else None
    if has is False:
        return 'N/A'
    if any(f.split()[0] in FK_INDIRECT for f in filters if f.split()):
        return 'Indirecto (FK)'
    if has is None:
        return 'a verificar'
    return 'No'


def rpc_tenant_label(name: str, defs: list[dict], payload: list[str]) -> str:
    if name.startswith('?'):
        return 'a verificar'
    if name.startswith('fn_superadmin') or name in ('fn_create_tenant', 'change_user_password',
                                                    'create_auth_user'):
        return 'N/A (superadmin/auth)'
    params = [p for d in defs for p in d['params']]
    has_tenant = any(re.match(r'p_tenant(_id)?\b', p, re.I) for p in params)
    if has_tenant:
        return 'Sí (p_tenant)'
    if (name.startswith(('fn_get_public', 'fn_list_public', 'fn_create_public'))
            or 'online_store' in name or name == 'fn_get_public_order_status'):
        return 'N/A (público)'
    calls = {c for d in defs for c in d.get('calls', [])}
    if any(d.get('uses_auth') for d in defs) or calls & {
            'get_current_user_tenant_id', 'fn_current_user_tenant_id',
            'get_current_user_app_user_id', 'has_permission'}:
        return 'Deriva auth/contexto'
    joined = ' '.join(params)
    if re.search(r'p_(production_order|layaway|online_order|sale)\b', joined, re.I):
        return 'Deriva de entidad'
    if re.search(r'p_credit_account_id|p_payable_id', joined, re.I):
        return 'Indirecto (cuenta)'
    if re.search(r'p_auth_user_id', joined, re.I):
        return 'Por usuario (parámetro)'
    if re.search(r'p_slug\b', joined, re.I):
        return 'Deriva de tienda (slug)'
    if name.startswith('fn_refresh'):
        return 'N/A (global)'
    if not defs:
        return 'a verificar'
    return 'No / a verificar'


def query_kind(x: dict) -> str:
    if (x.get('count') or '').startswith('exact') and 'head' in (x.get('count') or ''):
        return 'conteo'
    lim = (x.get('limit') or '').strip()
    if lim == '1' or x.get('row_mode') == 'one':
        return 'detalle'
    if (x.get('order') or lim.startswith('range')
            or (lim.isdigit() and int(lim) > 1)
            or x.get('count') or x['table'].startswith('vw_')
            or x['table'] == 'stock_balances'):
        return 'listado'
    return 'consulta'


def query_signals(x: dict, kind: str, tenant: str) -> str:
    if kind == 'conteo':
        return 'conteo head'
    if kind == 'detalle':
        return 'puntual'
    sig = []
    if kind == 'consulta':
        sig.append('multirregistro')
    lim = (x.get('limit') or '').strip()
    if not lim and not x.get('count'):
        sig.append('sin límite')
    if not x.get('order'):
        sig.append('sin orden')
    else:
        if not any(o.rstrip().endswith('_id') or o == 'id' for o in x['order']):
            sig.append('orden sin desempate')
    if lim.startswith('range'):
        sig.append('offset')
    if lim.isdigit() and int(lim) > 500:
        sig.append('límite alto')
    if tenant == 'No':
        sig.append('sin tenant explícito')
    elif tenant == 'Indirecto (FK)':
        sig.append('tenant indirecto')
    if (x.get('count') or '').startswith('exact'):
        sig.append('count exacto')
    return '; '.join(sig) if sig else '—'


def is_mutation(x: dict) -> bool:
    return bool(re.search(r'\.(insert|update|delete|upsert)\s*\(', x['snippet'])) and \
        not re.search(r'\.select\s*\(', x['snippet'])


# ------------------------------------------------------------------- carga

def load() -> tuple[dict, list, dict]:
    q = json.load(open(os.path.join(DATA, 'query-sites.json'), encoding='utf-8'))
    f = json.load(open(os.path.join(DATA, 'sql-functions.json'), encoding='utf-8'))
    c = json.load(open(os.path.join(DATA, 'table-catalog.json'), encoding='utf-8'))
    return q, f, c


def build_function_index(funcs: list[dict]):
    """Agrupa por nombre + nombres de parámetros (misma firma redefinida)."""
    groups = defaultdict(list)
    for x in funcs:
        key = (x['name'], tuple(p.split()[0].lower() for p in x['params'] if p.split()))
        groups[key].append(x)
    return groups


def internal_call_counts(funcs: list[dict]) -> Counter:
    """Cuenta referencias SQL a cada función a partir del cuerpo disponible."""
    cnt = Counter()
    for x in funcs:
        for c in x.get('calls', []):
            cnt[c] += 1
    return cnt


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='docs/database-portability/_data/listings-and-rpcs.md')
    args = ap.parse_args()

    q, funcs, catalog = load()
    rpc = q['rpc']
    all_from = q['from']
    mutations = [x for x in all_from if is_mutation(x)]
    generic = [x for x in all_from if x['table'].startswith('?')]
    queries = [x for x in all_from if not is_mutation(x) and not x['table'].startswith('?')]

    fgroups = build_function_index(funcs)
    by_name = defaultdict(list)
    for x in funcs:
        by_name[x['name']].append(x)
    client_counts = Counter(x['fn'] for x in rpc if not x['fn'].startswith('?'))
    internal_counts = internal_call_counts(funcs)

    kinds = Counter(query_kind(x) for x in queries)
    listings = [x for x in queries if query_kind(x) == 'listado']
    counts_rows = [x for x in queries if query_kind(x) == 'conteo']
    details = [x for x in queries if query_kind(x) == 'detalle']

    # ---------------------------------------------------------------- Parte A
    lines: list[str] = []
    A = lines.append
    A('# Listados y RPCs — insumos para Tareas 5 y 6')
    A('')
    A(f'> Fecha de trabajo: **2026-11-08**. Análisis **estático** de `web/src/services`, '
      '`web/src/views`, `mobile/src/services`, `mobile/src/screens` y de las migraciones '
      'SQL del repositorio. No se abrió ninguna conexión a base de datos ni se ejecutó SQL '
      'contra DEV/PROD.')
    A('')
    A('Documento de datos para las tareas [5 (RPCs)](../rpc-characterization-matrix.md) y '
      '[6 (paginación)](../../../TAREAS_LLM_EXTERNO_POSTGRES.md). Complementa el '
      '[inventario de esquema](../schema-inventory.md) y la '
      '[propuesta de baseline](../baseline-proposal.md); no sustituye la validación en '
      'un PostgreSQL vacío. Rutas de archivo relativas a la raíz del repositorio.')
    A('')
    A('**Regla de lectura:** `a verificar` significa que el análisis estático no permite '
      'confirmar el dato (DDL ausente, RPC dinámico o despliegue no inspeccionado). No se '
      'inventaron entradas: cada fila proviene de un sitio `.from()`/`.rpc()` o de un '
      '`CREATE FUNCTION` localizado.')
    A('')
    A('## Resumen ejecutivo')
    A('')
    A('- **Clientes:** 208 archivos JS/Vue; 466 consultas de tabla y 140 llamadas RPC. '
      'La Tabla A.3 contiene los 466 sitios y la A.2 los 140 RPC, con `archivo:línea`, '
      'filtros, orden, límite y señal de tenant.')
    A('- **Paginación:** 200 listados, 17 conteos `head`, 166 accesos puntuales y 83 '
      'consultas multirregistro. Las señales de riesgo (sin límite, offset, orden sin '
      'desempate, tenant implícito) están fila a fila y agregadas en A.4.')
    A('- **RPCs:** 363 definiciones, 265 firmas y 256 nombres. 60 nombres tienen más de '
      'una definición; 61 definiciones `SECURITY DEFINER` no fijan `search_path` y 57 '
      'dependen de `auth.uid()`/`auth.jwt()`.')
    A('- **Sin validación en base:** DEV está vacía y PROD está bloqueado por falta de '
      'usuario de solo lectura. Todo el documento es análisis estático; los puntos no '
      'confirmados se marcan `a verificar`.')
    A('')
    A('**Mapa:** [Parte A](#parte-a--listados-y-consultas-de-webmobile) · '
      '[A.2 RPCs](#a2-rpcs-invocadas-desde-webmobile) · '
      '[A.3 consultas](#a3-consultas-de-tabla) · '
      '[A.4 señales](#a4-señales-agregadas-por-entidad) · '
      '[Parte B](#parte-b--rpcs-y-funciones-definidas-en-migraciones) · '
      '[B.2 prioritarias](#b2-funciones-prioritarias) · '
      '[B.4 redefiniciones](#b4-redefiniciones-y-sobrecargas).')
    A('')
    A('## Parte A — Listados y consultas de web/mobile')
    A('')
    A('### A.1 Cobertura y método')
    A('')
    A('| Métrica | Valor |')
    A('|---|---:|')
    A(f'| Archivos JS/Vue revisados | 208 |')
    A(f'| Sitios `.from()` localizados | {len(all_from)} |')
    A(f'| — consultas de tabla | {len(queries)} |')
    A(f'| — mutaciones excluidas | {len(mutations)} |')
    A(f'| — tablas dinámicas no resueltas | {len(generic)} |')
    A(f'| Sitios `.rpc()` localizados | {len(rpc)} |')
    A(f'| RPCs distintas invocadas | {len(set(x["fn"] for x in rpc))} (2 dinámicas) |')
    A(f'| Consultas: listados | {kinds["listado"]} |')
    A(f'| Consultas: conteos `head` | {kinds["conteo"]} |')
    A(f'| Consultas: accesos puntuales | {kinds["detalle"]} |')
    A(f'| Consultas: multirregistro sin orden ni límite | {kinds["consulta"]} |')
    A('')
    A('Dos sitios son a la vez mutación y tabla dinámica, por lo que los grupos no suman '
      'exactamente el total. El inventario completo, con los mismos campos que las tablas, '
      'está en [`query-sites.json`](query-sites.json). Los RPC dinámicos '
      '(`supabase.service.js` y el fallback de `mobile/src/services/sales.service.js`) no '
      'permiten enumerar el nombre de la función sin ejecutar el cliente; quedan como '
      '`a verificar`.')
    A('')

    # hallazgos
    broad = [x for x in queries if query_kind(x) in ('listado', 'consulta')]
    no_limit = [x for x in broad if not x.get('limit') and not x.get('count')]
    no_limit_l = [x for x in no_limit if query_kind(x) == 'listado']
    no_limit_c = [x for x in no_limit if query_kind(x) == 'consulta']
    no_order = [x for x in broad if not x.get('order')]
    no_tie = [x for x in broad if x.get('order') and
              not any(o.rstrip().endswith('_id') or o == 'id' for o in x['order'])]
    offset = [x for x in broad if (x.get('limit') or '').startswith('range')]
    no_tenant = [x for x in broad if tenant_label(x, catalog) == 'No']
    indirect = [x for x in broad if tenant_label(x, catalog).startswith('Indirecto')]
    A('**Hallazgos que afectan a la Tarea 6:**')
    A('')
    A(f'1. **{len(no_limit_l)} listados y {len(no_limit_c)} consultas multirregistro no '
      'declaran límite**, y **' + str(len(no_order)) + ' no declaran orden**. En varios '
      'casos son reportes o vistas que devuelven el conjunto completo del tenant; deben '
      'acotarse con cursor o límite máximo antes de exponerlos en Go.')
    A(f'2. **{len(offset)} listados usan paginación por offset** (`.range(offset, offset+n)` '
      'o `.range(from, to)`). El offset es sensible a inserciones y a orden no determinista; '
      'la Tarea 6 debe migrarlos a cursor/keyset.')
    A(f'3. **{len(no_tie)} listados/consultas ordenan sin clave de desempate** (no incluyen '
      '`*_id`). Un `ORDER BY sold_at DESC` o `name` sin `id` puede duplicar u omitir filas '
      'entre páginas.')
    A(f'4. **{len(no_tenant)} listados/consultas no filtran `tenant_id` de forma explícita** '
      f'y **{len(indirect)} lo hacen solo por una FK** (`sale_id`, `cash_session_id`, etc.). '
      'Con RLS de Supabase eso podía bastar; en PostgreSQL portable la autorización debe ser '
      'explícita en la consulta o en el repositorio. Excepción: catálogos globales como '
      '`units_of_measure`, `menu_items` o `cities` pueden ser `N/A` por diseño; revisar caso a caso.')
    A(f'5. **{len(counts_rows)} conteos usan `head: true`** y **'
      f'{sum(1 for x in broad if (x.get("count") or "").startswith("exact"))} listados piden '
      '`count: "exact"`**. El total exacto con joins/filtros es costoso; la Tarea 6 debe '
      'decidir cuándo usar `has_next` en lugar de `COUNT(*)`.')
    A('6. Las mismas entidades se consultan desde web y mobile con filtros y límites '
      'distintos (p. ej. `product_variants`, `sales`, `cash_sessions`). La duplicación es una '
      'fuente de divergencia de contrato.')
    A('')
    A('### A.2 RPCs invocadas desde web/mobile')
    A('')
    A('Ordenadas por dominio y nombre. `Tenant` se deduce de la firma SQL (`p_tenant`/'
      '`p_tenant_id`) y, si no existe, de `auth.uid()`/contexto. `Definición` remite a la '
      'Parte B; `(+n)` indica definiciones adicionales de la misma firma.')
    A('')
    A('| # | Sitio (archivo:línea) | RPC | Payload (claves) | Tenant | Definición | Nota |')
    A('|---:|---|---|---|---|---|---|')
    def rpc_domain(x):
        ds = by_name.get(x['fn'], [])
        return ds[0]['domain'] if ds else 'zz_sin_definicion'

    for i, x in enumerate(sorted(rpc, key=lambda y: (rpc_domain(y), y['fn'], y['file'], y['line'])), 1):
        name = x['fn']
        defs = by_name.get(name, [])
        if name.startswith('?'):
            definition = '—'
            note = 'resolución dinámica; no verificable estáticamente'
        else:
            tenant = rpc_tenant_label(name, defs, x['payload'])
            definition = definitions_cell(defs, 2) if defs else '—'
            dom = defs[0]['domain'] if defs else 'sin definición'
            base = NOTES.get(name, '')
            note = f'{dom}'
            if base:
                note += ' · ' + clip(base, 80)
            if not x['payload']:
                second = re.search(r"\.rpc\s*\(\s*['\"][^'\"]+['\"]\s*,\s*([A-Za-z_$][\w$.]*)", x['snippet'])
                if second:
                    note += ' · payload variable'
                elif defs and any(d['params'] for d in defs):
                    note += ' · llamada sin payload (a verificar)'
            if len(defs) > 1:
                note += f' · {len(defs)} defs'
        tenant = rpc_tenant_label(name, defs, x['payload']) if not name.startswith('?') else 'a verificar'
        A(f"| {i} | {site(x)} | `{name}` | {esc(', '.join(x['payload'])) or '—'} | "
          f"{tenant} | {definition} | {clip(note, 150)} |")
    A('')

    # tabla de consultas
    A('### A.3 Consultas de tabla')
    A('')
    A(f'Los {len(queries)} sitios `.from()` que no son mutaciones. `Tipo`: `listado` '
      '(orden, límite, rango, vista o `count`), `conteo` (`head: true`), `detalle` '
      '(`.limit(1)` o `.single()/.maybeSingle()`) o `consulta` (multirregistro sin orden ni '
      'límite). `Señales` son heurísticas estáticas, no planes de ejecución.')
    A('')
    A('| # | Sitio (archivo:línea) | Tipo | Entidad | Filtros | Orden | Límite | Tenant | Señales |')
    A('|---:|---|---|---|---|---|---|---|---|')
    ordered = sorted(queries, key=lambda y: (y['table'], y['file'], y['line']))
    for i, x in enumerate(ordered, 1):
        kind = query_kind(x)
        tenant = tenant_label(x, catalog)
        filtros = '; '.join(x['filters']) if x['filters'] else '—'
        orden = ', '.join(x['order']) if x['order'] else '—'
        limite = x['limit'] or '—'
        signals = query_signals(x, kind, tenant)
        A(f"| {i} | {site(x)} | {kind} | {entity_label(x['table'], catalog)} | "
          f"{clip(filtros, 165)} | {clip(orden, 55)} | {clip(limite, 38)} | {tenant} | "
          f"{clip(signals, 95)} |")
    A('')

    # agregados
    A('### A.4 Señales agregadas por entidad')
    A('')
    A('Entidades ordenadas por señal de riesgo (tenant + límite + desempate + offset). '
      'Solo se muestran las 30 primeras; el resto puede recalcularse desde '
      '[`query-sites.json`](query-sites.json).')
    A('')
    agg = defaultdict(lambda: Counter())
    for x in queries:
        kind = query_kind(x)
        t = tenant_label(x, catalog)
        s = agg[x['table']]
        s['total'] += 1
        s['listados'] += kind == 'listado'
        s['detalles'] += kind == 'detalle'
        s['consultas'] += kind == 'consulta'
        s['conteos'] += kind == 'conteo'
        s['sin_limite'] += kind in ('listado', 'consulta') and not x.get('limit') and not x.get('count')
        s['sin_orden'] += kind in ('listado', 'consulta') and not x.get('order')
        s['sin_desempate'] += bool(kind in ('listado', 'consulta') and x.get('order')) and not any(
            o.rstrip().endswith('_id') or o == 'id' for o in x['order'])
        s['offset'] += (x.get('limit') or '').startswith('range')
        s['sin_tenant'] += t == 'No'
        s['tenant_indirecto'] += t.startswith('Indirecto')
        s['score'] = (s['sin_tenant'] * 3 + s['sin_limite'] * 2 +
                      s['sin_desempate'] + s['offset'] + s['tenant_indirecto'])
    A('| Entidad | Total | Listados | Detalles | Consultas | Sin límite | Sin orden | Sin desempate | Offset | Sin tenant | Indirecto |')
    A('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for table, s in sorted(agg.items(), key=lambda kv: (-kv[1]['score'], kv[0]))[:30]:
        A(f"| {entity_label(table, catalog)} | {s['total']} | {s['listados']} | "
          f"{s['detalles']} | {s['consultas']} | {s['sin_limite']} | {s['sin_orden']} | "
          f"{s['sin_desempate']} | {s['offset']} | {s['sin_tenant']} | {s['tenant_indirecto']} |")
    A('')

    # índices candidatos
    A('### A.5 Índices candidatos (a validar con `EXPLAIN`)')
    A('')
    A('Derivados de filtros y órdenes observados, no de un plan real. No crear índices en '
      'esta tarea: la Tarea 6 debe medirlos sobre datos sintéticos y decidir el orden de '
      'columnas. `tenant_id` va primero cuando la tabla lo tiene.')
    A('')
    A('| Entidad | Filtros/orden observados | Índice candidato | Evidencia |')
    A('|---|---|---|---|')
    candidates = [
        ('sales', 'tenant_id; status; sold_at; sale_id', '(tenant_id, sold_at DESC, sale_id DESC) y (tenant_id, status, sold_at DESC)', 'Accountings/reportes y getSales'),
        ('sale_lines', 'sale_id; tenant_id', '(tenant_id, sale_id) y (sale_id)', 'Detalle de venta y reportes'),
        ('sale_payments', 'sale_id; tenant_id; cash_session_id', '(tenant_id, sale_id) y (tenant_id, cash_session_id)', 'Caja y reportes'),
        ('product_variants', 'tenant_id; is_active; sku; product_id; variant_name', '(tenant_id, is_active, sku) y (tenant_id, product_id, variant_name)', 'POS/búsqueda y catálogo'),
        ('products', 'tenant_id; is_active; name; unit_id', '(tenant_id, is_active, name)', 'Catálogo y conteos'),
        ('inventory_batches', 'tenant_id; location_id; variant_id; expiration_date', '(tenant_id, location_id, variant_id, expiration_date) y (tenant_id, expiration_date)', 'FEFO/vencimientos'),
        ('inventory_moves', 'tenant_id; location_id; move_type; source_id; created_at', '(tenant_id, location_id, created_at DESC) y (tenant_id, source_id)', 'Kardex y trazabilidad'),
        ('stock_balances', 'tenant_id; location_id; variant_id; updated_at', '(tenant_id, location_id, variant_id)', 'Saldo materializado'),
        ('cash_sessions', 'tenant_id; status; cash_register_id; opened_at', '(tenant_id, status, opened_at DESC) y (tenant_id, cash_register_id, status)', 'Caja'),
        ('cash_movements', 'tenant_id; cash_session_id; created_at', '(tenant_id, cash_session_id, created_at DESC)', 'Arqueo'),
        ('layaway_contracts', 'tenant_id; status; due_date; customer_id', '(tenant_id, status, due_date) y (tenant_id, customer_id)', 'Separados/vencimientos'),
        ('layaway_payments', 'tenant_id; layaway_id; cash_session_id', '(tenant_id, layaway_id, paid_at DESC)', 'Pagos de separado'),
        ('customer_credit_movements', 'credit_account_id; created_at', '(credit_account_id, created_at DESC)', 'Cartera'),
        ('customer_credit_accounts', 'tenant_id; customer_id; current_balance', '(tenant_id, customer_id) único y (tenant_id, current_balance)', 'Cartera'),
        ('supplier_payables', 'tenant_id; status; due_date; supplier_id', '(tenant_id, status, due_date) y (tenant_id, supplier_id)', 'CxP'),
        ('accounting_entries', 'tenant_id; entry_date; status; entry_number', '(tenant_id, entry_date DESC, entry_number DESC) y (tenant_id, status, entry_date)', 'Libro/periodos'),
        ('accounting_event_queue', 'tenant_id; status; created_at', '(tenant_id, status, created_at)', 'Cola contable'),
        ('bulk_imports', 'tenant_id; created_at', '(tenant_id, created_at DESC)', 'Historial de importaciones'),
        ('bulk_import_errors', 'import_id; row_number', '(import_id, row_number)', 'Errores de importación'),
        ('notifications', 'tenant_id; user_id; is_read; created_at', '(tenant_id, user_id, created_at DESC) y parcial de no leídas', 'Centro de notificaciones'),
        ('system_alerts', 'tenant_id; alert_type; created_at', '(tenant_id, alert_type, created_at DESC)', 'Alertas'),
        ('product_media', 'tenant_id; product_id; is_cover; sort_order', '(tenant_id, product_id, sort_order)', 'Galería'),
        ('invoice_resolutions', 'tenant_id; document_type; is_active; resolution_date', '(tenant_id, document_type, is_active, resolution_date DESC)', 'Facturación'),
        ('third_parties', 'tenant_id; legal_name; document_number', '(tenant_id, legal_name) y (tenant_id, document_number)', 'Terceros'),
        ('taxes', 'tenant_id; is_active; name', '(tenant_id, is_active, name)', 'Impuestos'),
        ('units_of_measure', 'tenant_id; is_active; name', '(tenant_id, is_active, name)', 'Unidades'),
        ('locations', 'tenant_id; is_active; name', '(tenant_id, is_active, name)', 'Sedes'),
        ('users', 'tenant_id; is_active; full_name', '(tenant_id, is_active, full_name)', 'Usuarios'),
        ('categories', 'tenant_id; name', '(tenant_id, name)', 'Categorías'),
        ('roles', 'tenant_id; name', '(tenant_id, name)', 'Roles'),
    ]
    for ent, obs, cand, ev in candidates:
        A(f'| `{ent}` | {obs} | `{cand}` | {ev} |')
    A('')

    A('### A.6 Alcance excluido y límites de la Parte A')
    A('')
    A('- **Mutaciones:** los 74 sitios `.insert/.update/.delete/.upsert` no se listan; no son '
      'listados ni consultas de lectura. Su análisis corresponde a la Tarea 5 (efectos y '
      'atomicidad).')
    A('- **Clientes HTTP:** `backendDomainClient`, `backendCustomersClient`, '
      '`bulkImportClient` y similares delegan en el backend y no construyen `.from()`/`.rpc()`; '
      'quedan fuera de este inventario.')
    A('- **SQLite offline:** las consultas de `mobile/src/storage/sqlite/` no son PostgreSQL '
      'directo y no se incluyeron; su paridad es un riesgo aparte para la Tarea 6.')
    A('- **RLS:** el análisis es del texto del cliente. Una consulta marcada `No` puede estar '
      'protegida por una política RLS en Supabase; en PostgreSQL portable esa protección '
      'desaparece y debe hacerse explícita.')
    A('- **PostgREST:** los filtros sobre recursos embebidos (`sale.tenant_id`) y los `!inner` '
      'no se evalúan semánticamente; se marcan como `Sí (join)` para revisión.')
    A('- **Dinamismo:** 7 sitios usan una tabla no resoluble y 2 RPC usan un nombre calculado; '
      'no se puede afirmar su entidad ni su firma sin ejecutar el cliente.')
    A('')

    # ---------------------------------------------------------------- Parte B
    A('## Parte B — RPCs y funciones definidas en migraciones')
    A('')
    A('### B.1 Cobertura y método')
    A('')
    A('Fuentes: `shared/supabase/migrations/*.sql` (canónica) más los archivos propios de '
      '`web/migrations/` (17) y `mobile/migrations/` (11) que no son symlinks. Se '
      'deduplicaron las copias symlink por ruta real. Total: **189 archivos SQL**.')
    A('')
    domains = Counter(x['domain'] for x in funcs)
    A('| Métrica | Valor |')
    A('|---|---:|')
    A('| Archivos SQL únicos | 189 |')
    A(f'| Sentencias `CREATE [OR REPLACE] FUNCTION` | {len(funcs)} |')
    A(f'| Firmas únicas (nombre + parámetros) | {len(fgroups)} |')
    A(f'| Nombres de función únicos | {len(by_name)} |')
    A(f'| Definiciones `SECURITY DEFINER` | {sum(1 for x in funcs if x["security_definer"])} |')
    A(f'| `SECURITY DEFINER` sin `search_path` | {sum(1 for x in funcs if x["security_definer"] and not x["search_path"])} |')
    A(f'| Funciones que usan `auth.uid()`/`auth.jwt()` | {sum(1 for x in funcs if x["uses_auth"])} |')
    A(f'| Funciones trigger (`RETURNS trigger`) | {sum(1 for x in funcs if x["is_trigger"])} |')
    A(f'| Nombres con más de una definición | {sum(1 for n, arr in by_name.items() if len(arr) > 1)} |')
    A('')
    A('| Dominio | Definiciones | Nombres únicos |')
    A('|---|---:|---:|')
    for d, n in sorted(domains.items(), key=lambda kv: (-kv[1], kv[0])):
        A(f'| {d} | {n} | {len(set(x["name"] for x in funcs if x["domain"] == d))} |')
    A('')
    A('**Advertencias de lectura:**')
    A('')
    A('1. Los conteos son de **sentencias en archivos**, no del estado desplegado. Una '
      'función puede estar redefinida varias veces y el orden de aplicación no es '
      'necesariamente el alfabético. La definición consolidada es **a verificar** contra '
      'el baseline que se elija ([`baseline-proposal.md`](../baseline-proposal.md)).')
    A('2. `sp_create_sale`, `sp_create_purchase`, `sp_create_layaway`, '
      '`fn_create_online_manual_order` y `fn_accounting_post_entry` tienen múltiples '
      'variantes. No se debe asumir cuál está desplegada sin consultar la base.')
    A('3. `sale_line_components` y `vw_component_expiration_risk` se referencian en el '
      'código pero **no se localizó su `CREATE`** en las migraciones: **a verificar**.')
    A('4. Los privilegios (`GRANT`/`REVOKE`) no se inventariaron aquí; solo se marca '
      '`SECURITY DEFINER`. La Tarea 5 debe revisar ownership y grants.')
    A('')

    # funciones prioritarias
    A('### B.2 Funciones prioritarias')
    A('')
    A('Ventas, compras, cartera, layaway, importación masiva, inventario/producción, '
      'contabilidad y notificaciones/outbox. Una fila por firma; las redefiniciones de la '
      'misma firma se agrupan y sus ubicaciones completas están en la sección B.4.')
    A('')
    idx = 0
    for dom in PRIORITY_DOMAINS:
        keys = [k for k, defs in fgroups.items() if defs[0]['domain'] == dom]
        if not keys:
            continue
        A(f'#### {dom} ({len(keys)} firma' + ('s' if len(keys) != 1 else '') + ')')
        A('')
        A('| # | Función (firma corta) | Definiciones | SD | Uso / nota |')
        A('|---:|---|---|---|---|')
        for key in sorted(keys, key=lambda k: (k[0], k[1])):
            idx += 1
            defs = fgroups[key]
            name = defs[0]['name']
            sig = clip(defs[0]['sig'], 150)
            note = function_note(name, defs, client_counts, internal_counts)
            A(f'| {idx} | `{sig}` | {definitions_cell(defs)} | {sd_cell(defs)} | {note} |')
        A('')

    # auxiliares
    A('### B.3 Funciones auxiliares, identidad y otras')
    A('')
    A('Misma estructura, para completar el inventario de `CREATE FUNCTION`. Las funciones '
      'de identidad/autorización son especialmente relevantes para la Tarea 4 aunque no '
      'sean RPC de negocio.')
    A('')
    for dom in AUX_DOMAINS:
        keys = [k for k, defs in fgroups.items() if defs[0]['domain'] == dom]
        if not keys:
            continue
        A(f'#### {dom} ({len(keys)} firma' + ('s' if len(keys) != 1 else '') + ')')
        A('')
        A('| # | Función (firma corta) | Definiciones | SD | Uso / nota |')
        A('|---:|---|---|---|---|')
        for key in sorted(keys, key=lambda k: (k[0], k[1])):
            idx += 1
            defs = fgroups[key]
            name = defs[0]['name']
            sig = clip(defs[0]['sig'], 150)
            note = function_note(name, defs, client_counts, internal_counts)
            A(f'| {idx} | `{sig}` | {definitions_cell(defs)} | {sd_cell(defs)} | {note} |')
        A('')

    # redefiniciones
    A('### B.4 Redefiniciones y sobrecargas')
    A('')
    multi = {n: arr for n, arr in by_name.items() if len(arr) > 1}
    A(f'**{len(multi)} nombres** acumulan más de una definición. La tabla lista todas las '
      'ubicaciones para que la Tarea 5 elija una versión consolidada; no se debe ejecutar '
      'el directorio completo por orden alfabético.')
    A('')
    A('| Función | # defs | Firmas | Ubicaciones (archivo:línea) |')
    A('|---|---:|---:|---|')
    for name, arr in sorted(multi.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        sigs = len({(tuple(p.split()[0].lower() for p in x['params'] if p.split())) for x in arr})
        A(f'| `{name}` | {len(arr)} | {sigs} | {definitions_cell(arr, 12)} |')
    A('')

    # riesgos
    A('### B.5 Riesgos de portabilidad detectados en funciones')
    A('')
    sd_no_path = [x for x in funcs if x['security_definer'] and not x['search_path']]
    auth_funcs = [x for x in funcs if x['uses_auth']]
    triggers = [x for x in funcs if x['is_trigger']]
    public = [x for x in funcs if (re.search(r'fn_(?:get|list|create)_public', x['name'])
              or 'online_store' in x['name']) and not x['name'].startswith('?')]
    nonportable = [x for x in funcs if x['uses_cron'] or x['uses_net'] or x['uses_vault']
                   or x['uses_dynsql']]
    def uniq_names(items, limit=6):
        out = []
        for x in items:
            if x['name'] not in out:
                out.append(x['name'])
            if len(out) >= limit:
                break
        return ', '.join('`' + n + '`' for n in out)

    A('| Riesgo | Conteo | Funciones representativas | Acción recomendada |')
    A('|---|---:|---|---|')
    A(f'| Definiciones `SECURITY DEFINER` sin `search_path` | {len(sd_no_path)} | '
      f'{uniq_names(sd_no_path)} | Fijar `search_path` seguro y cualificar objetos; revisar ownership. |')
    A(f'| Definiciones con `auth.uid()`/`auth.jwt()` | {len(auth_funcs)} | '
      f'{uniq_names(auth_funcs)} | Reemplazar por contexto de sesión/tenant de la aplicación. |')
    A(f'| Definiciones trigger | {len(triggers)} | '
      f'{uniq_names(triggers)} | Recrear triggers y probar doble efecto si parte del efecto pasa a Go. |')
    A(f'| Definiciones públicas/tienda online | {len(public)} | '
      f'{uniq_names(public)} | Revisar autorización, tokens y datos expuestos. |')
    A(f'| Definiciones con `pg_cron`/`net`/`vault`/SQL dinámico | {len(nonportable)} | '
      f'{uniq_names(nonportable)} | Externalizar a Go/worker; no asumir extensiones del proveedor. |')
    A('')
    A('**Dependencias Supabase observadas:** `auth.uid()`/`auth.jwt()` en funciones de '
      'autorización y contabilidad; `pg_cron`/`net.http`/`vault` en dispatchers; '
      '`storage` en metadata de importación. Ninguna se puede considerar parte de '
      'PostgreSQL estándar. El detalle por archivo está en '
      '[`supabase-dependencies.md`](../supabase-dependencies.md).')
    A('')

    # limitaciones
    A('### B.6 Limitaciones')
    A('')
    A('- Análisis estático: no se ejecutó ninguna función ni se verificó el plan de '
      'ejecución. Las firmas y los cuerpos provienen de los archivos; la versión desplegada '
      'es **a verificar**.')
    A('- La extracción de parámetros y retornos es heurística; los comentarios SQL y los '
      'defaults se limpian, pero una firma con tipos compuestos o `OUT` puede quedar '
      'truncada. La fuente citada manda.')
    A('- No se inventariaron `GRANT`/`REVOKE`, ownership, triggers por tabla ni políticas '
      'RLS; eso corresponde a las tareas 2 y 4.')
    A('- `sale_line_components` y `vw_component_expiration_risk` no tienen DDL localizado. '
      '`stock_balances` cambia de tabla a materialized view en el historial: **a verificar**.')
    A('')

    A('## Anexos')
    A('')
    A('### Datos y scripts reproducibles')
    A('')
    A('- [`query-sites.json`](query-sites.json): sitios `.from()`/`.rpc()` con filtros, '
      'orden, límite y fragmento de la cadena.')
    A('- [`sql-functions.json`](sql-functions.json): definiciones, firma, retorno, '
      '`SECURITY DEFINER`, flags de dependencia y cuerpo recortado.')
    A('- [`table-catalog.json`](table-catalog.json): tablas/vistas, definiciones y '
      '`tenant_id`.')
    A('- `tools/database/extract_query_sites.py`, '
      '`tools/database/extract_sql_functions.py` y '
      '`tools/database/extract_table_catalog.py`: extractores de solo lectura; '
      '`tools/database/build_listings_and_rpcs.py` regenera este documento.')
    A('')
    A('### Pendientes para las Tareas 5 y 6')
    A('')
    A('1. Elegir una definición consolidada por firma y resolver las 60 redefiniciones.')
    A('2. Convertir los listados con offset y sin desempate a cursor/keyset y definir '
      '`has_next` vs total exacto.')
    A('3. Validar los índices candidatos con `EXPLAIN (ANALYZE, BUFFERS)` sobre datos '
      'sintéticos de dos tenants.')
    A('4. Reemplazar `auth.uid()`/`auth.jwt()` y los dispatchers `pg_cron`/`net`/`vault` '
      'por contexto de aplicación y workers Go.')
    A('5. Verificar en PostgreSQL vacío que las consultas no dependen de RLS para aislar '
      'tenant.')
    A('')

    out = os.path.join(ROOT, args.out) if not os.path.isabs(args.out) else args.out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print(f'escrito {out}')
    print(f'lineas={len(lines)} queries={len(queries)} rpc={len(rpc)} '
          f'funcs={len(funcs)} firmas={len(fgroups)}')


if __name__ == '__main__':
    main()
