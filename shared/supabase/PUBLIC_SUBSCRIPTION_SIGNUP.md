# Alta Publica De Suscripciones

Estado: fase 1 implementada.

## Flujo

1. El cliente entra a `/planes`.
2. Selecciona un plan publico de `billing_plans` con precio activo.
3. La app llama a `subscription-create-preference`.
4. Antes de enviar a Mercado Pago se valida que email/NIT no existan en Auth, tenants, usuarios o solicitudes activas.
5. La function crea `public_subscription_signups` y una preferencia de Mercado Pago.
6. Mercado Pago retorna a `/suscripcion/estado/:signupId`.
7. `mercadopago-webhook` detecta `external_reference = subscription_signup:<signupId>`.
8. Si el pago queda aprobado:
   - marca la solicitud como `PAID`;
   - crea usuario Auth;
   - ejecuta `fn_create_tenant`;
   - crea `tenant_subscriptions` y primer periodo pagado;
   - marca la solicitud como `PROVISIONED`;
   - envía correo para crear contraseña si Resend está configurado.

## Componentes

- Migracion: `shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql`
- Edge Function: `subscription-create-preference`
- Webhook extendido: `mercadopago-webhook`
- Servicio web: `web/src/services/subscriptionSignup.service.js`
- Paginas publicas:
  - `/planes`
  - `/suscripcion/estado/:signupId`

## Secrets Requeridos

Supabase Edge Functions:

```bash
OFIRONE_MP_ACCESS_TOKEN=...
RESEND_API_KEY=...
RESEND_FROM_EMAIL=ventas@ofirone.com
RESEND_FROM_NAME=OfirOne
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_URL=...
```

`OFIRONE_MP_ACCESS_TOKEN` es la credencial de la cuenta Mercado Pago de OfirOne, no la de los tenants.

Frontend:

```env
VITE_SUBSCRIPTION_CREATE_PREFERENCE_EDGE_FUNCTION=subscription-create-preference
```

## Despliegue

Ejecutar migracion:

```txt
shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql
```

Desplegar functions:

```bash
cd web
supabase functions deploy subscription-create-preference
supabase functions deploy mercadopago-webhook
```

`mercadopago-webhook` debe republicarse porque ahora procesa pagos de suscripciones SaaS además de pedidos online.

## Alcance Fase 1

- Cobro inicial de primer periodo.
- Suscripcion interna con renovacion manual.
- Aprovisionamiento automatico del tenant.
- Pantalla publica de estado.
- Validacion previa de email administrador y NIT/identificacion para evitar cobros duplicados que terminen en revision.

No incluye todavia:

- Recurrencia automatica de Mercado Pago.
- Portal de cancelacion autoservicio.
- Upgrade/downgrade automatico.
