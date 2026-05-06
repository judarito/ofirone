# Alta Publica De Suscripciones

Estado: fase 1 implementada + consola operativa SuperAdmin.

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

Si el webhook no puede completar el aprovisionamiento, la solicitud queda en `FAILED` y se gestiona desde SuperAdmin sin tocar base de datos manualmente.

## Componentes

- Migracion: `shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql`
- Edge Function: `subscription-create-preference`
- Edge Function: `subscription-provision-signup`
- Webhook extendido: `mercadopago-webhook`
- Servicio web: `web/src/services/subscriptionSignup.service.js`
- Paginas publicas:
  - `/planes`
  - `/suscripcion/estado/:signupId`
- SuperAdmin:
  - `Billing y Monetizacion > Altas publicas`
  - Lista solicitudes `public_subscription_signups`
  - Permite filtrar por estado: `PENDING_PAYMENT`, `PAID`, `PROVISIONING`, `PROVISIONED`, `FAILED`, `CANCELLED`
  - Muestra conteos rápidos por estado
  - Muestra timeline tecnico desde `public_subscription_signup_events`
  - Permite aprovisionar manualmente solicitudes pagadas sin consultar Mercado Pago
  - Permite revalidar Mercado Pago cuando se necesita resincronizar el pago
  - Permite reenviar correo de acceso para solicitudes aprovisionadas
  - Permite marcar solicitudes como revisadas con nota interna
  - Permite cancelar solicitudes pendientes/fallidas/duplicadas sin borrar datos

## Secrets Requeridos

Supabase Edge Functions:

```bash
OFIRONE_MP_ACCESS_TOKEN=...
RESEND_API_KEY=...
RESEND_FROM_EMAIL=ventas@ofirone.com
RESEND_FROM_NAME=OfirOne
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_URL=...
OFIRONE_PUBLIC_APP_URL=https://ofirone.com
# Opcional, si quieres controlar exactamente a donde llega el recovery:
OFIRONE_AUTH_RECOVERY_URL=https://ofirone.com/login
```

`OFIRONE_MP_ACCESS_TOKEN` es la credencial de la cuenta Mercado Pago de OfirOne, no la de los tenants.
`OFIRONE_PUBLIC_APP_URL` se usa para que el correo "Crear contrasena" apunte al dominio productivo y no a `localhost`.

Frontend:

```env
VITE_SUBSCRIPTION_CREATE_PREFERENCE_EDGE_FUNCTION=subscription-create-preference
VITE_SUBSCRIPTION_PROVISION_EDGE_FUNCTION=subscription-provision-signup
```

## Edge Function `subscription-provision-signup`

Esta function valida que el usuario autenticado sea SuperAdmin y soporta acciones operativas sobre una solicitud:

```json
{ "signup_id": "...", "action": "provision" }
{ "signup_id": "...", "action": "resend_access", "note": "Cliente pidió nuevo acceso" }
{ "signup_id": "...", "action": "mark_reviewed", "note": "Revisado por soporte" }
{ "signup_id": "...", "action": "cancel", "note": "Solicitud duplicada" }
```

Acciones:

- `provision`: crea/recupera Auth user, ejecuta `fn_provision_public_subscription_signup`, crea tenant, usuario interno, suscripcion y correo de bienvenida.
- `resend_access`: genera un nuevo recovery link y reenvia el correo de acceso. Esta accion puede generar un correo nuevo cada vez que el SuperAdmin la confirma.
- `mark_reviewed`: registra evento de auditoria sin cambiar pago ni tenant.
- `cancel`: cambia la solicitud a `CANCELLED` si aun no fue aprovisionada.

Los correos de bienvenida/acceso del alta publica se registran en `public_subscription_signup_events`. El envio automatico inicial usa `event_key = welcome-email` para evitar duplicados. Los reenvios manuales usan keys unicas para dejar trazabilidad de cada reenvio solicitado por soporte.

## Despliegue

Ejecutar migracion:

```txt
shared/supabase/migrations/ADD_PUBLIC_SUBSCRIPTION_SIGNUPS.sql
```

Desplegar functions:

```bash
cd web
supabase functions deploy subscription-create-preference
supabase functions deploy subscription-provision-signup
supabase functions deploy mercadopago-webhook
```

`mercadopago-webhook` debe republicarse porque ahora procesa pagos de suscripciones SaaS además de pedidos online.

## Alcance Fase 1

- Cobro inicial de primer periodo.
- Suscripcion interna con renovacion manual.
- Aprovisionamiento automatico del tenant.
- Pantalla publica de estado.
- Validacion previa de email administrador y NIT/identificacion para evitar cobros duplicados que terminen en revision.
- Consola SuperAdmin para observar, filtrar, revalidar, aprovisionar, revisar, cancelar y reenviar acceso.
- Eventos idempotentes por etapa para evitar repetir correo de bienvenida y facilitar diagnostico.
- Enforcement de limites por plan desde base de datos para usuarios, sedes, cajas, productos y facturas por mes.
- Validacion amable en frontend antes de crear usuarios, sedes, cajas y productos.
- Visualizacion de consumo de limites en `Configuracion > Suscripcion`.

No incluye todavia:

- Recurrencia automatica de Mercado Pago.
- Portal de cancelacion autoservicio.
- Upgrade/downgrade automatico.
- Envio de correos de alta publica mediante `notification_outbox`; por ahora el acceso SaaS se envia desde `subscription-provision-signup` por necesitar recovery link inmediato.
