import { downloadStorageObject, serviceRestRequest } from '../repositories/supabaseServiceRestClient.js';
import { applyProductImportRow } from './productImportApplier.js';
import { parseImportSpreadsheet } from './spreadsheetParser.js';
import { applyThirdPartyImportRow } from './thirdPartyImportApplier.js';

const DATAIMPORT_BUCKET = 'dataimport';
const MAX_PREVIEW_ERRORS = 200;

async function getBulkImport(importId, deps) {
  const rows = await serviceRestRequest(
    `/bulk_imports?select=*&import_id=eq.${encodeURIComponent(importId)}&limit=1`,
    { ...deps, operation: 'getBulkImport' },
  );
  return rows?.[0] || null;
}

async function updateBulkImport(importId, patch, deps) {
  return serviceRestRequest(
    `/bulk_imports?import_id=eq.${encodeURIComponent(importId)}`,
    {
      ...deps,
      method: 'PATCH',
      body: patch,
      prefer: 'return=representation',
      operation: 'updateBulkImport',
    },
  );
}

async function replaceImportErrors(importId, errors, deps) {
  await serviceRestRequest(
    `/bulk_import_errors?import_id=eq.${encodeURIComponent(importId)}`,
    { ...deps, method: 'DELETE', operation: 'deleteBulkImportErrors' },
  );

  if (!errors.length) return [];

  return serviceRestRequest('/bulk_import_errors', {
    ...deps,
    method: 'POST',
    body: errors.slice(0, MAX_PREVIEW_ERRORS).map((error) => ({
      import_id: importId,
      row_number: error.row_number,
      detail: error.detail,
      raw_data: error.raw_data,
    })),
    prefer: 'return=representation',
    operation: 'insertBulkImportErrors',
  });
}

export async function processBulkImportJob(job, deps = {}) {
  const importId = job.payload?.import_id;
  if (!importId) throw new Error('payload.import_id es requerido para bulk_import_process.');

  const importRecord = await getBulkImport(importId, deps);
  if (!importRecord) throw new Error(`Importación no encontrada: ${importId}.`);
  if (importRecord.tenant_id !== job.tenant_id) {
    throw new Error('El tenant del job no coincide con la importación.');
  }

  await updateBulkImport(importId, {
    status: 'processing',
    updated_at: new Date().toISOString(),
  }, deps);

  const fileBuffer = await downloadStorageObject(DATAIMPORT_BUCKET, importRecord.file_key, {
    ...deps,
    operation: 'downloadBulkImportFile',
  });
  const maxFileBytes = deps.env?.importMaxFileBytes || 10 * 1024 * 1024;
  if (fileBuffer.byteLength > maxFileBytes) {
    throw new Error(`El archivo supera el máximo de ${maxFileBytes} bytes permitido para importación asíncrona.`);
  }

  const parsed = parseImportSpreadsheet(fileBuffer, {
    importType: importRecord.import_type,
    maxRows: deps.env?.importMaxRows || 5000,
  });

  if (job.job_type === 'bulk_import_apply_products') {
    return applyProductImport(importRecord, parsed, deps);
  }

  if (job.job_type === 'bulk_import_apply_third_parties') {
    return applyThirdPartyImport(importRecord, parsed, deps);
  }

  await replaceImportErrors(importId, parsed.errors, deps);

  const summary = {
    phase: 'preview_ready',
    sheetName: parsed.sheetName,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows.length,
    invalidRows: parsed.errors.length,
    skippedRows: parsed.skippedRows,
    preview: parsed.validRows.slice(0, 20),
    maxPreviewErrors: MAX_PREVIEW_ERRORS,
  };

  await updateBulkImport(importId, {
    status: 'completed',
    row_count: parsed.totalRows,
    processed_count: 0,
    error_count: parsed.errors.length,
    summary,
    updated_at: new Date().toISOString(),
  }, deps);

  return summary;
}

async function applyProductImport(importRecord, parsed, deps) {
  if (importRecord.import_type !== 'product_variants') {
    throw new Error('bulk_import_apply_products solo soporta import_type=product_variants.');
  }

  let processed = 0;
  const applyErrors = [...parsed.errors];

  for (const row of parsed.validRows) {
    try {
      await applyProductImportRow(row.data, importRecord.tenant_id, deps);
      processed += 1;
    } catch (error) {
      applyErrors.push({
        row_number: row.row_number,
        detail: error?.message || String(error),
        raw_data: row.data,
      });
    }
  }

  await replaceImportErrors(importRecord.import_id, applyErrors, deps);

  const finalStatus = processed > 0 ? 'completed' : 'failed';
  const summary = {
    phase: 'imported',
    sheetName: parsed.sheetName,
    totalRows: parsed.totalRows,
    processed,
    errors: applyErrors.length,
    skippedRows: parsed.skippedRows,
  };

  await updateBulkImport(importRecord.import_id, {
    status: finalStatus,
    row_count: parsed.totalRows,
    processed_count: processed,
    error_count: applyErrors.length,
    summary,
    updated_at: new Date().toISOString(),
  }, deps);

  return summary;
}

async function applyThirdPartyImport(importRecord, parsed, deps) {
  if (importRecord.import_type !== 'third_parties') {
    throw new Error('bulk_import_apply_third_parties solo soporta import_type=third_parties.');
  }

  let processed = 0;
  const applyErrors = [...parsed.errors];

  for (const row of parsed.validRows) {
    try {
      await applyThirdPartyImportRow(row.data, importRecord.tenant_id, deps);
      processed += 1;
    } catch (error) {
      applyErrors.push({
        row_number: row.row_number,
        detail: error?.message || String(error),
        raw_data: row.data,
      });
    }
  }

  await replaceImportErrors(importRecord.import_id, applyErrors, deps);

  const finalStatus = processed > 0 ? 'completed' : 'failed';
  const summary = {
    phase: 'imported',
    sheetName: parsed.sheetName,
    totalRows: parsed.totalRows,
    processed,
    errors: applyErrors.length,
    skippedRows: parsed.skippedRows,
  };

  await updateBulkImport(importRecord.import_id, {
    status: finalStatus,
    row_count: parsed.totalRows,
    processed_count: processed,
    error_count: applyErrors.length,
    summary,
    updated_at: new Date().toISOString(),
  }, deps);

  return summary;
}
