# Diseno de Monetizacion y Suscripciones por Tenant

Fecha: 2026-03-21
Proyecto: POSLite Mobile / OfirOne
Estado: Propuesta arquitectonica para implementacion

## 1. Objetivo

Definir una capa de monetizacion multi-tenant que permita:

- vender planes por tenant
- controlar renovaciones y vencimientos
- manejar periodos de prueba, gracia, mora y suspension
- limitar modulos o capacidades segun el plan contratado
- separar claramente la configuracion operativa del tenant de su estado comercial

## 2. Principio clave

`tenant_settings` no debe convertirse en el lugar donde vivan suscripciones, pagos o renovaciones.

Ese objeto ya concentra configuracion operativa del negocio:

- tema
- facturacion
- ventas
- inventario
- IA
- notificaciones

La monetizacion debe modelarse como un dominio aparte, con sus propias tablas, eventos y reglas.

## 3. Alcance del dominio

La capa de billing para tenants debe cubrir:

- catalogo de planes
- precios por periodicidad
- asignacion de plan a un tenant
- renovacion automatica o manual
- historial de cobros y pagos
- limites y features habilitadas
- alertas previas al vencimiento
- bloqueo parcial o total cuando aplique
- auditoria de cambios comerciales

No debe cubrir en una primera fase:

- facturacion electronica fiscal al cliente final del tenant
- contabilidad interna completa
- marketplace de add-ons complejo

## 4. Modelo conceptual

El tenant no "tiene un plan" de forma suelta. El tenant tiene una suscripcion vigente, y esa suscripcion apunta a una version comercial concreta del plan.

Relaciones principales:

- un `billing_plan` define la identidad del plan: nombre, codigo, categoria
- un `billing_plan_price` define cuanto cuesta y cada cuanto renueva
- una `tenant_subscription` indica que tenant esta en que plan y en que estado
- una `tenant_subscription_period` registra cada ciclo cobrado o habilitado
- una `tenant_invoice` registra el documento comercial a pagar
- una `tenant_payment` registra la confirmacion de pago
- una `tenant_entitlement` o vista derivada expone los limites efectivos

## 5. Planes sugeridos

### 5.1 Tipos de plan

Como base, conviene arrancar con pocos planes bien diferenciados:

- `trial`
- `basic`
- `pro`
- `enterprise`

### 5.2 Variables por plan

Cada plan deberia poder definir:

- nombre comercial
- codigo interno
- descripcion corta
- orden de visualizacion
- si esta publicado o archivado
- si admite prueba gratis
- si requiere contacto comercial
- modulos habilitados
- limites cuantitativos

### 5.3 Ejemplos de limites

Los limites deben modelarse como datos, no como `if` quemados por toda la app.

Ejemplos:

- numero maximo de usuarios activos
- numero maximo de sedes
- numero maximo de cajas
- numero maximo de productos
- numero maximo de facturas por mes
- acceso a IA local
- acceso a OCR
- acceso a reportes avanzados
- acceso a soporte prioritario

## 6. Tablas propuestas

### 6.1 Catalogo comercial

#### `billing_plans`

- `plan_id`
- `code` unique
- `name`
- `description`
- `is_public`
- `is_active`
- `is_custom`
- `sort_order`
- `created_at`
- `updated_at`

#### `billing_plan_prices`

- `plan_price_id`
- `plan_id`
- `currency_code`
- `billing_interval` enum: `monthly`, `quarterly`, `semiannual`, `annual`
- `amount`
- `setup_fee`
- `trial_days`
- `grace_days`
- `auto_renew_default`
- `is_active`
- `created_at`
- `updated_at`

#### `billing_plan_features`

- `plan_feature_id`
- `plan_id`
- `feature_code`
- `feature_name`
- `is_enabled`
- `metadata` jsonb

#### `billing_plan_limits`

- `plan_limit_id`
- `plan_id`
- `limit_code`
- `limit_name`
- `limit_value`
- `limit_unit`
- `metadata` jsonb

### 6.2 Suscripcion del tenant

#### `tenant_subscriptions`

- `subscription_id`
- `tenant_id`
- `plan_id`
- `plan_price_id`
- `status`
- `start_at`
- `current_period_start`
- `current_period_end`
- `trial_end_at`
- `grace_end_at`
- `cancel_at_period_end`
- `canceled_at`
- `suspended_at`
- `renewal_mode` enum: `manual`, `auto`
- `payment_provider`
- `provider_customer_id`
- `provider_subscription_id`
- `metadata` jsonb
- `created_at`
- `updated_at`

