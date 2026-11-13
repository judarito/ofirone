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

## Activación

```bash
git push jricardopro dev
```

El workflow ejecuta primero pruebas. Si fallan, no despliega. La rama `dev` publica un preview de Pages; la promoción a producción se debe hacer después de validar el MVP.
