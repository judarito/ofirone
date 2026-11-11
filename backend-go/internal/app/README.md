# Bootstrap 1A: HTTP y ciclo de vida

Alcance de esta entrega: `internal/httpapi/` e `internal/app/`. Ambos paquetes
usan exclusivamente la biblioteca estándar y requieren Go 1.21 o superior
(`context`, `errors.Join`, tipos atómicos y `http.ResponseController`).

## Integración para el agente de cmd/api

1. Crear el pool PostgreSQL y pasarlo a `httpapi.New(config, pool)`. La interfaz
   requerida es `Ping(context.Context) error`; `*pgxpool.Pool` la implementa.
2. Pasar el `*httpapi.Server` a `app.New(server, 15*time.Second)`.
3. Crear el listener con `net.Listen`. Un puerto ocupado falla aquí, antes de
   llamar a `Run`.
4. Crear un contexto mediante `signal.NotifyContext` con `os.Interrupt` y
   `syscall.SIGTERM`; pasarlo a `Run(ctx, listener)`.
5. Cerrar el pool después de que `Run` retorne. El paquete HTTP no es dueño del
   pool. Ante un cierre forzado, los handlers deben respetar su contexto para
   detener operaciones pendientes antes de liberar sus dependencias.

`Run` toma posesión del listener. Cada instancia de App/Server es de un solo
uso. La cancelación normal retorna nil; los errores de Serve y los timeouts de
apagado se conservan con wrapping y `errors.Join`. El cierre usa un contexto
independiente del contexto cancelado por la señal y fuerza `Close` al vencer
el plazo. `BeginShutdown` invalida readiness antes de drenar las conexiones.

## Contrato HTTP

| Endpoint | Respuesta |
| --- | --- |
| `GET /healthz` | 200 con `{"status":"ok"}`; no consulta la DB |
| `GET /readyz` | 200 con `{"status":"ready"}` o 503 si Ping falla, vence el timeout o comienza el cierre |
| `GET /api/v1/version` | 200 con `service`, `version`, `commit` inyectados en Config |

Todos aceptan HEAD sin cuerpo. Otros métodos retornan 405 con `Allow: GET,
HEAD`; rutas desconocidas retornan 404 JSON. Las respuestas llevan
`Cache-Control: no-store`, Content-Type JSON y `X-Request-ID`.

Errores: `code`, `message`, `details` (null), `request_id`, `retryable`. Fallos
de readiness retornan `DEPENDENCY_UNAVAILABLE`, retryable=true, sin detalles
de la conexión. Cada request recibe 128 bits aleatorios como ID, disponible
en contexto mediante `RequestIDFromContext`; no se confía en IDs del cliente.

El middleware Recover genera 500 JSON sin exponer el panic. Si ya se envió la
respuesta, aborta la conexión usando `http.ErrAbortHandler`. Conserva soporte
para `http.ResponseController`, incluido Flush; futuros handlers de streaming
deben usar ese controlador para acceder a funciones opcionales del writer.

Timeouts por defecto: Ping 1s, headers 5s, lectura 15s, escritura 30s e idle
60s. Config admite overrides positivos; rechaza valores negativos. El Pinger
debe respetar deadlines/cancelación; no se crean goroutines abandonadas para
simular timeouts de un driver que ignore el contexto.

## Pruebas y limitación del entorno

Se incluyen pruebas de endpoints, errores, HEAD/405/404, versiones, IDs,
recuperación de DB, deadlines/cancelación, readiness durante apagado, panic y
escrituras parciales. Las pruebas de app abren listeners TCP locales y verifican
el drenaje de requests, cierre forzado, errores de Serve y cancelación inicial.
No requieren una DB ni servicios externos.

En el entorno de implementación no se encontró el ejecutable Go y Docker
rechazó acceso a `/var/run/docker.sock` por permisos. **Estas pruebas todavía
no se han compilado ni ejecutado.** Tampoco existe un go.mod al iniciar esta
entrega; su creación pertenece al agente integrador.

Cuando exista Go y el módulo, ejecutar desde `backend-go/`:

```bash
gofmt -w internal/httpapi internal/app
go vet ./internal/httpapi ./internal/app
go test -race ./internal/httpapi ./internal/app
```

No se crearon archivos fuera de las dos carpetas asignadas. El bootstrap de
cmd/api, configuración de entorno, pool, contenedores y gestión de señales
del proceso queda disponible para integración por sus respectivos agentes.