Regla importante:

- solo una suscripcion activa o trialing por tenant

#### `tenant_subscription_periods`

- `subscription_period_id`
- `subscription_id`
- `period_number`
- `period_start`
- `period_end`
- `invoice_id`
- `status` enum: `pending`, `invoiced`, `paid`, `grace`, `expired`
- `created_at`

#### `tenant_subscription_events`

- `event_id`
- `subscription_id`
- `tenant_id`
- `event_type`
- `event_source` enum: `system`, `admin`, `payment_webhook`, `support`
- `payload` jsonb
- `created_by`
- `created_at`

Esto sirve para auditar:

- cambio de plan
- inicio de trial
- renovacion
- rechazo de pago
- entrada en gracia
- suspension
- reactivacion

### 6.3 Cobros y pagos

#### `tenant_invoices`

- `invoice_id`
- `tenant_id`
- `subscription_id`
- `subscription_period_id`
- `number`
- `currency_code`
- `subtotal`
- `tax_amount`
- `total`
- `due_at`
- `status` enum: `draft`, `issued`, `paid`, `void`, `overdue`
- `issued_at`
- `paid_at`
- `metadata` jsonb

#### `tenant_payments`

- `payment_id`
- `tenant_id`
- `invoice_id`
- `provider`
- `provider_payment_id`
- `amount`
- `currency_code`
- `status` enum: `pending`, `authorized`, `paid`, `failed`, `refunded`
- `paid_at`
- `raw_response` jsonb
- `created_at`

#### `tenant_payment_methods`

- `tenant_payment_method_id`
- `tenant_id`
- `provider`
- `provider_token`
- `brand`
- `last4`
- `expires_at`
- `is_default`
- `created_at`

## 7. Estados de suscripcion

Estados sugeridos para `tenant_subscriptions.status`:

- `trialing`: tenant en prueba gratis
- `active`: tenant al dia
- `pending_activation`: creado pero aun no habilitado
- `past_due`: vencido pero aun no suspendido
- `grace_period`: dentro del margen de gracia
- `suspended`: acceso restringido por falta de pago
- `canceled`: cancelado por decision comercial
- `expired`: termino y ya no tiene vigencia

Regla practica:

- `past_due` y `grace_period` pueden seguir permitiendo operacion parcial
- `suspended` debe bloquear creacion de operaciones criticas o toda la app, segun politica

## 8. Renovaciones

### 8.1 Flujo base

1. Se crea la suscripcion al asignar un plan al tenant.
2. Se define `current_period_start` y `current_period_end`.
3. Antes del vencimiento, el sistema genera invoice del siguiente periodo.
4. Si el pago entra a tiempo, se extiende el periodo.
5. Si no entra, pasa a `past_due` y luego a `grace_period`.
6. Si vence la gracia, pasa a `suspended`.

### 8.2 Modos de renovacion

Soportar desde el inicio:

- `manual`: el tenant paga y un proceso confirma la renovacion
- `auto`: un proveedor de pagos intenta el cobro y webhook actualiza el estado

### 8.3 Fechas operativas sugeridas

- aviso preventivo: 7 dias antes
- aviso fuerte: 3 dias antes
- aviso final: 1 dia antes
- inicio de mora: el dia siguiente al vencimiento
- gracia: configurable por precio, por ejemplo 3 a 7 dias
- suspension: al terminar la gracia

## 9. Enforcement funcional

La app mobile no deberia decidir la facturacion, pero si debe obedecer el estado comercial efectivo del tenant.

### 9.1 Lo que debe resolver backend

- cual es la suscripcion vigente
- cuales features estan habilitadas
- cuales limites se alcanzaron
- si el tenant esta suspendido o en gracia
- que mensaje operativo debe ver el usuario

### 9.2 Lo que debe consumir mobile

Conviene exponer una vista o RPC resumida, por ejemplo `tenant_billing_summary`:

- `tenant_id`
- `plan_code`
- `plan_name`
- `status`
- `current_period_end`
- `grace_end_at`
- `days_to_expiry`
- `can_operate_sales`
- `can_operate_admin`
- `banner_message`
- `feature_flags` jsonb
- `limits` jsonb

