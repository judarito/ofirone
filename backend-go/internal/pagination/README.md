# Paginación reusable

Paquete sin dependencias externas ni conexión a DB. Compatible con Go 1.22.

## Contratos

- `DefaultLimits()`: límite por defecto 25, máximo 100 y offset máximo 1.000.000. La política la configura el servidor; solicitudes fuera de rango se rechazan, no se truncan silenciosamente.
- `ParseOffset(url.Values, Limits)`: parámetros `limit` y `offset` (desde cero).
- `ParseCursor(url.Values, Limits, *Codec)`: parámetros `limit` y `cursor`; sin cursor devuelve la primera página.
- Rechaza parámetros vacíos, repetidos, negativos, overflow y mezcla offset/cursor. Los parámetros ajenos a paginación se dejan para la validación del endpoint.
- Errores exportados compatibles con `errors.Is`; el transporte decide código HTTP y mensaje.
- `OffsetWindow` y `CursorWindow`: reciben hasta `limit+1` filas y devuelven `data` y `pagination`. `data` vacío se serializa como `[]`. La fila adicional determina `has_more`; el cursor corresponde a la última fila entregada.

## Uso de cursor

```go
codec, err := pagination.NewCodec([]pagination.SortField{
    {Name: "created_at", Direction: pagination.Descending},
    {Name: "sale_id", Direction: pagination.Descending, Unique: true},
}, "sales:tenant-authorized:status=paid:v1")
// Manejar err.
request, err := pagination.ParseCursor(query, pagination.DefaultLimits(), codec)
// Manejar err; validar tipos de request.After en el repositorio.
// Aplicar filtros, ORDER BY created_at DESC, sale_id DESC y LIMIT request.Limit+1.
// Con After: WHERE (created_at, sale_id) < ($timestamp, $id).
// Para direcciones mixtas construir el predicado lexicográfico correspondiente.
response, err := pagination.CursorWindow(rows, request, codec, func(row Sale) []string {
    return []string{row.CreatedAt.UTC().Format(time.RFC3339Nano), row.ID}
})
```

El ejemplo es orientativo: `query`, `rows` y `Sale` pertenecen al consumidor.
El orden debe ser fijo o seleccionado desde una allowlist del servidor. `Unique`
declara una garantía que el consumidor debe respaldar con la clave real del
resultado; no demuestra unicidad en DB. Para claves compuestas, el último campo
puede marcarse único cuando la tupla completa es única dentro del contexto.

El cursor usa JSON canónico versionado y base64url, con máximo 4096 bytes. Incluye
todos los valores ordenados y una huella del orden y contexto. El contexto debe
incorporar recurso, tenant autorizado, filtros normalizados y versión/snapshot.
Esto detecta reutilización accidental entre consultas. El token es modificable:
no está firmado ni cifrado y nunca sustituye autenticación o autorización.
No incluir secretos. El repositorio debe validar los tipos y usar parámetros SQL,
manteniendo siempre los filtros de acceso derivados de la sesión.

Los valores se transportan como strings para conservar IDs grandes y decimales
exactos. El consumidor normaliza fechas, collation y tipos; campos de orden NULL
necesitan normalización explícita en SQL y en el extractor. El paquete no genera
SQL ni implementa ordenamiento o comparación de valores.

## Consistencia y totales

Aplicar todos los filtros antes de paginar. Offset también requiere orden único
estable en el repositorio. Los cursores resuelven empates; no congelan cambios
concurrentes en datos o campos de orden. Si se necesita vista consistente, definir
snapshot o watermark y vincularlo al contexto. Agregados y totales se consultan
independientemente de la ventana. `has_more` indica filas adicionales; un offset
que exceda la política será rechazado aunque una ventana anterior indique más filas.

## Verificación

Desde `backend-go/`:

```sh
gofmt -w internal/pagination/*.go
go test -race ./internal/pagination
go vet ./internal/pagination
go test ./internal/pagination -run '^$' -fuzz FuzzDecodeCursor -fuzztime 10s
```

Los tests cubren límites, overflow, parámetros ambiguos, aislamiento por contexto,
orden con desempate, tokens corruptos/no canónicos, precisión de IDs, lookahead,
errores del extractor y forma JSON. No requieren conexión a DB.
