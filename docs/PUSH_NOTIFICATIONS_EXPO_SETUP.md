# Push Notifications (Android FCM directo + Expo fallback)

## Qué incluye
- Registro de token push en app móvil (`expo-notifications`).
- Persistencia de dispositivos: `user_push_devices`.
- Cola de envíos push: `notification_push_queue`.
- Trigger que encola push al crear una notificación in-app.
- Edge Function `push-dispatcher` para enviar:
  - Android: directo a FCM HTTP v1
  - iOS / fallback: Expo Push API

## Archivos
- `migrations/ADD_PUSH_NOTIFICATIONS_EXPO.sql`
- `migrations/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql`
- `src/services/pushNotifications.service.js`
- `supabase/functions/push-dispatcher/index.ts`
- `App.js`

## 1) Ejecutar migración SQL
Ejecuta:
- `migrations/ADD_PUSH_NOTIFICATIONS_EXPO.sql`
- `migrations/ALTER_PUSH_NOTIFICATIONS_ANDROID_DIRECT_FCM.sql`
- `migrations/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql`

## 2) Desplegar function
```bash
supabase functions deploy push-dispatcher --project-ref mcufhthejdwonndvpmev
```

## 3) Secrets de la Edge Function
Estos secretos viven en el runtime de la function, no en Vault:
```bash
supabase secrets set PUSH_DISPATCHER_SECRET=tu_secret_seguro --project-ref mcufhthejdwonndvpmev
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key --project-ref mcufhthejdwonndvpmev
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' --project-ref mcufhthejdwonndvpmev
```

Opcional (si quieres mantener Expo Push para iOS/fallback):
```bash
supabase secrets set EXPO_ACCESS_TOKEN=tu_expo_access_token --project-ref mcufhthejdwonndvpmev
```

## 4) Disparar dispatcher manualmente
```bash
curl -X POST \
  "https://mcufhthejdwonndvpmev.supabase.co/functions/v1/push-dispatcher" \
  -H "Authorization: Bearer TU_PUSH_DISPATCHER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit":50}'
```

## 5) Scheduler operativo
- Scheduler principal y unico: usar Supabase Cron (`pg_cron` + `pg_net`) para ejecutar `push-dispatcher`.
- Este repo incluye la migracion `migrations/ADD_PUSH_DISPATCHER_SUPABASE_CRON.sql` para programar el job `poslite_push_dispatcher_every_minute`.
- Si el backend/web ya aplico `migrations/ADD_SUPABASE_CRON_PIPELINES.sql`, esta migracion mobile es compatible e idempotente para el job de push.
- El dispatcher reintenta con backoff y marca `FAILED` al agotar intentos.

## 6) Secrets requeridos en Vault
Para el cron de Supabase necesitas estos secretos en Vault, separados de `supabase secrets set`:
- `PUSH_DISPATCHER_URL`
- `PUSH_DISPATCHER_SECRET`

Puedes cargarlos desde el panel de Supabase en `Database > Vault` o con SQL equivalente en tu entorno.

Verificacion sugerida:
```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'poslite_push_dispatcher_every_minute';
```

## 7) Build móvil
Instala dependencias y recompila:
```bash
npm install
npx expo run:android
# o
npx expo run:ios
```

Nota importante:
- El flujo push remoto implementado en este repo debe probarse en `dev build` o build nativa/EAS.
- Si corres la app en Expo Go, el cliente ahora reporta ese runtime como no soportado para push remoto y no registra el token como si fuera válido.

## 8) FCM Android requerido para barra del sistema
La campanita in-app puede funcionar solo con Supabase Realtime, pero la barra de notificaciones Android requiere FCM real.

Qué quedó preparado en este repo:
- `app.config.js` detecta `google-services.json` y expone `android.googleServicesFile`.
- `android/build.gradle` incluye `com.google.gms:google-services`.
- `android/app/build.gradle` aplica `com.google.gms.google-services` solo cuando existe el archivo credencial.
- Si dejas `google-services.json` en la raiz del proyecto, el build lo sincroniza a `android/app/google-services.json`.