### 9.3 Politicas sugeridas de bloqueo

`trialing`:

- acceso completo al alcance del trial

`active`:

- acceso normal

`past_due` o `grace_period`:

- permitir operar POS y caja
- mostrar banner persistente
- bloquear acciones administrativas no esenciales si se desea

`suspended`:

- bloquear nuevas ventas y configuracion sensible
- permitir acceso a pago, soporte y consulta basica

`canceled` o `expired`:

- acceso de solo lectura o acceso minimo

## 10. Integracion con la creacion de tenants

La SP `fn_create_tenant` deberia ampliarse en una fase posterior para dejar creado el estado comercial inicial.

Recomendacion:

- crear tenant
- asignar plan por defecto
- crear suscripcion inicial
- si aplica, iniciar trial
- registrar evento `subscription_created`

No recomiendo guardar el plan inicial solo en `tenant_settings`.

## 11. Alertas y UX

La monetizacion no debe aparecer solo al final cuando ya se bloqueo todo. Debe existir una experiencia progresiva.

### 11.1 Alertas sugeridas

- banner superior cuando falten pocos dias
- aviso al iniciar sesion
- badge en modulo de empresa / suscripcion
- recordatorio dentro de configuracion del tenant
- notificaciones push solo para roles administrativos

### 11.2 Pantalla sugerida

Crear un modulo especifico, por ejemplo `TenantBillingScreen`, separado de `TenantConfigScreen`.

Secciones sugeridas:

- plan actual
- proxima renovacion
- estado de pago
- limites consumidos
- historial de invoices/pagos
- CTA de renovar o cambiar plan

## 12. Propuesta de APIs / RPC

### 12.1 Lectura

- `fn_get_tenant_billing_summary(p_tenant_id uuid)`
- `fn_get_tenant_billing_history(p_tenant_id uuid)`
- `fn_get_available_billing_plans()`

### 12.2 Escritura operativa

- `fn_assign_tenant_plan(p_tenant_id uuid, p_plan_price_id uuid, p_mode text)`
- `fn_renew_tenant_subscription(p_tenant_id uuid, p_invoice_id uuid)`
- `fn_suspend_tenant_subscription(p_tenant_id uuid, p_reason text)`
- `fn_reactivate_tenant_subscription(p_tenant_id uuid, p_payment_id uuid)`

### 12.3 Jobs / cron

- generar invoices proximas a vencer
- marcar invoices vencidas
- pasar suscripciones a gracia
- pasar suscripciones a suspension
- disparar recordatorios

## 13. Proveedor de pagos

La arquitectura debe ser agnostica del proveedor.

Recomendacion:

- guardar siempre `provider`, `provider_customer_id`, `provider_payment_id` y `raw_response`
- encapsular integracion en servicio o Edge Function por proveedor
- no amarrar la logica core del tenant a campos exclusivos de un gateway

## 14. Fases de implementacion

### Fase 1: Modelo base y lectura

- crear tablas de planes, precios y suscripciones
- crear resumen `tenant_billing_summary`
- asignar plan inicial a tenants nuevos
- mostrar estado comercial en mobile sin bloqueo fuerte

### Fase 2: Renovaciones y alertas

- crear invoices y pagos
- jobs de vencimiento
- banners y alertas en app
- historial comercial por tenant

### Fase 3: Enforcement

- aplicar feature flags por plan
- aplicar limites cuantitativos
- bloqueo por suspension
- acceso a modulo de renovacion

### Fase 4: Integracion full con gateway

- checkout real
- webhooks
- renovacion automatica
- metodos de pago guardados

## 15. Decisiones recomendadas

- separar billing de `tenant_settings`
- crear pantalla propia de billing para tenant
- exponer un resumen corto para mobile y no toda la complejidad del dominio
- manejar limites y features como datos configurables
- permitir degradacion progresiva: aviso -> gracia -> suspension
- mantener el backend como fuente de verdad del estado comercial

## 16. Minimo viable recomendado

Si hubiera que construirlo por impacto/riesgo, el MVP correcto seria:

1. catalogo de planes
2. suscripcion por tenant
3. resumen de estado comercial
4. fechas de vencimiento y gracia
5. banners de aviso en mobile
6. bloqueo por suspension
7. renovacion manual registrada por admin

Eso ya permite monetizar de forma seria sin depender aun de una pasarela totalmente automatizada.
