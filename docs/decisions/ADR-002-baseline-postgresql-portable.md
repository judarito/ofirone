# ADR 002 — Baseline PostgreSQL portable y fuente única del esquema

Estado: propuesto; no implementado.
Fecha: 2026-11-09.
Alcance: plan de portabilidad PostgreSQL, no el bootstrap Go ([ADR-001](ADR-001-go-bootstrap.md)).

## Contexto

El esquema actual depende de Supabase Auth, Storage y Realtime, y su historial está repartido en tres directorios que no coinciden: `shared/supabase/migrations/` (161 `.sql`), `web/migrations/` (17 archivos propios) y `mobile/migrations/` (11 propios). No hay orden de migración verificable ni tabla de control; conviven dos baselines (`InitDB.sql` y `full_migration.sql`), parches `FIX_*` y diagnósticos. DEV está vacía y PROD está bloqueado por política, por lo que no existe una observación del esquema desplegado ([`schema-inventory.md`](../database-portability/schema-inventory.md), [`baseline-proposal.md`](../database-portability/baseline-proposal.md)).

## Decisión

1. **Motor objetivo: PostgreSQL 15 o superior**, sin supuestos de Supabase. `gen_random_uuid()` es nativo; no se exige `pgcrypto` para UUID.
2. **Una sola fuente de verdad ejecutable:** un directorio nuevo de migraciones numeradas y monotónicas, con registro de checksums y dependencias declaradas. Los tres directorios históricos se conservan como evidencia de solo lectura, no como baseline ejecutable.
3. **Sin objetos de plataforma:** no se recrean `auth.*`, `storage.*`, `realtime`, `supabase_realtime`, `pg_net` ni Vault. `pg_cron` se sustituye por un worker o cron externo.
4. **Identidad separada de negocio:** `identities` globales y `tenant_memberships` por tenant; `users.auth_user_id` deja de ser autoridad de autorización y pasa a dato de correspondencia de importación. El baseline inicial ya existe en [`database/migrations/0001_core.up.sql`](../../database/migrations/0001_core.up.sql) y [`0002_identity.up.sql`](../../database/migrations/0002_identity.up.sql).
5. **Tipos consistentes:** UUID para identificadores, `timestamptz` para instantes, `date` para fechas civiles, `numeric` para dinero y cantidades; sin `float` ni `timestamp` sin zona.
6. **Stock con una sola representación:** `inventory_batches` como estado operacional, `inventory_moves` como ledger y `stock_balances` como vista normal (no vista materializada con triggers incompatibles). Ver [`schema-inventory.md` §12.2](../database-portability/schema-inventory.md#122-stock_balances-tabla--vista-materializada).
7. **Eventos por outbox:** la transacción escribe la intención; email, push, pagos y storage salen por workers Go.

## Consecuencias

- El baseline no puede reconstruirse ejecutando el directorio histórico completo; hay que fijar una definición vigente por firma y por tabla.
- La importación de datos y la reconciliación se tratan en un runbook separado; este ADR solo fija estructura.
- Mientras no se elija el directorio canónico, cualquier conteo de tablas o funciones es provisional. El inventario estático reporta 100 tablas canónicas y 116 objetos con ámbito de tabla (115 tablas + la matview `stock_balances`) en los tres directorios.
- PROD sigue bloqueado: no se puede confirmar el esquema desplegado ni el orden real de las migraciones.

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Mantener Supabase como base definitiva | Contradice el objetivo de portabilidad y mantiene dependencias de Auth/Storage/Realtime |
| Ejecutar `shared/` completo en una base nueva | Colisiones de baseline, parches y diagnósticos; orden indeterminable |
| Copiar el esquema desde PROD | PROD no tiene usuario de solo lectura y no se analiza por política |
| Adoptar un ORM que genere el esquema | No resuelve identidad, RLS, triggers ni reconciliación; oculta el SQL crítico |

## Verificación pendiente

- [ ] Aplicar el baseline en PostgreSQL 15+ vacío y comprobar arranque sin esquemas Supabase.
- [ ] Ejecutar dos veces las migraciones y verificar idempotencia/segundo `up`.
- [ ] Comparar el esquema resultante con el inventario estático y documentar diferencias.
- [ ] Aprobar la fuente única y el registro de checksums.
