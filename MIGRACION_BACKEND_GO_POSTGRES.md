# Plan de migración a Go y PostgreSQL portable

## Objetivo

Migrar Ofirone desde una arquitectura dependiente de Supabase hacia una plataforma portable basada en Go, PostgreSQL estándar y servicios desacoplados. El resultado debe poder ejecutarse con Docker y PostgreSQL local, y desplegarse posteriormente en cualquier hosting compatible sin depender de Supabase Auth, Storage, Realtime, Edge Functions ni `supabase-js`.

El plan está organizado por tracks para permitir ejecución paralela por múltiples agentes. Cada track debe respetar los contratos compartidos y entregar cambios pequeños, testeables y revisables.

## Priorización 80/20 orientada a valor

La migración se ejecutará por valor entregado, no por completar toda la arquitectura antes de usar el producto. La unidad de avance será un vertical slice demostrable: usuario autenticado → tenant → catálogo → inventario → venta → caja.

### P0 — MVP operativo para negocio pequeño

Debe recibir la mayor parte del esfuerzo hasta estar usable:

- Configuración inicial: negocio, moneda, impuestos básicos, sedes, usuarios y roles.
- Login, refresh, logout y selección segura de tenant.
- Roles mínimos: administrador y cajero.
- Productos, categorías, variantes, precios y búsqueda.
- Inventario básico por sede: existencias, entradas y salidas.
- Venta POS, líneas, métodos de pago y cierre de caja básico.
- Proveedores y compras con recepción/confirmación.
- Inventario por sede: entradas desde compras, salidas, ajustes, kardex y mínimos.
- Clientes y CXC: saldos, vencimientos y abonos.
- Dashboard: ventas, stock bajo, compras recientes y CXC vencida.
- Reportes MVP: ventas, productos vendidos, inventario, compras y CXC.
- API Go paginada para esos listados.
- Migración de una pantalla web crítica al API Go.
- Tests de integración del flujo completo con dos tenants.

### P1 — Operación que reduce trabajo manual

Se implementa después del primer flujo productivo:

- Cuentas por pagar completas y conciliación con proveedores.
- Plan separe y abonos.
- Auditoría de operaciones sensibles.
- Jobs para imports y tareas operativas.
- Reportes de ventas e inventario usados diariamente.
- Backups, restore y observabilidad mínima.

### P2 — Diferenciadores y escala

Se mantienen en prioridad reducida hasta validar uso real:

- Mobile offline y sincronización avanzada.
- Tienda online y catálogo público.
- Manufactura y BOMs.
- OCR, IA, notificaciones y realtime.
- S3/media avanzado.
- Optimización prematura, materialized views y reportes no utilizados.

Regla: no iniciar un P2 si existe una tarea P0 incompleta que impida demostrar el flujo de venta. La portabilidad técnica continúa, pero se implementa solo al nivel necesario para el slice activo.

## Resultado esperado

- API HTTP en Go como único backend para web y mobile.
- PostgreSQL estándar como fuente principal de datos.
- Autenticación y autorización multi-tenant independientes de Supabase.
- Storage compatible con S3 para imágenes y archivos.
- Workers Go para trabajos asíncronos, imports, OCR, media y notificaciones.
- Paginación consistente en todos los listados.
- Migraciones, pruebas y observabilidad ejecutables localmente.
- Web y mobile sin llamadas directas a Supabase.
- Ejecución local completa con Docker Compose.

## Alcance

### Incluido

- Migración del backend gateway y workers a Go.
- Portabilidad del esquema, migraciones y consultas PostgreSQL.
- Sustitución de Supabase Auth, Storage, Realtime, RPCs y Edge Functions usadas por la app.
- Diseño de API versionada, errores, paginación, filtros, ordenamiento y permisos.
- Adaptación de web y mobile.
- Pruebas unitarias, integración, contrato, migración y end-to-end.
- CI/CD, observabilidad, backups y estrategia de rollback.

### Fuera de alcance inicial

- Rediseño visual de web o mobile.
- Nuevas funcionalidades comerciales no necesarias para la migración.
- Cambio de proveedor de Mercado Pago, Resend o DeepSeek; solo se abstraerán detrás de interfaces.
- Reescritura inmediata de todas las reglas SQL: primero se conservará el comportamiento y después se optimizará.

## Reglas de trabajo multiagente

