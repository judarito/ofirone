# Logging JSON Bootstrap 1A

`logging.New(output, Options{Service, Environment, Version, Level})` devuelve un
`*slog.Logger` con salida JSON. `output == nil` usa stdout. No cambia el logger
global. No requiere dependencias externas ni `go.sum`.

```go
logger := logging.New(os.Stdout, logging.Options{
    Service: "ofirone-api", Environment: cfg.Environment,
    Version: "development", Level: cfg.LogLevel,
})
ctx := logging.WithRequestIDs(r.Context(), requestID, correlationID)
logger.InfoContext(ctx, "request completed",
    "method", r.Method, "route", "/healthz",
    "status", 200, "duration_ms", elapsed.Milliseconds())
```

Todos los registros incluyen `time`, `level`, `msg`, `service`, `environment` y
`version`. Los métodos con contexto incluyen los IDs adjuntos por
`WithRequestIDs`; se aceptan entre 1 y 128 caracteres ASCII alfanuméricos, punto,
guion y guion bajo. IDs inválidos se omiten. El middleware HTTP debe generar los
IDs, elegir el fallback de correlación y devolver los headers. El paquete no
implementa middleware, medición de latencia ni extracción de campos HTTP.

`With` y `WithGroup` conservan el handler y el contexto; los IDs agregados dentro
de un logger con grupo pertenecen a ese grupo. Para IDs en la raíz, usar el
logger raíz o `With` sin `WithGroup` en el middleware de acceso.

Se redactan atributos conocidos como `authorization`, `cookie`, `password`,
`access_token`, `refresh_token`, `database_url`, `dsn`, `api_key`, `body` y otros
equivalentes explícitos en `sensitiveKey`, incluidos atributos de grupos `slog`.
Esta protección no inspecciona mensajes libres, estructuras/mapas arbitrarios ni
valores sensibles bajo claves desconocidas. Los consumidores deben usar mensajes
fijos y atributos seleccionados: nunca cuerpos, URLs crudas, query strings,
cookies, tokens o errores de conexión sin sanitizar. Usar rutas registradas
como `/products/{id}` en lugar de paths con datos de clientes.

Las pruebas verifican JSON, nivel mínimo, metadatos, IDs, aislamiento concurrente,
redacción de atributos y grupos, y que el logger global permanezca intacto.
Go no está instalado en el entorno de implementación, por lo que no se pudieron
ejecutar. Los comandos están en `../config/README.md`.
