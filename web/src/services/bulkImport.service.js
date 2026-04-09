import { supabase } from '@/plugins/supabase'
import productsService from './products.service'
import categoriesService from './categories.service'
import inventoryService from './inventory.service'
import thirdPartiesService from './thirdParties.service'
import { read, utils } from 'xlsx'

const IMPORT_TYPE_PRODUCTS = 'product_variants'
const IMPORT_TYPE_THIRD_PARTIES = 'third_parties'

export async function processBulkImport(importRecord) {
  if (!importRecord || importRecord.status !== 'pending') {
    throw new Error('Registro no válido o ya procesado')
  }

  await supabase.from('bulk_imports').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('import_id', importRecord.import_id)

  const fileResponse = await supabase.storage
    .from('dataimport')
    .download(importRecord.file_key)

  if (!fileResponse.data) {
    throw new Error('No se pudo descargar el archivo')
  }

  const workbook = read(await fileResponse.data.arrayBuffer(), { type: 'array' })
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'productos')
    ?? workbook.SheetNames.find(n => n.toLowerCase() === 'terceros')
    ?? workbook.SheetNames[workbook.SheetNames.length - 1]
  const sheet = workbook.Sheets[sheetName]
  const rawRows = utils.sheet_to_json(sheet, { defval: null })
  // Normalize column headers: strip trailing ' *' and surrounding whitespace
  // so templates can mark required fields visually without breaking key lookup
  const rows = rawRows.map(row => {
    const normalized = {}
    for (const [key, val] of Object.entries(row)) {
      const cleanKey = key.replace(/\s*\*\s*$/, '').trim()
      normalized[cleanKey] = val
    }
    return normalized
  })

  let processed = 0
  let errors = 0
  const tenantId = importRecord.tenant_id

  for (const [index, row] of rows.entries()) {
    // Ignorar filas de instrucciones o completamente vacías
    const isInstructionRow = Object.keys(row).some(k =>
      k.toUpperCase().includes('INSTRUCCIONES') || k.toUpperCase().includes('INSTRUCTION')
    )
    const hasProductName = importRecord.import_type === IMPORT_TYPE_PRODUCTS
      ? Boolean(row.product_name?.toString().trim())
      : Boolean(row.legal_name?.toString().trim())

    if (isInstructionRow || !hasProductName) continue

    try {
      if (importRecord.import_type === IMPORT_TYPE_PRODUCTS) {
        await handleProductRow(row, tenantId)
      } else if (importRecord.import_type === IMPORT_TYPE_THIRD_PARTIES) {
        await handleThirdPartyRow(row, tenantId)
      }

      processed += 1
    } catch (error) {
      await supabase.from('bulk_import_errors').insert({
        import_id: importRecord.import_id,
        row_number: index + 2,
        detail: error.message,
        raw_data: row
      })
      errors += 1
    }
  }

  const finalStatus = processed === 0 && errors > 0
    ? 'failed'
    : errors > 0
      ? 'completed_with_errors'
      : 'completed'
  await supabase.from('bulk_imports').update({
    status: finalStatus,
    processed_count: processed,
    error_count: errors,
    summary: { processed, errors },
    updated_at: new Date().toISOString()
  }).eq('import_id', importRecord.import_id)
}

async function handleProductRow(row, tenantId) {
  if (!tenantId) {
    throw new Error('tenant_id faltante en el registro de importación')
  }

  // Normaliza valores que Excel puede entregar como boolean nativo o como string
  const toBool = (val, defaultVal = false) => {
    if (val === true || val === 'TRUE' || val === 'true' || val === 1) return true
    if (val === false || val === 'FALSE' || val === 'false' || val === 0) return false
    return defaultVal
  }

  const payload = {
    product_name: row.product_name,
    category_name: row.category_name,
    unit_code: row.unit_code,
    description: row.description,
    variant_name: row.variant_name || 'Predeterminada',
    initial_stock: parseFloat(row.initial_stock) || 0,
    unit_cost: parseFloat(row.unit_cost) || 0,
    unit_price: parseFloat(row.unit_price) || 0,
    tax_code: row.tax_code || null,
    price_includes_tax: toBool(row.price_includes_tax),
    inventory_type: row.inventory_type || 'REVENTA',
    is_active: !(row.is_active === false || row.is_active === 'FALSE' || row.is_active === 'false' || row.is_active === 0),
    control_expiration: toBool(row.control_expiration),
    is_component: toBool(row.is_component),
    location_code: row.location_code,
    standard_code: row.standard_code?.toString().trim() || null,
    standard_code_type: row.standard_code_type?.toString().trim() || 'UNSPSC'
  }

  const category = await categoriesService.findOrCreateByName(tenantId, payload.category_name)
  payload.category_id = category?.category_id

  const productResult = await productsService.createOrUpdateSimpleProduct(tenantId, payload)

  if (payload.initial_stock > 0 && payload.location_code) {
    await inventoryService.adjustInitialStock({
      tenant_id: tenantId,
      location_code: payload.location_code,
      variant_id: productResult.variant_id,
      quantity: payload.initial_stock,
      unit_cost: payload.unit_cost
    })
  }
}

async function handleThirdPartyRow(row, tenantId) {
  if (!tenantId) {
    throw new Error('tenant_id faltante en el registro de importación')
  }

  const toBool = (val, defaultVal = false) => {
    if (val === true || val === 'TRUE' || val === 'true' || val === 1) return true
    if (val === false || val === 'FALSE' || val === 'false' || val === 0) return false
    return defaultVal
  }

  const payload = {
    tenant_id: tenantId,
    legal_name: row.legal_name?.toString().trim(),
    trade_name: row.trade_name || null,
    document_type: row.document_type || null,
    document_number: row.document_number?.toString().trim() || null,
    dv: row.dv?.toString().trim() || null,
    type: row.type || 'both',
    phone: row.phone?.toString().trim() || null,
    email: row.email?.toString().trim() || null,
    fiscal_email: row.fiscal_email?.toString().trim() || null,
    address: row.address?.toString().trim() || null,
    city: row.city?.toString().trim() || null,
    city_code: row.city_code?.toString().trim() || null,
    department: row.department?.toString().trim() || null,
    country_code: row.country_code?.toString().trim() || 'CO',
    tax_regime: row.tax_regime || null,
    is_responsible_for_iva: toBool(row.is_responsible_for_iva, false),
    obligated_accounting: toBool(row.obligated_accounting, false),
    default_payment_terms: row.default_payment_terms ? parseInt(row.default_payment_terms) : null,
    max_credit_amount: row.max_credit_amount ? parseFloat(row.max_credit_amount) : null,
    default_currency: row.default_currency || 'COP',
    is_active: toBool(row.is_active, true)
  }

  // If document_number exists for this tenant, do update instead of insert
  if (payload.document_number) {
    const { data: existing } = await supabase
      .from('third_parties')
      .select('third_party_id')
      .eq('tenant_id', tenantId)
      .eq('document_number', payload.document_number)
      .limit(1)
    if (existing && existing.length > 0) {
      payload.third_party_id = existing[0].third_party_id
    }
  }

  await thirdPartiesService.create(payload)
}