- Cada agente trabaja únicamente dentro de su track y evita modificar archivos de otro track.
- Antes de crear una abstracción nueva, revisar `shared/`, contratos existentes y este documento.
- No introducir llamadas directas a Supabase en código nuevo.
- Todo endpoint nuevo debe incluir autorización, paginación cuando liste recursos, errores normalizados y pruebas.
- Toda migración de datos debe ser reversible o tener procedimiento explícito de rollback.
- Las decisiones que afecten contratos se documentan en `docs/decisions/` mediante ADR.
- Los agentes deben entregar: resumen, archivos modificados, pruebas ejecutadas, riesgos y dependencias pendientes.
- La rama de integración debe permanecer compilable y con pruebas verdes.

## Arquitectura objetivo

```text
Web / Mobile
      |
      | HTTPS + JWT
      v
API Go versionada (/api/v1)
      |
      +-- Auth / autorización / tenant context
      +-- Casos de uso y validaciones
      +-- Repositorios PostgreSQL
      +-- Adaptadores externos
      |
      +--> PostgreSQL estándar
      +--> S3-compatible storage
      +--> Worker / cola de trabajos
      +--> Mercado Pago / Resend / IA
```

Principios:

- Hexagonal / Ports and Adapters: dominio y casos de uso sin depender de HTTP, PostgreSQL o proveedores externos.
- Repository pattern: acceso a datos detrás de interfaces, con implementaciones PostgreSQL.
- Service / Use Case layer: reglas de negocio agrupadas por operación, no por controlador.
- DTOs explícitos: no exponer modelos internos directamente.
- Dependency injection manual: constructores explícitos y dependencias visibles.
- Outbox pattern: eventos y notificaciones persistidos antes de ser procesados.
- Unit of Work transaccional: operaciones comerciales críticas en una transacción.
- Idempotency keys: ventas, pagos, imports, webhooks y jobs repetibles sin duplicados.
- Contract-first API: OpenAPI como contrato de integración.

## Tracks paralelos

### Track 0 — Coordinación, inventario y contratos

Responsable: agente líder de arquitectura.

Dependencia: ninguna. Debe iniciar antes que los demás.

- [ ] Inventariar todas las llamadas a Supabase en `web/`, `mobile/`, `shared/` y funciones.
- [ ] Clasificar cada dependencia: Auth, tablas, RPC, Storage, Realtime, Edge Function o SQL directo.
- [ ] Crear matriz de cobertura con columnas: consumidor, operación, contrato actual, reemplazo Go, prioridad y riesgo.
- [ ] Congelar temporalmente funcionalidades no esenciales durante la migración.
- [ ] Definir convenciones de nombres, estructura de paquetes, errores y versionado.
- [ ] Crear ADRs para autenticación, paginación, jobs, storage, realtime y multi-tenancy.
- [ ] Definir estrategia de ramas: una rama por track y una rama `codex/integration`.
- [ ] Mantener este archivo actualizado con estado, responsable y bloqueo de cada track.

Entregables:

- `docs/architecture/backend-target.md`
- `docs/architecture/supabase-dependency-matrix.md`
- `docs/decisions/ADR-*.md`
- `openapi/ofirone.yaml` inicial

### Track 1 — Bootstrap Go y plataforma base

Responsable: agente backend-platform.

Dependencia: Track 0 para convenciones.

- [ ] Crear `backend-go/` con módulos Go, `cmd/api`, `cmd/worker` e `internal/`.
- [ ] Configurar `go.mod`, lint, formatter, tests, Makefile y Dockerfile multi-stage.
- [ ] Implementar configuración tipada por entorno sin secretos en el repositorio.
- [ ] Implementar servidor HTTP con timeouts, graceful shutdown y límites de request.
- [ ] Implementar `/healthz`, `/readyz` y endpoint de versión.
- [ ] Implementar logging estructurado JSON con request ID y correlation ID.
- [ ] Implementar middleware de recuperación de panic, CORS, rate limiting y compresión.
- [ ] Implementar errores HTTP normalizados.
- [ ] Añadir tests unitarios del servidor y middleware.

Criterio de salida: API Go inicia con Docker y responde health/readiness usando PostgreSQL local.

### Track 2 — PostgreSQL portable y migraciones

Responsable: agente database.

Dependencia: Track 0. Puede avanzar en paralelo con Track 1.

