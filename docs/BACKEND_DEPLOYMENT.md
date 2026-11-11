# Backend Gateway — despliegue y operación (Núcleo A1)

> Complementa la fase 14A del plan (`docs/OFIRONE_PLAN_MEJORAS.md`). El backend es un
> monolito modular Node ≥20 (HTTP nativo, sin framework) que hoy actúa como capa
> anti-acoplamiento a Supabase y host de workers de colas. **No está desplegado aún**;
> este documento prepara el despliegue y deja la decisión de plataforma contigo.

---

## 1. Qué ejecuta el contenedor

- `node src/server.js` → gateway HTTP (puerto `PORT`, default 8787).
- `node src/worker.js` → worker de colas (`async_jobs`): loop que reclama y procesa
  `import_jobs` y `media_processing` (default). `--once` procesa un lote y termina.

## 2. Variables de entorno (secretos en la plataforma, nunca en el repo)

| Variable | Requerida | Descripción |
|---|---|---|
| `SUPABASE_URL` | sí | URL del proyecto Supabase. |
| `SUPABASE_ANON_KEY` | sí | Key anon (validación JWT + REST con RLS del usuario). |
| `SUPABASE_SERVICE_ROLE_KEY` | sí (worker) | Solo para el worker (claim/complete/fail de jobs). **Nunca** en peticiones de usuario. |
| `CORS_ORIGIN` | no | Origen permitido (default `*`; en prod fija el dominio web). |
| `PORT` | no | Puerto HTTP (default 8787). |
| `WORKER_ID` | no | Identificador de la instancia worker. |
| `WORKER_QUEUES` | no | Colas del worker (default `import_jobs,media_processing`). |
| `WORKER_BATCH_SIZE` / `WORKER_POLL_MS` | no | Lote y polling del worker. |
| `MAX_BODY_BYTES` | no | Límite de body HTTP (default 1 MB). |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | no | Rate limiting por cliente (default 300/60 s). |
| `IMPORT_MAX_FILE_BYTES` / `IMPORT_MAX_ROWS` | no | Topes del import worker (default 10 MB / 5000). |
| `MEDIA_MAX_FILE_BYTES` | no | Tope de descarga de media (default 5 MB). |
| `ALLOWED_AI_FUNCTIONS` / `ALLOWED_IMPORT_FUNCTIONS` | no | Allowlists de Edge Functions invocables. |

Requisito previo de base de datos (aplicar en Supabase antes de usar los flujos nuevos):

- `ADD_AI_TELEMETRY_CORRECTION_FIELDS.sql`
- `ADD_AI_TELEMETRY_COST_SUMMARY_FN.sql`

## 3. Local

```bash
cd backend
npm install
# Terminal 1: gateway
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run dev
# Terminal 2: worker
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run worker
# Healthcheck
curl http://localhost:8787/health
```

## 4. Prueba local (antes de desplegar)

1. Copia las variables y rellénalas con tu Supabase real:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Arranca el gateway y el worker (dos terminales, desde `backend/`):
   ```bash
   npm run dev:local     # gateway en http://localhost:8787
   npm run worker:local  # worker de colas
   ```
3. Smoke test del gateway (no requiere token):
   ```bash
   curl http://localhost:8787/health
   # -> {"status":"ok","service":"ofirone-backend-gateway",...}
   curl -i http://localhost:8787/customers
   # -> HTTP 401 con error estándar (domain/operation/retryable/status)
   ```
4. Probar endpoints con un **token de usuario real** (RLS): inicia sesión en la web
   (localhost), copia el token del header `Authorization` desde DevTools y prueba:
   ```bash
   TOKEN="<access token de supabase-js>"
   curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8787/customers?page=1&page_size=10&search=a"
   curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8787/inventory/stock-balances?location_id=<loc>&page_size=20"
   curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8787/async-jobs/backlog?limit=10"
   curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8787/lookups/document-types"
   ```
