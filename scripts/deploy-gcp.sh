#!/usr/bin/env bash
# =============================================================================
# Despliegue "todo en Cloud Run" — OfirOne backend
#
#  Crea: 1) Cloud Run SERVICE "ofirone-gateway" (node src/server.js)
#        2) Cloud Run JOB   "ofirone-worker"  (node src/worker.js --once)
#        3) Cloud Scheduler cada X min que ejecuta el job del worker
#
#  Uso (desde la raíz del repo, con gcloud autenticado):
#    PROJECT_ID=mi-proyecto \
#    SUPABASE_URL=https://xxx.supabase.co \
#    SUPABASE_ANON_KEY=eyJ... \
#    SUPABASE_SERVICE_ROLE_KEY=eyJ... \
#    CORS_ORIGIN=https://tu-web \
#    bash scripts/deploy-gcp.sh
#
#  Opcionales: REGION (us-central1), CRON ("*/5 * * * *"), IMAGE (tag).
#  El gateway NO recibe SERVICE_ROLE; el job del worker sí (claim/fail de jobs).
# =============================================================================
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?PROJECT_ID requerido (gcloud config set project ...)}"
REGION="${REGION:-us-central1}"
CORS_ORIGIN="${CORS_ORIGIN:?CORS_ORIGIN requerido (dominio de la web)}"
SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL requerido}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY requerido}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY requerido (solo worker)}"
CRON="${CRON:-*/5 * * * *}"
IMAGE="${IMAGE:-$REGION-docker.pkg.dev/$PROJECT_ID/ofirone/backend:latest}"
WORKER_QUEUES="${WORKER_QUEUES:-import_jobs,media_processing}"
SA_EMAIL="${SA_EMAIL:-$PROJECT_ID-compute@developer.gserviceaccount.com}"

echo "==> Proyecto: $PROJECT_ID ($REGION) | Imagen: $IMAGE"

echo "==> Habilitando APIs (run, artifactregistry, scheduler)..."
gcloud services enable run.googleapis.com artifactregistry.googleapis.com scheduler.googleapis.com --project "$PROJECT_ID" >/dev/null 2>&1 || true

echo "==> Creando repo de Artifact Registry (si no existe)..."
gcloud artifacts repositories create ofirone \
  --repository-format docker \
  --location "$REGION" \
  --project "$PROJECT_ID" >/dev/null 2>&1 || echo "    (repo ya existente)"

echo "==> Build + push de la imagen (Cloud Build)..."
gcloud builds submit . \
  --config cloudbuild.yaml \
  --substitutions "_IMAGE=$IMAGE" \
  --project "$PROJECT_ID" >/dev/null

echo "==> Deploy: Cloud Run SERVICE ofirone-gateway..."
gcloud run deploy ofirone-gateway \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --timeout 60 \
  --project "$PROJECT_ID" \
  --set-env-vars \
    "SUPABASE_URL=$SUPABASE_URL,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,CORS_ORIGIN=$CORS_ORIGIN" \
  --quiet

echo "==> Deploy: Cloud Run JOB ofirone-worker (node src/worker.js --once)..."
gcloud run jobs create ofirone-worker \
  --image "$IMAGE" \
  --region "$REGION" \
  --command node \
  --args 'src/worker.js,--once' \
  --task-timeout 1200 \
  --project "$PROJECT_ID" \
  --set-env-vars \
    "SUPABASE_URL=$SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY,WORKER_QUEUES=$WORKER_QUEUES,WORKER_ID=ofirone-worker-cloudrun" \
  --quiet || echo "    (job ya existente; omite create)"

if [[ "${RUN_TEST_JOB:-1}" == "1" ]]; then
  echo "==> Ejecución de prueba del worker (1 lote)..."
  gcloud run jobs execute ofirone-worker --region "$REGION" --project "$PROJECT_ID" --wait --quiet || true
else
  echo "==> (RUN_TEST_JOB=0) se omite la ejecución de prueba del worker."
fi

echo "==> Programando Cloud Scheduler (cada $CRON)..."
gcloud run jobs add-iam-policy-binding ofirone-worker \
  --region "$REGION" \
  --member "serviceAccount:$SA_EMAIL" \
  --role roles/run.invoker \
  --project "$PROJECT_ID" --quiet >/dev/null 2>&1 || true

gcloud scheduler jobs create http ofirone-worker-cron \
  --schedule "$CRON" \
  --location "$REGION" \
  --time-zone "UTC" \
  --uri "https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/ofirone-worker:run" \
  --http-method POST \
  --oauth-service-account-email "$SA_EMAIL" \
  --oauth-token-scope https://www.googleapis.com/auth/cloud-platform \
  --project "$PROJECT_ID" --quiet || echo "    (scheduler ya existente)"

GATEWAY_URL="https://ofirone-gateway-$(echo "$PROJECT_ID" | tr ':' '-').$REGION.run.app"
echo
echo "✅ Listo. Gateway: $GATEWAY_URL"
echo "   Healthcheck: $GATEWAY_URL/health"
echo "   Para la web (.env): VITE_BACKEND_API_URL=$GATEWAY_URL"
echo "   Siguiente: ajusta CORS_ORIGIN si cambiaste el dominio, y verifica logs:"
echo "   gcloud run services logs read ofirone-gateway --region $REGION"
echo "   gcloud run jobs executions list --region $REGION --job ofirone-worker"
