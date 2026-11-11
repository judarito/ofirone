# EXT-14 — Secretos y logs

Fecha: 2026-11-09.

## Comprobaciones
- `check_no_secrets.py` sobre `docs/database-portability`, `docs/decisions`, `tools/database`: **PASS**.
- Sin `postgresql://usuario:password@`, JWT (`eyJ...`), claves privadas ni `service_role` en docs/evidencias.
- Emails de fixtures usan `.example.test`; no hay emails reales.
- Comandos documentados evitan imprimir URLs; `.env.database.local` está ignorado y con permisos 600.
- Logs de migración/runner revisados: no contienen DSN ni secretos.

## Falsos positivos justificados
- Expresiones regulares en `run_readonly_sql.py`/`parse_url` (no son credenciales).
- `ofirone_owner` en documentos de diseño (rol propuesto, no real).

## Resultado
**PASS**; cero secretos. Faltan evidencias de 0023 y de K (ver EXT-04).