- [ ] Exportar y ordenar el esquema actual en migraciones versionadas.
- [ ] Identificar dependencias específicas de Supabase: auth schemas, storage schemas, realtime, extensiones y RPCs.
- [ ] Separar tablas de negocio de tablas de plataforma.
- [ ] Diseñar tablas propias para usuarios, sesiones, refresh tokens, roles y permisos.
- [ ] Mantener `tenant_id` explícito en todas las tablas multi-tenant.
- [ ] Añadir constraints, índices, foreign keys y checks faltantes.
- [ ] Definir estrategia de soft delete donde aplique.
- [ ] Definir auditoría para ventas, compras, inventario, pagos y cambios administrativos.
- [ ] Elegir herramienta de migraciones (`goose`, `Atlas` o `golang-migrate`) y documentarla.
- [ ] Crear seed reproducible con tenant de prueba, roles, usuarios, productos y datos comerciales.
- [ ] Crear entorno PostgreSQL local idéntico al mínimo soportado en producción.
- [ ] Probar migraciones desde cero y sobre una base con datos existentes.

Criterio de salida: una base PostgreSQL limpia puede crearse desde cero con una sola secuencia de migraciones y seeds.

### Track 3 — Autenticación, autorización y multi-tenancy

Responsable: agente identity.

Dependencia: Track 2 para tablas. Puede diseñarse en paralelo.

- [ ] Definir modelo de usuario, tenant, membresía, rol y permisos.
- [ ] Implementar login, refresh, logout, revocación de sesión y recuperación de contraseña.
- [ ] Usar passwords con Argon2id o bcrypt con parámetros documentados.
- [ ] Firmar JWT con rotación de claves y `kid`.
- [ ] No guardar access tokens en logs ni respuestas de error.
- [ ] Implementar middleware que derive `user_id`, `tenant_id`, roles y permisos desde el token.
- [ ] Validar en servidor que cada operación use el tenant del contexto autenticado.
- [ ] Implementar autorización por permiso y alcance de sede/caja cuando aplique.
- [ ] Crear límites de intentos de login y protección contra enumeración de usuarios.
- [ ] Añadir tests unitarios de tokens, expiración, refresh, permisos y aislamiento entre tenants.
- [ ] Añadir tests de seguridad que intenten acceder a recursos de otro tenant.

Criterio de salida: un usuario autenticado nunca puede leer ni modificar datos de otro tenant, incluso manipulando IDs o filtros.

### Track 4 — Contrato API, errores y paginación

Responsable: agente api-contracts.

Dependencia: Track 0 y Track 1.

- [ ] Definir API bajo `/api/v1` y versionado compatible.
- [ ] Publicar OpenAPI para endpoints públicos y autenticados.
- [ ] Definir formato único de error: `code`, `message`, `details`, `request_id`, `retryable`.
- [ ] Definir formato único de respuesta de listado:

```json
{
  "items": [],
  "page": 1,
  "page_size": 25,
  "total": 0,
  "has_next": false
}
```

- [ ] Soportar paginación offset para pantallas administrativas donde se necesite total exacto.
- [ ] Soportar paginación cursor para listados grandes o con scroll/infinite loading.
- [ ] Definir límites: `page_size` por defecto 25, máximo 100, salvo excepciones documentadas.
- [ ] Validar filtros, columnas de ordenamiento y dirección; nunca interpolar SQL desde entrada del usuario.
- [ ] Definir ordenamiento estable: siempre incluir una columna tie-breaker, normalmente `id` o `created_at + id`.
- [ ] Añadir `ETag` o `updated_since` en listados apropiados.
- [ ] Definir filtros estándar: búsqueda, estado, fechas, tenant, sede y relaciones.
- [ ] Documentar cómo se paginan exports: no usar el endpoint de UI para exportaciones masivas.
- [ ] Crear helpers reutilizables de paginación y tests de límites, páginas vacías, duplicados y orden estable.

Todos los listados de productos, variantes, inventario, ventas, compras, clientes, terceros, pagos, contratos, reportes operativos, jobs, notificaciones y administración deben cumplir este contrato.

Criterio de salida: ningún endpoint de colección devuelve resultados ilimitados.

### Track 5 — Repositorios y dominios comerciales

Responsable: agentes por dominio, sin modificar el core de otro agente.

Dependencia: Tracks 2, 3 y 4.

Dividir en subtracks independientes:

