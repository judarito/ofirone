/**
 * Tests del parser determinístico de comandos de venta por texto/voz.
 * Cubre: extracción de ítems, cantidades, cliente, notas, merging de duplicados
 * y cálculo de confianza.
 */
import { parseDeterministicSaleCommand } from '../services/commandEngine/deterministicParser.service';

// ─── helpers ──────────────────────────────────────────────────────────────────

function firstItem(result) {
  return result.data.line_items[0];
}

// ─── casos de entrada vacía o inválida ────────────────────────────────────────

describe('parseDeterministicSaleCommand — entrada vacía', () => {
  it('string vacío → success: false', () => {
    expect(parseDeterministicSaleCommand('').success).toBe(false);
  });

  it('null → success: false', () => {
    expect(parseDeterministicSaleCommand(null).success).toBe(false);
  });

  it('undefined → success: false', () => {
    expect(parseDeterministicSaleCommand(undefined).success).toBe(false);
  });

  it('texto muy corto tras quitar ruido → sin ítems, success: false', () => {
    // Un solo carácter no supera el mínimo de 2 — se filtra
    const result = parseDeterministicSaleCommand('agrega x');
    expect(result.success).toBe(false);
  });

  it('solo prefijo non-item (nota:) → sin ítems, success: false', () => {
    const result = parseDeterministicSaleCommand('nota: entrega inmediata');
    expect(result.success).toBe(false);
  });
});

// ─── ítem simple ──────────────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — ítem simple', () => {
  it('nombre de producto solo → 1 ítem con quantity 1', () => {
    const result = parseDeterministicSaleCommand('coca cola');
    expect(result.success).toBe(true);
    expect(result.data.line_items).toHaveLength(1);
    expect(firstItem(result).raw_name).toBe('coca cola');
    expect(firstItem(result).quantity).toBe(1);
  });

  it('artículo indefinido "un" → quantity 1', () => {
    const result = parseDeterministicSaleCommand('un agua');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(1);
    expect(firstItem(result).raw_name).toBe('agua');
  });

  it('artículo indefinido "una" → quantity 1', () => {
    const result = parseDeterministicSaleCommand('una gaseosa');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(1);
    expect(firstItem(result).raw_name).toBe('gaseosa');
  });
});

// ─── cantidad numérica ────────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — cantidad numérica al inicio', () => {
  it('"2 coca cola" → quantity 2', () => {
    const result = parseDeterministicSaleCommand('2 coca cola');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(2);
    expect(firstItem(result).raw_name).toBe('coca cola');
  });

  it('"3 kg arroz" → quantity 3', () => {
    const result = parseDeterministicSaleCommand('3 kg arroz');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(3);
    expect(firstItem(result).raw_name).toBe('arroz');
  });

  it('"10 und leche" → quantity 10', () => {
    const result = parseDeterministicSaleCommand('10 und leche');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(10);
  });

  it('cantidad decimal con coma → se convierte a entero redondeado', () => {
    const result = parseDeterministicSaleCommand('2,5 aguacate');
    expect(result.success).toBe(true);
    expect(Number.isInteger(firstItem(result).quantity)).toBe(true);
  });
});

// ─── cantidad al final (formato "producto x N") ────────────────────────────────

describe('parseDeterministicSaleCommand — cantidad al final', () => {
  it('"coca cola x 3" → quantity 3', () => {
    const result = parseDeterministicSaleCommand('coca cola x 3');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(3);
    expect(firstItem(result).raw_name).toBe('coca cola');
  });

  it('"arroz * 5" → quantity 5', () => {
    const result = parseDeterministicSaleCommand('arroz * 5');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(5);
    expect(firstItem(result).raw_name).toBe('arroz');
  });
});

// ─── cantidad en palabras ──────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — cantidad en palabras', () => {
  it('"tres panes" → quantity 3', () => {
    const result = parseDeterministicSaleCommand('tres panes');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(3);
    expect(firstItem(result).raw_name).toBe('panes');
  });

  it('"doce huevos" → quantity 12', () => {
    const result = parseDeterministicSaleCommand('doce huevos');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(12);
  });

  it('"veinte empanadas" → quantity 20', () => {
    const result = parseDeterministicSaleCommand('veinte empanadas');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(20);
  });

  it('"dieciséis botellas" → quantity 16', () => {
    const result = parseDeterministicSaleCommand('dieciséis botellas');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(16);
  });
});

// ─── prefijos de ruido eliminados ─────────────────────────────────────────────

