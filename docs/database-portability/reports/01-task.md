# Reporte Tarea 1 — Inventario del esquema actual

**Fecha:** 2026-11-09
**Documento base:** [schema-inventory.md](../schema-inventory.md)
**Estado:** completada (análisis estático)

## Tarea

Enumerar tablas, vistas, matviews, funciones, triggers, secuencias, índices, constraints y enums; clasificarlos; detectar duplicados y dependencias; registrar columnas sensibles y cobertura de `tenant_id`.

## Estado

Completada con limitaciones. El inventario se obtuvo de **sentencias DDL en archivos**, no del esquema desplegado. DEV estaba vacía al momento del análisis (hoy tiene el baseline `0001`/`0002` aplicado; ver [DEV-STATUS](../DEV-STATUS-2026-11-09.md)) y PROD está bloqueado por política (usuario sin solo lectura), por lo que no se repitieron conexiones ([schema-inventory.md §2.2](../schema-inventory.md#L68-L76)).

## Archivos creados/modificados

- [`docs/database-portability/schema-inventory.md`](../schema-inventory.md) — entregable principal.
- [`docs/database-portability/_data/static-scan.json`](../_data/static-scan.json) — evidencia del escaneo.
- [`docs/database-portability/_data/static-analysis.json`](../_data/static-analysis.json) — agregados.
- [`tools/database/static_schema_scan.py`](../../../tools/database/static_schema_scan.py) y [`static_schema_analysis.py`](../../../tools/database/static_schema_analysis.py) — reproducibilidad.

## Hallazgos principales

| Métrica | Valor | Fuente |
|---|---:|---|
| Archivos `.sql` canónicos | 161 | [§1](../schema-inventory.md#L13-L43) |
| Tablas únicas | 100 | ídem |
| Vistas / matviews | 46 / 1 (`stock_balances`) | ídem |
| Funciones únicas / definiciones | 211 / 298 | ídem |
| Triggers / índices únicos | 58 / 159 | ídem |
| Funciones `SECURITY DEFINER` | 111 (38 sin `search_path`) | ídem |
| Tablas con `tenant_id` / con RLS | 82 / 74 | ídem |
| Extensiones | 2 (`pgcrypto`, `pg_cron`) | ídem |
| Secuencias / enums | 0 / 0 | ídem |

1. **Dos baselines paralelos:** `InitDB.sql` (33 tablas) y `full_migration.sql` (34, añade `sale_counters`); ejecutar ambos produce colisiones ([§12.1](../schema-inventory.md#L362-L372)).
2. **`stock_balances` cambió de tabla a vista materializada** con `DROP TABLE … CASCADE`; hay funciones y triggers escritos para la versión tabla ([§12.2](../schema-inventory.md#L373-L379)).
3. **El directorio canónico está incompleto:** `web/migrations/` aporta 17 archivos (contabilidad, 9 tablas, 34 funciones) y `mobile/migrations/` 11 (notificaciones/media) ([§12.6](../schema-inventory.md#L401-L416)).
4. **La autorización vive en RLS + `auth.uid()`:** 160 referencias y 70 políticas lo usan en el universo canónico.
5. **Aislamiento desigual:** 17 tablas sin `tenant_id`; 27 sin RLS, de las cuales 23 sí tienen `tenant_id`.
6. **Columnas sensibles:** 14 tablas y 29 columnas con PII o credenciales ([§14](../schema-inventory.md#L447-L482)).

## Riesgos

- Los conteos están inflados por redefiniciones y no representan el estado desplegado; usarlos como baseline sin introspección es un error.
- `stock_balances` y las funciones que la escriben son incompatibles entre sí; migrarlas sin fijar una representación única duplica o pierde stock.
- El inventario canónico omite módulos de `web/` y `mobile/`; un baseline construido solo desde `shared/` quedaría incompleto.
- PROD no observado: no se puede confirmar qué versión de cada objeto está realmente desplegada.

## Decisiones recomendadas

- Fijar una **fuente única de verdad ejecutable** y tratar los tres directorios históricos como evidencia de solo lectura ([ADR-002](../../decisions/ADR-002-baseline-postgresql-portable.md)).
- Elegir una sola representación de saldos: ledger + lotes, con `stock_balances` como vista normal ([baseline-proposal.md:38-40](../baseline-proposal.md#L38-L40)).
- Presupuestar una introspección futura de DEV/PROD cuando exista usuario de solo lectura.

## Pruebas ejecutadas

- Escaneo y análisis estático reproducibles con `static_schema_scan.py` y `static_schema_analysis.py`.
- Conteos contrastados entre ambos artefactos y el documento.
- **No ejecutado:** introspección contra DEV/PROD, `EXPLAIN`, ni validación de DDL.

## Dependencias para otros agentes

- [Tarea 2](../supabase-dependencies.md): clasificación de dependencias de plataforma.
- [Tarea 3](../identity-schema-proposal.md): modelo de identidad a partir de `users.auth_user_id`.
- [Tarea 4](../multitenancy-isolation.md): cobertura de tenant y FK.
- [Tarea 5](../rpc-migration-matrix.md): firmas y clasificación de funciones.
- [Tarea 6](../pagination-query-matrix.md): tablas y vistas usadas por listados.
