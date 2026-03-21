# Estado de Implementacion de Billing por Tenant

Fecha: 2026-03-21
Proyecto: POSLite Mobile / OfirOne
Estado: Primera base SQL implementada

## Alcance de esta modificacion

Se implemento la primera base SQL del dominio de billing multi-tenant en:

- `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`

Apoyos SQL existentes reutilizados por esta implementacion:

- `migrations/InitPermissions.sql`
- `migrations/RLS_Security.sql`
- `migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql`

Esta modificacion no mezcla billing con `tenant_settings` ni altera estructuralmente `tenants` o `users`.

## Que se agrego

### Catalogo comercial

- `billing_plans`
- `billing_plan_prices`
- `billing_plan_features`
- `billing_plan_limits`

### Estado comercial por tenant

- `tenant_subscriptions`
- `tenant_subscription_periods`
- `tenant_subscription_events`

### Cobro y renovacion

- `tenant_invoices`
- `tenant_payments`
- `tenant_payment_methods`

### Resumen operativo

- vista `tenant_billing_summary`
- funcion `fn_get_my_tenant_billing_summary()`

## Seguridad aplicada

La migracion ya incluye hardening para Supabase:

- RLS habilitado en tablas tenant-scoped
- aislamiento por `tenant_id` con `get_current_user_tenant_id()`
- catalogo de planes en solo lectura para usuarios autenticados
- tablas comerciales crudas restringidas a usuarios con `has_permission('SETTINGS.TENANT.MANAGE')`
- acceso recomendado al estado comercial via `fn_get_my_tenant_billing_summary()`
- revocacion de acceso a `anon/public` sobre las nuevas tablas y la vista

Referencias SQL de seguridad:

- `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`
  Aqui viven las policies RLS nuevas del dominio billing, los `revoke/grant`, la vista `tenant_billing_summary` y la funcion `fn_get_my_tenant_billing_summary()`.
- `migrations/RLS_Security.sql`
  De aqui se reutiliza el helper `get_current_user_tenant_id()` y el patron de permisos con `has_permission(...)`.
- `migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql`
  De aqui se toma como referencia el estilo de funciones `security definer` y el helper `get_current_user_app_user_id()` ya presente en el proyecto.

## Idempotencia

El script fue armado para re-ejecucion segura:

- `create table if not exists`
- `create index if not exists`
- `create extension if not exists`
- `create or replace function`
- `create or replace view`
- `drop trigger if exists`
- `on conflict do update` en seeds
- guards para policies y constraints

Referencia SQL principal:

- `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`

## Semillas iniciales

Se dejan creados y actualizables:

- `trial`
- `basic`
- `pro`
- `enterprise`

Tambien se incluyen:

- precios mensuales en COP
- features base por plan
- limites iniciales por plan

Referencia SQL:

- `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`

## Lo que aun no hace

Esta base no implementa todavia:

- checkout real con gateway
- webhooks de pagos
- renovacion automatica
- asignacion automatica de plan al crear tenant
- enforcement en pantallas mobile

## Referencias

- diseno funcional: `docs/TENANT_BILLING_MONETIZATION_DESIGN.md`
- contexto vivo: `docs/CONTEXTO_MOBILE.md`
- migracion base: `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`
- permisos base existentes: `migrations/InitPermissions.sql`
- helpers de RLS existentes: `migrations/RLS_Security.sql`
- helper de app user y patron `security definer`: `migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql`