5. Adopción gradual desde la web local: crea/edita `web/.env` con
   `VITE_BACKEND_API_URL=http://localhost:8787` y activa un flag a la vez
   (`VITE_USE_BACKEND_LOOKUPS=true` es el piloto más seguro). Los flags deben quedar
   en `false` por defecto en commits y plantillas: `VITE_USE_BACKEND_LOOKUPS`,
   `VITE_USE_BACKEND_IMPORT_JOBS`, `VITE_USE_BACKEND_MEDIA_JOBS`,
   `VITE_USE_BACKEND_CUSTOMERS`, `VITE_USE_BACKEND_INVENTORY` y
   `VITE_AI_TELEMETRY_REMOTE_ENABLED`. El fallback a Supabase directo sigue activo
   si el backend falla.

> Requisito previo en Supabase (aplicar antes de usar flujos que escriban telemetría IA
> o el resumen de costos): `ADD_AI_TELEMETRY_CORRECTION_FIELDS.sql` y
> `ADD_AI_TELEMETRY_COST_SUMMARY_FN.sql`.

## 4c. Cloudflare Workers (solo el gateway)

El gateway HTTP (`routeRequest`) usa `Request`/`Response`/`fetch` nativos, así que puede
correr como **Cloudflare Worker** sin necesidad de Node (`node:http`). Ya está preparado:

- `backend/src/cloudflare/worker-entry.js` (exporta `{ fetch }` y mapea los bindings al env del gateway).
- `backend/wrangler.toml` (nombre, `main`, vars no-secretas; los secretos van por `wrangler secret`).

```bash
cd backend
npx wrangler deploy
# Setear secretos (una vez):
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
# NUNCA pongas SUPABASE_SERVICE_ROLE_KEY en el gateway.
```
- Configura `CORS_ORIGIN` en `[vars]` al dominio web (o `npx wrangler secret put CORS_ORIGIN`).
- Los endpoints disponibles: `/health`, `/lookups/*`, `/customers`, `/inventory/stock-balances`,
  `/sales`, `/purchases`, `/async-jobs/*`, `/media-processing/jobs`, `/ai/functions/*`, `/imports/functions/*`.

**Limitación importante**: el **worker de colas** (imports/media con `xlsx`) **no** es Worker-native
(usa `xlsx` + `Buffer`). Mantenlo en un runtime Node (mismo código con `npm run worker:local` /
Docker) o en un **Cron de Cloudflare** para los media/OCR que no usan xlsx. El gateway en Workers
solo **encola** jobs; quien los procesa puede seguir en Node.

## 4b. Docker

El contexto de build es la **raíz del repo** (el backend importa `shared/` relativo):

```bash
docker build -f backend/Dockerfile -t ofirone-backend-gateway .
docker run --rm -p 8787:8787 --env-file .env ofirone-backend-gateway
# Worker (otra instancia)
docker run --rm --env-file .env ofirone-backend-gateway node src/worker.js
curl http://localhost:8787/health   # -> {"status":"ok",...}
```

## 5. CI/CD

- `.github/workflows/ci.yml` ya corre `backend` (npm ci + npm test) en cada PR/push.
- `.github/workflows/deploy-backend.yml` publica la imagen en GHCR
  (`ghcr.io/<repo>/backend-gateway`) al tocar `backend/**` en `main`, o manual.
  El job `deploy` real está **comentado**: actívalo cuando tengas plataforma y
  rellena el secreto `BACKEND_DEPLOY_HOOK_URL` (o sustituye por tu mecanismo).

## 6. Hosting — opciones y nota

Opciones razonables (servicio con HTTP a la escucha + proceso worker):

- **Railway / Render / Fly.io**: un servicio web (`node src/server.js`) + un worker.
- **VPS + docker compose**: dos servicios (web/worker) detrás de un proxy (Caddy/Nginx) con TLS.
- El **healthcheck** es `GET /health` (200). Ajusta el probe a él.
- Da a la web una URL estable y configura en `web/.env` los flags de adopción gradual
  (`VITE_USE_BACKEND_LOOKUPS/IMPORT_JOBS/MEDIA_JOBS/CUSTOMERS/INVENTORY`,
  `VITE_AI_TELEMETRY_REMOTE_ENABLED`, `VITE_BACKEND_API_URL`).

> **Decisión pendiente (propietario):** elegir la plataforma y la URL pública.
> Al elegirla, activa el job `deploy` del workflow, fija `CORS_ORIGIN` al dominio web
> y comienza la adopción gradual por dominio con los feature flags.
