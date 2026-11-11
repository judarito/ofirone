# Ofirone Backend Gateway

Backend gateway incremental para desacoplar clientes de llamadas directas a Supabase.

## Estado actual

- Runtime: Node.js 20 con HTTP nativo.
- Sin dependencias externas iniciales.
- Healthcheck: `GET /health`.
- Lookups piloto:
  - `GET /lookups/document-types`
  - `GET /lookups/departments`
  - `GET /lookups/cities?department_id=...`
- AI Gateway:
  - `POST /ai/functions/:functionName`
  - Solo permite funciones incluidas en `ALLOWED_AI_FUNCTIONS`.
- Import Gateway:
  - `POST /imports/functions/:functionName`
  - Solo permite funciones incluidas en `ALLOWED_IMPORT_FUNCTIONS`.
- Async Jobs:
  - `GET /async-jobs/backlog`
  - `GET /async-jobs/history?queues=import_jobs,media_processing&limit=50`
  - `POST /async-jobs`
  - Worker: consume `async_jobs` por RPC con `SUPABASE_SERVICE_ROLE_KEY`.
- Media Processing:
  - `POST /media-processing/jobs`
  - Encola trabajos en `async_jobs.queue = "media_processing"` con contrato compartido en `shared/media`.
  - Worker inicial `purchase_invoice_photo`: descarga imagen, invoca OCR permitido y guarda draft en `async_jobs.result`.
  - Worker inicial `product_catalog_photo`: descarga imagen, invoca parser de productos y guarda draft en `async_jobs.result`.
- Import Engine:
  - Handler `bulk_import_process`.
  - Descarga archivos del bucket `dataimport`.
  - Parsea XLSX/CSV con SheetJS.
  - Genera preview en `bulk_imports.summary`.
  - Registra errores de validación en `bulk_import_errors`.
  - Aplica límites `IMPORT_MAX_FILE_BYTES` y `IMPORT_MAX_ROWS`.
  - `bulk_import_process` deja `summary.phase = "preview_ready"`.
  - `bulk_import_apply_products` crea/actualiza productos, variantes y stock inicial.
  - `bulk_import_apply_third_parties` crea/actualiza terceros usando `fn_upsert_third_party`.
- Validación de sesión: el gateway valida el JWT consultando `Supabase Auth /auth/v1/user`.
- Acceso a datos: REST de Supabase usando el JWT del usuario, conservando RLS.
- Edge Functions: llamadas con `Authorization: Bearer <user-jwt>` y `apikey: <anon-key>`, manteniendo el modelo de seguridad de Supabase.

## Variables

Ver `.env.example`.

```bash
PORT=8787
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CORS_ORIGIN=http://localhost:5173
WORKER_ID=ofirone-worker-local
WORKER_QUEUES=import_jobs,ai_jobs,media_processing,report_jobs
WORKER_BATCH_SIZE=5
WORKER_POLL_MS=5000
IMPORT_MAX_FILE_BYTES=10485760
IMPORT_MAX_ROWS=5000
MEDIA_MAX_FILE_BYTES=5242880
PURCHASE_INVOICE_OCR_FUNCTION=deepseek-ocr-proxy
PURCHASE_INVOICE_TEXT_MODEL=deepseek-chat
PRODUCT_CATALOG_PHOTO_FUNCTION=product-photo-parser
PRODUCT_CATALOG_PHOTO_MODEL=deepseek-chat
ALLOWED_AI_FUNCTIONS=deepseek-proxy,deepseek-ocr-proxy,ops-rag-agent,chat-order-parser
ALLOWED_IMPORT_FUNCTIONS=product-photo-parser,product-photo-analyzer,deepseek-ocr-proxy
```

## Comandos

```bash
npm test
npm run dev
npm start
npm run worker:once
npm run worker
```
