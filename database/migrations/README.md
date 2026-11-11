# Baseline portable PostgreSQL

Estado: primera estructura de core e identidad. Requiere PostgreSQL **15+**, base
vacía y esquema `public` disponible. No requiere extensiones, Supabase ni red.
`gen_random_uuid()` pertenece al motor soportado. No aplicar junto con los SQL
históricos de `shared/supabase/migrations/`: son líneas de migración distintas.

## Orden de aplicación

1. `0001_core.up.sql`: helpers privados, timestamps y tenants.
2. `0002_identity.up.sql`: identidades, membresías, permisos, roles, asignaciones,
   sesiones y hashes de refresh tokens.
3. `0003_migration_control.up.sql`: tabla global de versiones y checksums,
   inicialmente vacía.

Cada archivo incluye `BEGIN`/`COMMIT`; ejecutarlo completo con detención al primer
error. No envolverlos en otra transacción del runner. No son idempotentes:
un objeto existente es un error deliberado. La tabla de versiones queda definida
en `0003`; el runner todavía está pendiente. El integrador debe registrar
versión/checksum al adoptar una herramienta, conservando el orden. No ejecutar todos los `*.sql` por glob:
mezclaría up, down y pruebas.

Ejemplo para una **base local desechable**, preparada por quien ejecute las pruebas:

```bash
psql -X --set=ON_ERROR_STOP=1 --dbname=ofirone_baseline_test --file=database/migrations/0001_core.up.sql
psql -X --set=ON_ERROR_STOP=1 --dbname=ofirone_baseline_test --file=database/migrations/0002_identity.up.sql
psql -X --set=ON_ERROR_STOP=1 --dbname=ofirone_baseline_test --file=database/migrations/0003_migration_control.up.sql
psql -X --set=ON_ERROR_STOP=1 --dbname=ofirone_baseline_test --file=database/migrations/tests/identity.sql
```

La prueba requiere un usuario administrador de esa base local con capacidad para
crear/cambiar al rol de prueba. Su transacción termina en `ROLLBACK`. No reutilizar
estas instrucciones contra DEV/PROD. La entrega original no abrió conexiones;
posteriormente `0001_core.up.sql` y `0002_identity.up.sql` fueron aplicadas en DEV
y verificadas estructuralmente. No se ejecutaron las pruebas negativas contra DEV
y PROD no fue tocado.

## Control de versiones de migraciones

`public.schema_migrations` es un registro global de infraestructura compatible
con PostgreSQL 15+, sin extensiones ni objetos Supabase. `0003` solo crea su
estructura: no inserta versiones históricas ni registra su propia aplicación.
Su inclusión en este directorio no significa que se haya ejecutado en DEV/PROD.

| Columna | Contrato |
| --- | --- |
| `version` | `bigint` positivo y clave primaria. `0001` se representa como `1`; una versión solo puede aparecer una vez. |
| `name` | Nombre lógico, por ejemplo `core`; entre 1 y 200 caracteres, sin espacios exteriores ni caracteres de control. No es único: la identidad es la versión. |
| `checksum` | SHA-256 de los bytes exactos del archivo `up`, incluidos saltos de línea, como 64 caracteres hexadecimales en minúscula. Obligatorio, calculado por el runner. |
| `applied_at` | `timestamptz` finito, obligatorio, con valor inicial `clock_timestamp()`. El runner debe actualizarlo al completar la aplicación. Con `dirty=true` indica la creación del registro, no una aplicación exitosa. |
| `dirty` | Booleano obligatorio, inicialmente `true`. Solo el runner lo cambia a `false` tras comprobar que la migración terminó correctamente. |

La clave primaria proporciona el índice único de versión. Hay un índice por
`applied_at DESC, version DESC` para consultar el historial con orden estable y
un índice parcial por versión para localizar registros `dirty=true`. El esquema
valida el formato del checksum; no puede verificar por sí mismo el contenido del
archivo ni ejecutar las migraciones.

Antes de adoptar el registro sobre una base existente, verificar los objetos
realmente instalados y reconciliar explícitamente cada versión, incluidos `0001`,
`0002` y `0003`. La ausencia de filas no prueba que la base esté vacía. No deducir
versiones aplicadas únicamente de los nombres de archivo ni reejecutar DDL para
rellenar el historial. Los registros históricos requieren evidencia y checksums
de los archivos correspondientes; esta migración no los genera.

