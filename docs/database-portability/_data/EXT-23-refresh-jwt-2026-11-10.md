# EXT-23 — Refresh y expiración JWT

Estado: **PASS**.

Tests añadidos en `backend-go/internal/auth/refresh_expiry_test.go`:
- Refresh usado una sola vez: el segundo intento falla con `ErrAuthenticationFailed`.
- Sesión/refresh revocado: el refresh falla.
- JWT expirado: el verificador lo rechaza.
- `go test -race ./internal/httpapi ./internal/auth` PASS.

No se cambió algoritmo ni claves. Evidencia: [`validation-EXT-19-20-23-tests-2026-11-10.txt`](validation-EXT-19-20-23-tests-2026-11-10.txt).
