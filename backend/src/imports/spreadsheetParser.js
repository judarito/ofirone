import { read, utils } from 'xlsx';

const IMPORT_TYPE_PRODUCTS = 'product_variants';
const IMPORT_TYPE_THIRD_PARTIES = 'third_parties';
const DANGEROUS_HEADERS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeHeader(key) {
  return String(key || '')
    .replace(/\s*\*\s*$/, '')
    .trim();
}

function normalizeRows(rawRows) {
  return rawRows.map((row) => Object.entries(row).reduce((normalized, [key, value]) => {
    const header = normalizeHeader(key);
    if (!header || DANGEROUS_HEADERS.has(header.toLowerCase())) return normalized;
    normalized[header] = value;
    return normalized;
  }, Object.create(null)));
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function isInstructionRow(row) {
  return Object.entries(row).some(([key, value]) => {
    if (isBlank(value)) return false;
    const upper = String(key).toUpperCase();
    return upper.includes('INSTRUCCIONES') || upper.includes('INSTRUCTION');
  });
}

function requiredFieldForImport(importType) {
  if (importType === IMPORT_TYPE_PRODUCTS) return 'product_name';
  if (importType === IMPORT_TYPE_THIRD_PARTIES) return 'legal_name';
  return null;
}

function selectSheetName(workbook) {
  return workbook.SheetNames.find((name) => name.toLowerCase() === 'productos')
    ?? workbook.SheetNames.find((name) => name.toLowerCase() === 'terceros')
    ?? workbook.SheetNames[workbook.SheetNames.length - 1];
}

export function parseImportSpreadsheet(buffer, {
  importType,
  maxRows = 5000,
} = {}) {
  const workbook = read(buffer, { type: 'buffer' });
  const sheetName = selectSheetName(workbook);
  const sheet = workbook.Sheets[sheetName];
  const rawRows = utils.sheet_to_json(sheet, { defval: null });
  const rows = normalizeRows(rawRows);
  if (rows.length > maxRows) {
    throw new Error(`El archivo supera el máximo de ${maxRows} filas permitido para importación asíncrona.`);
  }

  const requiredField = requiredFieldForImport(importType);
  const errors = [];
  const validRows = [];
  let skippedRows = 0;

  rows.forEach((row, index) => {
    if (isInstructionRow(row)) {
      skippedRows += 1;
      return;
    }

    const isEmpty = Object.values(row).every(isBlank);
    if (isEmpty) {
      skippedRows += 1;
      return;
    }

    if (requiredField && isBlank(row[requiredField])) {
      errors.push({
        row_number: index + 2,
        detail: `Campo requerido faltante: ${requiredField}`,
        raw_data: row,
      });
      return;
    }

    validRows.push({ row_number: index + 2, data: row });
  });

  return {
    sheetName,
    totalRows: rows.length,
    validRows,
    errors,
    skippedRows,
  };
}
