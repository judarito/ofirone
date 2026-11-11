# ADR 001 — Infraestructura de Bootstrap 1A

Estado: implementado parcialmente; pendiente integración del módulo y validación.
Fecha: 2026-11-08.

## Contexto

Ofirone necesita ejecutar API y futuros workers sobre PostgreSQL independiente del
proveedor. Esta tarea autoriza únicamente `backend-go/cmd/api/**`, `Dockerfile`,
`Makefile`, `.env.example`, `README.md` y este ADR. El módulo y los paquetes internos
son responsabilidad del integrador y otros agentes.

## Decisión

Usar `net/http`, `log/slog` y cancelación por señales de la biblioteca estándar;
conectar directamente mediante `github.com/jackc/pgx/v5/pgxpool`. El integrador
debe fijar la versión de pgx y completar `go.mod`/`go.sum`; esta entrega no los modifica.
Go 1.26 es el toolchain de referencia configurable en Docker y Make.

El ejecutable recibe una sola `DATABASE_URL`, seleccionada por despliegue. No carga
credenciales DEV y PROD simultáneamente, no ejecuta SQL de inicialización y no
depende de esquemas o servicios Supabase. El pool se crea sin conexión obligatoria
al arrancar. `/healthz` comprueba proceso y `/readyz` conectividad con deadline.
Una base vacía es suficiente para estas probes.

El cierre por SIGINT/SIGTERM marca readiness no disponible, drena HTTP y cierra el
pool. Las solicitudes reciben un contexto independiente del contexto de señales
para permitir su finalización; al vencer el drenaje se cancela ese contexto y se
cierran conexiones HTTP. Los errores de infraestructura no exponen la URI.

Construir en dos etapas, con CGO desactivado, certificados CA y runtime `scratch`
sin privilegios. Inyectar versión y commit por `ldflags`. Make transmite a Docker
solo Dockerfile, módulos y directorios fuente autorizados para excluir secretos.
El race detector usa un builder con compilador C y no altera el runtime estático.

## Consecuencias y límites

Se dispone del código de un ejecutable operativo y pruebas de composición sin DB,
aún pendiente de compilar al completar las dependencias. `cmd/api` integra los
constructores existentes de `internal/config`, `internal/logging`, `internal/httpapi`
e `internal/app`, creados por otros agentes durante esta tarea.
La imagen final necesita probes externas y un timeout de terminación superior al
timeout del proceso. Readiness no certifica migraciones ni aislamiento multi-tenant.

No se añaden worker vacío, Compose, CI, migraciones, auth, paginación ni middleware
comercial dentro de esta tarea. Request IDs, recuperación de panic y errores
normalizados llegan del servidor HTTP integrado. CORS, correlation IDs y las demás
capacidades comerciales permanecen pendientes. El constructor HTTP actual no recibe
los límites de cuerpo ni CORS de configuración; esa conexión requiere trabajo del
agente HTTP. El tag minor del builder debe fijarse a patch/digest en CI.

## Verificación

Prueba de composición incluida para probes, timeout y metadatos; comandos de formato, vet, tests,
race y build disponibles en Makefile. En este workspace Go/gofmt no están instalados
y Docker no permite acceso al socket. Compilación, formato automatizado, pruebas y
validación del ciclo de vida con PostgreSQL local quedan explícitamente pendientes.
Consultar `backend-go/README.md` para la secuencia reproducible y criterios de
integración; este ADR no declara finalizado Bootstrap 1A ni el Track 1.