El runner deberá serializar ejecuciones (por ejemplo, mediante advisory lock de
sesión PostgreSQL en una conexión dedicada), comparar checksums antes de aplicar
nuevas versiones y detenerse ante discrepancias o cualquier fila dirty. Para los
scripts actuales con `BEGIN`/`COMMIT` propios, debe persistir primero el registro
dirty, ejecutar el archivo completo sin transacción exterior y confirmar después
`dirty=false` y `applied_at`. Si falla o se interrumpe entre esos pasos, conservar
dirty hasta inspeccionar y reconciliar el estado; nunca limpiarlo automáticamente
ni interpretar el flag como prueba de que el DDL se revirtió.

Esta tabla no usa RLS porque no pertenece a un tenant. Se revocan los privilegios
de `PUBLIC`; reservar su acceso al propietario/migrador, revisando también grants
heredados o privilegios por defecto del despliegue. Los roles de API y usuarios
finales no deben poder modificar el historial. La tabla no impone inmutabilidad
al propietario: la política del runner debe impedir reescribir versiones limpias.

## Roles de infraestructura y RLS

La migración no crea roles de clúster ni incorpora contraseñas. El despliegue debe
provisionar propietario/migrador, servicio de autenticación y API por separado.
La API debe ser `NOSUPERUSER NOBYPASSRLS`, no ser propietaria de las tablas, ni
heredar roles privilegiados. RLS usa `FORCE` incluso para el propietario ordinario;
superusuarios y roles `BYPASSRLS` conservan su bypass normal de PostgreSQL.

No se conceden permisos a `PUBLIC`. Para un rol API provisionado, conceder
`USAGE ON SCHEMA public, app_private`, `EXECUTE` únicamente en
`app_private.current_tenant_id()` y `app_private.current_identity_id()`, y `SELECT`
sobre las tablas necesarias. Otorgar escrituras por caso de uso, nunca mediante
`GRANT ALL`. Reservar cambios de permisos/asignaciones al servicio autorizado de
administración. En `membership_roles`/`role_permissions`, conceder `INSERT/DELETE`
si corresponde, sin `UPDATE`; los grants se reemplazan, no se editan.

`tenants` solo admite lectura del tenant actual e `identities` solo lectura de la
identidad actual por RLS. `permissions` es un catálogo global de lectura para roles
con `SELECT`; no contiene información personal. Las demás tablas tienen aislamiento
por tenant para lectura/escritura. **RLS no implementa RBAC**: la API todavía debe
validar membresía activa, permisos y estado de tenant/identidad antes de cada caso
de uso. No dar acceso SQL directo a usuarios finales.

Dentro de cada transacción, después de validar identidad y membresía, establecer
`set_config('app.tenant_id', tenant_uuid, true)` y
`set_config('app.identity_id', identity_uuid, true)`. El tercer argumento `true`
hace el contexto local a esa transacción. Sin tenant se obtienen cero filas y se
rechazan inserciones; un UUID inválido produce error. Nunca usar `SET` de sesión
ni derivar el contexto de parámetros del cliente sin autorización. El GUC es un
contexto de confianza del backend, no una credencial ni un límite ante SQL arbitrario.

Login, selección de membresía y lookup de hash ocurren antes de disponer del tenant
validado. Requieren un servicio de autenticación de confianza con acceso controlado
fuera de RLS (rol dedicado provisionado con `BYPASSRLS` y grants mínimos, sin
privilegios DDL ni uso por rutas comerciales). El baseline no implementa ese
servicio ni funciones `SECURITY DEFINER`. No ejecutar altas como API ordinaria.

## Rollback

En una base desechable, ejecutar en orden inverso:

```bash
psql -X --set=ON_ERROR_STOP=1 --dbname=ofirone_baseline_test --file=database/migrations/0003_migration_control.down.sql
psql -X --set=ON_ERROR_STOP=1 --dbname=ofirone_baseline_test --file=database/migrations/0002_identity.down.sql
psql -X --set=ON_ERROR_STOP=1 --dbname=ofirone_baseline_test --file=database/migrations/0001_core.down.sql
```

Los `down` **eliminan datos**; no sirven para recuperar información ni para un corte
de producción. Respaldar antes si hay datos que conservar. Revertir primero todas
las migraciones posteriores. No usan `CASCADE` ni `IF EXISTS`: una dependencia
inesperada o un orden incorrecto abortan el archivo completo. Si el despliegue
concedió grants en helpers/esquema, revocarlos antes del rollback de core si
constituyen dependencias. Restaurar un backup es un procedimiento independiente.
El rollback de `0003` elimina también todo el historial de versiones; exportarlo
antes y coordinar la reconciliación con el runner. No usa `CASCADE` ni elimina
tablas comerciales.

Detalles del modelo y pendientes: [identity-implementation.md](../../docs/database-portability/identity-implementation.md).
