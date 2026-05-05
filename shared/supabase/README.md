# Shared Supabase Backend

Este directorio es la fuente canónica del backend compartido entre `web` y `mobile`.

## Qué quedó unificado en esta fase

- Migraciones compartidas que existian en `web/migrations` y `mobile/migrations`, mas las nuevas migraciones canonicas de tienda online, Mercado Pago y notificaciones.
- Edge Functions compartidas:
  - `chat-order-parser`
  - `create-tenant-user`
  - `mercadopago-create-preference`
  - `mercadopago-create-preference-v2`
  - `mercadopago-webhook`
  - `online-order-email`
  - `notification-dispatcher`
  - `tenant-mercadopago-config`

Manifiestos:

- [shared-migrations.txt](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/shared-migrations.txt)
- [shared-functions.txt](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/shared-functions.txt)
- [EMAIL_NOTIFICATION_SYSTEM.md](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/EMAIL_NOTIFICATION_SYSTEM.md)
- [PUBLIC_SUBSCRIPTION_SIGNUP.md](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/PUBLIC_SUBSCRIPTION_SIGNUP.md)

## Sistemas recientes

### Mercado Pago multi-tenant

- Cada tenant guarda sus propias credenciales de Mercado Pago en backend.
- La preferencia de pago se crea con `mercadopago-create-preference-v2`.
- El webhook `mercadopago-webhook` sincroniza el estado del pedido gateway y procesa emails pendientes mediante `notification-dispatcher`.
- Las URLs de retorno usan el estado publico del pedido y el webhook/revalidacion confirman contra Mercado Pago.

### Emails centralizados con Resend

- La migracion `ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql` crea `notification_outbox` y triggers de eventos.
- `notification-dispatcher` es la unica Edge Function objetivo para enviar correos.
- La deduplicacion se hace con `channel + dedupe_key`, evitando correos repetidos y sobrecostos.
- `online-order-email` queda como compatibilidad, pero el flujo nuevo debe encolar en `notification_outbox`.

## Alta Publica SaaS

- La ruta publica `/planes` permite comprar el primer periodo de una suscripcion OfirOne.
- `subscription-create-preference` usa la cuenta Mercado Pago de OfirOne (`OFIRONE_MP_ACCESS_TOKEN`), no credenciales de tenants.
- `mercadopago-webhook` detecta `external_reference = subscription_signup:<id>` y aprovisiona tenant + suscripcion.
- Detalle operativo: [PUBLIC_SUBSCRIPTION_SIGNUP.md](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/PUBLIC_SUBSCRIPTION_SIGNUP.md)

Secrets requeridos:

```bash
RESEND_API_KEY=...
RESEND_FROM_EMAIL=ventas@ofirone.com
RESEND_FROM_NAME=OfirOne
PUBLIC_APP_URL=https://ofirone.com
```

## Qué no se unificó todavía

Se mantiene fuera de `shared` todo lo que hoy diverge o es específico de una app.

Pendientes intencionales:

- Functions específicas por producto:
  - `web`: `accounting-queue-worker`, `deepseek-proxy`
  - `mobile`: `deepseek-ocr-proxy`, `ops-rag-agent`, `product-photo-analyzer`, `product-photo-parser`, `push-dispatcher`

## Cómo sincronizar

Para evitar redundancia física y mantener las rutas `web/...` y `mobile/...`, el modo recomendado es crear symlinks hacia `shared/supabase`.

```bash
scripts/sync-shared-supabase.sh link
```

Para validar que `web` y `mobile` sigan alineados con la fuente canónica:

```bash
scripts/sync-shared-supabase.sh check
```

## Regla operativa

Si un archivo aparece en los manifiestos de este directorio:

- se edita primero en `shared/supabase`
- luego se vuelve a enlazar o sincronizar hacia `web` y `mobile`

Si un archivo no aparece en esos manifiestos:

- sigue siendo propiedad de `web` o `mobile`
- no debe moverse a shared sin reconciliar antes sus diferencias funcionales
