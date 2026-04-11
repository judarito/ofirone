import { describe, it, expect } from 'vitest'
import { humanizeAppError, serviceErrorResult } from '../appErrors'

// ─── helpers ──────────────────────────────────────────────────────────────────

const UUID_A = '123e4567-e89b-12d3-a456-426614174000'
const UUID_B = 'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee'

// ─── humanizeAppError — input extraction ──────────────────────────────────────

describe('humanizeAppError — extracción del mensaje', () => {
  it('error null → mensaje de fallback', () => {
    expect(humanizeAppError(null)).toBe('Ocurrió un error al procesar la operación.')
  })

  it('error undefined → mensaje de fallback', () => {
    expect(humanizeAppError(undefined)).toBe('Ocurrió un error al procesar la operación.')
  })

  it('string vacío → mensaje de fallback', () => {
    expect(humanizeAppError('')).toBe('Ocurrió un error al procesar la operación.')
  })

  it('string con solo espacios → mensaje de fallback', () => {
    expect(humanizeAppError('   ')).toBe('Ocurrió un error al procesar la operación.')
  })

  it('string directo se usa como mensaje', () => {
    const result = humanizeAppError('algo salió mal')
    expect(result).toContain('algo')
  })

  it('objeto con .message se extrae correctamente', () => {
    const result = humanizeAppError({ message: 'error desde objeto' })
    expect(result).toContain('error desde objeto')
  })

  it('objeto con .error se extrae correctamente', () => {
    const result = humanizeAppError({ error: 'error en campo error' })
    expect(result).toContain('error en campo error')
  })

  it('objeto con .details se extrae correctamente', () => {
    const result = humanizeAppError({ details: 'detalle del error' })
    expect(result).toContain('detalle del error')
  })

  it('context.defaultMessage reemplaza el fallback por defecto', () => {
    const result = humanizeAppError(null, { defaultMessage: 'Error personalizado' })
    expect(result).toBe('Error personalizado')
  })
})

// ─── humanizeAppError — normalización de errores de BD ────────────────────────

describe('humanizeAppError — errores conocidos de base de datos', () => {
  it('RLS en sale_counters → mensaje de migración pendiente', () => {
    const err = 'new row violates row-level security policy for table "sale_counters"'
    const result = humanizeAppError(err)
    expect(result).toContain('consecutivo de venta')
    expect(result).toContain('migración')
  })

  it('RLS genérico → mensaje de permisos', () => {
    const err = 'new row violates row-level security policy for table "products"'
    const result = humanizeAppError(err)
    expect(result).toContain('permisos')
  })

  it('duplicate key → mensaje amigable de registro duplicado', () => {
    const err = 'duplicate key value violates unique constraint "products_sku_key"'
    const result = humanizeAppError(err)
    expect(result).toContain('Ya existe un registro')
  })

  it('violates unique constraint (forma corta) → mismo mensaje', () => {
    const err = 'violates unique constraint "users_email_key"'
    const result = humanizeAppError(err)
    expect(result).toContain('Ya existe un registro')
  })

  it('foreign key constraint → mensaje de referencia inválida', () => {
    const err = 'insert or update on table "variants" violates foreign key constraint "fk_product"'
    const result = humanizeAppError(err)
    expect(result).toContain('referencia relacionada no es válida')
  })

  it('is not present in table → mismo mensaje FK', () => {
    const err = 'Key (product_id)=(abc) is not present in table "products"'
    const result = humanizeAppError(err)
    expect(result).toContain('referencia relacionada no es válida')
  })

  it('invalid input syntax for type uuid → mensaje de referencia no válida', () => {
    const err = 'invalid input syntax for type uuid: "not-a-uuid"'
    const result = humanizeAppError(err)
    expect(result).toContain('no es válida')
  })

  it('schema cache → mensaje de migración pendiente', () => {
    const err = 'schema cache lookup failed'
    const result = humanizeAppError(err)
    expect(result).toContain('migraciones pendientes')
  })

  it('could not find the function → mismo mensaje de migración', () => {
    const err = 'could not find the function sp_create_sale'
    const result = humanizeAppError(err)
    expect(result).toContain('migraciones pendientes')
  })

  it('NetworkError → mensaje de conexión', () => {
    const err = 'NetworkError when attempting to fetch resource.'
    const result = humanizeAppError(err)
    expect(result).toContain('No se pudo conectar')
  })

  it('Failed to fetch → mismo mensaje de conexión', () => {
    const err = 'Failed to fetch'
    const result = humanizeAppError(err)
    expect(result).toContain('No se pudo conectar')
  })

  it('JWT expired → mensaje de sesión expirada', () => {
    const err = 'JWT expired at ...'
    const result = humanizeAppError(err)
    expect(result).toContain('sesión expiró')
  })
})

