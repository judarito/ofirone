# Sistema Central de Emails

Estado: implementado en backend compartido.

## Objetivo

Centralizar el envio de correos transaccionales y operativos para `web` y `mobile`, evitando duplicados y sobrecostos cuando un mismo evento se dispara desde varios caminos: webhook, revalidacion, doble click, web y mobile.

## Componentes

- Migracion principal: `shared/supabase/migrations/ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql`
- Tabla central: `notification_outbox`
- Funcion de encolado: `fn_enqueue_email_notification(...)`
- Edge Function de envio: `notification-dispatcher`
- Proveedor actual: Resend
- Compatibilidad legacy: `online-order-email` sigue existiendo, pero el flujo objetivo es `notification_outbox -> notification-dispatcher`

## Deduplicacion

Cada correo se identifica con:

```txt
channel = email
dedupe_key = clave logica del evento
```

La tabla tiene un indice unico:

```txt
ux_notification_outbox_channel_dedupe
```

Esto garantiza que un mismo evento logico se encole una sola vez aunque lo intente:

- Mercado Pago via webhook
- Revalidacion manual
- Web
- Mobile
- Reintento de usuario
- Trigger SQL repetido

## Eventos Cubiertos

- Pedidos online pendientes, aprobados y rechazados.
- Ventas POS completadas.
- Devoluciones.
- Plan separe creado, completado, cancelado o expirado.
- Abonos de plan separe.
- Movimientos de cartera/credito.
- Cuentas por pagar y pagos a proveedor.
- Alertas operativas desde `system_alerts`.
- Usuarios creados.
- Importaciones masivas finalizadas.
- Cambios de estado de suscripcion del tenant.

## Variables y Secrets

Frontend:

```env
VITE_NOTIFICATION_DISPATCHER_EDGE_FUNCTION=notification-dispatcher
```

Supabase Edge Function secrets:

```bash
RESEND_API_KEY=...
RESEND_FROM_EMAIL=ventas@ofirone.com
RESEND_FROM_NAME=OfirOne
PUBLIC_APP_URL=https://ofirone.com
```

`RESEND_FROM_EMAIL` debe usar un dominio verificado en Resend. En desarrollo puede usarse temporalmente `onboarding@resend.dev`.

## Despliegue

Ejecutar la migracion:

```txt
shared/supabase/migrations/ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql
```

Desplegar functions:

```bash
cd web
supabase functions deploy notification-dispatcher
supabase functions deploy mercadopago-webhook
```

`mercadopago-webhook` debe redeployarse porque ahora procesa la cola central despues de sincronizar pagos.

## Procesamiento

El dispatcher procesa correos pendientes:

```bash
supabase functions invoke notification-dispatcher --body '{"limit":10}'
```

Tambien puede llamarse desde la app despues de acciones criticas, como confirmar/rechazar pedidos online.

Recomendacion para produccion: programar `notification-dispatcher` con Supabase Cron cada 1 minuto para procesar cualquier correo pendiente o reintento.

## Diagnostico

Consultar pendientes:

```sql
select notification_id, event_type, recipient_email, status, attempts, last_error, created_at
from notification_outbox
order by created_at desc
limit 50;
```

Ver duplicados evitados:

```sql
select dedupe_key, count(*)
from notification_outbox
group by dedupe_key
having count(*) > 1;
```

Esta consulta deberia retornar cero filas.

Reintentar fallidos:

```sql
update notification_outbox
set status = 'pending',
    next_attempt_at = now(),
    last_error = null
where status = 'failed';
```

## Relacion Con Otros Canales

Este sistema solo cubre email. Los canales internos siguen separados:

- `system_alerts`: alertas operativas canonicas.
- `notifications`: inbox in-app/mobile.
- `notification_push_queue` / `push-dispatcher`: push remoto.
- `notification_outbox` / `notification-dispatcher`: email.

Los eventos de negocio pueden alimentar uno o varios canales, pero el envio de email debe pasar por `notification_outbox`.
