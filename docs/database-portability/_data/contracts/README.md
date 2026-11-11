# Contratos de validación para Go — PostgreSQL portable

- **Estado:** contratos de referencia (Slice F). No implementan handlers ni modifican `backend-go/`.
- **Base:** migraciones `0001–0012`; validado en base desechable (ver `../validation-business-0012-2026-11-09.txt`).
- **Consulta de referencia:** [`reference_queries.sql`](reference_queries.sql).

## Contexto obligatorio

Toda consulta se ejecuta dentro de una transacción con:

```sql
set local app.tenant_id = :tenant_id;
set local app.identity_id = :identity_id;  -- cuando aplique
```

Funciones: `app_private.current_tenant_id()` y `app_private.current_identity_id()`.

**Privilegios del rol de runtime (mínimos):**

- `USAGE` en `public` y `app_private`.
- `EXECUTE` en `current_tenant_id()` y `current_identity_id()`.
- `SELECT/INSERT/UPDATE` solo en las tablas que use el caso de uso.
- **Sin** `CREATE`, sin `BYPASSRLS`, sin ser owner de tablas.

## Contrato de listados (keyset)

| Campo | Regla |
|---|---|
| Orden | Columna(s) de orden + id como desempate estable (`name, product_id`; `sold_at, sale_id`) |
| Entrada | `after_*` del último elemento de la página anterior; `limit` acotado (p. ej. 1–100) |
| Salida | Filas de la página + `has_more`/`next_cursor` calculados por el handler |
| Garantías | Sin duplicados ni omisiones si el orden es estable y el cursor incluye el id |
| Errores | `42501` si no hay contexto o no coincide; `22023` si `limit` inválido |

## Contratos de jobs (`async_jobs`)

- No existe todavía `fn_claim_async_jobs`/`fn_complete_async_job`; el SQL de referencia usa `FOR UPDATE SKIP LOCKED` y lease en `locked_at`/`locked_by`.
- **Claim:** una fila por worker; incrementa `attempts`; respeta `available_at`, `priority` y `status='queued'`.
- **Complete:** solo si `locked_by = :worker` y el tenant coincide; devuelve `42501`/0 filas en caso contrario.
- **Idempotencia:** `unique (tenant_id, job_type, idempotency_key)`; reintentos no crean jobs duplicados.
- Si se implementa como función SQL, debe ser `SECURITY DEFINER` con `search_path = pg_catalog, public` **o** ejecutarse con el rol de runtime y RLS activo.

## Contratos de auditoría

- `audit_log` es append-only para runtime; `metadata` debe ser objeto JSON.
- Insertar con `tenant_id = current_tenant_id()` y `actor_identity_id = current_identity_id()`; un tenant distinto produce `42501`/`23503`.

## Contratos de inventario y cartera

- Inventario: suma de `inventory_moves.quantity_delta` por `variant_id` (no usar una matview sin RLS).
- Cartera cliente: `customer_credit_accounts.current_balance` y movimientos en `customer_credit_movements`.
- Compras: `purchases` + `supplier_payables` (original/pagado); validar `total = subtotal + tax_total - discount_total`.

## Errores esperados (SQLSTATE)

| Código | Uso |
|---|---|
| `42501` | RLS/permiso: contexto ausente o tenant ajeno |
| `23503` | FK compuesta: referencia de otro tenant |
| `23505` | Unicidad por tenant (SKU, idempotency key, número de documento) |
| `23514` | CHECK (totales, cantidades, hashes) |
| `23502` | NOT NULL (p. ej. `tenant_id` ausente) |

## Fixtures y pruebas

- **Fixtures SQL reproducibles:** [`fixtures.sql`](fixtures.sql) (2 tenants, catálogo, producto/variante, inventario, venta, compra, cartera, apartado, job y auditoría). Validado en base desechable: 38 tablas, 2 tenants, 1 venta, 1 apartado — ver [`../validation-fixtures-0012-2026-11-09.txt`](../validation-fixtures-0012-2026-11-09.txt).
  - Ejecutar como owner con `BYPASSRLS` en base desechable; si no, desactivar `FORCE RLS` temporalmente para `tenants`/`identities`.
