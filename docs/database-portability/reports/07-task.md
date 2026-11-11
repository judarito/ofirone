# Reporte Tarea 7 — Migración y reconciliación de datos

**Fecha:** 2026-11-09
**Documento base:** [data-migration-runbook.md](../data-migration-runbook.md)
**Estado:** completada (runbook documentado; no ejecutado)

## Tarea

Diseñar el orden de migración respetando dependencias; separar estructura, datos, archivos y validación; definir UUIDs y claves externas; migrar usuarios, tenants, productos, inventario, ventas, compras y archivos; definir checksums/conteos por tabla y tenant; tratar huérfanos, duplicados, soft deletes e históricos; documentar rollback/restauración.

## Estado

Completada como **procedimiento documentado y revisable**. No se ejecutó ninguna fase con datos reales: DEV no contiene datos históricos (aunque el baseline `0001`/`0002` ya está aplicado, ver [DEV-STATUS-2026-11-09.md](../DEV-STATUS-2026-11-09.md)) y PROD está bloqueado por política. El runbook es explícito en que sus cifras y checks deben obtenerse de un snapshot restaurado, no se inventaron.

> **Nota de reanudación.** Al iniciar el cierre documental no existía `data-migration-runbook.md` en el repositorio. Se creó en esta sesión dentro del perímetro permitido (`docs/database-portability/`), a partir de [baseline-proposal.md:119-130](../baseline-proposal.md#L119-L130), [identity-schema-proposal.md §4](../identity-schema-proposal.md#L579-L738) y [multitenancy-isolation.md](../multitenancy-isolation.md).

## Archivos creados/modificados

- [`docs/database-portability/data-migration-runbook.md`](../data-migration-runbook.md) — entregable principal.
- [`docs/database-portability/reports/07-task.md`](07-task.md) — este reporte.

## Hallazgos principales

1. **El origen no es un dump único:** el esquema está repartido en `shared/`, `web/` y `mobile/`; hay dos baselines y parches posteriores ([schema-inventory.md §12](../schema-inventory.md#L362-L416)). La importación debe partir de una definición vigente acordada, no del historial completo.
2. **El orden lo impone el grafo de FK, no el nombre del archivo.** El runbook fija 17 niveles: núcleo → identidad → referencias → terceros → catálogo → caja → inventario → ventas → compras → cartera → manufactura → contabilidad → tienda → jobs/media → funciones/triggers → constraints/índices → grants.
3. **Identidad es un mapeo, no una copia:** `public.users.user_id` → `membership_id`; `auth.users.id` → identidad global; `auth_user_id` deja de ser autoridad ([ADR-005](../../decisions/ADR-005-modelo-identidad-portable.md)).
4. **No se migran credenciales ni sesiones:** Argon2id nace en el servicio; activación por invitación/reset; los usuarios se reautentican ([ADR-006](../../decisions/ADR-006-credenciales-migracion-y-oidc.md)).
5. **El stock se reconstruye:** se cargan lotes y `inventory_moves` sin reejecutar triggers; `stock_balances` se recalcula ([baseline-proposal.md:38-40](../baseline-proposal.md#L38-L40)).
6. **Archivos:** manifiesto por objeto con bucket, clave, tamaño, checksum y propietario; nueva clave en S3; autorización en Go ([supabase-dependencies.md §4](../supabase-dependencies.md#L195-L236)).
7. **Reconciliación por tenant:** conteos, sumas `numeric`, checksums de fila, cero huérfanos y cero cruces; los totales globales no demuestran nada.
8. **Rollback:** antes de abrir escrituras es sin pérdida; después exige reconciliar o restaurar. Los `down` del baseline eliminan datos y no son recuperación ([database/migrations/README.md:70-84](../../../database/migrations/README.md#L70-L84)).

## Riesgos

- Sin snapshot consistente ni ventana de corte, la carga final puede perder escrituras concurrentes.
- Reejecutar triggers al cargar históricos duplica movimientos, asientos u outputs.
- Perfiles huérfanos, emails duplicados y filas con tenant cruzado pueden bloquear las FK compuestas; hay que reconciliarlos **antes** de añadirlas.
- Un rollback prometido como «cambio de URL» es falso después del punto de no retorno.
- La retención del origen y de datos personales requiere revisión legal.

## Decisiones recomendadas

- Aprobar el baseline y el modelo de identidad **antes** de cargar; sin eso, el runbook no debe ejecutarse.
- Congelar escrituras del origen durante la carga final y conservar el snapshot hasta cerrar reconciliación.
- Usar el validador de la [Tarea 8](08-task.md) para conteos, huérfanos, índices y duplicados, y añadir checksums propios por tabla crítica.
- Documentar cada excepción de reconciliación con tabla, tenant, consulta y responsable; no ajustar a mano sin evidencia.

## Pruebas ejecutadas

- Contraste del orden y las dependencias con [baseline-proposal.md](../baseline-proposal.md) y [schema-inventory.md](../schema-inventory.md).
- Revisión de que el runbook no contiene URLs, credenciales ni PII.
- **No ejecutado:** snapshot, restauración, carga, reconciliación, corte o rollback. Bloqueado por DEV sin datos históricos y PROD sin solo lectura. La única ejecución real fue la aplicación del baseline `0001`/`0002` en DEV, que no forma parte de este runbook de datos.

## Dependencias para otros agentes

- Aprobación de [ADR-002](../../decisions/ADR-002-baseline-postgresql-portable.md), [ADR-003](../../decisions/ADR-003-aislamiento-multi-tenant.md), [ADR-005](../../decisions/ADR-005-modelo-identidad-portable.md) y [ADR-006](../../decisions/ADR-006-credenciales-migracion-y-oidc.md).
- Backend Go: workers de outbox, storage y jobs deben arrancar después del corte.
- Infraestructura: snapshot, storage destino, secret manager y ventana de mantenimiento.
