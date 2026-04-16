# Plan De Unificacion Backend

## Estado actual

El repo hoy mezcla tres tipos de artefactos:

1. Artefactos realmente compartidos entre `web` y `mobile`.
2. Artefactos con el mismo nombre pero pequena divergencia funcional.
3. Artefactos realmente especificos de una sola app.

Inventario actual:

- Migraciones compartidas con mismo nombre en ambas apps: `145`
- Migraciones compartidas e identicas byte a byte: `144`
- Migraciones compartidas pero distintas: `1`
- Migraciones solo `web`: `17`
- Migraciones solo `mobile`: `11`
- Edge Functions con mismo nombre en ambas apps: `2`
- Edge Functions iguales: `create-tenant-user`
- Edge Functions con diferencias: `chat-order-parser`

Hallazgos clave:

- La gran mayoria de `web/migrations` y `mobile/migrations` es redundancia pura.
- `SETUP_DATAIMPORT_BUCKET.sql` es la unica migracion comun que hoy diverge.
- `create-tenant-user` ya esta unificada en comportamiento y es candidata natural a una fuente canonica.
- `chat-order-parser` todavia diverge porque `web` soporta `force_refresh` y `mobile` no.
- El resto de funciones actuales son en buena parte especificas del producto:
  - `web`: `accounting-queue-worker`, `deepseek-proxy`
  - `mobile`: `deepseek-ocr-proxy`, `ops-rag-agent`, `product-photo-analyzer`, `product-photo-parser`, `push-dispatcher`

## Objetivo

Definir una sola fuente canonica para el backend compartido, manteniendo compatibilidad con:

- scripts manuales existentes
- documentacion actual
- despliegues separados por app
- imports y flujos ya consumidos por `web` y `mobile`

## Recomendacion

No mover primero. Canonizar primero.

La estrategia mas segura es:

1. Crear una carpeta compartida para artefactos backend comunes.
2. Mantener temporalmente copias o wrappers en `web/` y `mobile/`.
3. Cambiar documentacion y procesos de despliegue.
4. Solo al final eliminar duplicados.

## Estructura objetivo sugerida

```text
shared/
  supabase/
    migrations/
      ADD_ALERTS_CRON_SCHEDULE.sql
      ADD_CHAT_ORDER_AI_CACHE.sql
      ...
    functions/
      create-tenant-user/
        index.ts
      chat-order-parser/
        index.ts
```

Y dejar por un tiempo:

```text
web/
  migrations/            -> wrappers o enlaces a shared/supabase/migrations
  supabase/functions/    -> wrappers o sync desde shared

mobile/
  migrations/            -> wrappers o enlaces a shared/supabase/migrations
  supabase/functions/    -> wrappers o sync desde shared
```

## Fases seguras

### Fase 1. Congelar la fuente canonica

Elegir una sola fuente de verdad para cada artefacto:

- Para migraciones iguales: mover la version canonica a `shared/supabase/migrations/`.
- Para `create-tenant-user`: mover a `shared/supabase/functions/create-tenant-user/`.
- Para `chat-order-parser`: primero reconciliar diferencias y luego mover.
- Para artefactos especificos de app: dejarlos donde estan.

Resultado esperado:

- Ya no habra dos archivos “maestros” para el mismo cambio.
- `web` y `mobile` pasan a ser consumidores, no dueños, del backend comun.

### Fase 2. Introducir sincronizacion, no borrado

Antes de borrar nada, agregar un mecanismo de sincronizacion:

- opcion A: script de sync que copie desde `shared/supabase/...` hacia `web/...` y `mobile/...`
- opcion B: symlinks
- opcion C: wrappers documentales que indiquen que la fuente real vive en `shared`

Recomendacion:

- Para este repo, prefiero `script de sync`.

Motivos:

- Windows y algunos entornos de CI suelen llevarse peor con symlinks.
- Supabase CLI trabaja mejor con archivos reales dentro del directorio local de la app.
- Permite seguir desplegando desde `web/` o `mobile/` sin cambiar toda la operativa de una vez.

### Fase 3. Normalizar naming y ownership

Separar explicitamente tres grupos:

- `shared/supabase/migrations/core`
- `shared/supabase/migrations/billing`
- `shared/supabase/migrations/manufacturing`

Y mantener fuera de shared:

- `web` solo:
  - accounting
  - reportes superadmin
  - workers y cron propios del panel web
- `mobile` solo:
  - push
  - OCR/foto producto
  - idempotencia y flujos offline propios

### Fase 4. Unificar documentacion de despliegue

Hoy mucha documentacion apunta a `web/migrations/...` o `mobile/migrations/...`.
Eso es el principal riesgo de ruptura silenciosa.

Antes de borrar duplicados:

- agregar una guia unica de despliegue backend
- documentar que el backend compartido vive en `shared/supabase`
- listar que piezas siguen siendo app-specific

### Fase 5. Eliminar duplicados

Solo cuando ya exista:

- fuente canonica
- script de sync
- documentacion actualizada
- verificacion de despliegue

ahi si eliminar duplicados fisicos.

## Orden recomendado de unificacion

### Grupo 1. Bajo riesgo

Unificar primero:

- migraciones compartidas e identicas
- `create-tenant-user`

Porque:

- ya no hay divergencia funcional
- el riesgo de regresion es bajo
- el ahorro de mantenimiento es inmediato

### Grupo 2. Riesgo medio

Unificar despues:

- `chat-order-parser`
- `SETUP_DATAIMPORT_BUCKET.sql`

Porque:

- ya existe divergencia real
- primero hay que decidir cual comportamiento conservar

### Grupo 3. No unificar todavia

Mantener separados por ahora:

- `web` accounting/cron/reporting
- `mobile` push/ocr/fotos/ops-rag

Porque:

- responden a productos y despliegues distintos
- forzar una unificacion prematura mezclaria dependencias y secretos diferentes

## Decisiones concretas pendientes

### 1. `SETUP_DATAIMPORT_BUCKET.sql`

Hay una diferencia real:

- `web` intenta `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`
- `mobile` omite ese `ALTER` porque puede fallar por ownership

Recomendacion:

- conservar el comportamiento `mobile`
- dejar la migracion idempotente y compatible con proyectos donde no se es owner de `storage.objects`

### 2. `chat-order-parser`

Hoy `web` soporta `force_refresh` y `mobile` no.

Recomendacion:

- promover `force_refresh` al contrato compartido
- dejarlo como parametro opcional
- luego unificar la funcion

## Riesgos reales a evitar

- Borrar duplicados antes de actualizar docs y scripts.
- Mover Edge Functions sin revisar secretos y dependencias por app.
- Mezclar migraciones shared con migraciones de producto especifico.
- Romper referencias manuales en docs operativas.
- Asumir que `same filename` implica `same intent`; primero hay que validar ownership funcional.

## Camino minimo viable

Si queremos avanzar sin meternos en una refactorizacion gigante, el camino mas seguro es este:

1. Crear `shared/supabase/migrations/` y `shared/supabase/functions/`.
2. Mover ahi solo:
   - las `144` migraciones comunes e identicas
   - `create-tenant-user`
3. Agregar un script de sync que replique esos archivos a `web/` y `mobile/`.
4. Actualizar docs de despliegue para usar la fuente shared.
5. Dejar `chat-order-parser` y los artefactos app-specific para una segunda fase.

## Recomendacion final

La unificacion correcta no es “fusionar carpetas”, sino separar:

- backend compartido canonico
- backend especifico de web
- backend especifico de mobile

Si se hace asi, el repo queda mas limpio sin romper apps ni despliegues.
