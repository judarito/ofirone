import { invokeSupabaseEdgeFunction } from '../gateways/edgeFunctionGateway.js';
import { downloadStorageObject } from '../repositories/supabaseServiceRestClient.js';

function parseAiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_nestedError) {
      return null;
    }
  }
}

function normalizeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeInvoiceDraft(parsed = {}) {
  const lineItems = Array.isArray(parsed.line_items) ? parsed.line_items : [];
  return {
    invoice: {
      vendor_name: parsed.invoice?.vendor_name || null,
      invoice_number: parsed.invoice?.invoice_number || null,
      date: parsed.invoice?.date || null,
      currency: parsed.invoice?.currency || null,
      subtotal: normalizeNumber(parsed.invoice?.subtotal),
      tax: normalizeNumber(parsed.invoice?.tax),
      total: normalizeNumber(parsed.invoice?.total),
    },
    line_items: lineItems
      .map((line) => ({
        raw_name: String(line?.raw_name || '').trim(),
        sku: line?.sku ? String(line.sku).trim() : null,
        quantity: Math.max(1, normalizeNumber(line?.quantity, 1)),
        unit_price: normalizeNumber(line?.unit_price),
        line_total: normalizeNumber(line?.line_total),
      }))
      .filter((line) => line.raw_name),
  };
}

function purchaseInvoicePrompt() {
  return `Analiza el texto OCR de una factura y responde JSON con:
{
  "invoice": {
    "vendor_name": "string|null",
    "invoice_number": "string|null",
    "date": "YYYY-MM-DD|null",
    "currency": "string|null",
    "subtotal": number|null,
    "tax": number|null,
    "total": number|null
  },
  "line_items": [
    {
      "raw_name": "string",
      "sku": "string|null",
      "quantity": number,
      "unit_price": number|null,
      "line_total": number|null
    }
  ]
}

Reglas:
- quantity > 0 (si no existe, usa 1).
- Si no puedes inferir un campo, usa null.
- No agregues texto fuera del JSON.
- No inventes lineas o precios no presentes.
- Conserva atributos de variante en raw_name (ej: talla, color, presentacion, capacidad).`;
}

export async function processPurchaseInvoicePhotoJob(job, deps = {}) {
  const { bucket, file_key: fileKey, mime_type: mimeType } = job.payload || {};
  if (!bucket) throw new Error('payload.bucket es requerido para purchase_invoice_photo.');
  if (!fileKey) throw new Error('payload.file_key es requerido para purchase_invoice_photo.');

  const imageBuffer = await downloadStorageObject(bucket, fileKey, {
    ...deps,
    operation: 'downloadPurchaseInvoicePhoto',
  });
  const maxFileBytes = deps.env?.mediaMaxFileBytes || 5 * 1024 * 1024;
  if (imageBuffer.byteLength > maxFileBytes) {
    throw new Error(`La imagen supera el máximo de ${maxFileBytes} bytes permitido para media processing.`);
  }

  const functionName = deps.env?.purchaseInvoiceOcrFunction || 'deepseek-ocr-proxy';
  const ocrResult = await invokeSupabaseEdgeFunction(functionName, {
    model: deps.env?.purchaseInvoiceTextModel || 'deepseek-chat',
    temperature: 0.1,
    max_tokens: 2400,
    image: imageBuffer.toString('base64'),
    mime_type: mimeType || 'image/jpeg',
    prompt: purchaseInvoicePrompt(),
  }, {
    ...deps,
    token: deps.env?.supabaseServiceRoleKey,
    domain: 'media_processing',
    operation: 'purchase_invoice_photo',
    allowedFunctions: deps.env?.allowedImportFunctions || [],
  });

  const parsed = parseAiJson(ocrResult?.content);
  if (!parsed || !Array.isArray(parsed.line_items)) {
    throw new Error('No se pudo parsear la respuesta OCR+IA para la factura.');
  }

  const draft = normalizeInvoiceDraft(parsed);
  if (!draft.line_items.length) {
    throw new Error('La factura se procesó, pero no se detectaron líneas válidas.');
  }

  return {
    phase: 'draft_ready',
    type: 'purchase_invoice_photo',
    bucket,
    file_key: fileKey,
    ocr_text: ocrResult?.ocr_text || null,
    draft,
    model: ocrResult?.model || deps.env?.purchaseInvoiceTextModel || null,
    usage: ocrResult?.usage || null,
  };
}
