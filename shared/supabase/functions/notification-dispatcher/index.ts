import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type SupabaseClient = ReturnType<typeof createClient>
type Row = Record<string, unknown>

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sanitizeName(value: unknown) {
  return String(value || 'OfirOne').replace(/[<>]/g, '').trim() || 'OfirOne'
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value || 10)
  if (!Number.isFinite(parsed)) return 10
  return Math.max(1, Math.min(50, Math.trunc(parsed)))
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function buildPublicOrderUrl(orderId: unknown) {
  const origin = String(Deno.env.get('PUBLIC_APP_URL') || Deno.env.get('APP_PUBLIC_URL') || '').trim().replace(/\/+$/, '')
  if (!origin || !orderId) return ''
  return `${origin}/pedido/${orderId}`
}

function getStoreSnapshotBrand(order: Row) {
  const snapshot = order.store_snapshot && typeof order.store_snapshot === 'object'
    ? order.store_snapshot as Row
    : {}
  return String(snapshot.brand_name || '').trim()
}

function humanizeEventType(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function valueOrDash(value: unknown) {
  const text = String(value ?? '').trim()
  return text || '-'
}

function buildInfoRows(rows: Array<{ label: string; value: unknown; strong?: boolean }>) {
  return rows
    .filter((row) => valueOrDash(row.value) !== '-')
    .map((row) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#64748b;">${escapeHtml(row.label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;${row.strong ? 'font-weight:700;' : 'font-weight:600;'}">${escapeHtml(row.value)}</td>
      </tr>
    `)
    .join('')
}

function buildLineRows(lines: Row[], options: { emptyText?: string } = {}) {
  if (!lines.length) {
    return `<tr><td style="padding:10px 0;color:#64748b;">${escapeHtml(options.emptyText || 'Detalle no disponible.')}</td></tr>`
  }

  return lines.map((line) => {
    const variant = line.variant && typeof line.variant === 'object' ? line.variant as Row : {}
    const product = variant.product && typeof variant.product === 'object' ? variant.product as Row : {}
    const name = line.product_name || product.name || line.name || 'Producto'
    const variantName = line.variant_name || variant.variant_name || ''
    const sku = line.sku || variant.sku || ''
    const qty = line.quantity || ''
    const total = line.line_total ?? line.amount ?? line.unit_price ?? ''

    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
          <div style="font-weight:600;color:#111827;">${qty ? `${escapeHtml(qty)} x ` : ''}${escapeHtml(name)}</div>
          ${variantName ? `<div style="font-size:13px;color:#64748b;">${escapeHtml(variantName)}</div>` : ''}
          ${sku ? `<div style="font-size:12px;color:#94a3b8;">SKU: ${escapeHtml(sku)}</div>` : ''}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827;">${formatMoney(total)}</td>
      </tr>
    `
  }).join('')
}