- [ ] Productos, categorías, variantes y precios.
- [ ] Inventario, movimientos, lotes y vencimientos.
- [ ] POS, ventas, caja y métodos de pago.
- [ ] Compras, proveedores y cuentas por pagar.
- [ ] Clientes, terceros, cartera y crédito.
- [ ] Plan separe y abonos.
- [ ] Manufactura, BOMs y órdenes de producción.
- [ ] Reportes y contabilidad.
- [ ] Tienda online y pedidos.

Para cada dominio:

- [ ] Definir entidades, DTOs, comandos y queries.
- [ ] Crear interfaces de repositorio.
- [ ] Implementar repositorio PostgreSQL con consultas parametrizadas.
- [ ] Implementar casos de uso transaccionales.
- [ ] Implementar handlers HTTP paginados.
- [ ] Validar permisos y tenant en cada caso de uso.
- [ ] Añadir idempotencia a operaciones de creación y confirmación.
- [ ] Añadir auditoría para cambios sensibles.
- [ ] Añadir tests unitarios de reglas de negocio.
- [ ] Añadir tests de repositorio contra PostgreSQL real, no solo mocks.
- [ ] Añadir tests de integración de cada endpoint.

Regla: un agente no debe copiar la lógica actual de un componente Vue dentro del handler; debe trasladarla al caso de uso o dominio.

### Track 6 — Jobs, workers y procesamiento asíncrono

Responsable: agente async.

Dependencia: Tracks 1, 2 y 4.

- [ ] Diseñar tabla `jobs` o `async_jobs` portable con estado, cola, prioridad, intentos, next attempt y timestamps.
- [ ] Implementar claim seguro con `FOR UPDATE SKIP LOCKED`.
- [ ] Implementar lease/visibility timeout para jobs abandonados.
- [ ] Implementar backoff exponencial con jitter.
- [ ] Definir estados: `pending`, `running`, `succeeded`, `failed`, `dead_letter`.
- [ ] Implementar idempotency key por trabajo.
- [ ] Crear worker Go con concurrencia limitada y graceful shutdown.
- [ ] Implementar dead-letter y reintento manual.
- [ ] Migrar imports de XLSX/CSV, procesamiento de media, OCR, IA, reportes y notificaciones.
- [ ] Registrar métricas de duración, éxito, error, reintentos y backlog.
- [ ] Añadir tests unitarios de handlers y tests de integración de claim/complete/fail.

Criterio de salida: un job puede reintentarse o ejecutarse dos veces sin duplicar efectos comerciales.

### Track 7 — Storage y media

Responsable: agente storage-media.

Dependencia: Tracks 1, 2 y 4.

- [ ] Definir interfaz `BlobStore` con upload, download, delete, exists y signed URL.
- [ ] Implementar adaptador S3-compatible.
- [ ] Mantener adaptador local para desarrollo y pruebas.
- [ ] Definir buckets/prefijos por tenant y tipo de archivo.
- [ ] Validar tamaño, MIME, extensión, checksum y nombre seguro.
- [ ] Evitar servir archivos privados directamente sin URL firmada.
- [ ] Migrar imágenes de productos, facturas, comprobantes y branding.
- [ ] Implementar limpieza de objetos huérfanos.
- [ ] Añadir tests con fake store y pruebas de integración con MinIO.

### Track 8 — Realtime, notificaciones y eventos

Responsable: agente events.

Dependencia: Tracks 1, 2, 3 y 6.

- [ ] Identificar todas las suscripciones actuales a Supabase Realtime.
- [ ] Definir eventos de dominio y eventos de integración.
- [ ] Implementar outbox transaccional en PostgreSQL.
- [ ] Crear servicio de publicación por WebSocket o SSE.
- [ ] Definir autorización por tenant, usuario y tipo de evento.
- [ ] Implementar reconexión, heartbeat y replay desde cursor/event ID.
- [ ] Migrar alertas operativas, pedidos online, sincronización y notificaciones.
- [ ] Mantener deduplicación por `event_id` y `dedupe_key`.
- [ ] Añadir tests de publicación, autorización, reconexión y duplicados.

### Track 9 — Adaptación web

Responsable: agente web-migration.

Dependencia: contratos estables de Tracks 3, 4 y dominios migrados.

