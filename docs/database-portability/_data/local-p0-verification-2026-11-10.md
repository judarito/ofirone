# Verificación local P0 — 2026-11-10

## Servicios

- Frontend Vite: `http://127.0.0.1:5173` — HTTP 200.
- Backend Go: `http://127.0.0.1:8787`.
- `/healthz` — HTTP 200.
- `/readyz` — HTTP 200.

## Flujo autenticado

- Login Go — HTTP 200.
- `/api/v1/me` — HTTP 200.
- `/api/v1/me/menu` — HTTP 200; menú resuelto desde PostgreSQL.
- Productos — HTTP 200.
- Clientes — HTTP 200.
- Inventario y ventas rechazan solicitudes incompletas con HTTP 400, según el
  contrato de filtros obligatorios.

## Automatización

- Frontend: 39 archivos de test, 340 tests PASS.
- Backend: `go test ./...` PASS.
- Backend: `go vet ./...` PASS.

## Nota

La clave JWT usada en esta sesión es únicamente local. Para conservar sesiones
entre reinicios debe configurarse una clave persistente fuera del repositorio.
