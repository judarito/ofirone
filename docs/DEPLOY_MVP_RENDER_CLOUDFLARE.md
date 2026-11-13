# Despliegue MVP: Render + Cloudflare Pages

## Qué quedó preparado

- `render.yaml`: servicio Docker para `backend-go` en Render.
- `.github/workflows/deploy-mvp-dev.yml`: tests y build del backend Go y frontend Vue.
- Al hacer push a `dev`, el workflow dispara Render y publica un preview de Cloudflare Pages.

## Configuración única que debe hacer el propietario

En GitHub, repositorio `jricardopro/ofirone` → **Settings → Secrets and variables → Actions**.

Secrets:

- `RENDER_DEPLOY_HOOK`: Deploy Hook del servicio `ofirone-api` en Render.
- `CLOUDFLARE_API_TOKEN`: token con permiso de editar Pages.
- `CLOUDFLARE_ACCOUNT_ID`: ID de la cuenta Cloudflare.
- `CLOUDFLARE_PAGES_PROJECT_NAME`: nombre del proyecto Pages.
- `VITE_BACKEND_API_URL`: URL pública de Render, por ejemplo `https://ofirone-api.onrender.com`.

En Render, configurar estas variables en el servicio:

- `DATABASE_URL`: conexión PostgreSQL de producción o staging.
- `CORS_ALLOWED_ORIGINS`: URL del frontend Cloudflare Pages.
- `APP_ENV=production`.
- `PORT=8080`.

En Cloudflare Pages → `ofirone-web` → **Settings → Environment variables**,
configurar para **Production** y **Preview** las siguientes variables de build.
Después de cambiarlas hay que crear un nuevo deployment; las variables `VITE_*`
quedan embebidas en el JavaScript durante el build.

```text
VITE_BACKEND_API_URL=https://ofirone-api.onrender.com
VITE_USE_BACKEND_AUTH=true
VITE_USE_BACKEND_CUSTOMERS=true
VITE_USE_BACKEND_TENANT_CONFIG=true
VITE_USE_BACKEND_LOOKUPS=true
VITE_USE_BACKEND_MASTERS=true
VITE_USE_BACKEND_CATALOG=true
VITE_USE_BACKEND_INVENTORY=true
VITE_USE_BACKEND_POS_CONTEXT=true
VITE_USE_BACKEND_PURCHASES=true
VITE_USE_BACKEND_SALES=true
VITE_USE_BACKEND_CXC=true
VITE_USE_BACKEND_REPORTS=true
VITE_USE_BACKEND_ALERTS=true
VITE_USE_BACKEND_PRICING=true
VITE_USE_BACKEND_IMPORT_JOBS=false
VITE_USE_BACKEND_MEDIA_JOBS=false
```

No es necesario configurar `VITE_SUPABASE_URL` ni `VITE_SUPABASE_ANON_KEY`
para el MVP Go. Si se dejan activos módulos sin su flag correspondiente,
esos módulos pueden continuar usando el camino legacy de Supabase.

## Activación

```bash
git push jricardopro dev
```

El workflow ejecuta primero pruebas. Si fallan, no despliega. La rama `dev` publica un preview de Pages; la promoción a producción se debe hacer después de validar el MVP.