- [ ] Crear cliente HTTP centralizado para Go.
- [ ] Implementar refresh de tokens y manejo uniforme de 401/403/409/422/429/5xx.
- [ ] Eliminar progresivamente `supabase-js` de servicios de negocio.
- [ ] Migrar módulo por módulo, empezando por lookups y clientes.
- [ ] Adaptar todos los listados a `items`, `page`, `page_size`, `total` y `has_next`.
- [ ] Evitar cargar colecciones completas para selects; crear endpoints de búsqueda paginada.
- [ ] Mantener filtros y ordenamientos en URL cuando la pantalla lo permita.
- [ ] Añadir feature flag temporal por módulo para comparar Supabase vs Go.
- [ ] Añadir pruebas de servicios, mocks de API y pruebas de componentes críticas.
- [ ] Eliminar variables de entorno y rutas que solo existan para Supabase cuando ya no tengan consumidores.

### Track 10 — Adaptación mobile y offline

Responsable: agente mobile-migration.

Dependencia: contratos estables de Tracks 3, 4, 5, 6 y 8.

- [ ] Crear cliente HTTP Go con refresh de tokens y manejo offline.
- [ ] Mantener SQLite local para operaciones offline donde sea necesario.
- [ ] Definir outbox local y reconciliación con idempotency keys.
- [ ] Definir política de conflictos por dominio.
- [ ] Adaptar listados a paginación y sincronización incremental.
- [ ] No descargar catálogos completos sin límite explícito.
- [ ] Migrar uploads al `BlobStore` mediante URLs firmadas.
- [ ] Migrar alertas y eventos al canal realtime nuevo.
- [ ] Añadir tests de cola offline, retry, duplicados, conflictos y expiración de sesión.

### Track 11 — Integraciones externas

Responsable: agente integrations.

Dependencia: Tracks 1, 4 y 6.

- [ ] Crear interfaces para pagos, email, IA, OCR y mensajería.
- [ ] Mantener implementaciones Mercado Pago, Resend y DeepSeek detrás de adaptadores.
- [ ] Mover secretos exclusivamente al backend/worker.
- [ ] Validar firmas y replay protection de webhooks.
- [ ] Hacer idempotentes preferencias, pagos, webhooks y envíos de email.
- [ ] Persistir estado de integraciones y errores técnicos.
- [ ] Implementar timeouts, retries y circuit breakers donde corresponda.
- [ ] Añadir sandbox/fakes para tests y pruebas de contrato con proveedores.

### Track 12 — Seguridad, calidad y observabilidad

Responsable: agente security-quality.

Dependencia: puede trabajar desde el inicio sobre contratos y bootstrap.

- [ ] Configurar `go vet`, `staticcheck`, `gofmt`, `golangci-lint` y análisis de dependencias.
- [ ] Añadir SAST, secret scanning y dependency scanning en CI.
- [ ] Definir política de logs sin PII, tokens, secretos ni datos financieros innecesarios.
- [ ] Implementar métricas HTTP, DB, jobs, auth, errores y latencia.
- [ ] Añadir tracing con OpenTelemetry cuando el hosting lo soporte.
- [ ] Definir alertas para errores 5xx, latencia, backlog, DB saturation y fallos de pagos.
- [ ] Añadir rate limiting por IP, usuario y tenant.
- [ ] Validar SSRF, path traversal, upload abuse, SQL injection y mass assignment.
- [ ] Ejecutar pruebas de aislamiento multi-tenant.
- [ ] Revisar dependencias y permisos mínimos de base de datos.

### Track 13 — CI/CD y despliegue portable

Responsable: agente platform-ops.

Dependencia: Tracks 1, 2, 6 y 12.

- [ ] Crear Docker Compose con API Go, worker, PostgreSQL, MinIO y servicio opcional de observabilidad.
- [ ] Crear pipeline de lint, unit tests, integration tests, build y security scan.
- [ ] Separar despliegue de API y worker.
- [ ] Configurar migraciones como job explícito antes del despliegue.
- [ ] Definir health checks y rollback.
- [ ] Documentar despliegue en VPS, Cloud Run, Railway/Render o Kubernetes.
- [ ] Definir backups automáticos, retención y prueba periódica de restore.
- [ ] Crear runbooks para caída de DB, backlog, expiración de claves y restauración.
- [ ] No ejecutar migraciones destructivas automáticamente en producción.

## Estrategia de pruebas

### Unitarias

- Casos de uso sin red ni base de datos.
- Validaciones, cálculos, permisos, paginación, idempotencia y estados.
- Objetivo inicial: cobertura significativa de dominio, no cobertura artificial del 100%.

