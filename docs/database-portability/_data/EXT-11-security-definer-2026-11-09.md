# EXT-11 — Funciones SECURITY DEFINER

Fecha: 2026-11-09.

| Función | Owner | SECURITY DEFINER | search_path | Grants |
|---|---|---|---|---|
| `public.fn_claim_async_jobs` | `[rol owner]` | sí | `pg_catalog, public, app_private` | solo owner EXECUTE |
| `public.fn_complete_async_job` | `[rol owner]` | sí | `pg_catalog, public, app_private` | solo owner EXECUTE |
| `app_private.audit_log_append_only` | no definer | no | `pg_catalog, public` | trigger |
| `app_private.cash_*` | no definer | no | fijo | trigger |

## Riesgos
- El owner `[rol owner]` tiene BYPASSRLS; si un caller obtuviera EXECUTE, la función podría saltar RLS. Hoy no hay grants públicos, pero falta un owner dedicado sin BYPASSRLS.
- `0023` (no aplicada) es SECURITY INVOKER; no añade escalada, pero su `search_path` incluye `pg_temp`.

## Resultado
**PASS con riesgo de owner**; cero funciones SECURITY DEFINER con grants públicos o `search_path` ausente.
