# Reportes MVP en Go

Los reportes MVP no consultan Supabase. El backend Go lee PostgreSQL y obtiene el tenant exclusivamente del JWT.

Endpoints autenticados:

- `GET /api/v1/reports/sales`
- `GET /api/v1/reports/purchases`
- `GET /api/v1/reports/inventory`
- `GET /api/v1/reports/receivables`

Filtros comunes: `from`, `to` y `location_id`; paginación: `limit`, `after_at` y `after_id` (fechas RFC3339, límite 1–100).

Los reportes devuelven totales agregados sobre la página (`total`, `count`, o `net_quantity`) y `has_more` con cursor. Las consultas siempre incluyen `tenant_id` y no exponen credenciales ni datos de otros tenants.

Cliente frontend: `web/src/services/backendReportsClient.js`.