### Repositorio

- PostgreSQL real mediante contenedor efímero.
- Verificar queries, índices, constraints, transacciones, paginación y aislamiento por tenant.
- Evitar que todos los tests dependan de mocks de SQL.

### Contrato

- Validar requests/responses contra OpenAPI.
- Probar compatibilidad web y mobile con respuestas reales.
- Detectar breaking changes en CI.

### Integración

- API Go + PostgreSQL + worker + storage local/MinIO.
- Flujos de login, alta de tenant, venta, compra, inventario, import, job y notificación.

### End-to-end

- Ejecutar desde navegador y simulador/dispositivo.
- Flujos críticos: login, POS, inventario, compra, offline mobile, tienda online, pago y recuperación.

### Migración

- Comparar conteos por tabla y tenant.
- Comparar totales financieros y stock.
- Verificar relaciones, archivos, estados y fechas.
- Ejecutar validación de datos antes y después del corte.

## Paginación obligatoria

Ningún listado debe devolver colecciones ilimitadas. Deben paginarse como mínimo:

- Productos, variantes, categorías, precios e impuestos.
- Inventario, balances, movimientos, lotes y vencimientos.
- Ventas, líneas, pagos, sesiones y cajas.
- Compras, líneas, proveedores y cuentas por pagar.
- Clientes, terceros, cartera y abonos.
- Plan separe y contratos.
- BOMs, componentes y órdenes de producción.
- Pedidos online y reservas.
- Notificaciones, alertas, auditoría y jobs.
- Usuarios, roles, permisos y configuración administrativa.
- Reportes tabulares y cualquier endpoint de exportación previa.

Para reportes agregados se debe definir si el resultado es una página de filas, un resumen fijo o un job de exportación. Nunca se debe resolver con `SELECT *` sin límite.

## Criterios globales de finalización

- [ ] Web y mobile no importan `supabase-js` para operaciones de negocio.
- [ ] La aplicación funciona con PostgreSQL estándar en Docker.
- [ ] Auth, Storage, Realtime, jobs y migraciones tienen reemplazo operativo.
- [ ] Todos los listados tienen paginación, filtros validados y orden estable.
- [ ] Los dominios críticos tienen pruebas unitarias e integración.
- [ ] Existe backup y restore probado.
- [ ] Existe observabilidad mínima para API, DB y workers.
- [ ] Se puede desplegar API y worker por separado.
- [ ] Se ejecutó una prueba completa con tenant de prueba.
- [ ] Se documentó rollback y se eliminó el código muerto de Supabase.

## Fases y orden de integración

### Fase 0 — Preparación

- [ ] Completar inventario de dependencias.
- [ ] Aprobar contratos base y ADRs.
- [ ] Crear Docker Compose mínimo.

### Fase 1 — Plataforma mínima P0

- [ ] Integrar únicamente la base necesaria de Tracks 1, 2, 3 y 4.
- [ ] Tener API, DB, auth, errores y paginación funcionando para P0.
- [ ] Evitar bloquear el primer slice por storage, realtime, jobs avanzados o mobile.

### Fase 2 — Primer vertical slice P0: vender

- [ ] Migrar clientes, productos, inventario básico, métodos de pago y lookups.
- [ ] Implementar listado paginado y búsqueda de productos.
- [ ] Implementar venta, líneas, pago y cierre básico de caja.
- [ ] Conectar una pantalla web completa al API Go.
- [ ] Validar flujo completo con tenant aislado y dos usuarios.
- [ ] Criterio de salida: un usuario puede iniciar sesión, crear/consultar productos y registrar una venta real de prueba sin Supabase en ese flujo.

Orden de cierre P0:

1. Autenticación completa: login, refresh, logout y revocación.
2. Clientes: crear, listar paginado y asociar a venta.
3. Inventario operativo: entradas, salidas y reserva/validación de stock.
4. Ventas completas: stock transaccional, pagos e idempotencia efectiva.
5. Caja básica: apertura, movimientos y cierre; depende de `0015`.
6. Integración de una pantalla web crítica con el API Go.
7. Validación final end-to-end con dos tenants y PostgreSQL.

### Fase 3 — Operación comercial P1

- [ ] Migrar POS, compras, pagos, caja, cartera y plan separe.
- [ ] Incorporar auditoría e idempotencia.

### Fase 4 — Async y capacidades P1/P2