describe('parseDeterministicSaleCommand — eliminación de prefijos de ruido', () => {
  it('"agrega 2 panes" → mismo que "2 panes"', () => {
    const r1 = parseDeterministicSaleCommand('agrega 2 panes');
    const r2 = parseDeterministicSaleCommand('2 panes');
    expect(firstItem(r1).raw_name).toBe(firstItem(r2).raw_name);
    expect(firstItem(r1).quantity).toBe(firstItem(r2).quantity);
  });

  it('"quiero una gaseosa" → raw_name = "gaseosa"', () => {
    const result = parseDeterministicSaleCommand('quiero una gaseosa');
    expect(result.success).toBe(true);
    expect(firstItem(result).raw_name).toBe('gaseosa');
  });

  it('"por favor 3 leches" → raw_name = "leches", quantity = 3', () => {
    const result = parseDeterministicSaleCommand('por favor 3 leches');
    expect(result.success).toBe(true);
    expect(firstItem(result).quantity).toBe(3);
  });
});

// ─── múltiples ítems ──────────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — múltiples ítems', () => {
  it('separados por salto de línea', () => {
    const result = parseDeterministicSaleCommand('2 arroz\n3 leche');
    expect(result.success).toBe(true);
    expect(result.data.line_items).toHaveLength(2);
  });

  it('separados por coma', () => {
    const result = parseDeterministicSaleCommand('2 arroz, 1 aceite');
    expect(result.success).toBe(true);
    expect(result.data.line_items).toHaveLength(2);
  });

  it('separados por "y"', () => {
    const result = parseDeterministicSaleCommand('2 coca cola y 1 agua');
    expect(result.success).toBe(true);
    expect(result.data.line_items).toHaveLength(2);
  });

  it('separados por "e" (antes de vocal)', () => {
    const result = parseDeterministicSaleCommand('3 panes e 1 empanada');
    expect(result.success).toBe(true);
    expect(result.data.line_items).toHaveLength(2);
  });

  it('separados por punto y coma', () => {
    const result = parseDeterministicSaleCommand('2 pollo; 1 res');
    expect(result.success).toBe(true);
    expect(result.data.line_items).toHaveLength(2);
  });
});

// ─── merging de duplicados ─────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — merging de líneas duplicadas', () => {
  it('mismo producto en dos líneas → suma las cantidades', () => {
    const result = parseDeterministicSaleCommand('2 arroz\n3 arroz');
    expect(result.success).toBe(true);
    expect(result.data.line_items).toHaveLength(1);
    expect(result.data.line_items[0].quantity).toBe(5);
  });

  it('mismo producto con acento vs sin acento → se fusionan', () => {
    const result = parseDeterministicSaleCommand('2 leché\n1 leche');
    // normalize elimina diacríticos al generar la key
    expect(result.data.line_items).toHaveLength(1);
    expect(result.data.line_items[0].quantity).toBe(3);
  });
});

// ─── extracción de cliente ─────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — nombre del cliente', () => {
  it('"para Juan Pérez" → customer_name extraído', () => {
    const result = parseDeterministicSaleCommand('2 arroz\npara Juan Pérez');
    expect(result.success).toBe(true);
    expect(result.data.order.customer_name).toBe('Juan Pérez');
  });

  it('"cliente: María" → customer_name extraído', () => {
    const result = parseDeterministicSaleCommand('1 leche\ncliente: María');
    expect(result.success).toBe(true);
    expect(result.data.order.customer_name).toBe('María');
  });

  it('"a nombre de Carlos" → customer_name extraído', () => {
    const result = parseDeterministicSaleCommand('3 panes\na nombre de Carlos');
    expect(result.success).toBe(true);
    expect(result.data.order.customer_name).toBe('Carlos');
  });

  it('sin indicador de cliente → customer_name null', () => {
    const result = parseDeterministicSaleCommand('2 coca cola');
    expect(result.data.order.customer_name).toBeNull();
  });
});

// ─── extracción de notas ──────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — notas', () => {
  it('"nota: sin cebolla" → notes extraídas', () => {
    const result = parseDeterministicSaleCommand('1 hamburguesa\nnota: sin cebolla');
    expect(result.success).toBe(true);
    expect(result.data.order.notes).toContain('sin cebolla');
  });

  it('"observacion: pico de gallo aparte" → notes extraídas', () => {
    const result = parseDeterministicSaleCommand('2 tacos\nobservacion: pico de gallo aparte');
    expect(result.success).toBe(true);
    expect(result.data.order.notes).toContain('pico de gallo aparte');
  });

  it('sin notas → notes null', () => {
    const result = parseDeterministicSaleCommand('2 agua');
    expect(result.data.order.notes).toBeNull();
  });
});

