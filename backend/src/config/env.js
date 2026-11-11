export function getEnv(source = process.env) {
  return {
    port: Number(source.PORT || 8787),
    supabaseUrl: source.SUPABASE_URL || '',
    supabaseAnonKey: source.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY || '',
    corsOrigin: source.CORS_ORIGIN || '*',
    workerId: source.WORKER_ID || `ofirone-worker-${process.pid}`,
    workerQueues: parseCsv(source.WORKER_QUEUES || 'import_jobs,media_processing'),
    workerBatchSize: Number(source.WORKER_BATCH_SIZE || 5),
    workerPollMs: Number(source.WORKER_POLL_MS || 5000),
    importMaxFileBytes: Number(source.IMPORT_MAX_FILE_BYTES || 10 * 1024 * 1024),
    importMaxRows: Number(source.IMPORT_MAX_ROWS || 5000),
    mediaMaxFileBytes: Number(source.MEDIA_MAX_FILE_BYTES || 5 * 1024 * 1024),
    maxBodyBytes: Number(source.MAX_BODY_BYTES || 1024 * 1024),
    rateLimitMax: Number(source.RATE_LIMIT_MAX || 300),
    rateLimitWindowMs: Number(source.RATE_LIMIT_WINDOW_MS || 60_000),
    purchaseInvoiceOcrFunction: source.PURCHASE_INVOICE_OCR_FUNCTION || 'deepseek-ocr-proxy',
    purchaseInvoiceTextModel:
      source.PURCHASE_INVOICE_TEXT_MODEL || source.DEEPSEEK_TEXT_MODEL || 'deepseek-chat',
    productCatalogPhotoFunction: source.PRODUCT_CATALOG_PHOTO_FUNCTION || 'product-photo-parser',
    productCatalogPhotoModel:
      source.PRODUCT_CATALOG_PHOTO_MODEL || source.DEEPSEEK_TEXT_MODEL || 'deepseek-chat',
    allowedAiFunctions: parseCsv(
      source.ALLOWED_AI_FUNCTIONS ||
        'deepseek-proxy,deepseek-ocr-proxy,ops-rag-agent,chat-order-parser'
    ),
    allowedImportFunctions: parseCsv(
      source.ALLOWED_IMPORT_FUNCTIONS ||
        'product-photo-parser,product-photo-analyzer,deepseek-ocr-proxy'
    ),
  };
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
