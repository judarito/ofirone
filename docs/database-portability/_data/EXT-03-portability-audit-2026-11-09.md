# EXT-03 — Validación de portabilidad SQL

Fecha: 2026-11-09. Alcance: `0001–0023`.

## Resultado del escaneo
- `supabase`, `postgrest`, `auth.*`, `storage.*`, `realtime`: **0 coincidencias** en migraciones.
- `CREATE EXTENSION`: **0**; única extensión instalada: `plpgsql`.
- Tipos: `uuid`, `text`, `numeric`, `timestamptz`, `jsonb`, `date`, `boolean`; sin tipos propietarios.
- `SECURITY DEFINER`: 0020 y 0021 (con `search_path` fijo); `0023` es `SECURITY INVOKER`.

## Hallazgos
| Severidad | Migración | Objeto | Dependencia/alternativa |
|---|---|---|---|
| Media | 0023 | `find_login_credentials` | `search_path = public, pg_temp`; revisar `pg_temp` y privilegios del rol auth; alternativa: `pg_catalog, public` y función SECURITY DEFINER endurecida. |
| Media | 0023 | runner | Contiene `BEGIN/COMMIT`; incompatible con el runner que envuelve la transacción. Quitar wrappers. |
| Baja | 0019 | vistas | `security_invoker=true` requiere PostgreSQL 15+; documentado y validado en 18.6. |
| Baja | 0015/0021 | triggers | Funciones de trigger con `search_path` fijo; correcto. |

## Conclusión
Sin dependencias de Supabase/PostgREST/extensiones. La portabilidad SQL es **PASS**; 0023 requiere corrección de `search_path`/wrappers antes de aplicar.
