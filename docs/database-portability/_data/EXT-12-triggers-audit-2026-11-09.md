# EXT-12 — Triggers de integridad

Fecha: 2026-11-09. Catálogo DEV: 39 triggers.

| Trigger | Tabla | Operación | Evidencia |
|---|---|---|---|
| `audit_log_append_only` | audit_log | UPDATE/DELETE → `23514` | validation-I |
| `purchases_status_guard` | purchases | transición inválida → `23514` | validation-p1-lifecycle |
| `supplier_payment_guard` | supplier_payable_payments | sobrepago → `23514` | validation-p1-guards-proposal |
| `supplier_payment_sync` | supplier_payable_payments | sincroniza paid_amount/status | validation-p1-guards-proposal |
| `sales_cash_session_guard` | sales | venta con caja cerrada/ajena → `23514`/`23503` | validation-cash-0015 |
| `cash_movements_append_only` | cash_movements | UPDATE/DELETE → `23514` | validation-cash-0015 |
| `cash_sessions_guard` | cash_sessions | cierre/estado/inmutabilidad | validation-cash-0015 |
| `*_updated_at` | catálogo/identidad | timestamps | smoke tests |

## Resultado
**PASS** en los triggers críticos; cobertura de errores esperados documentada.
