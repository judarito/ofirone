# Casos N — N8 resuelto; pendientes N9, N10, N16, N17 y N18/N19

- **N8:** `RESUELTO/PASS` con `public.membership_roles` (suite 0012, SQLSTATE `23503`). **No crear `user_roles`.**
- **Pendientes:** N9, N10, N16, N17, N18 y N19 en `BLOQ` por objeto ausente en `database/migrations/0001–0012`.
- **Naturaleza:** SQL de referencia / propuesta. **No es una migración.**
- **Archivo SQL:** [`pending_n_cases.sql`](pending_n_cases.sql).
- **Alcance:** solo `docs/database-portability/_data/contracts/`; no se aplicó DDL en DEV ni PROD.
- **Base:** PostgreSQL 15+; UUID sintéticos y dominios `.example.test`.
- **Precedente:** matriz N1–N20 en [`../../multitenancy-isolation.md`](../../multitenancy-isolation.md) §9; evidencia en [`../validation-business-0012-2026-11-09.txt`](../validation-business-0012-2026-11-09.txt) (N8 PASS en la línea 29).

> **Validado en base desechable:** el script se ejecutó completo (DDL + aserciones + `ROLLBACK`) y pasó; ver [`../validation-pending-n-cases-0012.txt`](../validation-pending-n-cases-0012.txt).
>
> **No ejecutar `pending_n_cases.sql` en DEV ni en PROD.** Crea objetos propuestos
> (`sale_line_batches`, `online_stores`, `online_store_catalog`, `stock_balances`,
> `vw_sales_summary` y dos funciones) y siembra fixtures de dos tenants. No crea
> `user_roles`. Solo debe correr en una base desechable que se destruya al final.

## Tabla resumen

| Caso | Objeto | Estado actual | Prueba principal | Resultado esperado | SQLSTATE |
|---:|---|---|---|---|---|
| **N8** | `public.membership_roles` (existente) | **RESUELTO/PASS** (suite 0012) | Insertar `(tenant A, membership A, role B)` con contexto A | Rechazo de la FK compuesta; no se usa `user_roles` | `23503` |
| **N9** | `public.sale_line_batches` (propuesto) | **BLOQ** (42P01) | Insertar línea/venta A con `batch_id` de B | Rechazo por FK compuesta al lote; fila con tenant B rechazada | `23503` / `42501` |
| **N10** | `public.online_store_catalog` (propuesto) | **BLOQ** (42P01) | Insertar tienda A con `variant_id` de B | Rechazo por FK compuesta a variante; fila con tenant B rechazada | `23503` / `42501` |
| **N16** | `public.stock_balances` (vista propuesta) | **BLOQ** (42P01) | `select count(*) from stock_balances where tenant_id = B` con contexto A | 0 filas de B; `sum(on_hand)` solo de A; 0 sin contexto | `—` (0 filas) / `42501` si se deniega |
| **N17** | `public.vw_sales_summary` (propuesta) | **BLOQ** (42P01) | Contar ventas de B y comprobar `security_invoker=true` | Solo A; `reloptions` incluye `security_invoker=true` | `—` (0 filas) / `42501` |
| **N18** | `public.fn_claim_async_jobs(...)` (propuesta) | **BLOQ** (42P01) | Claim con contexto A teniendo jobs A y B | Solo reclama A; B sigue `queued`; sin contexto falla | `42501` / `22023` |
| **N19** | `public.fn_complete_async_job(...)` (propuesta) | **BLOQ** (42P01) | Completar job B con contexto A; luego job A con su worker | B rechazado; A pasa a `succeeded`; repetir es idempotente | `42501` |
| N20 | `public.audit_log` | Ya existe (0001–0012) | — | Fuera de este archivo; ya validado | `23503` / `42501` |

## Cómo ejecutar

### Precondiciones