function buildRichEmailShell(params: {
  eyebrow?: string
  title: string
  intro: string
  accent?: 'green' | 'blue' | 'amber' | 'red' | 'slate'
  body: string
  actionUrl?: string
  actionLabel?: string
}) {
  const accentBg = {
    green: '#ecfdf5',
    blue: '#eff6ff',
    amber: '#fffbeb',
    red: '#fff1f2',
    slate: '#f8fafc',
  }[params.accent || 'blue']

  return `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #e5e7eb;overflow:hidden;">
        <div style="padding:24px;background:${accentBg};">
          ${params.eyebrow ? `<div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;">${escapeHtml(params.eyebrow)}</div>` : ''}
          <h1 style="margin:${params.eyebrow ? '8px' : '0'} 0 0;font-size:24px;color:#111827;">${escapeHtml(params.title)}</h1>
          <p style="margin:10px 0 0;color:#334155;line-height:1.5;">${escapeHtml(params.intro)}</p>
        </div>
        <div style="padding:24px;">
          ${params.body}
          ${params.actionUrl ? `
            <div style="margin-top:24px;">
              <a href="${escapeHtml(params.actionUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">
                ${escapeHtml(params.actionLabel || 'Ver detalle')}
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `
}

function buildGenericPayloadTable(payload: Row) {
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .slice(0, 8)

  if (!entries.length) return ''

  return `
    <table style="width:100%;border-collapse:collapse;">
      ${buildInfoRows(entries.map(([key, value]) => ({
        label: humanizeEventType(key),
        value: String(value),
      })))}
    </table>
  `
}

function buildOnlineOrderEmailHtml(params: {
  eventType: string
  order: Row
  store: Row | null
  lines: Row[]
}) {
  const { eventType, order, store, lines } = params
  const isApproved = eventType === 'ONLINE_ORDER_APPROVED'
  const isRejected = eventType === 'ONLINE_ORDER_REJECTED'
  const storeName = String(store?.brand_name || getStoreSnapshotBrand(order) || 'La tienda').trim()
  const title = isApproved
    ? 'Tu compra fue confirmada'
    : isRejected
      ? 'Tu compra no pudo ser confirmada'
      : 'Recibimos tu pedido'
  const intro = isApproved
    ? 'Recibimos la confirmación del pago y tu pedido quedó aprobado.'
    : isRejected
      ? 'Tu pedido fue rechazado o el pago no pudo ser confirmado. Si crees que fue un error, contacta a la tienda.'
      : 'Tu pedido fue recibido y está pendiente de validación.'
  const headerBg = isApproved ? '#ecfdf5' : isRejected ? '#fff7ed' : '#eff6ff'
  const statusUrl = buildPublicOrderUrl(order.online_order_id)

  const itemsHtml = lines.length
    ? lines.map((line) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;color:#111827;">${escapeHtml(line.quantity)} x ${escapeHtml(line.product_name)}</div>
            ${line.variant_name ? `<div style="font-size:13px;color:#64748b;">${escapeHtml(line.variant_name)}</div>` : ''}
            ${line.sku ? `<div style="font-size:12px;color:#94a3b8;">SKU: ${escapeHtml(line.sku)}</div>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827;">
            ${formatMoney(line.line_total)}
          </td>
        </tr>
      `).join('')
    : '<tr><td style="padding:10px 0;color:#64748b;">Productos no disponibles en el resumen.</td></tr>'

  return `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #e5e7eb;overflow:hidden;">
        <div style="padding:24px;background:${headerBg};">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;">${escapeHtml(storeName)}</div>
          <h1 style="margin:8px 0 0;font-size:24px;color:#111827;">${escapeHtml(title)}</h1>
          <p style="margin:10px 0 0;color:#334155;line-height:1.5;">${escapeHtml(intro)}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;color:#334155;">Pedido <strong>#${escapeHtml(order.order_number)}</strong></p>
          <table style="width:100%;border-collapse:collapse;">
            ${itemsHtml}
            <tr>
              <td style="padding:14px 0 0;color:#64748b;">Total</td>
              <td style="padding:14px 0 0;text-align:right;font-size:18px;font-weight:700;">${formatMoney(order.total)}</td>
            </tr>
          </table>
          ${statusUrl ? `
            <div style="margin-top:24px;">
              <a href="${escapeHtml(statusUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">
                Ver estado del pedido
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `
}

function buildOnlineOrderEmailText(eventType: string, order: Row, store: Row | null) {
  const storeName = String(store?.brand_name || getStoreSnapshotBrand(order) || 'La tienda').trim()
  const status = eventType === 'ONLINE_ORDER_APPROVED'
    ? 'confirmada'
    : eventType === 'ONLINE_ORDER_REJECTED'
      ? 'rechazada'
      : 'recibida'
  return `${storeName}: tu compra #${order.order_number} fue ${status}. Total: ${formatMoney(order.total)}.`
}

async function buildSaleEmailContent(supabase: SupabaseClient, row: Row, entityId: string) {
  const { data: sale, error } = await supabase
    .from('sales')
    .select(`
      sale_id, sale_number, total, subtotal, discount_total, tax_total, status, sold_at,
      customer:customer_id(full_name, email),
      third_party:third_party_id(legal_name, trade_name, email, fiscal_email),
      location:location_id(name)
    `)
    .eq('sale_id', entityId)
    .maybeSingle()

  if (error || !sale) return null

  const { data: lines } = await supabase
    .from('sale_lines')
    .select('quantity, line_total, unit_price, variant:variant_id(sku, variant_name, product:product_id(name))')
    .eq('sale_id', entityId)
    .order('sale_line_id', { ascending: true })

  const location = sale.location && typeof sale.location === 'object' ? sale.location as Row : {}
  const body = `
    <p style="margin:0 0 16px;color:#334155;">Venta <strong>#${escapeHtml(sale.sale_number)}</strong></p>
    <table style="width:100%;border-collapse:collapse;">
      ${buildLineRows(lines || [], { emptyText: 'Productos no disponibles en el resumen.' })}
      <tr>
        <td style="padding:14px 0 0;color:#64748b;">Total</td>
        <td style="padding:14px 0 0;text-align:right;font-size:18px;font-weight:700;">${formatMoney(sale.total)}</td>
      </tr>
    </table>
  `

  return {
    html: buildRichEmailShell({
      eyebrow: String(location.name || 'OfirOne'),
      title: 'Gracias por tu compra',
      intro: 'Tu venta fue registrada correctamente.',
      accent: 'blue',
      body,
    }),
    text: `Venta #${sale.sale_number} registrada por ${formatMoney(sale.total)}.`,
    fromName: '',
  }
}

async function buildSaleReturnEmailContent(supabase: SupabaseClient, row: Row, entityId: string) {
  const { data: saleReturn, error } = await supabase
    .from('sale_returns')
    .select('return_id, refund_total, reason, created_at, sale:sale_id(sale_number, total)')
    .eq('return_id', entityId)
    .maybeSingle()

  if (error || !saleReturn) return null

  const sale = saleReturn.sale && typeof saleReturn.sale === 'object' ? saleReturn.sale as Row : {}
  const body = `
    <table style="width:100%;border-collapse:collapse;">
      ${buildInfoRows([
        { label: 'Venta', value: sale.sale_number ? `#${sale.sale_number}` : '', strong: true },
        { label: 'Valor devuelto', value: formatMoney(saleReturn.refund_total), strong: true },
        { label: 'Motivo', value: saleReturn.reason },
      ])}
    </table>
  `

  return {
    html: buildRichEmailShell({
      title: 'Devolución registrada',
      intro: 'Procesamos una devolución sobre tu compra.',
      accent: 'amber',
      body,
    }),
    text: `Devolución registrada por ${formatMoney(saleReturn.refund_total)}.`,
    fromName: '',
  }
}

async function buildLayawayEmailContent(supabase: SupabaseClient, row: Row, entityId: string) {
  const eventType = String(row.event_type || '')
  const { data: layaway, error } = await supabase
    .from('layaway_contracts')
    .select('layaway_id, total, paid_total, balance, status, due_date, created_at, customer:customer_id(full_name, email)')
    .eq('layaway_id', entityId)
    .maybeSingle()

  if (error || !layaway) return null

  const { data: items } = await supabase
    .from('layaway_items')
    .select('quantity, line_total, unit_price, variant:variant_id(sku, variant_name, product:product_id(name))')
    .eq('layaway_id', entityId)
    .order('layaway_item_id', { ascending: true })

  const title = eventType === 'LAYAWAY_CREATED'
    ? 'Plan separé creado'
    : eventType === 'LAYAWAY_COMPLETED'
      ? 'Plan separé completado'
      : eventType === 'LAYAWAY_CANCELLED'
        ? 'Plan separé cancelado'
        : eventType === 'LAYAWAY_EXPIRED'
          ? 'Plan separé vencido'
          : 'Actualización de plan separé'

  const body = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      ${buildInfoRows([
        { label: 'Estado', value: layaway.status, strong: true },
        { label: 'Total', value: formatMoney(layaway.total), strong: true },
        { label: 'Pagado', value: formatMoney(layaway.paid_total) },
        { label: 'Saldo', value: formatMoney(layaway.balance), strong: true },
        { label: 'Fecha límite', value: layaway.due_date },
      ])}
    </table>
    <table style="width:100%;border-collapse:collapse;">
      ${buildLineRows(items || [], { emptyText: 'Productos no disponibles en el resumen.' })}
    </table>
  `

  return {
    html: buildRichEmailShell({
      title,
      intro: 'Te compartimos el estado actualizado de tu plan separé.',
      accent: eventType === 'LAYAWAY_CANCELLED' || eventType === 'LAYAWAY_EXPIRED' ? 'red' : 'green',
      body,
    }),
    text: `${title}. Total ${formatMoney(layaway.total)}, saldo ${formatMoney(layaway.balance)}.`,
    fromName: '',
  }
}

