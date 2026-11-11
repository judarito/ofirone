# Ofirone — Bootstrap 1A

API operativa Go conectada directamente a PostgreSQL estándar mediante `pgxpool`.
No utiliza Auth, REST, SDK ni servicios de Supabase. No ejecuta migraciones ni seeds.

## Estado y requisito de integración

Esta entrega está limitada a `cmd/api/`, `Dockerfile`, `Makefile`, `.env.example`,
este README y el ADR 001. El módulo `ofirone/backend-go` y los paquetes internos
fueron creados en paralelo por otros agentes. El integrador debe añadir una versión
explícita de `github.com/jackc/pgx/v5`, ejecutar `go mod tidy` y conservar `go.mod` y
`go.sum` versionados. Al comprobar esta entrega aún faltaba `go.sum`.

`cmd/api` conecta los constructores existentes de `internal/config`,
`internal/logging`, `internal/httpapi` e `internal/app` con `pgxpool`. No se modifican
esos paquetes. Una prueba de composición inyecta `httpapi.Pinger` para comprobar
probes, metadatos de build y propagación del timeout sin una base real.

## Validación en este workspace

- Go y gofmt no están instalados en el PATH ni en las rutas habituales revisadas.
- Docker CLI está instalado, pero el daemon devuelve `permission denied` al acceder
  a `/var/run/docker.sock`.
- No se pudieron compilar el binario, ejecutar pruebas Go, formatear con gofmt ni
  construir la imagen. Las pruebas incluidas están pendientes de ejecución.
- No se usaron las conexiones DEV/PROD ni se leyó el archivo local de secretos.

## Ejecutar con Go

Desde `backend-go/`, después de integrar el módulo:

```bash
export DATABASE_URL='postgresql://ofirone:change-me@localhost:5432/ofirone?sslmode=disable'
make fmt
make fmt-check
make vet
make test
make test-race
make build VERSION=local COMMIT=unknown
./bin/api
```

`test-race` requiere CGO y un compilador C. El binario de producción se compila
con `CGO_ENABLED=0`. `make run` ejecuta con Go sin construir una imagen.
El proceso lee variables del entorno; no carga archivos `.env` automáticamente.
El ejemplo usa credenciales ficticias. Las URLs reales se inyectan por entorno o
secret manager, sin incluirlas en imágenes, argumentos de build ni Git.

## PostgreSQL local y ejecución con Docker

Estos comandos crean un PostgreSQL de desarrollo con credenciales de ejemplo y un
volumen persistente independiente; no necesitan Compose ni una cuenta Supabase:

```bash
docker network create ofirone-bootstrap
docker volume create ofirone-bootstrap-pgdata
docker run -d --name ofirone-bootstrap-db --network ofirone-bootstrap \
  -e POSTGRES_USER=ofirone -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=ofirone \
  -v ofirone-bootstrap-pgdata:/var/lib/postgresql/data \
  postgres:17-alpine
docker exec ofirone-bootstrap-db pg_isready -U ofirone -d ofirone
make docker-test
make docker-build VERSION=local COMMIT=unknown
docker run --rm --name ofirone-bootstrap-api --network ofirone-bootstrap \
  -p 127.0.0.1:8080:8080 \
  -e DATABASE_URL='postgresql://ofirone:change-me@ofirone-bootstrap-db:5432/ofirone?sslmode=disable' \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --stop-timeout=20 ofirone-api:local
```

Ejecutar la API cuando `pg_isready` indique disponibilidad. Los comandos de creación
se ejecutan una sola vez; para reusar la DB: `docker start ofirone-bootstrap-db`.
`localhost` dentro del contenedor API no apunta al contenedor PostgreSQL.

`make docker-build` y `make docker-test` envían un contexto acotado a código y
metadatos de módulos; excluyen `.env`, documentación y secretos locales. Si el
integrador introduce `go:embed` o paquetes fuera de `cmd/` e `internal/`, deberá
ampliar explícitamente esa lista. Usar estos targets en lugar de enviar todo el
directorio con `docker build .`.

El Dockerfile produce un binario estático con certificados CA y usuario numérico
sin privilegios. `GO_VERSION` permite fijar una versión patch o digest del builder
en CI; el valor inicial compartido por Docker y Make es `1.26`. La imagen final
no contiene shell ni herramientas de diagnóstico. Las probes se ejecutan desde
el host o el orquestador.

## Probes y apagado

```bash
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/readyz
curl --fail http://localhost:8080/api/v1/version
```

| Ruta | Resultado |
| --- | --- |
| `GET /healthz` | 200 si el proceso atiende HTTP; no consulta PostgreSQL |
| `GET /readyz` | 200 después de `Ping`; 503 con DB inaccesible o cierre iniciado |
| `GET /api/v1/version` | Servicio, versión y commit inyectados al compilar |

La API puede iniciar con PostgreSQL temporalmente inaccesible y recuperar readiness
cuando vuelva. Una configuración inválida impide arrancar. Readiness comprueba
conectividad, no la versión del esquema ni permisos sobre tablas comerciales.

SIGINT/SIGTERM inicia el drenaje HTTP y cierra el pool. El timeout del orquestador
debe superar `SHUTDOWN_TIMEOUT` (ejemplo: 20 segundos frente a 15). Para comprobar
el ciclo local: detener PostgreSQL, confirmar `/readyz`=503 y `/healthz`=200,
arrancarlo y confirmar `/readyz`=200; después ejecutar
`docker stop --time 20 ofirone-bootstrap-api` y revisar los logs de cierre.
Estas verificaciones de integración están pendientes en el entorno actual.

## Configuración

| Variable | Default / validación |
| --- | --- |
| `DATABASE_URL` | Obligatoria; URI `postgres://` o `postgresql://` con host y DB |
| `PORT` | `8080`; entero entre 1 y 65535 |
| `APP_ENV` | `development`; etiqueta de logs |
| `LOG_LEVEL` | `info`; debug, info, warn, error |
| `DB_MAX_CONNS` | `10`; entero positivo de 32 bits |
| `DB_PING_TIMEOUT` | `1s`; duración positiva, también limita conexión inicial |
| `SHUTDOWN_TIMEOUT` | `15s`; duración positiva |

HTTP: headers 5s, lectura 15s, escritura 30s, inactividad 60s y headers máximos 1 MiB.
Usar TLS verificado para PostgreSQL remoto. Si el proveedor usa CA privada, debe
montarse el certificado y configurarse `sslrootcert` en la URL. El pool no necesita
tablas, esquemas propietarios ni extensiones.

Logs de ciclo de vida en JSON a stdout, con servicio, entorno, versión y commit.
Errores de configuración se escriben como JSON a stderr y excluyen valores.
No se registran cadenas de conexión. El servidor HTTP integrado genera request IDs,
recupera panics y normaliza errores. CORS, correlation IDs, autenticación, rate
limiting, compresión y endpoints comerciales siguen pendientes. La configuración
ya reconoce `CORS_ALLOWED_ORIGINS` y `HTTP_MAX_BODY_BYTES`, pero el constructor HTTP
actual no los recibe; no se consideran efectivos hasta integrar ese middleware.
No se considera completo el Track 1.

## Pruebas incluidas

`cmd/api/main_test.go` cubre la composición de configuración con el servidor,
liveness independiente de PostgreSQL, propagación del deadline de Ping, readiness
durante cierre y metadatos del endpoint de versión. No requiere DB. Los paquetes
internos mantienen sus propias pruebas de configuración, probes y ciclo de vida.
Falta ejecutar los comandos anteriores y validar con PostgreSQL real, puerto ocupado
y señales del proceso antes de cerrar Bootstrap 1A.
