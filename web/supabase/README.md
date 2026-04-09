# Supabase Edge Functions

## Instalar Supabase CLI

```bash
# Windows (PowerShell)
scoop install supabase

# O descargar desde:
# https://github.com/supabase/cli/releases
```

## Desplegar la Edge Function

```bash
# 1. Login en Supabase
supabase login

# 2. Link al proyecto
supabase link --project-ref [TU_PROJECT_REF]

# 3. Desplegar la función
supabase functions deploy create-tenant-user

# 4. Verificar que se desplegó
supabase functions list
```

## ¿Qué hace esta Edge Function?

La función `create-tenant-user`:
- ✅ Crea usuarios en Supabase Auth con **autoconfirmación de email**
- ✅ Usa `auth.admin.createUser({ email_confirm: true })`
- ✅ Requiere `SUPABASE_SERVICE_ROLE_KEY` (solo disponible en backend)
- ✅ Retorna el `user_id` para guardarlo en la tabla `users`

## Alternativa sin Edge Function

Si no quieres configurar Edge Functions, simplemente:

1. Ve a **Supabase Dashboard**
2. Authentication → Providers → Email
3. Desactiva **"Enable email confirmations"**
4. Cambia en `tenants.service.js` de:
   ```javascript
   await supabaseService.client.functions.invoke('create-tenant-user', ...)
   ```
   A:
   ```javascript
   await supabaseService.client.auth.signUp({ email, password })
   ```

Con esta configuración, todos los usuarios se crean sin necesidad de confirmar email.

## Chat a Venta (IA)

Edge Function:

```bash
supabase functions deploy chat-order-parser --project-ref [TU_PROJECT_REF]
```

Secret requerido:

```bash
supabase secrets set DEEPSEEK_API_KEY=tu_api_key --project-ref [TU_PROJECT_REF]
```

Migración requerida:

- `migrations/ADD_CHAT_ORDER_AI_CACHE.sql`

## Worker automático de cola contable

Edge Function:

```bash
supabase functions deploy accounting-queue-worker --project-ref [TU_PROJECT_REF]
```

Secret recomendado:

```bash
supabase secrets set ACCOUNTING_QUEUE_CRON_KEY=tu_clave_segura --project-ref [TU_PROJECT_REF]
```

Invocación manual de prueba:

```bash
curl -X POST "https://[PROJECT_REF].supabase.co/functions/v1/accounting-queue-worker" \
  -H "Content-Type: application/json" \
  -H "x-cron-key: tu_clave_segura" \
  -d '{"limit":100}'
```

Migración requerida:

- `migrations/ADD_ACCOUNTING_QUEUE_PROCESSOR.sql`
- `migrations/ADD_SUPABASE_CRON_PIPELINES.sql`

## Supabase Cron Jobs

Jobs creados por SQL:

- `poslite_process_accounting_queue_every_minute`
- `poslite_push_dispatcher_every_minute`

Comportamiento:

- La cola contable corre en `pg_cron` directamente sobre Postgres.
- El push dispatcher se dispara con `pg_cron + pg_net`.
- GitHub Actions ya no participa en la ejecucion programada de estos jobs.

Secrets requeridos en Vault para push dispatcher:

- `PUSH_DISPATCHER_URL`
- `PUSH_DISPATCHER_SECRET`

Verificación sugerida:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'poslite_process_accounting_queue_every_minute',
  'poslite_push_dispatcher_every_minute',
  'poslite_refresh_all_alerts_hourly'
);
```

Prueba manual desde SQL:

```sql
select public.fn_accounting_process_queue_all_tenants(100);
select public.fn_push_dispatcher_cron(100);
```
