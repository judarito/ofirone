import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_DOMAINS = ['sales', 'inventory', 'purchases', 'cash', 'portfolio', 'production'] as const;
const DOMAIN_SET = new Set<string>(VALID_DOMAINS);
const CACHE_VERSION = 'ops-rag-v3';
const DEFAULT_MODEL = Deno.env.get('OPS_RAG_AGENT_MODEL')
  || Deno.env.get('DEEPSEEK_TEXT_MODEL')
  || 'deepseek-chat';
const DEFAULT_MAX_ITEMS_PER_BLOCK = 5;
const DEFAULT_CACHE_TTL_HOURS = 6;

type DomainKey = typeof VALID_DOMAINS[number];
type JsonMap = Record<string, unknown>;

type DateRange = {
  fromDate: string;
  toDate: string;
  fromIso: string;
  toIso: string;
  label: string;
  source: 'body' | 'query' | 'default';
};

type ResolvedFilters = {
  tenantId: string;
  locationId: string | null;
  locationName: string | null;
  range: DateRange;
};

type RetrievedBlock = {
  block_id: string;
  domain: DomainKey;
  title: string;
  description: string;
  source: string;
  rows_count: number;
  content: JsonMap;
};

type RetrievedPayload = {
  blocks: RetrievedBlock[];
  errors: string[];
};