async function buildLayawayPaymentEmailContent(supabase: SupabaseClient, row: Row, entityId: string) {
  const { data: payment, error } = await supabase
    .from('layaway_payments')
    .select('layaway_payment_id, amount, reference, paid_at, layaway:layaway_id(total, paid_total, balance, status)')
    .eq('layaway_payment_id', entityId)
    .maybeSingle()

  if (error || !payment) return null

  const layaway = payment.layaway && typeof payment.layaway === 'object' ? payment.layaway as Row : {}
  const body = `
    <table style="width:100%;border-collapse:collapse;">
      ${buildInfoRows([
        { label: 'Abono recibido', value: formatMoney(payment.amount), strong: true },
        { label: 'Referencia', value: payment.reference },
        { label: 'Saldo actual', value: formatMoney(layaway.balance), strong: true },
        { label: 'Estado', value: layaway.status },
      ])}
    </table>
  `

  return {
    html: buildRichEmailShell({
      title: 'Abono recibido',
      intro: 'Registramos tu abono al plan separé.',
      accent: 'green',
      body,
    }),
    text: `Abono recibido por ${formatMoney(payment.amount)}. Saldo ${formatMoney(layaway.balance)}.`,
    fromName: '',
  }
}

async function buildSupplierPayableEmailContent(supabase: SupabaseClient, row: Row, entityId: string) {
  const { data: payable, error } = await supabase
    .from('supplier_payables')
    .select('payable_id, invoice_number, due_date, total_amount, paid_amount, balance, status, supplier:supplier_id(legal_name, trade_name)')
    .eq('payable_id', entityId)
    .maybeSingle()

  if (error || !payable) return null

  const supplier = payable.supplier && typeof payable.supplier === 'object' ? payable.supplier as Row : {}
  const body = `
    <table style="width:100%;border-collapse:collapse;">
      ${buildInfoRows([
        { label: 'Proveedor', value: supplier.legal_name || supplier.trade_name, strong: true },
        { label: 'Factura', value: payable.invoice_number },
        { label: 'Total', value: formatMoney(payable.total_amount), strong: true },
        { label: 'Pagado', value: formatMoney(payable.paid_amount) },
        { label: 'Saldo', value: formatMoney(payable.balance), strong: true },
        { label: 'Vencimiento', value: payable.due_date },
        { label: 'Estado', value: payable.status },
      ])}
    </table>
  `

  return {
    html: buildRichEmailShell({
      title: 'Cuenta por pagar creada',
      intro: 'Se registró una nueva cuenta por pagar.',
      accent: 'amber',
      body,
    }),
    text: `Cuenta por pagar por ${formatMoney(payable.total_amount)}. Saldo ${formatMoney(payable.balance)}.`,
    fromName: '',
  }
}

