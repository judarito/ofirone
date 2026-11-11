# EXT-13 — Contratos HTTP (auditoría estática)

Fecha: 2026-11-09. Sin modificar frontend ni handlers. Resultado: **PARCIAL**.

| Recurso | Ruta Go | Cliente | Estado |
|---|---|---|---|
| Login/refresh/logout/me | `/api/v1/auth/*`, `/api/v1/me` | `web/src/services/backendAuthClient.js` | Coincide |
| Productos/variantes | `/api/v1/products`, `/api/v1/variants` | `backendDomainClient.js` (keyset) | Coincide |
| Clientes | `/api/v1/customers` | `backendDomainClient.js` y `backendCustomersClient.js` | **Posible desajuste**: `backendCustomersClient.js:32` usa `/customers` sin `/api/v1` |
| Inventario | `/api/v1/inventory`, `/api/v1/inventory/movements` | `backendDomainClient.js` | Coincide |
| Ventas | `/api/v1/sales` | `backendDomainClient.js` (keyset) | Coincide |
| Caja | `/api/v1/cash-sessions`, `/api/v1/cash-movements`, `/close` | No se encontró cliente web específico | **Faltante de integración** |
| Async jobs/media/invoices | No rutas Go equivalentes en `httpapi` | `asyncJobsClient`, `mediaProcessingClient`, `electronicInvoicing` | **Desajuste/BLOQ**: clientes apuntan a rutas no servidas por Go |

## Riesgos
- `backendCustomersClient.js:32` puede fallar contra el gateway Go.
- Los clientes de jobs/media/invoices requieren endpoints Go o fallback legacy.
- No se ejecutó un servidor HTTP; auditoría estática. Se recomienda contract test con `httptest` y OpenAPI.