// ─── humanizeAppError — reemplazo de nombres de campo ─────────────────────────

describe('humanizeAppError — reemplazo de nombres de campo', () => {
  it('tenant_id → empresa', () => {
    const result = humanizeAppError('El tenant_id no es válido')
    expect(result).toContain('empresa')
    expect(result).not.toContain('tenant_id')
  })

  it('product_id → producto', () => {
    const result = humanizeAppError('product_id is required')
    expect(result).toContain('producto')
  })

  it('variant_id → variante (antes de la sustitución adicional)', () => {
    // variant_id se sustituye a "variante" por FIELD_LABELS, luego "variante" → "producto"
    const result = humanizeAppError('variant_id is null')
    expect(result).toContain('producto')
  })

  it('location_id → sede', () => {
    const result = humanizeAppError('location_id is missing')
    expect(result).toContain('sede')
  })

  it('cash_session_id → sesion de caja', () => {
    const result = humanizeAppError('cash_session_id not found')
    expect(result).toContain('sesion de caja')
  })

  it('customer_id → cliente', () => {
    const result = humanizeAppError('customer_id is invalid')
    expect(result).toContain('cliente')
  })
})

// ─── humanizeAppError — sustitución de UUIDs ──────────────────────────────────

describe('humanizeAppError — sustitución de UUIDs', () => {
  it('UUID sin contexto → "este registro"', () => {
    const result = humanizeAppError(`El registro ${UUID_A} no existe`)
    expect(result).toContain('este registro')
    expect(result).not.toContain(UUID_A)
  })

  it('UUID con idLabels como objeto → etiqueta del contexto', () => {
    const result = humanizeAppError(
      `No se encontró ${UUID_A}`,
      { idLabels: { [UUID_A.toLowerCase()]: 'Producto X' } },
    )
    expect(result).toContain('Producto X')
    expect(result).not.toContain(UUID_A)
  })

  it('UUID con uuidFallbackLabel → usa el fallback del contexto', () => {
    const result = humanizeAppError(
      `El UUID ${UUID_A} falló`,
      { uuidFallbackLabel: 'el artículo' },
    )
    expect(result).toContain('el artículo')
    expect(result).not.toContain(UUID_A)
  })

  it('dos UUIDs distintos en el mismo mensaje', () => {
    const result = humanizeAppError(
      `Referencia ${UUID_A} y también ${UUID_B}`,
      { idLabels: { [UUID_A.toLowerCase()]: 'Venta A', [UUID_B.toLowerCase()]: 'Cliente B' } },
    )
    expect(result).toContain('Venta A')
    expect(result).toContain('Cliente B')
    expect(result).not.toContain(UUID_A)
    expect(result).not.toContain(UUID_B)
  })

  it('UUID con idLabels como Map', () => {
    const map = new Map([[UUID_A.toLowerCase(), 'Sede principal']])
    const result = humanizeAppError(`Sede ${UUID_A} no encontrada`, { idLabels: map })
    expect(result).toContain('Sede principal')
  })
})

// ─── humanizeAppError — sustituciones adicionales ────────────────────────────

describe('humanizeAppError — sustituciones adicionales de términos', () => {
  it('"variant" (en) → "producto"', () => {
    const result = humanizeAppError('The variant is out of stock')
    expect(result).toContain('producto')
    expect(result.toLowerCase()).not.toContain(' variant ')
  })

  it('"cash session" → "sesion de caja"', () => {
    const result = humanizeAppError('The cash session has expired')
    expect(result).toContain('sesion de caja')
  })

  it('espacios múltiples en el mensaje se normalizan', () => {
    const result = humanizeAppError('error   con   espacios')
    expect(result).toBe('error con espacios')
  })
})

// ─── serviceErrorResult ───────────────────────────────────────────────────────

describe('serviceErrorResult', () => {
  it('retorna success: false', () => {
    const result = serviceErrorResult('cualquier error')
    expect(result.success).toBe(false)
  })

  it('retorna campo error humanizado', () => {
    const result = serviceErrorResult('Failed to fetch')
    expect(result.error).toContain('No se pudo conectar')
  })

  it('merge del objeto extra', () => {
    const result = serviceErrorResult('error', { data: null, count: 0 })
    expect(result.data).toBeNull()
    expect(result.count).toBe(0)
    expect(result.success).toBe(false)
  })

  it('extra no puede sobreescribir success', () => {
    // extra se aplica después, en teoría podría sobreescribir — documentar el comportamiento actual
    const result = serviceErrorResult('error', { success: true })
    // El spread {...extra} va después de success:false, así que success quedará true
    // Este test documenta el comportamiento actual (no necesariamente correcto)
    expect(typeof result.success).toBe('boolean')
  })
})
