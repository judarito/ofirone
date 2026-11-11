# Implementación inicial de identidad portable

Fecha: 2026-11-09. Implementado: DDL inicial; `0001_core.up.sql` y `0002_identity.up.sql` fueron aplicadas y verificadas en DEV. PROD no fue tocado.
Alcance: [0001/0002 y su README](../../database/migrations/README.md).

## Decisiones del baseline

| Tabla | Ámbito y contrato |
| --- | --- |
| `tenants` | UUID, slug único normalizado, nombre, estado explícito |
| `identities` | Identidad global; email único almacenado en minúsculas/sin espacios laterales; sin contraseñas |
| `tenant_memberships` | Una membresía por `(tenant_id, identity_id)`, con estado propio |
| `roles` | Rol local al tenant; código único dentro de ese tenant |
| `permissions` | Catálogo global; código único, sin privilegios implícitos ni seeds |
| `role_permissions` | Asignación tenant/rol/permiso sin duplicados |
| `membership_roles` | Asignación explícita de roles a membresías del mismo tenant |
| `sessions` | Una sesión pertenece a un tenant, una membresía y su identidad exacta |
| `refresh_tokens` | Hash SHA-256 de 32 bytes, único; sesión, expiración, consumo y revocación |

Las claves foráneas compuestas impiden relacionar una membresía, rol o sesión de
otro tenant aunque se conozca su UUID. `sessions` también verifica que la identidad
sea la de su membresía. Todos los borrados relacionados usan `RESTRICT`; retirar
primero hijos de forma explícita. Los índices incluyen las FK de búsqueda y un
desempate único para paginar por nombre o fecha. PK/UNIQUE ya crean sus propios
índices. `permissions.code` y `roles.(tenant_id,code)` permiten cursor por código.

Todas las tablas tienen `created_at timestamptz`; entidades mutables tienen además
`updated_at`, actualizado por trigger y `created_at` preservado en actualizaciones.
Las tablas de asignaciones solo tienen fecha de concesión: usar inserción/borrado.
No existe auditoría histórica completa todavía. Las comprobaciones temporales son
relativas a la creación, sin `CHECK(now())` que envejezca incorrectamente. La
expiración efectiva se comprueba en cada operación, no por el paso del reloj en SQL.

Este baseline adopta **`tenant_memberships`** como tabla nueva. No modifica `users`
del esquema histórico ni migra sus FK: la correspondencia de UUID se debe definir
en la importación antes de implementar dominios que referencien usuarios.
La normalización de email es una decisión explícita del producto, no una validación
RFC completa. Cambiar email/verificación requiere un flujo autorizado futuro.

## Aislamiento y autorización

RLS forzado por tenant en membresías, roles, asignaciones, sesiones y refresh tokens;
lectura del tenant actual en `tenants` y de la identidad actual en `identities`.
Sin contexto se deniega por defecto. Las políticas incluyen `WITH CHECK` para
impedir insertar o mover filas a otro tenant. No existe usuario superadministrador
implícito por ausencia de perfil. Provisionar por separado los roles técnicos y
los permisos indicados en el README; este DDL no otorga acceso a la API.

La política de tenant protege el perímetro, no decide quién administra roles o
qué sesiones puede revocar un miembro. Los casos de uso deberán imponer RBAC,
propiedad de sesión, estados activos y límites de acceso. El servicio confiable
de autenticación resolverá login/refresh antes de establecer contexto; sus
privilegios no deben compartirse con el pool comercial. Evitar registrar hashes,
tokens o credenciales. Los UUID y los contextos SQL no son prueba de identidad.

## Contrato mínimo de sesión y refresh

1. Autenticar con un proveedor/credencial validado; verificar identidad, tenant y
   membresía activos. Crear sesión con vencimiento absoluto.
2. Generar token aleatorio criptográficamente seguro (mínimo 256 bits de entropía)
   en el servicio. Entregarlo una vez y persistir únicamente SHA-256 en `bytea`.
   No guardar JWT, token original ni contraseñas en estas tablas.
3. Para renovar, resolver el hash con el servicio confiable, fijar contexto y
   bloquear sesión y token con `FOR UPDATE`, siempre en ese orden. Releer los
   estados activos y validar vencimiento de sesión/token, ausencia de revocación
   y `consumed_at IS NULL` dentro de la misma transacción.
4. Consumir el token y emitir su reemplazo atómicamente. El nuevo vencimiento
   debe ser menor o igual al de la sesión. Esa regla entre filas corresponde al
   servicio transaccional; no está garantizada por un CHECK local de tabla.
5. Token consumido reutilizado: rechazar y revocar su sesión y tokens pendientes.
   Conservar tokens consumidos hasta que venza la sesión para detectar reutilización.
   No borrar inmediatamente el hash ni emitir dos tokens en renovaciones paralelas.
6. Logout/revocación marca la sesión y tokens pendientes en una transacción.
   Suspender membresía/identidad/tenant debe bloquear futuras renovaciones aunque
   la sesión no se haya marcado todavía. No se implementa cascada de estados.

Una fila de token no autoriza por sí sola. La sesión es la unidad mínima de
revocación/familia; no se añade todavía cadena `replaced_by` ni sesiones globales
que crucen tenants. Access tokens ya emitidos requieren comprobación de estado o
un TTL/política de revocación explícitos en la futura implementación de auth.

## Validación y siguientes entregas

La prueba [tests/identity.sql](../../database/migrations/tests/identity.sql) prepara
dos tenants y verifica contexto ausente, lecturas aisladas, escritura cruzada
rechazada, FK de roles/membresías, identidad de sesión y tamaño de hash. Termina
en rollback y debe ejecutarse solo en PostgreSQL local desechable. La sintaxis se
puede comprobar sin conexiones con un parser PostgreSQL; eso no demuestra RLS,
integridad referencial ni ejecución de los bloques PL/pgSQL.

Validación realizada: parser PostgreSQL `pglast 7.22` aceptó los cuatro archivos
up/down y la prueba SQL. La aplicación en DEV confirmó 9 tablas, 3 funciones
privadas, 9 políticas RLS, 9 tablas con RLS y 95 constraints. Las pruebas negativas
de aislamiento, rollback y grants todavía están pendientes.

- [x] Baseline y rollback explícitos, sin dependencias Supabase ni extensiones.
- [x] Modelo y restricciones de identidad, pertenencia y tokens.
- [x] Políticas de aislamiento e índices iniciales para listados.
- [x] Prueba reproducible de integridad/aislamiento preparada.
- [ ] Ejecutar up, prueba, down y segundo up en PostgreSQL desechable.
- [ ] Provisionar roles técnicos y comprobar grants mínimos del despliegue.
- [ ] Implementar credenciales/proveedores, login, recuperación y validación de tokens.
- [ ] Implementar rotación concurrente, detección de replay, expiración y limpieza.
- [ ] Probar autorización RBAC, pool de conexiones y suspensión/revocación de sesiones.
- [ ] Definir mapeo de usuarios históricos e importación conservando identificadores.
