# EXT-01 — Auditoría de migraciones y ledger

Fecha: 2026-11-09
Alcance: `database/migrations/0001–0023` (23 archivos).

## Verificación estructural

- Versiones consecutivas 1–23: **PASS**.
- Versiones duplicadas: **0**.
- Nombres de archivo con formato `NNNN_nombre.up.sql`: **PASS**.
- Checksums SHA-256 calculados para los 23 archivos.
- Ledger DEV: **22 filas** (`dirty=false`); **falta 0023**.
- Referencias al antiguo `0021_auth_login_lookup`: **0** en documentación (solo aparece en el criterio de la tarea).

## Checksums (prefijo)

| Versión | Archivo | SHA-256 (12) |
|---|---|---|
| 1 | `0001_core.up.sql` | `b9c7c3bc85f7` |
| 2 | `0002_identity.up.sql` | `601deb502254` |
| 3 | `0003_migration_control.up.sql` | `63fb1f09aeff` |
| 4 | `0004_reference_catalog.up.sql` | `4b4b7ace92ab` |
| 5 | `0005_products.up.sql` | `a5854c9f4e0a` |
| 6 | `0006_inventory.up.sql` | `6721aa3ced88` |
| 7 | `0007_sales.up.sql` | `3bfd4ff8c267` |
| 8 | `0008_parties.up.sql` | `c9e333d20de1` |
| 9 | `0009_purchases.up.sql` | `e98331c34e0a` |
| 10 | `0010_credit_payables.up.sql` | `f8f20748f556` |
| 11 | `0011_layaway.up.sql` | `daa2a0204ed3` |
| 12 | `0012_jobs_audit.up.sql` | `cfd42f5e1d8d` |
| 13 | `0013_sale_idempotency.up.sql` | `5e53c4a95dbb` |
| 14 | `0014_sales_customer_link.up.sql` | `f3290aead140` |
| 15 | `0015_cash_sessions.up.sql` | `14b83b20896f` |
| 16 | `0016_identity_credentials.up.sql` | `35ca5c7b5ed9` |
| 17 | `0017_sale_line_batches.up.sql` | `0e984361da89` |
| 18 | `0018_online_store_catalog.up.sql` | `245b2a19e644` |
| 19 | `0019_portable_views.up.sql` | `eac3ac316c78` |
| 20 | `0020_async_job_functions.up.sql` | `2a688238942e` |
| 21 | `0021_audit_append_only.up.sql` | `179b45ebd48b` |
| 22 | `0022_p1_integrity_guards.up.sql` | `0663add4fb3c` |
| 23 | `0023_auth_login_lookup.up.sql` | `c913d34a9d5c` |

## Hallazgos

1. **0023 no está aplicada en DEV** (ledger 22). No se aplica en EXT-01 por ser solo auditoría.
2. **0023 contiene `BEGIN`/`COMMIT`**, incompatible con la regla del runner (el runner envuelve la transacción). Debe corregirse antes de aplicarla.
3. **0023 usa `SECURITY INVOKER` con `search_path = public, pg_temp`**; requiere revisar privilegios/RLS del rol auth (ver EXT-03).
4. No hay dependencias Supabase/PostgREST/extensiones no declaradas en las migraciones.

## Resultado

**PASS estructural (con 0023 pendiente y bloqueo de runner).**