function buildPayloadEmailContent(row: Row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload as Row : {}
  const eventType = String(row.event_type || '')
  const title = String(row.subject || humanizeEventType(eventType) || 'Notificación')
  const entityType = String(row.entity_type || '')
  const intro = entityType === 'SYSTEM_ALERT'
    ? String(payload.message || 'Hay una alerta operativa que requiere revisión.')
    : entityType === 'USER'
      ? 'Tu usuario fue creado o actualizado en OfirOne.'
      : entityType === 'BULK_IMPORT'
        ? 'El proceso de importación cambió de estado.'
        : entityType === 'TENANT_SUBSCRIPTION'
          ? 'La suscripción del tenant cambió de estado.'
          : 'Te compartimos una actualización importante.'

  const accent: 'green' | 'blue' | 'amber' | 'red' | 'slate' = eventType.includes('FAILED') || eventType.includes('CANCELLED') || eventType.includes('EXPIRED')
    ? 'red'
    : eventType.includes('WARNING') || eventType.includes('PENDING') || eventType.includes('PAYABLE')
      ? 'amber'
      : eventType.includes('APPROVED') || eventType.includes('COMPLETED') || eventType.includes('PAID')
        ? 'green'
        : 'blue'

  const body = buildGenericPayloadTable(payload)
    || `<p style="margin:0;color:#334155;line-height:1.5;">${escapeHtml(row.text_body || row.subject || '')}</p>`

  return {
    html: buildRichEmailShell({
      eyebrow: humanizeEventType(entityType),
      title,
      intro,
      accent,
      body,
    }),
    text: String(row.text_body || `${title}. ${intro}`),
    fromName: '',
  }
}

