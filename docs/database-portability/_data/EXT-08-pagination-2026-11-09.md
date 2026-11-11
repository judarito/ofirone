# EXT-08 — Tests de paginación keyset

Fecha: 2026-11-09. Base desechable; sin cambios de handlers.

Resultado: **29 PASS, 0 FAIL, 0 BLOQ** (`validation-pagination-2026-11-09.txt`).

- 9 listados con 130 filas (productos, ventas, compras, movimientos, clientes, terceros, variantes, apartados, jobs, auditoría).
- Empates de orden, página vacía, último cursor, cambio concurrente, cursor repetido, cursor inválido (`22P02`) y límite máximo (130).
- `EXPLAIN (ANALYZE, BUFFERS)` usa índices en ventas, productos, clientes y jobs.
- Variantes: 131 filas (130 + variante de inventario) PASS.
