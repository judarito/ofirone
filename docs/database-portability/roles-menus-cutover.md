# Migración de roles y menús a PostgreSQL portable

## Objetivo

Eliminar la dependencia de `fn_get_user_menus` y de las tablas de autorización
históricas de Supabase, conservando los UUID, roles, permisos, menús y
asignaciones existentes en DEV.

## Orden de ejecución

1. Congelar cambios de roles/menús durante la exportación.
2. Exportar desde DEV, en solo lectura, estas tablas:
   `permissions`, `roles`, `role_permissions`, `membership_roles`,
   `menu_items`, `menu_permissions`, `role_menus` y `role_menu_templates`.
3. Validar referencias antes de importar:
   - todos los `role_id` pertenecen al tenant esperado;
   - todos los `permission_id` existen;
   - todos los `menu_item_id` existen;
   - no hay duplicados ni menús huérfanos;
   - `parent_code` no forma ciclos.
4. Crear una migración portable versionada para el esquema de menús.
5. Importar datos con `INSERT ... ON CONFLICT DO NOTHING`, preservando UUID.
6. Recalcular asignaciones de membresías usando `membership_roles` (no
   `user_roles`, que pertenece al modelo histórico de Supabase).
7. Cambiar `GET /api/v1/me/menu` para leer `menu_items`, `role_menus` y los
   permisos del principal dentro de una transacción de lectura.
8. Ejecutar reconciliación: conteos por tabla, roles por tenant, permisos por
   rol y menús visibles por usuario.
9. Activar el endpoint Go como fuente única; mantener el fallback frontend
   solo durante la transición.

## Guardas

- No leer ni modificar PROD.
- No borrar tablas históricas hasta completar dos validaciones consecutivas.
- No reemplazar UUID por códigos o nombres.
- No copiar hashes, sesiones ni refresh tokens como parte de esta migración.
- La exportación debe generar evidencia saneada, sin URLs ni credenciales.

## Criterios de cierre

- Cero referencias huérfanas y cero ciclos en la jerarquía.
- Conteos de roles, permisos, menús y asignaciones coinciden entre origen y
  destino.
- Un usuario con dos roles ve la unión de sus menús sin duplicados.
- Un usuario de otro tenant no ve roles ni menús ajenos.
- El frontend carga el menú desde Go sin consultar Supabase.
- La prueba `up -> down -> up` reconstruye el esquema sin pérdida del dump.

## Estado

- Contrato Go P0 disponible en `GET /api/v1/me/menu`.
- Migración `0024_roles_menus` aplicada en DEV y registrada en
  `schema_migrations` con `dirty=false`.
- Se verificó Supabase `PosLite` y se seleccionó el tenant `ALMIRA`.
- Se importaron a DEV el catálogo disponible de ALMIRA, permisos funcionales,
  roles `ADMINISTRADOR` y `CAJERO`, y sus asignaciones al tenant local.
- No se copiaron credenciales, sesiones ni refresh tokens. Los usuarios quedan
  pendientes de un mapeo explícito a identidades/membresías Go.
- El endpoint Go aún debe consultar `menu_items`/`role_menus`; mientras tanto
  conserva el catálogo P0 como fallback de contrato.