async function buildEmailContent(supabase: SupabaseClient, row: Row) {
  const eventType = String(row.event_type || '')
  const entityType = String(row.entity_type || '')
  const entityId = String(row.entity_id || '').trim()

  if (entityType === 'SALE' && entityId) {
    return await buildSaleEmailContent(supabase, row, entityId) || buildPayloadEmailContent(row)
  }

  if (entityType === 'SALE_RETURN' && entityId) {
    return await buildSaleReturnEmailContent(supabase, row, entityId) || buildPayloadEmailContent(row)
  }

  if (entityType === 'LAYAWAY' && entityId) {
    return await buildLayawayEmailContent(supabase, row, entityId) || buildPayloadEmailContent(row)
  }

  if (entityType === 'LAYAWAY_PAYMENT' && entityId) {
    return await buildLayawayPaymentEmailContent(supabase, row, entityId) || buildPayloadEmailContent(row)
  }

  if (entityType === 'SUPPLIER_PAYABLE' && entityId) {
    return await buildSupplierPayableEmailContent(supabase, row, entityId) || buildPayloadEmailContent(row)
  }

  if (entityType !== 'ONLINE_ORDER' || !['ONLINE_ORDER_APPROVED', 'ONLINE_ORDER_REJECTED', 'ONLINE_ORDER_PENDING'].includes(eventType) || !entityId) {
    return buildPayloadEmailContent(row)
  }

  const { data: order, error: orderError } = await supabase
    .from('online_orders')
    .select('online_order_id, store_id, order_number, total, customer_name, customer_email, payment_status, status, store_snapshot')
    .eq('online_order_id', entityId)
    .maybeSingle()
  if (orderError || !order) {
    return {
      html: String(row.html || `<p>${row.text_body || row.subject}</p>`),
      text: String(row.text_body || row.subject || ''),
      fromName: '',
    }
  }

  const [{ data: store }, { data: lines }] = await Promise.all([
    supabase
      .from('online_stores')
      .select('store_id, brand_name, slug')
      .eq('store_id', order.store_id)
      .maybeSingle(),
    supabase
      .from('online_order_lines')
      .select('product_name, variant_name, sku, quantity, line_total')
      .eq('online_order_id', entityId)
      .order('created_at', { ascending: true }),
  ])

  return {
    html: buildOnlineOrderEmailHtml({
      eventType,
      order,
      store: store || null,
      lines: lines || [],
    }),
    text: buildOnlineOrderEmailText(eventType, order, store || null),
    fromName: String(store?.brand_name || getStoreSnapshotBrand(order) || '').trim(),
  }
}