// ─── detección de SKU ─────────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — detección de SKU', () => {
  it('token alfanumérico largo → detectado como sku', () => {
    const result = parseDeterministicSaleCommand('2 PROD123');
    expect(result.success).toBe(true);
    expect(firstItem(result).sku).toBe('PROD123');
  });

  it('nombre sin código → sku null', () => {
    const result = parseDeterministicSaleCommand('2 arroz integral');
    expect(result.success).toBe(true);
    expect(firstItem(result).sku).toBeNull();
  });
});

// ─── unit_hint ────────────────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — unit_hint', () => {
  it('"3 kg arroz" → unit_hint = "kg"', () => {
    const result = parseDeterministicSaleCommand('3 kg arroz');
    expect(firstItem(result).unit_hint).toBe('kg');
  });

  it('"2 caja leche" → unit_hint = "caja"', () => {
    const result = parseDeterministicSaleCommand('2 caja leche');
    expect(firstItem(result).unit_hint).toBe('caja');
  });

  it('sin unidad → unit_hint null', () => {
    const result = parseDeterministicSaleCommand('5 empanadas');
    expect(firstItem(result).unit_hint).toBeNull();
  });
});

// ─── confianza ────────────────────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — confianza', () => {
  it('1 ítem sin cliente → confidence >= 0.58 y < 1', () => {
    const result = parseDeterministicSaleCommand('2 arroz');
    const { confidence } = result.data.order;
    expect(confidence).toBeGreaterThanOrEqual(0.58);
    expect(confidence).toBeLessThan(1);
  });

  it('con cliente → confidence mayor que sin cliente (mismos ítems)', () => {
    const sin = parseDeterministicSaleCommand('2 arroz');
    const con = parseDeterministicSaleCommand('2 arroz\npara Juan');
    expect(con.data.order.confidence).toBeGreaterThan(sin.data.order.confidence);
  });

  it('más ítems → mayor confidence (hasta el límite 0.93)', () => {
    const few  = parseDeterministicSaleCommand('1 arroz');
    const many = parseDeterministicSaleCommand('1 arroz\n2 leche\n3 pan\n4 huevo\n5 aceite');
    expect(many.data.order.confidence).toBeGreaterThanOrEqual(few.data.order.confidence);
    expect(many.data.order.confidence).toBeLessThanOrEqual(0.93);
  });

  it('confidence es un número con máximo 3 decimales', () => {
    const result = parseDeterministicSaleCommand('1 pan');
    const str = String(result.data.order.confidence);
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });
});

// ─── metadata del resultado ──────────────────────────────────────────────────

describe('parseDeterministicSaleCommand — estructura del resultado', () => {
  it('éxito incluye model = "deterministic-parser-v1"', () => {
    const result = parseDeterministicSaleCommand('2 arroz');
    expect(result.data.model).toBe('deterministic-parser-v1');
  });

  it('éxito incluye cache_hit = false', () => {
    const result = parseDeterministicSaleCommand('1 pan');
    expect(result.data.cache_hit).toBe(false);
  });

  it('éxito incluye candidate_segments en raw', () => {
    const result = parseDeterministicSaleCommand('2 arroz, 1 leche');
    expect(Array.isArray(result.data.raw.candidate_segments)).toBe(true);
    expect(result.data.raw.candidate_segments.length).toBeGreaterThan(0);
  });

  it('unit_price siempre es null (se asigna después del matching)', () => {
    const result = parseDeterministicSaleCommand('2 arroz');
    expect(firstItem(result).unit_price).toBeNull();
  });
});

// ─── escenario complejo de POS por voz ────────────────────────────────────────

describe('parseDeterministicSaleCommand — escenario voz POS completo', () => {
  it('pedido típico de voz con ruido, cliente y nota', () => {
    const input = [
      'hola buenas, agrega 3 coca cola y dos aguas',
      'también una hamburguesa de pollo',
      'para Pedro Ramírez',
      'nota: sin mostaza',
    ].join('\n');

    const result = parseDeterministicSaleCommand(input);

    expect(result.success).toBe(true);
    expect(result.data.line_items.length).toBeGreaterThanOrEqual(3);
    expect(result.data.order.customer_name).toContain('Pedro');
    expect(result.data.order.notes).toContain('mostaza');

    const cocaCola = result.data.line_items.find(i => i.raw_name.includes('coca cola'));
    expect(cocaCola).toBeDefined();
    expect(cocaCola.quantity).toBe(3);
  });
});
