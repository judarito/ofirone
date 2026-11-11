# Fase 0 — Hallazgos iniciales de portabilidad

Fecha: 2026-11-08

Este documento resume el análisis estático ejecutado por agentes paralelos. No reemplaza la validación contra las bases DEV/PROD.

## Inventario estimado

- 189 archivos SQL físicos distintos.
- 116 nombres de tablas.
- 256 nombres de funciones detectadas.
- 46 vistas.
- 39 archivos con referencias a `auth.*`.
- 45 archivos con RLS o políticas.
- 59 archivos con `SECURITY DEFINER`.
- 161 archivos en `shared/supabase/migrations/`.

Estos números incluyen historial y redefiniciones; no representan necesariamente el esquema desplegado.

## Bloqueadores P0

### Identidad y autorización

Las políticas y funciones dependen de `auth.uid()`, `auth.role()`, `auth.jwt()` y `request.jwt.claims`. Go/PostgreSQL estándar necesitarán un modelo explícito de usuarios, sesiones, membresías, roles, permisos y contexto de tenant.

Debe revisarse especialmente la lógica de superadministrador antes de migrar perfiles.

### Baseline de esquema

No se debe ejecutar todo el directorio de migraciones por orden de nombre. Conviven baseline, parches, diagnósticos y redefiniciones históricas; existe al menos una migración destructiva de terceros.

Siguiente acción: construir un baseline nuevo y versionado, sin modificar las migraciones históricas.

### Operaciones transaccionales

Las siguientes familias deben conservar atomicidad e idempotencia:

- Ventas y devoluciones.
- Compras y devoluciones.
- Aplicación y consumo de stock.
- Manufactura.
- Contabilidad.
- Claim/complete/fail de jobs.

`FOR UPDATE SKIP LOCKED` es PostgreSQL estándar y puede conservarse.

## Dependencias Supabase a reemplazar

- Auth y Auth Admin.
- Storage y políticas sobre `storage.objects`.
- Realtime `postgres_changes`.
- `pg_cron`, `pg_net` y `vault` cuando estén presentes.
- REST `/rest/v1`, RPC `/rest/v1/rpc` y `/auth/v1/user`.
- Edge Functions.

## Paginación prioritaria

Problemas identificados:

- Offset sin desempate único.
- `limit` sin cursor de continuación.
- Listados completos paginados solo en memoria.
- Filtros móviles aplicados después de paginar.
- Sincronización incremental basada solo en timestamp sin desempate por ID.
- Reportes que podrían sumar únicamente la página cargada.

Regla para la nueva API: cualquier colección debe tener filtros server-side, orden estable con clave única, límite máximo y `next_cursor`/`has_more` o `page/total` según el caso.

## RPCs críticas para caracterización

Antes de mover lógica a Go, capturar comportamiento, parámetros, retornos y efectos de:

- `sp_create_sale` y variantes idempotentes.
- `sp_create_return_v2`.
- `sp_create_purchase`.
- `sp_receive_purchase_order_partial`.
- `sp_create_purchase_return`.
- `fn_apply_stock_delta`.
- `fn_allocate_stock_fefo`.
- `fn_consume_batch_stock`.
- `fn_consume_bom_components`.
- `fn_complete_production`.
- `fn_accounting_post_entry`.
- `fn_accounting_process_queue`.
- `fn_claim_async_jobs`.
- `fn_complete_async_job`.
- `fn_fail_async_job`.

## Próximas acciones aprobadas

- [ ] Obtener acceso DEV con usuario de solo lectura.
- [ ] Obtener acceso PROD con usuario de solo lectura.
- [ ] Ejecutar inventario contra esquema desplegado.
- [ ] Comparar esquema DEV vs PROD.
- [ ] Definir baseline portable.
- [ ] Definir modelo de identidad portable.
- [ ] Definir contrato de paginación.
- [ ] Caracterizar RPCs críticas antes de reescribirlas.