1. PostgreSQL 15+ (necesario para `security_invoker` en vistas).
2. Base **desechable** creada para esta corrida.
3. Migraciones `0001–0012` aplicadas con el runner/ledger.
4. Ejecutar como owner privilegiado de la base temporal con `BYPASSRLS` y `CREATEROLE` **solo para sembrar los fixtures**. Las pruebas crean un rol `NOBYPASSRLS` (`ofirone_pending_n_actor`) y cambian a él para sufrir la RLS como el runtime real.
5. No usar credenciales ni datos reales. El archivo usa UUID fijos y `.example.test`.

### Comando

```bash
# Variable de entorno de una base TEMPORAL, nunca DEV/PROD.
# El valor no se documenta ni se imprime.
psql "$DATABASE_URL_DISPOSABLE" -v ON_ERROR_STOP=1 \
  -f docs/database-portability/_data/contracts/pending_n_cases.sql
```

Si la base temporal no existe, crearla y aplicar las migraciones con el harness
de `tools/database/` antes de este archivo. No se incluyen cadenas de conexión.

### Qué hace el archivo

1. **Sección 1:** nota histórica de N8. No hay DDL de `user_roles`; N8 se validó
   con `membership_roles` y no se repite.
2. **Secciones 2–6:** DDL propuesto para N9, N10, N16, N17, N18 y N19. Si un
   objeto ya existe por una migración futura, comentar ese bloque y conservar
   las pruebas.
3. **Sección 8:** una transacción con fixtures de dos tenants, un rol de prueba
   `NOBYPASSRLS` y los casos N9, N10, N16, N17, N18 y N19 (N8 solo como
   nota). Termina en `ROLLBACK`, por lo que no deja fixtures, roles ni jobs.
4. Los `RAISE NOTICE 'N… PASS'` confirman cada caso. Cualquier
   `RAISE EXCEPTION` aborta la transacción y debe tratarse como `FAIL`.
5. El DDL propuesto **sí queda creado** (no hay transacción global alrededor de
   las secciones 2–6). Destruir la base desechable al terminar.

### Lectura de resultados

| Salida | Interpretación |
|---|---|
| `N… PASS` | El objeto existe y el caso se comportó como se espera. |
| `ERROR: relation "…" does not exist` (`42P01`) | Estado actual **BLOQ**: el objeto aún no existe. Es el resultado esperado antes de la migración. |
| `N… FAIL` / `RAISE EXCEPTION` | Fuga o control ausente. Revisar el caso y no promover la migración. |
| `insufficient_privilege` (`42501`) no capturado | El rol de prueba carece de un grant necesario; ajustar grants, no relajar RLS. |

## Decisiones y supuestos

1. **N8 resuelto con `membership_roles`.** La suite 0012 validó que un rol de
   otro tenant se rechaza con `23503` usando
   `membership_roles (tenant_id, membership_id, role_id)`. `user_roles` no
   existe en el baseline y **no debe crearse**: duplicaría el modelo y
   permitiría asignaciones inconsistentes. Se conserva solo como nota histórica.
2. **`sale_line_batches`.** Las FK compuestas validan tenant de venta, línea y
   lote. No validan que `sale_id` sea exactamente la venta de `sale_line_id`;
   para eso hace falta una `UNIQUE (tenant_id, sale_id, sale_line_id)` en
   `sale_lines` y una FK triple. Queda documentado como propuesta, no aplicado.
3. **`online_stores`.** No existe en `0001–0012`; se propone una versión mínima
   como prerrequisito de `online_store_catalog`. Si la migración real difiere,
   conservar las claves compuestas y ajustar columnas.
4. **`stock_balances`.** Se propone **vista** con `security_invoker=true` y
   filtro explícito de tenant, no matview. Expone `on_hand`/`reserved` (nombres
   legacy) calculados desde `inventory_batches.quantity_on_hand`/
   `quantity_reserved`. Una matview normal no admite RLS y, si se le concede
   `SELECT`, devuelve filas de todos los tenants. La alternativa con matview
   privada + vista con filtro está comentada en el SQL; es menos preferida y
   exige no otorgar `SELECT` sobre la matview.
5. **`vw_sales_summary`.** No incluye cliente porque `sales.customer_id` aún no
   existe (brecha P0 del README de contratos). La vista podrá ampliarse cuando
   exista esa columna.
