# Estado de DEV — 2026-11-09

Actualiza los snapshots estáticos anteriores. No modifica el análisis histórico; registra el estado actual del baseline portable en DEV.

## Migraciones aplicadas

En la base DEV de `.env.database.local`, en transacciones separadas:

`0001_core`, `0002_identity`, `0003_migration_control`, `0004_reference_catalog`,
`0005_products`, `0006_inventory`, `0007_sales`, `0008_parties`, `0009_purchases`,
`0010_credit_payables`, `0011_layaway`, `0012_jobs_audit`, `0013_sale_idempotency`,
`0014_sales_customer_link`, `0015_cash_sessions`, `0016_identity_credentials`, `0017_sale_line_batches`, `0018_online_store_catalog`, `0019_portable_views`, `0020_async_job_functions`, `0021_audit_append_only`.

No se ejecutaron migraciones de `shared/supabase/migrations/`, `web/migrations/` ni
`mobile/migrations/`.

## Verificación

- Tablas públicas: **49** + **2 vistas** (incluye menús/roles 0024).
- Funciones: **16** (3 base + 6 caja + 2 claim/complete + append-only + 3 guardas P1 + auth lookup).
- Políticas RLS: **50**; tablas con RLS: **49**.
- Constraints: **732**; índices: **198**; triggers: **39**; FKs: **82**.
- `sales.customer_id` (0014), `sales.idempotency_key` (0013) y `sales.cash_session_id` (0015).
- `cash_sessions`, `cash_movements`, `cash_session_counts` con RLS/FORCE y triggers; movimientos append-only.
- Ledger `schema_migrations`: versiones **1–25**, `dirty=false`, checksums concordantes.
- PROD: no tocado. DEV sin datos históricos (0 ventas/compras/clientes al aplicar 0015).

## Validaciones sobre el esquema actual

- Business suite `0001–0025`: **62 PASS, 0 FAIL, 0 BLOQ, 1 HALLAZGO**; N1–N20 completos; auditoría/guardas P1 y auth role endurecido.
- P0 venta: **21 PASS, 0 FAIL** (cliente real 0014 y caja 0015).
- Caja 0015: **14 PASS, 0 FAIL** (append-only, cierre inmutable, RLS, arqueo y up/down/up).
- Reportes: **8/8 PASS** contra fixtures.
- Credenciales `0016`: RLS lectura PASS; runtime sin política de escritura (INSERT `42501`, UPDATE 0 filas).

## Pendientes

- N9/N10/N16/N17 y `fn_claim/fn_complete`.
- Guardas P1 y auditoría append-only (ADR-009/010) como migraciones reales.
- PostgreSQL 15 real, runner Go, datos reales y PROD read-only.