- [ ] Integrar workers, imports, media, IA, notificaciones y realtime.
- [ ] Migrar mobile y sincronización offline.

### Fase 5 — Corte y limpieza

- [ ] Ejecutar migración de datos.
- [ ] Ejecutar pruebas de reconciliación.
- [ ] Activar Go por defecto mediante feature flag.
- [ ] Mantener Supabase en modo fallback solo durante la ventana acordada.
- [ ] Retirar código, secrets y dependencias de Supabase.

## Matriz de estado

| Track | Responsable | Estado | Dependencias | Criterio de salida |
|---|---|---|---|---|
| 0. Arquitectura | Codex + agentes paralelos | Parcial | Ninguna | Inventario y contratos aprobados |
| 1. Go base | Agentes Bootstrap 1A + Codex | Bootstrap 1A completado | 0 | API y worker arrancan |
| 2. PostgreSQL | Agente de inventario + Codex | Core/identidad DEV aplicado | 0 | Migraciones reproducibles |
| 3. Auth | Agente identity + Codex | JWT base completado | 2 | JWT y aislamiento multi-tenant |
| 4. API/paginación | Agente de auditoría + Codex | Parcial | 0, 1 | OpenAPI y helpers aprobados |
| 5. Dominios | Por asignar | Pendiente | 2, 3, 4 | Verticales con tests |
| 6. Jobs | Por asignar | Pendiente | 1, 2, 4 | Worker idempotente |
| 7. Storage | Por asignar | Pendiente | 1, 2 | S3/MinIO funcional |
| 8. Realtime | Por asignar | Pendiente | 1, 2, 3, 6 | Eventos autorizados |
| 9. Web | Por asignar | Pendiente | 3, 4, 5 | Cliente sin Supabase |
| 10. Mobile | Por asignar | Pendiente | 3, 4, 5, 6, 8 | Offline y sync funcional |
| 11. Integraciones | Por asignar | Pendiente | 1, 4, 6 | Adaptadores idempotentes |
| 12. Seguridad | Por asignar | Pendiente | 0 | CI y controles activos |
| 13. CI/CD | Por asignar | Pendiente | 1, 2, 6, 12 | Deploy y restore documentados |

## Ejecución actual

Inicio de la migración: 2026-11-08.

Trabajo paralelo activo:

- Agente Mill: inventario estático de PostgreSQL, RPCs y dependencias Supabase.
- Agente Galileo: propuesta de bootstrap Go y criterios de aceptación.
- Agente Russell: matriz de paginación de listados web/mobile/backend.

Regla de integración: estos agentes están en modo análisis y no deben modificar el código fuente. Sus resultados se revisarán antes de iniciar Tracks 1, 2 y 4.

Resultados iniciales:

- Mill: inventario estático con dependencias P0/P1 y RPCs críticas; documentado en `docs/database-portability/PHASE-0-FINDINGS.md`.
- Galileo: propuesta Bootstrap 1A para API Go, health/readiness, configuración, logs y pruebas; pendiente de implementación.
- Russell: matriz de paginación; confirmó offset sin desempate, límites sin continuación, filtros post-página y sincronización incremental incompleta.
- Bootstrap 1A: configuración, logging, health/readiness, ciclo de vida, Dockerfile, Makefile y README implementados en `backend-go/`; `go.sum` generado y validado con `gofmt`, `go test`, `go vet` y `go build` usando Go 1.22.12. Quedan fuera de esta entrega autenticación, migraciones y worker.
- Baseline PostgreSQL: propuesta y matriz de 16 RPCs críticas creadas en `docs/database-portability/`; aún no se han creado migraciones productivas.
- Paginación Go: paquete reusable en `backend-go/internal/pagination/` con offset, cursor opaco, límites, `has_more`, `next_cursor`, tests y fuzzing; validado con Go.
- Identidad portable: migraciones `database/migrations/0001_core.up.sql` y `0002_identity.up.sql`, rollback, pruebas SQL y puertos de autenticación en `backend-go/internal/auth/`; Go y aplicación SQL en DEV validados.
- DEV: aplicadas `0001_core.up.sql` a `0016_identity_credentials.up.sql` con transacciones individuales. El ledger `schema_migrations` contiene las dieciséis versiones y sus SHA-256 con `dirty=false`. El baseline, catálogo, productos, inventario, ventas, clientes, compras, crédito, apartados, caja, jobs, auditoría, idempotencia, atribución de cliente y credenciales están aplicados; PROD no fue tocado.
- Runner de migraciones: paquete `backend-go/internal/migrations/` implementado con validación de orden/checksum, rechazo de `dirty`, transacciones por migración y reanudación segura; suite Go completa, `go vet` y build validados.
- JWT portable: `backend-go/internal/auth/jwt.go` valida firma HMAC con algoritmo permitido, issuer, audience, `exp`, `nbf` y claims de identidad/tenant/permisos; suite, race detector, vet y build validados. Pendientes revocación, membresía en DB y rotación de claves.
- Adaptador PostgreSQL del runner: `backend-go/internal/migrations/pgxstore.go` implementa conexión dedicada, advisory lock, ledger, transacciones dirty → SQL → clean y limpieza segura; tests, `go vet` y race detector validados. Falta integración end-to-end contra una ejecución real del runner.

