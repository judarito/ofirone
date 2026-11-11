# EXT-09 — Matriz N1–N20

Fecha: 2026-11-09. Base desechable, rol `NOBYPASSRLS`, dos tenants. Resultado global: **N1–N20 PASS**.

| Grupo | Casos | Resultado | Evidencia |
|---|---|---|---|
| Sin contexto / tenant | N1–N5, N14, N15 | PASS (`42501`/0 filas) | validation-business-0022 |
| FKs compuestas / identidad | N6–N8, N11 | PASS (`23503`/`42501`) | validation-business-0022 |
| Catálogo / unicidad | N12, N13 | PASS (`23505`, mismo SKU entre tenants) | validation-business-0022 |
| N9 lote-línea | N9 | PASS (`23503` cross-batch) | validation-business-0022 |
| N10 catálogo online | N10 | PASS (`23503` cross-variant) | validation-business-0022 |
| N16 stock view | N16 | PASS (solo A, 98) | validation-business-0022 |
| N17 sales view | N17 | PASS (solo A, 2) | validation-business-0022 |
| N18/N19 jobs | N18/N19 | PASS (claim A, complete idempotente, B `42501`) | validation-business-0022 |
| N20 auditoría | N20 | PASS (`42501`) | validation-business-0022 |

Sin FAIL ni BLOQ. Evidencia completa: [`validation-business-0022-2026-11-09.txt`](validation-business-0022-2026-11-09.txt).
