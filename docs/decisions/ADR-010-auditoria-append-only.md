# ADR 010 — Auditoría append-only

- **Estado:** propuesta; no implementada en `database/migrations`.
- **Fecha:** 2026-11-09.
- **Boceto SQL:** [`proposals/audit_append_only.sql`](../database-portability/_data/contracts/proposals/audit_append_only.sql).
- **Evidencia:** la suite `validation-business-0012` detectó que `UPDATE` sobre `audit_log` es aceptado.
- **Propuesta validada:** [`validation-p1-guards-proposal.txt`](../database-portability/_data/validation-p1-guards-proposal.txt) (UPDATE/DELETE `23514`, INSERT permitido).

## Contexto

`audit_log` tiene RLS y políticas `FOR ALL`, y el rol de runtime con `UPDATE` puede alterar eventos. La auditoría debe ser inmutable y conservar el actor/tenant.

## Decisión

- Trigger `BEFORE UPDATE OR DELETE` que lanza `23514` (`audit_log` append-only).
- Retirar `UPDATE/DELETE/TRUNCATE` del rol de runtime; conservar `SELECT/INSERT`.
- El borrado/archivado, si se requiere, se hace por un rol administrativo con procedimiento auditado, no por el runtime.

## Consecuencias

- Los eventos no se corrigen in situ; una corrección se registra como nuevo evento.
- Riesgo: si algún proceso actualizaba `last_error` o metadatos de auditoría, fallará; buscar usos antes de migrar.
- RLS se mantiene; el trigger aplica a todos los roles, incluido el owner (si no es superuser).

## Pruebas propuestas

1. `INSERT` PASS; `UPDATE` y `DELETE` `23514`.
2. RLS: tenant B no ve eventos de A; sin contexto 0 filas.
3. `GRANT` del runtime sin `UPDATE/DELETE`; verificación con `has_table_privilege`.
