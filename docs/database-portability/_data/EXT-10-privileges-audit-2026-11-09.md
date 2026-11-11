# EXT-10 — Auditoría de privilegios PostgreSQL

Fecha: 2026-11-09. Fuente: catálogo DEV (read-only).

## Roles
| Rol | SUPERUSER | BYPASSRLS | CREATEDB | CREATEROLE |
|---|---|---|---|---|
| `[rol owner]` | no | **sí** | sí | sí |
| `ofirone_auth` | no | **sí (CRÍTICO)** | no | no |
| `token_roles` | no | no | no | no |
| `neon_service`/`neon_superuser`/`cloud_admin` | provider | sí | sí | sí |

## Hallazgos
1. **`ofirone_auth` tiene BYPASSRLS**, contra el requisito de mínimo privilegio. Debe recrearse/alterarse a `NOBYPASSRLS` y con grants mínimos. No lo modifiqué para no cruzar con el track Go.
2. No existe rol API/runtime separado; el owner tiene BYPASSRLS (riesgo conocido).
3. `fn_claim_async_jobs`/`fn_complete_async_job` solo tienen EXECUTE para el owner; no hay grant a runtime/auth.
4. No hay grants de tablas para `ofirone_auth` en DEV (solo el rol creado); el acceso efectivo es por owner.

## Resultado
**FAIL de mínimo privilegio por `ofirone_auth` BYPASSRLS**; requiere acción del track Go. El resto del catálogo no muestra grants públicos indebidos.
