# Supabase Edge Functions

Nota de mantenimiento:

- La fuente canónica del backend compartido ahora vive en [shared/supabase/README.md](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/README.md:1).
- Antes de desplegar cambios compartidos, enlaza o sincroniza:

```bash
scripts/sync-shared-supabase.sh link
```

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
- ✅ Crea usuarios reales en `auth.users` con **autoconfirmación de email**
- ✅ Inserta o repara el registro correspondiente en `public.users`
- ✅ Reemplaza los roles en `user_roles`
- ✅ Permite cambio de contraseña vía `auth.admin.updateUserById(...)`
- ✅ Valida permisos del caller: `SUPER ADMIN`, `ADMINISTRADOR` o `GERENTE`
- ✅ Requiere `SUPABASE_SERVICE_ROLE_KEY` (solo disponible en backend)

Payloads soportados:

```json
{
  "action": "create_user",
  "tenant_id": "uuid-del-tenant",
  "email": "usuario@demo.com",
  "password": "123456",
  "full_name": "Usuario Demo",
  "role_ids": ["uuid-rol-1"],
  "is_active": true
}
```

```json
{
  "action": "change_password",
  "tenant_id": "uuid-del-tenant",
  "auth_user_id": "uuid-auth-user",
  "new_password": "123456"
}
```

Notas:
- El email en Supabase Auth es único a nivel proyecto, no a nivel tenant.
- Web y mobile consumen el mismo contrato desde `shared/utils/tenantUserAdmin.js`.
- Si existía un usuario legado en `public.users` con UUID simulado, la función intenta repararlo y vincularlo al usuario real de Auth.

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