6. **Funciones de jobs.** Se adaptan al `async_jobs` real de 0001–0012:
   `job_type`, `available_at`, `priority`, `attempts`, `locked_at`, `locked_by`.
   No existen `queue`, `run_after`, `lock_expires_at`, `result` ni
   `async_job_attempts`. El lease se calcula con `locked_at + p_lease_seconds`.
   La firma legacy con `p_result jsonb` **no** se adopta hasta que exista
   `async_jobs.result`; el resultado operativo debe ir a `audit_log` o a Go.
7. **`SECURITY DEFINER`.** Ambas funciones fijan
   `search_path = pg_catalog, public, app_private`, revocan `PUBLIC` y filtran
   explícitamente por `app_private.current_tenant_id()`. El owner definitivo
   debe ser un rol `NOLOGIN` dedicado; los `ALTER FUNCTION ... OWNER` y `GRANT
   EXECUTE` al rol worker quedan comentados porque ese rol aún no existe.
8. **Idempotencia.** La creación de jobs ya es idempotente por
   `UNIQUE (tenant_id, job_type, idempotency_key)`. `fn_complete_async_job` es
   idempotente para el mismo worker: repetir el cierre devuelve el job
   `succeeded` sin reescribirlo. `locked_by` se conserva como “último worker”
   tras el cierre; no debe interpretarse como un lease activo.
9. **N20.** `audit_log` ya existe y se validó en la suite 0012; no se repite en
   este archivo.

## Riesgos

- **Aplicar el SQL en el entorno equivocado.** Es DDL propuesto; no es una
  migración y no tiene `down`. Solo base desechable.
- **Conflictos con migraciones futuras.** Nombres, columnas y firmas pueden
  diferir; el archivo debe reconciliarse antes de convertirlo en migración.
- **No reintroducir `user_roles`.** N8 ya está cubierto por `membership_roles`.
  Crear `user_roles` reabriría la duplicidad y una fuente de asignaciones
  inconsistentes.
- **Matview.** Si finalmente se conserva `stock_balances` como matview y se le
  da `SELECT` al runtime, N16 fallará por fuga. La vista segura o una función
  con filtro son las únicas alternativas aceptables.
- **Catálogo online.** La definición legacy usa `stock_mode` en MAYÚSCULAS
  (`ALL`/`FIXED`/`PERCENT`) y `NUMERIC(14,3)`; la propuesta usa minúsculas y
  `NUMERIC(19,6)` por consistencia con el baseline. Hay que decidir el mapeo
  antes de migrar datos existentes. `price_override` es una columna nueva y no
  reemplaza el precio de la variante.
- **Owner de `SECURITY DEFINER`.** Si se le asigna un owner con `BYPASSRLS` y
  se elimina el filtro explícito, las funciones pueden cruzar tenants. El
  filtro por tenant es obligatorio, no opcional.
- **Lease sin columna persistida.** El lease se deriva de `locked_at` y del
  parámetro `p_lease_seconds`; no hay una columna `lease_expires_at` que auditar.
  Si el worker y el completador usan leases distintos, el cierre puede fallar
  con `42501` aunque el trabajo esté vigente. Documentar el valor por cola.
- **Vista de ventas incompleta.** Sin `sales.customer_id` no se puede atribuir
  la venta a un cliente; no es un fallo de N17, es la brecha P0 conocida.

## Archivos relacionados

- [`pending_n_cases.sql`](pending_n_cases.sql) — DDL propuesto + pruebas N9, N10, N16, N17, N18 y N19; nota histórica de N8.
- [`README.md`](README.md) — contratos generales de Slice F.
- [`fixtures.sql`](fixtures.sql) — fixtures 0001–0012 ya validados.
- [`../../multitenancy-isolation.md`](../../multitenancy-isolation.md) — matriz N1–N20 y estrategia RLS.
- [`../validation-business-0012-2026-11-09.txt`](../validation-business-0012-2026-11-09.txt) — evidencia N8 PASS y `BLOQ` de N16/N17.
