# Configuración Bootstrap 1A

`config.Load()` lee las variables del proceso. `config.LoadFrom(getenv)` permite
inyectar un lector para pruebas. No se leen archivos `.env` automáticamente.
Cada despliegue debe inyectar su propia `DATABASE_URL`; no se elige entre DEV y
PROD dentro del proceso. El paquete no realiza conexiones ni migra bases.

| Variable | Default | Validación |
| --- | --- | --- |
| `APP_ENV` | `development` | `development`, `test`, `staging`, `production` |
| `PORT` | `8080` | Entero entre 1 y 65535 |
| `DATABASE_URL` | Obligatoria | URL `postgres://` o `postgresql://`, host y base explícitos |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`; admite mayúsculas |
| `CORS_ALLOWED_ORIGINS` | Vacío | Orígenes HTTP(S) separados por coma, sin wildcard, credenciales, path, query ni fragmento |
| `HTTP_READ_HEADER_TIMEOUT` | `5s` | Duración positiva, menor o igual a read timeout |
| `HTTP_READ_TIMEOUT` | `15s` | Duración positiva |
| `HTTP_WRITE_TIMEOUT` | `30s` | Duración positiva |
| `HTTP_IDLE_TIMEOUT` | `60s` | Duración positiva |
| `HTTP_MAX_BODY_BYTES` | `1048576` | Entero positivo de 64 bits |
| `SHUTDOWN_TIMEOUT` | `15s` | Duración positiva |
| `DB_PING_TIMEOUT` | `1s` | Duración positiva |
| `DB_MAX_CONNS` | `10` | Entero positivo de 32 bits |

Los defaults operativos son iguales entre entornos y se sobrescriben mediante
variables explícitas. No se crean defaults secretos. Variables opcionales vacías
usan su default. CORS vacío produce una lista vacía; el servidor debe interpretarla
como CORS deshabilitado. Se deduplican orígenes conservando su orden.

Los errores identifican únicamente la variable inválida. `Config.LogValue()`
permite registrar metadatos seleccionados mediante `slog`, excluyendo la URL de
conexión. No imprimir `Config` usando `fmt` ni registrar `DatabaseURL` directamente.
Los parámetros TLS se conservan en la URL y los aplica el futuro adaptador de DB.

## Validación

El entorno de implementación no tiene Go instalado; no se pudieron ejecutar
pruebas, `go vet` ni `gofmt`. Con Go 1.22 o superior, desde `backend-go/`:

```bash
gofmt -w internal/config internal/logging
go test -race ./internal/config ./internal/logging
go vet ./internal/config ./internal/logging
```

Las pruebas cubren defaults, overrides, entornos, niveles, límites, duraciones,
conexiones inválidas, CORS y errores sin credenciales. No necesitan red ni DB.
