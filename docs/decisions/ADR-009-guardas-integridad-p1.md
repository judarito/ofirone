# ADR 009 — Guardas de integridad P1 (compras, CxP y apartado→venta)

- **Estado:** propuesta; no implementada en `database/migrations`.
- **Fecha:** 2026-11-09.
- **Alcance:** cerrar los hallazgos de la suite P1 sin cambiar el esquema productivo.
- **Boceto SQL:** [`proposals/p1_integrity_guards.sql`](../database-portability/_data/contracts/proposals/p1_integrity_guards.sql).
- **Evidencia de la brecha:** [`validation-p1-lifecycle-0012.txt`](../database-portability/_data/validation-p1-lifecycle-0012.txt).
- **Propuesta validada:** [`validation-p1-guards-proposal.txt`](../database-portability/_data/validation-p1-guards-proposal.txt) (PASS en base desechable).

## Contexto

La suite P1 detectó tres problemas:

1. `purchases.status` admite cualquier transición (`received → draft` fue aceptada).
2. Un pago de CxP puede exceder el saldo: `supplier_payables` valida `paid_amount`, pero no la suma de `supplier_payable_payments`.
3. No existe enlace entre un apartado y la venta que lo convierte.

## Decisión

- **Compras:** trigger `BEFORE UPDATE OF status` con matriz `draft → ordered → partially_received → received → returned` (o `cancelled` desde estados abiertos). Rechaza saltos/retrocesos con `23514`.
- **CxP:** trigger `BEFORE INSERT/UPDATE` que suma los pagos existentes + el nuevo y rechaza si supera `original_amount`; trigger `AFTER` que sincroniza `paid_amount` y `status` (`open/partially_paid/paid`) para que no dependa del cliente. Un pago duplicado/sobrepago se rechaza (`23514`); la cuenta bloquea la fila durante el cálculo.
- **Apartado→venta:** `sales.layaway_contract_id uuid NULL` con FK compuesta `(tenant_id, layaway_contract_id) → layaway_contracts(tenant_id, layaway_id)` y unique parcial `(tenant_id, layaway_contract_id) WHERE NOT NULL` (una venta por apartado). `NULL` = venta normal.

## Consecuencias

- La lógica de negocio deja de depender solo de la aplicación; las garantías quedan en la base.
- Riesgo: los triggers de sincronización de CxP pueden chocar con procesos que ya actualizan `paid_amount` manualmente; migrar con feature flag y pruebas.
- Riesgo: conversión parcial/múltiple del mismo apartado queda prohibida por el unique; si se requiere, cambiar a tabla puente.
- `down` documentado en el SQL; exportar conversiones antes.

## Pruebas propuestas

1. Compra `draft→ordered→partially_received→received` PASS; `received→draft` `23514`.
2. CxP: pagos 80+20=100 PASS; 80+30 `23514`; `paid_amount/status` sincronizados.
3. Venta con apartado A PASS; apartado de otro tenant `23503`; segunda venta del mismo apartado `23505`.
4. `up/down/up` y RLS de `sales` sin cambios.
