# ADR 003 — Aislamiento multi-tenant con `tenant_id`, FK compuestas y RLS portable

Estado: propuesto; no implementado.
Fecha: 2026-11-09.
Alcance: modelo de tenancy y aislamiento; complementa [ADR-002](ADR-002-baseline-postgresql-portable.md).
Análisis completo: [`multitenancy-isolation.md`](../database-portability/multitenancy-isolation.md).

## Contexto

De las 100 tablas canónicas, 82 declaran `tenant_id`, pero **no se detectó ninguna FK compuesta** que incluya el tenant. Las FK históricas referencian solo el UUID del padre, de modo que la base acepta que una fila del tenant A apunte a una fila del tenant B. Además, 23 tablas de negocio con `tenant_id` no tienen RLS, `user_roles` y `role_permissions` no declaran tenant, y la autorización existente depende de `auth.uid()` ([`multitenancy-isolation.md` §5](../database-portability/multitenancy-isolation.md#5-riesgos-de-acceso-cruzado-en-las-relaciones-actuales)).

El baseline nuevo de identidad ya demuestra el patrón correcto: `tenant_memberships`, roles y asignaciones usan claves compuestas y RLS con `app.tenant_id` ([`0002_identity.up.sql`](../../database/migrations/0002_identity.up.sql), [`tests/identity.sql`](../../database/migrations/tests/identity.sql)).

## Decisión

1. **`tenant_id` directo y `NOT NULL`** en toda tabla de negocio. Excepciones explícitas: catálogos globales y unidades de sistema (`units_of_measure` con `tenant_id IS NULL` e `is_system = true`).
2. **Toda tabla padre con ámbito de tenant expone `UNIQUE (tenant_id, <pk>)`.** La PK puede seguir siendo el UUID; la clave compuesta existe para ser referenciable.
3. **Toda FK entre entidades de tenant es compuesta:** `(tenant_id, parent_id) REFERENCES parent (tenant_id, parent_id)`. Las FK de una columna se reservan para catálogos globales.
4. **Toda clave de negocio única incluye `tenant_id`.** Se revisan los `UNIQUE` de una columna que hoy impiden el mismo valor en dos tenants.
5. **Las tablas derivadas reciben `tenant_id`** (`user_roles`, `role_permissions`, `async_job_attempts`, `bulk_import_errors`, `public_subscription_signup_events`) o, como mínimo, una FK compuesta al padre. Se prefiere añadirlo para RLS, índices y reconciliación.
6. **`tenant_id` es inmutable.** Se impide con `REVOKE UPDATE (tenant_id)` o trigger; la RLS usa `WITH CHECK`.
7. **RLS es defensa en profundidad, no autorización primaria.** Se implementa con `app.tenant_id` de transacción, `FORCE ROW LEVEL SECURITY` y `WITH CHECK`; sin `auth.uid()`. El backend resuelve el tenant desde la membresía autenticada y lo establece con `set_config('app.tenant_id', $1, true)`.
8. **La autorización y el RBAC viven en Go.** RLS no implementa permisos por módulo; `has_permission` no debe ser la única puerta.
9. **Workers por tenant.** El worker abre transacción y fija contexto por tenant; un rol global con `BYPASSRLS` se reserva para autenticación previa al contexto, no para rutas comerciales.
10. **Sin superadmin implícito.** La ausencia de membresía/perfil deniega; el privilegio de plataforma es un permiso explícito.

## Consecuencias

- Hay que migrar datos y añadir constraints en un orden que respete dependencias; las FK compuestas requieren primero las claves `UNIQUE (tenant_id, <pk>)`.
- Las tablas puente necesitan backfill de `tenant_id`; si hay filas cruzadas, el backfill falla y obliga a reconciliar antes de migrar.
- Las políticas RLS históricas no se copian: se reescriben con el contexto portable.
- `stock_balances` no puede protegerse con RLS si sigue siendo matview; se decide vista normal o se restringen los grants.
- Las pruebas negativas A/B son obligatorias antes de declarar el aislamiento.

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Confiar solo en filtros de la aplicación | Un repositorio o worker que olvide el filtro produce fuga silenciosa; no hay red de seguridad |
| Confiar solo en RLS | No cubre RBAC, matviews, vistas sin `security_invoker` ni acceso SQL privilegiado; además hoy depende de Supabase |
| Un esquema por tenant | Aísla mejor, pero multiplica migraciones, pools y operación; no es viable para el número de tenants ni para reportes de plataforma |
| `tenant_id` solo en el padre y joins obligatorios | Es el estado actual; permite cruces por UUID y complica RLS e índices |

## Verificación pendiente

- [ ] Añadir las constraints del §6 de [`multitenancy-isolation.md`](../database-portability/multitenancy-isolation.md#6-constraints-claves-compuestas-e-índices-con-alcance-de-tenant).
- [ ] Ejecutar los casos N1–N20 en PostgreSQL desechable.
- [ ] Probar reutilización de conexiones del pool sin herencia de contexto.
- [ ] Auditar filas huérfanas/cruzadas antes de la importación.
