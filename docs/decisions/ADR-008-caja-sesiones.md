# ADR 008 — Caja: sesiones, movimientos y cierre por sede

Estado: **propuesta**; no implementada. No crea tablas ni modifica el backend.
Fecha: 2026-11-09.
Alcance: caja operativa P1 (apertura, movimientos, arqueo y cierre) por
`tenant_id` + `location_id`. Complementa [ADR-003](ADR-003-aislamiento-multi-tenant.md)
y [ADR-007](ADR-007-venta-cliente.md).
Evidencia de la brecha: [`validation-p0-sell-flow-0012.txt`](../database-portability/_data/validation-p0-sell-flow-0012.txt)
(`BLOQ-P1: cierre de caja`).

## Contexto

El baseline `0001–0012` no tiene tablas de caja. `public.sales` registra la venta
y sus pagos, pero no hay forma de agruparlos en un turno, declarar el efectivo
inicial, contar el cajón ni cerrar con diferencias
([`0007_sales.up.sql:5-84`](../../database/migrations/0007_sales.up.sql#L5-L84)).
`payment_methods.method_type` ya distingue `cash`, `card`, `transfer`, `credit`
y `other` ([`0004_reference_catalog.up.sql:87-107`](../../database/migrations/0004_reference_catalog.up.sql#L87-L107)),
y `locations` tiene `UNIQUE (tenant_id, location_id)`
([`0004_reference_catalog.up.sql:4-21`](../../database/migrations/0004_reference_catalog.up.sql#L4-L21)),
que es la clave compuesta necesaria para las FK.

El esquema histórico sirve de referencia, no de baseline: tenía
`cash_registers`, `cash_sessions` y `cash_movements`
([`InitDB.sql:225-259`](../../shared/supabase/migrations/InitDB.sql#L225-L259)),
una FK `sales.cash_session_id` ([`InitDB.sql:273-289`](../../shared/supabase/migrations/InitDB.sql#L273-L289))
y unicidad de sesión abierta por caja y por usuario
([`AsignacionCajerosCaja.sql:43-49`](../../shared/supabase/migrations/AsignacionCajerosCaja.sql#L43-L49)).
El baseline nuevo omitió esas tablas; esta propuesta las recupera con FK
compuestas, RLS portable, idempotencia y arqueo detallado.

## Decisión

### 1. Ámbito: una sesión abierta por sede

La sesión pertenece a `(tenant_id, location_id)`. Para P1 se permite **una sola
sesión abierta por sede**; el cierre la libera. No se introduce
`cash_registers` todavía: el local tiene un cajón operativo.

Si el negocio necesita varios cajeros/cajones simultáneos en la misma sede, se
añadirá `cash_register_id` en una migración posterior y la unicidad pasará a
`(tenant_id, location_id, cash_register_id)`. No se simula con múltiples
sesiones abiertas sin caja física.

### 2. Modelo de datos

**`public.cash_sessions`** — cabecera y snapshot de cierre:

- `cash_session_id`, `tenant_id`, `location_id`, `status` (`open|closed`).
- `opened_by_identity_id`, `opened_at`, `opening_float`.
- `closed_by_identity_id`, `closed_at`.
- `expected_cash`, `counted_cash`, `difference`, `close_note`.
- `open_idempotency_key` (obligatoria) y `close_idempotency_key` (obligatoria al
  cerrar), únicas por tenant.
- `UNIQUE (tenant_id, cash_session_id)` para las FK compuestas hijas.
- `UNIQUE (tenant_id, location_id, open_idempotency_key)`.
- `UNIQUE (tenant_id, close_idempotency_key)` (varios `NULL` son válidos).
- FK compuesta a `locations (tenant_id, location_id) ON DELETE RESTRICT`.
- FK de identidad para apertura/cierre, `ON DELETE RESTRICT`.
- Checks de estado: abierta sin campos de cierre; cerrada con todos ellos y
  `difference = counted_cash - expected_cash`; `closed_at >= opened_at`.
- Índice único parcial `(tenant_id, location_id) WHERE status = 'open'`: la
  base, no el handler, impide dos aperturas simultáneas.

**`public.cash_movements`** — movimientos manuales del cajón (entradas, salidas
y ajustes), append-only:

- `cash_movement_id`, `tenant_id`, `cash_session_id`.
- `movement_type` (`cash_in|cash_out|adjustment`), `direction` (`in|out`),
  `amount > 0`.
- `reason` obligatoria para `cash_out` y `adjustment`.
- `source_type` (`manual|sale|refund|correction`) y `source_id` para trazabilidad
  débil (no FK polimórfica). `sale`/`refund` se usan en un ajuste o reembolso
  manual vinculado a una venta; el cobro normal en efectivo **no** crea un
  movimiento, se deriva de `sale_payments`.
- `occurred_at`, `created_by_identity_id`, `idempotency_key`.
- `UNIQUE (tenant_id, idempotency_key)`; FK compuesta a la sesión.
- Checks de coherencia tipo/dirección y de `reason`.
- **No se registran aquí las ventas en efectivo**: se derivan de
  `sale_payments` para no duplicar el importe. Un reembolso manual en efectivo
  sí es un `cash_out` con `reason`/`source_type`.

**`public.cash_session_counts`** — arqueo por denominación:

- `cash_count_id`, `tenant_id`, `cash_session_id`.
- `denomination numeric(19,6) > 0`, `quantity integer >= 0`.
- `UNIQUE (tenant_id, cash_session_id, denomination)`, FK compuesta a la sesión.
- `counted_cash` de la cabecera debe ser exactamente
  `sum(denomination * quantity)` al cerrar; se valida en el trigger de cierre.

**`public.sales.cash_session_id`** — atribución de la venta al turno:

- Columna nullable, FK compuesta `(tenant_id, cash_session_id)` a
  `cash_sessions`, `ON DELETE RESTRICT`.
- Es preferible a añadir la sesión a `sale_payments`: coincide con el modelo
  histórico, una venta pertenece a un turno y los pagos se agregan por método.
- `NULL` permite ventas sin caja (online, importación, mostrador sin turno).
- Trigger: si no es `NULL`, la sesión debe estar `open`, ser del mismo tenant y
  de la **misma `location_id`** que la venta. No se puede mover una venta fuera
  de una sesión cerrada.

### 3. Fórmula de totales

En el cierre, dentro de la misma transacción:

```text
expected_cash =
    opening_float
  + Σ sale_payments.amount        (pagos con payment_methods.method_type = 'cash'
                                   de ventas con cash_session_id = sesión)
  + Σ cash_movements.amount       (direction = 'in')
  - Σ cash_movements.amount       (direction = 'out')

counted_cash = Σ cash_session_counts.denomination * quantity
difference   = counted_cash - expected_cash
```

Se cuentan los pagos en efectivo aunque la venta esté `voided`/`returned`: el
efectivo sigue (o siguió) en el cajón hasta que se registre la salida
correspondiente. La devolución se modela como `cash_out` o como el flujo de
devolución que se defina; no se muta el snapshot de una sesión cerrada.

`difference > 0` es sobrante; `difference < 0` es faltante. No se fuerza
`expected_cash >= 0`: un ajuste o una devolución pueden dejarlo negativo, y el
cierre debe reflejarlo en vez de ocultarlo.

### 4. Máquina de estados y concurrencia

- `open → closed` es la única transición. No hay reapertura; una corrección se
  hace con una sesión nueva y un movimiento de ajuste auditado.
- El cierre hace `SELECT ... FOR UPDATE` de la sesión. Los triggers de hijos
  (`cash_movements`, `cash_session_counts`) y de ventas/pagos toman `FOR SHARE`
  de la sesión, de modo que una fila no entra después del cierre y el cierre
  espera a las inserciones en vuelo antes de sumar.
- Una sesión `closed` es inmutable: el trigger `cash_sessions_guard` rechaza
  `UPDATE` y `DELETE`, impide insertar una sesión ya cerrada y también bloquea
  cambios de tenant, sede, apertura, `opened_at` o `opening_float`.
- El cierre recalcula `expected_cash` con
  `app_private.cash_session_expected_cash(tenant, session)`, valida el arqueo y
  congela `expected_cash`, `counted_cash`, `difference`, `closed_at` y
  `closed_by_identity_id`.
- Los triggers de `sales` y `sale_payments` impiden atribuir una venta o cobrar
  un pago contra una sesión ya cerrada.

### 5. Idempotencia

| Operación | Clave | Reintento |
|---|---|---|
| Abrir | `open_idempotency_key` única por `(tenant, location)` | devuelve la misma sesión si el payload coincide; `409` si difiere |
| Mover | `idempotency_key` única por tenant | devuelve el mismo movimiento; `409` si el payload difiere |
| Cerrar | `close_idempotency_key` única por tenant | si ya está cerrada con la misma clave, devuelve el snapshot; otra clave, `409` |

La unicidad de la base es la última defensa; el handler compara el payload
normalizado (tipo, importe, sesión) para distinguir replay de conflicto. No se
usa `ON CONFLICT DO NOTHING` sin recuperar la fila: el cliente necesita el
mismo `cash_session_id`/`cash_movement_id`.

### 6. RLS y permisos

Las tres tablas nuevas llevan `ENABLE ROW LEVEL SECURITY` + `FORCE`, política
`tenant_isolation` con `app_private.current_tenant_id()` y `WITH CHECK`, y
`REVOKE ALL ON ... FROM PUBLIC`. No se usan `auth.uid()` ni claims de Supabase.

Políticas por operación, no `FOR ALL`:

- `cash_sessions`: `SELECT`, `INSERT`, `UPDATE`; sin `DELETE`.
- `cash_movements`: `SELECT`, `INSERT`; sin `UPDATE`/`DELETE` (append-only).
- `cash_session_counts`: `SELECT`, `INSERT`, `DELETE` (recuento antes del cierre);
  el trigger bloquea el `DELETE` después del cierre.

La RLS aísla por tenant, no por sede. El RBAC y el alcance por sede viven en Go:

| Permiso | Uso |
|---|---|
| `cash.session.open` | abrir turno |
| `cash.session.read` | consultar sesión/totales |
| `cash.session.count` | registrar arqueo |
| `cash.session.close` | cerrar y congelar totales |
| `cash.movement.create` | entradas/salidas ordinarias |
| `cash.adjustment.create` | ajustes con motivo (supervisor) |
| `cash.report.read` | reportes de cierre |

El cajero solo debe operar la sede asignada; `supervisor` puede ajustar y
cerrar; `auditor` solo lee. La tabla de permisos actual no modela sede, por lo
que el handler compara `session.location_id` con las sedes permitidas de la
membresía. Se documenta como limitación, no se resuelve con RLS de sede en P1.

Grants propuestos para `ofirone_api` (comentados en el SQL, porque el rol aún no
existe): `SELECT/INSERT` en sesiones y movimientos, `UPDATE` en sesiones (el
trigger limita columnas/estado), `SELECT/INSERT/DELETE` en counts, y `EXECUTE`
de `app_private.cash_session_expected_cash`. `audit_log` ya está en el contrato
del rol API.

### 7. Auditoría

El handler escribe `audit_log` en la misma transacción:

- `cash.session.opened` (sesión, sede, opening_float).
- `cash.session.counted` (sesión, total contado; sin denominaciones si se
  consideran sensibles).
- `cash.session.closed` (expected, counted, difference).
- `cash.movement.created` (tipo, dirección, importe, motivo).
- `cash.adjustment.created` (autorizante y motivo).

No se guardan nombres de clientes ni datos personales en `metadata`.

## Migración propuesta (0015)

> Nota: `0014` queda reservado para la propuesta ADR-007 (cliente); caja se renumera a `0015`.

Archivos del track Go, **no creados en `database/migrations/`**:
`0015_cash_sessions.up.sql` y `.down.sql`. El runner aplica cada archivo en una
transacción; no incluir `BEGIN`/`COMMIT`.

### `up`

1. Crear `cash_sessions`.
2. Crear `cash_movements` y `cash_session_counts`.
3. Añadir `sales.cash_session_id` + FK compuesta + índice parcial.
4. Crear `app_private.cash_session_expected_cash`.
5. Crear triggers `cash_sessions_guard`, `cash_requires_open_session`,
   `sales_cash_session_guard`, `sale_payment_cash_session_guard`.
6. Habilitar RLS/FORCE y crear políticas; revocar `PUBLIC`.
7. Comentarios de tabla/columna.

No hay backfill: las ventas existentes quedan con `cash_session_id = NULL` y
las sesiones históricas no se reconstruyen. Si se importan sesiones legacy, se
hace en el runbook de datos conservando UUID y mapeando usuarios a identidades;
no se inventan totales ni arqueos. El trigger de inserción solo admite sesiones
`open`: una carga de sesiones históricas cerradas debe ejecutarse como migrador
con el trigger deshabilitado o antes de crearlo, nunca a través de la API.

### `down`

```sql
DROP TRIGGER IF EXISTS sale_payment_cash_session_guard ON public.sale_payments;
DROP TRIGGER IF EXISTS sales_cash_session_guard ON public.sales;
DROP FUNCTION IF EXISTS app_private.sale_payment_cash_session_guard();
DROP FUNCTION IF EXISTS app_private.sales_cash_session_guard();

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cash_session_fk;
DROP INDEX IF EXISTS public.sales_cash_session_idx;
ALTER TABLE public.sales DROP COLUMN IF EXISTS cash_session_id;

DROP TABLE IF EXISTS public.cash_session_counts;
DROP TABLE IF EXISTS public.cash_movements;
DROP TABLE IF EXISTS public.cash_sessions;

DROP FUNCTION IF EXISTS app_private.cash_sessions_guard();
DROP FUNCTION IF EXISTS app_private.cash_requires_open_session();
DROP FUNCTION IF EXISTS app_private.cash_session_expected_cash(uuid, uuid);
```

Orden obligatorio: `0015 down` antes de `0014 down` (ADR-007). El `down` borra
historia financiera; exportar sesiones, movimientos y arqueos antes de
ejecutarlo en una base con datos. En base desechable, `up → down → up` debe
dejar cero objetos residuales.

## Contratos de API (sin implementar handlers)

| Método/ruta | Entrada | Salida/errores |
|---|---|---|
| `POST /cash-sessions` | `location_id`, `opening_float`, `idempotency_key` | `201` sesión; `409` ya hay una abierta; `422` sede inválida |
| `GET /cash-sessions?location_id=&status=` | filtros + keyset `(opened_at, cash_session_id)` | lista; `has_more` |
| `GET /cash-sessions/{id}` | — | cabecera, totales y movimientos; `404` si es de otro tenant |
| `POST /cash-sessions/{id}/movements` | `movement_type`, `amount`, `reason?`, `idempotency_key` | `201` movimiento; `409` sesión cerrada/duplicado; `422` importe/motivo |
| `POST /cash-sessions/{id}/counts` | lista `{denomination, quantity}` | `204`/`201`; reemplaza el arqueo mientras está abierta |
| `POST /cash-sessions/{id}/close` | `close_idempotency_key`, `note?` | `200` snapshot con expected/counted/difference; `409` ya cerrada con otra clave |
| `POST /sales` | `cash_session_id?` | `422` sesión cerrada o de otra sede; `201` venta |

El servidor calcula `expected_cash`, `counted_cash` y `difference`; el cliente no
los envía. `counted_cash` se deriva de los counts; si se acepta un total sin
desglose, debe quedar como una única denominación o rechazarse según la política
de arqueo. Todos los importes son `numeric`, no `float`.

## Pruebas P0/P1 a añadir

Base desechable, dos tenants, rol `NOBYPASSRLS`, datos sintéticos.

| ID | Caso | Resultado esperado |
|---|---|---|
| P1-CS-01 | Abrir sesión A/MAIN | `open`, `opening_float` correcto |
| P1-CS-02 | Segunda apertura A/MAIN | `23505`/`409`; sigue una sola abierta |
| P1-CS-03 | Apertura A/MAIN2 y B/MAIN | permitidas; RLS no mezcla |
| P1-CS-04 | Movimiento `cash_in`/`cash_out` | afecta `expected_cash` con el signo correcto |
| P1-CS-05 | Replay de movimiento con misma clave | mismo `cash_movement_id`; sin duplicado |
| P1-CS-06 | Venta con pago cash en sesión | suma al expected; pago card no suma |
| P1-CS-07 | Venta con `cash_session_id` de otra sede | `23514`/`23503`; rechazada |
| P1-CS-08 | Cierre con arqueo | `difference = counted - expected`; snapshot correcto |
| P1-CS-09 | Replay de cierre misma clave | `200` mismo snapshot; otra clave `409` |
| P1-CS-10 | Movimiento/venta/pago tras cierre | rechazado; no altera snapshot |
| P1-CS-11 | `DELETE` de sesión cerrada | rechazado |
| P1-CS-12 | Arqueo que no suma `counted_cash` | `23514`; cierre no confirmado |
| P1-CS-13 | Cross-tenant: A abre/mueve/cierra sesión B | `42501`/`23503`; sin filas |
| P1-CS-14 | RLS: A lista sesiones/movimientos B | 0 filas |
| P1-CS-15 | Carrera de dos aperturas concurrentes | una gana; la otra `23505` |
| P1-CS-16 | `EXPLAIN` de sesión/movimientos | usa índices por tenant/sesión/fecha |
| P1-CS-17 | `up → down → up` | sin tablas/triggers/funciones residuales |
| P1-CS-18 | Permisos de rol API | sin `DELETE` en sesiones ni `UPDATE` en movimientos |
| P1-CS-19 | `INSERT` directo de sesión `closed` | `23514`; solo se abre en `open` |

## Riesgos

- **Una caja por sede**: si dos cajeros necesitan cajones separados, P1 no lo
  soporta; se resuelve con `cash_register_id` en migración posterior.
- **Sesión cerrada vs. operaciones tardías**: ventas/pagos/movimientos tardíos
  se rechazan; la corrección se hace con una sesión nueva y ajuste auditado.
- **Devoluciones**: no hay tabla de devoluciones en `0001–0012`; el reembolso en
  efectivo se modela como `cash_out`. Si se añade un flujo de devoluciones, debe
  escribir su movimiento en la misma transacción.
- **Totales no-cash**: no se congelan en `cash_sessions`; el cierre los calcula
  desde `sale_payments` por método. Si se requiere snapshot exacto de tarjeta/
  transferencia, añadir una tabla de totales por método o un `jsonb` validado.
- **Zona horaria**: `timestamptz` guarda el instante; el “cierre del día” depende
  de la zona del tenant/sede, que hoy no está en el esquema. El reporte debe
  recibir la zona explícita; no usar `date_trunc` sin zona.
- **Índices en caliente**: `CREATE INDEX` normal bloquea escrituras; en tablas
  grandes evaluar `CONCURRENTLY` fuera de la transacción del runner.
- **Triggers**: agregan coste por fila y lógica PL/pgSQL; probar concurrencia y
  `FOR SHARE`/`FOR UPDATE` con dos sesiones reales.
- **Idempotencia**: la base solo garantiza unicidad; la comparación de payload
  es responsabilidad del handler. Un key reutilizado con otro importe debe ser
  `409`, no un replay silencioso.

## Alternativas consideradas

| Alternativa | Motivo |
|---|---|
| Copiar `cash_registers` del esquema viejo | Añade una entidad sin requisito P1; se pospone |
| Sesión por usuario en la misma sede | Varias cajas físicas sin registro; totales ambiguos |
| `cash_session_id` en `sale_payments` | Una venta puede tener varios pagos; la sesión es de la venta, no del pago |
| Registrar ventas cash también en `cash_movements` | Duplica importes y descuadra el expected |
| Guardar solo `counted_cash` sin desglose | No hay arqueo auditable ni validación por denominación |
| Reabrir sesión cerrada | Rompe el snapshot financiero y la auditoría |
| RLS por sede | El RBAC actual no modela sedes; se aplica en Go y se documenta |

## Consecuencias

- El flujo P0/P1 puede abrir turno, vender contra la sesión, contar el cajón y
  cerrar con diferencia explicable.
- La base impide dos aperturas en la misma sede, movimientos posteriores al
  cierre y referencias cross-tenant.
- El cierre es un snapshot inmutable; los reportes históricos no cambian si se
  edita una venta posterior.
- Queda pendiente el alcance por sede en RBAC y el snapshot de medios no-cash.

## Referencias

- [`0007_sales.up.sql`](../../database/migrations/0007_sales.up.sql) (`sales`, pagos, RLS).
- [`0004_reference_catalog.up.sql`](../../database/migrations/0004_reference_catalog.up.sql) (`locations`, `payment_methods`).
- [`0001_core.up.sql`](../../database/migrations/0001_core.up.sql) (`current_tenant_id`, `set_updated_at`).
- [`InitDB.sql:225-289`](../../shared/supabase/migrations/InitDB.sql#L225-L289) (referencia histórica).
- [`AsignacionCajerosCaja.sql:43-49`](../../shared/supabase/migrations/AsignacionCajerosCaja.sql#L43-L49).
- Boceto SQL: [`proposals/cash_sessions.sql`](../database-portability/_data/contracts/proposals/cash_sessions.sql).
- [ADR-003](ADR-003-aislamiento-multi-tenant.md), [ADR-007](ADR-007-venta-cliente.md).
