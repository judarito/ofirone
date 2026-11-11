# ADR 007 — Venta atribuida a cliente (`sales.customer_id`)

Estado: **propuesta**; no implementada. No modifica migraciones, backend ni API.
Fecha: 2026-11-09.
Alcance: enlazar una venta con un cliente del mismo tenant. Complementa
[ADR-003](ADR-003-aislamiento-multi-tenant.md) (FK compuestas/RLS) y
[ADR-008](ADR-008-caja-sesiones.md) (cierre de caja).
Evidencia de la brecha: [`validation-p0-sell-flow-0012.txt`](../database-portability/_data/validation-p0-sell-flow-0012.txt).

## Contexto

`public.sales` define la venta y su tenant, pero **no tiene `customer_id`**
([`0007_sales.up.sql:5-33`](../../database/migrations/0007_sales.up.sql#L5-L33)).
Por eso una venta P0 se registra, cobra y descuenta inventario, pero no puede
atribuirse a un cliente. `public.customers` sí expone la clave compuesta
necesaria para una FK segura: `UNIQUE (tenant_id, customer_id)`
([`0008_parties.up.sql:31-45`](../../database/migrations/0008_parties.up.sql#L31-L45)).
La política RLS de `sales` ya es `tenant_id = app_private.current_tenant_id()`
con `FORCE` ([`0007_sales.up.sql:86-98`](../../database/migrations/0007_sales.up.sql#L86-L98)).

Dato relevante para el backfill: el esquema histórico **sí** tenía
`sales.customer_id` ([`InitDB.sql:281`](../../shared/supabase/migrations/InitDB.sql#L281)),
luego reapuntado a `third_parties` con `ON DELETE SET NULL`
([`FIX_CUSTOMER_FK_TO_THIRD_PARTIES.sql:17-28`](../../shared/supabase/migrations/FIX_CUSTOMER_FK_TO_THIRD_PARTIES.sql#L17-L28)).
La migración histórica conservó el UUID del cliente como `third_party_id`
([`MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql:1-10`](../../shared/supabase/migrations/MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql#L1-L10)).
En el baseline nuevo, `customers.third_party_id` permite reconstruir el enlace
durante la importación, aunque el `customer_id` nuevo sea otro UUID.

## Problema

Una venta debe poder ser:

- anónima o de mostrador (sin cliente);
- atribuida a un cliente existente del **mismo tenant**;
- consultada por cliente y por rango de fecha sin fuga cross-tenant;
- corregida sin romper la inmutabilidad de una venta cerrada.

La solución no puede aceptar un `customer_id` de otro tenant ni obligar a crear
un “cliente genérico” artificial que contamine cartera, crédito y reportes.

## Opciones

### A. Columna nullable + FK compuesta (recomendada)

```sql
ALTER TABLE public.sales ADD COLUMN customer_id uuid;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_customer_fk
  FOREIGN KEY (tenant_id, customer_id)
  REFERENCES public.customers (tenant_id, customer_id)
  ON DELETE RESTRICT;
```

`MATCH SIMPLE` (default) hace que `customer_id IS NULL` no dispare la FK; con
`customer_id` no nulo, el par `(tenant_id, customer_id)` debe existir. La RLS de
`sales` no cambia: el tenant sigue siendo la frontera de fila.

Ventajas: relación 1:0..1 natural para POS; sin joins adicionales para listar
ventas; la FK compuesta impide cruzar tenants; backfill puede quedar en `NULL`
sin inventar datos; índice parcial pequeño.

Coste: una venta no puede tener varios clientes (no es el caso P0).

### B. Tabla puente `sale_customers`

Permite N clientes por venta (split de facturación, comisión, etc.), con
`tenant_id`, `sale_id`, `customer_id`, rol/porcentaje y un índice único parcial
para el principal. Es la opción correcta si el negocio confirma ventas
multi-cliente.

Coste: join en todo listado/detalle, RLS y grants adicionales, backfill de la
tabla, y la obligación de definir qué cliente es “principal”. Para P0 no hay
requisito que lo justifique.

### C. `customer_id` con FK simple a `customers(customer_id)`

Rechazada: PostgreSQL aceptaría un cliente de otro tenant. La RLS oculta filas,
pero no impide el enlace; se depende de que todo handler recuerde validar. Viola
[ADR-003](ADR-003-aislamiento-multi-tenant.md).

### D. FK directa a `third_parties`

Rechazada como enlace principal: conserva la forma histórica y sirve al receptor
fiscal, pero `customers` es el sujeto de crédito/cartera; enlazar a
`third_parties` obligaría a filtrar `is_customer` y duplicaría la validación.
Si más adelante se requiere el receptor fiscal distinto del cliente, se añade
`third_party_id` como columna separada, no se reemplaza `customer_id`.

## Decisión

1. Añadir **`sales.customer_id uuid NULL`** con FK compuesta
   `(tenant_id, customer_id) → customers (tenant_id, customer_id)`
   `ON DELETE RESTRICT`.
2. `NULL` significa venta anónima/de mostrador. La API la presenta como
   “Consumidor final” **sin crear una fila sintética** en `customers`.
3. Índice parcial por cliente y fecha:
   `(tenant_id, customer_id, sold_at DESC, sale_id DESC) WHERE customer_id IS NOT NULL`.
4. Mantener `FORCE ROW LEVEL SECURITY` y la política `tenant_isolation` de
   `sales`; la FK compuesta es la defensa contra referencias cross-tenant.
5. La atribución se fija al crear la venta o mientras esté en `draft`. Cambiar
   el cliente de una venta `completed` exige permiso explícito y evento de
   auditoría; no se hará con un `UPDATE` genérico.
6. No se reescriben ventas históricas por heurística (nombre, documento, email).

## Migración propuesta (0014)

> Nota: `0013` ya está ocupado por `sale_idempotency` en el track Go; esta propuesta se renumera a `0014`.

Archivos del track Go, **no creados en `database/migrations/`**:
`0014_sales_customer_link.up.sql` y `.down.sql`. El runner aplica cada archivo
en una transacción; no incluir `BEGIN`/`COMMIT` (convención de `0007`–`0012`).

### `up`

```sql
ALTER TABLE public.sales ADD COLUMN customer_id uuid;

-- NOT VALID evita validar todas las filas bajo un lock más fuerte; como la
-- columna es nueva y todas las filas son NULL, VALIDATE es barato.
ALTER TABLE public.sales
  ADD CONSTRAINT sales_customer_fk
  FOREIGN KEY (tenant_id, customer_id)
  REFERENCES public.customers (tenant_id, customer_id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.sales VALIDATE CONSTRAINT sales_customer_fk;

CREATE INDEX sales_customer_page_idx
  ON public.sales (tenant_id, customer_id, sold_at DESC, sale_id DESC)
  WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.sales.customer_id IS
  'Cliente de la venta; NULL = venta anónima. FK compuesta por tenant.';
```

No se añade `DEFAULT`, no se rellena y no se cambia la política RLS existente.
La columna es metadata-only en PostgreSQL 15.

### `down`

```sql
DROP INDEX IF EXISTS public.sales_customer_page_idx;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_customer_fk;
ALTER TABLE public.sales DROP COLUMN IF EXISTS customer_id;
```

`down` es **destructivo para la atribución ya escrita**. Antes de ejecutarlo en
una base con datos: exportar `(tenant_id, sale_id, customer_id, sold_at)` y
confirmar que no hay consumidores que dependan del filtro. En una base
desechable el ciclo `up → down → up` debe dejar cero objetos residuales.

## Backfill de ventas existentes

En el baseline `0001–0012` todas las ventas existentes quedan con
`customer_id = NULL`; es un resultado válido y no requiere `UPDATE`.

Para una importación histórica:

1. Importar clientes y conservar la correspondencia
   `legacy_customer_uuid → customers.customer_id` en una tabla de staging
   temporal, fuera de la migración.
2. Mapear `legacy sales.customer_id` (que en el esquema viejo es el UUID de
   `third_parties` tras el `FIX_*`) contra `customers.third_party_id` **del
   mismo tenant**.
3. Actualizar solo coincidencias únicas y dejar `NULL` las no resueltas.
4. Reportar por tenant: ventas totales, enlazadas, no resueltas y duplicados de
   mapeo. No crear clientes automáticamente.

Esqueleto (staging, nunca datos reales en el repo):

```sql
CREATE TEMP TABLE legacy_sale_customer_map (
  tenant_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  legacy_customer_id uuid NOT NULL
) ON COMMIT DROP;

UPDATE public.sales s
SET customer_id = c.customer_id
FROM legacy_sale_customer_map m
JOIN public.customers c
  ON c.tenant_id = m.tenant_id
 AND c.third_party_id = m.legacy_customer_id
WHERE s.tenant_id = m.tenant_id
  AND s.sale_id = m.sale_id
  AND s.customer_id IS NULL;

-- Debe devolver 0: ningún customer_id apunta fuera de su tenant o a un cliente inexistente.
SELECT count(*) AS orphan_links
FROM public.sales s
LEFT JOIN public.customers c
  ON c.tenant_id = s.tenant_id AND c.customer_id = s.customer_id
WHERE s.customer_id IS NOT NULL AND c.customer_id IS NULL;
```

Si el mapeo legacy es ambiguo, la venta queda anónima y se documenta; no se
elige el “primer” cliente.

## RLS e impacto multi-tenant

- `sales` conserva `ENABLE` + `FORCE` y `tenant_isolation`; no se crea una
  política nueva.
- La FK `(tenant_id, customer_id)` impide que una venta del tenant A referencie
  un cliente del tenant B. El intento debe fallar con `23503`, incluso si el rol
  tiene `BYPASSRLS`.
- Un `SELECT` de ventas filtrado por un `customer_id` ajeno devuelve 0 filas por
  RLS (no `404` con existencia). La API no debe revelar si el UUID existe.
- El rol de runtime no necesita `UPDATE` sobre `customers` para enlazar una
  venta; solo `SELECT` para validar y `INSERT/UPDATE` sobre `sales` según el
  caso de uso.
- `ON DELETE RESTRICT` protege la historia: un cliente con ventas no se borra
  físicamente. La baja funcional se hace con `third_parties.is_active = false`.

## Índices y constraints

| Objeto | Definición | Uso |
|---|---|---|
| `sales_customer_fk` | FK compuesta, `ON DELETE RESTRICT` | integridad tenant/cliente |
| `sales_customer_page_idx` | `(tenant_id, customer_id, sold_at DESC, sale_id DESC) WHERE customer_id IS NOT NULL` | historial por cliente y keyset |
| `sales_page_idx` (existente) | `(tenant_id, sold_at DESC, sale_id DESC)` | listado general |
| `customers_page_idx` (existente) | `(tenant_id, created_at DESC, customer_id DESC)` | selector de clientes |

No se indexa `customer_id` solo: siempre va precedido de `tenant_id`. El índice
parcial evita mantener entradas para ventas anónimas.

## Contratos de API (sin implementar handlers)

- `POST /sales` acepta `customer_id` **opcional** (UUID). El tenant y la
  identidad salen del contexto autenticado, nunca del body.
- `GET /sales` acepta `customer_id` opcional y mantiene el keyset
  `(sold_at, sale_id)`; el filtro se combina con `tenant_id`.
- `GET /sales/{id}` devuelve `customer_id` y, si existe, un resumen del cliente
  (`customer_id`, nombre, documento enmascarado según permisos).
- `PATCH /sales/{id}` solo permite cambiar `customer_id` en `draft`, o en
  `completed` con permiso `sales.customer.correct` y auditoría
  `sale.customer_changed`.
- Errores: `422 customer_not_found`/`customer_inactive`; un UUID de otro tenant
  se trata como no encontrado (`404`/`422`, nunca `403` que confirme existencia);
  `23503` de la FK se traduce a error de validación, no a `500`.
- La respuesta de creación incluye `customer_id` aunque sea `null`; no se rompe
  el contrato actual de venta.

## Pruebas P0 a añadir

Ejecutar en base desechable con rol `NOBYPASSRLS` y dos tenants sintéticos.

| ID | Caso | Resultado esperado |
|---|---|---|
| P0-SC-01 | Venta con cliente del mismo tenant | fila persistida, `customer_id` legible |
| P0-SC-02 | Venta sin cliente | `NULL` aceptado; API lo presenta como anónimo |
| P0-SC-03 | Venta con cliente del tenant B | `23503`; no queda venta ni línea |
| P0-SC-04 | `customer_id` inexistente | `23503`; rollback |
| P0-SC-05 | RLS: A lista ventas filtrando cliente B | 0 filas; sin error de existencia |
| P0-SC-06 | `DELETE` de cliente con ventas | `23503` (RESTRICT) |
| P0-SC-07 | 120 ventas del mismo cliente, keyset | sin duplicados ni omisiones entre páginas |
| P0-SC-08 | `EXPLAIN` del historial por cliente | usa `sales_customer_page_idx` (o índice equivalente) |
| P0-SC-09 | Backfill/import | `enlazadas + null = total`; `orphan_links = 0` |
| P0-SC-10 | `up → down → up` | sin columna/FK/índice residual tras `down` |
| P0-SC-11 | Cambio en `completed` | rechazado sin permiso; auditado con permiso |
| P0-SC-12 | Mapeo legacy cross-tenant | no enlaza; queda `NULL` y se reporta |

## Riesgos

- **Pérdida de atribución histórica** si se ejecuta `down` o si el mapeo legacy
  no es único; mitigar con export y reporte de no resueltos.
- **Cliente “genérico”**: crearlo para ventas anónimas contamina cartera,
  crédito y conteos. Se evita deliberadamente.
- **Datos personales**: el resumen de cliente en la venta debe respetar permisos
  y enmascarar documento/email; no se guarda PII duplicada en `sales`.
- **Crecimiento del índice parcial** en tenants con muchas ventas nominadas;
  vigilar con `pg_stat_user_indexes`.
- **Bloqueo de escritura** al crear el índice en caliente. En una tabla grande,
  evaluar `CREATE INDEX CONCURRENTLY` fuera de la transacción del runner; el
  `up` propuesto usa índice normal por simplicidad.
- **Multi-cliente/facturación dividida** no soportada; si aparece, migrar a la
  opción B con una migración posterior, no añadir más columnas ad hoc.

## Consecuencias

- El flujo P0 puede responder “venta de qué cliente” sin cambiar el modelo de
  líneas, pagos ni inventario.
- `sales.customer_id` queda como única fuente de atribución; cartera y
  apartados siguen usando `customer_id` propio.
- Los reportes por cliente pueden usar el índice parcial y el keyset existente.
- La importación histórica requiere staging y reporte, no un `UPDATE` ciego.

## Alternativas descartadas (resumen)

| Alternativa | Motivo |
|---|---|
| `sale_customers` ahora | Complejidad y joins sin requisito P0; se reserva para multi-cliente |
| FK simple a `customers(customer_id)` | Permite referencias cross-tenant |
| FK a `third_parties` | No es el sujeto de crédito/cartera; duplica validación |
| Cliente “consumidor final” por tenant | Contamina métricas y cartera; oculta ventas anónimas reales |
| Backfill por nombre/documento | Falsos positivos y PII; no determinista |

## Referencias

- [`0007_sales.up.sql`](../../database/migrations/0007_sales.up.sql) (tabla, índices, RLS).
- [`0008_parties.up.sql`](../../database/migrations/0008_parties.up.sql) (`customers`, FK compuesta).
- [`validation-p0-sell-flow-0012.txt`](../database-portability/_data/validation-p0-sell-flow-0012.txt).
- [`contracts/README.md`](../database-portability/_data/contracts/README.md).
- Boceto SQL: [`proposals/sales_customer_link.sql`](../database-portability/_data/contracts/proposals/sales_customer_link.sql).
- [ADR-003](ADR-003-aislamiento-multi-tenant.md), [ADR-008](ADR-008-caja-sesiones.md).