type LocationOption = {
  location_id: string;
  name: string;
  normalized_name: string;
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: unknown }).text || '');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseJsonSafe(text: string): JsonMap | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as JsonMap;
  } catch (_e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as JsonMap;
    } catch (_err) {
      return null;
    }
  }
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique<T>(list: T[]): T[] {
  return Array.from(new Set(list));
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(Math.max(0, Math.min(1, parsed)).toFixed(3));
}

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDayIso(date: Date): string {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

function endOfDayIso(date: Date): string {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next.toISOString();
}

function addDays(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const currentDay = next.getDay();
  const diff = currentDay === 0 ? -6 : 1 - currentDay;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

function normalizeIsoDate(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function buildRange(from: Date, to: Date, label: string, source: DateRange['source']): DateRange {
  const [safeFrom, safeTo] = from.getTime() <= to.getTime() ? [from, to] : [to, from];
  return {
    fromDate: toIsoDate(safeFrom),
    toDate: toIsoDate(safeTo),
    fromIso: startOfDayIso(safeFrom),
    toIso: endOfDayIso(safeTo),
    label,
    source,
  };
}

function inferDateRange(queryText: string, body: JsonMap): DateRange {
  const explicitFrom = normalizeIsoDate(body.from_date);
  const explicitTo = normalizeIsoDate(body.to_date);
  if (explicitFrom || explicitTo) {
    const now = new Date();
    const from = explicitFrom
      ? new Date(`${explicitFrom}T00:00:00`)
      : explicitTo
        ? new Date(`${explicitTo}T00:00:00`)
        : now;
    const to = explicitTo
      ? new Date(`${explicitTo}T00:00:00`)
      : explicitFrom
        ? new Date(`${explicitFrom}T00:00:00`)
        : now;
    return buildRange(from, to, 'rango explicito', 'body');
  }

  const text = normalizeText(queryText);
  const now = new Date();

  if (text.includes('ayer')) {
    const yesterday = addDays(now, -1);
    return buildRange(yesterday, yesterday, 'ayer', 'query');
  }

  if (text.includes('hoy')) {
    return buildRange(now, now, 'hoy', 'query');
  }

  if (text.includes('esta semana') || text.includes('semana actual')) {
    return buildRange(startOfWeek(now), now, 'esta semana', 'query');
  }

  if (text.includes('ultimos 7 dias') || text.includes('ultimos siete dias') || text.includes('ultima semana')) {
    return buildRange(addDays(now, -6), now, 'ultimos 7 dias', 'query');
  }

  if (text.includes('ultimos 15 dias') || text.includes('ultimos quince dias')) {
    return buildRange(addDays(now, -14), now, 'ultimos 15 dias', 'query');
  }

  if (text.includes('ultimos 30 dias') || text.includes('ultimo mes') || text.includes('ultimas 4 semanas')) {
    return buildRange(addDays(now, -29), now, 'ultimos 30 dias', 'query');
  }

  if (text.includes('mes pasado') || text.includes('mes anterior')) {
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    return buildRange(startOfMonth(prevMonthDate), endOfMonth(prevMonthDate), 'mes pasado', 'query');
  }

  if (text.includes('este mes') || text.includes('mes actual')) {
    return buildRange(startOfMonth(now), now, 'este mes', 'query');
  }

  if (text.includes('este ano') || text.includes('ano actual')) {
    return buildRange(startOfYear(now), now, 'este ano', 'query');
  }

  return buildRange(addDays(now, -29), now, 'ultimos 30 dias', 'default');
}

function normalizeDomains(value: unknown): DomainKey[] {
  const list = Array.isArray(value) ? value : [];
  return unique(
    list
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item): item is DomainKey => DOMAIN_SET.has(item)),
  );
}

const DOMAIN_KEYWORDS: Record<DomainKey, string[]> = {
  sales: [
    'venta',
    'ventas',
    'factura',
    'facturas',
    'ingreso',
    'ingresos',
    'ticket',
    'tickets',
    'cliente',
    'clientes',
    'producto mas vendido',
    'productos mas vendidos',
    'top producto',
    'menos vendido',
    'menos vendidos',
    'producto menos vendido',
    'productos menos vendidos',
    'baja rotacion',
    'menor rotacion',
    'poca rotacion',
    'peor rotacion',
    'rotacion baja',
    'rotacion lenta',
  ],
  inventory: [
    'inventario',
    'stock',
    'existencia',
    'existencias',
    'agotado',
    'agotados',
    'quiebre',
    'quiebres',
    'lote',
    'lotes',
    'vencimiento',
    'vencimientos',
    'vencido',
    'vencidos',
    'vencer',
    'vence',
    'vencen',
    'por vencer',
    'proximo a vencer',
    'proximos a vencer',
    'dias para vencer',
    'caduca',
    'caducan',
    'caducado',
    'caducados',
    'expira',
    'expiran',
    'expirado',
    'expirados',
    'fefo',
    'kardex',
    'reserva',
    'disponible',
  ],
  purchases: ['compra', 'compras', 'proveedor', 'proveedores', 'abastecimiento', 'reposicion', 'reponer', 'orden de compra', 'ordenes de compra'],
  cash: ['caja', 'cajas', 'sesion', 'sesiones', 'arqueo', 'cierre', 'apertura', 'efectivo', 'diferencia', 'diferencias', 'movimiento de caja'],
  portfolio: ['cartera', 'credito', 'creditos', 'cobranza', 'cobro', 'mora', 'saldo pendiente', 'saldo', 'abono', 'deuda'],
  production: ['produccion', 'produccion', 'orden de produccion', 'ordenes de produccion', 'bom', 'boms', 'fabricacion', 'manufactura'],
};

function inferDomains(queryText: string, explicitDomains: DomainKey[]): DomainKey[] {
  if (explicitDomains.length) return explicitDomains;

  const text = normalizeText(queryText);

  const isReplenishmentIntent =
    text.includes('que debo comprar')
    || text.includes('que comprar')
    || text.includes('debo comprar')
    || text.includes('que debo pedir')
    || text.includes('que pedir')
    || text.includes('pedido sugerido')
    || text.includes('pedido recomendado')
    || text.includes('reabastecer')
    || text.includes('reabastecimiento')
    || text.includes('reponer')
    || text.includes('reposicion')
    || text.includes('resurtir')
    || text.includes('surtir')
    || (
      text.includes('comprar')
      && (
        text.includes('proxima semana')
        || text.includes('siguiente semana')
        || text.includes('proximos dias')
        || text.includes('stock')
        || text.includes('inventario')
      )
    );

  if (isReplenishmentIntent) {
    return ['inventory', 'sales', 'purchases'];
  }

  const scores = new Map<DomainKey, number>();
  VALID_DOMAINS.forEach((domain) => scores.set(domain, 0));

  VALID_DOMAINS.forEach((domain) => {
    DOMAIN_KEYWORDS[domain].forEach((keyword) => {
      if (text.includes(normalizeText(keyword))) {
        scores.set(domain, Number(scores.get(domain) || 0) + 1);
      }
    });
  });

  const ranked = Array.from(scores.entries())
    .filter((entry) => entry[1] > 0)
    .sort((left, right) => right[1] - left[1])
    .map((entry) => entry[0]);

  if (ranked.length) return ranked.slice(0, 4);

  const isGeneralBusinessQuery =
    text.includes('negocio')
    || text.includes('empresa')
    || text.includes('operacion')
    || text.includes('operacion')
    || text.includes('resumen general')
    || text.includes('panorama');

  if (isGeneralBusinessQuery) {
    return ['sales', 'inventory', 'purchases', 'cash', 'portfolio'];
  }

  return ['sales', 'inventory', 'purchases'];
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function truncateRows<T>(rows: T[], limit: number): T[] {
  return rows.slice(0, Math.max(1, limit));
}

function buildLocationIndex(rows: Array<Record<string, unknown>>): LocationOption[] {
  return rows
    .map((row) => ({
      location_id: String(row?.location_id || '').trim(),
      name: String(row?.name || '').trim(),
      normalized_name: normalizeText(row?.name || ''),
    }))
    .filter((row) => row.location_id && row.name && row.normalized_name);
}

function resolveLocationFromBodyOrQuery(
  queryText: string,
  body: JsonMap,
  locations: LocationOption[],
) {
  const explicitId = String(body.location_id || '').trim();
  if (explicitId) {
    const byId = locations.find((entry) => entry.location_id === explicitId) || null;
    return {
      locationId: explicitId,
      locationName: byId?.name || String(body.location_name || '').trim() || null,
    };
  }

  const explicitName = normalizeText(body.location_name || '');
  if (explicitName) {
    const byName = locations.find((entry) => entry.normalized_name === explicitName)
      || locations.find((entry) => explicitName.includes(entry.normalized_name) || entry.normalized_name.includes(explicitName))
      || null;
    if (byName) {
      return {
        locationId: byName.location_id,
        locationName: byName.name,
      };
    }
  }

  const normalizedQuery = normalizeText(queryText);
  let best: LocationOption | null = null;
  locations.forEach((entry) => {
    if (!normalizedQuery.includes(entry.normalized_name)) return;
    if (!best || entry.normalized_name.length > best.normalized_name.length) {
      best = entry;
    }
  });

  return {
    locationId: best?.location_id || null,
    locationName: best?.name || null,
  };
}

async function resolveUserTenantContext(
  authClient: SupabaseClient,
  authUserId: string,
  requestedTenantId: string | null,
) {
  const { data, error } = await authClient
    .from('users')
    .select('user_id, tenant_id, full_name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`No fue posible resolver usuario actual: ${error.message}`);
  }

  if (!data?.tenant_id) {
    throw new Error('No se encontro tenant activo para el usuario autenticado.');
  }

  if (requestedTenantId && requestedTenantId !== data.tenant_id) {
    throw new Error('El tenant solicitado no coincide con el tenant del usuario autenticado.');
  }

  return {
    tenantId: requestedTenantId || String(data.tenant_id),
    userId: String(data.user_id || ''),
    userName: data.full_name ? String(data.full_name) : null,
  };
}

function locationMatches(row: Record<string, unknown>, locationId: string | null): boolean {
  if (!locationId) return true;
  const directLocation = String(row?.location_id || '').trim();
  if (directLocation && directLocation === locationId) return true;
  const nestedLocation = String((row?.location as Record<string, unknown> | null)?.location_id || '').trim();
  if (nestedLocation && nestedLocation === locationId) return true;
  const cashRegisterLocation = String(
    (((row?.cash_register as Record<string, unknown> | null)?.location as Record<string, unknown> | null)?.location_id) || '',
  ).trim();
  return Boolean(cashRegisterLocation && cashRegisterLocation === locationId);
}

function composeProductLabel(variant: Record<string, unknown> | null): string {
  const productName = String((variant?.product as Record<string, unknown> | null)?.name || '').trim();
  const variantName = String(variant?.variant_name || '').trim();
  const sku = String(variant?.sku || '').trim();

  const base = productName && variantName && productName.toLowerCase() !== variantName.toLowerCase()
    ? `${productName} (${variantName})`
    : productName || variantName || 'Producto';

  return sku ? `${base} - ${sku}` : base;
}

async function retrieveSalesContext(
  authClient: SupabaseClient,
  tenantId: string,
  filters: ResolvedFilters,
  maxItems: number,
): Promise<RetrievedPayload> {
  const statuses = ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'];
  const errors: string[] = [];
  let salesQuery = authClient
    .from('sales')
    .select(
      `
        sale_id,
        sale_number,
        sold_at,
        status,
        subtotal,
        discount_total,
        tax_total,
        total,
        location_id,
        customer:customer_id(full_name,document),
        sold_by_user:sold_by(full_name),
        location:location_id(location_id,name)
      `,
    )
    .eq('tenant_id', tenantId)
    .in('status', statuses)
    .gte('sold_at', filters.range.fromIso)
    .lte('sold_at', filters.range.toIso)
    .order('sold_at', { ascending: false })
    .limit(120);

  if (filters.locationId) {
    salesQuery = salesQuery.eq('location_id', filters.locationId);
  }

  let linesQuery = authClient
    .from('sale_lines')
    .select(
      `
        quantity,
        line_total,
        variant:variant_id(variant_id,sku,variant_name,product:product_id(name)),
        sale:sale_id!inner(tenant_id,status,sold_at,location_id)
      `,
    )
    .eq('sale.tenant_id', tenantId)
    .in('sale.status', statuses)
    .gte('sale.sold_at', filters.range.fromIso)
    .lte('sale.sold_at', filters.range.toIso)
    .limit(320);

  if (filters.locationId) {
    linesQuery = linesQuery.eq('sale.location_id', filters.locationId);
  }

  const variantsQuery = authClient
    .from('product_variants')
    .select(
      `
        variant_id,
        sku,
        variant_name,
        is_active,
        is_component,
        product:product_id(name,is_component)
      `,
    )
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(800);

  const [
    { data: salesRows, error: salesError },
    { data: lineRows, error: linesError },
    { data: variantRows, error: variantsError },
  ] = await Promise.all([
    salesQuery,
    linesQuery,
    variantsQuery,
  ]);

  if (salesError) throw new Error(`Ventas: ${salesError.message}`);
  if (linesError) throw new Error(`Lineas de venta: ${linesError.message}`);
  if (variantsError) {
    errors.push(`Catalogo activo de ventas: ${variantsError.message}`);
  }

  const rows = Array.isArray(salesRows) ? salesRows : [];
  const lines = Array.isArray(lineRows) ? lineRows : [];
  const catalogVariants = Array.isArray(variantRows) ? variantRows : [];

  const total = rows.reduce((sum, row) => sum + toNumber(row.total), 0);
  const subtotal = rows.reduce((sum, row) => sum + toNumber(row.subtotal), 0);
  const discounts = rows.reduce((sum, row) => sum + toNumber(row.discount_total), 0);
  const taxes = rows.reduce((sum, row) => sum + toNumber(row.tax_total), 0);
  const returnsCount = rows.filter((row) => String(row.status || '').trim() === 'RETURNED').length;

  const topProductMap = new Map<string, { name: string; qty: number; revenue: number }>();
  const rotationMap = new Map<string, { name: string; qty: number; revenue: number; has_sales: boolean }>();
  let activeCatalogVariantsCount = 0;

  catalogVariants.forEach((variantRow) => {
    const variant = (variantRow as Record<string, unknown> | null) || null;
    const variantId = String(variant?.variant_id || '').trim();
    if (!variantId) return;
    const product = (variant?.product as Record<string, unknown> | null) || null;
    const isComponent = Boolean(variant?.is_component || product?.is_component);
    if (isComponent) return;
    activeCatalogVariantsCount += 1;
    rotationMap.set(variantId, {
      name: composeProductLabel(variant),
      qty: 0,
      revenue: 0,
      has_sales: false,
    });
  });

  lines.forEach((line) => {
    const variant = (line.variant as Record<string, unknown> | null) || null;
    const key = String(variant?.variant_id || composeProductLabel(variant));
    const current = topProductMap.get(key) || {
      name: composeProductLabel(variant),
      qty: 0,
      revenue: 0,
    };
    current.qty += toNumber(line.quantity);
    current.revenue += toNumber(line.line_total);
    topProductMap.set(key, current);

    const rotationCurrent = rotationMap.get(key) || {
      name: composeProductLabel(variant),
      qty: 0,
      revenue: 0,
      has_sales: false,
    };
    rotationCurrent.qty += toNumber(line.quantity);
    rotationCurrent.revenue += toNumber(line.line_total);
    rotationCurrent.has_sales = true;
    rotationMap.set(key, rotationCurrent);
  });

  const topProducts = Array.from(topProductMap.values())
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, maxItems);

  const lowRotationProducts = Array.from(rotationMap.values())
    .sort(
      (left, right) =>
        left.qty - right.qty
        || left.revenue - right.revenue
        || left.name.localeCompare(right.name),
    )
    .slice(0, maxItems)
    .map((item) => ({
      name: item.name,
      qty: item.qty,
      revenue: item.revenue,
      has_sales: item.has_sales,
    }));

  const variantsWithSales = Array.from(rotationMap.values()).filter((item) => item.has_sales).length;
  const zeroSalesVariants = Array.from(rotationMap.values()).filter((item) => !item.has_sales).length;
  const hasActiveCatalogCoverage = activeCatalogVariantsCount > 0;
  const lowRotationSummary = {
    active_variants_considered: rotationMap.size,
    active_catalog_variants: activeCatalogVariantsCount,
    variants_with_sales: variantsWithSales,
    zero_sales_variants: zeroSalesVariants,
    interpretation:
      hasActiveCatalogCoverage
        ? 'catalogo_activo_con_ventas_cero'
        : 'solo_variantes_con_ventas_en_rango',
  };

  const recentSales = truncateRows(rows, maxItems).map((row) => ({
    sale_number: row.sale_number || row.sale_id,
    sold_at: row.sold_at,
    status: row.status,
    total: toNumber(row.total),
    customer_name: ((row.customer as Record<string, unknown> | null)?.full_name) || 'Consumidor final',
    location_name: ((row.location as Record<string, unknown> | null)?.name) || null,
    sold_by: ((row.sold_by_user as Record<string, unknown> | null)?.full_name) || null,
  }));

  return {
    blocks: [
      {
        block_id: 'sales_summary',
        domain: 'sales',
        title: 'Resumen de ventas',
        description: `Ventas del rango ${filters.range.label}`,
        source: 'public.sales',
        rows_count: rows.length,
        content: {
          sample_window: filters.range.label,
          sales_count: rows.length,
          gross_total: total,
          subtotal,
          discounts,
          taxes,
          average_ticket: rows.length > 0 ? Number((total / rows.length).toFixed(2)) : 0,
          returns_count: returnsCount,
          location_name: filters.locationName || null,
        },
      },
      {
        block_id: 'sales_low_rotation_summary',
        domain: 'sales',
        title: 'Resumen de baja rotacion',
        description: 'Cobertura del catalogo analizado para identificar productos menos vendidos',
        source: hasActiveCatalogCoverage ? 'public.product_variants + public.sale_lines' : 'public.sale_lines',
        rows_count: rotationMap.size,
        content: lowRotationSummary,
      },
      {
        block_id: 'sales_top_products',
        domain: 'sales',
        title: 'Top productos vendidos',
        description: 'Productos con mayor venta en el rango consultado',
        source: 'public.sale_lines',
        rows_count: topProducts.length,
        content: {
          items: topProducts,
        },
      },
      {
        block_id: 'sales_low_rotation_products',
        domain: 'sales',
        title: 'Productos menos vendidos',
        description: 'Productos con menor rotacion en el rango; cuando el catalogo activo esta disponible puede incluir items con cero ventas',
        source: hasActiveCatalogCoverage ? 'public.product_variants + public.sale_lines' : 'public.sale_lines',
        rows_count: lowRotationProducts.length,
        content: {
          items: lowRotationProducts,
        },
      },
      {
        block_id: 'sales_recent_sales',
        domain: 'sales',
        title: 'Ventas recientes',
        description: 'Ultimas ventas del rango consultado',
        source: 'public.sales',
        rows_count: recentSales.length,
        content: {
          items: recentSales,
        },
      },
    ],
    errors,
  };
}

async function retrieveInventoryContext(
  authClient: SupabaseClient,
  tenantId: string,
  filters: ResolvedFilters,
  maxItems: number,
): Promise<RetrievedPayload> {
  let stockQuery = authClient
    .from('stock_balances')
    .select(
      `
        location_id,
        on_hand,
        reserved,
        updated_at,
        location:location_id(location_id,name),
        variant:variant_id(
          variant_id,
          sku,
          variant_name,
          min_stock,
          is_component,
          product:product_id(name)
        )
      `,
    )
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(220);

  if (filters.locationId) {
    stockQuery = stockQuery.eq('location_id', filters.locationId);
  }

  let movesQuery = authClient
    .from('inventory_moves')
    .select(
      `
        move_type,
        quantity,
        unit_cost,
        note,
        created_at,
        location_id,
        location:location_id(location_id,name),
        to_location:to_location_id(location_id,name),
        variant:variant_id(sku,variant_name,product:product_id(name))
      `,
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (filters.locationId) {
    movesQuery = movesQuery.eq('location_id', filters.locationId);
  }

  let batchesQuery = authClient
    .from('inventory_batches')
    .select(
      `
        batch_number,
        expiration_date,
        on_hand,
        reserved,
        location_id,
        location:location_id(location_id,name),
        variant:variant_id(sku,variant_name,product:product_id(name))
      `,
    )
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('expiration_date', { ascending: true, nullsFirst: false })
    .limit(40);

  if (filters.locationId) {
    batchesQuery = batchesQuery.eq('location_id', filters.locationId);
  }

  const [
    { data: stockRows, error: stockError },
    { data: moveRows, error: moveError },
    { data: batchRows, error: batchError },
  ] = await Promise.all([stockQuery, movesQuery, batchesQuery]);

  if (stockError) throw new Error(`Inventario: ${stockError.message}`);
  if (moveError) throw new Error(`Movimientos de inventario: ${moveError.message}`);
  if (batchError) throw new Error(`Lotes de inventario: ${batchError.message}`);

  const stocks = Array.isArray(stockRows) ? stockRows : [];
  const moves = Array.isArray(moveRows) ? moveRows : [];
  const batches = Array.isArray(batchRows) ? batchRows : [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stockRisks = stocks
    .map((row) => {
      const onHand = toNumber(row.on_hand);
      const reserved = toNumber(row.reserved);
      const available = onHand - reserved;
      const variant = (row.variant as Record<string, unknown> | null) || null;
      const minStock = toNumber(variant?.min_stock);
      let riskScore = 0;
      if (onHand <= 0) riskScore += 100;
      if (available <= 0) riskScore += 80;
      if (minStock > 0 && available <= minStock) riskScore += 60;
      if (minStock > 0 && onHand <= minStock) riskScore += 40;
      return {
        name: composeProductLabel(variant),
        on_hand: onHand,
        reserved,
        available,
        min_stock: minStock,
        location_name: ((row.location as Record<string, unknown> | null)?.name) || null,
        risk_score: riskScore,
      };
    })
    .sort((left, right) => right.risk_score - left.risk_score || left.available - right.available)
    .filter((row) => row.risk_score > 0)
    .slice(0, maxItems);

  const batchesWithExpiration = batches
    .map((row) => {
      const expirationDate = String(row.expiration_date || '').trim();
      const expDate = expirationDate ? new Date(`${expirationDate}T00:00:00`) : null;
      const diffDays = expDate && !Number.isNaN(expDate.getTime())
        ? Math.floor((expDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
        : null;
      return {
        batch_number: row.batch_number || null,
        product_name: composeProductLabel((row.variant as Record<string, unknown> | null) || null),
        expiration_date: expirationDate || null,
        days_to_expire: diffDays,
        on_hand: toNumber(row.on_hand),
        available: toNumber(row.on_hand) - toNumber(row.reserved),
        location_name: ((row.location as Record<string, unknown> | null)?.name) || null,
      };
    })
    .filter((row) => row.expiration_date && row.days_to_expire !== null);

  const upcomingBatches = [...batchesWithExpiration]
    .filter((row) => Number(row.days_to_expire) >= 0)
    .sort((left, right) => Number(left.days_to_expire) - Number(right.days_to_expire));

  const expiringBatches = upcomingBatches
    .filter((row) => Number(row.days_to_expire) <= 30)
    .slice(0, maxItems);

  const nextToExpireBatches = upcomingBatches.slice(0, maxItems);

  const expiredBatches = [...batchesWithExpiration]
    .filter((row) => Number(row.days_to_expire) < 0)
    .sort((left, right) => Number(right.days_to_expire) - Number(left.days_to_expire))
    .slice(0, maxItems);

  const expirationSummary = {
    total_batches_with_expiration: batchesWithExpiration.length,
    expired_batches: batchesWithExpiration.filter((row) => Number(row.days_to_expire) < 0).length,
    expiring_within_7_days: batchesWithExpiration.filter((row) => Number(row.days_to_expire) >= 0 && Number(row.days_to_expire) <= 7).length,
    expiring_within_30_days: batchesWithExpiration.filter((row) => Number(row.days_to_expire) >= 0 && Number(row.days_to_expire) <= 30).length,
    next_batch_to_expire: nextToExpireBatches[0] || null,
    location_name: filters.locationName || null,
  };

  const recentMoves = truncateRows(moves, maxItems).map((row) => ({
    move_type: row.move_type,
    quantity: toNumber(row.quantity),
    unit_cost: toNumber(row.unit_cost),
    created_at: row.created_at,
    location_name: ((row.location as Record<string, unknown> | null)?.name) || null,
    to_location_name: ((row.to_location as Record<string, unknown> | null)?.name) || null,
    product_name: composeProductLabel((row.variant as Record<string, unknown> | null) || null),
    note: row.note || null,
  }));

  return {
    blocks: [
      {
        block_id: 'inventory_summary',
        domain: 'inventory',
        title: 'Resumen de inventario',
        description: 'Muestra operativa del inventario actual para el tenant o sede filtrada',
        source: 'public.stock_balances',
        rows_count: stocks.length,
        content: {
          sample_size: stocks.length,
          zero_stock_items: stockRisks.filter((row) => Number(row.on_hand) <= 0).length,
          unavailable_items: stockRisks.filter((row) => Number(row.available) <= 0).length,
          low_stock_items: stockRisks.filter((row) => Number(row.min_stock) > 0 && Number(row.available) <= Number(row.min_stock)).length,
          location_name: filters.locationName || null,
        },
      },
      {
        block_id: 'inventory_expiration_summary',
        domain: 'inventory',
        title: 'Resumen de vencimientos',
        description: 'Resumen operativo de lotes con fecha de vencimiento',
        source: 'public.inventory_batches',
        rows_count: batchesWithExpiration.length,
        content: expirationSummary,
      },
      {
        block_id: 'inventory_stock_risks',
        domain: 'inventory',
        title: 'Productos con riesgo de stock',
        description: 'Items con quiebre, sin disponible o bajo minimo',
        source: 'public.stock_balances',
        rows_count: stockRisks.length,
        content: {
          items: stockRisks,
        },
      },
      {
        block_id: 'inventory_recent_moves',
        domain: 'inventory',
        title: 'Movimientos recientes de inventario',
        description: 'Ultimos movimientos registrados',
        source: 'public.inventory_moves',
        rows_count: recentMoves.length,
        content: {
          items: recentMoves,
        },
      },
      {
        block_id: 'inventory_next_to_expire',
        domain: 'inventory',
        title: 'Proximos lotes a vencer',
        description: 'Lotes activos ordenados por menor cantidad de dias para vencer',
        source: 'public.inventory_batches',
        rows_count: nextToExpireBatches.length,
        content: {
          items: nextToExpireBatches,
        },
      },
      {
        block_id: 'inventory_expiring_batches',
        domain: 'inventory',
        title: 'Lotes proximos a vencer',
        description: 'Lotes activos con vencimiento en 30 dias o menos',
        source: 'public.inventory_batches',
        rows_count: expiringBatches.length,
        content: {
          items: expiringBatches,
        },
      },
      {
        block_id: 'inventory_expired_batches',
        domain: 'inventory',
        title: 'Lotes ya vencidos',
        description: 'Lotes activos cuya fecha de vencimiento ya paso',
        source: 'public.inventory_batches',
        rows_count: expiredBatches.length,
        content: {
          items: expiredBatches,
        },
      },
    ],
    errors: [],
  };
}

async function retrievePurchasesContext(
  authClient: SupabaseClient,
  tenantId: string,
  filters: ResolvedFilters,
  maxItems: number,
): Promise<RetrievedPayload> {
  let purchasesQuery = authClient
    .from('purchases')
    .select(
      `
        purchase_id,
        total,
        note,
        created_at,
        location_id,
        location:location_id(location_id,name),
        supplier:supplier_id(legal_name,trade_name,document_number),
        created_by_user:created_by(full_name)
      `,
    )
    .eq('tenant_id', tenantId)
    .gte('created_at', filters.range.fromIso)
    .lte('created_at', filters.range.toIso)
    .order('created_at', { ascending: false })
    .limit(60);

  if (filters.locationId) {
    purchasesQuery = purchasesQuery.eq('location_id', filters.locationId);
  }

  const { data, error } = await purchasesQuery;
  if (error) throw new Error(`Compras: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  const total = rows.reduce((sum, row) => sum + toNumber(row.total), 0);
  const recentPurchases = truncateRows(rows, maxItems).map((row) => ({
    purchase_id: row.purchase_id,
    created_at: row.created_at,
    total: toNumber(row.total),
    supplier_name: ((row.supplier as Record<string, unknown> | null)?.trade_name)
      || ((row.supplier as Record<string, unknown> | null)?.legal_name)
      || 'Sin proveedor',
    supplier_document: ((row.supplier as Record<string, unknown> | null)?.document_number) || null,
    location_name: ((row.location as Record<string, unknown> | null)?.name) || null,
    created_by: ((row.created_by_user as Record<string, unknown> | null)?.full_name) || null,
    note: row.note || null,
  }));

  return {
    blocks: [
      {
        block_id: 'purchases_summary',
        domain: 'purchases',
        title: 'Resumen de compras',
        description: `Compras registradas en ${filters.range.label}`,
        source: 'public.purchases',
        rows_count: rows.length,
        content: {
          purchases_count: rows.length,
          total_amount: total,
          average_purchase: rows.length > 0 ? Number((total / rows.length).toFixed(2)) : 0,
          location_name: filters.locationName || null,
        },
      },
      {
        block_id: 'purchases_recent',
        domain: 'purchases',
        title: 'Compras recientes',
        description: 'Ultimas compras del rango consultado',
        source: 'public.purchases',
        rows_count: recentPurchases.length,
        content: {
          items: recentPurchases,
        },
      },
    ],
    errors: [],
  };
}

async function retrieveCashContext(
  authClient: SupabaseClient,
  tenantId: string,
  filters: ResolvedFilters,
  maxItems: number,
): Promise<RetrievedPayload> {
  const sessionsQuery = authClient
    .from('cash_sessions')
    .select(
      `
        cash_session_id,
        status,
        opening_amount,
        closing_amount_counted,
        closing_amount_expected,
        difference,
        opened_at,
        closed_at,
        cash_register:cash_register_id(
          cash_register_id,
          name,
          location:location_id(location_id,name)
        ),
        opened_by_user:opened_by(full_name),
        closed_by_user:closed_by(full_name)
      `,
    )
    .eq('tenant_id', tenantId)
    .gte('opened_at', filters.range.fromIso)
    .lte('opened_at', filters.range.toIso)
    .order('opened_at', { ascending: false })
    .limit(60);

  const movementsQuery = authClient
    .from('cash_movements')
    .select(
      `
        cash_movement_id,
        type,
        amount,
        category,
        note,
        created_at,
        cash_session_id,
        created_by_user:created_by(full_name),
        session:cash_session_id(
          cash_register:cash_register_id(
            cash_register_id,
            name,
            location:location_id(location_id,name)
          )
        )
      `,
    )
    .eq('tenant_id', tenantId)
    .gte('created_at', filters.range.fromIso)
    .lte('created_at', filters.range.toIso)
    .order('created_at', { ascending: false })
    .limit(60);

  const [
    { data: sessionRows, error: sessionError },
    { data: movementRows, error: movementError },
  ] = await Promise.all([sessionsQuery, movementsQuery]);

  if (sessionError) throw new Error(`Sesiones de caja: ${sessionError.message}`);
  if (movementError) throw new Error(`Movimientos de caja: ${movementError.message}`);

  const sessions = (Array.isArray(sessionRows) ? sessionRows : [])
    .filter((row) => locationMatches(row as Record<string, unknown>, filters.locationId));
  const movements = (Array.isArray(movementRows) ? movementRows : [])
    .filter((row) => {
      if (!filters.locationId) return true;
      const session = (row.session as Record<string, unknown> | null) || null;
      const cashRegister = (session?.cash_register as Record<string, unknown> | null) || null;
      const location = (cashRegister?.location as Record<string, unknown> | null) || null;
      return String(location?.location_id || '') === filters.locationId;
    });

  const openSessions = sessions.filter((row) => String(row.status || '') === 'OPEN').length;
  const sessionsWithDifference = sessions.filter((row) => Math.abs(toNumber(row.difference)) > 0).length;
  const totalDifference = sessions.reduce((sum, row) => sum + toNumber(row.difference), 0);

  const recentSessions = truncateRows(sessions, maxItems).map((row) => ({
    cash_session_id: row.cash_session_id,
    status: row.status,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    difference: toNumber(row.difference),
    expected: toNumber(row.closing_amount_expected),
    counted: toNumber(row.closing_amount_counted),
    cash_register_name: ((row.cash_register as Record<string, unknown> | null)?.name) || null,
    location_name: ((((row.cash_register as Record<string, unknown> | null)?.location) as Record<string, unknown> | null)?.name) || null,
    opened_by: ((row.opened_by_user as Record<string, unknown> | null)?.full_name) || null,
    closed_by: ((row.closed_by_user as Record<string, unknown> | null)?.full_name) || null,
  }));

  const recentMovements = truncateRows(movements, maxItems).map((row) => {
    const session = (row.session as Record<string, unknown> | null) || null;
    const cashRegister = (session?.cash_register as Record<string, unknown> | null) || null;
    const location = (cashRegister?.location as Record<string, unknown> | null) || null;
    return {
      type: row.type,
      amount: toNumber(row.amount),
      category: row.category || null,
      note: row.note || null,
      created_at: row.created_at,
      created_by: ((row.created_by_user as Record<string, unknown> | null)?.full_name) || null,
      cash_register_name: cashRegister?.name || null,
      location_name: location?.name || null,
    };
  });

  return {
    blocks: [
      {
        block_id: 'cash_summary',
        domain: 'cash',
        title: 'Resumen de caja',
        description: `Estado de caja para ${filters.range.label}`,
        source: 'public.cash_sessions',
        rows_count: sessions.length,
        content: {
          sessions_count: sessions.length,
          open_sessions: openSessions,
          sessions_with_difference: sessionsWithDifference,
          net_difference: totalDifference,
          location_name: filters.locationName || null,
        },
      },
      {
        block_id: 'cash_recent_sessions',
        domain: 'cash',
        title: 'Sesiones de caja recientes',
        description: 'Ultimas sesiones dentro del rango consultado',
        source: 'public.cash_sessions',
        rows_count: recentSessions.length,
        content: {
          items: recentSessions,
        },
      },
      {
        block_id: 'cash_recent_movements',
        domain: 'cash',
        title: 'Movimientos de caja recientes',
        description: 'Ultimos movimientos de caja del rango consultado',
        source: 'public.cash_movements',
        rows_count: recentMovements.length,
        content: {
          items: recentMovements,
        },
      },
    ],
    errors: [],
  };
}

async function retrievePortfolioContext(
  authClient: SupabaseClient,
  tenantId: string,
  _filters: ResolvedFilters,
  maxItems: number,
): Promise<RetrievedPayload> {
  const accountsQuery = authClient
    .from('customer_credit_accounts')
    .select(
      `
        credit_account_id,
        credit_limit,
        current_balance,
        is_active,
        customer:customer_id(customer_id,full_name,document,phone,email)
      `,
    )
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('current_balance', { ascending: false })
    .limit(100);

  const movementsQuery = authClient
    .from('customer_credit_movements')
    .select(
      `
        movement_id,
        credit_account_id,
        source,
        amount,
        note,
        created_at,
        created_by_user:created_by(full_name)
      `,
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);

  const [
    { data: accountRows, error: accountError },
    { data: movementRows, error: movementError },
  ] = await Promise.all([accountsQuery, movementsQuery]);

  if (accountError) throw new Error(`Cartera: ${accountError.message}`);
  if (movementError) throw new Error(`Movimientos de cartera: ${movementError.message}`);

  const accounts = Array.isArray(accountRows) ? accountRows : [];
  const movements = Array.isArray(movementRows) ? movementRows : [];

  const totalDebt = accounts.reduce((sum, row) => sum + toNumber(row.current_balance), 0);
  const totalLimit = accounts.reduce((sum, row) => sum + toNumber(row.credit_limit), 0);
  const accountsWithDebt = accounts.filter((row) => toNumber(row.current_balance) > 0).length;
  const overLimit = accounts.filter((row) => toNumber(row.current_balance) > toNumber(row.credit_limit)).length;

  const topDebtors = truncateRows(accounts, maxItems).map((row) => ({
    customer_name: ((row.customer as Record<string, unknown> | null)?.full_name) || 'Cliente',
    document: ((row.customer as Record<string, unknown> | null)?.document) || null,
    phone: ((row.customer as Record<string, unknown> | null)?.phone) || null,
    current_balance: toNumber(row.current_balance),
    credit_limit: toNumber(row.credit_limit),
    over_limit: toNumber(row.current_balance) > toNumber(row.credit_limit),
  }));

  const recentMovements = truncateRows(movements, maxItems).map((row) => ({
    source: row.source,
    amount: toNumber(row.amount),
    note: row.note || null,
    created_at: row.created_at,
    created_by: ((row.created_by_user as Record<string, unknown> | null)?.full_name) || null,
  }));

  return {
    blocks: [
      {
        block_id: 'portfolio_summary',
        domain: 'portfolio',
        title: 'Resumen de cartera',
        description: 'Estado actual de cuentas por cobrar',
        source: 'public.customer_credit_accounts',
        rows_count: accounts.length,
        content: {
          total_accounts: accounts.length,
          accounts_with_debt: accountsWithDebt,
          total_debt: totalDebt,
          total_limit: totalLimit,
          accounts_over_limit: overLimit,
        },
      },
      {
        block_id: 'portfolio_top_debtors',
        domain: 'portfolio',
        title: 'Clientes con mayor saldo',
        description: 'Cuentas con mayor saldo pendiente',
        source: 'public.customer_credit_accounts',
        rows_count: topDebtors.length,
        content: {
          items: topDebtors,
        },
      },
      {
        block_id: 'portfolio_recent_movements',
        domain: 'portfolio',
        title: 'Movimientos recientes de cartera',
        description: 'Ultimos abonos o movimientos crediticios registrados',
        source: 'public.customer_credit_movements',
        rows_count: recentMovements.length,
        content: {
          items: recentMovements,
        },
      },
    ],
    errors: [],
  };
}

async function retrieveProductionContext(
  authClient: SupabaseClient,
  tenantId: string,
  filters: ResolvedFilters,
  maxItems: number,
): Promise<RetrievedPayload> {
  let productionQuery = authClient
    .from('production_orders')
    .select(
      `
        production_order_id,
        order_number,
        status,
        quantity_planned,
        quantity_produced,
        created_at,
        completed_at,
        location_id,
        location:location_id(location_id,name),
        bom:bom_id(
          bom_name,
          product:product_id(name),
          variant:variant_id(variant_name)
        )
      `,
    )
    .eq('tenant_id', tenantId)
    .gte('created_at', filters.range.fromIso)
    .lte('created_at', filters.range.toIso)
    .order('created_at', { ascending: false })
    .limit(60);

  if (filters.locationId) {
    productionQuery = productionQuery.eq('location_id', filters.locationId);
  }

  const { data, error } = await productionQuery;
  if (error) throw new Error(`Produccion: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  const openStatuses = new Set(['PLANNED', 'IN_PROGRESS', 'PAUSED', 'DRAFT']);
  const openOrders = rows.filter((row) => openStatuses.has(String(row.status || '')));
  const completedOrders = rows.filter((row) => String(row.status || '') === 'COMPLETED');

  const recentOrders = truncateRows(rows, maxItems).map((row) => ({
    order_number: row.order_number || row.production_order_id,
    status: row.status,
    quantity_planned: toNumber(row.quantity_planned),
    quantity_produced: toNumber(row.quantity_produced),
    created_at: row.created_at,
    completed_at: row.completed_at,
    location_name: ((row.location as Record<string, unknown> | null)?.name) || null,
    bom_name: ((row.bom as Record<string, unknown> | null)?.bom_name) || null,
    product_name: ((((row.bom as Record<string, unknown> | null)?.product) as Record<string, unknown> | null)?.name) || null,
    variant_name: ((((row.bom as Record<string, unknown> | null)?.variant) as Record<string, unknown> | null)?.variant_name) || null,
  }));

  return {
    blocks: [
      {
        block_id: 'production_summary',
        domain: 'production',
        title: 'Resumen de produccion',
        description: `Ordenes de produccion en ${filters.range.label}`,
        source: 'public.production_orders',
        rows_count: rows.length,
        content: {
          total_orders: rows.length,
          open_orders: openOrders.length,
          completed_orders: completedOrders.length,
          location_name: filters.locationName || null,
        },
      },
      {
        block_id: 'production_recent_orders',
        domain: 'production',
        title: 'Ordenes de produccion recientes',
        description: 'Ultimas ordenes de produccion registradas',
        source: 'public.production_orders',
        rows_count: recentOrders.length,
        content: {
          items: recentOrders,
        },
      },
    ],
    errors: [],
  };
}

const DOMAIN_RETRIEVERS: Record<DomainKey, (
  authClient: SupabaseClient,
  tenantId: string,
  filters: ResolvedFilters,
  maxItems: number,
) => Promise<RetrievedPayload>> = {
  sales: retrieveSalesContext,
  inventory: retrieveInventoryContext,
  purchases: retrievePurchasesContext,
  cash: retrieveCashContext,
  portfolio: retrievePortfolioContext,
  production: retrieveProductionContext,
};

async function retrieveOperationalContext(
  authClient: SupabaseClient,
  tenantId: string,
  domains: DomainKey[],
  filters: ResolvedFilters,
  maxItems: number,
) {
  const settled = await Promise.allSettled(
    domains.map(async (domain) => {
      const response = await DOMAIN_RETRIEVERS[domain](authClient, tenantId, filters, maxItems);
      return { domain, ...response };
    }),
  );

  const blocks: RetrievedBlock[] = [];
  const errors: string[] = [];

  settled.forEach((entry, index) => {
    const domain = domains[index];
    if (entry.status === 'rejected') {
      errors.push(`${domain}: ${entry.reason?.message || String(entry.reason || 'Error inesperado')}`);
      return;
    }
    blocks.push(...entry.value.blocks);
    errors.push(...entry.value.errors);
  });

  return { blocks, errors };
}

function buildPrompt(params: {
  query: string;
  domains: DomainKey[];
  filters: ResolvedFilters;
  blocks: RetrievedBlock[];
}) {
  const compactBlocks = params.blocks.map((block) => ({
    block_id: block.block_id,
    domain: block.domain,
    title: block.title,
    description: block.description,
    source: block.source,
    rows_count: block.rows_count,
    content: block.content,
  }));

  return [
    {
      role: 'system',
      content:
        'Eres un analista operativo para un POS multi-tenant. Responde SOLO JSON valido, sin markdown. Debes responder unicamente con informacion sustentada en el contexto recuperado. Si el contexto no alcanza, dilo explicitamente. No inventes cifras, clientes, productos ni conclusiones no soportadas.',
    },
    {
      role: 'user',
      content: `Responde la consulta del usuario usando SOLO el contexto recuperado.

Devuelve JSON EXACTO con esta forma:
{
  "answer": "string",
  "summary": "string|null",
  "clarifying_question": "string|null",
  "suggested_actions": ["string"],
  "citations": ["block_id"],
  "confidence": number
}

Reglas:
- answer debe ser breve, claro y accionable, en espanol.
- summary debe ser una linea corta o null.
- suggested_actions: maximo 4 items.
- citations solo puede contener block_id existentes en el contexto.
- confidence entre 0 y 1.
- Si faltan datos para cerrar la respuesta, dilo en answer y usa clarifying_question cuando ayude.
- Si la consulta habla de mas vendidos o top productos, prioriza 'sales_top_products'.
- Si la consulta habla de menos vendidos, baja rotacion, menor rotacion o poca rotacion, prioriza 'sales_low_rotation_products' y aclara si el resultado incluye productos con cero ventas o solo productos que si vendieron en el rango.
- Si la consulta habla de que comprar, reponer, reabastecer o planear compras para la proxima semana, combina inventario + ventas + compras.
- Para esa intencion prioriza 'inventory_stock_risks', 'sales_top_products', 'sales_low_rotation_products' y 'purchases_recent'.
- Solo recomienda productos concretos cuando el contexto muestre senales operativas suficientes, por ejemplo alta venta con stock comprometido/bajo o necesidad clara de reposicion.
- Si la consulta mira al futuro como 'proxima semana', usa el historial del rango consultado y el stock actual como base operativa, sin afirmar demanda futura exacta.
- Si la consulta habla de vencimientos, por vencer, vencidos o dias para vencer, prioriza los bloques de expiracion de inventario y aclara si se trata de lotes ya vencidos o proximos a vencer.
- Si el usuario usa una expresion ambigua como "menos vencidos", interpretala como los lotes con menos dias para vencer cuando el contexto de expiracion lo soporte.
- No cites bloques que no uses.

Consulta:
"""${params.query.slice(0, 8000)}"""

Dominios seleccionados:
${params.domains.join(', ')}

Filtros aplicados:
${JSON.stringify({
  tenant_id: params.filters.tenantId,
  location_id: params.filters.locationId,
  location_name: params.filters.locationName,
  range: {
    from_date: params.filters.range.fromDate,
    to_date: params.filters.range.toDate,
    label: params.filters.range.label,
    source: params.filters.range.source,
  },
}, null, 2)}

Contexto recuperado:
${JSON.stringify(compactBlocks, null, 2)}`,
    },
  ];
}

async function callDeepSeek(messages: Array<{ role: string; content: string }>) {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY secret in Edge Function');
  }

  const upstreamPayload = {
    model: DEFAULT_MODEL,
    temperature: 0.1,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    messages,
    stream: false,
  };

  const upstream = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamPayload),
  });

  const rawText = await upstream.text();
  let rawJson: JsonMap | null = null;
  try {
    rawJson = rawText ? (JSON.parse(rawText) as JsonMap) : null;
  } catch (_error) {
    rawJson = null;
  }

  if (!upstream.ok) {
    const upstreamError =
      rawJson?.error && typeof rawJson.error === 'object' && 'message' in (rawJson.error as JsonMap)
        ? String(((rawJson.error as JsonMap).message) || '')
        : rawText.slice(0, 1200);
    throw new Error(`DeepSeek request failed: ${upstreamError || `HTTP ${upstream.status}`}`);
  }

  const choice = Array.isArray(rawJson?.choices) ? (rawJson?.choices?.[0] as JsonMap) : null;
  const message = choice?.message as JsonMap | undefined;
  const content = normalizeContent(message?.content);

  if (!content) {
    throw new Error('DeepSeek returned empty content');
  }

  const parsed = parseJsonSafe(content);
  if (!parsed) {
    throw new Error('Could not parse JSON from model output');
  }

  return {
    parsed,
    model: String(rawJson?.model || DEFAULT_MODEL),
    usage: (rawJson?.usage as JsonMap | undefined) || null,
  };
}

function normalizeAgentResponse(parsed: JsonMap, validBlockIds: string[]) {
  const citations = unique(
    (Array.isArray(parsed.citations) ? parsed.citations : [])
      .map((item) => String(item || '').trim())
      .filter((item) => validBlockIds.includes(item)),
  );

  const suggestedActions = truncateRows(
    (Array.isArray(parsed.suggested_actions) ? parsed.suggested_actions : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
    4,
  );

  return {
    answer: String(parsed.answer || '').trim() || 'No fue posible construir una respuesta grounded.',
    summary: parsed.summary ? String(parsed.summary).trim() : null,
    clarifying_question: parsed.clarifying_question ? String(parsed.clarifying_question).trim() : null,
    suggested_actions: suggestedActions,
    citations,
    confidence: clampConfidence(parsed.confidence),
  };
}

function buildCacheKey(params: {
  tenantId: string;
  normalizedQuery: string;
  domains: DomainKey[];
  filters: ResolvedFilters;
  maxItemsPerBlock: number;
}) {
  return `${CACHE_VERSION}|${params.tenantId}|${params.normalizedQuery}|${params.domains.join(',')}|${params.filters.range.fromDate}|${params.filters.range.toDate}|${params.filters.locationId || 'all'}|${params.maxItemsPerBlock}`;
}

async function readCache(
  adminClient: SupabaseClient | null,
  tenantId: string,
  queryHash: string,
) {
  if (!adminClient) return null;
  const nowIso = new Date().toISOString();

  const { data, error } = await adminClient
    .from('ops_ai_query_cache')
    .select('cache_id, response_payload, use_count')
    .eq('tenant_id', tenantId)
    .eq('query_hash', queryHash)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .maybeSingle();

  if (error || !data?.response_payload) return null;

  await adminClient
    .from('ops_ai_query_cache')
    .update({
      use_count: Number(data.use_count || 0) + 1,
      last_used_at: nowIso,
    })
    .eq('cache_id', String(data.cache_id || ''));

  return data.response_payload as JsonMap;
}

async function writeCache(
  adminClient: SupabaseClient | null,
  params: {
    tenantId: string;
    authUserId: string;
    queryHash: string;
    normalizedQuery: string;
    domains: DomainKey[];
    filters: ResolvedFilters;
    payload: JsonMap;
  },
) {
  if (!adminClient) return;

  const ttlHoursRaw = Number(Deno.env.get('OPS_RAG_AGENT_CACHE_TTL_HOURS') || DEFAULT_CACHE_TTL_HOURS);
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : DEFAULT_CACHE_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  try {
    await adminClient
      .from('ops_ai_query_cache')
      .upsert({
        tenant_id: params.tenantId,
        auth_user_id: params.authUserId,
        query_hash: params.queryHash,
        normalized_query: params.normalizedQuery,
        domains: params.domains,
        filters: {
          location_id: params.filters.locationId,
          location_name: params.filters.locationName,
          from_date: params.filters.range.fromDate,
          to_date: params.filters.range.toDate,
          range_label: params.filters.range.label,
        },
        response_payload: params.payload,
        model: String(params.payload.model || ''),
        expires_at: expiresAt,
        last_used_at: new Date().toISOString(),
        use_count: 1,
      }, {
        onConflict: 'tenant_id,query_hash',
      });
  } catch (_cacheWriteError) {
    // Cache best-effort: no debe romper la respuesta del agente.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  let body: JsonMap;
  try {
    body = (await req.json()) as JsonMap;
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const query = String(body.query || body.prompt || '').trim();
  if (!query) {
    return jsonResponse({ error: 'query is required' }, 400);
  }

  try {
    const requestedTenantId = String(body.tenant_id || '').trim() || null;
    const tenantContext = await resolveUserTenantContext(
      authClient,
      userData.user.id,
      requestedTenantId,
    );

    const { data: locationRows, error: locationError } = await authClient
      .from('locations')
      .select('location_id,name')
      .eq('tenant_id', tenantContext.tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (locationError) {
      throw new Error(`No fue posible cargar sedes activas: ${locationError.message}`);
    }

    const locations = buildLocationIndex((Array.isArray(locationRows) ? locationRows : []) as Array<Record<string, unknown>>);
    const explicitDomains = normalizeDomains(body.domains);
    const domains = inferDomains(query, explicitDomains);
    const range = inferDateRange(query, body);
    const location = resolveLocationFromBodyOrQuery(query, body, locations);
    const maxItemsPerBlockRaw = Number(body.max_items_per_block || DEFAULT_MAX_ITEMS_PER_BLOCK);
    const maxItemsPerBlock = Number.isFinite(maxItemsPerBlockRaw)
      ? Math.max(2, Math.min(10, Math.floor(maxItemsPerBlockRaw)))
      : DEFAULT_MAX_ITEMS_PER_BLOCK;
    const includeDebug = body.include_debug === true;
    const useCache = body.use_cache !== false;

    const filters: ResolvedFilters = {
      tenantId: tenantContext.tenantId,
      locationId: location.locationId,
      locationName: location.locationName,
      range,
    };

    const normalizedQuery = normalizeText(query);
    const cacheKeyRaw = buildCacheKey({
      tenantId: tenantContext.tenantId,
      normalizedQuery,
      domains,
      filters,
      maxItemsPerBlock,
    });
    const queryHash = await sha256Hex(cacheKeyRaw);

    if (useCache) {
      const cached = await readCache(adminClient, tenantContext.tenantId, queryHash);
      if (cached) {
        return jsonResponse({
          success: true,
          data: {
            ...(cached || {}),
            cache_hit: true,
          },
        });
      }
    }

    const retrieval = await retrieveOperationalContext(
      authClient,
      tenantContext.tenantId,
      domains,
      filters,
      maxItemsPerBlock,
    );

    if (!retrieval.blocks.length) {
      const fallbackPayload = {
        answer: 'No encontre contexto operativo suficiente para responder con seguridad. Intenta acotar el dominio, la sede o el rango de fechas.',
        summary: 'Sin contexto suficiente',
        clarifying_question: '¿Quieres consultar ventas, inventario, compras, caja, cartera o produccion?',
        suggested_actions: [
          'Indica un dominio concreto, por ejemplo: ventas o inventario.',
          'Si aplica, especifica sede y rango de fechas.',
        ],
        citations: [],
        confidence: 0.18,
        domains,
        filters: {
          tenant_id: filters.tenantId,
          location_id: filters.locationId,
          location_name: filters.locationName,
          range,
        },
        retrieval_errors: retrieval.errors,
        retrieved_context: [],
        model: null,
      };

      return jsonResponse({
        success: true,
        data: {
          ...fallbackPayload,
          cache_hit: false,
        },
      });
    }

    const llmResponse = await callDeepSeek(buildPrompt({
      query,
      domains,
      filters,
      blocks: retrieval.blocks,
    }));
    const normalizedResponse = normalizeAgentResponse(
      llmResponse.parsed,
      retrieval.blocks.map((block) => block.block_id),
    );

    const payload: JsonMap = {
      ...normalizedResponse,
      domains,
      filters: {
        tenant_id: filters.tenantId,
        location_id: filters.locationId,
        location_name: filters.locationName,
        range,
      },
      retrieval_errors: retrieval.errors,
      retrieved_context: retrieval.blocks.map((block) => ({
        block_id: block.block_id,
        domain: block.domain,
        title: block.title,
        source: block.source,
        rows_count: block.rows_count,
      })),
      model: llmResponse.model,
      usage: llmResponse.usage,
    };

    if (includeDebug) {
      payload.debug = {
        normalized_query: normalizedQuery,
        routing: {
          explicit_domains: explicitDomains,
          final_domains: domains,
          range_source: range.source,
        },
        blocks: retrieval.blocks,
      };
    }

    if (useCache) {
      await writeCache(adminClient, {
        tenantId: tenantContext.tenantId,
        authUserId: userData.user.id,
        queryHash,
        normalizedQuery,
        domains,
        filters,
        payload,
      });
    }

    return jsonResponse({
      success: true,
      data: {
        ...payload,
        cache_hit: false,
      },
    });
  } catch (error) {
    return jsonResponse({
      error: 'ops-rag-agent failed',
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
