# Unidades de medida y categorías

Implementación sobre las tablas de la migración existente `0004_reference_catalog`.
No necesita migraciones nuevas.

## Integración por el propietario del router

`httpapi.NewReferenceCatalogHandler(reference_catalog.NewPGStore(pool))` sirve
`/api/v1/units-of-measure` y `/api/v1/categories`, y sus rutas `/{id}`.
Debe montarse detrás del middleware JWT existente. El handler exige el tenant
verificado del contexto; rechaza `tenant_id` e identificadores en el cuerpo.
Este slice no modifica `server.go`, `handlers.go` ni `cmd/api/main.go`.
El propietario del router debe permitir `PATCH` y `DELETE` en su CORS.

## Contrato

- `GET` colección: `limit` (1–100, defecto 25), `after_name` y `after_id`
  (ambos obligatorios para continuar). Incluye activos e inactivos.
  Respuesta: `items`, `has_more`, `next_name`, `next_id`.
- `GET /{id}`: detalle con `id`, `tenant_id`, `code`, `name`, `is_active`,
  `decimal_places`, `parent_category_id`.
- `POST`: `code`, `name`; `is_active` opcional (defecto true).
  Unidades permiten `decimal_places` (0–6); categorías permiten
  `parent_category_id` (UUID o null). UUID generado en PostgreSQL.
- `PATCH /{id}`: edición parcial; campos omitidos conservan su valor;
  `parent_category_id: null` convierte una categoría en raíz.
- `DELETE /{id}`: desactivación lógica, devuelve 204.
- Errores: 400 datos/cursores, 401 sin JWT, 404 inexistente,
  409 código duplicado o hijos activos, 422 padre inválido, 500 fallo interno.

Todas las consultas filtran tenant explícitamente y establecen `app.tenant_id`
local a la transacción para RLS. Las escrituras de categorías se serializan por
tenant con advisory lock. El padre debe existir y estar activo en ese tenant;
la búsqueda recursiva rechaza ciclos. Una categoría con hijos activos no puede
desactivarse. DELETE conserva referencias históricas.

Cliente: `backendUnitsOfMeasure` y `backendCategories` exportan
`list({limit, afterName, afterId})`, `get(id)`, `create(data)`,
`update(id, patch)` y `deactivate(id)`.

## Verificación

Tests de validaciones, errores PostgreSQL y contratos HTTP con store simulado;
tests del cliente con fetch simulado. La integración SQL/RLS y concurrencia
requiere ejecutarse contra PostgreSQL antes del cierre operacional.