Archivo que debes colocar localmente:
- `./google-services.json`

Pasos:
1. Crear o seleccionar tu app Android en Firebase con package `com.juan.d.ricardo.t.app`.
2. Descargar `google-services.json`.
3. Guardarlo en la raiz del proyecto como `google-services.json`.
4. Recompilar con `npx expo run:android` o con EAS Build.

Sin ese archivo, Android no queda configurado para recibir push remoto del sistema aunque el inbox interno siga funcionando.

Nota adicional para Android 13+:
- la app debe declarar `POST_NOTIFICATIONS` en el manifest nativo
- este repo ya lo deja explicito en `app.json` y `android/app/src/main/AndroidManifest.xml`
- si el problema persistia por permiso faltante, necesitas recompilar y reinstalar la app; no basta un hot reload

## 9) Credencial FCM V1 requerida en Supabase Edge Function
Este proyecto ya no depende de Expo Push para Android. El dispatcher envia directo a FCM HTTP v1, asi que la credencial clave ya no va a Expo/EAS, sino al runtime de Supabase Edge Function.

Debes generar una private key JSON del proyecto Firebase:
- Firebase Console -> `Project settings` -> `Service accounts`
- Generar una nueva private key JSON
- Subirla como secret `FIREBASE_SERVICE_ACCOUNT_JSON` en Supabase

Resumen practico:
- `google-services.json` habilita el lado app/dispositivo Android
- `FIREBASE_SERVICE_ACCOUNT_JSON` habilita que `push-dispatcher` entregue a Android por FCM directo

Si falta la credencial FCM V1 en Supabase, el inbox in-app puede seguir funcionando y el dispositivo puede registrar token, pero la barra del sistema no recibira push remoto.

## 10) Diagnostico rapido cuando solo funciona la campanita
Si las notificaciones llegan a la campanita interna pero no a la barra del movil, revisar en este orden:

1. La app debe estar instalada como `dev build` o build nativa; no probar este flujo en Expo Go.
2. Verificar permiso del sistema operativo para notificaciones en el dispositivo.
3. Confirmar que existe `google-services.json` correcto para `com.juan.d.ricardo.t.app`.
4. Confirmar que la credencial FCM V1 del proyecto Firebase fue cargada en `FIREBASE_SERVICE_ACCOUNT_JSON` en Supabase.
5. Confirmar que `push-dispatcher` esta desplegada y que el cron `poslite_push_dispatcher_every_minute` esta activo.
6. Revisar cola y errores en Supabase:

```sql
select
  status,
  attempts,
  last_error,
  created_at,
  sent_at
from notification_push_queue
order by created_at desc
limit 20;
```

```sql
select
  push_provider,
  push_token,
  expo_push_token,
  platform,
  app_version,
  is_active,
  last_seen_at
from user_push_devices
order by last_seen_at desc
limit 20;
```

Interpretacion sugerida:
- `PENDING` permanente: cron/dispatcher no esta procesando
- `FAILED` o `RETRY`: revisar `last_error`
- sin filas en `notification_push_queue`: el trigger no esta encolando push
- `SENT` pero sin notificacion visible: revisar permiso del SO, canal Android, `google-services.json` y token FCM valido
- En Android 13+, si nunca aparecio el prompt o la app no figura con permiso de notificaciones, recompilar/reinstalar por cambio de manifest.

Notas del flujo actual:
- Android intenta registrar token FCM nativo con `expo-notifications.getDevicePushTokenAsync()`.
- Si el token FCM nativo falla, la app puede caer a Expo como fallback, pero el objetivo operativo es `push_provider = 'fcm'` para Android.
- iOS puede seguir usando Expo Push hasta que se implemente APNs directo.