async function sendResendEmail(payload: Record<string, unknown>) {
  const apiKey = String(Deno.env.get('RESEND_API_KEY') || Deno.env.get('RESEND_KEY') || '').trim()
  if (!apiKey) {
    throw new Error('Falta configurar RESEND_API_KEY en los secretos de Supabase.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || 'Resend no pudo enviar el correo.'))
  }
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo no permitido.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
    }

    const body = await req.json().catch(() => ({}))
    const limit = normalizeLimit(body?.limit)
    const notificationId = String(body?.notification_id || '').trim()
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    await supabase
      .from('notification_outbox')
      .update({
        status: 'pending',
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('locked_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

    let query = supabase
      .from('notification_outbox')
      .select('*')
      .in('status', ['pending', 'failed'])
      .eq('channel', 'email')
      .lte('next_attempt_at', new Date().toISOString())
      .lt('attempts', 3)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (notificationId) {
      query = query.eq('notification_id', notificationId)
    }

    const { data: rows, error: listError } = await query
    if (listError) throw listError

    const fromEmail = String(Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev').trim()
    const defaultFromName = sanitizeName(Deno.env.get('RESEND_FROM_NAME') || 'OfirOne')
    const results: Array<Record<string, unknown>> = []

    for (const row of rows || []) {
      const { data: claimedRows, error: claimError } = await supabase
        .from('notification_outbox')
        .update({
          status: 'processing',
          locked_at: new Date().toISOString(),
          attempts: Number(row.attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('notification_id', row.notification_id)
        .in('status', ['pending', 'failed'])
        .select('notification_id')

      if (claimError) {
        results.push({ notification_id: row.notification_id, ok: false, error: claimError.message })
        continue
      }
      if (!claimedRows?.length) {
        results.push({ notification_id: row.notification_id, ok: true, skipped: 'already_claimed' })
        continue
      }

      try {
        const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}
        const content = await buildEmailContent(supabase, row)
        const fromName = sanitizeName(payload.from_name || content.fromName || defaultFromName)
        const resendData = await sendResendEmail({
          from: `${fromName} <${fromEmail}>`,
          to: row.recipient_email,
          subject: row.subject,
          html: content.html,
          text: content.text,
        })

        const { error: sentError } = await supabase
          .from('notification_outbox')
          .update({
            status: 'sent',
            provider: 'resend',
            provider_message_id: resendData?.id || null,
            sent_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('notification_id', row.notification_id)

        if (sentError) throw sentError
        results.push({ notification_id: row.notification_id, ok: true, resend_id: resendData?.id || null })
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1
        const nextDelayMinutes = attempts >= Number(row.max_attempts || 3)
          ? 60
          : Math.min(60, 2 ** attempts)
        const nextAttemptAt = new Date(Date.now() + nextDelayMinutes * 60 * 1000).toISOString()
        const finalStatus = attempts >= Number(row.max_attempts || 3) ? 'failed' : 'pending'

        await supabase
          .from('notification_outbox')
          .update({
            status: finalStatus,
            next_attempt_at: nextAttemptAt,
            last_error: error instanceof Error ? error.message : 'Unexpected error',
            updated_at: new Date().toISOString(),
          })
          .eq('notification_id', row.notification_id)

        results.push({
          notification_id: row.notification_id,
          ok: false,
          error: error instanceof Error ? error.message : 'Unexpected error',
        })
      }
    }

    return jsonResponse({
      ok: true,
      processed: results.length,
      results,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
