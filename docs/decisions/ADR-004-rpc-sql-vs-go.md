# ADR 004 — RPCs: primitivas transaccionales en PostgreSQL y lógica en Go

Estado: propuesto; no implementado.
Fecha: 2026-11-09.
Alcance: destino de las funciones SQL/RPC; complementa [ADR-002](ADR-002-baseline-postgresql-portable.md) y [ADR-003](ADR-003-aislamiento-multi-tenant.md).
Análisis completo: [`rpc-migration-matrix.md`](../database-portability/rpc-migration-matrix.md).

## Contexto

La lógica crítica de Ofirone vive en funciones `plpgsql`: venta, devolución, stock, layaway, compras, manufactura, contabilidad y colas. El inventario clasifica **265 firmas** en los tres directorios; 60 nombres están redefinidos y no hay orden de migración verificable. Muchas funciones `SECURITY DEFINER` mezclan autorización (`auth.uid()`), validación, numeración, efectos multi-tabla y consumo de lotes. La matriz ya propone una clase por firma (`M`, `G`, `X`, `E`, `T`) ([`rpc-migration-matrix.md` §2](../database-portability/rpc-migration-matrix.md#2-criterios-de-clasificación)).

## Decisión

1. **Mantener en PostgreSQL las primitivas que requieren atomicidad, locks o unicidad:** contadores (`fn_next_sale_number`), claim de jobs (`FOR UPDATE SKIP LOCKED`), consumo/reserva de lotes, posteo contable y cierres de caja. Se exponen como funciones estrechas, `SECURITY INVOKER` siempre que sea posible.
2. **Mover a Go la autorización, la orquestación y las reglas de negocio puras:** RBAC, validación de payload, cálculo de descuentos/impuestos/redondeo, transiciones de estado, plantillas, formateo y composición de varias consultas.
3. **Dividir (`X`) las operaciones que necesitan transacción pero cuya decisión es de aplicación:** Go abre la transacción, fija `app.tenant_id`, valida IDs y llama a una primitiva SQL; la primitiva no decide permisos.
4. **Eliminar (`E`) las funciones de identidad Supabase, helpers de RLS, diagnósticos y dispatchers de plataforma.** No se recrean `auth.uid()`, `auth.jwt()`, `fn_is_super_admin()`, `fn_push_dispatcher_cron()` ni `sp_audit_rls_and_optionally_apply()`.
5. **Sin `auth.*` dentro de SQL.** El tenant, el actor y el usuario se pasan como parámetros explícitos o se leen de `app.tenant_id`; nunca de claims de PostgREST.
6. **`SECURITY DEFINER` excepcional:** solo para primitivas imprescindibles, con `SET search_path = pg_catalog, public`, owner explícito, `REVOKE ALL FROM PUBLIC` y `GRANT EXECUTE` mínimo. No se usa como sustituto de autorización.
7. **Idempotencia con alcance de tenant:** toda clave de idempotencia incluye `tenant_id` y un hash de payload; no se acepta una PK global de `operation_id` que pueda devolver el resultado de otro tenant.
8. **Efectos externos fuera de la transacción:** email, push, pagos, storage e IA salen por outbox y workers Go; la función solo escribe la intención.
9. **Contratos internos explícitos:** una firma vigente por nombre; las variantes históricas se eliminan o se consolidan. No se elige por orden alfabético de archivo.

## Consecuencias

- El backend Go debe implementar casos de uso y pruebas de paridad antes de retirar una función; la matriz de caracterización es el contrato de aceptación.
- Las funciones que se conserven deben perder `auth.*` y recibir contexto; su firma cambia y los consumidores deben actualizarse en la misma entrega.
- La atomicidad no se fragmenta: una venta, devolución o compra no se parte en commits independientes.
- Los workers necesitan lease, `locked_by` y validación de tenant; el claim global actual no basta ([`ADD_ASYNC_JOB_QUEUE.sql:258-356`](../../shared/supabase/migrations/ADD_ASYNC_JOB_QUEUE.sql#L258-L356)).

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Mover todo a Go | Pierde atomicidad, locks y rendimiento set-based; duplica lógica de stock y contabilidad |
| Mantener todo en SQL | Conserva `auth.*`, `SECURITY DEFINER` sin `search_path` y lógica no testeable; contradice la portabilidad |
| Reutilizar las firmas históricas sin consolidar | 60 nombres redefinidos y variantes incompatibles; no hay versión vigente verificable |
| Exponer SQL directo a clientes | Elimina la capa de autorización y multiplica el riesgo de acceso cruzado |

## Verificación pendiente

- [ ] Fijar una definición vigente por firma y registrar procedencia/parches incorporados.
- [ ] Implementar las primitivas `X` con pruebas de concurrencia y rollback.
- [ ] Verificar que ninguna función conservada usa `auth.*`.
- [ ] Probar idempotencia por tenant y reintentos con payload alterado.
- [ ] Medir planes de las primitivas set-based antes de retirar índices históricos.
