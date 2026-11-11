import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { utils, write } from 'xlsx';
import { parseImportSpreadsheet } from './spreadsheetParser.js';

function workbookBuffer(sheetName, rows) {
  const workbook = utils.book_new();
  const worksheet = utils.json_to_sheet(rows);
  utils.book_append_sheet(workbook, worksheet, sheetName);
  return write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('spreadsheet import parser', () => {
  it('normaliza encabezados y valida productos', () => {
    const buffer = workbookBuffer('productos', [
      { 'product_name *': 'Camisa', unit_price: 45000 },
      { 'product_name *': '', unit_price: 30000 },
      { INSTRUCCIONES: 'No importar esta fila' },
    ]);

    const result = parseImportSpreadsheet(buffer, { importType: 'product_variants' });

    assert.equal(result.sheetName, 'productos');
    assert.equal(result.totalRows, 3);
    assert.equal(result.validRows.length, 1);
    assert.equal(result.validRows[0].data.product_name, 'Camisa');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].detail, /product_name/);
    assert.equal(result.skippedRows, 1);
  });

  it('valida terceros por legal_name', () => {
    const buffer = workbookBuffer('terceros', [
      { legal_name: 'Proveedor Demo', document_number: '900123' },
      { legal_name: null, document_number: '123' },
    ]);

    const result = parseImportSpreadsheet(buffer, { importType: 'third_parties' });

    assert.equal(result.validRows.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].detail, /legal_name/);
  });

  it('limita filas y descarta headers peligrosos', () => {
    const buffer = workbookBuffer('productos', [
      { product_name: 'Camisa', __proto__: 'polluted', constructor: 'bad' },
    ]);

    assert.throws(
      () => parseImportSpreadsheet(buffer, { importType: 'product_variants', maxRows: 0 }),
      /máximo de 0 filas/,
    );

    const result = parseImportSpreadsheet(buffer, { importType: 'product_variants' });
    assert.equal(result.validRows.length, 1);
    assert.equal(Object.hasOwn(result.validRows[0].data, 'constructor'), false);
  });
});