## Riesgos principales y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Reproducir mal reglas de RPC | Crear pruebas de caracterización antes de migrar cada dominio |
| Fuga de datos entre tenants | Tests negativos obligatorios y tenant context en repositorios |
| Duplicación de ventas o pagos | Idempotency keys, constraints y transacciones |
| Pérdida de archivos | Checksums, inventario de objetos y migración verificable |
| Realtime inconsistente | Outbox, event IDs, replay y deduplicación |
| Migración demasiado grande | Vertical slices y feature flags por módulo |
| Regresiones mobile offline | Contract tests, simulación de pérdida de red y reconciliación |
| Dependencia accidental de Supabase | Regla CI que bloquee imports nuevos de `supabase-js` |
| Performance insuficiente | Índices, `EXPLAIN`, límites de página y pruebas de carga |

## Definition of Done por tarea

- [ ] Código compilable y formateado.
- [ ] Unit tests para reglas nuevas o modificadas.
- [ ] Integration tests si toca DB, storage, auth o colas.
- [ ] Paginación si expone colección.
- [ ] Autorización y tenant isolation verificadas.
- [ ] Errores normalizados.
- [ ] Logs y métricas suficientes para operar la función.
- [ ] Documentación y contrato actualizados.
- [ ] Sin secretos ni dependencias nuevas no justificadas.
- [ ] Revisión de otro agente completada.

## Comandos mínimos esperados

```bash
# Backend Go
go test ./...
go vet ./...
gofmt -w .

# Infraestructura local
docker compose up -d postgres minio
make migrate
make seed
make test-integration

# Aplicaciones existentes durante la transición
cd web && npm test && npm run build
cd mobile && npm test -- --runInBand
```

## Matriz de cierre operativo MVP

El cierre se considera completo solo cuando cada operación tiene endpoint Go,
adaptador frontend, paginación donde aplica y prueba de éxito/error.

| Módulo | Operaciones MVP | Estado actual |
|---|---|---|
| Configuración/auth | login, refresh, logout, menú, tenant | Conectado |
| Clientes | listar, crear, actualizar, eliminar | Cerrado en Go + frontend |
| Productos | listar, crear, actualizar, desactivar | Cerrado en Go + frontend MVP |
| Variantes | listar, crear, actualizar, desactivar | Cerrado en Go + frontend MVP |
| Compras | listar, recibir, lotes, costo | Conectado |
| Inventario | stock, ajustes, entradas/salidas, alertas | Cerrado en Go + frontend MVP |
| Ventas | listar, crear, pagos, descuento stock | Conectado |
| CXC | cuentas, cargos, abonos, movimientos, resumen | Cerrado MVP: cuentas y abonos |
| Dashboard/reportes | ventas, inventario, CXC, compras | Parcial: datos operativos disponibles; consolidación P1 |

### Criterio de salida

- Ninguna escritura MVP depende de Supabase cuando el flag Go está activo.
- Cada listado usa límite y cursor estable.
- Cada operación impone `tenant_id` desde JWT y nunca desde el body.
- Errores de validación y conflictos se devuelven con códigos HTTP estables.
- Tests unitarios, HTTP y una prueba E2E aislada por módulo.

### Cierre MVP actual

El MVP se cierra con productos, variantes, clientes, compras, inventario,
ventas y CXC operativos en Go/Postgres. Las transferencias entre sedes quedan
fuera del alcance MVP porque el esquema portable no incluye una tabla
`transfer_requests`; se mantienen en el flujo legacy hasta diseñar esa
migración de forma transaccional.

