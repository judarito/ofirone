# Estado de Implementacion de Billing por Tenant

Fecha: 2026-05-05
Proyecto: POSLite Mobile / OfirOne
Estado: Base SQL implementada, alta publica SaaS operativa desde web, enforcement backend compartido

## Actualizacion 2026-05-05

Se agrego el flujo publico de suscripciones SaaS y el enforcement real de limites por plan en backend compartido.

Backend compartido relevante:

- `shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql`
- `shared/supabase/migrations/ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql`
- `shared/supabase/functions/subscription-create-preference/index.ts`
- `shared/supabase/functions/subscription-provision-signup/index.ts`
- `shared/supabase/functions/mercadopago-webhook/index.ts`

Capacidades ya operativas desde web:

- Ruta publica `/planes` para comprar el primer periodo.
- Pago con Mercado Pago usando la cuenta de OfirOne.
- Aprovisionamiento automatico de tenant, usuario interno y suscripcion.
- SuperAdmin web con consola `Billing y Monetizacion > Altas publicas`.
- Acciones SuperAdmin: aprovisionar, revalidar Mercado Pago, reenviar acceso, marcar revisada y cancelar.

Enforcement backend:

- Usuarios activos.
- Sedes activas.
- Cajas activas.
- Productos activos.
- Facturas por mes.

Estado mobile:

- Mobile hereda el backend compartido y los limites en base de datos.
- La consola SuperAdmin de billing sigue marcada como `web-only`.
- La UI mobile aun no implementa validaciones previas amables para todos los limites; si se excede un limite, la base de datos puede devolver el bloqueo.

## Actualizacion 2026-04-03

Se agrego una migracion complementaria para backfill comercial:

- `migrations/ADD_FREEMIUM_6M_TENANT_SUBSCRIPTIONS.sql`

Esta migracion:

- crea o actualiza el plan `freemium`
- define un precio `semiannual` de valor `0`
- deja features y limites base para ese plan
- asigna una suscripcion de 6 meses solo a tenants sin suscripcion abierta

Tambien se reforzo compatibilidad de esquema en billing:

- `migrations/ADD_TENANT_BILLING_MONETIZATION.sql` ahora tolera instalaciones con `tenants.tenant_id` o `tenants.id`
- el helper de tenant y la FK de actor de eventos pueden resolver instalaciones que usan `users` o `profiles`

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

Esta base no implementa todavia en mobile:

- renovacion automatica
- pantalla mobile de compra publica de planes
- consola SuperAdmin mobile de altas publicas
- validacion previa amable en todas las pantallas mobile

## Referencias

- diseno funcional: `docs/TENANT_BILLING_MONETIZATION_DESIGN.md`
- contexto vivo: `docs/CONTEXTO_MOBILE.md`
- migracion base: `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`
- migracion de enforcement: `shared/supabase/migrations/ADD_TENANT_BILLING_LIMIT_ENFORCEMENT.sql`
- alta publica SaaS: `shared/supabase/PUBLIC_SUBSCRIPTION_SIGNUP.md`
- permisos base existentes: `migrations/InitPermissions.sql`
- helpers de RLS existentes: `migrations/RLS_Security.sql`
- helper de app user y patron `security definer`: `migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql`