- **Roles propuestos:** [`runtime-roles-proposal.sql`](runtime-roles-proposal.sql) separa migrador/auth/API, todos `NOBYPASSRLS`; **no ejecutar** sin aprobación. Probados en base desechable: [`../validation-runtime-roles-0012.txt`](../validation-runtime-roles-0012.txt) (PASS).
- **Siembra amplia:** `tools/database/validate_business_disposable.py` (identidad, catálogo, productos, inventario, ventas, compras, cartera, apartados, jobs, auditoría).
- **Reportes operativos:** [`report_queries.sql`](report_queries.sql) — ventas/día, stock, compras pendientes, aging CxP, cartera, apartados por vencer, jobs y auditoría. **8/8 ejecutados** contra fixtures en base desechable: [`../validation-report-queries-0012.txt`](../validation-report-queries-0012.txt).
- **Paginación/rendimiento:** `tools/database/validate_pagination_perf.py` (130 filas en 9 listados, empates, página vacía, cambio concurrente, `EXPLAIN`).

- Siembra sintética reproducible: `tools/database/validate_business_disposable.py` (identidad, catálogo, productos, inventario, ventas, compras, cartera, apartados, jobs, auditoría).
- Paginación/rendimiento: `tools/database/validate_pagination_perf.py` (130 filas por listado, empates, página vacía, cambio concurrente, `EXPLAIN`).

## Acceso de autenticación a credenciales (ADR-011)

`0016_identity_credentials` solo permite lectura de la propia identidad; el login del backend consulta por email/tenant. Propuesta: rol `ofirone_auth` con política SELECT específica y sin escritura; validada en base desechable (`../validation-adr-011-proposal.txt`). Boceto: [`proposals/identity_credentials_auth_access.sql`](proposals/identity_credentials_auth_access.sql).

## Brechas de producto detectadas (no implementadas)

| Prioridad | Brecha | Propuesta (fuera del perímetro) |
|---|---|---|
| **P0** | `sales` no tiene `customer_id`; la venta no se puede atribuir a un cliente | Añadir `customer_id` nullable con FK `(tenant_id, customer_id)` a `customers`, o tabla `sale_customers`; migración nueva del track Go |
| **P1** | No hay tablas de caja/cierre (`cash_sessions`/`cash_movements`) | Definir sesión de caja por tenant/sede, apertura/cierre y movimientos |
| **P2** | Tienda online, manufactura/BOM, offline, IA/realtime, notificaciones, storage avanzado | Backlog; no bloquea P0 |

## Bloques aún no cubiertos

- `user_roles`, `sale_line_batches`, `online_store_catalog`, `stock_balances` (matview), `vw_sales_summary`, funciones de claim/complete y tablas de integraciones.
- Cuando existan, estos contratos deben ampliarse y re-ejecutar las suites con el nuevo conjunto de migraciones.

## Propuestas P0/P1

Artefactos de diseño para el track Go; **no son migraciones reales** y no se ejecutan desde este repo.

- **P0 — venta ↔ cliente:** implementado en `0014_sales_customer_link` (ADR-007); el boceto [`proposals/sales_customer_link.sql`](proposals/sales_customer_link.sql) queda como referencia histórica.
- **P1 — caja y cierre:** implementado en `0015_cash_sessions` (ADR-008) con append-only en movimientos; validación [`../validation-cash-0015-2026-11-09.txt`](../validation-cash-0015-2026-11-09.txt).
- Ambos documentos asumen PostgreSQL 15+, RLS portable y dos tenants sintéticos; `0014` (cliente) y `0015` (caja) están aplicadas; ADR-009/010 siguen como propuestas (0016+), pendientes de aprobación e implementación en `database/migrations/`.
- **Validación en base desechable:** ADR-007 → [`../validation-adr-007-proposal.txt`](../validation-adr-007-proposal.txt) (PASS); ADR-008 → [`../validation-adr-008-proposal.txt`](../validation-adr-008-proposal.txt) (PASS); ADR-009/010 → [`../validation-p1-guards-proposal.txt`](../validation-p1-guards-proposal.txt) (PASS).
- **P1 — integridad y auditoría:** [ADR-009](../../../decisions/ADR-009-guardas-integridad-p1.md) y [boceto](proposals/p1_integrity_guards.sql) (transiciones de compra, sobrepago CxP, apartado→venta); [ADR-010](../../../decisions/ADR-010-auditoria-append-only.md) y [boceto](proposals/audit_append_only.sql) (append-only).
