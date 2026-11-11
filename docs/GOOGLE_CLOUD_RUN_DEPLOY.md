# Despliegue en Google Cloud Run (alternativa free para el worker Docker)

> Cloud Run ejecuta **contenedores Docker** (a diferencia de Cloudflare Workers) y tiene
> **scale-to-zero** (no pagas mientras no hay uso). Para que quede dentro del free tier,
> el **worker** no debe ser un loop persistente: se corre como **Cloud Run Job** (`--once`)
> disparado por **Cloud Scheduler** solo cuando toca procesar.
>
> Precios/free (verifica siempre en las páginas oficiales, varían por región):
> - Cloud Run: free tier mensual en vCPU-seconds y GiB-seconds + requests → https://cloud.google.com/run/pricing
> - Cloud Scheduler: primeros 3 jobs gratis → https://cloud.google.com/scheduler/pricing

## Arquitectura recomendada (casi todo free)

```
Web (Vue, hosting estático/free)
   │
   ├── Supabase free (DB, Auth, Edge Functions OCR/IA, Storage)
   ├── Gateway HTTP  → Cloudflare Workers free   (worker-entry.js)   [alternativa: Cloud Run service]
   └── Worker de colas → Cloud Run Job (Docker) `worker --once`
                          disparado por Cloud Scheduler (cada N min)
```

- El **gateway** ya está listo para Cloudflare Workers free (no usa Docker). Si prefieres un
  solo runtime, el **mismo Dockerfile** corre el gateway como **Cloud Run service**.
- El **worker** (imports `xlsx` / media) corre como **Cloud Run Job**: levanta solo, procesa
  un lote y muere (`--once`) → cae dentro del free tier para poco volumen.

## Deploy con un solo script (todo en Cloud Run)

Preparados en el repo:

- `cloudbuild.yaml` (raíz): build de la imagen (contexto raíz, `backend/Dockerfile`).
- `scripts/deploy-gcp.sh`: crea el **service** del gateway + el **job** del worker + el **Cloud Scheduler**.

```bash
# Desde la raíz del repo, con gcloud autenticado:
PROJECT_ID=mi-proyecto \
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_ANON_KEY=eyJ... \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
CORS_ORIGIN=https://tu-web \
bash scripts/deploy-gcp.sh
```

Lo que hace:
1. Habilita `run`, `artifactregistry`, `scheduler`.
2. Crea el repo de Artifact Registry y sube la imagen (`cloudbuild.yaml`).
3. `gcloud run deploy ofirone-gateway` → Cloud Run **service** (HTTP, escala a cero).
4. `gcloud run jobs create ofirone-worker` (`node src/worker.js --once`) + una ejecución de prueba.
5. Crea el **Cloud Scheduler** (cron `*/5 * * * *`) que ejecuta el job del worker.

Notas:
- Cloud Run **inyecta `PORT=8080` automáticamente**; nuestro `server.js` respeta `PORT` → no hace falta fijarlo.
- La `SERVICE_ROLE_KEY` se envía **solo al job** del worker (nunca al gateway).
- Opcionales: `REGION`, `CRON`, `IMAGE`, `SA_EMAIL` (para el Scheduler).

## Prerrequisitos

```bash
gcloud auth login
gcloud config set project <TU-PROYECTO-GCP>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com scheduler.googleapis.com
```

## A) Gateway como Cloud Run service (opcional; alternativa a CF Workers)

Desde la **raíz del repo** (nuestro Dockerfile usa contexto raíz y expone el puerto vía `PORT`):

```bash
gcloud run deploy ofirone-gateway \
  --source . --dockerfile backend/Dockerfile \
  --region us-central1 --allow-unauthenticated \
  --set-env-vars PORT=8080,CORS_ORIGIN=https://tu-dominio-web \
  --set-env-vars ALLOWED_AI_FUNCTIONS=deepseek-proxy,deepseek-ocr-proxy,ops-rag-agent,chat-order-parser \
  --set-env-vars ALLOWED_IMPORT_FUNCTIONS=product-photo-parser,product-photo-analyzer,deepseek-ocr-proxy
```

Secretos (Supabase) en vez de `--set-env-vars` planos, usa Secret Manager o `--set-secrets`.

> El gateway autentica con el **token del usuario** (RLS). No pongas SERVICE_ROLE aquí.

## B) Worker como Cloud Run Job

```bash
gcloud run jobs create ofirone-worker \
  --source . --dockerfile backend/Dockerfile \
  --region us-central1 \
  --command node \
  --args src/worker.js,--once \
  --set-env-vars SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...
  # IMPORTANTE: SERVICE_ROLE solo aquí (claim/complete/fail de async_jobs)
```

Probar un lote a mano:

```bash
gcloud run jobs execute ofirone-worker --region us-central1
```

### Programar con Cloud Scheduler (cada 5 min, gratis en los primeros jobs)

```bash
gcloud scheduler jobs create http ofirone-worker-cron \
  --schedule "*/5 * * * *" \
  --location us-central1 \
  --uri "https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/<PROYECTO>/jobs/ofirone-worker:run" \
  --http-method POST \
  --oauth-service-account-email <SA-con-rol-run-invoker@<PROYECTO>.iam.gserviceaccount.com> \
  --oauth-token-scope https://www.googleapis.com/auth/cloud-platform
```

## CI/CD (GitHub Actions)

`.github/workflows/deploy-cloudrun.yml`: corre los tests del backend y, si pasan, ejecuta
`scripts/deploy-gcp.sh` (con `RUN_TEST_JOB=0`) al tocar `backend/**` en `main` (o manual).

Secretos de GitHub (Settings → Secrets and variables → Actions):

- `GCP_SA_KEY` — JSON de una Service Account con `roles/run.admin`, `roles/artifactregistry.admin`,
  `roles/cloudscheduler.admin` y `roles/iam.serviceAccountUser` (la generas con
  `gcloud iam service-accounts keys create`).
- `GCP_PROJECT_ID`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGIN`

Variable de repo opcional: `GCP_REGION` (default `us-central1`).

> Recomendación de seguridad: los secrets de Supabase se envían como env vars del deploy.
> Para producción, muévelos a **Secret Manager** y usa `--set-secrets`.

## Notas

- **Cloud Run Jobs scale-to-zero**: cada ejecución arranca el contenedor, procesa `--once`
  (una cola de lotes) y termina; si no hay jobs, `worker --once` sale en segundos.
- **Persistencia**: los disk del contenedor son efímeros; todo el estado vive en Supabase
  (`async_jobs`/`bulk_imports`/`media_processing`) → idempotencia y reintentos ya cubiertos.
- **Límite por ejecución**: 60 min por tarea (Cloud Run Jobs). Un lote grande de import puede
  necesitar paginación del worker (`WORKER_BATCH_SIZE`).
- Alternativa sin GCP: **GitHub Actions cron** (`node src/worker.js --once`) cubre el mismo
  caso a volumen bajo y sin configurar GCP.
