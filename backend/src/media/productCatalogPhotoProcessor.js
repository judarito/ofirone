import { invokeSupabaseEdgeFunction } from '../gateways/edgeFunctionGateway.js';
import { downloadStorageObject } from '../repositories/supabaseServiceRestClient.js';

function cleanString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeDraftRow(row = {}, index = 0) {
  return {
    local_id: `worker_${Date.now()}_${index}`,
    product_name: cleanString(row.product_name),
    variant_name: cleanString(row.variant_name, 'Predeterminada') || 'Predeterminada',
    category_name: cleanString(row.category_name),
    unit_price: row.unit_price == null ? '' : String(row.unit_price),
    unit_cost: row.unit_cost == null ? '' : String(row.unit_cost),
    initial_stock: row.initial_stock == null ? '' : String(row.initial_stock),
    notes: cleanString(row.notes),
    confidence: Number(row.confidence || 0),
  };
}

function normalizeParsedPhotoProducts(payload = {}) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  return {
    rows: products
      .map(normalizeDraftRow)
      .filter((row) => row.product_name),
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    ocrText: cleanString(payload?.ocr_text) || null,
    model: payload?.model ? String(payload.model) : null,
    usage: payload?.usage || null,
  };
}

export async function processProductCatalogPhotoJob(job, deps = {}) {
  const { bucket, file_key: fileKey, mime_type: mimeType } = job.payload || {};
  if (!bucket) throw new Error('payload.bucket es requerido para product_catalog_photo.');
  if (!fileKey) throw new Error('payload.file_key es requerido para product_catalog_photo.');

  const imageBuffer = await downloadStorageObject(bucket, fileKey, {
    ...deps,
    operation: 'downloadProductCatalogPhoto',
  });
  const maxFileBytes = deps.env?.mediaMaxFileBytes || 5 * 1024 * 1024;
  if (imageBuffer.byteLength > maxFileBytes) {
    throw new Error(`La imagen supera el máximo de ${maxFileBytes} bytes permitido para media processing.`);
  }

  const functionName = deps.env?.productCatalogPhotoFunction || 'product-photo-parser';
  const parserResult = await invokeSupabaseEdgeFunction(functionName, {
    image: imageBuffer.toString('base64'),
    mime_type: mimeType || 'image/jpeg',
    model: deps.env?.productCatalogPhotoModel || 'deepseek-chat',
    temperature: 0.1,
    max_tokens: 2200,
  }, {
    ...deps,
    token: deps.env?.supabaseServiceRoleKey,
    domain: 'media_processing',
    operation: 'product_catalog_photo',
    allowedFunctions: deps.env?.allowedImportFunctions || [],
  });

  const draft = normalizeParsedPhotoProducts(parserResult);
  if (!draft.rows.length) {
    throw new Error('La foto se procesó, pero no se detectaron productos válidos.');
  }

  return {
    phase: 'draft_ready',
    type: 'product_catalog_photo',
    bucket,
    file_key: fileKey,
    ocr_text: draft.ocrText,
    draft,
    model: draft.model || deps.env?.productCatalogPhotoModel || null,
    usage: draft.usage,
  };
}
