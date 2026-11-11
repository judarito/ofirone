# EXT-19 — Contratos HTTP de listados

Estado: **PASS (tests aislados)**.

Tests añadidos en `backend-go/internal/httpapi/listings_contract_test.go`:
- 401 sin principal para productos, clientes y ventas.
- 400 por `limit` inválido/fuera de rango y cursor incompleto.
- 200 con respuesta JSON paginada para los tres listados.
- No se modificaron handlers productivos.

Evidencia: [`validation-EXT-19-20-23-tests-2026-11-10.txt`](validation-EXT-19-20-23-tests-2026-11-10.txt). Queda el desajuste del cliente web `/customers` (sin `/api/v1`) como deuda de frontend.
